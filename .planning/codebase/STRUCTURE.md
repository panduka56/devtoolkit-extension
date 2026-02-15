# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
VideoDownloader/
├── manifest.json          # Chrome MV3 manifest
├── background.js          # Service worker: video storage, message hub, AI calls
├── content-script.js      # Page inspector: console capture, SEO, structured data, page context
├── watcher.js             # Injected page script: XHR/fetch interception, site parsers
├── page-logger.js         # Injected page script: console method wrapping
├── popup.html             # Extension popup UI structure
├── popup.css              # Popup dark theme styles (460-520px width)
├── popup.js               # Popup event handlers, message routing, UI state
├── lib/
│   └── ai-providers.js    # LLM provider configs: DeepSeek, OpenAI, Anthropic, Ollama
├── icons/
│   ├── icon-32.png
│   ├── icon-64.png
│   └── icon-128.png
└── .planning/
    └── codebase/          # Architecture documentation
```

## Directory Purposes

**Root Level:**
- Purpose: Main extension source files, no subdirectories except `lib/` and `icons/`
- Contains: Service worker, content script, popup (view+controller+styles), manifest
- Key files: `manifest.json` defines all permissions, background.js defines message protocol

**lib/ Directory:**
- Purpose: Reusable library code
- Contains: LLM provider abstraction
- Key files: `ai-providers.js` — centralized AI configuration and request/response building

**icons/ Directory:**
- Purpose: Extension icon assets at different sizes
- Contains: PNG files for 32x32, 64x64, 128x128 px
- Referenced in: `manifest.json` for extension UI

**.planning/codebase/ Directory:**
- Purpose: GSD-generated architecture documentation
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md (as written)

## Key File Locations

**Entry Points:**
- `manifest.json` (line 1-43): MV3 configuration, permissions, script injection rules
- `background.js` (line 1-435): Service worker, handles all background tasks
- `popup.html` (line 1-399): HTML structure for all 5 popup categories
- `content-script.js` (line 1-1250): Injected into all tabs, captures page data

**Configuration:**
- `manifest.json`: Permissions (storage, tabs, webRequest, downloads, scripting, activeTab), host permissions (<all_urls>), web-accessible resources (watcher.js, page-logger.js)
- `lib/ai-providers.js` (lines 1-49): AI_PROVIDERS dict with DeepSeek/OpenAI/Anthropic/Ollama; PROVIDER_STORAGE_KEYS for chrome.storage.local keys

**Core Logic:**
- `background.js` (lines 8-42): Tab video state management via `tabVideoData` object
- `background.js` (lines 44-206): AI config helpers (getActiveProvider, getProviderConfig, saveProviderConfig, clearProviderKey)
- `background.js` (lines 208-268): callAiProvider function — handles all LLM requests with prompt building
- `background.js` (lines 272-435): Message handler — routes GET_TAB_VIDEOS, DOWNLOAD_VIDEO, FETCH_SITEMAP, AI_* messages
- `content-script.js` (lines 15-120): Video ID generation and script injection (injectPageLogger, injectWatcher)
- `content-script.js` (lines 233-282): buildEntries function — log deduplication and filtering
- `content-script.js` (lines 652-712): extractPageContext function — DOM traversal and text scoring
- `content-script.js` (lines 1024-1125): extractStructuredData function — JSON-LD, Microdata, RDFa parsing
- `watcher.js` (lines 8-79): XHR and fetch proxying
- `watcher.js` (lines 115-567): 10 site-specific parsers (Instagram, Twitter, Vimeo, HLS, Reddit, Twitch, Kick, Pornhub, XVideos, generic DASH)

**Testing:**
- Not present. No test files detected. Manual testing via extension in Chrome browser.

**Popup UI:**
- `popup.html`: 5 categories with 8 total views (video, logs/brief, seo/schema/sitemap, context, settings)
- `popup.css`: Dark theme with mint accent (#11e8a4), 460-520px width constraint
- `popup.js` (lines 1-100+): Category navigation, message dispatch, UI state management

## Naming Conventions

**Files:**
- `background.js`: Service worker (per MV3 convention)
- `content-script.js`: Content script injected into pages
- `watcher.js`: Page-context script that does XHR/fetch monitoring
- `page-logger.js`: Page-context script that wraps console
- `popup.{html,css,js}`: Extension popup view and logic
- `manifest.json`: MV3 required
- `lib/ai-providers.js`: Utility module

**Functions:**
- Verb-first (snake_case): `getTabVideos()`, `addVideoLinks()`, `extractPageContext()`, `buildEntries()`, `validateSchemaType()`
- Builder functions: `build*()` — buildFetchOptions, buildSystemPrompt, buildUserPrompt, buildReportText, buildContextMarkdown
- Getter functions: `get*()` — getMetaContent, getInteractiveLabel, getActiveProvider
- Extractor functions: `extract*()` — extractPageContext, extractSeoMeta, extractStructuredData, extractJsonLd, extractMicrodata, extractRdfa

**Variables:**
- camelCase for all variables: `tabVideoData`, `logs`, `logsText`, `videoLinks`, `levelPreset`, `maxEntries`, `currentProvider`
- Prefix conventions:
  - DOM elements: `...El` (statusEl, aiStatusEl, copyButton, modelSelect)
  - DOM element arrays: `...Buttons` (categoryButtons, levelPresetButtons)
  - Constants (all caps): `EVENT_NAME`, `LOG_LIMIT`, `CONTEXT_MAX_*`, `SCHEMA_RULES`

**Types:**
- No TypeScript. Plain JavaScript with JSDoc-style comments where used.
- Object shapes described in code: `tabVideoData[tabId] = { videos: [], badge: 0 }`; `report = { totalCaptured, totalCount, uniqueCount, entries, levelCounts }`

## Where to Add New Code

**New Feature (e.g., new video parser):**
- Primary code: `watcher.js` lines 115-567 — add new parser object with `origins` and `onLoad()` handler
- Integration: Add to `parsers` array (line 570-581)
- Test: Manual — navigate to site and check if videos are detected

**New Site-Specific Parser Pattern:**
```javascript
const newSiteParser = {
  origins: [/newsite\.com/, 'api.newsite.com'],  // String exact match or RegExp
  onLoad(responseText, requestUrl) {
    if (!responseText.includes('video')) return;  // Early exit if not video
    try {
      const data = JSON.parse(responseText);
      const videos = [];
      // ... extract video URLs ...
      window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
    } catch (e) { /* ignore */ }
  },
};
// Then add to parsers array at line 570
```

**New Popup Category:**
- HTML structure: Add new section in `popup.html` with `id="[categoryView]" class="view"`
- Category config: Update `CATEGORIES` object in `popup.js` lines 9-15
- Styles: Add to `popup.css` (follow dark theme: --bg-1, --mint, --text-1 colors)
- Event handlers: Add to `popup.js` — category button click, message dispatch to content-script/background
- Message protocol: Define new message type in background.js `onMessage.addListener()` (line 272)

**New Page Inspection Feature (e.g., new metadata extractor):**
- Code location: `content-script.js` — add new `extract*()` function
- Entry point: Add handler in `chrome.runtime.onMessage.addListener()` (line 1162) with new message type
- Response: Send back via `sendResponse({ok: true, data: ...})`
- Popup integration: Add button/view to popup.html, dispatch message in popup.js

**New AI Provider:**
- Configuration: Update `lib/ai-providers.js` — add entry to `AI_PROVIDERS` dict
- Storage keys: Add to `PROVIDER_STORAGE_KEYS` (e.g., `newprovider_apiKey`, `newprovider_model`)
- Request/response: Update `buildFetchOptions()` and `parseAiResponse()` to handle new provider's API shape
- UI: Popup already has provider dropdown (popup.html line 336) and will auto-populate from AI_PROVIDERS

**Utility/Helper Functions:**
- Shared code: `lib/ai-providers.js` — any reusable LLM logic
- Page utilities: `content-script.js` — text normalization, DOM traversal helpers (e.g., `normalizeWhitespace`, `textFromNode`)
- Parsing utilities: `watcher.js` — video extraction helpers (e.g., `searchKeyRecursive`, `generateId`)

## Special Directories

**.planning/codebase/ Directory:**
- Purpose: Stores GSD-generated architecture documentation
- Generated: Yes (by GSD mapper)
- Committed: Yes, to git for future reference

**icons/ Directory:**
- Purpose: Extension icon assets
- Generated: No (manually created graphics)
- Committed: Yes (PNG files)

**No build artifacts directory:**
- The extension has no build step, no bundling, no minification
- Files served directly to Chrome
- ES modules supported natively in MV3 (`type: "module"` in manifest.json line 26)

## Import/Module Structure

**ES Module Imports:**
- `background.js` imports from `lib/ai-providers.js` (line 1-6) — AI_PROVIDERS, PROVIDER_STORAGE_KEYS, buildFetchOptions, parseAiResponse
- `popup.js` imports from `lib/ai-providers.js` (line 1-6) — same exports
- No other cross-file imports; content-script.js, watcher.js, page-logger.js are standalone IIFE closures

**Script Injection Chain:**
1. `content-script.js` runs on page load (manifest line 31, run_at: document_start)
2. Content-script injects `watcher.js` via script tag (content-script.js lines 37-43)
3. Content-script injects `page-logger.js` via script tag (content-script.js lines 29-35)
4. Both run in page context, before other page scripts if possible

**Web-Accessible Resources:**
- Manifest declares `watcher.js` and `page-logger.js` (lines 37-41) as accessible to injected scripts
- Required because content-script cannot directly execute page-context code; must inject via `<script src>` tags

---

*Structure analysis: 2026-02-15*
