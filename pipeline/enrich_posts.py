#!/usr/bin/env python3
"""
enrich_posts.py

Calls the Gemini LLM to extract structured metadata from each post's text,
then geocodes the resolved location names via OpenStreetMap Nominatim.

Optimisations:
  - Parallel Gemini API calls via ThreadPoolExecutor (network I/O-bound).
  - Per-post disk cache in pipeline/cache/<post_id>.json  — re-runs are free;
    only posts without a cache file hit the API.
  - Unique-location deduplication before geocoding (many posts share the same
    temple location so we only call Nominatim once per unique place string).
  - Nominatim rate-limit (1 req/sec) enforced via a threading.Lock + sleep.
  - Geocode results are also cached in pipeline/cache/geo_<key>.json.

Prerequisites:
    pip install -r requirements.txt
    set GEMINI_API_KEY=your_key_here   (Windows)
    # OR
    export GEMINI_API_KEY=your_key_here  (macOS/Linux)

Run (from project root or pipeline/ folder):
    python pipeline/enrich_posts.py
"""

import json
import os
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import google.generativeai as genai
import requests
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

PIPELINE_DIR  = Path(__file__).parent
CACHE_DIR     = PIPELINE_DIR / 'cache'
OUTPUT_DIR    = PIPELINE_DIR / 'output'
RAW_JSON      = OUTPUT_DIR / 'posts_raw.json'
ENRICHED_JSON = OUTPUT_DIR / 'posts_enriched.json'
SITE_DATA     = PIPELINE_DIR.parent / 'code' / 'src' / 'data' / 'posts.json'

CACHE_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

GEMINI_MODEL   = 'gemini-flash-latest'
MAX_WORKERS    = 10          # parallel Gemini threads
CONTENT_LIMIT  = 5000        # max chars of post text sent to Gemini

NOMINATIM_URL  = 'https://nominatim.openstreetmap.org/search'
NOMINATIM_UA   = 'madhu-jagdhish-archive/1.0 (temple sculpture archive)'

# ──────────────────────────────────────────────────────────────────────────────
# Gemini setup
# ──────────────────────────────────────────────────────────────────────────────

api_key = os.environ.get('GEMINI_API_KEY')
if not api_key:
    raise EnvironmentError(
        'GEMINI_API_KEY environment variable not set. Please set it in pipeline/.env'
    )

genai.configure(api_key=api_key)
model = genai.GenerativeModel(
    GEMINI_MODEL,
    generation_config=genai.GenerationConfig(
        response_mime_type='application/json',
        temperature=0.1,        # low temperature → consistent structured output
    ),
)

# ──────────────────────────────────────────────────────────────────────────────
# Prompt template
# ──────────────────────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """\
You are an expert on Indian temple architecture, sculpture, and South/Southeast Asian history.

Analyse the Facebook post below (written by Madhu Jagdhish, a temple sculpture enthusiast) \
and extract the following fields as a single JSON object.

Return ONLY valid JSON with exactly these keys. Use null for any field you cannot determine.

{{
  "temple_name": "Primary temple or monument name (string or null)",
  "alternate_names": ["Other known names / local names for the same structure"],
  "deity": "Primary deity or function, e.g. Shiva, Vishnu, Jain, Buddhist stupa (string or null)",
  "dynasty": "Ruling dynasty responsible for construction, e.g. Chola, Pallava, Hoysala, Khmer (string or null)",
  "architectural_style": "e.g. Dravidian, Nagara, Vesara, Khmer (string or null)",
  "historical_period": {{
    "label": "Human-readable era, e.g. '11th century CE', 'Late Chola period' (string or null)",
    "start_year": <integer or null>,
    "start_era": "'CE' or 'BC' (string or null)",
    "end_year": <integer or null>,
    "end_era": "'CE' or 'BC' (string or null)"
  }},
  "construction_duration": {{
    "min_years": <integer or null>,
    "max_years": <integer or null>,
    "label": "e.g. '5 to 10 years', 'around 25 years' (string or null)"
  }},
  "location": {{
    "place_name": "Specific city, town, or site name (string or null)",
    "district":   "District if mentioned (string or null)",
    "state":      "State or province (string or null)",
    "country":    "Country name (string or null)"
  }},
  "summary": "2-sentence plain English summary of what the post is about (string or null)",
  "tags": ["relevant semantic tags — include hashtags from text plus additional descriptive tags"],
  "confidence": "Your overall confidence in the extracted data: 'high', 'medium', or 'low'"
}}

POST TITLE: {title}
POST HASHTAGS: {hashtags}
POST TEXT:
{content}
"""

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def ts_log(msg: str) -> None:
    t = datetime.now().strftime('%H:%M:%S')
    print(f'[{t}] {msg}', flush=True)


def post_cache_path(post_id: str) -> Path:
    return CACHE_DIR / f'{post_id}.json'


def geo_cache_path(query: str) -> Path:
    safe = re.sub(r'[^\w]', '_', query.lower())[:80]
    return CACHE_DIR / f'geo_{safe}.json'


def load_json_cache(path: Path):
    if path.exists():
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return None


def save_json_cache(path: Path, data: dict) -> None:
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
    except OSError as e:
        ts_log(f'⚠  Cache write failed {path}: {e}')


# ──────────────────────────────────────────────────────────────────────────────
# Gemini enrichment  (called in parallel threads)
# ──────────────────────────────────────────────────────────────────────────────

def enrich_post(post: dict) -> tuple:
    """
    Call Gemini for one post.  Returns (post_id, result_dict).
    Checks disk cache first; only hits the API on a cache miss.
    Thread-safe: genai SDK + file I/O are both safe across threads.
    """
    post_id = post['id']
    cp      = post_cache_path(post_id)

    cached = load_json_cache(cp)
    if cached is not None:
        return post_id, cached

    prompt = PROMPT_TEMPLATE.format(
        title    = post.get('title', '') or '',
        hashtags = ', '.join(post.get('hashtags') or []),
        content  = (post.get('content') or '')[:CONTENT_LIMIT],
    )

    retries = 3
    for attempt in range(1, retries + 1):
        try:
            response = model.generate_content(prompt)
            result   = json.loads(response.text)
            save_json_cache(cp, result)
            return post_id, result
        except json.JSONDecodeError as e:
            ts_log(f'⚠  JSON parse error for {post_id} (attempt {attempt}): {e}')
            result = {'confidence': 'low', '_error': f'json_decode: {e}'}
        except Exception as e:
            if attempt < retries:
                time.sleep(2 ** attempt)   # exponential back-off
            else:
                ts_log(f'⚠  Gemini failed for {post_id} after {retries} attempts: {e}')
                result = {'confidence': 'low', '_error': str(e)}

    save_json_cache(cp, result)
    return post_id, result


# ──────────────────────────────────────────────────────────────────────────────
# Nominatim geocoding  (serial, rate-limited to 1 req/sec)
# ──────────────────────────────────────────────────────────────────────────────

_nominatim_lock     = threading.Lock()
_last_nominatim_req = 0.0


def geocode(place_name: str, state: str | None, country: str | None) -> tuple:
    """
    Resolve a place name to (lat, lng) using OpenStreetMap Nominatim.
    Rate-limited to 1 request/second as required by Nominatim's ToS.
    Both hits and misses are cached to disk.
    Returns (lat, lng) or (None, None).
    """
    parts   = [p for p in [place_name, state, country] if p]
    query   = ', '.join(parts)
    gcp     = geo_cache_path(query)
    cached  = load_json_cache(gcp)
    if cached is not None:
        return cached.get('lat'), cached.get('lng')

    global _last_nominatim_req
    with _nominatim_lock:
        # Enforce minimum 1.1s between requests
        elapsed = time.time() - _last_nominatim_req
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)

        try:
            resp = requests.get(
                NOMINATIM_URL,
                params={'q': query, 'format': 'json', 'limit': 1},
                headers={'User-Agent': NOMINATIM_UA},
                timeout=10,
            )
            _last_nominatim_req = time.time()
            results = resp.json()
            if results:
                lat = float(results[0]['lat'])
                lng = float(results[0]['lon'])
                save_json_cache(gcp, {'lat': lat, 'lng': lng, 'query': query})
                return lat, lng
        except Exception as e:
            ts_log(f'⚠  Geocode error "{query}": {e}')
            _last_nominatim_req = time.time()

    save_json_cache(gcp, {'lat': None, 'lng': None, 'query': query})
    return None, None


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

ts_log(f'Loading {RAW_JSON} ...')
with open(RAW_JSON, 'r', encoding='utf-8') as f:
    raw = json.load(f)

posts = raw['posts']
needs_enrichment = [p for p in posts if p.get('content') or p.get('title')]
already_cached   = sum(1 for p in needs_enrichment if post_cache_path(p['id']).exists())
api_calls_needed = len(needs_enrichment) - already_cached

ts_log(f'  {len(posts)} total posts.')
ts_log(f'  {len(needs_enrichment)} have text content → will enrich.')
ts_log(f'  {already_cached} already cached → {api_calls_needed} API calls needed.')
print()

# ── Phase 1: Parallel Gemini calls ────────────────────────────────────────────

ts_log(f'Starting Gemini enrichment ({MAX_WORKERS} parallel workers) ...')
enrichment_map: dict = {}
errors = 0

with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
    futures = {pool.submit(enrich_post, p): p['id'] for p in needs_enrichment}
    done = 0
    for fut in as_completed(futures):
        post_id = futures[fut]
        done += 1
        try:
            pid, result = fut.result()
            enrichment_map[pid] = result
        except Exception as e:
            ts_log(f'⚠  Unexpected error for {post_id}: {e}')
            enrichment_map[post_id] = {'confidence': 'low', '_error': str(e)}
            errors += 1

        if done % 100 == 0 or done == len(needs_enrichment):
            pct = round(done / len(needs_enrichment) * 100)
            ts_log(f'  Gemini: {done}/{len(needs_enrichment)} ({pct}%) — errors so far: {errors}')

print()
ts_log(f'Gemini phase complete. Total errors: {errors}')
print()

# ── Phase 2: Geocoding (serial, rate-limited) ─────────────────────────────────

# Collect unique location tuples to minimise Nominatim requests
unique_locations: dict = {}   # geo_query_key → (place_name, state, country)

for post in posts:
    enriched = enrichment_map.get(post['id']) or {}
    loc      = (enriched.get('location') or {})
    place    = loc.get('place_name')
    state    = loc.get('state')
    country  = loc.get('country')
    if place:
        key = ', '.join(p for p in [place, state, country] if p)
        unique_locations[key] = (place, state, country)

ts_log(f'Geocoding {len(unique_locations)} unique locations via Nominatim (rate-limited 1 req/s) ...')
geo_results: dict = {}   # geo_query_key → (lat, lng)
geo_done = 0

for key, (place, state, country) in unique_locations.items():
    lat, lng = geocode(place, state, country)
    geo_results[key] = (lat, lng)
    geo_done += 1
    if geo_done % 20 == 0 or geo_done == len(unique_locations):
        pct = round(geo_done / max(len(unique_locations), 1) * 100)
        ts_log(f'  Geo: {geo_done}/{len(unique_locations)} ({pct}%)')

print()

# ── Phase 3: Merge enrichments into post objects ──────────────────────────────

ts_log('Merging enrichments ...')
for post in posts:
    enriched = enrichment_map.get(post['id'])
    if not enriched:
        continue

    loc     = (enriched.get('location') or {})
    place   = loc.get('place_name')
    state   = loc.get('state')
    country = loc.get('country')
    geo_key = ', '.join(p for p in [place, state, country] if p) if place else None
    lat, lng = geo_results.get(geo_key, (None, None)) if geo_key else (None, None)

    # Merge tags: raw hashtags (already in post) + new LLM tags, deduplicated
    existing_tags = set(post.get('hashtags') or [])
    llm_tags      = [t for t in (enriched.get('tags') or []) if t not in existing_tags]
    merged_tags   = sorted(existing_tags) + llm_tags

    post.update({
        'enriched':             True,
        'temple_name':          enriched.get('temple_name'),
        'alternate_names':      enriched.get('alternate_names') or [],
        'deity':                enriched.get('deity'),
        'dynasty':              enriched.get('dynasty'),
        'architectural_style':  enriched.get('architectural_style'),
        'historical_period':    enriched.get('historical_period'),
        'construction_duration': enriched.get('construction_duration'),
        'location': {
            'place_name': place,
            'district':   loc.get('district'),
            'state':      state,
            'country':    country,
            'lat':        lat,
            'lng':        lng,
        } if place else None,
        'summary':    enriched.get('summary'),
        'tags':       merged_tags,
        'confidence': enriched.get('confidence'),
    })

# ── Phase 4: Write outputs ────────────────────────────────────────────────────

# posts_enriched.json — full raw structure + enriched posts (for debugging)
enriched_output = {**raw, 'posts': posts}
ts_log(f'Writing {ENRICHED_JSON} ...')
with open(ENRICHED_JSON, 'w', encoding='utf-8') as f:
    json.dump(enriched_output, f, ensure_ascii=False, indent=2)

# posts.json — the flat array read by the website
ts_log(f'Writing {SITE_DATA} ...')
SITE_DATA.parent.mkdir(parents=True, exist_ok=True)
with open(SITE_DATA, 'w', encoding='utf-8') as f:
    json.dump(posts, f, ensure_ascii=False, indent=2)

# ── Summary ───────────────────────────────────────────────────────────────────

enriched_count = sum(1 for p in posts if p.get('enriched'))
geo_count      = sum(1 for p in posts if (p.get('location') or {}).get('lat'))
size_enriched  = ENRICHED_JSON.stat().st_size // 1024
size_site      = SITE_DATA.stat().st_size // 1024

print()
print('══════════════════════════════════════════')
print('  Enrichment complete! Summary:')
print('══════════════════════════════════════════')
print(f'  Posts total          : {len(posts)}')
print(f'  Posts enriched       : {enriched_count}')
print(f'  Posts with location  : {geo_count} (with lat/lng resolved)')
print(f'  Gemini errors        : {errors}')
print(f'  Cached responses     : {len(list(CACHE_DIR.glob("*.json"))) - len(unique_locations)} LLM + {len(unique_locations)} geo')
print(f'  Enriched JSON        : {size_enriched} KB → {ENRICHED_JSON}')
print(f'  Site posts.json      : {size_site} KB → {SITE_DATA}')
print('══════════════════════════════════════════')
