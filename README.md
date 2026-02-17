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
- Host-level permissions for broad page coverage (`manifest.json`)

## Docs

- Status and architecture: `docs/VIDEO_DOWNLOADER_STATUS.md`
- Detailed implementation changes: `docs/changes/2026-02-15-video-download-overhaul.md`
- Planning notes: `docs/plans/2026-02-15-unified-extension-plan.md`
