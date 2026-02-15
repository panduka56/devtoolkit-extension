# Video Download Overhaul (2026-02-15)

## Summary

This change rebuilds the video detection/download pipeline so it works reliably under MV3, improves stream URL extraction, adds thumbnail and size metadata in the popup, and enables YouTube content script coverage again.

## Changed File Structure

```text
VideoDownloader/
├── background.js                        (updated)
├── content-script.js                    (updated)
├── manifest.json                        (updated)
├── popup.css                            (updated)
├── popup.js                             (updated)
├── watcher.js                           (updated)
└── docs/
    └── changes/
        └── 2026-02-15-video-download-overhaul.md  (new)
```

## Detailed Changes

### 1) Persistent MV3 video state

**File:** `background.js`

- Replaced in-memory `tabVideoData`-only flow with persisted per-tab state in `chrome.storage.session` (with `chrome.storage.local` fallback).
- Added normalized tab/video storage helpers:
  - URL normalization
  - size parsing/formatting
  - dedupe key generation
  - filename sanitization
- Added serialized mutation queue to avoid race conditions when multiple `videos-found` events arrive quickly.
- Kept badge updates in sync with persisted state.

### 2) Download error handling and metadata API

**File:** `background.js`

- `DOWNLOAD_VIDEO` now validates input URL and returns explicit failures when `chrome.runtime.lastError` is present.
- Added `conflictAction: "uniquify"` for safer repeated downloads.
- Added `GET_VIDEO_METADATA` message type:
  - Returns playlist/direct metadata
  - Attempts `HEAD` for `content-length`/`content-type`
  - Falls back to `GET` with `Range: bytes=0-0` if needed
  - Caches metadata updates back into per-tab storage

### 3) YouTube content script coverage restored

**File:** `manifest.json`

- Removed the YouTube exclusion from `content_scripts`.
- Content script now loads on YouTube like other hosts.

### 4) Active scan + better relay payloads from content script

**File:** `content-script.js`

- Added URL normalizer and page thumbnail extraction helpers.
- Added DOM-based fallback video scan:
  - `<video>` `currentSrc`/`src`
  - `<source src>`
  - media links from anchors
- Added new message handler: `SCAN_PAGE_VIDEOS`.
- Added startup scan (`setTimeout`) to seed detections quickly.
- Improved relay payload for `videos-found` events to include:
  - normalized URL
  - thumbnail URL
  - size bytes (if present)
  - content type (if present)

### 5) Stream parser fixes and new parsers

**File:** `watcher.js`

- Added `resolveUrl(base, relative)` helper and used it where manifests can return relative paths.
- Fixed HLS parser logic that previously overwrote URL from tokenized metadata.
- Updated generic HLS parser to resolve relative variant URLs.
- Updated generic DASH parser to resolve relative `BaseURL`.
- Added YouTube parser for `streamingData` responses:
  - extracts non-audio direct streams (when exposed)
  - extracts `hlsManifestUrl` / `dashManifestUrl`
  - propagates quality/content-type/thumbnail/size where available
- Added generic URL parser for `.m3u8`, `.mpd`, `.mp4`, `.webm` links in JSON/text payloads.

### 6) Popup UI: thumbnails, size, scan trigger, and filename fixes

**Files:** `popup.js`, `popup.css`

- Added video row thumbnail element and styling.
- Added size badge (`known size`, `Stream playlist`, or `Size unknown`).
- Added filename builder that preserves/infers extension instead of forcing `.mp4`.
- Added metadata hydration for each row via `GET_VIDEO_METADATA`.
- `refreshVideoList()` now actively triggers `SCAN_PAGE_VIDEOS` before reading background cache.
- Download now surfaces background errors in status line.

## Findings Addressed

- P0: MV3 cache loss due to service worker suspension.
- P0: YouTube excluded from content script injection.
- P1: download callback reporting success on failure.
- P1: incorrect HLS URL extraction.
- P1: relative HLS/DASH URL normalization missing.
- P1: forced `.mp4` extension for all downloads.
- P2: missing thumbnail and size metadata in video list.

## Validation Performed

Executed syntax/format checks:

- `node --check background.js`
- `node --check content-script.js`
- `node --check popup.js`
- `node --check watcher.js`
- `jq empty manifest.json`

All passed.

## Known Limitations

- DRM/encrypted protected streams (for example many protected YouTube/OnlyFans playback paths) are still constrained by browser/platform protections and may not be directly downloadable through extension-only logic.
- Playlist URLs (`.m3u8`, `.mpd`) are now detected and labeled correctly, but full mux/merge workflows still require an external processing path.
