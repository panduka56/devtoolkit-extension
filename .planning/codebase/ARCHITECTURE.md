# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Chrome MV3 multi-layer extension with page context script injection, network interception, and tabbed popup UI.

**Key Characteristics:**
- Three execution contexts: service worker (background), content script, and injected page context
- Real-time video detection via webRequest monitoring and XHR/fetch interception
- Modular popup UI with 5 main categories (Video, Console, Page Intel, Context, Settings)
- No build step or frameworks — vanilla JavaScript with ES modules
- Storage-based AI provider configuration with support for multiple LLM backends
- Synchronized tab-specific state for video detection

## Layers

**Service Worker (Background):**
- Purpose: Central message hub, video storage per tab, AI API calls, file downloads, sitemap fetching
- Location: `background.js`
- Contains: Tab video state management, message routing, AI provider config persistence, chrome API orchestration
- Depends on: `lib/ai-providers.js` for LLM configuration
- Used by: Content script and popup via `chrome.runtime.sendMessage()`

**Content Script:**
- Purpose: Page inspection, console capturing, SEO meta extraction, structured data parsing, page context building, script injection
- Location: `content-script.js` (~1250 lines)
- Contains: Log aggregation, report formatters (plain/XML/AI compact), DOM analysis, page context extraction, video event relay
- Depends on: `page-logger.js` and `watcher.js` (injected)
- Used by: Popup UI via `chrome.runtime.sendMessage()`

**Injected Page Context (watcher.js):**
- Purpose: XHR/fetch interception, site-specific video parsing, postMessage bridge to content script
- Location: `watcher.js` (~600 lines)
- Contains: XMLHttpRequest proxy, fetch proxy, 10+ site-specific parsers (Instagram, Twitter, Vimeo, HLS, Reddit, Twitch, Kick, Pornhub, XVideos, generic DASH/HLS)
- Depends on: None (runs in window context)
- Used by: Content script triggers with `chrome.runtime.getURL()`

**Injected Console Logger (page-logger.js):**
- Purpose: Wraps console methods and error handlers to capture all console output
- Location: `page-logger.js` (~120 lines)
- Contains: Console method wrapping (log, info, warn, error, debug), error event listeners, custom event dispatch
- Depends on: None (runs in window context)
- Used by: Content script collects via custom event listener

**Popup UI:**
- Purpose: User-facing interface for all extension features
- Location: `popup.html`, `popup.css`, `popup.js`
- Contains: Tabbed navigation, video list UI, console capture controls, AI brief generator, SEO scanner, context extractor, sitemap explorer, settings panel
- Depends on: Background service worker for all data operations
- Used by: User clicks extension icon

**AI Provider Library:**
- Purpose: Configuration and normalization for multiple LLM backends
- Location: `lib/ai-providers.js`
- Contains: DeepSeek, OpenAI, Anthropic, Ollama provider configs; request/response builders
- Depends on: None
- Used by: Background (callAiProvider) and popup.js (settings UI)

## Data Flow

**Video Detection Flow:**

1. **Network Interception** (`background.js` → `watcher.js`)
   - Chrome webRequest detects video content-types (mp4, webm, m3u8, mpd)
   - Calls `addVideoLinks(tabId, videoLinks)` → updates `tabVideoData[tabId].videos`
   - Badge updated with count

2. **XHR/Fetch Interception** (`watcher.js` → site parsers)
   - XMLHttpRequest/fetch wrapped in page context
   - Response text passed to all registered parsers
   - Site-specific parser matches hostname and parses JSON/HLS/DASH
   - Dispatches `videos-found` custom event with video array

3. **Content Script Relay** (`content-script.js` → `background.js`)
   - Content script listens for `videos-found` event
   - Calls `chrome.runtime.sendMessage({message: 'add-video-links', videoLinks})`
   - Background adds to tab state with dedup by canonical URL

**Console Capture Flow:**

1. **Logging** (`page-logger.js` → `content-script.js`)
   - Page logger wraps `console.log/info/warn/error/debug`
   - Dispatches `__CONSOLE_CAPTURE_EVENT__` custom event
   - Content script collects into `logs[]` array (max 5000)

2. **Report Generation** (`popup.js` → `content-script.js`)
   - Popup sends `GET_CAPTURED_CONSOLE` message
   - Content script builds entries with dedup/truncation/filtering
   - Returns formatted text (AI compact/XML/plain) + metadata

3. **AI Summarization** (`popup.js` → `background.js`)
   - Popup sends `AI_SUMMARIZE` with logs + context
   - Background calls `callAiProvider()` → LLM endpoint
   - Returns summary text + token usage

**Page Context Extraction Flow:**

1. **DOM Scan** (`content-script.js` → popup.js`)
   - Popup sends `GET_AI_CONTEXT` message
   - Content script traverses DOM, extracts headings, links, text, interactive elements
   - Scores lines by keyword relevance, timestamps, prices, positions
   - Builds markdown report with stats

2. **AI Context Brief** (`popup.js` → `background.js`)
   - Popup sends `AI_SUMMARIZE` with page context markdown
   - Background summarizes with prompt: "Transform page context into concise engineering brief"
   - Returns condensed context

**State Management:**

- **Video State:** In-memory `tabVideoData[tabId]` per browser tab, cleared on navigation
- **Settings/Config:** `chrome.storage.local` persists AI provider keys, selected model, base URL across sessions
- **Logs:** Scoped to content script context, max 5000 entries, first-in-first-out eviction

## Key Abstractions

**Video Deduplication:**
- Purpose: Prevent duplicate video entries from multiple detection layers
- Examples: `background.js` lines 19-29 (addVideoLinks with url matching)
- Pattern: Canonical URL matching (`yt:{host}:{id}:{itag}` for YouTube, byte-range for Instagram DASH)

**Site-Specific Parser Registry:**
- Purpose: Modular video extraction for different platforms
- Examples: `watcher.js` lines 570-581 (parsers array), lines 115-502 (individual parsers)
- Pattern: Each parser has `origins[]` pattern match and `onLoad(responseText, requestUrl)` handler

**Report Builder Functions:**
- Purpose: Transform log entries into different output formats
- Examples: `content-script.js` lines 299-363 (buildPlainReport, buildXmlReport, buildAiCompactReport)
- Pattern: Each builder accepts `report` object with entries[], returns formatted string

**Provider Configuration:**
- Purpose: Abstract differences between DeepSeek/OpenAI/Anthropic/Ollama APIs
- Examples: `lib/ai-providers.js` lines 1-49 (AI_PROVIDERS, PROVIDER_STORAGE_KEYS)
- Pattern: Unified `buildFetchOptions()` and `parseAiResponse()` functions normalize all providers

**Message Protocol:**
- Purpose: Type-safe communication between layers
- Examples: `GET_CAPTURED_CONSOLE`, `AI_SUMMARIZE`, `GET_TAB_VIDEOS`, `DOWNLOAD_VIDEO`
- Pattern: Popup/content-script send `{type: 'MESSAGE_TYPE', ...args}` → background responds with `{ok: true/false, ...data}`

## Entry Points

**Popup Popup.html:**
- Location: `popup.html` lines 1-399
- Triggers: User clicks extension icon
- Responsibilities: Render 5-category UI, handle category/view switching, trigger all data requests

**Background Service Worker:**
- Location: `background.js` lines 1-435
- Triggers: Extension startup, message from popup/content-script, chrome API events (tabs, downloads, webRequest)
- Responsibilities: Handle all `chrome.runtime.onMessage` messages, maintain tab state, orchestrate AI calls

**Content Script:**
- Location: `content-script.js` lines 1-1250
- Triggers: Page load (manifest `run_at: document_start`)
- Responsibilities: Inject watcher.js and page-logger.js, capture console, extract page context, relay video events

**Watcher (Injected Page Context):**
- Location: `watcher.js` lines 1-607
- Triggers: Called by content-script during page setup
- Responsibilities: Proxy XHR/fetch, run site parsers, dispatch video-found events

**Page Logger (Injected Page Context):**
- Location: `page-logger.js` lines 1-120
- Triggers: Called by content-script during page setup
- Responsibilities: Wrap console methods, emit capture events

## Error Handling

**Strategy:** Try-catch with fallback, dispatch errors to popup via message response `{ok: false, error: 'message'}`

**Patterns:**
- Parsers: `try { parse(responseText) } catch (e) { /* ignore */ }` — silent fail to avoid blocking other parsers
- AI calls: Throw with provider label + status code + extracted error message
- Message handler: Catch-all wraps async operation, returns error to sender
- Parsing: Redact sensitive data (Bearer tokens, API keys, passwords) before sending to AI

## Cross-Cutting Concerns

**Logging:** `console.log()` for debugging in background.js (visible in extension Service Worker logs); no centralized logger. In content-script, calls are captured via event-based console interception for user inspection.

**Validation:** Message handlers validate `message.type` and required fields; content-script validates sender origin via `sender.id === chrome.runtime.id`; AI calls trim text to 14000 chars before sending.

**Authentication:** Provider API keys stored in `chrome.storage.local` with `PROVIDER_STORAGE_KEYS` mapping; no keys in manifest or code; Ollama supports no-auth (`authType: 'none'`).

**Permissions:** Manifest declares `storage, tabs, webRequest, downloads, scripting, activeTab, <all_urls>`; content-script injected on all URLs except YouTube (exclude_matches); watcher.js runs on all frames (`all_frames: true`).

---

*Architecture analysis: 2026-02-15*
