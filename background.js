import {
  AI_PROVIDERS,
  PROVIDER_STORAGE_KEYS,
  buildFetchOptions,
  parseAiResponse,
} from './lib/ai-providers.js';

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Ignore if unavailable on older Chrome builds.
    });
}

// === Video Link Storage (per tab, persisted across worker restarts) ===

const TAB_VIDEO_DATA_KEY = 'tabVideoDataV1';
const TAB_IMAGE_DATA_KEY = 'tabImageDataV1';
const VIDEO_METADATA_TIMEOUT_MS = 8000;
const videoMetadataInflight = new Map();
const imageMetadataInflight = new Map();

let tabVideoDataCache = null;
let tabVideoMutationQueue = Promise.resolve();
let tabImageDataCache = null;
let tabImageMutationQueue = Promise.resolve();
const DEFAULT_LOCAL_HELPER_URL = 'http://127.0.0.1:41771';
const LOCAL_HELPER_TIMEOUT_MS = 10 * 60 * 1000;

function getVideoStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function normalizeTabId(tabId) {
  const parsed = Number(tabId);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return '';
  }
  return String(parsed);
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}

function asPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function sanitizeFileName(input) {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return trimmed;
}

function extractExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function isPlaylistUrl(url) {
  return /\.m3u8(\?|$)/i.test(url) || /\.mpd(\?|$)/i.test(url);
}

function formatBytes(bytes) {
  const num = asPositiveInt(bytes);
  if (!num) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = num;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded =
    value >= 100 || idx === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[idx]}`;
}

function buildVideoKey(video) {
  const canonical = canonicalVideoIdentity(video);
  return `${canonical}|${video.playlist ? '1' : '0'}|${video.hasAudio === false ? '0' : '1'}`;
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

function isYoutubeLikeHost(hostname) {
  return (
    hostname.includes('youtube.com') ||
    hostname.includes('googlevideo.com') ||
    hostname.includes('ytimg.com')
  );
}

function canonicalVideoIdentity(video) {
  if (!video?.url) {
    return '';
  }
  try {
    const parsed = new URL(video.url);
    const host = parsed.hostname.toLowerCase();
    if (isYoutubeLikeHost(host)) {
      const itag = parsed.searchParams.get('itag') || '';
      const id = parsed.searchParams.get('id') || '';
      const mime = parsed.searchParams.get('mime') || '';
      return `${host}${parsed.pathname}|itag=${itag}|id=${id}|mime=${mime}`;
    }
    return `${host}${parsed.pathname}`;
  } catch {
    return video.url;
  }
}

const MIN_VIDEO_DISPLAY_BYTES = 1_500_000; // 1.5MB — omit junk under this size
const DIRECT_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'wav',
  'weba',
  'webm',
]);

function looksLikeJunkVideo(video) {
  if (!video?.url) {
    return true;
  }
  const url = video.url.toLowerCase();
  if (
    /(?:thumbnail|storyboard|sprite|preview|poster|analytics|tracking|telemetry|subtitle|caption|vtt)/i.test(
      url
    )
  ) {
    return true;
  }
  if (/[?&](?:mime=audio|type=audio|audio=1|is_audio=1)/i.test(url)) {
    return true;
  }
  if (typeof video.contentType === 'string' && /audio\//i.test(video.contentType)) {
    return true;
  }
  // Filter out known-small files (under 1.5MB)
  // Videos with unknown size (null/0) pass through — size gets resolved later
  const size = asPositiveInt(video.sizeBytes);
  if (size && size < MIN_VIDEO_DISPLAY_BYTES) {
    return true;
  }
  return false;
}

function scoreVideoCandidate(video) {
  let score = 0;
  if (video.isPrimary) score += 12000;
  if (video.hasAudio === true) score += 1500;
  if (video.hasAudio === false) score -= 1000;
  if (!video.playlist) score += 500;
  if (video.playlist) score -= 250;
  score += Math.min(qualityToPixels(video.quality), 2200);
  if (video.sizeBytes) {
    score += Math.min(Math.floor(video.sizeBytes / (1024 * 1024)), 600);
  }
  if (typeof video.source === 'string' && video.source) {
    score += 250;
  }
  if (video.requiresMux) {
    score -= 900;
  }
  if (looksLikeJunkVideo(video)) {
    score -= 20000;
  }
  return score;
}

function curateVideosForDisplay(videos) {
  if (!Array.isArray(videos) || videos.length === 0) {
    return [];
  }

  const deduped = new Map();
  for (const candidate of videos) {
    if (!candidate || !candidate.url || looksLikeJunkVideo(candidate)) {
      continue;
    }
    const key = buildVideoKey(candidate);
    const existing = deduped.get(key);
    if (!existing || scoreVideoCandidate(candidate) > scoreVideoCandidate(existing)) {
      deduped.set(key, candidate);
    }
  }

  let candidates = Array.from(deduped.values());
  if (candidates.length === 0) {
    return [];
  }

  const allYoutube = candidates.every((video) => {
    try {
      return isYoutubeLikeHost(new URL(video.url).hostname.toLowerCase());
    } catch {
      return false;
    }
  });

  if (allYoutube) {
    const progressive = candidates.filter(
      (video) => video.playlist !== true && video.hasAudio === true
    );
    if (progressive.length > 0) {
      candidates = progressive;
    } else {
      const fallback = candidates
        .filter((video) => video.playlist !== true)
        .sort((a, b) => scoreVideoCandidate(b) - scoreVideoCandidate(a));
      candidates = fallback.slice(0, 3).map((video) => ({
        ...video,
        requiresMux: true,
      }));
    }
  }

  candidates.sort((a, b) => scoreVideoCandidate(b) - scoreVideoCandidate(a));
  const limit = allYoutube ? 5 : 12;
  return candidates.slice(0, limit).map((video, idx) => ({
    ...video,
    isPrimary: idx === 0,
  }));
}

function normalizeVideoLink(link) {
  const url = normalizeHttpUrl(link?.url);
  if (!url) {
    return null;
  }
  const sizeBytes = asPositiveInt(
    link?.sizeBytes ?? link?.contentLength ?? link?.filesize ?? null
  );
  const extFromUrl = extractExtFromUrl(url);
  const audioUrl = normalizeHttpUrl(link?.audioUrl);
  const audioExt = audioUrl ? extractExtFromUrl(audioUrl) : '';
  const audioContentType =
    typeof link?.audioContentType === 'string' ? link.audioContentType : '';
  const playlist = Boolean(link?.playlist) || isPlaylistUrl(url);
  const fileName = sanitizeFileName(link?.fileName || link?.title || 'video');

  return {
    id:
      typeof link?.id === 'string' && link.id.trim()
        ? link.id.trim()
        : `v_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    url,
    quality:
      typeof link?.quality === 'string' && link.quality.trim()
        ? link.quality.trim()
        : 'N/A',
    fileName: fileName || 'video',
    playlist,
    thumbnailUrl: normalizeHttpUrl(link?.thumbnailUrl) || '',
    sizeBytes,
    sizeText: sizeBytes ? formatBytes(sizeBytes) : '',
    contentType:
      typeof link?.contentType === 'string' ? link.contentType.trim() : '',
    ext: extFromUrl || (playlist ? (url.includes('.mpd') ? 'mpd' : 'm3u8') : ''),
    audioUrl,
    audioExt,
    mp3Available:
      Boolean(link?.mp3Available) ||
      DIRECT_AUDIO_EXTENSIONS.has(audioExt) ||
      /audio\/(mpeg|mp4|aac|ogg|wav|webm)/i.test(audioContentType),
    source: typeof link?.source === 'string' ? link.source.trim() : '',
    pageUrl: normalizeHttpUrl(link?.pageUrl) || '',
    hasAudio:
      link?.hasAudio === true ? true : link?.hasAudio === false ? false : null,
    requiresMux: Boolean(link?.requiresMux),
    isPrimary: Boolean(link?.isPrimary),
    lastSeenAt: Date.now(),
  };
}

function mergeVideoLink(existing, incoming) {
  const nextSizeBytes = incoming.sizeBytes || existing.sizeBytes || null;
  return {
    ...existing,
    ...incoming,
    fileName: incoming.fileName || existing.fileName || 'video',
    thumbnailUrl: incoming.thumbnailUrl || existing.thumbnailUrl || '',
    sizeBytes: nextSizeBytes,
    sizeText:
      incoming.sizeText || existing.sizeText || (nextSizeBytes ? formatBytes(nextSizeBytes) : ''),
    contentType: incoming.contentType || existing.contentType || '',
    ext: incoming.ext || existing.ext || '',
    audioUrl: incoming.audioUrl || existing.audioUrl || '',
    audioExt: incoming.audioExt || existing.audioExt || '',
    mp3Available: Boolean(incoming.mp3Available || existing.mp3Available),
    source: incoming.source || existing.source || '',
    pageUrl: incoming.pageUrl || existing.pageUrl || '',
    hasAudio:
      incoming.hasAudio === true || incoming.hasAudio === false
        ? incoming.hasAudio
        : existing.hasAudio,
    requiresMux: Boolean(incoming.requiresMux || existing.requiresMux),
    isPrimary: Boolean(incoming.isPrimary || existing.isPrimary),
    lastSeenAt: Date.now(),
  };
}

function extractExtFromContentType(contentType) {
  if (typeof contentType !== 'string') {
    return '';
  }
  const type = contentType.toLowerCase();
  if (type.includes('image/jpeg') || type.includes('image/jpg')) return 'jpg';
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/webp')) return 'webp';
  if (type.includes('image/gif')) return 'gif';
  if (type.includes('image/svg')) return 'svg';
  if (type.includes('image/avif')) return 'avif';
  if (type.includes('image/bmp')) return 'bmp';
  if (type.includes('image/tiff')) return 'tiff';
  return '';
}

function canonicalImageIdentity(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function scoreImageCandidate(image) {
  const width = asPositiveInt(image?.width) || 0;
  const height = asPositiveInt(image?.height) || 0;
  const area = width * height;
  const sizeBytes = asPositiveInt(image?.sizeBytes) || 0;
  const source = typeof image?.source === 'string' ? image.source : '';
  let score = area;
  score += Math.min(Math.floor(sizeBytes / 1024), 5000);
  if (source.includes('img-currentSrc')) score += 450;
  else if (source.includes('img-src')) score += 360;
  else if (source.includes('picture')) score += 300;
  else if (source.includes('meta-')) score += 180;
  else if (source.includes('style-background')) score += 120;
  return score;
}

function curateImagesForDisplay(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }
  const deduped = new Map();
  for (const candidate of images) {
    if (!candidate?.url) continue;
    const key = candidate.url;
    const existing = deduped.get(key);
    if (!existing || scoreImageCandidate(candidate) > scoreImageCandidate(existing)) {
      deduped.set(key, candidate);
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => scoreImageCandidate(b) - scoreImageCandidate(a))
    .slice(0, 300);
}

function normalizeImageLink(link) {
  const url = normalizeHttpUrl(link?.url);
  if (!url) {
    return null;
  }
  const width = asPositiveInt(link?.width ?? link?.naturalWidth ?? null);
  const height = asPositiveInt(link?.height ?? link?.naturalHeight ?? null);
  const sizeBytes = asPositiveInt(
    link?.sizeBytes ?? link?.contentLength ?? link?.filesize ?? null
  );
  const contentType =
    typeof link?.contentType === 'string' ? link.contentType.trim() : '';
  const extFromUrl = extractExtFromUrl(url);
  const extFromType = extractExtFromContentType(contentType);
  const formatFromLink =
    typeof link?.format === 'string' ? link.format.trim().toLowerCase() : '';
  const normalizedFormat = formatFromLink === 'jpeg' ? 'jpg' : formatFromLink;
  const ext = extFromUrl || extFromType || normalizedFormat || '';

  return {
    id:
      typeof link?.id === 'string' && link.id.trim()
        ? link.id.trim()
        : `img_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    url,
    canonicalUrl: canonicalImageIdentity(url),
    fileName: sanitizeFileName(link?.fileName || link?.title || 'image') || 'image',
    source: typeof link?.source === 'string' ? link.source.trim() : '',
    width,
    height,
    altText:
      typeof link?.altText === 'string' ? link.altText.trim().slice(0, 240) : '',
    titleText:
      typeof link?.titleText === 'string' ? link.titleText.trim().slice(0, 240) : '',
    contentType,
    sizeBytes,
    sizeText: sizeBytes ? formatBytes(sizeBytes) : '',
    ext,
    format: ext,
    lastSeenAt: Date.now(),
  };
}

function mergeImageLink(existing, incoming) {
  const existingSize = asPositiveInt(existing?.sizeBytes);
  const incomingSize = asPositiveInt(incoming?.sizeBytes);
  const width = Math.max(asPositiveInt(existing?.width) || 0, asPositiveInt(incoming?.width) || 0) || null;
  const height = Math.max(asPositiveInt(existing?.height) || 0, asPositiveInt(incoming?.height) || 0) || null;
  const sizeBytes = incomingSize || existingSize || null;
  return {
    ...existing,
    ...incoming,
    canonicalUrl: incoming.canonicalUrl || existing.canonicalUrl || canonicalImageIdentity(incoming.url || existing.url || ''),
    fileName: incoming.fileName || existing.fileName || 'image',
    source: incoming.source || existing.source || '',
    width,
    height,
    altText: incoming.altText || existing.altText || '',
    titleText: incoming.titleText || existing.titleText || '',
    contentType: incoming.contentType || existing.contentType || '',
    sizeBytes,
    sizeText: incoming.sizeText || existing.sizeText || (sizeBytes ? formatBytes(sizeBytes) : ''),
    ext: incoming.ext || existing.ext || '',
    format: incoming.format || existing.format || '',
    lastSeenAt: Date.now(),
  };
}

async function loadTabVideoData() {
  if (tabVideoDataCache && typeof tabVideoDataCache === 'object') {
    return tabVideoDataCache;
  }
  const storageArea = getVideoStorageArea();
  const stored = await storageArea.get(TAB_VIDEO_DATA_KEY);
  const parsed = stored[TAB_VIDEO_DATA_KEY];
  tabVideoDataCache =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return tabVideoDataCache;
}

async function saveTabVideoData(nextData) {
  tabVideoDataCache = nextData;
  const storageArea = getVideoStorageArea();
  await storageArea.set({ [TAB_VIDEO_DATA_KEY]: nextData });
}

function runVideoMutation(task) {
  const run = tabVideoMutationQueue.then(task, task);
  tabVideoMutationQueue = run.catch(() => {});
  return run;
}

async function loadTabImageData() {
  if (tabImageDataCache && typeof tabImageDataCache === 'object') {
    return tabImageDataCache;
  }
  const storageArea = getVideoStorageArea();
  const stored = await storageArea.get(TAB_IMAGE_DATA_KEY);
  const parsed = stored[TAB_IMAGE_DATA_KEY];
  tabImageDataCache =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return tabImageDataCache;
}

async function saveTabImageData(nextData) {
  tabImageDataCache = nextData;
  const storageArea = getVideoStorageArea();
  await storageArea.set({ [TAB_IMAGE_DATA_KEY]: nextData });
}

function runImageMutation(task) {
  const run = tabImageMutationQueue.then(task, task);
  tabImageMutationQueue = run.catch(() => {});
  return run;
}

async function setBadgeForTab(tabId, count) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  try {
    await chrome.action.setBadgeText({
      text: count > 0 ? String(count) : '',
      tabId,
    });
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({
        color: '#11e8a4',
        tabId,
      });
    }
  } catch {
    // Tab can disappear during async updates.
  }
}

function normalizeLocalHelperUrl(value) {
  const raw =
    typeof value === 'string' && value.trim()
      ? value.trim()
      : DEFAULT_LOCAL_HELPER_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return DEFAULT_LOCAL_HELPER_URL;
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return DEFAULT_LOCAL_HELPER_URL;
  }
}

async function callLocalHelper(baseUrl, pathName, payload, timeoutMs = LOCAL_HELPER_TIMEOUT_MS) {
  const normalizedBase = normalizeLocalHelperUrl(baseUrl);
  const endpoint = new URL(pathName, `${normalizedBase}/`).href;
  const abortController = new AbortController();
  const timerId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: abortController.signal,
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      const reason =
        parsed?.error ||
        parsed?.message ||
        `${response.status} ${response.statusText}`;
      throw new Error(`Local helper failed: ${reason}`);
    }
    return {
      baseUrl: normalizedBase,
      endpoint,
      data: parsed || { ok: true },
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Local helper request timed out.');
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Local helper request failed.');
  } finally {
    clearTimeout(timerId);
  }
}

async function readTabVideos(tabId) {
  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return { videos: [], badge: 0 };
  }
  const allData = await loadTabVideoData();
  const current = allData[tabKey];
  if (!current || !Array.isArray(current.videos)) {
    return { videos: [], badge: 0 };
  }
  const curated = curateVideosForDisplay(current.videos);
  return {
    videos: curated,
    badge: curated.length,
  };
}

async function addVideoLinks(tabId, videoLinks) {
  if (!Number.isInteger(tabId) || !Array.isArray(videoLinks) || videoLinks.length === 0) {
    return;
  }

  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return;
  }

  let nextBadge = 0;
  await runVideoMutation(async () => {
    const allData = await loadTabVideoData();
    const current = allData[tabKey] && Array.isArray(allData[tabKey].videos)
      ? allData[tabKey]
      : { videos: [], badge: 0 };

    const merged = new Map();
    for (const existing of current.videos) {
      if (!existing || typeof existing !== 'object') continue;
      const normalizedExisting = normalizeVideoLink(existing);
      if (!normalizedExisting) continue;
      merged.set(buildVideoKey(normalizedExisting), normalizedExisting);
    }

    for (const rawLink of videoLinks) {
      const normalized = normalizeVideoLink(rawLink);
      if (!normalized) continue;
      // Skip known-small files immediately (under 1.5MB)
      const knownSize = asPositiveInt(normalized.sizeBytes);
      if (knownSize && knownSize < MIN_VIDEO_DISPLAY_BYTES) continue;
      const key = buildVideoKey(normalized);
      const existing = merged.get(key);
      merged.set(key, existing ? mergeVideoLink(existing, normalized) : normalized);
    }

    const nextVideos = Array.from(merged.values());
    nextBadge = curateVideosForDisplay(nextVideos).length;
    allData[tabKey] = {
      videos: nextVideos,
      badge: nextBadge,
      updatedAt: Date.now(),
    };

    await saveTabVideoData(allData);
  });
  await setBadgeForTab(tabId, nextBadge);
}

async function clearTabVideos(tabId) {
  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return;
  }
  await runVideoMutation(async () => {
    const allData = await loadTabVideoData();
    if (allData[tabKey]) {
      delete allData[tabKey];
      await saveTabVideoData(allData);
    }
  });
  await setBadgeForTab(Number(tabId), 0);
}

async function readTabImages(tabId) {
  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return { images: [] };
  }
  const allData = await loadTabImageData();
  const current = allData[tabKey];
  if (!current || !Array.isArray(current.images)) {
    return { images: [] };
  }
  return {
    images: curateImagesForDisplay(current.images),
  };
}

async function addImageLinks(tabId, imageLinks) {
  if (!Number.isInteger(tabId) || !Array.isArray(imageLinks) || imageLinks.length === 0) {
    return;
  }
  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return;
  }

  await runImageMutation(async () => {
    const allData = await loadTabImageData();
    const current =
      allData[tabKey] && Array.isArray(allData[tabKey].images)
        ? allData[tabKey]
        : { images: [], updatedAt: 0 };
    const merged = new Map();
    for (const existing of current.images) {
      if (!existing || typeof existing !== 'object') continue;
      const normalizedExisting = normalizeImageLink(existing);
      if (!normalizedExisting) continue;
      merged.set(normalizedExisting.url, normalizedExisting);
    }

    for (const rawImage of imageLinks) {
      const normalized = normalizeImageLink(rawImage);
      if (!normalized) continue;
      const key = normalized.url;
      const existing = merged.get(key);
      merged.set(key, existing ? mergeImageLink(existing, normalized) : normalized);
    }

    allData[tabKey] = {
      images: Array.from(merged.values()),
      updatedAt: Date.now(),
    };
    await saveTabImageData(allData);
  });
}

async function clearTabImages(tabId) {
  const tabKey = normalizeTabId(tabId);
  if (!tabKey) {
    return;
  }
  await runImageMutation(async () => {
    const allData = await loadTabImageData();
    if (allData[tabKey]) {
      delete allData[tabKey];
      await saveTabImageData(allData);
    }
  });
}

function parseContentLength(headers) {
  const header = headers.get('content-length');
  if (!header) {
    return null;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRangeLength(headers) {
  const contentRange = headers.get('content-range');
  if (!contentRange) {
    return null;
  }
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = VIDEO_METADATA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchVideoMetadataFromNetwork(url) {
  let contentType = '';
  let sizeBytes = null;

  try {
    const headResp = await fetchWithTimeout(url, { method: 'HEAD' });
    contentType = headResp.headers.get('content-type') || '';
    if (headResp.ok || headResp.status === 405) {
      sizeBytes = parseContentLength(headResp.headers);
    }
  } catch {
    // Fallback to range request.
  }

  if (!sizeBytes) {
    try {
      const rangeResp = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (rangeResp.ok || rangeResp.status === 206) {
        contentType = contentType || rangeResp.headers.get('content-type') || '';
        sizeBytes =
          parseRangeLength(rangeResp.headers) || parseContentLength(rangeResp.headers);
      }
    } catch {
      // Keep metadata empty when source does not expose size.
    }
  }

  return {
    sizeBytes: asPositiveInt(sizeBytes),
    contentType,
  };
}

function buildVideoMetadata(video, fallbackUrl = '') {
  const url = video?.url || fallbackUrl;
  const playlist = Boolean(video?.playlist) || isPlaylistUrl(url);
  const sizeBytes = asPositiveInt(video?.sizeBytes);
  return {
    playlist,
    ext: video?.ext || extractExtFromUrl(url),
    contentType: video?.contentType || '',
    thumbnailUrl: video?.thumbnailUrl || '',
    audioUrl: video?.audioUrl || '',
    audioExt: video?.audioExt || '',
    mp3Available: Boolean(video?.mp3Available),
    sizeBytes,
    sizeText: sizeBytes
      ? formatBytes(sizeBytes)
      : playlist
        ? 'Stream playlist'
        : '',
  };
}

async function getVideoMetadata(tabId, url) {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) {
    throw new Error('Invalid media URL.');
  }
  const tabKey = normalizeTabId(tabId);
  const allData = await loadTabVideoData();
  const tab = tabKey ? allData[tabKey] : null;
  const videos = Array.isArray(tab?.videos) ? tab.videos : [];
  const index = videos.findIndex((video) => video && video.url === normalizedUrl);
  const existingVideo = index >= 0 ? videos[index] : null;
  const existingMetadata = buildVideoMetadata(existingVideo, normalizedUrl);

  if (existingMetadata.playlist) {
    return existingMetadata;
  }

  if (existingMetadata.sizeBytes && existingMetadata.contentType) {
    return existingMetadata;
  }

  let inflight = videoMetadataInflight.get(normalizedUrl);
  if (!inflight) {
    inflight = fetchVideoMetadataFromNetwork(normalizedUrl).finally(() => {
      videoMetadataInflight.delete(normalizedUrl);
    });
    videoMetadataInflight.set(normalizedUrl, inflight);
  }
  const fetched = await inflight;

  const nextSizeBytes = fetched.sizeBytes || existingMetadata.sizeBytes || null;
  const nextContentType = fetched.contentType || existingMetadata.contentType || '';
  const nextMetadata = {
    ...existingMetadata,
    sizeBytes: nextSizeBytes,
    sizeText: nextSizeBytes ? formatBytes(nextSizeBytes) : '',
    contentType: nextContentType,
  };

  if (index >= 0) {
    await runVideoMutation(async () => {
      const freshAllData = await loadTabVideoData();
      const freshTab = freshAllData[tabKey];
      if (!freshTab || !Array.isArray(freshTab.videos)) {
        return;
      }
      const freshIndex = freshTab.videos.findIndex(
        (video) => video && video.url === normalizedUrl
      );
      if (freshIndex < 0) {
        return;
      }
      const freshVideos = freshTab.videos.slice();
      freshVideos[freshIndex] = {
        ...freshVideos[freshIndex],
        sizeBytes: nextMetadata.sizeBytes,
        sizeText: nextMetadata.sizeText,
        contentType: nextMetadata.contentType,
      };
      freshAllData[tabKey] = {
        ...freshTab,
        videos: freshVideos,
        badge: freshVideos.length,
        updatedAt: Date.now(),
      };
      await saveTabVideoData(freshAllData);
    });
  }

  return nextMetadata;
}

function buildImageMetadata(image, fallbackUrl = '') {
  const url = image?.url || fallbackUrl;
  const sizeBytes = asPositiveInt(image?.sizeBytes);
  const width = asPositiveInt(image?.width);
  const height = asPositiveInt(image?.height);
  return {
    ext: image?.ext || extractExtFromUrl(url),
    format: image?.format || image?.ext || extractExtFromUrl(url),
    contentType: image?.contentType || '',
    sizeBytes,
    sizeText: sizeBytes ? formatBytes(sizeBytes) : '',
    width: width || null,
    height: height || null,
    altText: image?.altText || '',
    titleText: image?.titleText || '',
  };
}

async function getImageMetadata(tabId, url) {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) {
    throw new Error('Invalid image URL.');
  }
  const tabKey = normalizeTabId(tabId);
  const allData = await loadTabImageData();
  const tab = tabKey ? allData[tabKey] : null;
  const images = Array.isArray(tab?.images) ? tab.images : [];
  const index = images.findIndex((image) => image && image.url === normalizedUrl);
  const existingImage = index >= 0 ? images[index] : null;
  const existingMetadata = buildImageMetadata(existingImage, normalizedUrl);

  if (existingMetadata.sizeBytes && existingMetadata.contentType) {
    return existingMetadata;
  }

  let inflight = imageMetadataInflight.get(normalizedUrl);
  if (!inflight) {
    inflight = fetchVideoMetadataFromNetwork(normalizedUrl).finally(() => {
      imageMetadataInflight.delete(normalizedUrl);
    });
    imageMetadataInflight.set(normalizedUrl, inflight);
  }
  const fetched = await inflight;

  const nextSizeBytes = fetched.sizeBytes || existingMetadata.sizeBytes || null;
  const nextContentType = fetched.contentType || existingMetadata.contentType || '';
  const nextMetadata = {
    ...existingMetadata,
    sizeBytes: nextSizeBytes,
    sizeText: nextSizeBytes ? formatBytes(nextSizeBytes) : '',
    contentType: nextContentType,
    ext:
      existingMetadata.ext ||
      extractExtFromContentType(nextContentType) ||
      extractExtFromUrl(normalizedUrl),
  };
  nextMetadata.format = nextMetadata.ext || nextMetadata.format || '';

  if (index >= 0) {
    await runImageMutation(async () => {
      const freshAllData = await loadTabImageData();
      const freshTab = freshAllData[tabKey];
      if (!freshTab || !Array.isArray(freshTab.images)) {
        return;
      }
      const freshIndex = freshTab.images.findIndex(
        (image) => image && image.url === normalizedUrl
      );
      if (freshIndex < 0) {
        return;
      }
      const freshImages = freshTab.images.slice();
      freshImages[freshIndex] = {
        ...freshImages[freshIndex],
        sizeBytes: nextMetadata.sizeBytes,
        sizeText: nextMetadata.sizeText,
        contentType: nextMetadata.contentType,
        ext: nextMetadata.ext,
        format: nextMetadata.format,
      };
      freshAllData[tabKey] = {
        ...freshTab,
        images: freshImages,
        updatedAt: Date.now(),
      };
      await saveTabImageData(freshAllData);
    });
  }

  return nextMetadata;
}

// === webRequest Video Detection (Layer 1 — most reliable) ===

const VIDEO_CONTENT_TYPES = /^(video\/|application\/x-mpegurl|application\/vnd\.apple\.mpegurl|application\/dash\+xml)/i;
const VIDEO_URL_PATTERNS = /\.(mp4|webm|m3u8|mpd|mov|m4v|ts)(\?|$)/i;
const MIN_VIDEO_SIZE = 1_500_000; // 1.5MB — skip junk/tiny files
const JUNK_URL_PATTERNS = /(?:thumbnail|storyboard|sprite|preview|poster|analytics|tracking|telemetry|subtitle|caption|\.vtt|\.srt|googlesyndication|doubleclick|ads\.|adserver)/i;

function isLikelyVideoResponse(details) {
  const url = details.url || '';
  const contentType = (details.responseHeaders || [])
    .find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  const contentLength = Number(
    (details.responseHeaders || [])
      .find(h => h.name.toLowerCase() === 'content-length')?.value || 0
  );

  // Skip junk URLs
  if (JUNK_URL_PATTERNS.test(url)) return false;

  // Skip tiny files
  if (contentLength > 0 && contentLength < MIN_VIDEO_SIZE) return false;

  if (/application\/octet-stream/i.test(contentType)) {
    if (VIDEO_URL_PATTERNS.test(url)) return true;
    if (/[?&](?:mime=video|type=video|itag=\d{2,3}|clen=\d+)/i.test(url)) {
      return true;
    }
    return false;
  }

  // Match by content-type
  if (VIDEO_CONTENT_TYPES.test(contentType)) return true;

  // Match by URL pattern
  if (VIDEO_URL_PATTERNS.test(url)) return true;

  return false;
}

function extractVideoInfoFromRequest(details) {
  const url = details.url;
  const contentType = (details.responseHeaders || [])
    .find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  const contentLength = Number(
    (details.responseHeaders || [])
      .find(h => h.name.toLowerCase() === 'content-length')?.value || 0
  );

  const isPlaylist = /\.m3u8(\?|$)|\.mpd(\?|$)|mpegurl|dash\+xml/i.test(url + contentType);
  const ext = extractExtFromUrl(url);

  return {
    url,
    quality: 'N/A',
    fileName: 'video',
    playlist: isPlaylist,
    contentType: contentType.split(';')[0].trim(),
    sizeBytes: contentLength > 0 ? contentLength : null,
    ext: ext || '',
    source: 'webRequest',
    hasAudio: null,
  };
}

if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
      if (!isLikelyVideoResponse(details)) return;

      const videoInfo = extractVideoInfoFromRequest(details);
      void addVideoLinks(details.tabId, [videoInfo]);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}

// Clear videos when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void clearTabVideos(tabId);
    void clearTabImages(tabId);
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabVideos(tabId);
  void clearTabImages(tabId);
});

// === AI Config Helpers (ported from Console Signal background.js) ===

function trimToMaxChars(text, maxChars) {
  if (typeof text !== 'string') {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  const hiddenChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}

... [truncated ${hiddenChars} chars before sending to AI]`;
}

function redactSensitiveText(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(
      /(password|token|secret)\s*[:=]\s*["']?[^"'\s]+/gi,
      '$1=[REDACTED]'
    );
}

function buildSystemPrompt() {
  return [
    'You are an expert debugging assistant for web apps.',
    'Transform browser console logs into a concise engineering brief for an AI developer.',
    'Prioritize real errors over noisy warnings.',
    'Separate deprecations/noise from actionable failures.',
    'Be concrete and concise.',
  ].join(' ');
}

function buildUserPrompt({ logsText, context, styleInstruction }) {
  return [
    'Create a concise response with this exact structure:',
    '',
    '## TL;DR',
    '- One sentence summary.',
    '',
    '## Primary Failures',
    '- Up to 4 bullets (most critical first).',
    '',
    '## Likely Root Causes',
    '- Up to 4 bullets with confidence (high/med/low).',
    '',
    '## Fix Plan',
    '1. Short numbered steps.',
    '',
    '## Verify',
    '- Up to 4 checks.',
    '',
    '## AI_DEV_INPUT_JSON',
    '```json',
    '{',
    '  "suspect_area": "...",',
    '  "top_errors": ["..."],',
    '  "likely_causes": ["..."],',
    '  "next_actions": ["..."]',
    '}',
    '```',
    '',
    'Keep output below ~350 words.',
    styleInstruction || 'Keep output concise.',
    '',
    'Context:',
    JSON.stringify(context, null, 2),
    '',
    'Logs:',
    logsText,
  ].join('\n');
}

function buildContextCondenseSystemPrompt() {
  return [
    'You are an expert technical summarizer.',
    'Condense page context into a high-signal brief for another AI coding assistant.',
    'Preserve critical facts, remove noise, and keep it concise.',
  ].join(' ');
}

function buildContextCondenseUserPrompt({ pageUrl, contextText }) {
  return [
    'Return exactly this structure:',
    '',
    '## TL;DR',
    '- One sentence summary.',
    '',
    '## Key Context',
    '- 4 to 8 bullets with important facts, entities, and numbers.',
    '',
    '## What To Ignore',
    '- Up to 4 bullets for irrelevant/noisy content.',
    '',
    '## Suggested Next Prompt',
    '```text',
    'One concise prompt another AI can use with this context.',
    '```',
    '',
    'Keep output below 220 words.',
    '',
    `Page URL: ${pageUrl || ''}`,
    '',
    'Source Context:',
    contextText,
  ].join('\n');
}

async function getActiveProvider() {
  const stored = await chrome.storage.local.get([
    PROVIDER_STORAGE_KEYS.activeProvider,
  ]);
  const provider = stored[PROVIDER_STORAGE_KEYS.activeProvider];
  return typeof provider === 'string' && AI_PROVIDERS[provider]
    ? provider
    : 'deepseek';
}

async function getProviderConfig(provider) {
  const p = provider || (await getActiveProvider());
  const config = AI_PROVIDERS[p];
  if (!config) throw new Error(`Unknown provider: ${p}`);

  const keyField = PROVIDER_STORAGE_KEYS[`${p}_apiKey`];
  const modelField = PROVIDER_STORAGE_KEYS[`${p}_model`];
  const baseUrlField = PROVIDER_STORAGE_KEYS[`${p}_baseUrl`];

  const keys = [keyField, modelField, baseUrlField].filter(Boolean);
  const stored = await chrome.storage.local.get(keys);

  return {
    provider: p,
    apiKey: keyField ? (stored[keyField] || '') : '',
    model: modelField ? (stored[modelField] || config.defaultModel) : config.defaultModel,
    baseUrl: baseUrlField ? (stored[baseUrlField] || '') : '',
  };
}

async function saveProviderConfig({ provider, apiKey, model, baseUrl }) {
  const p = provider || (await getActiveProvider());
  const update = {};

  if (typeof apiKey === 'string') {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) throw new Error('API key is empty.');
    const keyField = PROVIDER_STORAGE_KEYS[`${p}_apiKey`];
    if (keyField) update[keyField] = normalizedKey;
  }

  if (typeof model === 'string' && model.trim()) {
    const modelField = PROVIDER_STORAGE_KEYS[`${p}_model`];
    if (modelField) update[modelField] = model.trim();
  }

  if (typeof baseUrl === 'string') {
    const baseUrlField = PROVIDER_STORAGE_KEYS[`${p}_baseUrl`];
    if (baseUrlField) update[baseUrlField] = baseUrl.trim();
  }

  if (Object.keys(update).length > 0) {
    await chrome.storage.local.set(update);
  }

  const config = await getProviderConfig(p);
  return {
    provider: p,
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

async function setActiveProviderStorage(provider) {
  if (!AI_PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  await chrome.storage.local.set({
    [PROVIDER_STORAGE_KEYS.activeProvider]: provider,
  });
}

async function clearProviderKey(provider) {
  const p = provider || (await getActiveProvider());
  const keyField = PROVIDER_STORAGE_KEYS[`${p}_apiKey`];
  if (keyField) {
    await chrome.storage.local.remove(keyField);
  }
  const config = await getProviderConfig(p);
  return {
    provider: p,
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

// === AI Call ===

async function callAiProviderWithPrompts({
  provider,
  apiKey,
  model,
  baseUrl,
  systemPrompt,
  userPrompt,
  maxTokens = 900,
}) {
  const { endpoint, headers, body } = buildFetchOptions({
    provider,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    baseUrl,
    maxTokens,
  });

  const providerLabel = AI_PROVIDERS[provider]?.label || provider;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  if (!response.ok) {
    let errorReason = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(rawText);
      errorReason = parsed.error?.message || parsed.message || errorReason;
    } catch (error) {
      if (rawText) {
        errorReason = rawText.slice(0, 300);
      }
      throw new Error(`${providerLabel} request failed: ${errorReason}`, { cause: error });
    }
    throw new Error(`${providerLabel} request failed: ${errorReason}`);
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`${providerLabel} returned a non-JSON response.`, { cause: error });
  }

  const { summary, usage, model: respModel } = parseAiResponse(provider, parsedResponse);
  if (!summary || typeof summary !== 'string') {
    throw new Error(`${providerLabel} response did not contain summary text.`);
  }

  return {
    summary,
    usage: usage || null,
    model: respModel || model,
  };
}

async function callAiProvider({ provider, apiKey, model, baseUrl, logsText, context }) {
  const clippedLogs = trimToMaxChars(redactSensitiveText(logsText), 14000);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    logsText: clippedLogs,
    context,
    styleInstruction: context.styleInstruction,
  });

  return callAiProviderWithPrompts({
    provider,
    apiKey,
    model,
    baseUrl,
    systemPrompt,
    userPrompt,
    maxTokens: 900,
  });
}

async function condenseContextWithAi({
  provider,
  apiKey,
  model,
  baseUrl,
  contextText,
  pageUrl,
}) {
  const payload = trimToMaxChars(redactSensitiveText(contextText), 12000);
  const systemPrompt = buildContextCondenseSystemPrompt();
  const userPrompt = buildContextCondenseUserPrompt({
    pageUrl,
    contextText: payload,
  });

  return callAiProviderWithPrompts({
    provider,
    apiKey,
    model,
    baseUrl,
    systemPrompt,
    userPrompt,
    maxTokens: 700,
  });
}

// === Message Handler ===

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message) {
        throw new Error('Invalid message.');
      }

      // --- Video links ---
      if (message.message === 'add-video-links') {
        const tabId = sender.tab?.id;
        if (Number.isInteger(tabId) && tabId >= 0 && message.videoLinks) {
          await addVideoLinks(tabId, message.videoLinks);
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.message === 'add-image-links') {
        const tabId = sender.tab?.id;
        if (Number.isInteger(tabId) && tabId >= 0 && message.imageLinks) {
          await addImageLinks(tabId, message.imageLinks);
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'GET_TAB_VIDEOS') {
        const tabId = Number(message.tabId);
        const data = await readTabVideos(tabId);
        await setBadgeForTab(tabId, data.badge);
        sendResponse({ ok: true, videos: data.videos });
        return;
      }

      if (message.type === 'GET_VIDEO_METADATA') {
        const tabId =
          Number.isInteger(Number(message.tabId))
            ? Number(message.tabId)
            : sender.tab?.id;
        const metadata = await getVideoMetadata(tabId, message.url);
        sendResponse({ ok: true, metadata });
        return;
      }

      if (message.type === 'GET_TAB_IMAGES') {
        const tabId = Number(message.tabId);
        const data = await readTabImages(tabId);
        sendResponse({ ok: true, images: data.images });
        return;
      }

      if (message.type === 'GET_IMAGE_METADATA') {
        const tabId =
          Number.isInteger(Number(message.tabId))
            ? Number(message.tabId)
            : sender.tab?.id;
        const metadata = await getImageMetadata(tabId, message.url);
        sendResponse({ ok: true, metadata });
        return;
      }

      if (message.type === 'DOWNLOAD_VIDEO') {
        if (!message.url || typeof message.url !== 'string') {
          throw new Error('No download URL provided.');
        }
        chrome.downloads.download({
          url: message.url,
          filename: message.filename || undefined,
          conflictAction: 'uniquify',
        }, (downloadId) => {
          if (chrome.runtime.lastError || !Number.isInteger(downloadId)) {
            sendResponse({
              ok: false,
              error:
                chrome.runtime.lastError?.message ||
                'Download could not be started for this URL.',
            });
            return;
          }
          sendResponse({ ok: true, downloadId });
        });
        return;
      }

      if (message.type === 'DOWNLOAD_IMAGE') {
        if (!message.url || typeof message.url !== 'string') {
          throw new Error('No image URL provided.');
        }
        const normalizedUrl = normalizeHttpUrl(message.url);
        if (!normalizedUrl) {
          throw new Error('Invalid image URL.');
        }
        chrome.downloads.download(
          {
            url: normalizedUrl,
            filename: message.filename || undefined,
            conflictAction: 'uniquify',
          },
          (downloadId) => {
            if (chrome.runtime.lastError || !Number.isInteger(downloadId)) {
              sendResponse({
                ok: false,
                error:
                  chrome.runtime.lastError?.message ||
                  'Image download could not be started for this URL.',
              });
              return;
            }
            sendResponse({ ok: true, downloadId });
          }
        );
        return;
      }

      if (message.type === 'DOWNLOAD_AUDIO') {
        if (!message.url || typeof message.url !== 'string') {
          throw new Error('No audio URL provided.');
        }
        const normalizedUrl = normalizeHttpUrl(message.url);
        if (!normalizedUrl) {
          throw new Error('Invalid audio URL.');
        }
        const ext = extractExtFromUrl(normalizedUrl);
        const requireDirectAudio =
          message.requireDirectAudio !== false && message.requireMp3 !== false;
        const isDirectAudio = DIRECT_AUDIO_EXTENSIONS.has(ext);
        if (requireDirectAudio && !isDirectAudio) {
          sendResponse({
            ok: false,
            error: 'Direct audio download is not possible for this stream type.',
          });
          return;
        }
        chrome.downloads.download(
          {
            url: normalizedUrl,
            filename: message.filename || undefined,
            conflictAction: 'uniquify',
          },
          (downloadId) => {
            if (chrome.runtime.lastError || !Number.isInteger(downloadId)) {
              sendResponse({
                ok: false,
                error:
                  chrome.runtime.lastError?.message ||
                  'Audio download could not be started for this URL.',
              });
              return;
            }
            sendResponse({ ok: true, downloadId });
          }
        );
        return;
      }

      if (message.type === 'EXTERNAL_HELPER_HEALTHCHECK') {
        const baseUrl = normalizeLocalHelperUrl(message.localHelperUrl);
        const result = await callLocalHelper(
          baseUrl,
          '/health',
          {},
          8000
        );
        sendResponse({
          ok: true,
          baseUrl: result.baseUrl,
          helper: result.data,
        });
        return;
      }

      if (message.type === 'EXTERNAL_DOWNLOAD_VIDEO') {
        const tabUrl = normalizeHttpUrl(sender.tab?.url || '');
        const preferredUrl =
          normalizeHttpUrl(message.sourcePageUrl) ||
          normalizeHttpUrl(message.pageUrl) ||
          tabUrl ||
          normalizeHttpUrl(message.url);
        if (!preferredUrl) {
          throw new Error('No valid source URL was provided for external video download.');
        }
        const baseUrl = normalizeLocalHelperUrl(message.localHelperUrl);
        const result = await callLocalHelper(baseUrl, '/download-video', {
          url: preferredUrl,
          title:
            typeof message.title === 'string' && message.title.trim()
              ? message.title.trim()
              : '',
          requestedUrl: normalizeHttpUrl(message.url) || '',
        });
        sendResponse({
          ok: true,
          baseUrl: result.baseUrl,
          result: result.data,
        });
        return;
      }

      if (message.type === 'EXTERNAL_EXTRACT_AUDIO') {
        const tabUrl = normalizeHttpUrl(sender.tab?.url || '');
        const preferredUrl =
          normalizeHttpUrl(message.sourcePageUrl) ||
          normalizeHttpUrl(message.pageUrl) ||
          tabUrl ||
          normalizeHttpUrl(message.url);
        if (!preferredUrl) {
          throw new Error('No valid source URL was provided for external audio extraction.');
        }
        const requestedFormat =
          typeof message.audioFormat === 'string' && message.audioFormat.trim()
            ? message.audioFormat.trim().toLowerCase()
            : 'mp3';
        const safeAudioFormat = ['mp3', 'm4a', 'aac', 'wav', 'opus', 'flac'].includes(
          requestedFormat
        )
          ? requestedFormat
          : 'mp3';
        const baseUrl = normalizeLocalHelperUrl(message.localHelperUrl);
        const result = await callLocalHelper(baseUrl, '/extract-audio', {
          url: preferredUrl,
          audioFormat: safeAudioFormat,
          title:
            typeof message.title === 'string' && message.title.trim()
              ? message.title.trim()
              : '',
          requestedUrl: normalizeHttpUrl(message.url) || '',
        });
        sendResponse({
          ok: true,
          baseUrl: result.baseUrl,
          result: result.data,
        });
        return;
      }

      // --- Sitemap fetch ---
      if (message.type === 'FETCH_SITEMAP') {
        if (!message.url || typeof message.url !== 'string') {
          throw new Error('No URL provided for sitemap fetch.');
        }
        const sitemapResp = await fetch(message.url, {
          headers: { Accept: 'application/xml, text/xml, text/plain' },
        });
        if (!sitemapResp.ok) {
          throw new Error(
            `Sitemap fetch failed: ${sitemapResp.status} ${sitemapResp.statusText}`
          );
        }
        const xml = await sitemapResp.text();
        sendResponse({
          ok: true,
          xml,
          contentType: sitemapResp.headers.get('content-type') || '',
        });
        return;
      }

      // --- AI config: get ---
      if (message.type === 'AI_GET_CONFIG' || message.type === 'DEEPSEEK_GET_CONFIG') {
        const provider = message.provider || (await getActiveProvider());
        const config = await getProviderConfig(provider);
        sendResponse({
          ok: true,
          provider: config.provider,
          hasApiKey: Boolean(config.apiKey),
          model: config.model,
          baseUrl: config.baseUrl,
          activeProvider: await getActiveProvider(),
        });
        return;
      }

      // --- AI config: save ---
      if (message.type === 'AI_SAVE_CONFIG' || message.type === 'DEEPSEEK_SAVE_CONFIG') {
        const provider = message.provider || (await getActiveProvider());
        const saved = await saveProviderConfig({
          provider,
          apiKey: message.apiKey,
          model: message.model,
          baseUrl: message.baseUrl,
        });
        sendResponse({ ok: true, ...saved });
        return;
      }

      // --- AI config: clear key ---
      if (message.type === 'AI_CLEAR_KEY' || message.type === 'DEEPSEEK_CLEAR_KEY') {
        const provider = message.provider || (await getActiveProvider());
        const cleared = await clearProviderKey(provider);
        sendResponse({ ok: true, ...cleared });
        return;
      }

      // --- AI config: set active provider ---
      if (message.type === 'AI_SET_PROVIDER') {
        await setActiveProviderStorage(message.provider);
        const config = await getProviderConfig(message.provider);
        sendResponse({
          ok: true,
          provider: message.provider,
          hasApiKey: Boolean(config.apiKey),
          model: config.model,
          baseUrl: config.baseUrl,
        });
        return;
      }

      // --- AI summarize ---
      if (message.type === 'AI_SUMMARIZE' || message.type === 'DEEPSEEK_SUMMARIZE') {
        const provider = message.provider || (await getActiveProvider());
        const config = await getProviderConfig(provider);
        const apiKey = config.apiKey;
        const model =
          typeof message.model === 'string' && message.model.trim()
            ? message.model.trim()
            : config.model;

        if (AI_PROVIDERS[provider]?.authType !== 'none' && !apiKey) {
          throw new Error(`No API key saved for ${AI_PROVIDERS[provider]?.label || provider}.`);
        }
        if (!message.logsText || typeof message.logsText !== 'string') {
          throw new Error('No logs available for summarization.');
        }

        const summaryResult = await callAiProvider({
          provider,
          apiKey,
          model,
          baseUrl: config.baseUrl,
          logsText: message.logsText,
          context: {
            pageUrl: message.pageUrl || sender.tab?.url || '',
            levelPreset: message.levelPreset || 'full',
            format: message.format || 'ai',
            selectedCount: Number(message.selectedCount) || 0,
            uniqueCount: Number(message.uniqueCount) || 0,
            summaryStyle: message.summaryStyle || 'brief',
            styleInstruction:
              typeof message.styleInstruction === 'string'
                ? message.styleInstruction
                : '',
          },
        });

        sendResponse({
          ok: true,
          summary: summaryResult.summary,
          usage: summaryResult.usage,
          model: summaryResult.model,
        });
        return;
      }

      if (message.type === 'AI_CONDENSE_CONTEXT') {
        const provider = message.provider || (await getActiveProvider());
        const config = await getProviderConfig(provider);
        const apiKey = config.apiKey;
        const model =
          typeof message.model === 'string' && message.model.trim()
            ? message.model.trim()
            : config.model;

        if (AI_PROVIDERS[provider]?.authType !== 'none' && !apiKey) {
          throw new Error(
            `No API key saved for ${AI_PROVIDERS[provider]?.label || provider}.`
          );
        }
        if (!message.contextText || typeof message.contextText !== 'string') {
          throw new Error('No page context provided.');
        }

        const result = await condenseContextWithAi({
          provider,
          apiKey,
          model,
          baseUrl: config.baseUrl,
          contextText: message.contextText,
          pageUrl: message.pageUrl || sender.tab?.url || '',
        });

        sendResponse({
          ok: true,
          summary: result.summary,
          usage: result.usage,
          model: result.model,
        });
        return;
      }

      throw new Error(`Unknown message type: ${message.type || message.message}`);
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : 'Unknown background error',
      });
    }
  })();

  return true;
});
