# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- JavaScript (ES6+) - Extension manifest, background service worker, content scripts, popup UI
- HTML - Popup interface structure (`popup.html`)
- CSS - Popup styling and dark theme (`popup.css`)

**Secondary:**
- XML/HTML parsing - Sitemap parsing and DOM manipulation

## Runtime

**Environment:**
- Chrome/Chromium Browser (Manifest V3)
- Service Worker (`background.js` with `type: "module"`)

**Package Manager:**
- No package manager - vanilla JavaScript, no build step, no node_modules

**Node/Runtime Version:**
- Not applicable - extension runs in browser context only

## Frameworks

**Core:**
- No frameworks - vanilla JavaScript only
- Chrome Extension APIs (MV3)
- Custom ES6 module architecture

**Testing:**
- Not detected

**Build/Dev:**
- No build tool - direct ES6 module support in manifest

## Key Dependencies

**External APIs (User-Provided):**
- DeepSeek Chat API - Configured via `lib/ai-providers.js`, endpoint: `https://api.deepseek.com/chat/completions`
- OpenAI Chat API - Endpoint: `https://api.openai.com/v1/chat/completions`
- Anthropic (Claude) API - Endpoint: `https://api.anthropic.com/v1/messages`
- Ollama (Local) - Self-hosted, default: `http://localhost:11434/api/chat`

**Browser APIs:**
- `chrome.runtime` - Message passing, extension context
- `chrome.tabs` - Tab management, active tab queries
- `chrome.storage.local` - Persistent key-value storage for settings and API keys
- `chrome.downloads` - Video file downloads
- `chrome.action` - Popup action, badge updates
- `chrome.webRequest` - Network request monitoring (mentioned in memory, used for video detection)
- `chrome.scripting` - Inject scripts into pages
- `chrome.webRequest.onCompleted` - Detect video downloads from network traffic
- `chrome.webRequest.onBeforeRequest` - Monitor request patterns

**Standard APIs:**
- `XMLHttpRequest` - Intercepted for XHR monitoring
- `fetch` - Native fetch API, intercepted for request monitoring
- `localStorage` - Not used (uses `chrome.storage.local`)
- `JSON` - Parsing/stringifying responses
- `CustomEvent` / `postMessage` - Page-to-content-script communication bridge

## Configuration

**Environment:**
- Chrome Storage Local (`chrome.storage.local.get/set`) - Stores:
  - `ai_active_provider` - Selected AI provider
  - `{provider}_api_key` - API keys (deepseek_api_key, openai_api_key, anthropic_api_key)
  - `{provider}_model` - Model selections
  - `ollama_base_url` - Ollama server location

**Build:**
- No build config - ES6 modules declared in `manifest.json` with `"type": "module"`
- Manifest Version: 3
- Web accessible resources: `watcher.js`, `page-logger.js`

## Permissions & Access

**Chrome Permissions (manifest.json):**
```json
{
  "permissions": ["storage", "tabs", "webRequest", "downloads", "scripting", "activeTab"],
  "host_permissions": ["<all_urls>"]
}
```

**Content Script Scope:**
- Runs on all URLs except `*://www.youtube.com/*` (handled via webRequest instead)
- Runs at `document_start` for early DOM access
- `all_frames: true` - Runs in all iframe contexts

**Web Accessible Resources:**
- `watcher.js` - Injected into page context for XHR/fetch interception
- `page-logger.js` - Injected into page context for console capture

## Platform Requirements

**Development:**
- Any machine running Chrome/Chromium
- No build dependencies
- Text editor for development
- No Node.js required

**Production:**
- Chrome 88+ (MV3 support required)
- Internet connection for AI API calls (optional - can use local Ollama)
- User-provided API keys for DeepSeek/OpenAI/Anthropic

## Deployment

**Installation:**
- Manual: Load unpacked extension from `chrome://extensions`
- Distribution: Chrome Web Store (if published)

**Update Mechanism:**
- Chrome auto-update for published extensions
- Manual refresh in dev mode

---

*Stack analysis: 2026-02-15*
