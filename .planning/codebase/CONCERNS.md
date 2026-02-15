# Codebase Concerns

**Analysis Date:** 2026-02-15

## Tech Debt

**YouTube Exclusion in content-script.js:**
- Issue: `exclude_matches: ["*://www.youtube.com/*"]` in manifest.json deliberately prevents content-script from running on YouTube
- Files: `manifest.json` (line 33), `content-script.js`
- Impact: YouTube pages don't receive console capture, SEO scanning, or context extraction features. Only webRequest-detected videos appear
- Fix approach: Remove YouTube from exclude_matches once YouTube-specific testing is complete. Ensure watcher.js detection works reliably on YouTube first

**Event Listener Memory Accumulation in popup.js:**
- Issue: popup.js adds 28+ event listeners (lines 2324-2358) without ever removing them when views switch. Each popup navigation creates new listeners stacked on existing ones
- Files: `popup.js` (lines 2303-2358, 2375-2378)
- Impact: Long popup sessions accumulate multiple listener registrations for same buttons. Minor memory leak but not critical due to popup lifetime
- Fix approach: Store listener references in cleanup map. Call cleanup before re-binding in navigation handlers. Or use event delegation on parent containers instead of individual buttons

**watcher.js XHR Interception Uninstall Gap:**
- Issue: Prototype overrides (XMLHttpRequest.prototype.open, .send, .setRequestHeader) installed at page context (line 13-24, 26-51) but never have uninstall hook
- Files: `watcher.js` (lines 9-79)
- Impact: Once installed, cannot be cleanly removed if extension is disabled/updated mid-session. Prototype stays modified
- Fix approach: Add window.__devToolkitWatcherUninstall() function that restores originalOpen/originalSend/originalSetRequestHeader. Call from cleanup or use getter/setter pattern

**tabVideoData Object Unbounded Growth (Potential):**
- Issue: `tabVideoData` in background.js stores all videos per tab in memory indefinitely until tab closes (line 10)
- Files: `background.js` (lines 10-42)
- Impact: Tabs with many videos (e.g., YouTube playlist pages, livestream VOD archives) accumulate unlimited video objects in RAM. Browser memory grows over extension lifetime
- Fix approach: Implement max-entries cap per tab (e.g., 500 videos). Add LRU eviction. Or periodically dedupe videos with identical URLs

**Fetch Response Cloning Without Validation:**
- Issue: watcher.js clones fetch responses (line 62) but doesn't validate content-type or size before .text() conversion
- Files: `watcher.js` (lines 56-79)
- Impact: Large responses (multi-MB PDFs, video files) are cloned and converted to text unnecessarily, consuming memory. No early-return for non-JSON/non-video responses
- Fix approach: Check content-type header before cloning. Return early if binary or oversized. Add size threshold check

**Generic Stream Parser Too Permissive:**
- Issue: genericStreamParser (line 505-567) uses `origins: [/.*/]` which matches every domain and runs expensive DOMParser + regex on every response with `#EXTM3U` or `<MPD`
- Files: `watcher.js` (lines 505-567)
- Impact: Can slowdown page loads on sites using JSON with `#EXTM3U` in data or XML responses. No early-exit means all parsers run even after match
- Fix approach: Break parser loop after first match (add `break` in line 602). Optimize regex patterns to fail faster. Consider allowlist for streaming domains

## Known Bugs

**AI Provider Response Null Safety:**
- Symptoms: If AI provider returns response without expected fields, extension crashes silently (no user feedback beyond generic error)
- Files: `lib/ai-providers.js` (lines 109-134), `background.js` (lines 258-261)
- Trigger: DeepSeek/OpenAI/Anthropic API returns malformed response (e.g., `{"choices": null}` or missing `content` field)
- Workaround: Ensure API keys are valid and model names match provider's supported models
- Fix approach: Add defensive nullish coalescing in parseAiResponse. Validate parsed structure before returning

**Sitemap Fetch with Redirect Loop:**
- Symptoms: Some sitemap URLs redirect infinitely or timeout
- Files: `background.js` (lines 307-326)
- Trigger: Sitemap URL in robots.txt points to redirect chain or domain-relative path without protocol
- Workaround: Manually verify sitemap URL is accessible in browser
- Fix approach: Follow redirects up to N limit (e.g., 5). Add request timeout (current has no timeout). Validate URL is absolute before fetch

**postMessage Bridge Reliability on Content Security Policy Pages:**
- Symptoms: Videos detected via watcher.js don't reach popup on pages with strict CSP
- Files: `watcher.js` (lines 40-47, 65-72), `content-script.js` (lines 1129-1150)
- Trigger: Page has CSP policy blocking custom event dispatch (e.g., `default-src 'self'` without script-src exception)
- Workaround: None — users must disable extension on affected sites
- Fix approach: Fallback to chrome.runtime.sendMessage directly from watcher.js (but requires content-script to be injected, which it is). Add error handler in event listener

**YouTube Quality Detection Itag Mapping Incomplete:**
- Symptoms: Some YouTube streams appear with quality "N/A" instead of resolution
- Files: Content-script or background likely uses incomplete itag mapping
- Trigger: YouTube releases new codec/itag combinations not in YOUTUBE_ITAG_QUALITY object
- Workaround: User can infer quality from filename or YouTube page
- Fix approach: Extract resolution from videoDetails in yt-initial-data JSON response instead of relying on itag mapping

## Security Considerations

**API Keys Stored in chrome.storage.local (Plain):**
- Risk: Users' DeepSeek/OpenAI/Anthropic API keys are stored unencrypted in `chrome.storage.local`
- Files: `background.js` (lines 153-206), `lib/ai-providers.js` (lines 39-49)
- Current mitigation: Keys visible only to extension code; Chrome extension storage is sandboxed per extension per profile. No cloud sync by default
- Recommendations:
  - Document that API keys are stored unencrypted locally (add warning in Settings tab)
  - Consider chrome.storage.session (clears on browser close) as option for sensitive keys
  - Never log or expose keys in error messages (currently hidden with redactSensitiveText in background.js line 59-71, good practice)

**<all_urls> Permissions with webRequest:**
- Risk: Extension monitors ALL network traffic on every domain, can see video URLs from private/corporate intranets
- Files: `manifest.json` (lines 19, 30)
- Current mitigation: Videos stored only in memory per tab; no exfiltration code
- Recommendations:
  - Document that extension can see all network traffic (privacy policy in Settings)
  - Add option to exclude certain domains from monitoring
  - Never store video metadata with referer URLs or cookies

**Fetch without Origin Validation (Sitemap):**
- Risk: `FETCH_SITEMAP` message handler accepts any URL and fetches it, no origin check
- Files: `background.js` (lines 307-326)
- Current mitigation: Only content-script can initiate fetch (can't be called from web page)
- Recommendations:
  - Validate URL starts with `http://` or `https://` (prevent file:// access)
  - Add allowlist of expected sitemap hosts or require user confirmation for off-domain URLs
  - Add timeout to prevent hanging requests

**Redaction Regex May Miss API Key Variants:**
- Risk: `redactSensitiveText` regex (line 65-70) only catches `sk-` prefixed OpenAI keys, misses other formats
- Files: `background.js` (lines 59-71)
- Current mitigation: Catches most common patterns (Bearer tokens, password= assignments)
- Recommendations:
  - Test regex against all supported AI provider key formats (DeepSeek uses different prefix)
  - Add explicit redaction for more key formats before sending to AI API
  - Log redaction hits for debugging (without exposing actual keys)

**Content-Script Injection on All Frames:**
- Risk: `all_frames: true` in manifest.json (line 32) injects content-script into iframes, including ads and tracking pixels
- Files: `manifest.json` (line 32)
- Current mitigation: content-script is lightweight; tracking iframes can't exploit it
- Recommendations:
  - Consider set to false and inject only when needed via chrome.scripting.executeScript
  - Monitor iframe origin to prevent hostile frame injection

## Performance Bottlenecks

**DOMParser Heavy Usage in watcher.js:**
- Problem: genericStreamParser uses `new DOMParser()` on every MPD/XML response (line 542). DOMParser is synchronous and blocks page
- Files: `watcher.js` (lines 540-566)
- Cause: DASH manifests can be large (>100KB). No async XML parsing available in page context
- Improvement path:
  - Cache DOMParser instance or reuse across responses
  - Limit DOMParser invocation to responses with `<MPD` in first 500 chars (early exit)
  - Move XML parsing to background service worker via message (but adds IPC overhead)

**Recursive searchKeyRecursive on Large JSON:**
- Problem: Twitter parser uses deep recursion (line 93-110) to find `video_versions` in massive JSON trees
- Files: `watcher.js` (lines 93-110)
- Cause: No index or structure knowledge; must traverse every property
- Improvement path:
  - Pre-filter JSON with regex to extract relevant section before parsing
  - Limit recursion depth to 20 levels (prevent stack overflow on circular refs)
  - Use iterative BFS instead of recursive DFS for large trees

**Console Log Deduplication Full Scan:**
- Problem: `dedupeEntries` in content-script.js scans entire log array to find matches (line ~168-212)
- Files: `content-script.js` (lines 168-212 approx)
- Cause: O(n²) complexity when many duplicate logs exist
- Improvement path:
  - Use Map/Set to track unique keys in single pass
  - Dedupe incrementally as logs arrive instead of batch dedup

**Fetching Huge Sitemaps Without Pagination:**
- Problem: Sitemap with 50k+ URLs fetched entirely into memory (line 307-326)
- Files: `background.js` (lines 307-326)
- Cause: No streaming or pagination support
- Improvement path:
  - Add max URL limit (e.g., 10k) and warn user if exceeded
  - Parse XML streaming instead of full load
  - Cache sitemap for 1 hour to avoid re-fetching

**Video List Rendering Without Virtualization:**
- Problem: popup.js renders ALL detected videos at once (potentially 1000s)
- Files: `popup.js` (video rendering logic, ~2200-2360)
- Cause: No virtualization or lazy rendering
- Improvement path:
  - Show first 50 videos, load more on scroll
  - Add search/filter above list to pre-filter before render

## Fragile Areas

**Instagram DASH Segment Deduplication Logic:**
- Files: `content-script.js` or `background.js` (getCanonicalVideoUrl function)
- Why fragile: `bytestart`/`byteend` parsing assumes fixed format; Instagram API changes break it. No fallback for videos without range metadata
- Safe modification: Add try-catch around getCanonicalVideoUrl calls. Log when dedup fails to console
- Test coverage: Gaps in dedup tests; need test for malformed range headers

**Site-Specific Parsers in watcher.js (Instagram, Twitter, Vimeo, etc.):**
- Files: `watcher.js` (lines 115-502)
- Why fragile: 11 inline parser implementations; each tied to specific API response format. Single API change breaks parser (e.g., Instagram JSON field rename)
- Safe modification:
  - Never modify parser array order (genericStreamParser must stay last)
  - Add `try-catch` around each parser's onLoad call (already done at line 600-602, good)
  - Test each parser after extension updates against live sites
- Test coverage: No automated parser tests; manual testing required for each site

**postMessage Bridge Between Contexts:**
- Files: `watcher.js` (line 40, 65), `content-script.js` (line 1129)
- Why fragile: CustomEvent doesn't cross isolation boundary; relies on window.postMessage + message event listener. If listener removed or message type changed, videos silently fail
- Safe modification: Never rename '__dt_xhr_response' or 'videos-found' events. Both watcher.js and content-script must stay in sync
- Test coverage: No integration test verifying bridge works end-to-end

**AI Configuration Switcher in popup.js:**
- Files: `popup.js` (lines 250-450 approx, switchProvider function)
- Why fragile: Switching providers requires clearing old config, loading new config, updating UI. State sync bugs if steps not atomic
- Safe modification: Ensure all async loads complete before rendering UI. Use Promise.all() for provider switch
- Test coverage: Missing tests for provider switch with missing API keys

**YouTube Detection via webRequest:**
- Files: `background.js` (webRequest listener)
- Why fragile: YouTube uses base64-encoded video URLs; detection relies on content-type matching. URL patterns change frequently
- Safe modification: Don't assume video URL format. Always check content-type header (already done, good)
- Test coverage: YouTube tests needed; may have broken if YouTube changed streaming architecture

## Scaling Limits

**tabVideoData Memory (Current Capacity):**
- Current capacity: ~1,000 video objects per tab before slowdown (each object ~200-500 bytes)
- Limit: 50-100 MB per extension instance (Chrome extension memory limits vary by device)
- Scaling path:
  - Implement max 500 videos per tab with eviction
  - Move to IndexedDB if persistence needed
  - Dedupe identical URLs to reduce count

**Sitemap URL Count:**
- Current capacity: ~10k URLs before UI slowdown
- Limit: Single fetch, XML parsing, and render in popup
- Scaling path:
  - Pagination (load 100 at a time)
  - Search before render
  - Export to file instead of showing in UI

**Console Log Capture:**
- Current capacity: LOG_LIMIT = 5000 logs (line 1-6 of content-script.js)
- Limit: Hard cap at 5000 entries per tab
- Scaling path: Consider rolling buffer (keep last 10k, discard oldest)

## Dependencies at Risk

**Chrome webRequest API Deprecation:**
- Risk: Chrome is phasing out webRequest in favor of declarativeNetRequest (DNR)
- Impact: Video detection via webRequest will break in future Chrome versions
- Migration plan:
  - Implement declarativeNetRequest rules as fallback
  - Test with Chrome's migration path (available in Canary builds)
  - Maintain both implementations during transition period

**Fetch Response.clone() on Large Files:**
- Risk: If web page or extension starts cloning responses, memory exhaustion on video files
- Impact: Page slowdown when downloading videos
- Migration plan:
  - Add response size check before clone (current code doesn't)
  - Use ReadableStream for large responses instead of clone

## Test Coverage Gaps

**Video Detection Deduplication:**
- What's not tested: getCanonicalVideoUrl() for all site types (YouTube itag, Instagram byterange, generic URL)
- Files: Dedup logic likely in background.js or content-script.js
- Risk: Duplicates silently appear in video list if canonical keys don't match
- Priority: High — directly affects user experience

**AI Provider Error Handling:**
- What's not tested: Rate limiting responses (HTTP 429), timeout behavior, malformed JSON from new provider versions
- Files: `background.js` (lines 230-268), `lib/ai-providers.js`
- Risk: AI summarize silently fails or shows cryptic error if provider returns unexpected format
- Priority: Medium — affects AI brief feature only

**postMessage Bridge End-to-End:**
- What's not tested: Videos detected in watcher.js actually reach popup; message ordering; rapid fire events
- Files: `watcher.js`, `content-script.js`, `popup.js`
- Risk: Videos appear in popup but not all are transmitted
- Priority: High — core feature

**Site-Specific Parsers (All 11):**
- What's not tested: Each parser against current site API responses (Instagram, Twitter, Vimeo, Reddit, Twitch, Kick, Pornhub, XVideos, HLS, DASH, generic)
- Files: `watcher.js` (lines 115-567)
- Risk: Parser silently fails if API changes; users think extension is broken
- Priority: High — requires quarterly regression testing against live sites

**CSP Violation Edge Cases:**
- What's not tested: Extension on pages with restrictive Content-Security-Policy headers
- Files: `content-script.js`, `watcher.js` injection (lines 29-43)
- Risk: Script injection fails silently; no video detection or console capture
- Priority: Medium — affects corporate/regulated sites

**Browser Restart/Suspend:**
- What's not tested: Extension state after browser suspend/resume or tab suspend
- Files: `background.js` service worker, tabVideoData
- Risk: Videos disappear after browser sleep
- Priority: Low — expected behavior (videos are session-only)

---

*Concerns audit: 2026-02-15*
