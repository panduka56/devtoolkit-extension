# DevToolkit Unified Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Chrome MV3 extension that combines deobfuscated video downloading with Console Signal's developer tools, stripped of all branding and bloat.

**Architecture:** Single Chrome extension with tabbed popup UI (Video, Console, Page Intel, Context, Settings). Content script merges video relay + console capture + SEO/context extraction. Background service worker handles video storage, AI API calls, and sitemap fetching. No frameworks, no build step, vanilla JS with ES modules.

**Tech Stack:** Chrome Extension MV3, vanilla JavaScript (ES modules), HTML/CSS, Chrome APIs (webRequest, downloads, storage, tabs, scripting)

---

### Task 1: Clean Project & Create Skeleton

**Files:**
- Delete: all existing files except `docs/plans/` directory
- Create: `manifest.json`, `popup.html`, `popup.css`, `popup.js`, `background.js`, `content-script.js`, `page-logger.js`, `watcher.js`, `lib/ai-providers.js`, `lib/video-parsers.js`, `icons/`, `_locales/en/messages.json`

**Step 1: Remove old files (preserve docs)**

```bash
cd /Users/panduka/Sites/VideoDownloader
# Move docs out temporarily
cp -r docs /tmp/devtoolkit-docs-backup
# Remove everything
rm -rf *
rm -rf .* 2>/dev/null || true
# Restore docs
cp -r /tmp/devtoolkit-docs-backup docs
```

**Step 2: Initialize git repo**

```bash
cd /Users/panduka/Sites/VideoDownloader
git init
echo "node_modules/" > .gitignore
```

**Step 3: Create directory structure**

```bash
mkdir -p lib icons _locales/en
```

**Step 4: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "DevToolkit",
  "description": "Video downloader, console capture, SEO scanner, and AI-powered developer tools.",
  "version": "1.0.0",
  "icons": {
    "32": "icons/icon-32.png",
    "64": "icons/icon-64.png",
    "128": "icons/icon-128.png"
  },
  "permissions": [
    "storage",
    "tabs",
    "webRequest",
    "downloads",
    "scripting",
    "activeTab"
  ],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_title": "DevToolkit",
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "all_frames": true,
      "exclude_matches": ["*://www.youtube.com/*"],
      "run_at": "document_start"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["watcher.js", "page-logger.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

**Step 5: Create _locales/en/messages.json**

```json
{
  "name": { "message": "DevToolkit" },
  "desc": { "message": "Video downloader, console capture, SEO scanner, and AI-powered developer tools." }
}
```

**Step 6: Create placeholder icon files**

Generate simple SVG-based PNG icons (32, 64, 128) — a green terminal/toolkit icon on dark background. For now, copy Console Signal's icons or use simple solid-color placeholders.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize DevToolkit extension skeleton"
```

---

### Task 2: Port AI Providers Module

**Files:**
- Create: `lib/ai-providers.js`
- Source: `/Users/panduka/Sites/Chome-Extention/src/lib/ai-providers.js`

**Step 1: Copy ai-providers.js from Console Signal**

Copy the file verbatim from Console Signal. This module is clean, well-structured, and needs no changes. It exports:
- `AI_PROVIDERS` — config for DeepSeek, OpenAI, Anthropic, Ollama
- `PROVIDER_STORAGE_KEYS` — storage key constants
- `buildFetchOptions()` — builds fetch request for each provider
- `parseAiResponse()` — parses response from each provider

```bash
cp /Users/panduka/Sites/Chome-Extention/src/lib/ai-providers.js /Users/panduka/Sites/VideoDownloader/lib/ai-providers.js
```

**Step 2: Commit**

```bash
git add lib/ai-providers.js
git commit -m "feat: port AI providers module from Console Signal"
```

---

### Task 3: Deobfuscate & Extract Video Parsers

**Files:**
- Create: `lib/video-parsers.js`
- Reference: original `/Users/panduka/Sites/VideoDownloader/watcher.js` (backed up before Task 1)

**Step 1: Back up original watcher.js before cleanup**

Before Task 1 deletes it, ensure we have a backup:
```bash
cp /tmp/devtoolkit-docs-backup/../watcher.js.bak /Users/panduka/Sites/VideoDownloader/lib/video-parsers-reference.js 2>/dev/null || true
```

If the backup isn't available, the deobfuscated logic from the design exploration is sufficient.

**Step 2: Create lib/video-parsers.js with deobfuscated site parsers**

This extracts the 4 site-specific parser classes from the minified watcher.js, plus adds new parsers for Reddit, Twitch, Kick, Pornhub, XVideos, and enhanced HLS/DASH.

```javascript
// lib/video-parsers.js
// Deobfuscated from Qooly Video Downloader + new parsers

function generateId() {
  let id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36).substr(3);
  for (let i = 0; i < id.length; i++) {
    if (Math.random() > 0.5) {
      id = id.substr(0, i) + id[i].toUpperCase() + id.substr(i + 1);
    }
  }
  return id;
}

function searchKeyRecursive(obj, targetKey, results = []) {
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    if (key === targetKey && obj[key]) {
      if (obj.caption?.text && obj[key].length) {
        for (let i = 0; i < obj[key].length; i++) {
          obj[key][i].title = obj.caption?.text;
        }
      }
      results.push(obj[key]);
    }
    if (typeof obj[key] === 'object') {
      searchKeyRecursive(obj[key], targetKey, results);
    }
  }
  return results;
}

// --- Instagram Parser ---
const instagramParser = {
  origins: ['www.instagram.com'],
  onLoad(responseText, requestUrl) {
    // Skip stories and single post/reel pages (those use different extraction)
    if (document.location.href.match(/https?:\/\/.+\/(stories(\/highlights)?)\/.+/)) return;
    if (document.location.href.match(/https?:\/\/.+\/(p|reels?)\/.+/)) return;
    if (!responseText.match('video_versions')) return;

    try {
      const data = JSON.parse(responseText.replaceAll('for (;;);', ''));
      const videoVersions = searchKeyRecursive(data, 'video_versions');
      if (videoVersions?.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videoVersions }));
      }
    } catch (e) { /* ignore parse errors */ }
  },
};

// --- Vimeo Parser ---
const vimeoParser = {
  origins: [/vimeo\.com/],
  onLoad(responseText, requestUrl) {
    if (!requestUrl.match('/config')) return;

    try {
      const data = JSON.parse(responseText);
      const title = document.querySelector('#main main h1')?.innerText || document.title;
      const progressive = data.request.files.progressive;
      const videos = [];

      if (progressive) {
        for (const item of progressive) {
          videos.push({ fileName: title, url: item.url, quality: item.width });
        }
      }

      if (!videos.length && data.request.files?.hls?.cdns) {
        for (const cdnKey in data.request.files.hls.cdns) {
          const hlsUrl = data.request.files.hls.cdns[cdnKey].url.replace(/\/subtitles\/.*\//, '/');
          if (!hlsUrl.match(/^https?:\/\/cme-media\.vimeocdn\.com/)) {
            videos.push({
              fileName: title,
              url: hlsUrl,
              playlist: true,
              quality: data.video?.height || 'N/A',
            });
          }
        }
      }

      if (videos?.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
    } catch (e) { /* ignore */ }
  },
};

// --- Twitter/X Parser ---
const twitterParser = {
  origins: [/x\.com/, /twitter\.com/],
  onLoad(responseText, requestUrl) {
    if (!responseText.match('video_info')) return;

    try {
      const data = JSON.parse(responseText);
      const title = document.title;
      const videoInfos = searchKeyRecursive(data, 'video_info');
      const videos = [];

      if (videoInfos?.length) {
        for (const info of videoInfos) {
          if (!info.variants?.length) continue;
          for (const variant of info.variants) {
            if (variant?.content_type === 'application/x-mpegURL') continue;
            let quality = 'N/A';
            try {
              if (variant.url.match(/avc1\/\d*x\d*/)) {
                quality = variant.url.match(/avc1\/\d*x\d*/)[0].replace(/avc1\//gi, '').split('x')[0];
              }
            } catch (e) { /* ignore */ }
            videos.push({ url: variant.url, quality, title });
          }
        }
      }

      // Also check threaded conversation entries for embedded media
      const instructions = data.data?.threaded_conversation_with_injections_v2?.instructions;
      if (instructions?.[0]?.type === 'TimelineAddEntries') {
        for (const entry of instructions[0].entries) {
          const media = entry.content?.itemContent?.tweet_results?.result?.legacy?.entities?.media;
          if (!media) continue;
          const tweetTitle = entry.content?.itemContent?.tweet_results?.result?.legacy?.full_text || document.title;
          for (const mediaItem of media) {
            if (!mediaItem.video_info?.variants?.length) continue;
            const entryVideos = [];
            for (const variant of mediaItem.video_info.variants) {
              if (!variant?.url) continue;
              if (variant?.content_type === 'application/x-mpegURL') continue;
              let quality = 'N/A';
              try {
                if (variant.url.match(/avc1\/\d*x\d*/)) {
                  quality = variant.url.match(/avc1\/\d*x\d*/)[0].replace(/avc1\//gi, '').split('x')[0];
                }
              } catch (e) { /* ignore */ }
              entryVideos.push({ url: variant.url, quality, title: tweetTitle });
            }
            if (entryVideos.length) {
              window.dispatchEvent(new CustomEvent('videos-found', { detail: entryVideos }));
            }
          }
        }
      }

      if (videos?.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
    } catch (e) { /* ignore */ }
  },
};

// --- HLS Streaming Parser ---
const hlsParser = {
  origins: ['hls.enjoy24cdn.com', '928hd.tv', 'showhd9.com'],
  onLoad(responseText, requestUrl) {
    if (!responseText.match('#EXTM3U')) return;

    const title = document.title || document.querySelector('h1.entry-title')?.innerText || '';
    const videos = [];

    if (responseText.match(/#EXT-X-STREAM-INF:/)) {
      const segments = responseText.split(/#EXT-X-STREAM-INF:/);
      for (const segment of segments) {
        const entry = { url: '', quality: '', playlist: true, fileName: title, stream: true, id: generateId(), isAdditional: false };
        const parts = segment.split(/\s|,/);
        for (const part of parts) {
          try {
            if (part.match('RESOLUTION=')) {
              entry.quality = part.split('=')[1];
              if (entry.quality) {
                entry.quality = entry.quality.split('x')[1] + 'p';
              }
            }
          } catch (e) { /* ignore */ }
          entry.url = part;
        }
        if (entry.url) {
          videos.push({ fileName: entry.fileName, url: entry.url, playlist: true, quality: entry.quality || 'N/A' });
        }
      }
    }

    if (videos?.length) {
      window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
    }
  },
};

// --- Generic HLS/DASH Parser (catches any site) ---
const genericStreamParser = {
  origins: [/.*/],
  onLoad(responseText, requestUrl) {
    // HLS detection
    if (responseText.includes('#EXTM3U') && responseText.includes('#EXT-X-STREAM-INF')) {
      // Already handled by hlsParser for specific sites, but catch all others
      const title = document.title || '';
      const videos = [];
      const segments = responseText.split(/#EXT-X-STREAM-INF:/);
      for (const segment of segments) {
        if (!segment.trim()) continue;
        const lines = segment.trim().split('\n');
        let quality = 'N/A';
        let url = '';
        for (const line of lines) {
          if (line.includes('RESOLUTION=')) {
            const match = line.match(/RESOLUTION=(\d+)x(\d+)/);
            if (match) quality = match[2] + 'p';
          }
          if (line.trim() && !line.startsWith('#')) {
            url = line.trim();
          }
        }
        if (url) {
          videos.push({ fileName: title, url, playlist: true, quality });
        }
      }
      if (videos.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
      return;
    }

    // DASH MPD detection
    if (responseText.includes('<MPD') && responseText.includes('</MPD>')) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(responseText, 'text/xml');
        const title = document.title || '';
        const videos = [];
        const representations = doc.querySelectorAll('Representation[mimeType^="video"]');
        for (const rep of representations) {
          const width = rep.getAttribute('width');
          const height = rep.getAttribute('height');
          const bandwidth = rep.getAttribute('bandwidth');
          const baseUrl = rep.querySelector('BaseURL');
          if (baseUrl?.textContent) {
            videos.push({
              fileName: title,
              url: baseUrl.textContent,
              quality: height ? `${height}p` : 'N/A',
              bandwidth: bandwidth ? parseInt(bandwidth) : null,
            });
          }
        }
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }
  },
};

// --- Reddit Parser ---
const redditParser = {
  origins: [/reddit\.com/, /redd\.it/],
  onLoad(responseText, requestUrl) {
    // Reddit uses DASH manifests for video
    if (requestUrl.includes('v.redd.it') && responseText.includes('<MPD')) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(responseText, 'text/xml');
        const title = document.title || '';
        const videos = [];
        const representations = doc.querySelectorAll('Representation[mimeType^="video"]');
        for (const rep of representations) {
          const height = rep.getAttribute('height');
          const baseUrl = rep.querySelector('BaseURL');
          if (baseUrl?.textContent) {
            let videoUrl = baseUrl.textContent;
            if (!videoUrl.startsWith('http')) {
              videoUrl = requestUrl.replace(/\/[^/]*$/, '/') + videoUrl;
            }
            videos.push({ fileName: title, url: videoUrl, quality: height ? `${height}p` : 'N/A' });
          }
        }
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }

    // Reddit JSON API responses
    if (responseText.includes('reddit_video') || responseText.includes('fallback_url')) {
      try {
        const data = JSON.parse(responseText);
        const videos = [];
        const findRedditVideos = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.reddit_video?.fallback_url) {
            videos.push({
              fileName: obj.title || document.title,
              url: obj.reddit_video.fallback_url,
              quality: obj.reddit_video.height ? `${obj.reddit_video.height}p` : 'N/A',
            });
          }
          for (const val of Object.values(obj)) {
            if (typeof val === 'object') findRedditVideos(val);
          }
        };
        findRedditVideos(data);
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }
  },
};

// --- Twitch Parser ---
const twitchParser = {
  origins: [/twitch\.tv/],
  onLoad(responseText, requestUrl) {
    // Twitch clip metadata
    if (responseText.includes('videoQualities') || responseText.includes('clip_video_url')) {
      try {
        const data = JSON.parse(responseText);
        const videos = [];
        const findClipUrls = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.videoQualities && Array.isArray(obj.videoQualities)) {
            for (const q of obj.videoQualities) {
              if (q.sourceURL) {
                videos.push({
                  fileName: obj.title || document.title,
                  url: q.sourceURL,
                  quality: q.quality ? `${q.quality}p` : 'N/A',
                });
              }
            }
          }
          for (const val of Object.values(obj)) {
            if (typeof val === 'object') findClipUrls(val);
          }
        };
        findClipUrls(data);
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }

    // Twitch HLS playlists (VODs)
    if (responseText.includes('#EXTM3U') && requestUrl.includes('usher.ttvnw.net')) {
      const title = document.title || '';
      const videos = [];
      const segments = responseText.split(/#EXT-X-STREAM-INF:/);
      for (const segment of segments) {
        if (!segment.trim()) continue;
        const lines = segment.trim().split('\n');
        let quality = 'N/A';
        let url = '';
        for (const line of lines) {
          const videoMatch = line.match(/VIDEO="([^"]+)"/);
          if (videoMatch) quality = videoMatch[1];
          if (line.trim() && !line.startsWith('#') && line.includes('http')) {
            url = line.trim();
          }
        }
        if (url) {
          videos.push({ fileName: title, url, playlist: true, quality });
        }
      }
      if (videos.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
    }
  },
};

// --- Kick Parser ---
const kickParser = {
  origins: [/kick\.com/],
  onLoad(responseText, requestUrl) {
    if (responseText.includes('video_url') || responseText.includes('clip')) {
      try {
        const data = JSON.parse(responseText);
        const videos = [];
        const findKickVideos = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.video_url || obj.clip_url) {
            videos.push({
              fileName: obj.title || document.title,
              url: obj.video_url || obj.clip_url,
              quality: 'N/A',
            });
          }
          for (const val of Object.values(obj)) {
            if (typeof val === 'object') findKickVideos(val);
          }
        };
        findKickVideos(data);
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }
  },
};

// --- Pornhub Parser ---
const pornhubParser = {
  origins: [/pornhub\.com/],
  onLoad(responseText, requestUrl) {
    if (responseText.includes('mediaDefinitions') || responseText.includes('quality_')) {
      try {
        const data = JSON.parse(responseText);
        const videos = [];
        const findMediaDefs = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj.mediaDefinitions)) {
            for (const def of obj.mediaDefinitions) {
              if (def.videoUrl && def.format === 'mp4') {
                videos.push({
                  fileName: document.title,
                  url: def.videoUrl,
                  quality: def.quality ? `${def.quality}p` : 'N/A',
                });
              }
            }
          }
          for (const val of Object.values(obj)) {
            if (typeof val === 'object') findMediaDefs(val);
          }
        };
        findMediaDefs(data);
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }
  },
};

// --- XVideos Parser ---
const xvideosParser = {
  origins: [/xvideos\.com/],
  onLoad(responseText, requestUrl) {
    if (responseText.includes('html5player.setVideoUrl')) {
      try {
        const videos = [];
        const urlMatches = responseText.match(/html5player\.setVideoUrl(Low|High|HLS)\('([^']+)'\)/g);
        if (urlMatches) {
          for (const match of urlMatches) {
            const parts = match.match(/setVideoUrl(Low|High|HLS)\('([^']+)'\)/);
            if (parts) {
              const quality = parts[1] === 'High' ? '720p' : parts[1] === 'Low' ? '360p' : 'HLS';
              videos.push({
                fileName: document.title,
                url: parts[2],
                quality,
                playlist: parts[1] === 'HLS',
              });
            }
          }
        }
        if (videos.length) {
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
        }
      } catch (e) { /* ignore */ }
    }
  },
};

export const parsers = [
  instagramParser,
  twitterParser,
  vimeoParser,
  hlsParser,
  redditParser,
  twitchParser,
  kickParser,
  pornhubParser,
  xvideosParser,
  genericStreamParser, // Must be last — catches anything the specific parsers miss
];

export { generateId, searchKeyRecursive };
```

**Step 3: Commit**

```bash
git add lib/video-parsers.js
git commit -m "feat: deobfuscated video parsers from Qooly + new site parsers"
```

---

### Task 4: Create watcher.js (XHR Interception)

**Files:**
- Create: `watcher.js`

**Step 1: Write the deobfuscated watcher.js**

This is the page-context script that intercepts XMLHttpRequest and runs site parsers. It cannot use ES modules (injected via script tag into page context).

```javascript
// watcher.js — Injected into page context to intercept XHR responses
// Deobfuscated from Qooly Video Downloader
(() => {
  if (window.__devToolkitWatcherInstalled) return;
  window.__devToolkitWatcherInstalled = true;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._dtMethod = method;
    this._dtUrl = url;
    this._dtRequestHeaders = {};
    this._dtStartTime = new Date().toISOString();
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this._dtRequestHeaders[name] = value;
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      const url = this._dtUrl ? this._dtUrl.toLowerCase() : this._dtUrl;
      if (!url) return;

      let responseText = '';
      try {
        responseText = this.responseText;
      } catch (e) {
        responseText = '';
      }

      if (!responseText) return;

      // Dispatch raw XHR response for content script to process
      window.dispatchEvent(new CustomEvent('__dt_xhr_response', {
        detail: {
          url: this._dtUrl,
          fullUrl: this._dtUrl.startsWith('http') ? this._dtUrl : document.location.origin + this._dtUrl,
          responseText,
          hostname: document.location.hostname,
        },
      }));
    });

    return originalSend.apply(this, arguments);
  };

  // Also intercept fetch for modern sites
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url) {
        const clone = response.clone();
        clone.text().then(text => {
          if (text) {
            window.dispatchEvent(new CustomEvent('__dt_xhr_response', {
              detail: {
                url,
                fullUrl: url.startsWith('http') ? url : document.location.origin + url,
                responseText: text,
                hostname: document.location.hostname,
              },
            }));
          }
        }).catch(() => { /* ignore */ });
      }
    } catch (e) { /* ignore */ }

    return response;
  };
})();
```

**Step 2: Commit**

```bash
git add watcher.js
git commit -m "feat: XHR/fetch interception watcher (deobfuscated + fetch support)"
```

---

### Task 5: Port page-logger.js from Console Signal

**Files:**
- Create: `page-logger.js`
- Source: `/Users/panduka/Sites/Chome-Extention/src/page-logger.js`

**Step 1: Copy page-logger.js verbatim**

```bash
cp /Users/panduka/Sites/Chome-Extention/src/page-logger.js /Users/panduka/Sites/VideoDownloader/page-logger.js
```

This file is clean and needs no changes. It wraps console methods and dispatches `__CONSOLE_CAPTURE_EVENT__` custom events.

**Step 2: Commit**

```bash
git add page-logger.js
git commit -m "feat: port page-logger.js from Console Signal"
```

---

### Task 6: Create content-script.js (Merged)

**Files:**
- Create: `content-script.js`
- Source references: Console Signal's `content-script.js` + Qooly's inject.js patterns

**Step 1: Write the merged content script**

This is the largest single file. It combines:
1. Console log capture (from Console Signal's content-script.js — all the log formatting, deduplication, report building, SEO extraction, structured data extraction, context extraction logic)
2. Video event relay (from Qooly's inject.js — listens for `videos-found` and relays to background)
3. XHR response processing (new — runs video parsers against intercepted XHR data)

The content script should:
- Inject both `page-logger.js` and `watcher.js` into the page context
- Listen for `__CONSOLE_CAPTURE_EVENT__` (console logs) and `__dt_xhr_response` (XHR responses)
- Run video parsers from `lib/video-parsers.js` against XHR responses
- Listen for `videos-found` events and relay to background
- Handle all message types: `GET_CAPTURED_CONSOLE`, `GET_AI_CONTEXT`, `GET_SEO_META`, `GET_STRUCTURED_DATA`

**Important:** Since content scripts can't use ES modules, the video parser logic must be inlined or loaded differently. The approach: import the parser origins/matching logic inline in the content script, and listen for the `videos-found` events that watcher.js triggers via parsers running in page context.

Actually, the architecture needs adjustment here: **parsers run in page context** (inside watcher.js), not in the content script. The content script just relays `videos-found` events to background. So we need to bundle the parsers into watcher.js OR have watcher.js dispatch raw XHR data and have a separate page-context script that runs parsers.

**Revised approach:** Keep it simple like the original. watcher.js dispatches raw `__dt_xhr_response` events. A second page-context script (`video-detector.js`) imports parsers and runs them. Content script listens for `videos-found` and relays.

For simplicity in this plan, we'll inline the parser logic directly in watcher.js (since it runs in page context and can't use modules). This is what the original Qooly extension does.

**Step 1 revised: Create watcher.js with inline parsers**

Update `watcher.js` from Task 4 to include the parser logic directly (since page-context scripts can't use ES modules). The `lib/video-parsers.js` from Task 3 becomes a reference/documentation file, and watcher.js contains the actual runtime code.

See Task 4 for the XHR interception. Add parser logic at the bottom:

Append to watcher.js:
```javascript
// --- Site-specific parsers (inline, from lib/video-parsers.js) ---
// [paste all parser objects and the matching logic here]

// Run parsers against each intercepted response
window.addEventListener('__dt_xhr_response', (event) => {
  const { fullUrl, responseText, hostname } = event.detail;
  for (const parser of parsers) {
    for (const origin of parser.origins) {
      const matchUrl = fullUrl.startsWith('http') ? fullUrl : document.location.origin + fullUrl;
      if (
        (origin instanceof RegExp && hostname.match(origin)) ||
        hostname === origin
      ) {
        try {
          parser.onLoad(responseText, matchUrl);
        } catch (e) { /* ignore parser errors */ }
        break;
      }
    }
  }
});
```

**Step 2: Write content-script.js**

Port Console Signal's content-script.js (all ~1186 lines) and add video relay logic. The video relay is small — just listen for `videos-found` and forward to background:

At the top of the Console Signal content script IIFE, after `injectPageLogger()`, add:

```javascript
function injectWatcher() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('watcher.js');
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Relay video detection events to background
window.addEventListener('videos-found', (event) => {
  if (!event.detail?.length) return;
  const videoLinks = [];
  for (const item of event.detail) {
    if (Array.isArray(item)) {
      for (const v of item) {
        videoLinks.push({
          url: v.url,
          quality: v.quality || 'N/A',
          fileName: v.title || v.fileName || document.title,
          id: v.id || generateId(),
          playlist: v.playlist || false,
        });
      }
    } else {
      videoLinks.push({
        url: item.url,
        quality: item.quality || 'N/A',
        fileName: item.title || item.fileName || document.title,
        id: item.id || generateId(),
        playlist: item.playlist || false,
      });
    }
  }
  if (videoLinks.length) {
    chrome.runtime.sendMessage({ message: 'add-video-links', videoLinks });
  }
});
```

And call `injectWatcher()` alongside `injectPageLogger()` in the initialization.

**Step 3: Commit**

```bash
git add content-script.js watcher.js
git commit -m "feat: merged content script (console capture + video relay + SEO/context)"
```

---

### Task 7: Create background.js (Merged Service Worker)

**Files:**
- Create: `background.js`
- Source references: Console Signal's `background.js` + Qooly's `bg.js` patterns

**Step 1: Write background.js**

This merges:
1. Console Signal's background.js (AI summarize, config management, sitemap fetch) — port as-is
2. Video link storage per tab (from Qooly's bg.js)
3. Download management

```javascript
// background.js — Service worker
import { AI_PROVIDERS, PROVIDER_STORAGE_KEYS, buildFetchOptions, parseAiResponse } from './lib/ai-providers.js';

// === Video link storage (per tab) ===
const tabVideoData = {};

function getTabVideos(tabId) {
  if (!tabVideoData[tabId]) {
    tabVideoData[tabId] = { videos: [], badge: 0 };
  }
  return tabVideoData[tabId];
}

function addVideoLinks(tabId, videoLinks) {
  const tab = getTabVideos(tabId);
  for (const link of videoLinks) {
    // Dedupe by URL
    if (!tab.videos.some(v => v.url === link.url)) {
      tab.videos.push(link);
    }
  }
  tab.badge = tab.videos.length;
  // Update badge
  chrome.action.setBadgeText({ text: tab.badge > 0 ? String(tab.badge) : '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#11e8a4', tabId });
}

// Clear videos when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabVideoData[tabId] = { videos: [], badge: 0 };
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabVideoData[tabId];
});

// === AI config helpers (ported from Console Signal background.js) ===
// [Port all the AI config functions: getActiveProvider, getProviderConfig,
//  saveProviderConfig, setActiveProviderStorage, clearProviderKey,
//  trimToMaxChars, redactSensitiveText, buildSystemPrompt, buildUserPrompt,
//  callAiProvider — exactly as in Console Signal's background.js]

// === Message handler ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message) throw new Error('Invalid message.');

      // --- Video links ---
      if (message.message === 'add-video-links') {
        const tabId = sender.tab?.id;
        if (tabId && message.videoLinks) {
          addVideoLinks(tabId, message.videoLinks);
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'GET_TAB_VIDEOS') {
        const tabId = message.tabId;
        const data = tabVideoData[tabId] || { videos: [], badge: 0 };
        sendResponse({ ok: true, videos: data.videos });
        return;
      }

      if (message.type === 'DOWNLOAD_VIDEO') {
        chrome.downloads.download({
          url: message.url,
          filename: message.filename || undefined,
        }, (downloadId) => {
          sendResponse({ ok: true, downloadId });
        });
        return;
      }

      // --- All Console Signal message types ---
      // FETCH_SITEMAP, AI_GET_CONFIG, AI_SAVE_CONFIG, AI_CLEAR_KEY,
      // AI_SET_PROVIDER, AI_SUMMARIZE
      // [Port these handlers exactly from Console Signal's background.js]

      // ... (full port of Console Signal message handlers)

    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  })();
  return true;
});
```

**Step 2: Commit**

```bash
git add background.js
git commit -m "feat: merged background service worker (video storage + AI + sitemap)"
```

---

### Task 8: Create popup.html

**Files:**
- Create: `popup.html`

**Step 1: Write popup.html**

Port Console Signal's popup.html structure, adding the Video category/tab. Keep the same navigation pattern (category switch + sub-tabs).

The HTML should include all sections from Console Signal (logsView, briefView, contextView, seoView, schemaView, sitemapView, settingsView) plus a new `videoView` section.

```html
<!-- Video tab content -->
<section id="videoView" class="view is-active">
  <section class="card">
    <div class="cardHead">
      <h2>Detected Videos</h2>
      <button id="downloadAllButton" class="actionBtn" type="button">Download All</button>
    </div>
    <div id="videoList" class="videoList">
      <p class="hint">No videos detected on this page. Navigate to a page with video content.</p>
    </div>
    <p id="videoStatus" class="statusLine">Video status: scanning...</p>
  </section>
</section>
```

Update the category switch to include Video as the first category:
```html
<button class="categoryBtn is-active" type="button" data-category="video">Video</button>
<button class="categoryBtn" type="button" data-category="console">Console</button>
<button class="categoryBtn" type="button" data-category="pageintel">Page Intel</button>
<button class="categoryBtn" type="button" data-category="context">Context</button>
<button class="categoryBtn" type="button" data-category="settings">Settings</button>
```

**Step 2: Commit**

```bash
git add popup.html
git commit -m "feat: popup.html with all categories including video"
```

---

### Task 9: Create popup.css

**Files:**
- Create: `popup.css`
- Source: `/Users/panduka/Sites/Chome-Extention/src/popup.css`

**Step 1: Copy Console Signal's popup.css and extend**

```bash
cp /Users/panduka/Sites/Chome-Extention/src/popup.css /Users/panduka/Sites/VideoDownloader/popup.css
```

**Step 2: Add video-specific styles**

Append to popup.css:
```css
/* === Video Tab === */
.videoList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.videoItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--card-2);
  border-radius: 8px;
  border: 1px solid var(--line);
}

.videoItem:hover {
  border-color: var(--mint);
}

.videoInfo {
  flex: 1;
  min-width: 0;
}

.videoFileName {
  font-size: 13px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.videoMeta {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.videoBadge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(17, 232, 164, 0.15);
  color: var(--mint);
  font-weight: 600;
  text-transform: uppercase;
}

.videoBadge.quality {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-2);
}

.videoDownloadBtn {
  flex-shrink: 0;
  padding: 6px 12px;
  background: var(--mint);
  color: #0e1517;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.videoDownloadBtn:hover {
  background: var(--mint-soft);
}

.videoQualitySelect {
  padding: 4px 8px;
  background: var(--card-1);
  color: var(--text-1);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
}
```

**Step 3: Update popup width to 380px**

In popup.css, update the body min-width/max-width to 380px (or keep Console Signal's 460-520px range which is already wider).

**Step 4: Commit**

```bash
git add popup.css
git commit -m "feat: popup CSS with video tab styles"
```

---

### Task 10: Create popup.js (UI Controller)

**Files:**
- Create: `popup.js`
- Source: Console Signal's `popup.js` (2483 lines)

**Step 1: Port Console Signal's popup.js**

Copy Console Signal's popup.js as the base. This includes all navigation logic, console capture UI, AI brief, SEO, schema, sitemap, context, and settings panels.

**Step 2: Add Video category to navigation constants**

Update the `CATEGORIES` object:
```javascript
const CATEGORIES = {
  video: { label: 'Video', views: ['video'] },
  console: { label: 'Console', views: ['logs', 'brief'] },
  pageintel: { label: 'Page Intel', views: ['seo', 'schema', 'sitemap'] },
  context: { label: 'Context', views: ['context'] },
  settings: { label: 'Settings', views: ['settings'] },
};
```

Add `video` to `VIEW_LABELS`:
```javascript
const VIEW_LABELS = {
  video: 'Downloads',
  logs: 'Main',
  brief: 'AI Brief',
  // ... rest same
};
```

**Step 3: Add video panel logic**

Add DOM references for video elements and implement:

```javascript
// === Video Panel Logic ===
const videoListEl = document.getElementById('videoList');
const videoStatusEl = document.getElementById('videoStatus');
const downloadAllButton = document.getElementById('downloadAllButton');

function setVideoStatus(message, type = '') {
  videoStatusEl.textContent = message;
  videoStatusEl.classList.remove('success', 'error');
  if (type) videoStatusEl.classList.add(type);
}

function renderVideoList(videos) {
  videoListEl.innerHTML = '';
  if (!videos || videos.length === 0) {
    videoListEl.innerHTML = '<p class="hint">No videos detected on this page.</p>';
    downloadAllButton.style.display = 'none';
    setVideoStatus('No videos found.', '');
    return;
  }

  downloadAllButton.style.display = '';
  for (const video of videos) {
    const item = document.createElement('div');
    item.className = 'videoItem';

    const info = document.createElement('div');
    info.className = 'videoInfo';

    const name = document.createElement('div');
    name.className = 'videoFileName';
    name.textContent = video.fileName || video.url.split('/').pop() || 'video';
    name.title = video.url;
    info.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'videoMeta';

    const formatBadge = document.createElement('span');
    formatBadge.className = 'videoBadge';
    formatBadge.textContent = video.playlist ? 'HLS' : (video.url.includes('.webm') ? 'WEBM' : 'MP4');
    meta.appendChild(formatBadge);

    if (video.quality && video.quality !== 'N/A') {
      const qualityBadge = document.createElement('span');
      qualityBadge.className = 'videoBadge quality';
      qualityBadge.textContent = video.quality;
      meta.appendChild(qualityBadge);
    }

    info.appendChild(meta);
    item.appendChild(info);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'videoDownloadBtn';
    dlBtn.textContent = 'Download';
    dlBtn.addEventListener('click', () => downloadVideo(video));
    item.appendChild(dlBtn);

    videoListEl.appendChild(item);
  }

  setVideoStatus(`${videos.length} video(s) detected.`, 'success');
}

async function downloadVideo(video) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_VIDEO',
      url: video.url,
      filename: video.fileName ? `${video.fileName}.mp4` : undefined,
    });
    if (response?.ok) {
      setVideoStatus('Download started.', 'success');
    }
  } catch (error) {
    setVideoStatus(`Download failed: ${error.message}`, 'error');
  }
}

async function downloadAllVideos() {
  const activeTab = await getActiveTabOrThrow();
  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_VIDEOS',
    tabId: activeTab.id,
  });
  if (response?.ok && response.videos?.length) {
    for (const video of response.videos) {
      await downloadVideo(video);
    }
  }
}

async function refreshVideoList() {
  try {
    const activeTab = await getActiveTabOrThrow();
    const response = await chrome.runtime.sendMessage({
      type: 'GET_TAB_VIDEOS',
      tabId: activeTab.id,
    });
    if (response?.ok) {
      renderVideoList(response.videos);
    }
  } catch (error) {
    setVideoStatus(error.message, 'error');
  }
}

// Bind video events
downloadAllButton.addEventListener('click', downloadAllVideos);
```

**Step 4: Update `initialize()` to include video refresh**

```javascript
async function initialize() {
  loadSettings();
  saveSettings();
  bindEvents();
  // ... existing status setup
  await Promise.all([refreshPreview(), loadAiConfig(), refreshVideoList()]);
}
```

**Step 5: Update `DEFAULT_SETTINGS` to default to video tab**

```javascript
const DEFAULT_SETTINGS = {
  activeView: 'video',
  activeCategory: 'video',
  // ... rest same
};
```

**Step 6: Commit**

```bash
git add popup.js
git commit -m "feat: popup.js with video panel + all Console Signal features"
```

---

### Task 11: Create Placeholder Icons

**Files:**
- Create: `icons/icon-32.png`, `icons/icon-64.png`, `icons/icon-128.png`

**Step 1: Generate simple icons**

Use a simple green-on-dark icon. For now, copy Console Signal's icons and rename:

```bash
cp /Users/panduka/Sites/Chome-Extention/src/icons/console-copy-32.png /Users/panduka/Sites/VideoDownloader/icons/icon-32.png
cp /Users/panduka/Sites/Chome-Extention/src/icons/console-copy-48.png /Users/panduka/Sites/VideoDownloader/icons/icon-64.png
cp /Users/panduka/Sites/Chome-Extention/src/icons/console-copy-128.png /Users/panduka/Sites/VideoDownloader/icons/icon-128.png
```

**Step 2: Commit**

```bash
git add icons/
git commit -m "feat: placeholder extension icons"
```

---

### Task 12: Integration Testing & Fixes

**Step 1: Load unpacked extension in Chrome**

1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked"
4. Select `/Users/panduka/Sites/VideoDownloader`
5. Check for manifest errors in the extensions page

**Step 2: Test video detection**

1. Navigate to a supported site (e.g., Twitter/X with a video post)
2. Click the extension icon
3. Verify the Video tab shows detected videos
4. Click Download on a detected video
5. Verify download starts

**Step 3: Test console capture**

1. Navigate to any page
2. Open browser console, trigger some errors
3. Click extension → Console tab
4. Verify log capture and preview

**Step 4: Test SEO scanning**

1. Navigate to any page
2. Click extension → Page Intel → SEO Meta
3. Click "Scan Page"
4. Verify results render

**Step 5: Test AI features**

1. Go to Settings tab
2. Configure an AI provider
3. Go to Console → AI Brief
4. Click "Generate AI Brief"
5. Verify brief generates

**Step 6: Fix any issues found during testing**

Debug and fix integration issues. Common problems:
- Module import paths (background.js uses `import`, content scripts cannot)
- Message type conflicts between video and console systems
- CSS class conflicts between Console Signal and video styles

**Step 7: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes from manual testing"
```

---

### Task 13: Clean Up & Final Polish

**Step 1: Remove reference files**

```bash
rm -f lib/video-parsers-reference.js
```

**Step 2: Update extension name/description if desired**

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: cleanup and polish"
```

---

## Execution Notes

- **Task 1** must run first (cleans project). Back up original files before running.
- **Tasks 2-5** are independent and can run in parallel.
- **Task 6** depends on Tasks 4 and 5 (content script uses watcher + page-logger).
- **Task 7** depends on Task 2 (background uses ai-providers).
- **Tasks 8-9** are independent of code tasks.
- **Task 10** depends on Tasks 7, 8, 9 (popup needs HTML, CSS, and background ready).
- **Task 11** is independent.
- **Tasks 12-13** are sequential, run last.

## Dependency Graph

```
Task 1 (skeleton)
├── Task 2 (ai-providers) ──────────────┐
├── Task 3 (video parsers) ─┐           │
├── Task 4 (watcher.js) ────┤           │
├── Task 5 (page-logger) ───┤           │
│                            │           │
│                    Task 6 (content-script)
│                            │           │
│                    Task 7 (background.js)
│                            │
├── Task 8 (popup.html) ────┤
├── Task 9 (popup.css) ─────┤
│                            │
│                    Task 10 (popup.js)
│
├── Task 11 (icons) ─────────────────────┐
│                                        │
│                    Task 12 (integration test)
│                            │
│                    Task 13 (cleanup)
```
