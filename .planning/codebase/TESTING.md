# Testing Patterns

**Analysis Date:** 2026-02-15

## Test Framework

**Runner:**
- Not detected; no test framework configured
- No `jest.config.js`, `vitest.config.js`, or similar
- No test files found in codebase (no `*.test.js`, `*.spec.js`)

**Assertion Library:**
- Not applicable; testing not integrated

**Run Commands:**
```bash
# No test scripts configured
# Testing would need to be manually set up
```

## Test File Organization

**Location:**
- Currently: No test files
- If testing were to be added: Recommend co-located pattern
  - Tests alongside source files: `background.test.js` next to `background.js`
  - Test utilities in `__tests__` subdirectory (Chrome extension context)

**Naming:**
- Convention would follow: `[module].test.js` or `[module].spec.js`

**Structure:**
- None currently; framework selection required first

## Manual Testing Observations

While no automated tests exist, the codebase is designed for manual/integration testing:

**testable units:**

1. **Video Detection Flow (`background.js`, `watcher.js`, `content-script.js`)**
   - webRequest monitoring: `chrome.webRequest.onCompleted` tracks video content-types
   - XHR/fetch interception: `watcher.js` overrides `XMLHttpRequest.prototype.open/send` and `window.fetch`
   - Message bridge: `postMessage` from page context → `chrome.runtime.sendMessage` to background
   - Result: Video links aggregated in `tabVideoData[tabId]`

2. **Console Log Capture (`content-script.js`, `page-logger.js`)**
   - Console method wrapping: `console.log`, `console.warn`, `console.error` proxied
   - Custom event dispatch: `window.dispatchEvent(new CustomEvent('__CONSOLE_CAPTURE_EVENT__', ...))`
   - Log deduplication: `dedupeEntries()` uses `Map` with key format `"${level}|${source}|${message}"`
   - Entry filtering: `includeByLevelPreset()` filters by error/warning/full

3. **AI Provider Integration (`background.js`, `lib/ai-providers.js`, `popup.js`)**
   - Config management: `saveProviderConfig()` persists to `chrome.storage.local`
   - API call building: `buildFetchOptions()` constructs provider-specific request
   - Response parsing: `parseAiResponse()` handles Anthropic/OpenAI/Ollama/DeepSeek formats
   - Error handling: Network failures caught, API errors with structured messages

4. **DOM State Management (`popup.js`)**
   - Settings persistence: `localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))`
   - View navigation: `setActiveView()` manages CSS class toggles across view map
   - Tab management: Sub-tabs rendered dynamically via `renderSubTabs(category)`
   - Data binding: Manual sync between UI elements and state object via `readSettingsFromUi()` / `writeSettingsToUi()`

## Error Handling Patterns (Observable)

**Parser Error Handling (`watcher.js`):**
```javascript
try {
  const data = JSON.parse(responseText);
  // ... extraction logic
  window.dispatchEvent(new CustomEvent('videos-found', { detail: videoVersions }));
} catch (e) { /* ignore parse errors */ }
```
- Safe failure: Parse errors logged but don't crash parser
- Multiple parsers can attempt same response
- Silent catch used for speculative/optional parsing

**Critical Operation Error Handling (`background.js`, `popup.js`):**
```javascript
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    writeSettingsToUi(DEFAULT_SETTINGS);
    return;
  }
  writeSettingsToUi(normalizeSettings(JSON.parse(raw)));
} catch {
  writeSettingsToUi(DEFAULT_SETTINGS);
}
```
- Fallback to defaults on error
- Ensures UI always has valid state

**Message Handler Error Wrapping (`background.js`):**
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      // ... handle different message types
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown background error',
      });
    }
  })();
  return true;  // keep channel open for async response
});
```
- Every message type has try-catch
- Response includes `{ ok: false, error }` on failure
- Async handler wrapped in IIFE to allow sendResponse from within

**Fetch Response Validation (`background.js`):**
```javascript
const response = await fetch(endpoint, { ... });
const rawText = await response.text();
if (!response.ok) {
  let errorReason = `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(rawText);
    errorReason = parsed.error?.message || parsed.message || errorReason;
  } catch (error) {
    if (rawText) errorReason = rawText.slice(0, 300);
    throw new Error(`${providerLabel} request failed: ${errorReason}`, { cause: error });
  }
  throw new Error(`${providerLabel} request failed: ${errorReason}`);
}
```
- HTTP non-200 status treated as error
- Attempts to extract API-specific error message from response body
- Falls back to status text if response can't be parsed

## Test Considerations for Future Implementation

**Dependencies:**
- Chrome API mocking required: `chrome.runtime`, `chrome.storage`, `chrome.tabs`, `chrome.webRequest`, `chrome.downloads`
- Fetch mocking needed for AI provider calls
- DOM API mocking for `popup.js` tests

**Challenges:**
- Service worker execution context (background.js) requires special test setup
- Content script injection into page context requires frame simulation
- XHR/fetch interception in `watcher.js` requires Sinon.JS or similar spy library

**Recommended Test Stack (if to be added):**
- **Test Runner:** Vitest (fast, native ES modules, simpler than Jest for vanilla JS)
- **Mocking:** Sinon.JS (for XHR/fetch spies) + custom Chrome API stubs
- **DOM Testing:** jsdom or happy-dom (for popup.js)
- **Test Structure:**
  ```
  tests/
  ├── unit/
  │   ├── ai-providers.test.js
  │   ├── background.test.js (with chrome mock)
  │   └── popup.test.js (with jsdom)
  ├── integration/
  │   ├── video-detection.test.js
  │   └── console-capture.test.js
  └── mocks/
      └── chrome-api.js
  ```

## Current Test Coverage Status

**Untested Components:**

1. **Video Detection (`background.js`, `watcher.js`)**
   - No unit tests for webRequest handler
   - No tests for `addVideoLinks()` deduplication
   - No tests for site-specific parsers (Instagram, Vimeo, Twitter, Reddit, Twitch, etc.)
   - Integration risk: Video detection relies on real network requests in manual testing

2. **Console Capture (`content-script.js`, `page-logger.js`)**
   - No tests for console method wrapping
   - No tests for log serialization (`toSerializable()`)
   - No tests for deduplication logic (`dedupeEntries()`)
   - Manual verification only: Capture tested by opening DevTools console and checking popup

3. **AI Integration (`background.js`, `popup.js`, `lib/ai-providers.js`)**
   - No tests for AI provider config management
   - No tests for fetch request building (`buildFetchOptions()`)
   - No tests for response parsing (`parseAiResponse()`) — tested manually per provider
   - No tests for timeout behavior (`withTimeout()`)
   - API key storage/retrieval untested

4. **Settings Persistence (`popup.js`)**
   - No tests for `loadSettings()` / `saveSettings()` round-trip
   - No tests for settings normalization (`normalizeSettings()`)
   - No tests for localStorage fallback behavior

5. **DOM State Management (`popup.js`)**
   - No tests for view navigation logic
   - No tests for tab switching and subtab rendering
   - No tests for error message display (`setStatus()`, `setAiStatus()`, etc.)

6. **Message Passing (`background.js`, `popup.js`)**
   - No tests for message handler routing
   - No tests for response error serialization
   - No integration tests for popup ↔ background communication

**Low Risk (Well-Structured):**
- Pure utility functions: `trimToMaxChars()`, `redactSensitiveText()`, `normalizeWhitespace()`, `compressStack()` — straightforward logic, easy to test if framework added

---

*Testing analysis: 2026-02-15*
