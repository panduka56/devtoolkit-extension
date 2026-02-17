# Video Downloader: How It Works and Current Progress

Last updated: 2026-02-17

## Scope

This document explains the current runtime architecture, detection pipeline, download behavior, platform coverage, and implementation progress for the VideoDownloader extension.

## Runtime Architecture

### 1) Page context interception (`watcher.js`)

- Injected into page context by content script.
- Hooks both `XMLHttpRequest` and `fetch`.
- Observes API/manifest responses and runs parser registry.
- Dispatches normalized `videos-found` events to window.

### 2) Bridge + DOM scan (`content-script.js`)

- Injects `watcher.js` and `page-logger.js`.
- Relays `videos-found` payloads to background via `add-video-links`.
- Performs fallback DOM scan on `SCAN_PAGE_VIDEOS` message and at startup.
- Normalizes URLs and enriches items with thumbnail/content metadata where available.

### 3) Storage + curation + downloads (`background.js`)

- Persists per-tab video state in `chrome.storage.session` (fallback `chrome.storage.local`).
- Deduplicates candidates and curates list for display:
  - junk filtering
  - canonical identity grouping
  - platform-aware ranking
  - primary stream selection
- Provides APIs:
  - `GET_TAB_VIDEOS`
  - `GET_VIDEO_METADATA`
  - `DOWNLOAD_VIDEO`
  - `DOWNLOAD_AUDIO` (MP3 gate)
- Handles badge updates for each tab.

### 4) UI and user actions (`popup.js` + `popup.css`)

- Requests active scan, reads curated videos, and renders rows.
- Displays:
  - `Main` badge for primary candidate
  - format/quality/size
  - thumbnail
- Download buttons:
  - `Download` for direct valid streams
  - `Unavailable` when stream is known non-direct
  - `MP3` button only when an audio candidate exists; shows clear unavailable state otherwise
- Optional local helper fallback:
  - `yt-dlp` + `ffmpeg` bridge via `tools/local-downloader-server.mjs`
  - Used automatically when direct browser download/audio extraction is not possible

## Detection and Ranking Pipeline

### Candidate ingestion

- Site parsers (YouTube, TikTok, Vimeo, Twitter/X, Reddit, Twitch, Kick, etc.).
- Generic stream parser for HLS/DASH manifests.
- DOM scan for active `<video>`/`<source>` media.

### Candidate cleanup

- URL normalization (`http`/`https` only).
- Removal of known junk patterns (preview/storyboard/tracking/subtitles/audio-only where inappropriate).
- Merge of repeated sightings over time.

### Ranking

- Scores candidates by:
  - explicit primary signal
  - has-audio preference
  - quality
  - file size when known
  - source confidence
- Applies platform-aware limits:
  - YouTube: small curated set (prefer progressive audio+video streams)
  - Non-YouTube: capped list with top-ranked candidates

## Platform Status (Current)

### TikTok

- Dedicated parser implemented.
- Main candidate prioritization implemented.
- Audio metadata capture implemented when exposed by payload.

### YouTube

- Detects and ranks stream candidates.
- Prefer progressive streams with audio.
- If only video-only or manifest candidates exist, UI marks non-direct streams unavailable to avoid broken downloads.
- MP3 button is shown only when extractable audio candidate exists and is already MP3-compatible.

### Instagram / OnlyFans and other protected platforms

- Best-effort stream detection is present.
- If platform provides protected/ciphered/DRM streams, direct in-extension download may not be possible.
- UI now surfaces unavailability instead of triggering misleading downloads.

## MP3 Behavior

### What works now

- MP3 direct download path works when parser captures an audio URL that is already MP3.
- User sees `MP3` action for that row.
- Direct non-MP3 audio downloads (for example `m4a`/`webm`) are labeled and downloaded as their actual format.
- Local helper mode can extract MP3 from supported platforms (for personal workflow) without leaving the extension UI.

### What does not work yet

- True format conversion inside the extension sandbox (without local helper) is still not implemented.
- DRM-protected streams remain constrained.

## Progress Timeline

- `a47f09f` `feat(video): rebuild stream detection and download pipeline`
  - persistence, metadata API, YouTube enablement, parser and UI baseline
- `8a97fa6` `fix(video): prioritize main stream and suppress junk detections`
  - ranking, dedupe, junk suppression, main-stream UX
- `693591e` `feat(video): add tiktok parser and mp3 availability workflow`
  - TikTok parser, audio metadata, MP3 action and unavailability handling

## Known Constraints

- DRM/protected streams remain constrained by browser/platform protections.
- Muxing and transcoding workflows (video+audio merge and MP3 conversion) require external processing support if direct stream is not already suitable.

## Recommended Next Steps

1. Add an optional external conversion pipeline (native helper or backend worker) for:
   - muxing video-only + audio-only streams
   - transcoding to MP3 when source is not MP3
2. Add per-platform scoring tweaks (Instagram/OnlyFans) based on real sample URLs.
3. Add parser diagnostics mode in popup to inspect why a stream was accepted/rejected.
