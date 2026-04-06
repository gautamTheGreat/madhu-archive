#!/usr/bin/env python3
"""
enrich_posts.py

Service-oriented enrichment pipeline refactored for Asynchronous Layered Processing.
Optimized for Groq Free Tier (30 RPM) and Nominatim (1 request/sec).
"""

import argparse
import asyncio
import json
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from config_utils import sync_archive_config

import httpx
from mistralai.client import Mistral
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

PIPELINE_DIR    = Path(__file__).parent
CACHE_DIR       = PIPELINE_DIR / 'cache'
ARTIFACTS_DIR   = CACHE_DIR / 'artifacts'
OUTPUT_DIR      = PIPELINE_DIR / 'output'
RAW_JSON        = OUTPUT_DIR / 'posts_raw.json'
ENRICHED_JSON   = OUTPUT_DIR / 'posts_enriched.json'
# SITE_DATA       = PIPELINE_DIR.parent / 'code' / 'src' / 'data' / 'posts.json'
# ARCHIVE_CONFIG  = PIPELINE_DIR.parent / 'code' / 'src' / 'data' / 'archive_config.json'
ARCHIVE_CONFIG  = OUTPUT_DIR / 'archive_config.json'

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

MISTRAL_MODEL   = 'mistral-small-latest'
CONTENT_LIMIT   = 6000

NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search'
NOMINATIM_UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
WIKI_API_URL    = 'https://en.wikipedia.org/w/api.php'

# Rate Limiting Semaphores
WIKI_SEMA = asyncio.Semaphore(10)
LLM_SEMA  = asyncio.Semaphore(2)  # Mistral Small allows some concurrency on paid tiers
GEO_SEMA  = asyncio.Semaphore(1)  # Nominatim: 1 request per second

# Global Stop Signal
_STOP_EVENT = asyncio.Event()

# ──────────────────────────────────────────────────────────────────────────────
# Prompt Template
# ──────────────────────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """\
You are an expert on Indian temple architecture, sculpture, and South/Southeast Asian history.

Your task is to extract structured metadata from a Facebook post.
We have provided a Wikipedia extract for the likely temple or site.

CRITICAL INSTRUCTIONS:
1. WIKIPEDIA IS THE GROUND TRUTH: If Wikipedia provides a dynasty, historical period, or location, USE THAT DATA.
2. SUPPORT MULTIPLE DYNASTIES: Return dynasties as a LIST. Include all relevant dynasties (e.g. ["Pallava", "Chola"]).
3. SYNTHESIZE: Use the Facebook post for specific artistic details, observations about sculptures, and the local context.
4. CONFLICTS: If there is a conflict between Wikipedia and the post text for Dynasty or Period, use Wikipedia.
5. SUMMARY: Provide a 2-sentence summary that synthesizes both sets of information.

EXTRACT AS JSON:
{{
  "temple_name": "Primary temple name from Wikipedia if available, else from post",
  "alternate_names": ["Other known names"],
  "deity": "Primary deity (string or null)",
  "dynasties": ["List", "of", "contributing", "dynasties"],
  "architectural_style": "e.g. Dravidian, Nagara, Khmer (string or null)",
  "historical_period": {{
    "label": "e.g. '11th century CE' (string or null)",
    "start_year": <int or null>, "start_era": "CE/BC",
    "end_year": <int or null>, "end_era": "CE/BC"
  }},
  "construction_duration": {{
    "min_years": <int or null>, "max_years": <int or null>, "label": "string or null"
  }},
  "location": {{
    "place_name": "string or null", "district": "string or null",
    "state": "string or null", "country": "string or null"
  }},
  "summary": "2-sentence synthesis (plain English)",
  "tags": ["relevant semantic tags"],
  "confidence": "high/medium/low based on Wikipedia match quality"
}}

WIKIPEDIA CONTEXT:
{wiki_context}

POST TITLE: {title}
POST TEXT:
{content}
"""

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def ts_log(msg: str) -> None:
    t = datetime.now().strftime('%H:%M:%S')
    print(f'[{t}] {msg}', flush=True)

def load_json_file(path: Path):
    if path.exists():
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return None

def save_json_file(path: Path, data: dict) -> None:
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError as e:
        ts_log(f'⚠ File write failed: {e}')

# ──────────────────────────────────────────────────────────────────────────────
# Service logic (Async)
# ──────────────────────────────────────────────────────────────────────────────

async def service_wikipedia(query: str, fallback_query: str = None, client: httpx.AsyncClient = None) -> dict:
    if _STOP_EVENT.is_set(): return None
    if not query or len(query) < 3:
        if fallback_query: return await service_wikipedia(fallback_query, None, client)
        return None
    
    query = "".join(c for c in query if c.isprintable()).strip()
    async with WIKI_SEMA:
        try:
            # Step 1: OpenSearch for Discovery
            os_params = {'action': 'opensearch', 'search': query, 'limit': 1, 'format': 'json'}
            resp = await client.get(WIKI_API_URL, params=os_params, timeout=10)
            os_data = resp.json()
            
            if not os_data[1]:
                if fallback_query and fallback_query != query:
                    return await service_wikipedia(fallback_query, None, client)
                return None
                
            best_title = os_data[1][0]
            site_url = os_data[3][0]

            # Step 2: Query for Content
            q_params = {
                'action': 'query', 'prop': 'extracts|coordinates', 
                'titles': best_title, 'explaintext': 1, 'format': 'json', 'redirects': 1
            }
            resp = await client.get(WIKI_API_URL, params=q_params, timeout=10)
            pages = resp.json().get('query', {}).get('pages', {})
            pid = next(iter(pages))
            if pid == "-1": return None
            page = pages[pid]
            
            coords = page.get('coordinates', [{}])[0]
            return {
                'title': page['title'],
                'extract': page.get('extract', '')[:12000],
                'url': site_url,
                'lat': coords.get('lat'),
                'lon': coords.get('lon'),
                'ts': datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            ts_log(f"   ⚠ Wikipedia error ({query}): {e}")
            return None

async def service_llm(prompt: str, client: Mistral) -> dict:
    if _STOP_EVENT.is_set(): return None
    async with LLM_SEMA:
        await asyncio.sleep(1.0) # Conservative delay for Mistral API
        try:
            resp = await client.chat.complete_async(
                model=MISTRAL_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            content = resp.choices[0].message.content
            return {
                **json.loads(content),
                '_model': MISTRAL_MODEL,
                '_ts': datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            # Mistral handles 429s etc. via standard exceptions
            err_msg = str(e).lower()
            if "429" in err_msg or "rate limit" in err_msg:
                ts_log(f"‼ CRITICAL: Mistral Rate Limit Exhausted. Stopping pipeline. {e}")
                _STOP_EVENT.set()
                return {"_error": "rate_limit_exhausted"}
            return {"_error": str(e)}

async def service_geocoding(place, district, state, country, client: httpx.AsyncClient):
    if _STOP_EVENT.is_set(): return None
    if not place and not district and not state: return None
    
    queries = []
    if place:
        queries.append(', '.join([p for p in [place, district, state, country] if p]))
    if district:
        queries.append(', '.join([p for p in [district, state, country] if p]))
    elif state:
        queries.append(', '.join([p for p in [state, country] if p]))
    
    seen = set()
    unique_queries = []
    for q in queries:
        if q and q not in seen:
            unique_queries.append(q)
            seen.add(q)

    for i, query in enumerate(unique_queries):
        async with GEO_SEMA:
            await asyncio.sleep(1.5) # Nominatim policy
            try:
                ts_log(f"   Geocoding attempt {i+1}: {query}")
                r = await client.get(NOMINATIM_URL, params={'q': query, 'format': 'json', 'limit': 1}, timeout=10)
                data = r.json()
                if data:
                    return {
                        'lat': float(data[0]['lat']),
                        'lng': float(data[0]['lon']),
                        'display_name': data[0].get('display_name'),
                        'query': query,
                        'source': 'nominatim',
                        'level': 'place' if (i == 0 and place) else 'fallback',
                        'ts': datetime.now(timezone.utc).isoformat()
                    }
            except Exception as e:
                ts_log(f"   ⚠ Geocoding error ({query}): {e}")
                
    return {'lat': None, 'lng': None, 'query': unique_queries[0] if unique_queries else 'N/A', 'ts': datetime.now(timezone.utc).isoformat()}

# ──────────────────────────────────────────────────────────────────────────────
# Pipeline Orchestration
# ──────────────────────────────────────────────────────────────────────────────

def filter_valid_posts(posts: list) -> tuple:
    valid_posts = []
    stats = {'original_count': len(posts), 'excluded_no_media': 0, 'excluded_video': 0}
    for p in posts:
        media = p.get('media')
        if not media or len(media) == 0:
            stats['excluded_no_media'] += 1
            continue
        if any(m.get('type') == 'video' for m in media):
            stats['excluded_video'] += 1
            continue
        valid_posts.append(p)
    return valid_posts, stats

def extract_search_terms(post: dict) -> tuple:
    content = post.get('content', '') or ''
    place_match = re.search(r'PLACE:\s*(.+)$', content, re.MULTILINE | re.IGNORECASE)
    if place_match:
        full = re.sub(r'#.*$', '', place_match.group(1)).strip()
        best = re.split(r'[,|:]', full)[0].strip()
        return best, full
    
    lines = [L.strip() for L in content.split('\n') if L.strip()]
    best = None
    if lines and not lines[0].startswith('#'):
        parts = re.split(r'[:|–\-]', lines[0])
        best = re.sub(r'\s+TEMPLE\s*$', '', parts[0].strip(), flags=re.IGNORECASE)
    
    fallback = None
    hashtags = post.get('hashtags', [])
    for ht in hashtags:
        tag = ht.replace('#', '')
        if tag.lower() not in ['sculptureenthusiast', 'shiva', 'vishnu', 'temple', 'heritage', 'incredibleindia', 'tamilnadutourism', 'cambodia', 'banteaysrei']:
            fallback = f"{best} {tag}" if best else tag
            break
    return best, fallback

def map_enriched_post(p: dict, u: dict):
    wiki = u.get('wikipedia') or {}
    en   = u.get('llm') or {}
    geo  = u.get('geocoding') or {}
    loc  = en.get('location') or {}
    
    dyn = en.get('dynasties') or en.get('dynasty')
    if isinstance(dyn, str): dyn = [d.strip() for d in dyn.split(',')]
    if not isinstance(dyn, list): dyn = []

    etags = set(p.get('hashtags') or [])
    ltags = [t for t in (en.get('tags') or []) if t not in etags]

    # Remove unnecessary raw fields
    for unwanted in ['fbid', 'fbUrl', 'hashtags', 'mediaCount', 'editHistory', 'shareLinks']:
        p.pop(unwanted, None)

    if p.get('media'):
        for m in p['media']:
            for unw_m in ['createdAt', 'takenAt', 'fbUrl', 'exif', 'title', 'description', 'uri']:
                m.pop(unw_m, None)

    p.update({
        'enriched': True,
        'temple_name': en.get('temple_name'),
        'alternate_names': en.get('alternate_names') or [],
        'deity': en.get('deity'),
        'dynasties': dyn,
        'architectural_style': en.get('architectural_style'),
        'historical_period': en.get('historical_period'),
        'construction_duration': en.get('construction_duration'),
        'wikipedia_link': wiki.get('url'),
        'location': {
            'place_name': loc.get('place_name'), 'district': loc.get('district'),
            'state': loc.get('state'), 'country': loc.get('country'),
            'lat': geo.get('lat'), 'lng': geo.get('lng')
        } if loc.get('place_name') or geo.get('lat') else None,
        'summary': en.get('summary'),
        'tags': sorted(list(etags)) + ltags,
        'confidence': en.get('confidence'),
    })

def save_enrichment_summary(original_count: int, filter_stats: dict, posts: list):
    summary = {
        'total_original_posts': original_count,
        'excluded_no_media': filter_stats['excluded_no_media'],
        'excluded_video': filter_stats['excluded_video'],
        'total_final_posts': len(posts),
        'enriched_posts': sum(1 for p in posts if p.get('enriched')),
        'missing_fields': {
            'temple_name': sum(1 for p in posts if not p.get('temple_name')),
            'dynasty': sum(1 for p in posts if not p.get('dynasties')),
            'historical_period': sum(1 for p in posts if not p.get('historical_period')),
            'location_coordinates': sum(1 for p in posts if not (p.get('location') and p['location'].get('lat'))),
            'location_name': sum(1 for p in posts if not (p.get('location') and p['location'].get('place_name'))),
            'deity': sum(1 for p in posts if not p.get('deity')),
            'summary': sum(1 for p in posts if not p.get('summary')),
        },
        'confidence_distribution': {
            'high': sum(1 for p in posts if p.get('confidence') == 'high'),
            'medium': sum(1 for p in posts if p.get('confidence') == 'medium'),
            'low': sum(1 for p in posts if p.get('confidence') == 'low'),
            'none': sum(1 for p in posts if not p.get('confidence'))
        }
    }
    summary_path = OUTPUT_DIR / 'enrichment_summary.json'
    save_json_file(summary_path, summary)
    ts_log(f"Summary written to {summary_path.name}")

async def update_dynasties_meta(posts: list) -> dict:
    unique_dynasties = set()
    for p in posts:
        if p.get('dynasties'):
            for d in p['dynasties']:
                if d and isinstance(d, str): unique_dynasties.add(d)
    
    dynasties_meta_path = CACHE_DIR / 'dynasties_meta.json'
    dynasty_meta = load_json_file(dynasties_meta_path) or {}
    missing_dynasties = [d for d in unique_dynasties if d not in dynasty_meta]
    
    if missing_dynasties:
        api_key = os.environ.get('MISTRAL_API_KEY')
        if api_key:
            ts_log(f"Fetching metadata for {len(missing_dynasties)} new dynasties via Mistral...")
            try:
                llm = Mistral(api_key=api_key)
                prompt = f"""
                You are a historian of South and Southeast Asia.
                Provide a JSON object mapping each of the following dynasties to its historical data.
                Use the following JSON schema for the entire output:
                {{
                   "Dynasty Name": {{
                       "start_year": int (use negative for BCE),
                       "end_year": int,
                       "summary": "1-sentence description including capital if known."
                   }}
                }}
                Dynasties to map: {missing_dynasties}
                """
                resp = await llm.chat.complete_async(
                    model=MISTRAL_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                new_meta = json.loads(resp.choices[0].message.content)
                dynasty_meta.update(new_meta)
                save_json_file(dynasties_meta_path, dynasty_meta)
            except Exception as e:
                ts_log(f"⚠ Failed to fetch dynasty metadata: {e}")
                
    return dynasty_meta

def copy_post_media(post: dict, adir: Path, force: bool):
    public_dir = PIPELINE_DIR.parent / 'code' / 'public'
    for m in post.get('media', []):
        pub_url = m.get('publicUrl')
        if pub_url and pub_url.startswith('/'):
            src_path = public_dir / pub_url.lstrip('/')
            if src_path.exists():
                dest_path = adir / src_path.name
                if force or not dest_path.exists():
                    try:
                        shutil.copy2(src_path, dest_path)
                    except OSError as e:
                        ts_log(f"   ⚠ Failed to copy media {src_path.name}: {e}")

async def process_service_layers(post: dict, force: bool, http_client: httpx.AsyncClient, llm_client: Mistral):
    pid = post['id']
    adir = ARTIFACTS_DIR / pid
    adir.mkdir(exist_ok=True, parents=True)
    
    u_path = adir / 'unified.json'
    if not force and u_path.exists():
        return pid, load_json_file(u_path)

    ts_log(f"Processing {pid} ...")
    
    # 1. Metadata
    m_path = adir / 'metadata.json'
    best_q, fallback_q = extract_search_terms(post)
    meta = {'id': pid, 'search_term': best_q, 'fallback_term': fallback_q, 'ts_start': datetime.now(timezone.utc).isoformat()}
    save_json_file(m_path, meta)

    # Copy media files into the post dir (adir)
    copy_post_media(post, adir, force)

    # 2. Layer: Wikipedia (Discovery)
    w_path = adir / 'wikipedia.json'
    wiki = load_json_file(w_path) if not force else None
    if not wiki:
        wiki = await service_wikipedia(best_q, fallback_q, http_client)
        if wiki: save_json_file(w_path, wiki)

    # 3. Layer: LLM (Synthesis)
    l_path = adir / 'llm.json'
    llm = load_json_file(l_path) if not force else None
    if not llm or '_error' in llm:
        ctx = f"Wikipedia: {wiki['title']}\nURL: {wiki['url']}\nCONTENT:\n{wiki['extract']}" if wiki else "No Wikipedia data found."
        prompt = PROMPT_TEMPLATE.format(title=post.get('title',''), content=(post.get('content') or '')[:CONTENT_LIMIT], wiki_context=ctx)
        llm = await service_llm(prompt, llm_client)
        save_json_file(l_path, llm)

    # 4. Layer: Geocoding (Placement)
    if _STOP_EVENT.is_set(): return pid, None
    g_path = adir / 'geocoding.json'
    geo = load_json_file(g_path) if not force else None
    if not geo or geo.get('lat') is None:
        if wiki and wiki.get('lat') is not None:
            geo = {'lat': wiki['lat'], 'lng': wiki['lon'], 'source': 'wikipedia', 'level': 'place', 'ts': datetime.now(timezone.utc).isoformat()}
        else:
            loc = llm.get('location') or {}
            geo = await service_geocoding(loc.get('place_name'), loc.get('district'), loc.get('state'), loc.get('country'), http_client)
        if geo: save_json_file(g_path, geo)

    # 5. Synthesis (Minimized)
    unified = {
        'metadata': {k: meta.get(k) for k in ['id', 'search_term'] if meta.get(k)},
        'wikipedia': {k: wiki.get(k) for k in ['title', 'url'] if wiki.get(k)} if wiki else None,
        'llm': {k: v for k, v in llm.items() if not k.startswith('_')} if llm else None,
        'geocoding': {k: geo.get(k) for k in ['lat', 'lng', 'source', 'level'] if geo.get(k)} if geo else None
    }
    save_json_file(u_path, unified)
    ts_log(f"   ✓ Unified {pid}")
    return pid, unified

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', '-l', type=int, default=0)
    parser.add_argument('--force', '-f', action='store_true')
    args = parser.parse_args()

    ts_log(f'Loading {RAW_JSON}...')
    if not RAW_JSON.exists():
        ts_log(f"⚠ ERROR: {RAW_JSON} not found. Run parse_export.py first.")
        return

    with open(RAW_JSON, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    
    posts, filter_stats = filter_valid_posts(raw['posts'])
    original_count = filter_stats['original_count']
    if filter_stats['excluded_no_media'] > 0:
        ts_log(f"Excluded {filter_stats['excluded_no_media']} posts with no media.")
    if filter_stats['excluded_video'] > 0:
        ts_log(f"Excluded {filter_stats['excluded_video']} posts containing video.")

    needs = [p for p in posts if p.get('content') or p.get('title')]
    
    if args.force: to_process = needs
    else: to_process = [p for p in needs if not (ARTIFACTS_DIR / p['id'] / 'unified.json').exists()]
    if args.limit > 0: to_process = to_process[:args.limit]

    ts_log(f'Enriching {len(to_process)} posts (Layered Async)...')
    emap = {}
    
    # Load existing artifacts for non-processed posts
    for p in needs:
        upath = ARTIFACTS_DIR / p['id'] / 'unified.json'
        if upath.exists() and p['id'] not in [x['id'] for x in to_process]:
            emap[p['id']] = load_json_file(upath)

    if to_process:
        api_key = os.environ.get('MISTRAL_API_KEY')
        if not api_key:
            ts_log("⚠ ERROR: MISTRAL_API_KEY not found in environment.")
            return
            
        headers = {'User-Agent': NOMINATIM_UA}
        async with httpx.AsyncClient(headers=headers) as http_client:
            llm_client = Mistral(api_key=api_key)
            tasks = [process_service_layers(p, args.force, http_client, llm_client) for p in to_process]
            results = await asyncio.gather(*tasks)
            for res in results:
                if res:
                    pid, data = res
                    emap[pid] = data
        
        if _STOP_EVENT.is_set():
            ts_log("⚠ Execution halted due to critical error/rate limit.")

    # Final merge
    for p in posts:
        u = emap.get(p['id'])
        if u: map_enriched_post(p, u)

    save_enrichment_summary(original_count, filter_stats, posts)

    with open(ENRICHED_JSON, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)
    
    dynasty_meta = await update_dynasties_meta(posts)
    sync_archive_config(ENRICHED_JSON, ARCHIVE_CONFIG, dynasty_meta=dynasty_meta)
    ts_log("Done.")

if __name__ == '__main__':
    asyncio.run(main())
