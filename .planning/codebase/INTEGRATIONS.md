# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**AI/LLM Providers:**
- **DeepSeek** - Code summarization and log analysis
  - SDK/Client: Native `fetch` API
  - Endpoint: `https://api.deepseek.com/chat/completions`
  - Auth: Bearer token via `Authorization: Bearer {api_key}`
  - Models: `deepseek-chat`, `deepseek-reasoner`
  - Default model: `deepseek-chat`

- **OpenAI** - Alternative AI provider for console summarization
  - SDK/Client: Native `fetch` API
  - Endpoint: `https://api.openai.com/v1/chat/completions`
  - Auth: Bearer token via `Authorization: Bearer {api_key}`
  - Models: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
  - Default model: `gpt-4o-mini`

- **Anthropic (Claude)** - Alternative AI provider
  - SDK/Client: Native `fetch` API
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Auth: Custom header `x-api-key: {api_key}`, `anthropic-version: 2023-06-01`
  - Models: `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`
  - Default model: `claude-sonnet-4-20250514`

- **Ollama (Local)** - Self-hosted LLM option (no cloud required)
  - SDK/Client: Native `fetch` API
  - Endpoint: `http://localhost:11434/api/chat` (configurable)
  - Auth: None (local)
  - Models: User-configured
  - Default model: Empty (user must select)

**Configuration File:**
- `lib/ai-providers.js` - Provider registry with endpoints, models, auth types, response parsers

**AI API Call Flow:**
1. User triggers "AI Brief" or summarization in popup
2. `popup.js` sends `AI_SUMMARIZE` message to background
3. `background.js` calls `callAiProvider()` with selected provider config
4. Builds request via `buildFetchOptions()` (handles auth headers per provider)
5. POSTs to provider endpoint with system/user prompts
6. Parses response via `parseAiResponse()` (handles Anthropic, OpenAI, Ollama response formats)
7. Returns summary + token usage to popup

## Data Storage

**Databases:**
- None - This is a client-side extension only

**Local Storage:**
- `chrome.storage.local` (Persistent, sync'd per profile)
  - Scope: `PROVIDER_STORAGE_KEYS` in `lib/ai-providers.js`
  - Data: API keys, selected models, provider preferences
  - Keys:
    - `ai_active_provider` - Selected provider name
    - `deepseek_api_key`, `openai_api_key`, `anthropic_api_key` - API credentials
    - `deepseek_model`, `openai_model`, `anthropic_model` - Model selections
    - `ollama_base_url` - Ollama server location

**File Storage:**
- Chrome Downloads API - Save downloaded videos to user's Downloads folder
- Request type: `DOWNLOAD_VIDEO` in `background.js` line 297
- Uses: `chrome.downloads.download({ url, filename })`

**Caching:**
- In-memory video storage per tab: `tabVideoData` object in `background.js`
- Cleared when tab navigates or closes
- No persistent cache for videos

## Content Delivery & Network Monitoring

**Video Detection Mechanisms:**
1. **WebRequest Network Monitoring** (`background.js`):
   - Monitors `chrome.webRequest.onCompleted` for video content-types
   - Intercepts URLs with MIME types: `video/mp4`, `video/webm`, `application/x-mpegURL`, `application/dash+xml`
   - Filters files < 50KB to reduce noise
   - Triggers `addVideoLinks(tabId)` for matching requests

2. **XHR/Fetch Interception** (`watcher.js`):
   - Intercepts XMLHttpRequest and fetch in page context
   - CustomEvent dispatches on `__dt_xhr_response`
   - Site-specific parsers analyze response bodies for video URLs

3. **Site-Specific Parsers** (`watcher.js` lines 112-570):
   - Instagram: Extracts from `video_versions` in API responses
   - Twitter/X: Parses `video_info` variants from tweet data
   - Vimeo: Extracts progressive and HLS URLs from `/config` responses
   - Reddit: Parses video manifest and DASH URLs
   - Twitch: Extracts from stream metadata
   - Kick: Extracts stream URLs
   - Pornhub: DASH segment detection
   - XVideos: Video metadata parsing
   - Generic HLS/DASH: Regex-based m3u8 and mpd detection

**Sitemap Fetching:**
- Request type: `FETCH_SITEMAP` in `background.js` line 307
- Fetches `sitemap.xml` or `robots.txt` from origin
- Uses: `fetch(url, { headers: { Accept: 'application/xml, text/xml, text/plain' } })`
- Parsed in popup for site exploration

## Authentication & Identity

**Auth Provider:**
- Custom - No centralized auth service
- Users manually provide API keys in extension Settings tab
- Keys stored in `chrome.storage.local` (user's profile, not synced externally)

**Auth Types per Provider:**
- DeepSeek: Bearer token in `Authorization` header
- OpenAI: Bearer token in `Authorization` header
- Anthropic: `x-api-key` header + `anthropic-version` header
- Ollama: None (local HTTP)

**Security Measures:**
- API key redaction in logs: `redactSensitiveText()` in `background.js` line 59
  - Redacts `Bearer` tokens, `sk-` keys, password/token/secret values
  - Applied before sending logs to AI providers
- Sensitive text redaction in console capture (prevents leaking secrets to AI)

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, Rollbar, or external error reporting

**Logs:**
- Browser console capture in popup (Console Signal feature)
- Log formatting options: AI Compact (XML/JSON), Plain text
- Max 5000 logs stored per session (`LOG_LIMIT` in `content-script.js`)
- AI summarization condenses logs for debugging

**Event Emission:**
- postMessage bridge for page-to-content-script communication
- CustomEvent dispatching: `__dt_xhr_response`, `videos-found`, `__CONSOLE_CAPTURE_EVENT__`

## CI/CD & Deployment

**Hosting:**
- Local machine (dev): `chrome://extensions` load unpacked
- Chrome Web Store (optional - not currently deployed)

**CI Pipeline:**
- None detected

**Version Control:**
- Git repository at `.git/`
- Manifest version: `"version": "1.0.0"` in `manifest.json`

## Environment Configuration

**Required env vars:**
- None in traditional sense (not a Node.js app)

**User-Configurable Settings:**
(Stored in `chrome.storage.local`)
- AI Provider selection
- AI API keys (per provider)
- AI Model selection (per provider)
- Ollama base URL
- Video detection preferences (inferred from code)
- Console log formatting
- AI summary style (brief/full/custom)

**Secrets location:**
- Stored in: `chrome.storage.local` via `chrome.storage.local.set()`
- Profile-specific, not synced externally
- NOT in .env files (extension doesn't use them)
- User's machine storage only

## Webhooks & Callbacks

**Incoming:**
- Chrome extension messaging only - No external webhooks
- Message handlers in `background.js` lines 272+:
  - `add-video-links` - Content script reports detected videos
  - `GET_TAB_VIDEOS` - Popup requests videos for tab
  - `DOWNLOAD_VIDEO` - Popup triggers download
  - `FETCH_SITEMAP` - Popup requests sitemap
  - `AI_SUMMARIZE` / `AI_GET_CONFIG` / `AI_SAVE_CONFIG` - AI provider config

**Outgoing:**
- HTTP POST to AI providers (DeepSeek, OpenAI, Anthropic, Ollama)
- HTTP GET for sitemap.xml fetching
- No webhook deliveries to external services

## Content Security

**Content Script Injection:**
- `content-script.js` runs on all URLs (except YouTube)
- Injects `watcher.js` and `page-logger.js` via `chrome.runtime.getURL()`
- postMessage bridge prevents cross-origin data leakage
- Sender verification: `sender.id !== chrome.runtime.id` check to prevent external messages

**Manifest Security:**
- `host_permissions: ["<all_urls>"]` - Access to all websites
- Content script excluded from YouTube (handled by webRequest instead)
- Web accessible resources limited to `watcher.js` and `page-logger.js`

---

*Integration audit: 2026-02-15*
