// lib/video-parsers.js
// Deobfuscated from Qooly Video Downloader + new parsers
// Reference module — actual runtime code is inlined in watcher.js
// (page-context scripts cannot use ES modules)

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
    if (responseText.includes('#EXTM3U') && responseText.includes('#EXT-X-STREAM-INF')) {
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

    if (responseText.includes('<MPD') && responseText.includes('</MPD>')) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(responseText, 'text/xml');
        const title = document.title || '';
        const videos = [];
        const representations = doc.querySelectorAll('Representation[mimeType^="video"]');
        for (const rep of representations) {
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
  genericStreamParser,
];

export { generateId, searchKeyRecursive };
