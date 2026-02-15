// watcher.js — Injected into page context to intercept XHR/fetch responses
// Deobfuscated from Qooly Video Downloader + fetch support + inline parsers
(() => {
  if (window.__devToolkitWatcherInstalled) return;
  window.__devToolkitWatcherInstalled = true;

  // === XHR Interception ===

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

  // === Fetch Interception ===

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

  // === Utility Functions ===

  function generateId() {
    let id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36).substr(3);
    for (let i = 0; i < id.length; i++) {
      if (Math.random() > 0.5) {
        id = id.substr(0, i) + id[i].toUpperCase() + id.substr(i + 1);
      }
    }
    return id;
  }

  function searchKeyRecursive(obj, targetKey, results) {
    if (!results) results = [];
    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      if (key === targetKey && obj[key]) {
        if (obj.caption && obj.caption.text && obj[key].length) {
          for (let i = 0; i < obj[key].length; i++) {
            obj[key][i].title = obj.caption.text;
          }
        }
        results.push(obj[key]);
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        searchKeyRecursive(obj[key], targetKey, results);
      }
    }
    return results;
  }

  // === Site-Specific Parsers (Inlined) ===

  // --- Instagram Parser ---
  const instagramParser = {
    origins: ['www.instagram.com'],
    onLoad(responseText, requestUrl) {
      if (document.location.href.match(/https?:\/\/.+\/(stories(\/highlights)?)\/.+/)) return;
      if (document.location.href.match(/https?:\/\/.+\/(p|reels?)\/.+/)) return;
      if (!responseText.match('video_versions')) return;

      try {
        const data = JSON.parse(responseText.replaceAll('for (;;);', ''));
        const videoVersions = searchKeyRecursive(data, 'video_versions');
        if (videoVersions && videoVersions.length) {
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
        const title = (document.querySelector('#main main h1') || {}).innerText || document.title;
        const progressive = data.request.files.progressive;
        const videos = [];

        if (progressive) {
          for (let i = 0; i < progressive.length; i++) {
            videos.push({ fileName: title, url: progressive[i].url, quality: progressive[i].width });
          }
        }

        if (!videos.length && data.request.files && data.request.files.hls && data.request.files.hls.cdns) {
          for (const cdnKey in data.request.files.hls.cdns) {
            const hlsUrl = data.request.files.hls.cdns[cdnKey].url.replace(/\/subtitles\/.*\//, '/');
            if (!hlsUrl.match(/^https?:\/\/cme-media\.vimeocdn\.com/)) {
              videos.push({
                fileName: title,
                url: hlsUrl,
                playlist: true,
                quality: (data.video && data.video.height) ? data.video.height : 'N/A',
              });
            }
          }
        }

        if (videos && videos.length) {
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

        if (videoInfos && videoInfos.length) {
          for (let i = 0; i < videoInfos.length; i++) {
            const info = videoInfos[i];
            if (!info.variants || !info.variants.length) continue;
            for (let j = 0; j < info.variants.length; j++) {
              const variant = info.variants[j];
              if (variant && variant.content_type === 'application/x-mpegURL') continue;
              let quality = 'N/A';
              try {
                if (variant.url.match(/avc1\/\d*x\d*/)) {
                  quality = variant.url.match(/avc1\/\d*x\d*/)[0].replace(/avc1\//gi, '').split('x')[0];
                }
              } catch (e) { /* ignore */ }
              videos.push({ url: variant.url, quality: quality, title: title });
            }
          }
        }

        // Thread entries
        const instructions = data.data && data.data.threaded_conversation_with_injections_v2 &&
          data.data.threaded_conversation_with_injections_v2.instructions;
        if (instructions && instructions[0] && instructions[0].type === 'TimelineAddEntries') {
          const entries = instructions[0].entries;
          for (let e = 0; e < entries.length; e++) {
            const entry = entries[e];
            const media = entry.content && entry.content.itemContent && entry.content.itemContent.tweet_results &&
              entry.content.itemContent.tweet_results.result && entry.content.itemContent.tweet_results.result.legacy &&
              entry.content.itemContent.tweet_results.result.legacy.entities &&
              entry.content.itemContent.tweet_results.result.legacy.entities.media;
            if (!media) continue;
            const tweetTitle = (entry.content && entry.content.itemContent && entry.content.itemContent.tweet_results &&
              entry.content.itemContent.tweet_results.result && entry.content.itemContent.tweet_results.result.legacy &&
              entry.content.itemContent.tweet_results.result.legacy.full_text) || document.title;
            for (let m = 0; m < media.length; m++) {
              const mediaItem = media[m];
              if (!mediaItem.video_info || !mediaItem.video_info.variants || !mediaItem.video_info.variants.length) continue;
              const entryVideos = [];
              for (let v = 0; v < mediaItem.video_info.variants.length; v++) {
                const variant = mediaItem.video_info.variants[v];
                if (!variant || !variant.url) continue;
                if (variant.content_type === 'application/x-mpegURL') continue;
                let quality = 'N/A';
                try {
                  if (variant.url.match(/avc1\/\d*x\d*/)) {
                    quality = variant.url.match(/avc1\/\d*x\d*/)[0].replace(/avc1\//gi, '').split('x')[0];
                  }
                } catch (ex) { /* ignore */ }
                entryVideos.push({ url: variant.url, quality: quality, title: tweetTitle });
              }
              if (entryVideos.length) {
                window.dispatchEvent(new CustomEvent('videos-found', { detail: entryVideos }));
              }
            }
          }
        }

        if (videos && videos.length) {
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

      const title = document.title || (document.querySelector('h1.entry-title') || {}).innerText || '';
      const videos = [];

      if (responseText.match(/#EXT-X-STREAM-INF:/)) {
        const segments = responseText.split(/#EXT-X-STREAM-INF:/);
        for (let s = 0; s < segments.length; s++) {
          const segment = segments[s];
          const entry = { url: '', quality: '', playlist: true, fileName: title, stream: true, id: generateId(), isAdditional: false };
          const parts = segment.split(/\s|,/);
          for (let p = 0; p < parts.length; p++) {
            const part = parts[p];
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

      if (videos && videos.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
    },
  };

  // --- Reddit Parser ---
  const redditParser = {
    origins: [/reddit\.com/, /redd\.it/],
    onLoad(responseText, requestUrl) {
      // Reddit DASH manifests
      if (requestUrl.includes('v.redd.it') && responseText.includes('<MPD')) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(responseText, 'text/xml');
          const title = document.title || '';
          const videos = [];
          const representations = doc.querySelectorAll('Representation[mimeType^="video"]');
          for (let r = 0; r < representations.length; r++) {
            const rep = representations[r];
            const height = rep.getAttribute('height');
            const baseUrl = rep.querySelector('BaseURL');
            if (baseUrl && baseUrl.textContent) {
              let videoUrl = baseUrl.textContent;
              if (!videoUrl.startsWith('http')) {
                videoUrl = requestUrl.replace(/\/[^/]*$/, '/') + videoUrl;
              }
              videos.push({ fileName: title, url: videoUrl, quality: height ? height + 'p' : 'N/A' });
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
          const findRedditVideos = function (obj) {
            if (!obj || typeof obj !== 'object') return;
            if (obj.reddit_video && obj.reddit_video.fallback_url) {
              videos.push({
                fileName: obj.title || document.title,
                url: obj.reddit_video.fallback_url,
                quality: obj.reddit_video.height ? obj.reddit_video.height + 'p' : 'N/A',
              });
            }
            const vals = Object.values(obj);
            for (let i = 0; i < vals.length; i++) {
              if (typeof vals[i] === 'object') findRedditVideos(vals[i]);
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
      if (responseText.includes('videoQualities') || responseText.includes('clip_video_url')) {
        try {
          const data = JSON.parse(responseText);
          const videos = [];
          const findClipUrls = function (obj) {
            if (!obj || typeof obj !== 'object') return;
            if (obj.videoQualities && Array.isArray(obj.videoQualities)) {
              for (let q = 0; q < obj.videoQualities.length; q++) {
                const qual = obj.videoQualities[q];
                if (qual.sourceURL) {
                  videos.push({
                    fileName: obj.title || document.title,
                    url: qual.sourceURL,
                    quality: qual.quality ? qual.quality + 'p' : 'N/A',
                  });
                }
              }
            }
            const vals = Object.values(obj);
            for (let i = 0; i < vals.length; i++) {
              if (typeof vals[i] === 'object') findClipUrls(vals[i]);
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
        for (let s = 0; s < segments.length; s++) {
          const segment = segments[s];
          if (!segment.trim()) continue;
          const lines = segment.trim().split('\n');
          let quality = 'N/A';
          let url = '';
          for (let l = 0; l < lines.length; l++) {
            const line = lines[l];
            const videoMatch = line.match(/VIDEO="([^"]+)"/);
            if (videoMatch) quality = videoMatch[1];
            if (line.trim() && !line.startsWith('#') && line.includes('http')) {
              url = line.trim();
            }
          }
          if (url) {
            videos.push({ fileName: title, url: url, playlist: true, quality: quality });
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
          const findKickVideos = function (obj) {
            if (!obj || typeof obj !== 'object') return;
            if (obj.video_url || obj.clip_url) {
              videos.push({
                fileName: obj.title || document.title,
                url: obj.video_url || obj.clip_url,
                quality: 'N/A',
              });
            }
            const vals = Object.values(obj);
            for (let i = 0; i < vals.length; i++) {
              if (typeof vals[i] === 'object') findKickVideos(vals[i]);
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
          const findMediaDefs = function (obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj.mediaDefinitions)) {
              for (let d = 0; d < obj.mediaDefinitions.length; d++) {
                const def = obj.mediaDefinitions[d];
                if (def.videoUrl && def.format === 'mp4') {
                  videos.push({
                    fileName: document.title,
                    url: def.videoUrl,
                    quality: def.quality ? def.quality + 'p' : 'N/A',
                  });
                }
              }
            }
            const vals = Object.values(obj);
            for (let i = 0; i < vals.length; i++) {
              if (typeof vals[i] === 'object') findMediaDefs(vals[i]);
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
            for (let i = 0; i < urlMatches.length; i++) {
              const parts = urlMatches[i].match(/setVideoUrl(Low|High|HLS)\('([^']+)'\)/);
              if (parts) {
                const quality = parts[1] === 'High' ? '720p' : parts[1] === 'Low' ? '360p' : 'HLS';
                videos.push({
                  fileName: document.title,
                  url: parts[2],
                  quality: quality,
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

  // --- Generic HLS/DASH Parser (catches any site) ---
  const genericStreamParser = {
    origins: [/.*/],
    onLoad(responseText, requestUrl) {
      // HLS detection
      if (responseText.includes('#EXTM3U') && responseText.includes('#EXT-X-STREAM-INF')) {
        const title = document.title || '';
        const videos = [];
        const segments = responseText.split(/#EXT-X-STREAM-INF:/);
        for (let s = 0; s < segments.length; s++) {
          const segment = segments[s];
          if (!segment.trim()) continue;
          const lines = segment.trim().split('\n');
          let quality = 'N/A';
          let url = '';
          for (let l = 0; l < lines.length; l++) {
            const line = lines[l];
            if (line.includes('RESOLUTION=')) {
              const match = line.match(/RESOLUTION=(\d+)x(\d+)/);
              if (match) quality = match[2] + 'p';
            }
            if (line.trim() && !line.startsWith('#')) {
              url = line.trim();
            }
          }
          if (url) {
            videos.push({ fileName: title, url: url, playlist: true, quality: quality });
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
          for (let r = 0; r < representations.length; r++) {
            const rep = representations[r];
            const height = rep.getAttribute('height');
            const bandwidth = rep.getAttribute('bandwidth');
            const baseUrl = rep.querySelector('BaseURL');
            if (baseUrl && baseUrl.textContent) {
              videos.push({
                fileName: title,
                url: baseUrl.textContent,
                quality: height ? height + 'p' : 'N/A',
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

  // === Parser Registry ===
  const parsers = [
    instagramParser,
    twitterParser,
    vimeoParser,
    hlsParser,
    redditParser,
    twitchParser,
    kickParser,
    pornhubParser,
    xvideosParser,
    genericStreamParser, // Must be last
  ];

  // === Run Parsers Against Intercepted Responses ===
  window.addEventListener('__dt_xhr_response', function (event) {
    var detail = event.detail;
    if (!detail) return;
    var fullUrl = detail.fullUrl;
    var responseText = detail.responseText;
    var hostname = detail.hostname;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      for (let j = 0; j < parser.origins.length; j++) {
        const origin = parser.origins[j];
        if (
          (origin instanceof RegExp && hostname.match(origin)) ||
          hostname === origin
        ) {
          try {
            parser.onLoad(responseText, fullUrl);
          } catch (e) { /* ignore parser errors */ }
          break;
        }
      }
    }
  });
})();
