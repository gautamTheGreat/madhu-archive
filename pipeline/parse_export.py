#!/usr/bin/env python3
"""
parse_export.py

Full Python port of parse_export_full.js.

Reads the Facebook export, extracts all metadata, copies media files to
code/public/media/, and writes pipeline/output/posts_raw.json.

Optimisations:
  - All media URIs are collected and deduplicated upfront, then copied in one
    parallel batch using ThreadPoolExecutor (I/O-bound, benefits from threads).
  - Side-tables (edits, videos, uncategorised photos, share links) are indexed
    into dicts for O(1) lookup during post construction.
  - Mojibake fixed once at load time via fix_obj() which walks the entire tree.

Run from anywhere:
    python pipeline/parse_export.py
"""

import json
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────

PIPELINE_DIR = Path(__file__).parent
ROOT         = PIPELINE_DIR.parent          # madhu-site/
FB           = ROOT / 'fb_export'
POSTS_DIR    = FB / 'posts'
ALBUM_DIR    = POSTS_DIR / 'album'
PUBLIC_MEDIA = ROOT / 'code' / 'public' / 'media'
OUTPUT_DIR   = PIPELINE_DIR / 'output'
OUTPUT_PATH  = OUTPUT_DIR / 'posts_raw.json'

PUBLIC_MEDIA.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def ts_log(msg: str) -> None:
    t = datetime.now().strftime('%H:%M:%S')
    print(f'[{t}] {msg}', flush=True)


def fix_encoding(s: str) -> str:
    """
    Reverse Facebook Mojibake: UTF-8 byte sequences stored as Latin-1
    codepoints.  e.g. 'à®¤à®®à®¿à®´à¯' → 'தமிழ்'
    Falls back to the original string if decoding fails.
    """
    if not isinstance(s, str):
        return s
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def fix_obj(val):
    """Recursively apply fix_encoding to every string in a JSON structure."""
    if isinstance(val, str):
        return fix_encoding(val)
    if isinstance(val, list):
        return [fix_obj(v) for v in val]
    if isinstance(val, dict):
        return {k: fix_obj(v) for k, v in val.items()}
    return val


def read_json(path: Path):
    """Load a JSON file, applying Mojibake fix to all strings. Returns None if missing."""
    if not path.exists():
        ts_log(f'⚠  File not found: {path}')
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return fix_obj(json.load(f))


def extract_hashtags(text: str) -> list:
    """Extract unique hashtags including ASCII and Indic scripts."""
    if not text:
        return []
    tags = re.findall(r'#[\w\u0B80-\u0BFF\u0900-\u097F\u0C00-\u0C7F]+', text)
    return list(dict.fromkeys(tags))   # deduplicate, preserve order


def iso(ts) -> str | None:
    """Convert a Unix timestamp (int/float) to ISO-8601 UTC string."""
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def is_video(uri: str) -> bool:
    return bool(re.search(r'\.(mp4|mov|avi|mkv|webm)$', uri or '', re.IGNORECASE))


def fb_photo_url(fbid) -> str | None:
    return f'https://www.facebook.com/photo/?fbid={fbid}' if fbid else None


def strip_fb_prefix(uri: str) -> str:
    """Remove the Facebook activity path prefix to get a relative path."""
    return re.sub(r"^(your|this_profile's)_activity_across_facebook/", '', uri)


def safe_get(d: dict, *keys):
    """Safely navigate a nested dict without raising KeyError."""
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def first_exif(*media_dicts) -> dict:
    """
    Return the first non-empty EXIF block found across multiple media dicts.
    Checks both photo_metadata and video_metadata within each dict.
    """
    for md in media_dicts:
        mm = (md or {}).get('media_metadata') or {}
        for key in ('photo_metadata', 'video_metadata'):
            exif_list = (mm.get(key) or {}).get('exif_data') or []
            if exif_list and isinstance(exif_list, list):
                first = exif_list[0]
                if isinstance(first, dict) and first:
                    return first
    return {}


# ──────────────────────────────────────────────────────────────────────────────
# Media copy worker (used in ThreadPoolExecutor)
# ──────────────────────────────────────────────────────────────────────────────

def resolve_and_copy(uri: str) -> tuple:
    """
    Copy a media file from the FB export to public/media/.
    Returns (uri, public_url_or_none, found: bool).
    Called in parallel threads — only shutil.copy2 and path ops, thread-safe.
    """
    relative = strip_fb_prefix(uri)
    src  = FB / relative
    name = Path(uri).name
    dest = PUBLIC_MEDIA / name

    if src.exists():
        try:
            shutil.copy2(src, dest)
            return uri, f'/media/{name}', True
        except OSError as e:
            ts_log(f'⚠  Copy failed: {src} → {e}')
            return uri, None, False
    return uri, None, False


# ──────────────────────────────────────────────────────────────────────────────
# 1. Load side-tables
# ──────────────────────────────────────────────────────────────────────────────

ts_log('Loading edit history...')
edits_raw     = read_json(POSTS_DIR / 'edits_you_made_to_posts.json') or []
edits_by_fbid = {}
for edit in edits_raw:
    fbid = edit.get('fbid')
    if not fbid:
        continue
    text = next(
        (lv['value'] for lv in (edit.get('label_values') or []) if lv.get('label') == 'Text'),
        ''
    )
    edits_by_fbid[fbid] = {
        'editedAt':   iso(edit.get('timestamp')),
        'editedText': text,
    }
ts_log(f'  Loaded {len(edits_by_fbid)} edit records.')

ts_log('Loading uncategorised photos...')
uncat_raw    = read_json(POSTS_DIR / 'uncategorized_photos.json') or {}
uncat_by_uri = {
    p['uri']: p
    for p in (uncat_raw.get('other_photos_v2') or [])
    if p.get('uri')
}
ts_log(f'  Indexed {len(uncat_by_uri)} uncategorised photos.')

ts_log('Loading videos...')
videos_raw    = read_json(POSTS_DIR / 'videos.json') or {}
videos_list   = videos_raw.get('videos_v2') or []
videos_by_uri = {v['uri']: v for v in videos_list if v.get('uri')}
ts_log(f'  Indexed {len(videos_by_uri)} videos.')

ts_log('Loading share links...')
share_raw      = read_json(POSTS_DIR / 'content_sharing_links_you_have_created.json') or []
shares_by_fbid = {}
for sl in share_raw:
    fbid = sl.get('fbid')
    if not fbid:
        continue
    urls = list({lv['href'] for lv in (sl.get('label_values') or []) if lv.get('href')})
    shares_by_fbid[fbid] = {
        'sharedAt': iso(sl.get('timestamp')),
        'urls': urls,
    }
ts_log(f'  Loaded {len(shares_by_fbid)} share link records.')

ts_log('Loading check-ins...')
check_raw = read_json(POSTS_DIR / 'places_you_have_been_tagged_in.json') or []
check_ins = []
for ci in check_raw:
    lvs      = ci.get('label_values') or []
    visit_ts = next((lv.get('timestamp_value') for lv in lvs if lv.get('label') == 'Visit time'), None)
    place    = next((lv.get('value', '') for lv in lvs if lv.get('label') == 'Place name'), '')
    check_ins.append({
        'fbid':      ci.get('fbid'),
        'place':     place,
        'visitedAt': iso(visit_ts),
    })
ts_log(f'  Loaded {len(check_ins)} check-ins.')

# ──────────────────────────────────────────────────────────────────────────────
# 2. Read main posts JSON
# ──────────────────────────────────────────────────────────────────────────────

ts_log('')
ts_log('Parsing main profile posts...')
posts_file = POSTS_DIR / 'profile_posts_1.json'
if not posts_file.exists():
    print(f'ERROR: {posts_file} not found. Aborting.', file=sys.stderr)
    sys.exit(1)
raw_posts = read_json(posts_file)
ts_log(f'Found {len(raw_posts)} raw entries.')
print()

# ──────────────────────────────────────────────────────────────────────────────
# 3. Collect ALL media URIs upfront and copy in one parallel batch
#    Sources: post attachments + standalone videos + album photos + covers
# ──────────────────────────────────────────────────────────────────────────────

ts_log('Scanning all media URIs...')
all_uris: set = set()

# From posts
for item in raw_posts:
    for att in (item.get('attachments') or []):
        for d in (att.get('data') or []):
            uri = safe_get(d, 'media', 'uri')
            if uri:
                all_uris.add(uri)

# From standalone videos
for v in videos_list:
    if v.get('uri'):
        all_uris.add(v['uri'])

# From albums (photos + cover photos)
album_data_store = []   # store parsed album data for use later
if ALBUM_DIR.exists():
    for af in sorted(ALBUM_DIR.glob('*.json')):
        data = read_json(af)
        if not data:
            continue
        album_data_store.append((af, data))
        for p in (data.get('photos') or []):
            if p.get('uri'):
                all_uris.add(p['uri'])
        if safe_get(data, 'cover_photo', 'uri'):
            all_uris.add(data['cover_photo']['uri'])

ts_log(f'Found {len(all_uris)} unique media files. Copying in parallel...')

# Parallel copy
uri_to_public: dict = {}
media_found   = 0
media_missing = 0
total_uris    = len(all_uris)

with ThreadPoolExecutor(max_workers=20) as pool:
    futures = {pool.submit(resolve_and_copy, uri): uri for uri in all_uris}
    done = 0
    for fut in as_completed(futures):
        uri, pub, found = fut.result()
        uri_to_public[uri] = pub
        if found:
            media_found += 1
        else:
            media_missing += 1
        done += 1
        if done % 500 == 0 or done == total_uris:
            pct = round(done / total_uris * 100)
            ts_log(f'  Media copy: {done}/{total_uris} ({pct}%) — '
                   f'{media_found} copied, {media_missing} missing')

ts_log(f'Media copy complete: {media_found} copied, {media_missing} missing.')
print()

# ──────────────────────────────────────────────────────────────────────────────
# 4. Build post objects
# ──────────────────────────────────────────────────────────────────────────────

ts_log('Building post objects...')
parsed_posts      = []
skipped           = 0
posts_with_exif   = 0
posts_with_edits  = 0
posts_with_shares = 0

for index, item in enumerate(raw_posts):
    if index > 0 and index % 200 == 0:
        pct = round(index / len(raw_posts) * 100)
        ts_log(f'  {index}/{len(raw_posts)} ({pct}%) — kept {len(parsed_posts)}')

    timestamp = item.get('timestamp', 0)
    fbid      = item.get('fbid')

    # ── Text content ──
    text_content = ''
    for d in (item.get('data') or []):
        if d.get('post'):
            text_content = d['post']
            break

    title    = item.get('title', '')
    hashtags = extract_hashtags(text_content)

    # ── Media items ──
    media_items = []
    for att in (item.get('attachments') or []):
        for d in (att.get('data') or []):

            # ── Embedded image / video ──
            uri = safe_get(d, 'media', 'uri')
            if uri:
                m          = d['media']
                pub        = uri_to_public.get(uri)
                vid_meta   = videos_by_uri.get(uri,  {})
                uncat_meta = uncat_by_uri.get(uri, {})
                exif       = first_exif(m, uncat_meta)
                has_exif   = bool(
                    exif.get('camera_make') or
                    exif.get('iso') or
                    exif.get('focal_length')
                )
                if has_exif:
                    posts_with_exif += 1

                media_items.append({
                    'type':        'video' if is_video(uri) else 'photo',
                    'uri':         uri,
                    'publicUrl':   pub,
                    'title':       m.get('title')       or vid_meta.get('title'),
                    'description': (m.get('description') or
                                    vid_meta.get('description') or
                                    uncat_meta.get('description')),
                    'createdAt':   iso(m.get('creation_timestamp')),
                    'takenAt':     iso(exif.get('taken_timestamp')),
                    'fbUrl':       fb_photo_url(m.get('id')),
                    'exif': {
                        'camera_make':  exif.get('camera_make'),
                        'camera_model': exif.get('camera_model'),
                        'iso':          exif.get('iso'),
                        'focal_length': exif.get('focal_length'),
                        'exposure':     exif.get('exposure'),
                        'f_stop':       exif.get('f_stop'),
                        'orientation':  exif.get('orientation'),
                    } if has_exif else None,
                })

            # ── External link ──
            elif safe_get(d, 'external_context', 'url'):
                ec  = d['external_context']
                url = ec['url'].strip()
                if url:
                    media_items.append({
                        'type':   'external_link',
                        'url':    url,
                        'name':   ec.get('name'),
                        'source': ec.get('source'),
                    })

    # ── Skip fully empty posts ──
    if not text_content and not media_items and not title:
        skipped += 1
        continue

    # ── Edit / share records ──
    edit_record  = edits_by_fbid.get(fbid)  if fbid else None
    share_record = shares_by_fbid.get(fbid) if fbid else None
    if edit_record:  posts_with_edits  += 1
    if share_record: posts_with_shares += 1

    post_id = f'post_{timestamp}_{index}'

    parsed_posts.append({
        # Identity
        'id':     post_id,
        'fbid':   fbid,
        'fbUrl':  (f'https://www.facebook.com/madhujagdhishsculptureenthusiast/posts/{fbid}'
                   if fbid else None),

        # Timestamps
        'timestamp': timestamp,
        'date':      iso(timestamp),

        # Content
        'title':    title,
        'content':  text_content,
        'hashtags': hashtags,

        # Media
        'media':      media_items,
        'mediaCount': sum(1 for m in media_items if m['type'] != 'external_link'),

        # Related records
        'editHistory': edit_record,
        'shareLinks':  share_record,

        # LLM enrichment placeholders (populated by enrich_posts.py)
        'enriched':             False,
        'temple_name':          None,
        'alternate_names':      [],
        'deity':                None,
        'dynasty':              None,
        'architectural_style':  None,
        'historical_period':    None,
        'construction_duration': None,
        'location':             None,
        'summary':              None,
        'tags':                 hashtags[:],   # starts as raw hashtags
        'confidence':           None,
    })

# Sort newest first
parsed_posts.sort(key=lambda p: p['timestamp'], reverse=True)
ts_log(f'Post objects built: {len(parsed_posts)} kept, {skipped} skipped.')
print()

# ──────────────────────────────────────────────────────────────────────────────
# 5. Build album objects (using pre-copied URIs)
# ──────────────────────────────────────────────────────────────────────────────

ts_log('Building album objects...')
albums = []
for af, data in album_data_store:
    photos = []
    for p in (data.get('photos') or []):
        uri  = p.get('uri')
        exif = first_exif(p)
        photos.append({
            'uri':         uri,
            'publicUrl':   uri_to_public.get(uri) if uri else None,
            'title':       p.get('title'),
            'description': p.get('description'),
            'createdAt':   iso(p.get('creation_timestamp')),
            'takenAt':     iso(exif.get('taken_timestamp')),
            'exif': {
                'camera_make':  exif.get('camera_make'),
                'camera_model': exif.get('camera_model'),
                'iso':          exif.get('iso'),
                'focal_length': exif.get('focal_length'),
                'exposure':     exif.get('exposure'),
                'f_stop':       exif.get('f_stop'),
                'orientation':  exif.get('orientation'),
            },
        })

    cover     = data.get('cover_photo') or {}
    cover_uri = cover.get('uri')
    cover_exif = first_exif(cover)

    albums.append({
        'name':         data.get('name'),
        'description':  data.get('description'),
        'lastModified': iso(data.get('last_modified_timestamp')),
        'coverPhoto': {
            'uri':       cover_uri,
            'publicUrl': uri_to_public.get(cover_uri) if cover_uri else None,
            'createdAt': iso(cover.get('creation_timestamp')),
            'takenAt':   iso(cover_exif.get('taken_timestamp')),
        } if cover_uri else None,
        'photoCount': len(photos),
        'photos':     photos,
    })
    ts_log(f'  Album "{data.get("name", af.name)}": {len(photos)} photos')

ts_log(f'  Total albums: {len(albums)}')

# ──────────────────────────────────────────────────────────────────────────────
# 6. Build standalone video objects
# ──────────────────────────────────────────────────────────────────────────────

videos_output = []
for v in videos_list:
    uri  = v.get('uri')
    exif = first_exif(v)
    videos_output.append({
        'uri':         uri,
        'publicUrl':   uri_to_public.get(uri) if uri else None,
        'title':       v.get('title'),
        'description': v.get('description'),
        'createdAt':   iso(v.get('creation_timestamp')),
        'exif': {
            'upload_ip':        exif.get('upload_ip'),
            'upload_timestamp': iso(exif.get('upload_timestamp')),
        },
    })

# ──────────────────────────────────────────────────────────────────────────────
# 7. Assemble and write output
# ──────────────────────────────────────────────────────────────────────────────

output = {
    'meta': {
        'generatedAt':      datetime.now(timezone.utc).isoformat(),
        'sourceFolder':     str(FB),
        'totalPosts':       len(parsed_posts),
        'totalSkipped':     skipped,
        'totalAlbums':      len(albums),
        'totalVideos':      len(videos_list),
        'totalCheckIns':    len(check_ins),
        'totalShareLinks':  len(share_raw),
        'totalEditRecords': len(edits_raw),
    },
    'posts':      parsed_posts,
    'albums':     albums,
    'videos':     videos_output,
    'checkIns':   check_ins,
    'shareLinks': [
        {
            'fbid':     sl.get('fbid'),
            'sharedAt': iso(sl.get('timestamp')),
            'urls':     list({lv['href'] for lv in (sl.get('label_values') or []) if lv.get('href')}),
        }
        for sl in share_raw
    ],
}

ts_log(f'Writing {OUTPUT_PATH} ...')
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

size_kb = OUTPUT_PATH.stat().st_size // 1024

print()
print('══════════════════════════════════════════')
print('  Parse complete! Summary:')
print('══════════════════════════════════════════')
print(f'  Posts parsed         : {len(parsed_posts)}')
print(f'  Posts skipped        : {skipped} (empty)')
print(f'  Media files copied   : {media_found}')
print(f'  Media missing        : {media_missing}')
print(f'  Posts with EXIF data : {posts_with_exif}')
print(f'  Posts with edits     : {posts_with_edits}')
print(f'  Posts with shares    : {posts_with_shares}')
print(f'  Albums processed     : {len(albums)}')
print(f'  Videos indexed       : {len(videos_list)}')
print(f'  Check-ins            : {len(check_ins)}')
print(f'  Share links          : {len(share_raw)}')
print(f'  Output size          : {size_kb} KB')
print(f'  Saved to             : {OUTPUT_PATH}')
print('══════════════════════════════════════════')
