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

  function resolveUrl(baseUrl, maybeRelativeUrl) {
    if (typeof maybeRelativeUrl !== 'string') {
      return '';
    }
    const trimmed = maybeRelativeUrl.trim();
    if (!trimmed) {
      return '';
    }
    try {
      return new URL(trimmed, baseUrl || document.location.href).href;
    } catch {
      return '';
    }
  }

  function sanitizeQuality(value) {
    if (typeof value !== 'string') {
      return 'N/A';
    }
    const trimmed = value.trim();
    return trimmed || 'N/A';
  }

  function qualityToPixels(quality) {
    if (typeof quality !== 'string') {
      return 0;
    }
    const pMatch = quality.match(/(\d{3,4})p/i);
    if (pMatch) {
      return Number.parseInt(pMatch[1], 10) || 0;
    }
    const rMatch = quality.match(/(\d{3,4})x(\d{3,4})/i);
    if (rMatch) {
      return Number.parseInt(rMatch[2], 10) || 0;
    }
    return 0;
  }

  function firstUrl(value) {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = firstUrl(value[i]);
        if (item) return item;
      }
      return '';
    }
    if (typeof value === 'object') {
      if (typeof value.url === 'string') {
        return value.url;
      }
      if (Array.isArray(value.url_list)) {
        return firstUrl(value.url_list);
      }
      if (Array.isArray(value.urlList)) {
        return firstUrl(value.urlList);
      }
      if (typeof value.play_url === 'string') {
        return value.play_url;
      }
      if (value.play_url && typeof value.play_url === 'object') {
        return firstUrl(value.play_url);
      }
      if (value.playAddr && typeof value.playAddr === 'object') {
        return firstUrl(value.playAddr);
      }
    }
    return '';
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

  // --- TikTok Parser ---
  const tiktokParser = {
    origins: [/tiktok\.com/],
    onLoad(responseText, requestUrl) {
      if (
        !responseText.includes('aweme') &&
        !responseText.includes('play_addr') &&
        !responseText.includes('download_addr')
      ) {
        return;
      }

      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch {
        const cleaned = responseText.replace(/^[)\]\}'\s]+/, '');
        try {
          data = JSON.parse(cleaned);
        } catch {
          return;
        }
      }

      const awemeItems = [];
      const visited = new Set();
      function walk(obj) {
        if (!obj || typeof obj !== 'object') {
          return;
        }
        if (visited.has(obj)) {
          return;
        }
        visited.add(obj);

        if (
          obj.video &&
          (obj.video.play_addr || obj.video.download_addr || Array.isArray(obj.video.bit_rate))
        ) {
          awemeItems.push(obj);
        }

        const values = Object.values(obj);
        for (let i = 0; i < values.length; i++) {
          if (values[i] && typeof values[i] === 'object') {
            walk(values[i]);
          }
        }
      }
      walk(data);
      if (!awemeItems.length) {
        return;
      }

      function qualityFromNode(node, fallback = 'N/A') {
        if (!node || typeof node !== 'object') {
          return fallback;
        }
        const height =
          Number(node.height) ||
          Number(node.play_addr?.height) ||
          Number(node.playAddr?.height) ||
          0;
        if (height > 0) {
          return `${height}p`;
        }
        const gear = typeof node.gear_name === 'string' ? node.gear_name : '';
        const match = gear.match(/(\d{3,4})/);
        return match ? `${match[1]}p` : fallback;
      }

      const seen = new Set();
      const videos = [];

      function addTikTokVideo(urlValue, payload) {
        const resolved = resolveUrl(requestUrl, firstUrl(urlValue));
        if (!resolved || seen.has(resolved)) {
          return;
        }
        seen.add(resolved);
        videos.push(payload(resolved));
      }

      for (let i = 0; i < awemeItems.length && i < 12; i++) {
        const aweme = awemeItems[i];
        const video = aweme.video || {};
        const title = aweme.desc || document.title || '';
        const thumbnailUrl = resolveUrl(
          requestUrl,
          firstUrl(video.cover || video.dynamic_cover || video.origin_cover)
        );
        const audioUrl = resolveUrl(
          requestUrl,
          firstUrl(
            aweme.music?.play_url ||
              aweme.music?.playUrl ||
              aweme.music?.play_url_hd ||
              aweme.music?.matched_song?.play_url
          )
        );
        const mp3Available = /\.mp3(\?|$)/i.test(audioUrl);

        addTikTokVideo(video.download_addr, (resolved) => ({
          fileName: title,
          url: resolved,
          quality: qualityFromNode(video.download_addr, qualityFromNode(video)),
          thumbnailUrl,
          source: 'tiktok',
          hasAudio: true,
          audioUrl,
          audioExt: mp3Available ? 'mp3' : '',
          mp3Available,
          isPrimary: true,
        }));

        addTikTokVideo(video.play_addr, (resolved) => ({
          fileName: title,
          url: resolved,
          quality: qualityFromNode(video.play_addr, qualityFromNode(video)),
          thumbnailUrl,
          source: 'tiktok',
          hasAudio: true,
          audioUrl,
          audioExt: mp3Available ? 'mp3' : '',
          mp3Available,
        }));

        if (Array.isArray(video.bit_rate)) {
          for (let b = 0; b < video.bit_rate.length; b++) {
            const variant = video.bit_rate[b];
            addTikTokVideo(variant.play_addr || variant.playAddr || variant.play_addr_265, (resolved) => ({
              fileName: title,
              url: resolved,
              quality: qualityFromNode(variant, qualityFromNode(video)),
              thumbnailUrl,
              source: 'tiktok',
              hasAudio: true,
              audioUrl,
              audioExt: mp3Available ? 'mp3' : '',
              mp3Available,
            }));
          }
        }
      }

      if (videos.length) {
        videos.sort((a, b) => qualityToPixels(b.quality) - qualityToPixels(a.quality));
        if (videos[0]) {
          videos[0].isPrimary = true;
        }
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos.slice(0, 6) }));
      }
    },
  };

  // --- YouTube Parser ---
  const youtubeParser = {
    origins: [/youtube\.com/, /googlevideo\.com/],
    onLoad(responseText, requestUrl) {
      if (
        !responseText.includes('streamingData') &&
        !responseText.includes('hlsManifestUrl') &&
        !responseText.includes('dashManifestUrl')
      ) {
        return;
      }

      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch {
        const cleaned = responseText.replace(/^[)\]\}'\s]+/, '');
        try {
          data = JSON.parse(cleaned);
        } catch {
          return;
        }
      }

      const playerResponse = data?.streamingData
        ? data
        : data?.playerResponse?.streamingData
          ? data.playerResponse
          : null;
      if (!playerResponse || !playerResponse.streamingData) {
        return;
      }

      const title = playerResponse?.videoDetails?.title || document.title || '';
      const thumbSet = playerResponse?.videoDetails?.thumbnail?.thumbnails;
      const thumbnailUrl = Array.isArray(thumbSet) && thumbSet.length
        ? thumbSet[thumbSet.length - 1].url || ''
        : '';

      const videos = [];
      const formats = [];
      if (Array.isArray(playerResponse.streamingData.formats)) {
        formats.push(...playerResponse.streamingData.formats);
      }
      if (Array.isArray(playerResponse.streamingData.adaptiveFormats)) {
        formats.push(...playerResponse.streamingData.adaptiveFormats);
      }

      function youtubeScore(format) {
        const height = Number(format.height) || 0;
        const bitrate = Number(format.bitrate) || 0;
        return height * 100000 + bitrate;
      }

      const progressive = [];
      const adaptive = [];
      const audioOnly = [];
      const seenItags = new Set();

      for (let i = 0; i < formats.length; i++) {
        const format = formats[i];
        if (!format) continue;
        const url = resolveUrl(requestUrl, format.url || '');
        if (!url) continue;
        const mimeType = typeof format.mimeType === 'string' ? format.mimeType : '';
        const itag = String(format.itag || '');
        if (itag && seenItags.has(itag)) continue;
        if (itag) seenItags.add(itag);
        const contentLength = Number.parseInt(format.contentLength || '', 10);
        const normalizedQuality = sanitizeQuality(
          format.qualityLabel || (format.height ? `${format.height}p` : format.quality)
        );

        if (mimeType.includes('audio/')) {
          audioOnly.push({
            url,
            mimeType: mimeType.split(';')[0] || '',
            bitrate: Number(format.bitrate) || 0,
            sizeBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
            mp3Available:
              /audio\/mpeg/i.test(mimeType) || /\.mp3(\?|$)/i.test(url),
          });
          continue;
        }
        if (!mimeType.includes('video/')) continue;
        const hasAudio = Boolean(format.audioQuality || format.audioSampleRate);
        const quality = normalizedQuality;

        const candidate = {
          fileName: title,
          url,
          quality,
          thumbnailUrl,
          contentType: mimeType.split(';')[0] || '',
          sizeBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
          source: 'youtube',
          hasAudio,
          requiresMux: !hasAudio,
          itag,
          score: youtubeScore(format),
        };

        if (hasAudio) {
          progressive.push(candidate);
        } else {
          adaptive.push(candidate);
        }
      }

      progressive.sort((a, b) => (b.score || 0) - (a.score || 0));
      adaptive.sort((a, b) => (b.score || 0) - (a.score || 0));
      audioOnly.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const bestAudio = audioOnly[0] || null;

      if (progressive.length > 0) {
        for (let i = 0; i < Math.min(progressive.length, 4); i++) {
          videos.push({
            ...progressive[i],
            audioUrl: bestAudio ? bestAudio.url : '',
            audioExt: bestAudio ? (bestAudio.url.includes('.mp3') ? 'mp3' : '') : '',
            mp3Available: Boolean(bestAudio?.mp3Available),
            isPrimary: i === 0,
          });
        }
      } else if (adaptive.length > 0) {
        videos.push({
          ...adaptive[0],
          audioUrl: bestAudio ? bestAudio.url : '',
          audioExt: bestAudio ? (bestAudio.url.includes('.mp3') ? 'mp3' : '') : '',
          mp3Available: Boolean(bestAudio?.mp3Available),
          isPrimary: true,
          requiresMux: true,
        });
      }

      // Use manifests only as a fallback when no direct progressive stream URL is exposed.
      if (!videos.length) {
        const hlsManifestUrl = resolveUrl(
          requestUrl,
          playerResponse.streamingData.hlsManifestUrl
        );
        const dashManifestUrl = resolveUrl(
          requestUrl,
          playerResponse.streamingData.dashManifestUrl
        );
        const manifestUrl = hlsManifestUrl || dashManifestUrl;
        if (manifestUrl) {
          const format = hlsManifestUrl ? 'HLS' : 'DASH';
          videos.push({
            fileName: title,
            url: manifestUrl,
            quality: 'adaptive',
            playlist: true,
            thumbnailUrl,
            source: 'youtube',
            hasAudio: true,
            audioUrl: bestAudio ? bestAudio.url : '',
            audioExt: bestAudio ? (bestAudio.url.includes('.mp3') ? 'mp3' : '') : '',
            mp3Available: Boolean(bestAudio?.mp3Available),
            isPrimary: true,
            note: `${format} manifest`,
          });
        }
      }

      if (videos.length) {
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos }));
      }
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
          if (!segment.trim()) continue;
          const lines = segment.trim().split('\n').map((line) => line.trim()).filter(Boolean);
          const entry = { url: '', quality: '', playlist: true, fileName: title, stream: true, id: generateId(), isAdditional: false };
          const infoLine = lines[0] || '';
          const resolutionMatch = infoLine.match(/RESOLUTION=(\d+)x(\d+)/i);
          if (resolutionMatch) {
            entry.quality = `${resolutionMatch[2]}p`;
          }
          for (let l = 1; l < lines.length; l++) {
            const line = lines[l];
            if (!line.startsWith('#')) {
              entry.url = resolveUrl(requestUrl, line);
              break;
            }
          }
          if (entry.url) {
            videos.push({ fileName: entry.fileName, url: entry.url, playlist: true, quality: entry.quality || 'N/A' });
          }
        }
      }

      if (videos && videos.length) {
        videos.sort((a, b) => qualityToPixels(b.quality) - qualityToPixels(a.quality));
        window.dispatchEvent(new CustomEvent('videos-found', { detail: videos.slice(0, 4) }));
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
          videos.sort((a, b) => qualityToPixels(b.quality) - qualityToPixels(a.quality));
          window.dispatchEvent(new CustomEvent('videos-found', { detail: videos.slice(0, 5) }));
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

  // --- Generic media URL parser (JSON/text payloads) ---
  const genericUrlParser = {
    origins: [/.*/],
    onLoad(responseText, requestUrl) {
      if (
        !responseText.includes('.m3u8') &&
        !responseText.includes('.mpd') &&
        !responseText.includes('.mp4') &&
        !responseText.includes('.webm')
      ) {
        return;
      }

      const normalizedText = responseText
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
      const matches = normalizedText.match(
        /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mpd|mp4|webm)(?:\?[^"'\\\s<>]*)?/gi
      );
      if (!matches || !matches.length) {
        return;
      }

      const seen = new Set();
      const videos = [];
      for (let i = 0; i < matches.length && i < 60; i++) {
        const resolved = resolveUrl(requestUrl, matches[i]);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        videos.push({
          fileName: document.title || '',
          url: resolved,
          playlist: /\.m3u8(\?|$)|\.mpd(\?|$)/i.test(resolved),
          quality: 'N/A',
        });
      }

      if (videos.length) {
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
              url = resolveUrl(requestUrl, line.trim());
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
              const mediaUrl = resolveUrl(requestUrl, baseUrl.textContent);
              if (!mediaUrl) {
                continue;
              }
              videos.push({
                fileName: title,
                url: mediaUrl,
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
    tiktokParser,
    youtubeParser,
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
