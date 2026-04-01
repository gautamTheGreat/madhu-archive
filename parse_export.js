const fs = require('fs');
const path = require('path');

const fbPath = path.join(__dirname, 'fb_export');
const publicMediaDir = path.join(__dirname, 'code', 'public', 'media');
const outputDataPath = path.join(__dirname, 'code', 'src', 'data', 'posts.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Facebook exports non-ASCII text (Tamil, Devanagari, etc.) with Mojibake:
 * UTF-8 bytes are stored as individual Latin-1 Unicode code points.
 * This reverses it: re-encodes the string as Latin-1 bytes, then decodes as UTF-8.
 * If the result is still garbled or throws, the original string is returned.
 */
function fixEncoding(str) {
  if (!str || typeof str !== 'string') return str;
  try {
    const fixed = Buffer.from(str, 'binary').toString('utf8');
    return fixed;
  } catch (e) {
    return str;
  }
}

function log(msg) {
  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// ─── Setup ──────────────────────────────────────────────────────────────────

log('Setting up output directories...');
fs.mkdirSync(publicMediaDir, { recursive: true });
fs.mkdirSync(path.dirname(outputDataPath), { recursive: true });
log(`  Media output  : ${publicMediaDir}`);
log(`  JSON output   : ${outputDataPath}`);

// ─── Main Parser ─────────────────────────────────────────────────────────────

function parseExport() {
  const postsFilePath = path.join(fbPath, 'posts', 'profile_posts_1.json');
  log(`Reading source file: ${postsFilePath}`);

  if (!fs.existsSync(postsFilePath)) {
    console.error(`ERROR: Post file not found at ${postsFilePath}`);
    process.exit(1);
  }

  const fileSizeKB = Math.round(fs.statSync(postsFilePath).size / 1024);
  log(`File size: ${fileSizeKB} KB — parsing JSON...`);

  const rawData = JSON.parse(fs.readFileSync(postsFilePath, 'utf8'));
  log(`Found ${rawData.length} raw entries. Processing...`);
  console.log('');

  const parsedPosts = [];
  let skippedEmpty = 0;
  let mediaFound = 0;
  let mediaNotFound = 0;
  let externalLinks = 0;
  let postsWithTamil = 0;

  rawData.forEach((item, index) => {
    const timestamp = item.timestamp || 0;
    const progressPct = Math.round((index / rawData.length) * 100);
    if (index > 0 && index % 100 === 0) {
      log(`  Progress: ${index}/${rawData.length} (${progressPct}%) — kept ${parsedPosts.length} posts so far`);
    }

    // ── Extract & fix-encode text content ──
    let textContent = '';
    if (item.data && Array.isArray(item.data)) {
      const textObj = item.data.find(d => d.post);
      if (textObj) {
        textContent = fixEncoding(textObj.post);
      }
    }

    // Check if any non-ASCII chars were fixed (rough Tamil/Unicode detection)
    if (textContent && /[\u0B80-\u0BFF\u0900-\u097F\u0C00-\u0C7F]/.test(textContent)) {
      postsWithTamil++;
    }

    // Fix title encoding too
    const title = fixEncoding(item.title || '');

    // ── Extract media attachments ──
    const mediaList = [];
    if (item.attachments && Array.isArray(item.attachments)) {
      item.attachments.forEach(att => {
        if (att.data && Array.isArray(att.data)) {
          att.data.forEach(d => {
            if (d.media && d.media.uri) {
              const originalUri = d.media.uri;
              // Strip the Facebook activity prefix to get relative path
              const relativePath = originalUri
                .replace(/^(your|this_profile's)_activity_across_facebook\//, '');
              const sourcePath = path.join(fbPath, relativePath);
              const filename = path.basename(originalUri);
              const destPath = path.join(publicMediaDir, filename);

              if (fs.existsSync(sourcePath)) {
                try {
                  fs.copyFileSync(sourcePath, destPath);
                  mediaList.push(`/media/${filename}`);
                  mediaFound++;
                } catch (e) {
                  console.error(`  ERROR: Failed to copy ${sourcePath}: ${e.message}`);
                }
              } else {
                if (mediaNotFound < 10) {
                  // Only log the first 10 missing media to avoid flooding output
                  log(`  WARN: Media not found: ${sourcePath}`);
                } else if (mediaNotFound === 10) {
                  log(`  WARN: (Further missing media warnings suppressed...)`);
                }
                mediaNotFound++;
              }
            } else if (d.external_context && d.external_context.url) {
              const url = d.external_context.url.trim();
              if (url !== '') {
                mediaList.push(url);
                externalLinks++;
              }
            }
          });
        }
      });
    }

    // ── Skip entirely empty posts ──
    if (!textContent && mediaList.length === 0 && !title) {
      skippedEmpty++;
      return;
    }

    parsedPosts.push({
      id: `post_${timestamp}_${index}`,
      date: new Date(timestamp * 1000).toISOString(),
      timestamp,
      title,
      content: textContent,
      media: mediaList,
    });
  });

  // Sort newest first
  parsedPosts.sort((a, b) => b.timestamp - a.timestamp);

  // ── Write output ──
  console.log('');
  log('Writing posts.json...');
  fs.writeFileSync(outputDataPath, JSON.stringify(parsedPosts, null, 2), 'utf8');

  const outputKB = Math.round(fs.statSync(outputDataPath).size / 1024);

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  Parse complete! Summary:');
  console.log('══════════════════════════════════════════');
  console.log(`  Raw entries       : ${rawData.length}`);
  console.log(`  Posts kept        : ${parsedPosts.length}`);
  console.log(`  Posts skipped     : ${skippedEmpty} (no content/media/title)`);
  console.log(`  Media files copied: ${mediaFound}`);
  console.log(`  Media not found   : ${mediaNotFound}`);
  console.log(`  External URLs     : ${externalLinks}`);
  console.log(`  Posts w/ Tamil/   `);
  console.log(`    Indic script    : ${postsWithTamil}`);
  console.log(`  Output JSON size  : ${outputKB} KB`);
  console.log(`  Saved to          : ${outputDataPath}`);
  console.log('══════════════════════════════════════════');
}

parseExport();
