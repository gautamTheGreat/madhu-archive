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
import time
from datetime import datetime, timezone
from pathlib import Path
from config_utils import sync_archive_config

import httpx
from groq import AsyncGroq
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
SITE_DATA       = PIPELINE_DIR.parent / 'code' / 'src' / 'data' / 'posts.json'
ARCHIVE_CONFIG  = PIPELINE_DIR.parent / 'code' / 'src' / 'data' / 'archive_config.json'

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

GROQ_MODEL      = 'llama-3.3-70b-versatile'
CONTENT_LIMIT   = 6000

NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search'
NOMINATIM_UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
WIKI_API_URL    = 'https://en.wikipedia.org/w/api.php'

# Rate Limiting Semaphores
WIKI_SEMA = asyncio.Semaphore(10)
LLM_SEMA  = asyncio.Semaphore(1)  # Free Tier: 30 RPM = 1 request per 2 seconds
GEO_SEMA  = asyncio.Semaphore(1)  # Nominatim: 1 request per second

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

async def service_llm(prompt: str, client: AsyncGroq) -> dict:
    async with LLM_SEMA:
        await asyncio.sleep(2.1) # Respect Free Tier 30 RPM
        try:
            completion = await client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=GROQ_MODEL,
                response_format={"type": "json_object"},
                temperature=0.1
            )
            return {
                **json.loads(completion.choices[0].message.content),
                '_model': GROQ_MODEL,
                '_ts': datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            return {"_error": str(e)}

async def service_geocoding(place, district, state, country, client: httpx.AsyncClient):
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

async def process_service_layers(post: dict, force: bool, http_client: httpx.AsyncClient, groq_client: AsyncGroq):
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
        llm = await service_llm(prompt, groq_client)
        save_json_file(l_path, llm)

    # 4. Layer: Geocoding (Placement)
    g_path = adir / 'geocoding.json'
    geo = load_json_file(g_path) if not force else None
    if not geo or geo.get('lat') is None:
        if wiki and wiki.get('lat') is not None:
            geo = {'lat': wiki['lat'], 'lng': wiki['lon'], 'source': 'wikipedia', 'level': 'place', 'ts': datetime.now(timezone.utc).isoformat()}
        else:
            loc = llm.get('location') or {}
            geo = await service_geocoding(loc.get('place_name'), loc.get('district'), loc.get('state'), loc.get('country'), http_client)
        if geo: save_json_file(g_path, geo)

    # 5. Synthesis
    unified = {
        'metadata': meta,
        'wikipedia': wiki,
        'llm': llm,
        'geocoding': geo,
        'ts_end': datetime.now(timezone.utc).isoformat()
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
    
    posts = raw['posts']
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
        api_key = os.environ.get('GROQ_API_KEY')
        headers = {'User-Agent': NOMINATIM_UA}
        async with httpx.AsyncClient(headers=headers) as http_client, AsyncGroq(api_key=api_key) as groq_client:
            tasks = [process_service_layers(p, args.force, http_client, groq_client) for p in to_process]
            results = await asyncio.gather(*tasks)
            for pid, res in results:
                emap[pid] = res

    # Final merge
    for p in posts:
        u = emap.get(p['id'])
        if not u: continue
        
        wiki = u.get('wikipedia') or {}
        en   = u.get('llm') or {}
        geo  = u.get('geocoding') or {}
        loc  = en.get('location') or {}
        
        dyn = en.get('dynasties') or en.get('dynasty')
        if isinstance(dyn, str): dyn = [d.strip() for d in dyn.split(',')]
        if not isinstance(dyn, list): dyn = []

        etags = set(p.get('hashtags') or [])
        ltags = [t for t in (en.get('tags') or []) if t not in etags]

        p.update({
            'enriched': True,
            'temple_name': en.get('temple_name'),
            'alternate_names': en.get('alternate_names') or [],
            'deity': en.get('deity'),
            'dynasty': ", ".join(dyn) if dyn else None,
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

    with open(ENRICHED_JSON, 'w', encoding='utf-8') as f:
        json.dump({**raw, 'posts': posts}, f, ensure_ascii=False, indent=2)
    with open(SITE_DATA, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)
    
    sync_archive_config(SITE_DATA, ARCHIVE_CONFIG)
    ts_log("Done.")

if __name__ == '__main__':
    asyncio.run(main())
