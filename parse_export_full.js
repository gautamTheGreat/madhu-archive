/**
 * parse_export_full.js
 *
 * Comprehensive Facebook export parser.
 * Extracts EVERY available field from all source files and produces
 * a rich `posts_full.json` alongside separate collections for:
 *   - albums
 *   - uncategorized photos
 *   - videos
 *   - edit history
 *   - share links
 *   - check-ins / places
 *   - per-photo EXIF data
 *
 * Output: code/src/data/posts_full.json
 */

const fs   = require('fs');
const path = require('path');

// ─── Paths ───────────────────────────────────────────────────────────────────

const fbPath        = path.join(__dirname, 'fb_export');
const postsDir      = path.join(fbPath, 'posts');
const albumDir      = path.join(postsDir, 'album');
const publicMedia   = path.join(__dirname, 'code', 'public', 'media');
const outputDir     = path.join(__dirname, 'code', 'src', 'data');
const outputPath    = path.join(outputDir, 'posts_full.json');

fs.mkdirSync(publicMedia, { recursive: true });
fs.mkdirSync(outputDir,   { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[${ts()}] ${msg}`); }
function warn(msg) { console.warn(`[${ts()}] ⚠  ${msg}`); }
function ts()      { return new Date().toLocaleTimeString('en-IN', { hour12: false }); }

/**
 * Fix Facebook Mojibake: UTF-8 bytes stored as Latin-1 codepoints.
 */
function fixEncoding(str) {
  if (!str || typeof str !== 'string') return str;
  try { return Buffer.from(str, 'binary').toString('utf8'); }
  catch { return str; }
}

/** Recursively fix all string values in an object/array. */
function fixObj(val) {
  if (typeof val === 'string') return fixEncoding(val);
  if (Array.isArray(val))     return val.map(fixObj);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = fixObj(v);
    return out;
  }
  return val;
}

/** Read + parse a JSON file, applying encoding fix to all strings. */
function readJson(filePath) {
  if (!fs.existsSync(filePath)) { warn(`File not found: ${filePath}`); return null; }
  const raw = fs.readFileSync(filePath, 'utf8');
  return fixObj(JSON.parse(raw));
}

/** Extract hashtags from a text string. */
function extractHashtags(text) {
  if (!text) return [];
  return [...new Set((text.match(/#[\w\u0B80-\u0BFF\u0900-\u097F\u0C00-\u0C7F]+/g) || []))];
}

/**
 * Copy a media file from the export to public/media.
 * Returns the public URL path (/media/filename) or null if not found.
 */
function copyMedia(originalUri) {
  if (!originalUri) return null;
  const relative  = originalUri
    .replace(/^(your|this_profile's)_activity_across_facebook\//, '');
  const src  = path.join(fbPath, relative);
  const name = path.basename(originalUri);
  const dest = path.join(publicMedia, name);
  if (fs.existsSync(src)) {
    try { fs.copyFileSync(src, dest); return `/media/${name}`; }
    catch (e) { warn(`Copy failed: ${src} → ${e.message}`); return null; }
  }
  warn(`Media not found: ${src}`);
  return null;
}

/** Determine whether a URI is a video. */
function isVideo(uri) {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(uri || '');
}

/** Build Facebook post/photo URL from fbid (best-effort). */
function fbUrl(fbid) {
  if (!fbid) return null;
  return `https://www.facebook.com/photo/?fbid=${fbid}`;
}

// ─── 1. Load & index edit history ────────────────────────────────────────────

log('Loading edit history...');
const editsRaw   = readJson(path.join(postsDir, 'edits_you_made_to_posts.json')) || [];
const editsByFbid = {};
for (const edit of editsRaw) {
  if (!edit.fbid) continue;
  const text = edit.label_values?.find(lv => lv.label === 'Text')?.value || '';
  editsByFbid[edit.fbid] = {
    editedAt:  edit.timestamp ? new Date(edit.timestamp * 1000).toISOString() : null,
    editedText: text,
  };
}
log(`  Loaded ${Object.keys(editsByFbid).length} edit records.`);

// ─── 2. Load uncategorized photos → index by URI ─────────────────────────────

log('Loading uncategorized photos...');
const uncatRaw    = readJson(path.join(postsDir, 'uncategorized_photos.json'));
const uncatPhotos = uncatRaw?.other_photos_v2 || [];
const uncatByUri  = {};
for (const p of uncatPhotos) {
  if (p.uri) uncatByUri[p.uri] = p;
}
log(`  Indexed ${Object.keys(uncatByUri).length} uncategorized photos.`);

// ─── 3. Load videos → index by URI ───────────────────────────────────────────

log('Loading videos...');
const videosRaw   = readJson(path.join(postsDir, 'videos.json'));
const videosList  = videosRaw?.videos_v2 || [];
const videosByUri = {};
for (const v of videosList) {
  if (v.uri) videosByUri[v.uri] = v;
}
log(`  Indexed ${Object.keys(videosByUri).length} videos.`);

// ─── 4. Load share links ──────────────────────────────────────────────────────

log('Loading share links...');
const shareLinksRaw = readJson(path.join(postsDir, 'content_sharing_links_you_have_created.json')) || [];
const shareLinksByFbid = {};
for (const sl of shareLinksRaw) {
  if (!sl.fbid) continue;
  const urls = (sl.label_values || [])
    .filter(lv => lv.label === 'URL' && lv.href)
    .map(lv => lv.href);
  shareLinksByFbid[sl.fbid] = {
    sharedAt: sl.timestamp ? new Date(sl.timestamp * 1000).toISOString() : null,
    urls: [...new Set(urls)],
  };
}
log(`  Loaded ${Object.keys(shareLinksByFbid).length} share link records.`);

// ─── 5. Load check-ins / places ──────────────────────────────────────────────

log('Loading check-ins...');
const checkInsRaw = readJson(path.join(postsDir, 'places_you_have_been_tagged_in.json')) || [];
const checkIns = checkInsRaw.map(ci => {
  const visitTs = ci.label_values?.find(lv => lv.label === 'Visit time')?.timestamp_value;
  const place   = ci.label_values?.find(lv => lv.label === 'Place name')?.value || '';
  return {
    fbid:      ci.fbid || null,
    place,
    visitedAt: visitTs ? new Date(visitTs * 1000).toISOString() : null,
  };
});
log(`  Loaded ${checkIns.length} check-ins.`);

// ─── 6. Load albums ───────────────────────────────────────────────────────────

log('Loading albums...');
const albums = [];
if (fs.existsSync(albumDir)) {
  const albumFiles = fs.readdirSync(albumDir).filter(f => f.endsWith('.json'));
  for (const af of albumFiles) {
    const data = readJson(path.join(albumDir, af));
    if (!data) continue;
    const photos = (data.photos || []).map(p => {
      const exif = p.media_metadata?.photo_metadata?.exif_data?.[0] || {};
      const publicUrl = copyMedia(p.uri);
      return {
        uri:            p.uri || null,
        publicUrl,
        title:          p.title || null,
        description:    p.description || null,
        createdAt:      p.creation_timestamp ? new Date(p.creation_timestamp * 1000).toISOString() : null,
        takenAt:        exif.taken_timestamp  ? new Date(exif.taken_timestamp * 1000).toISOString() : null,
        exif: {
          camera_make:   exif.camera_make   || null,
          camera_model:  exif.camera_model  || null,
          iso:           exif.iso           ?? null,
          focal_length:  exif.focal_length  || null,
          exposure:      exif.exposure      || null,
          f_stop:        exif.f_stop        || null,
          orientation:   exif.orientation   ?? null,
          upload_ip:     exif.upload_ip     || null,
          modified_at:   exif.modified_timestamp ? new Date(exif.modified_timestamp * 1000).toISOString() : null,
        },
      };
    });

    const coverExif = data.cover_photo?.media_metadata?.photo_metadata?.exif_data?.[0] || {};
    albums.push({
      name:          data.name || null,
      description:   data.description || null,
      lastModified:  data.last_modified_timestamp ? new Date(data.last_modified_timestamp * 1000).toISOString() : null,
      coverPhoto: data.cover_photo ? {
        uri:       data.cover_photo.uri || null,
        publicUrl: copyMedia(data.cover_photo.uri),
        createdAt: data.cover_photo.creation_timestamp ? new Date(data.cover_photo.creation_timestamp * 1000).toISOString() : null,
        takenAt:   coverExif.taken_timestamp ? new Date(coverExif.taken_timestamp * 1000).toISOString() : null,
      } : null,
      photoCount: photos.length,
      photos,
    });
    log(`  Album "${data.name || af}": ${photos.length} photos`);
  }
}
log(`  Total albums: ${albums.length}`);

// ─── 7. Parse main profile posts ─────────────────────────────────────────────

log('');
log('Parsing main profile posts...');
const postsFilePath = path.join(postsDir, 'profile_posts_1.json');
if (!fs.existsSync(postsFilePath)) {
  console.error(`ERROR: ${postsFilePath} not found. Aborting.`);
  process.exit(1);
}

const rawPosts = readJson(postsFilePath);
log(`Found ${rawPosts.length} raw entries. Processing...`);
console.log('');

const parsedPosts = [];
let skipped = 0, mediaFound = 0, mediaMissing = 0;
let postsWithExif = 0, postsWithEdits = 0, postsWithShares = 0;

rawPosts.forEach((item, index) => {
  if (index > 0 && index % 100 === 0) {
    const pct = Math.round(index / rawPosts.length * 100);
    log(`  ${index}/${rawPosts.length} (${pct}%) — kept ${parsedPosts.length}`);
  }

  const timestamp = item.timestamp || 0;
  const fbid      = item.fbid || null;

  // ── Post text ──────────────────────────────────────────────────────────────
  let textContent = '';
  if (item.data && Array.isArray(item.data)) {
    const textObj = item.data.find(d => d.post);
    if (textObj) textContent = textObj.post;
  }

  const title    = item.title || '';
  const hashtags = extractHashtags(textContent);

  // ── Media attachments ──────────────────────────────────────────────────────
  const mediaItems = [];

  if (item.attachments && Array.isArray(item.attachments)) {
    item.attachments.forEach(att => {
      if (!att.data || !Array.isArray(att.data)) return;

      att.data.forEach(d => {

        // ── Embedded media (image / video) ─────────────────────────────────
        if (d.media && d.media.uri) {
          const uri       = d.media.uri;
          const publicUrl = copyMedia(uri);
          if (publicUrl) mediaFound++; else mediaMissing++;

          // Enrich with per-media metadata from dedicated files
          const videoMeta = videosByUri[uri]        || {};
          const uncatMeta = uncatByUri[uri]         || {};

          const rawExif   = d.media.media_metadata?.photo_metadata?.exif_data?.[0]
                         || d.media.media_metadata?.video_metadata?.exif_data?.[0]
                         || uncatMeta.media_metadata?.photo_metadata?.exif_data?.[0]
                         || {};

          const hasExif = !!(rawExif.camera_make || rawExif.iso || rawExif.focal_length);
          if (hasExif) postsWithExif++;

          const mediaEntry = {
            type:        isVideo(uri) ? 'video' : 'photo',
            uri,
            publicUrl,

            // Titles / captions can appear at multiple levels
            title:       fixEncoding(d.media.title)       || fixEncoding(videoMeta.title)   || null,
            description: fixEncoding(d.media.description) || fixEncoding(videoMeta.description)
                           || fixEncoding(uncatMeta.description) || null,

            createdAt:   d.media.creation_timestamp
                           ? new Date(d.media.creation_timestamp * 1000).toISOString() : null,

            takenAt:     rawExif.taken_timestamp
                           ? new Date(rawExif.taken_timestamp * 1000).toISOString() : null,

            fbUrl: fbUrl(d.media.id || null),

            exif: hasExif ? {
              camera_make:   rawExif.camera_make    || null,
              camera_model:  rawExif.camera_model   || null,
              iso:           rawExif.iso             ?? null,
              focal_length:  rawExif.focal_length    || null,
              exposure:      rawExif.exposure        || null,
              f_stop:        rawExif.f_stop          || null,
              orientation:   rawExif.orientation     ?? null,
              upload_ip:     rawExif.upload_ip       || null,
              modified_at:   rawExif.modified_timestamp
                               ? new Date(rawExif.modified_timestamp * 1000).toISOString() : null,
            } : null,
          };

          mediaItems.push(mediaEntry);

        // ── External link ──────────────────────────────────────────────────
        } else if (d.external_context?.url?.trim()) {
          mediaItems.push({
            type:  'external_link',
            url:   d.external_context.url.trim(),
            name:  d.external_context.name  || null,
            source: d.external_context.source || null,
          });
        }
      });
    });
  }

  // ── Skip fully empty posts ─────────────────────────────────────────────────
  if (!textContent && mediaItems.length === 0 && !title) {
    skipped++;
    return;
  }

  // ── Edit history ───────────────────────────────────────────────────────────
  const editRecord = fbid ? editsByFbid[fbid] : null;
  if (editRecord) postsWithEdits++;

  // ── Share links ────────────────────────────────────────────────────────────
  const shareRecord = fbid ? shareLinksByFbid[fbid] : null;
  if (shareRecord) postsWithShares++;

  parsedPosts.push({
    // ── Identity ──────────────────────────────────────────────────────────────
    id:        `post_${timestamp}_${index}`,
    fbid,
    fbUrl:     fbid
      ? `https://www.facebook.com/madhujagdhishsculptureenthusiast/posts/${fbid}`
      : null,

    // ── Timestamps ────────────────────────────────────────────────────────────
    timestamp,
    date:      new Date(timestamp * 1000).toISOString(),

    // ── Content ───────────────────────────────────────────────────────────────
    title,
    content:   textContent,
    hashtags,

    // ── Media ─────────────────────────────────────────────────────────────────
    media:     mediaItems,
    mediaCount: mediaItems.filter(m => m.type !== 'external_link').length,

    // ── Edit history ──────────────────────────────────────────────────────────
    editHistory: editRecord || null,

    // ── Share links ───────────────────────────────────────────────────────────
    shareLinks: shareRecord || null,
  });
});

// Sort newest first
parsedPosts.sort((a, b) => b.timestamp - a.timestamp);

// ─── 8. Assemble full output ──────────────────────────────────────────────────

const output = {
  meta: {
    generatedAt:  new Date().toISOString(),
    sourceFolder: fbPath,
    totalPosts:   parsedPosts.length,
    totalSkipped: skipped,
    totalAlbums:  albums.length,
    totalVideos:  videosList.length,
    totalCheckIns: checkIns.length,
    totalShareLinks: shareLinksRaw.length,
    totalEditRecords: editsRaw.length,
  },
  posts:      parsedPosts,
  albums,
  videos:     videosList.map(v => {
    const exif = v.media_metadata?.video_metadata?.exif_data?.[0] || {};
    return {
      uri:         v.uri,
      publicUrl:   copyMedia(v.uri),
      title:       v.title       || null,
      description: v.description || null,
      createdAt:   v.creation_timestamp ? new Date(v.creation_timestamp * 1000).toISOString() : null,
      exif: {
        upload_ip:        exif.upload_ip       || null,
        upload_timestamp: exif.upload_timestamp
          ? new Date(exif.upload_timestamp * 1000).toISOString() : null,
      },
    };
  }),
  checkIns,
  shareLinks: shareLinksRaw.map(sl => ({
    fbid: sl.fbid,
    sharedAt: sl.timestamp ? new Date(sl.timestamp * 1000).toISOString() : null,
    urls: [...new Set((sl.label_values || []).filter(lv => lv.href).map(lv => lv.href))],
  })),
};

// ─── 9. Write output ─────────────────────────────────────────────────────────

console.log('');
log('Writing posts_full.json...');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);

// ─── 10. Summary ─────────────────────────────────────────────────────────────

console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  Full parse complete! Summary:');
console.log('══════════════════════════════════════════════════════');
console.log(`  Posts parsed         : ${parsedPosts.length}`);
console.log(`  Posts skipped        : ${skipped} (empty)`);
console.log(`  Media files copied   : ${mediaFound}`);
console.log(`  Media missing        : ${mediaMissing}`);
console.log(`  Posts with EXIF data : ${postsWithExif}`);
console.log(`  Posts with edits     : ${postsWithEdits}`);
console.log(`  Posts with shares    : ${postsWithShares}`);
console.log(`  Albums processed     : ${albums.length}`);
console.log(`  Videos indexed       : ${videosList.length}`);
console.log(`  Check-ins            : ${checkIns.length}`);
console.log(`  Share links          : ${shareLinksRaw.length}`);
console.log(`  Edit records         : ${editsRaw.length}`);
console.log(`  Output size          : ${sizeKB} KB`);
console.log(`  Saved to             : ${outputPath}`);
console.log('══════════════════════════════════════════════════════');
console.log('');
console.log('  Top-level keys in posts_full.json:');
console.log('    meta         — generation stats');
console.log('    posts[]      — all posts with full media/EXIF/edit/share data');
console.log('    albums[]     — named albums with per-photo metadata');
console.log('    videos[]     — all standalone videos');
console.log('    checkIns[]   — places you were tagged at');
console.log('    shareLinks[] — share links created');
console.log('══════════════════════════════════════════════════════');
