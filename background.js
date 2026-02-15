import {
  AI_PROVIDERS,
  PROVIDER_STORAGE_KEYS,
  buildFetchOptions,
  parseAiResponse,
} from './lib/ai-providers.js';

// === Video Link Storage (per tab, persisted across worker restarts) ===

const TAB_VIDEO_DATA_KEY = 'tabVideoDataV1';
const VIDEO_METADATA_TIMEOUT_MS = 8000;
const videoMetadataInflight = new Map();

let tabVideoDataCache = null;
let tabVideoMutationQueue = Promise.resolve();

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
    source: typeof link?.source === 'string' ? link.source.trim() : '',
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
    source: incoming.source || existing.source || '',
    hasAudio:
      incoming.hasAudio === true || incoming.hasAudio === false
        ? incoming.hasAudio
        : existing.hasAudio,
    requiresMux: Boolean(incoming.requiresMux || existing.requiresMux),
    isPrimary: Boolean(incoming.isPrimary || existing.isPrimary),
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

// Clear videos when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void clearTabVideos(tabId);
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabVideos(tabId);
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
  };
}

// === AI Call ===

async function callAiProvider({ provider, apiKey, model, baseUrl, logsText, context }) {
  const clippedLogs = trimToMaxChars(redactSensitiveText(logsText), 14000);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    logsText: clippedLogs,
    context,
    styleInstruction: context.styleInstruction,
  });

  const { endpoint, headers, body } = buildFetchOptions({
    provider,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    baseUrl,
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
        if (tabId && message.videoLinks) {
          await addVideoLinks(tabId, message.videoLinks);
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
