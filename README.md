# DevToolkit Extension

Chrome MV3 extension that combines:
- video stream detection and download workflows
- console capture utilities
- page intelligence helpers
- AI-assisted developer tooling

## Project Preview

![DevToolkit popup preview](docs/assets/project-preview.jpg)

## Features

- Multi-source video candidate detection (`watcher.js` + `content-script.js`)
- Per-tab persisted video cache and curation (`background.js`)
- Popup actions for direct download and MP3-availability flow (`popup.js`)
- Optional local `yt-dlp` + `ffmpeg` bridge for one-click fallback extraction (`tools/local-downloader-server.mjs`)
- Host-level permissions for broad page coverage (`manifest.json`)

## Local yt-dlp Helper (Optional, Recommended)

For YouTube/TikTok and other stream types that are not directly downloadable in-browser:

1. Install tools on macOS:
   - `brew install yt-dlp ffmpeg`
2. Start helper:
   - `node tools/local-downloader-server.mjs`
3. In extension `Settings`:
   - Enable `yt-dlp fallback`
   - Keep URL as `http://127.0.0.1:41771`
   - Click `Test Helper`

When direct download is unavailable, `Download` / `Audio` buttons automatically fall back to local extraction.

## Docs

- Status and architecture: `docs/VIDEO_DOWNLOADER_STATUS.md`
- Detailed implementation changes: `docs/changes/2026-02-15-video-download-overhaul.md`
- Planning notes: `docs/plans/2026-02-15-unified-extension-plan.md`
