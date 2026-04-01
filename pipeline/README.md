# Data Pipeline

Two Python scripts that parse the Facebook export and enrich it with Gemini LLM metadata.

## Prerequisites

1. Install [uv](https://docs.astral.sh/uv/), the fast Python package manager.
2. Inside `pipeline/`, copy `.env.example` to `.env` and configure your API key:
   ```env
   GEMINI_API_KEY="your_key_here"
   ```

## Setup Environment

There is no need to manually create virtual environments or run `pip`. `uv` handles everything natively using the `pyproject.toml` file.

To synchronize dependencies (optional, as `uv run` will do it automatically):
```bash
cd pipeline
uv sync
```

---

## Step 1 — Parse the Facebook export

```bash
uv run parse_export.py
```

**What it does:**
- Reads `fb_export/posts/profile_posts_1.json` and all side-tables (albums, videos, edits, check-ins, share links).
- Fixes Mojibake encoding on all Tamil / Indic text.
- Copies all media files to `code/public/media/` in parallel.
- Outputs `output/posts_raw.json`.

---

## Step 2 — Enrich with Gemini LLM

```bash
uv run enrich_posts.py
```

**What it does:**
- Reads `output/posts_raw.json`.
- For each post with text, calls `gemini-2.0-flash` to extract semantic fields.
- Caches each response in `cache/<post_id>.json` — **re-runs are free**.
- Geocodes unique locations via OpenStreetMap Nominatim (cached in `cache/geo_*.json`).
- Writes the final `code/src/data/posts.json` consumed by the website.

---

## Re-running

- **Just re-parse** (e.g. after a new FB export): run Step 1, then Step 2.
  LLM cache is preserved so only genuinely new posts hit the API.
- **Force re-enrich a post**: delete its corresponding `cache/<post_id>.json`.
- **Force re-geocode a location**: delete the matching `cache/geo_*.json`.

---

## Output files

| File | Description |
|---|---|
| `output/posts_raw.json` | Full structured data before LLM |
| `output/posts_enriched.json` | Full structured data after LLM (for debugging) |
| `code/src/data/posts.json` | **Site data** — flat array of posts read by the website |
| `cache/*.json` | LLM response cache |
| `cache/geo_*.json` | Geocode result cache |
