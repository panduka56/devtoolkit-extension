import {
  AI_PROVIDERS,
  PROVIDER_STORAGE_KEYS,
  buildFetchOptions,
  parseAiResponse,
} from './lib/ai-providers.js';

// === Navigation constants ===
const CATEGORIES = {
  video: { label: 'Video', views: ['video'] },
  console: { label: 'Console', views: ['logs', 'brief'] },
  pageintel: { label: 'Page Intel', views: ['seo', 'schema', 'sitemap'] },
  context: { label: 'Context', views: ['context'] },
  settings: { label: 'Settings', views: ['settings'] },
};

const VIEW_LABELS = {
  video: 'Downloads',
  logs: 'Main',
  brief: 'AI Brief',
  seo: 'SEO Meta',
  schema: 'Structured Data',
  sitemap: 'Sitemap',
  context: 'Context',
  settings: 'Settings',
};

const ALL_VIEWS = Object.values(CATEGORIES).flatMap((c) => c.views);

function categoryForView(viewName) {
  for (const [cat, cfg] of Object.entries(CATEGORIES)) {
    if (cfg.views.includes(viewName)) return cat;
  }
  return 'video';
}

// === DOM references ===
const statusEl = document.getElementById('status');
const aiStatusEl = document.getElementById('aiStatus');
const previewTextEl = document.getElementById('previewText');
const summaryTextEl = document.getElementById('summaryText');
const contextTextEl = document.getElementById('contextText');
const contextAiTextEl = document.getElementById('contextAiText');

const copyButton = document.getElementById('copyButton');
const refreshButton = document.getElementById('refreshButton');
const summarizeButton = document.getElementById('summarizeButton');
const copySummaryButton = document.getElementById('copySummaryButton');
const saveKeyButton = document.getElementById('saveKeyButton');
const clearKeyButton = document.getElementById('clearKeyButton');
const extractContextButton = document.getElementById('extractContextButton');
const condenseContextButton = document.getElementById('condenseContextButton');
const copyContextButton = document.getElementById('copyContextButton');

const formatSelect = document.getElementById('formatSelect');
const optimizeToggle = document.getElementById('optimizeToggle');
const maxEntriesInput = document.getElementById('maxEntriesInput');
const maxCharsInput = document.getElementById('maxCharsInput');
const modelSelect = document.getElementById('modelSelect');
const modelInput = document.getElementById('modelInput');
const summaryStyleSelect = document.getElementById('summaryStyleSelect');
const apiKeyInput = document.getElementById('apiKeyInput');
const providerSelect = document.getElementById('providerSelect');
const ollamaUrlInput = document.getElementById('ollamaUrlInput');
const apiKeySection = document.getElementById('apiKeySection');
const ollamaUrlSection = document.getElementById('ollamaUrlSection');
const saveOllamaUrlButton = document.getElementById('saveOllamaUrlButton');

const activeFormatEl = document.getElementById('activeFormat');
const apiKeyStateEl = document.getElementById('apiKeyState');
const contextStatusEl = document.getElementById('contextStatus');
const settingsStatusEl = document.getElementById('settingsStatus');

let currentProvider = 'deepseek';

const statTotalEl = document.getElementById('statTotal');
const statSelectedEl = document.getElementById('statSelected');
const statUniqueEl = document.getElementById('statUnique');
const statTokensEl = document.getElementById('statTokens');
const levelPresetButtons = Array.from(
  document.querySelectorAll('[data-level-preset]')
);

// Navigation DOM
const categoryButtons = Array.from(
  document.querySelectorAll('[data-category]')
);
const subTabsBar = document.getElementById('subTabsBar');

const viewMap = {
  video: document.getElementById('videoView'),
  logs: document.getElementById('logsView'),
  brief: document.getElementById('briefView'),
  context: document.getElementById('contextView'),
  seo: document.getElementById('seoView'),
  schema: document.getElementById('schemaView'),
  sitemap: document.getElementById('sitemapView'),
  settings: document.getElementById('settingsView'),
};

// === Video Panel DOM ===
const videoListEl = document.getElementById('videoList');
const videoStatusEl = document.getElementById('videoStatus');
const downloadAllButton = document.getElementById('downloadAllButton');

const CONTEXT_EXTRACTION_MAX_CHARS = 42000;

const SETTINGS_KEY = 'devtoolkit-settings-v1';
const DEFAULT_SETTINGS = {
  activeView: 'video',
  activeCategory: 'video',
  format: 'ai',
  levelPreset: 'warnings',
  optimizeForAi: true,
  maxEntries: 500,
  maxCharsPerEntry: 700,
  summaryStyle: 'brief',
};

let lastReport = null;
let lastSettingsHash = '';
let refreshCounter = 0;
let inputDebounceTimer = null;

let lastGeneratedSummary = '';
let lastGeneratedContext = '';
let lastGeneratedContextPageUrl = '';
let lastCondensedContext = '';

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.classList.remove('success', 'error');
  if (type) {
    statusEl.classList.add(type);
  }
}

function setAiStatus(message, type = '') {
  aiStatusEl.textContent = message;
  aiStatusEl.classList.remove('success', 'error');
  if (type) {
    aiStatusEl.classList.add(type);
  }
}

function setContextStatus(message, type = '') {
  contextStatusEl.textContent = message;
  contextStatusEl.classList.remove('success', 'error');
  if (type) {
    contextStatusEl.classList.add(type);
  }
}

function setSettingsStatus(message, type = '') {
  settingsStatusEl.textContent = message;
  settingsStatusEl.classList.remove('success', 'error');
  if (type) {
    settingsStatusEl.classList.add(type);
  }
}

function setVideoStatus(message, type = '') {
  videoStatusEl.textContent = message;
  videoStatusEl.classList.remove('success', 'error');
  if (type) videoStatusEl.classList.add(type);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out while waiting for response.')),
        ms
      );
    }),
  ]);
}

function parseIntInRange(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function getFormatLabel(format) {
  if (format === 'xml') {
    return 'XML compact';
  }
  if (format === 'plain') {
    return 'Plain text';
  }
  return 'AI compact';
}

function getLevelPresetLabel(levelPreset) {
  if (levelPreset === 'errors') {
    return 'Errors';
  }
  if (levelPreset === 'warnings') {
    return 'Medium';
  }
  return 'Full';
}

function setBusy(isBusy) {
  const busyElements = [copyButton, refreshButton, summarizeButton];
  busyElements.forEach((element) => {
    element.disabled = isBusy;
  });
  levelPresetButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function setActiveLevelPreset(levelPreset) {
  levelPresetButtons.forEach((button) => {
    const isActive = button.dataset.levelPreset === levelPreset;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function getActiveLevelPreset() {
  const activeButton = levelPresetButtons.find((button) =>
    button.classList.contains('is-active')
  );
  return activeButton
    ? activeButton.dataset.levelPreset
    : DEFAULT_SETTINGS.levelPreset;
}

function renderSubTabs(category) {
  const cfg = CATEGORIES[category];
  subTabsBar.innerHTML = '';
  if (!cfg || cfg.views.length <= 1) {
    subTabsBar.hidden = true;
    return;
  }
  subTabsBar.hidden = false;
  cfg.views.forEach((view) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subTab';
    btn.dataset.view = view;
    btn.textContent = VIEW_LABELS[view] || view;
    btn.addEventListener('click', () => {
      setActiveView(view);
      saveSettings();
    });
    subTabsBar.appendChild(btn);
  });
}

function setActiveView(viewName) {
  const nextView = viewMap[viewName] ? viewName : 'video';
  const cat = categoryForView(nextView);

  categoryButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.category === cat);
  });

  renderSubTabs(cat);

  const subTabs = subTabsBar.querySelectorAll('.subTab');
  subTabs.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === nextView);
  });

  Object.entries(viewMap).forEach(([name, element]) => {
    if (element) {
      element.classList.toggle('is-active', name === nextView);
    }
  });
}

function getActiveView() {
  for (const [name, element] of Object.entries(viewMap)) {
    if (element && element.classList.contains('is-active')) {
      return name;
    }
  }
  return 'video';
}

function readSettingsFromUi() {
  const view = getActiveView();
  return {
    activeView: view,
    activeCategory: categoryForView(view),
    format: formatSelect.value,
    levelPreset: getActiveLevelPreset(),
    optimizeForAi: optimizeToggle.checked,
    maxEntries: parseIntInRange(
      maxEntriesInput.value,
      50,
      5000,
      DEFAULT_SETTINGS.maxEntries
    ),
    maxCharsPerEntry: parseIntInRange(
      maxCharsInput.value,
      200,
      3000,
      DEFAULT_SETTINGS.maxCharsPerEntry
    ),
    summaryStyle: summaryStyleSelect.value || DEFAULT_SETTINGS.summaryStyle,
  };
}

function writeSettingsToUi(settings) {
  setActiveView(settings.activeView);
  formatSelect.value = settings.format;
  setActiveLevelPreset(settings.levelPreset);
  optimizeToggle.checked = settings.optimizeForAi;
  maxEntriesInput.value = String(settings.maxEntries);
  maxCharsInput.value = String(settings.maxCharsPerEntry);
  summaryStyleSelect.value = settings.summaryStyle;
}

function normalizeSettings(parsed) {
  let requestedActiveView =
    parsed && typeof parsed.activeView === 'string' ? parsed.activeView : '';

  if (requestedActiveView === 'labs') requestedActiveView = 'context';

  const activeView = ALL_VIEWS.includes(requestedActiveView)
    ? requestedActiveView
    : DEFAULT_SETTINGS.activeView;

  const requestedCategory =
    parsed && typeof parsed.activeCategory === 'string'
      ? parsed.activeCategory
      : '';
  const activeCategory = CATEGORIES[requestedCategory]
    ? requestedCategory
    : categoryForView(activeView);

  return {
    activeView,
    activeCategory,
    format:
      parsed &&
      typeof parsed.format === 'string' &&
      ['ai', 'xml', 'plain'].includes(parsed.format)
        ? parsed.format
        : DEFAULT_SETTINGS.format,
    levelPreset:
      parsed &&
      typeof parsed.levelPreset === 'string' &&
      ['errors', 'warnings', 'full'].includes(parsed.levelPreset)
        ? parsed.levelPreset
        : DEFAULT_SETTINGS.levelPreset,
    optimizeForAi:
      parsed && typeof parsed.optimizeForAi === 'boolean'
        ? parsed.optimizeForAi
        : DEFAULT_SETTINGS.optimizeForAi,
    maxEntries: parseIntInRange(
      parsed && parsed.maxEntries,
      50,
      5000,
      DEFAULT_SETTINGS.maxEntries
    ),
    maxCharsPerEntry: parseIntInRange(
      parsed && parsed.maxCharsPerEntry,
      200,
      3000,
      DEFAULT_SETTINGS.maxCharsPerEntry
    ),
    summaryStyle:
      parsed &&
      typeof parsed.summaryStyle === 'string' &&
      ['brief', 'steps', 'rootcause'].includes(parsed.summaryStyle)
        ? parsed.summaryStyle
        : DEFAULT_SETTINGS.summaryStyle,
  };
}

function loadSettings() {
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
}

function saveSettings() {
  const settings = readSettingsFromUi();
  writeSettingsToUi(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  updateFormatBadge(settings);
}

function updateFormatBadge(settings) {
  activeFormatEl.textContent = `${getFormatLabel(settings.format)} \u2022 ${getLevelPresetLabel(
    settings.levelPreset
  )}`;
}

function settingsHash(settings) {
  return JSON.stringify(settings);
}

function renderStats(report) {
  const totalCaptured =
    typeof report.totalCaptured === 'number' ? report.totalCaptured : 0;
  const selected = typeof report.count === 'number' ? report.count : 0;
  const unique =
    typeof report.uniqueCount === 'number' ? report.uniqueCount : 0;
  const estimatedTokens =
    typeof report.estimatedTokens === 'number' ? report.estimatedTokens : 0;

  statTotalEl.textContent = String(totalCaptured);
  statSelectedEl.textContent = String(selected);
  statUniqueEl.textContent = String(unique);
  statTokensEl.textContent = String(estimatedTokens);
}

function renderPreview(text) {
  previewTextEl.textContent = text || 'No logs captured yet.';
}

function setApiKeyState(configured) {
  const providerConfig = AI_PROVIDERS[currentProvider];
  const label = providerConfig ? providerConfig.label : currentProvider;
  if (currentProvider === 'ollama') {
    apiKeyStateEl.textContent = 'No key needed';
    apiKeyStateEl.classList.remove('stateWarn');
    apiKeyStateEl.classList.add('stateOk');
  } else if (configured) {
    apiKeyStateEl.textContent = 'Key configured';
    apiKeyStateEl.classList.remove('stateWarn');
    apiKeyStateEl.classList.add('stateOk');
    apiKeyInput.placeholder = 'Saved. Paste a new key to replace.';
  } else {
    apiKeyStateEl.textContent = 'Key missing';
    apiKeyStateEl.classList.remove('stateOk');
    apiKeyStateEl.classList.add('stateWarn');
    apiKeyInput.placeholder = `Paste ${label} API key`;
  }
}

function populateModelSelect(provider) {
  const config = AI_PROVIDERS[provider];
  if (!config) return;
  modelSelect.innerHTML = '';
  if (config.models.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(use custom model input)';
    modelSelect.appendChild(opt);
    modelSelect.disabled = true;
  } else {
    config.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSelect.appendChild(opt);
    });
    modelSelect.disabled = false;
  }
  modelSelect.value = config.defaultModel;
}

function updateProviderUi(provider) {
  const isOllama = provider === 'ollama';
  const usesCustomModel = AI_PROVIDERS[provider]?.models.length === 0;
  apiKeySection.style.display = isOllama ? 'none' : '';
  ollamaUrlSection.style.display = isOllama ? '' : 'none';
  modelInput.style.display = usesCustomModel ? '' : 'none';
  if (usesCustomModel) {
    modelInput.placeholder =
      provider === 'ollama' ? 'e.g. llama3.1:8b' : 'Enter model name';
  }
  populateModelSelect(provider);
}

function getSelectedModel(fallbackModel = '') {
  const providerConfig = AI_PROVIDERS[currentProvider];
  const usesCustomModel =
    providerConfig && providerConfig.models.length === 0;

  if (usesCustomModel) {
    const typed = (modelInput.value || '').trim();
    if (typed) {
      return typed;
    }
  }

  const picked = (modelSelect.value || '').trim();
  if (picked) {
    return picked;
  }

  return (
    (fallbackModel || '').trim() ||
    providerConfig?.defaultModel ||
    ''
  );
}

async function getProviderLocalConfig(provider) {
  const p = provider || currentProvider;
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

async function saveProviderLocalConfig({ provider, apiKey, model, baseUrl }) {
  const p = provider || currentProvider;
  const updates = {};

  if (typeof apiKey === 'string') {
    const nextKey = apiKey.trim();
    if (!nextKey) throw new Error('API key is empty.');
    const keyField = PROVIDER_STORAGE_KEYS[`${p}_apiKey`];
    if (keyField) updates[keyField] = nextKey;
  }

  if (typeof model === 'string' && model.trim()) {
    const modelField = PROVIDER_STORAGE_KEYS[`${p}_model`];
    if (modelField) updates[modelField] = model.trim();
  }

  if (typeof baseUrl === 'string') {
    const baseUrlField = PROVIDER_STORAGE_KEYS[`${p}_baseUrl`];
    if (baseUrlField) updates[baseUrlField] = baseUrl.trim();
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  return getProviderLocalConfig(p);
}

async function clearProviderLocalKey(provider) {
  const p = provider || currentProvider;
  const keyField = PROVIDER_STORAGE_KEYS[`${p}_apiKey`];
  if (keyField) {
    await chrome.storage.local.remove(keyField);
  }
  return getProviderLocalConfig(p);
}

async function setActiveProviderInStorage(provider) {
  if (!AI_PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  await chrome.storage.local.set({
    [PROVIDER_STORAGE_KEYS.activeProvider]: provider,
  });
}

async function loadAiConfig() {
  try {
    const stored = await chrome.storage.local.get([
      PROVIDER_STORAGE_KEYS.activeProvider,
    ]);
    const activeProvider = stored[PROVIDER_STORAGE_KEYS.activeProvider];
    currentProvider =
      typeof activeProvider === 'string' && AI_PROVIDERS[activeProvider]
        ? activeProvider
        : 'deepseek';

    providerSelect.value = currentProvider;
    updateProviderUi(currentProvider);

    const config = await getProviderLocalConfig(currentProvider);
    setApiKeyState(Boolean(config.apiKey));

    if (config.model) {
      if (modelSelect.disabled) {
        modelInput.value = config.model;
      } else {
        const options = Array.from(modelSelect.options).map((o) => o.value);
        if (options.includes(config.model)) {
          modelSelect.value = config.model;
        }
      }
    } else if (modelSelect.disabled) {
      modelInput.value = '';
    }

    if (!modelSelect.disabled) {
      const providerDefault = AI_PROVIDERS[currentProvider]?.defaultModel || '';
      if (!modelSelect.value && providerDefault) {
        modelSelect.value = providerDefault;
      }
    } else if (!modelInput.value) {
      const providerDefault = AI_PROVIDERS[currentProvider]?.defaultModel || '';
      if (providerDefault) {
        modelInput.value = providerDefault;
      }
    }

    if (currentProvider === 'ollama' && config.baseUrl) {
      ollamaUrlInput.value = config.baseUrl;
    }

    setSettingsStatus('Settings status: ready', 'success');
  } catch (error) {
    setApiKeyState(false);
    setSettingsStatus(`Settings status: ${error.message}`, 'error');
  }
}

async function switchProvider(provider) {
  currentProvider = provider;
  await setActiveProviderInStorage(provider);
  updateProviderUi(provider);
  const config = await getProviderLocalConfig(provider);
  setApiKeyState(Boolean(config.apiKey));
  if (config.model) {
    if (modelSelect.disabled) {
      modelInput.value = config.model;
    } else {
      const options = Array.from(modelSelect.options).map((o) => o.value);
      if (options.includes(config.model)) {
        modelSelect.value = config.model;
      }
    }
  } else if (modelSelect.disabled) {
    modelInput.value = '';
  }
  if (provider === 'ollama' && config.baseUrl) {
    ollamaUrlInput.value = config.baseUrl;
  }
}

function isUnsupportedTabUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return true;
  }
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('view-source:')
  );
}

function isNoReceiverError(error) {
  if (!error || typeof error.message !== 'string') {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('receiving end does not exist') ||
    msg.includes('could not establish connection') ||
    msg.includes('the message port closed')
  );
}

function buildRequestPayload(settings) {
  return {
    type: 'GET_CAPTURED_CONSOLE',
    format: settings.format,
    levelPreset: settings.levelPreset,
    optimizeForAi: settings.optimizeForAi,
    maxEntries: settings.maxEntries,
    maxCharsPerEntry: settings.maxCharsPerEntry,
  };
}

function buildContextRequestPayload() {
  return {
    type: 'GET_AI_CONTEXT',
    maxContextChars: CONTEXT_EXTRACTION_MAX_CHARS,
  };
}

async function sendReportRequest(tabId, settings) {
  const response = await withTimeout(
    chrome.tabs.sendMessage(tabId, buildRequestPayload(settings)),
    5000
  );
  if (!response || !response.ok || typeof response.text !== 'string') {
    throw new Error('Could not fetch logs from this page.');
  }
  return response;
}

async function sendContextRequest(tabId) {
  return withTimeout(
    chrome.tabs.sendMessage(tabId, buildContextRequestPayload()),
    12000
  );
}

function isValidContextResponse(response) {
  return Boolean(response && response.ok && typeof response.text === 'string');
}

async function ensureContentScriptLoaded(tabId) {
  const manifest = chrome.runtime.getManifest();
  const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0];
  const fallbackPath = 'content-script.js';

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      typeof contentScriptPath === 'string' && contentScriptPath
        ? contentScriptPath
        : fallbackPath,
    ],
  });
  await wait(120);
}

async function getActiveTabOrThrow() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab || typeof activeTab.id !== 'number') {
    throw new Error('No active tab found.');
  }
  if (isUnsupportedTabUrl(activeTab.url)) {
    throw new Error('This tab is restricted. Use a normal http/https page.');
  }
  return activeTab;
}

async function fetchReportFromActiveTab(settings) {
  const activeTab = await getActiveTabOrThrow();
  try {
    return await sendReportRequest(activeTab.id, settings);
  } catch (error) {
    if (!isNoReceiverError(error)) {
      throw error;
    }
    try {
      await ensureContentScriptLoaded(activeTab.id);
      return await sendReportRequest(activeTab.id, settings);
    } catch (injectError) {
      throw new Error(
        'Could not connect to this tab. Reload the tab once and try again.',
        { cause: injectError }
      );
    }
  }
}

async function fetchContextFromActiveTab() {
  const activeTab = await getActiveTabOrThrow();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await sendContextRequest(activeTab.id);
      if (isValidContextResponse(response)) {
        return response;
      }
      await ensureContentScriptLoaded(activeTab.id);
      continue;
    } catch (error) {
      if (!isNoReceiverError(error)) {
        throw error;
      }
      try {
        await ensureContentScriptLoaded(activeTab.id);
      } catch (injectError) {
        throw new Error(
          'Could not connect to this tab. Reload the tab once and try again.',
          { cause: injectError }
        );
      }
    }
  }

  throw new Error(
    'Could not extract page context from this tab. Reload the page once and try again.'
  );
}

async function refreshPreview(options = {}) {
  const settings = readSettingsFromUi();
  const currentRefreshId = ++refreshCounter;
  const silent = Boolean(options.silent);

  if (!silent) {
    setStatus('Refreshing preview...');
  }
  setBusy(true);
  updateFormatBadge(settings);

  try {
    const response = await fetchReportFromActiveTab(settings);
    if (currentRefreshId !== refreshCounter) {
      return;
    }
    lastReport = response;
    lastSettingsHash = settingsHash(settings);
    renderStats(response);
    renderPreview(response.text);
    setStatus(
      `Preview ready: ${response.count} selected (${response.uniqueCount} unique, ~${response.estimatedTokens} tokens).`,
      'success'
    );
  } catch (error) {
    if (currentRefreshId !== refreshCounter) {
      return;
    }
    const message =
      error && error.message
        ? error.message
        : 'Preview failed. Open a normal webpage tab and refresh.';
    setStatus(message, 'error');
    renderStats({
      totalCaptured: 0,
      count: 0,
      uniqueCount: 0,
      estimatedTokens: 0,
    });
    renderPreview(`Preview unavailable.\nReason: ${message}`);
    lastReport = null;
  } finally {
    if (currentRefreshId === refreshCounter) {
      setBusy(false);
    }
  }
}

function scheduleRefreshPreview() {
  clearTimeout(inputDebounceTimer);
  inputDebounceTimer = setTimeout(() => {
    refreshPreview({ silent: true });
  }, 260);
}

async function copyPreview() {
  const settings = readSettingsFromUi();
  const changed = settingsHash(settings) !== lastSettingsHash;
  if (!lastReport || changed) {
    await refreshPreview({ silent: true });
  }
  if (!lastReport || typeof lastReport.text !== 'string') {
    setStatus('Nothing to copy yet.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(lastReport.text);
    setStatus(
      `Copied ${lastReport.count} selected entries (~${lastReport.estimatedTokens} tokens).`,
      'success'
    );
  } catch (e) {
    setStatus(`Clipboard write failed: ${e.message}`, 'error');
  }
}

async function generatePageContext() {
  extractContextButton.disabled = true;
  setContextStatus('Extracting full-page context...');

  try {
    const response = await fetchContextFromActiveTab();
    contextTextEl.textContent = response.text;
    lastGeneratedContext = response.text;
    lastGeneratedContextPageUrl =
      typeof response.pageUrl === 'string' ? response.pageUrl : '';
    contextAiTextEl.textContent = 'AI condensed context will appear here after generation.';
    lastCondensedContext = '';
    const estimatedTokens = Number(response.estimatedTokens) || 0;
    const sourceTextChars = Number(response.sourceTextChars) || 0;
    const elementsScanned = Number(response.elementsScanned) || 0;
    const relevantCount = Number(response.relevantCount) || 0;
    setContextStatus(
      `Context ready (~${estimatedTokens} tokens, scanned ${sourceTextChars} chars, ${elementsScanned} elements, ${relevantCount} relevant lines).`,
      'success'
    );
    return response.text;
  } catch (error) {
    setContextStatus(`Context extraction failed: ${error.message}`, 'error');
    return null;
  } finally {
    extractContextButton.disabled = false;
  }
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

function trimToMaxChars(text, maxChars) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxChars) return text;
  const hidden = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n... [truncated ${hidden} chars before sending to AI]`;
}

function redactSensitiveText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/(password|token|secret)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]');
}

async function condenseContextViaDirectProvider({
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

  const { endpoint, headers, body } = buildFetchOptions({
    provider,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    baseUrl,
    maxTokens: 700,
  });

  const providerLabel = AI_PROVIDERS[provider]?.label || provider;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    let reason = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(raw);
      reason = parsed.error?.message || parsed.message || reason;
    } catch {
      if (raw) reason = raw.slice(0, 300);
    }
    throw new Error(`${providerLabel} request failed: ${reason}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${providerLabel} returned non-JSON response.`, { cause: error });
  }

  const { summary, usage, model: respModel } = parseAiResponse(provider, parsed);
  if (!summary || typeof summary !== 'string') {
    throw new Error(`${providerLabel} response missing summary.`);
  }

  return {
    summary,
    usage: usage || null,
    model: respModel || model,
  };
}

async function condensePageContextWithAi() {
  const placeholder = 'AI context will appear here after generation.';
  let contextPayload = lastGeneratedContext.trim();
  const currentRawContext = (contextTextEl.textContent || '').trim();
  if (!contextPayload && currentRawContext && currentRawContext !== placeholder) {
    contextPayload = currentRawContext;
    lastGeneratedContext = currentRawContext;
  }

  if (!contextPayload) {
    setContextStatus('No context yet. Generating now...');
    const generated = await generatePageContext();
    if (!generated) return;
    contextPayload = generated.trim();
  }

  const config = await getProviderLocalConfig(currentProvider);
  if (AI_PROVIDERS[currentProvider]?.authType !== 'none' && !config.apiKey) {
    setApiKeyState(false);
    setContextStatus('Save API key in Settings tab first.', 'error');
    return;
  }

  condenseContextButton.disabled = true;
  setContextStatus('Condensing context with AI...');

  try {
    const result = await condenseContextViaDirectProvider({
      provider: currentProvider,
      apiKey: config.apiKey,
      model: getSelectedModel(config.model),
      baseUrl: config.baseUrl,
      contextText: contextPayload,
      pageUrl: lastGeneratedContextPageUrl || lastReport?.pageUrl || '',
    });
    contextAiTextEl.textContent = result.summary;
    lastCondensedContext = result.summary;
    const tokenInfo =
      result.usage && result.usage.total_tokens
        ? ` tokens: ${result.usage.total_tokens}`
        : '';
    setContextStatus(
      `AI context condensed (${result.model}${tokenInfo}).`,
      'success'
    );
  } catch (error) {
    setContextStatus(`AI context condense failed: ${error.message}`, 'error');
  } finally {
    condenseContextButton.disabled = false;
  }
}

async function copyPageContext() {
  const placeholder = 'AI context will appear here after generation.';
  const aiPlaceholder = 'AI condensed context will appear here after generation.';
  const current = (contextTextEl.textContent || '').trim();
  const currentAi = (contextAiTextEl.textContent || '').trim();
  let payload = lastCondensedContext.trim() || lastGeneratedContext.trim();

  if (!payload && currentAi && currentAi !== aiPlaceholder) {
    payload = currentAi;
    lastCondensedContext = currentAi;
  }

  if (!payload && current && current !== placeholder) {
    payload = current;
    lastGeneratedContext = current;
  }

  if (!payload) {
    setContextStatus('No context yet. Generating now...');
    const generated = await generatePageContext();
    if (!generated) return;
    payload = generated.trim();
  }

  try {
    await navigator.clipboard.writeText(payload);
    if (lastCondensedContext && payload === lastCondensedContext) {
      setContextStatus('AI-condensed context copied to clipboard.', 'success');
    } else {
      setContextStatus('Context copied to clipboard.', 'success');
    }
  } catch (error) {
    setContextStatus(`Copy failed: ${error.message}`, 'error');
  }
}

// === SEO Panel Logic ===

const seoStatusEl = document.getElementById('seoStatus');
const scanSeoButton = document.getElementById('scanSeoButton');
const copySeoButton = document.getElementById('copySeoButton');
const seoResultsEl = document.getElementById('seoResults');

let lastSeoReport = null;

function setSeoStatus(message, type = '') {
  seoStatusEl.textContent = message;
  seoStatusEl.classList.remove('success', 'error');
  if (type) seoStatusEl.classList.add(type);
}

async function sendSeoRequest(tabId) {
  return withTimeout(
    chrome.tabs.sendMessage(tabId, { type: 'GET_SEO_META' }),
    8000
  );
}

function createSeoItem(label, value, status, charInfo) {
  const row = document.createElement('div');
  row.className = 'seoItem';

  const dot = document.createElement('span');
  dot.className = `seoIndicator ${status || 'info'}`;
  row.appendChild(dot);

  const labelEl = document.createElement('span');
  labelEl.className = 'seoLabel';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'seoValue';
  valueEl.textContent = value || '(not set)';
  row.appendChild(valueEl);

  if (charInfo) {
    const countEl = document.createElement('span');
    countEl.className = 'seoCharCount';
    countEl.textContent = charInfo;
    row.appendChild(countEl);
  }

  return row;
}

function createSeoSection(title) {
  const section = document.createElement('div');
  section.className = 'seoSection';
  const h = document.createElement('h3');
  h.textContent = title;
  section.appendChild(h);
  return section;
}

function renderSeoResults(data) {
  seoResultsEl.innerHTML = '';

  const basic = createSeoSection('Basic SEO');
  basic.appendChild(createSeoItem('Title', data.title.value, data.title.status, `${data.title.length} chars`));
  basic.appendChild(createSeoItem('Description', data.metaDescription.value, data.metaDescription.status, `${data.metaDescription.length} chars`));
  basic.appendChild(createSeoItem('Canonical', data.canonical, data.canonical ? 'pass' : 'warn'));
  basic.appendChild(createSeoItem('Robots', data.robots, 'info'));
  basic.appendChild(createSeoItem('Viewport', data.viewport, data.viewport ? 'pass' : 'warn'));
  seoResultsEl.appendChild(basic);

  const ogSection = createSeoSection('Open Graph');
  const ogFields = ['title', 'description', 'image', 'url', 'type', 'siteName'];
  ogFields.forEach((field) => {
    ogSection.appendChild(createSeoItem(`og:${field}`, data.og[field], data.og[field] ? 'pass' : 'warn'));
  });
  seoResultsEl.appendChild(ogSection);

  const twSection = createSeoSection('Twitter Card');
  const twFields = ['card', 'title', 'description', 'image', 'creator', 'site'];
  twFields.forEach((field) => {
    twSection.appendChild(createSeoItem(`twitter:${field}`, data.twitter[field], data.twitter[field] ? 'pass' : 'info'));
  });
  seoResultsEl.appendChild(twSection);

  const headSection = createSeoSection('Headings');
  headSection.appendChild(createSeoItem('H1 count', String(data.headings.h1Count), data.headings.status));
  if (data.headings.issues.length > 0) {
    data.headings.issues.forEach((issue) => {
      headSection.appendChild(createSeoItem('Issue', issue, 'warn'));
    });
  }
  data.headings.hierarchy.slice(0, 10).forEach((h) => {
    headSection.appendChild(createSeoItem(`H${h.level}`, h.text, 'info'));
  });
  seoResultsEl.appendChild(headSection);

  const imgSection = createSeoSection('Images');
  imgSection.appendChild(createSeoItem('Total images', String(data.images.total), 'info'));
  imgSection.appendChild(createSeoItem('With alt text', String(data.images.withAlt), data.images.status));
  imgSection.appendChild(createSeoItem('Missing alt', String(data.images.withoutAlt), data.images.withoutAlt > 0 ? 'warn' : 'pass'));
  imgSection.appendChild(createSeoItem('Coverage', `${data.images.coverage}%`, data.images.status));
  seoResultsEl.appendChild(imgSection);

  if (data.hreflang.length > 0) {
    const hlSection = createSeoSection('Hreflang');
    data.hreflang.forEach((hl) => {
      hlSection.appendChild(createSeoItem(hl.lang, hl.href, 'info'));
    });
    seoResultsEl.appendChild(hlSection);
  }
}

function buildSeoTextReport(data) {
  const lines = ['=== SEO & Meta Report ===', ''];
  lines.push(`Title: ${data.title.value} (${data.title.length} chars) [${data.title.status}]`);
  lines.push(`Description: ${data.metaDescription.value} (${data.metaDescription.length} chars) [${data.metaDescription.status}]`);
  lines.push(`Canonical: ${data.canonical || '(not set)'}`);
  lines.push(`Robots: ${data.robots || '(not set)'}`);
  lines.push(`Viewport: ${data.viewport || '(not set)'}`);
  lines.push('');
  lines.push('--- Open Graph ---');
  for (const [k, v] of Object.entries(data.og)) {
    lines.push(`og:${k}: ${v || '(not set)'}`);
  }
  lines.push('');
  lines.push('--- Twitter Card ---');
  for (const [k, v] of Object.entries(data.twitter)) {
    lines.push(`twitter:${k}: ${v || '(not set)'}`);
  }
  lines.push('');
  lines.push('--- Headings ---');
  lines.push(`H1 count: ${data.headings.h1Count}`);
  data.headings.issues.forEach((issue) => lines.push(`  Issue: ${issue}`));
  data.headings.hierarchy.slice(0, 15).forEach((h) => {
    lines.push(`  H${h.level}: ${h.text}`);
  });
  lines.push('');
  lines.push('--- Images ---');
  lines.push(`Total: ${data.images.total}, With alt: ${data.images.withAlt}, Missing: ${data.images.withoutAlt}, Coverage: ${data.images.coverage}%`);
  if (data.hreflang.length > 0) {
    lines.push('');
    lines.push('--- Hreflang ---');
    data.hreflang.forEach((hl) => lines.push(`${hl.lang}: ${hl.href}`));
  }
  return lines.join('\n');
}

async function scanSeoMeta() {
  scanSeoButton.disabled = true;
  setSeoStatus('Scanning page...');
  try {
    const activeTab = await getActiveTabOrThrow();
    let response;
    try {
      response = await sendSeoRequest(activeTab.id);
    } catch (error) {
      if (!isNoReceiverError(error)) throw error;
      await ensureContentScriptLoaded(activeTab.id);
      response = await sendSeoRequest(activeTab.id);
    }
    if (!response || !response.ok) {
      throw new Error('SEO scan failed. Reload the page and try again.');
    }
    lastSeoReport = response.data;
    renderSeoResults(response.data);
    setSeoStatus('SEO scan complete.', 'success');
  } catch (error) {
    setSeoStatus(`Scan failed: ${error.message}`, 'error');
  } finally {
    scanSeoButton.disabled = false;
  }
}

async function copySeoReport() {
  if (!lastSeoReport) {
    setSeoStatus('No scan yet. Scanning now...');
    await scanSeoMeta();
    if (!lastSeoReport) return;
  }
  try {
    await navigator.clipboard.writeText(buildSeoTextReport(lastSeoReport));
    setSeoStatus('SEO report copied to clipboard.', 'success');
  } catch (error) {
    setSeoStatus(`Copy failed: ${error.message}`, 'error');
  }
}

// === Schema Panel Logic ===

const schemaStatusEl = document.getElementById('schemaStatus');
const scanSchemaButton = document.getElementById('scanSchemaButton');
const testRichResultsButton = document.getElementById('testRichResultsButton');
const copySchemaButton = document.getElementById('copySchemaButton');
const schemaResultsEl = document.getElementById('schemaResults');
const schemaStatsEl = document.getElementById('schemaStats');

let lastSchemaReport = null;

function setSchemaStatus(message, type = '') {
  schemaStatusEl.textContent = message;
  schemaStatusEl.classList.remove('success', 'error');
  if (type) schemaStatusEl.classList.add(type);
}

async function sendSchemaRequest(tabId) {
  return withTimeout(
    chrome.tabs.sendMessage(tabId, { type: 'GET_STRUCTURED_DATA' }),
    8000
  );
}

function renderSchemaResults(data) {
  schemaResultsEl.innerHTML = '';
  schemaStatsEl.style.display = '';

  document.getElementById('schemaStatTypes').textContent = String(data.stats.typesFound);
  document.getElementById('schemaStatJsonLd').textContent = String(data.stats.jsonLdCount);
  document.getElementById('schemaStatMicrodata').textContent = String(data.stats.microdataCount);
  document.getElementById('schemaStatWarnings').textContent = String(data.stats.validationWarnings);

  if (data.jsonLd.length === 0 && data.microdata.length === 0 && data.rdfa.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'No structured data found on this page.';
    schemaResultsEl.appendChild(hint);
    return;
  }

  data.jsonLd.forEach((item) => {
    const card = createSchemaCard(`JSON-LD: ${item.type}`, item.raw, item.errors, item.warnings);
    schemaResultsEl.appendChild(card);
  });

  data.microdata.forEach((item) => {
    const card = createSchemaCard(`Microdata: ${item.type}`, item.properties, [], []);
    schemaResultsEl.appendChild(card);
  });

  data.rdfa.forEach((item) => {
    const card = createSchemaCard(`RDFa: ${item.type || item.about}`, item.properties, [], []);
    schemaResultsEl.appendChild(card);
  });
}

function createSchemaCard(title, data, errors, warnings) {
  const card = document.createElement('div');
  card.className = 'schemaItem';

  const head = document.createElement('div');
  head.className = 'schemaItemHead';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  head.appendChild(titleSpan);

  const badges = document.createElement('span');
  badges.className = 'schemaBadges';
  if (errors && errors.length > 0) {
    const errBadge = document.createElement('span');
    errBadge.className = 'schemaBadge errors';
    errBadge.textContent = `${errors.length} err`;
    badges.appendChild(errBadge);
  }
  if (warnings && warnings.length > 0) {
    const warnBadge = document.createElement('span');
    warnBadge.className = 'schemaBadge warnings';
    warnBadge.textContent = `${warnings.length} warn`;
    badges.appendChild(warnBadge);
  }
  head.appendChild(badges);

  const body = document.createElement('div');
  body.className = 'schemaItemBody';
  body.textContent = data ? JSON.stringify(data, null, 2) : '(parse error)';

  const valDiv = document.createElement('div');
  valDiv.className = 'schemaValidation';
  if (errors) {
    errors.forEach((err) => {
      const p = document.createElement('p');
      p.className = 'schemaError';
      p.textContent = err;
      valDiv.appendChild(p);
    });
  }
  if (warnings) {
    warnings.forEach((warn) => {
      const p = document.createElement('p');
      p.className = 'schemaWarning';
      p.textContent = warn;
      valDiv.appendChild(p);
    });
  }

  head.addEventListener('click', () => {
    body.classList.toggle('is-open');
  });

  card.appendChild(head);
  if (valDiv.children.length > 0) card.appendChild(valDiv);
  card.appendChild(body);
  return card;
}

async function scanStructuredData() {
  scanSchemaButton.disabled = true;
  setSchemaStatus('Scanning page...');
  try {
    const activeTab = await getActiveTabOrThrow();
    let response;
    try {
      response = await sendSchemaRequest(activeTab.id);
    } catch (error) {
      if (!isNoReceiverError(error)) throw error;
      await ensureContentScriptLoaded(activeTab.id);
      response = await sendSchemaRequest(activeTab.id);
    }
    if (!response || !response.ok) {
      throw new Error('Schema scan failed. Reload the page and try again.');
    }
    lastSchemaReport = response.data;
    renderSchemaResults(response.data);
    setSchemaStatus(
      `Found ${response.data.stats.typesFound} type(s), ${response.data.stats.validationWarnings} issue(s).`,
      'success'
    );
  } catch (error) {
    setSchemaStatus(`Scan failed: ${error.message}`, 'error');
  } finally {
    scanSchemaButton.disabled = false;
  }
}

async function openRichResultsTest() {
  try {
    const activeTab = await getActiveTabOrThrow();
    const testUrl = `https://search.google.com/test/rich-results?url=${encodeURIComponent(activeTab.url)}`;
    chrome.tabs.create({ url: testUrl });
  } catch (error) {
    setSchemaStatus(`Could not open test: ${error.message}`, 'error');
  }
}

async function copySchemaData() {
  if (!lastSchemaReport) {
    setSchemaStatus('No scan yet. Scanning now...');
    await scanStructuredData();
    if (!lastSchemaReport) return;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastSchemaReport, null, 2));
    setSchemaStatus('Structured data copied to clipboard.', 'success');
  } catch (error) {
    setSchemaStatus(`Copy failed: ${error.message}`, 'error');
  }
}

// === Sitemap Panel Logic ===

const sitemapStatusEl = document.getElementById('sitemapStatus');
const fetchSitemapButton = document.getElementById('fetchSitemapButton');
const copySitemapUrlsButton = document.getElementById('copySitemapUrlsButton');
const downloadSitemapTextButton = document.getElementById('downloadSitemapTextButton');
const downloadSitemapJsonButton = document.getElementById('downloadSitemapJsonButton');
const sitemapUrlInputEl = document.getElementById('sitemapUrlInput');
const sitemapSearchInputEl = document.getElementById('sitemapSearchInput');
const sitemapPatternInputEl = document.getElementById('sitemapPatternInput');
const sitemapFiltersEl = document.getElementById('sitemapFilters');
const sitemapStatsEl = document.getElementById('sitemapStats');
const sitemapResultsEl = document.getElementById('sitemapResults');

let sitemapAllUrls = [];
let sitemapDiscoveredSitemaps = [];
let sitemapFailedSitemaps = [];
let sitemapRootUrl = '';
let sitemapUrlsBySource = new Map();
let sitemapRenderOffset = 0;
const SITEMAP_PAGE_SIZE = 200;
const SITEMAP_MAX_FILES = 250;
const SITEMAP_MAX_URLS = 200000;

function setSitemapStatus(message, type = '') {
  sitemapStatusEl.textContent = message;
  sitemapStatusEl.classList.remove('success', 'error');
  if (type) sitemapStatusEl.classList.add(type);
}

function getDirectChildText(parent, localName) {
  const node = Array.from(parent.childNodes).find(
    (child) => child.nodeType === 1 && child.localName === localName
  );
  return node?.textContent?.trim() || '';
}

function getElementsByLocalName(doc, localName) {
  return Array.from(doc.getElementsByTagNameNS('*', localName));
}

function normalizeSitemapUrl(rawUrl, fallbackBase) {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, fallbackBase).toString();
  } catch {
    return trimmed;
  }
}

function parseSitemapXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror') || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse sitemap XML.');
  }

  const sitemapNodes = getElementsByLocalName(doc, 'sitemap');
  const sitemapLocs = sitemapNodes
    .map((node) => getDirectChildText(node, 'loc'))
    .filter(Boolean);

  if (sitemapLocs.length > 0) {
    return { type: 'index', sitemaps: Array.from(new Set(sitemapLocs)) };
  }

  const urlEntries = getElementsByLocalName(doc, 'url');
  if (urlEntries.length === 0) {
    throw new Error('No <url> or <sitemap> entries found in XML.');
  }

  return {
    type: 'urlset',
    urls: urlEntries
      .map((urlEl) => ({
        loc: getDirectChildText(urlEl, 'loc'),
        lastmod: getDirectChildText(urlEl, 'lastmod'),
        changefreq: getDirectChildText(urlEl, 'changefreq'),
        priority: getDirectChildText(urlEl, 'priority'),
      }))
      .filter((entry) => Boolean(entry.loc)),
  };
}

async function crawlSitemapTree(rootUrl) {
  const queue = [rootUrl];
  const visited = new Set();
  const discovered = [];
  const failures = [];
  const urls = [];
  const urlsBySource = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;

    if (visited.size >= SITEMAP_MAX_FILES) {
      failures.push({ url: current, error: `Stopped: reached sitemap file limit (${SITEMAP_MAX_FILES}).` });
      break;
    }

    visited.add(current);
    discovered.push(current);
    setSitemapStatus(`Loading sitemap ${discovered.length} (${queue.length} pending): ${current}`);

    try {
      const resp = await fetchSitemapFromBackground(current);
      if (!resp || !resp.ok || !resp.xml) {
        throw new Error('Could not fetch sitemap XML.');
      }

      const parsed = parseSitemapXml(resp.xml);

      if (parsed.type === 'index') {
        parsed.sitemaps.forEach((childUrl) => {
          const normalized = normalizeSitemapUrl(childUrl, current);
          if (normalized && !visited.has(normalized)) {
            queue.push(normalized);
          }
        });
        urlsBySource.set(current, urlsBySource.get(current) || 0);
      } else {
        let added = 0;
        parsed.urls.forEach((entry) => {
          if (urls.length >= SITEMAP_MAX_URLS) return;
          urls.push({ ...entry, sourceSitemap: current });
          added += 1;
        });
        urlsBySource.set(current, added);
      }
    } catch (error) {
      failures.push({ url: current, error: error?.message || 'Unknown sitemap parsing error.' });
    }

    if (urls.length >= SITEMAP_MAX_URLS) {
      failures.push({ url: '[limit]', error: `Stopped: reached URL limit (${SITEMAP_MAX_URLS}).` });
      break;
    }
  }

  return { urls, discovered, failures, urlsBySource };
}

function getFilteredSitemapUrls() {
  const searchTerm = (sitemapSearchInputEl?.value || '').toLowerCase().trim();
  const pattern = (sitemapPatternInputEl?.value || '').trim();
  let pathRegex = null;

  if (pattern) {
    const escapedPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')
      .replace(/\\\?/g, '.');
    pathRegex = new RegExp(`^${escapedPattern}$`);
  }

  return sitemapAllUrls.filter((entry) => {
    if (searchTerm && !entry.loc.toLowerCase().includes(searchTerm)) return false;
    if (pathRegex) {
      try {
        const path = new URL(entry.loc).pathname;
        if (!pathRegex.test(path)) return false;
      } catch { return false; }
    }
    return true;
  });
}

function renderSitemapUrls(filtered) {
  sitemapResultsEl.innerHTML = '';
  const toShow = filtered.slice(0, sitemapRenderOffset + SITEMAP_PAGE_SIZE);
  sitemapRenderOffset = toShow.length;

  toShow.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'sitemapUrlItem';
    row.textContent = entry.loc;
    if (entry.lastmod || entry.priority) {
      const meta = document.createElement('div');
      meta.className = 'sitemapMeta';
      const parts = [];
      if (entry.lastmod) parts.push(entry.lastmod);
      if (entry.changefreq) parts.push(entry.changefreq);
      if (entry.priority) parts.push(`p:${entry.priority}`);
      meta.textContent = parts.join(' \u2022 ');
      row.appendChild(meta);
    }
    sitemapResultsEl.appendChild(row);
  });

  if (toShow.length < filtered.length) {
    const more = document.createElement('div');
    more.className = 'sitemapLoadMore';
    const btn = document.createElement('button');
    btn.className = 'miniBtn';
    btn.type = 'button';
    btn.textContent = `Show more (${filtered.length - toShow.length} remaining)`;
    btn.addEventListener('click', () => { renderSitemapUrls(filtered); });
    more.appendChild(btn);
    sitemapResultsEl.appendChild(more);
  }
}

function updateSitemapStats(filtered) {
  sitemapStatsEl.style.display = '';
  document.getElementById('sitemapStatTotal').textContent = String(sitemapAllUrls.length);
  document.getElementById('sitemapStatFiltered').textContent = String(filtered.length);

  const domains = new Set();
  sitemapAllUrls.forEach((entry) => {
    try { domains.add(new URL(entry.loc).hostname); } catch { /* ignore */ }
  });
  document.getElementById('sitemapStatDomains').textContent = String(domains.size);

  const dates = sitemapAllUrls.map((e) => e.lastmod).filter(Boolean).sort();
  if (dates.length > 0) {
    const first = dates[0].slice(0, 10);
    const last = dates[dates.length - 1].slice(0, 10);
    document.getElementById('sitemapStatDates').textContent = first === last ? first : `${first} \u2192 ${last}`;
  } else {
    document.getElementById('sitemapStatDates').textContent = '-';
  }
}

function refreshSitemapDisplay() {
  sitemapRenderOffset = 0;
  const filtered = getFilteredSitemapUrls();
  updateSitemapStats(filtered);
  renderSitemapUrls(filtered);
}

async function fetchSitemapFromBackground(url) {
  return sendBackgroundMessage({ type: 'FETCH_SITEMAP', url });
}

async function fetchSitemap() {
  fetchSitemapButton.disabled = true;
  if (downloadSitemapTextButton) downloadSitemapTextButton.disabled = true;
  if (downloadSitemapJsonButton) downloadSitemapJsonButton.disabled = true;
  setSitemapStatus('Fetching sitemap...');

  try {
    let sitemapUrl = sitemapUrlInputEl.value.trim();

    if (!sitemapUrl) {
      const activeTab = await getActiveTabOrThrow();
      const origin = new URL(activeTab.url).origin;

      try {
        const resp = await fetchSitemapFromBackground(`${origin}/sitemap.xml`);
        if (resp && resp.ok && resp.xml) {
          sitemapUrl = `${origin}/sitemap.xml`;
          sitemapUrlInputEl.value = sitemapUrl;
        }
      } catch { /* fallback */ }

      if (!sitemapUrl) {
        try {
          const resp = await fetchSitemapFromBackground(`${origin}/robots.txt`);
          if (resp && resp.ok && resp.xml) {
            const match = resp.xml.match(/^Sitemap:\s*(.+)$/im);
            if (match) {
              sitemapUrl = match[1].trim();
              sitemapUrlInputEl.value = sitemapUrl;
            }
          }
        } catch { /* no robots.txt */ }
      }

      if (!sitemapUrl) {
        throw new Error('No sitemap found. Enter a URL manually.');
      }
    }

    sitemapRootUrl = normalizeSitemapUrl(sitemapUrl);
    sitemapUrlInputEl.value = sitemapRootUrl;

    const crawl = await crawlSitemapTree(sitemapRootUrl);
    sitemapAllUrls = crawl.urls;
    sitemapDiscoveredSitemaps = crawl.discovered;
    sitemapFailedSitemaps = crawl.failures;
    sitemapUrlsBySource = crawl.urlsBySource;

    sitemapFiltersEl.style.display = '';
    refreshSitemapDisplay();
    const failureNote = sitemapFailedSitemaps.length
      ? ` (${sitemapFailedSitemaps.length} sitemap fetch/parsing failures)`
      : '';
    setSitemapStatus(
      `Loaded ${sitemapAllUrls.length} URLs from ${sitemapDiscoveredSitemaps.length} sitemap files${failureNote}.`,
      'success'
    );
  } catch (error) {
    setSitemapStatus(`Fetch failed: ${error.message}`, 'error');
  } finally {
    fetchSitemapButton.disabled = false;
    if (downloadSitemapTextButton) downloadSitemapTextButton.disabled = false;
    if (downloadSitemapJsonButton) downloadSitemapJsonButton.disabled = false;
  }
}

async function copySitemapUrls() {
  if (sitemapAllUrls.length === 0) {
    setSitemapStatus('No URLs loaded yet.', 'error');
    return;
  }
  const filtered = getFilteredSitemapUrls();
  try {
    await navigator.clipboard.writeText(filtered.map((e) => e.loc).join('\n'));
    setSitemapStatus(`Copied ${filtered.length} URLs to clipboard.`, 'success');
  } catch (error) {
    setSitemapStatus(`Copy failed: ${error.message}`, 'error');
  }
}

function sanitizeForTsv(value) {
  if (!value) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

function buildSitemapTextExport() {
  const filtered = getFilteredSitemapUrls();
  const domainHint = (() => { try { return new URL(sitemapRootUrl).hostname; } catch { return 'unknown-domain'; } })();

  const lines = [
    'SITEMAP EXPORT',
    `Generated: ${new Date().toISOString()}`,
    `Root sitemap: ${sitemapRootUrl || '-'}`,
    `Domain: ${domainHint}`,
    `Discovered sitemap files: ${sitemapDiscoveredSitemaps.length}`,
    `Total URLs extracted: ${sitemapAllUrls.length}`,
    `Filtered URLs (current view): ${filtered.length}`,
    '',
    '=== DISCOVERED SITEMAPS ===',
  ];

  if (sitemapDiscoveredSitemaps.length === 0) {
    lines.push('(none)');
  } else {
    sitemapDiscoveredSitemaps.forEach((url, index) => {
      const count = sitemapUrlsBySource.get(url) || 0;
      lines.push(`${index + 1}. ${url} [urls=${count}]`);
    });
  }

  lines.push('');
  lines.push('=== SITEMAP FAILURES ===');
  if (sitemapFailedSitemaps.length === 0) {
    lines.push('(none)');
  } else {
    sitemapFailedSitemaps.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.url} :: ${item.error}`);
    });
  }

  lines.push('');
  lines.push('=== URL ENTRIES (ALL) ===');
  lines.push('loc\tlastmod\tchangefreq\tpriority\tsource_sitemap');
  sitemapAllUrls.forEach((entry) => {
    lines.push([sanitizeForTsv(entry.loc), sanitizeForTsv(entry.lastmod), sanitizeForTsv(entry.changefreq), sanitizeForTsv(entry.priority), sanitizeForTsv(entry.sourceSitemap)].join('\t'));
  });

  if (filtered.length !== sitemapAllUrls.length) {
    lines.push('');
    lines.push('=== URL ENTRIES (FILTERED CURRENT VIEW) ===');
    lines.push('loc\tlastmod\tchangefreq\tpriority\tsource_sitemap');
    filtered.forEach((entry) => {
      lines.push([sanitizeForTsv(entry.loc), sanitizeForTsv(entry.lastmod), sanitizeForTsv(entry.changefreq), sanitizeForTsv(entry.priority), sanitizeForTsv(entry.sourceSitemap)].join('\t'));
    });
  }

  return lines.join('\n');
}

function makeSafeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createSitemapExportFileName(extension = 'txt') {
  const host = (() => { try { return new URL(sitemapRootUrl).hostname.replace(/[^a-zA-Z0-9.-]+/g, '-'); } catch { return 'sitemap'; } })();
  return `sitemap-export-${host}-${makeSafeTimestamp()}.${extension}`;
}

async function downloadSitemapText() {
  if (sitemapAllUrls.length === 0 && sitemapDiscoveredSitemaps.length === 0) {
    setSitemapStatus('No sitemap data loaded yet.', 'error');
    return;
  }
  try {
    const text = buildSitemapTextExport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = createSitemapExportFileName('txt');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setSitemapStatus('Full sitemap text exported.', 'success');
  } catch (error) {
    setSitemapStatus(`Download failed: ${error.message}`, 'error');
  }
}

function buildSitemapJsonExport() {
  const filtered = getFilteredSitemapUrls();
  const discovered = sitemapDiscoveredSitemaps.map((url) => ({ url, urlCount: sitemapUrlsBySource.get(url) || 0 }));
  return {
    generatedAt: new Date().toISOString(),
    rootSitemap: sitemapRootUrl || '',
    activeFilters: { search: (sitemapSearchInputEl?.value || '').trim(), pattern: (sitemapPatternInputEl?.value || '').trim() },
    totals: { discoveredSitemaps: sitemapDiscoveredSitemaps.length, failures: sitemapFailedSitemaps.length, allUrls: sitemapAllUrls.length, filteredUrls: filtered.length },
    discoveredSitemaps: discovered,
    failedSitemaps: sitemapFailedSitemaps,
    urls: sitemapAllUrls,
    filteredUrls: filtered,
  };
}

async function downloadSitemapJson() {
  if (sitemapAllUrls.length === 0 && sitemapDiscoveredSitemaps.length === 0) {
    setSitemapStatus('No sitemap data loaded yet.', 'error');
    return;
  }
  try {
    const payload = buildSitemapJsonExport();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = createSitemapExportFileName('json');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setSitemapStatus('Sitemap JSON exported.', 'success');
  } catch (error) {
    setSitemapStatus(`Download failed: ${error.message}`, 'error');
  }
}

// === AI Brief Logic ===

function getSummaryInstruction(style) {
  if (style === 'steps') return 'Focus more on actionable step-by-step fix instructions.';
  if (style === 'rootcause') return 'Focus more on likely root causes and confidence ranking.';
  return 'Keep output concise with balanced causes and fixes.';
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
    '- Up to 4 bullets (critical first).',
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
    styleInstruction || '',
    '',
    'Context:',
    JSON.stringify(context, null, 2),
    '',
    'Logs:',
    logsText,
  ].join('\n');
}

async function summarizeViaDirectProvider({ provider, apiKey, model, baseUrl, report, settings }) {
  const logsText = trimToMaxChars(redactSensitiveText(report.text), 14000);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    logsText,
    styleInstruction: getSummaryInstruction(settings.summaryStyle),
    context: {
      pageUrl: report.pageUrl || '',
      levelPreset: settings.levelPreset,
      format: settings.format,
      selectedCount: Number(report.count) || 0,
      uniqueCount: Number(report.uniqueCount) || 0,
    },
  });

  const { endpoint, headers, body } = buildFetchOptions({
    provider, apiKey, model, systemPrompt, userPrompt, baseUrl,
  });

  const providerLabel = AI_PROVIDERS[provider]?.label || provider;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await response.text();
  if (!response.ok) {
    let reason = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(raw);
      reason = parsed.error?.message || parsed.message || reason;
    } catch (error) {
      if (raw) reason = raw.slice(0, 300);
      throw new Error(`${providerLabel} request failed: ${reason}`, { cause: error });
    }
    throw new Error(`${providerLabel} request failed: ${reason}`);
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) {
    throw new Error(`${providerLabel} returned non-JSON response.`, { cause: error });
  }

  const { summary, usage, model: respModel } = parseAiResponse(provider, parsed);
  if (!summary || typeof summary !== 'string') {
    throw new Error(`${providerLabel} response missing summary.`);
  }

  return { summary, usage: usage || null, model: respModel || model };
}

async function sendBackgroundMessage(message) {
  return withTimeout(chrome.runtime.sendMessage(message), 20000);
}

function isBackgroundUnavailableError(error) {
  if (!error || typeof error.message !== 'string') return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('receiving end does not exist') ||
    msg.includes('could not establish connection') ||
    msg.includes('port closed')
  );
}

async function saveApiKey() {
  const input = apiKeyInput.value.trim();
  if (!input) {
    setSettingsStatus('Please paste an API key first.', 'error');
    return;
  }
  try {
    await saveProviderLocalConfig({ provider: currentProvider, apiKey: input });
    setApiKeyState(true);
    apiKeyInput.value = '';
    setSettingsStatus('API key saved locally.', 'success');
  } catch (error) {
    setSettingsStatus(`Save failed: ${error.message}`, 'error');
  }
}

async function clearApiKey() {
  try {
    await clearProviderLocalKey(currentProvider);
    setApiKeyState(false);
    setSettingsStatus('API key cleared.', 'success');
  } catch (error) {
    setSettingsStatus(`Clear failed: ${error.message}`, 'error');
  }
}

async function saveOllamaUrl() {
  const url = ollamaUrlInput.value.trim();
  try {
    await saveProviderLocalConfig({ provider: 'ollama', baseUrl: url || 'http://localhost:11434' });
    setSettingsStatus('Ollama URL saved.', 'success');
  } catch (error) {
    setSettingsStatus(`Save failed: ${error.message}`, 'error');
  }
}

async function generateAiBrief() {
  const settings = readSettingsFromUi();
  const changed = settingsHash(settings) !== lastSettingsHash;
  if (!lastReport || changed) {
    await refreshPreview({ silent: true });
  }
  if (!lastReport || !lastReport.text) {
    setAiStatus('No logs available. Refresh preview first.', 'error');
    return;
  }

  const config = await getProviderLocalConfig(currentProvider);
  if (AI_PROVIDERS[currentProvider]?.authType !== 'none' && !config.apiKey) {
    setApiKeyState(false);
    setAiStatus(`Save ${AI_PROVIDERS[currentProvider]?.label || 'API'} key first.`, 'error');
    return;
  }
  setApiKeyState(Boolean(config.apiKey));

  const selectedModel = getSelectedModel(config.model);
  summarizeButton.disabled = true;
  setAiStatus('Generating AI brief...');

  try {
    let result = null;
    try {
      const backgroundResp = await sendBackgroundMessage({
        type: 'AI_SUMMARIZE',
        provider: currentProvider,
        model: selectedModel,
        logsText: lastReport.text,
        pageUrl: lastReport.pageUrl,
        levelPreset: settings.levelPreset,
        format: settings.format,
        selectedCount: lastReport.count,
        uniqueCount: lastReport.uniqueCount,
        summaryStyle: settings.summaryStyle,
        styleInstruction: getSummaryInstruction(settings.summaryStyle),
      });

      if (backgroundResp && backgroundResp.ok) {
        result = { summary: backgroundResp.summary, usage: backgroundResp.usage, model: backgroundResp.model || selectedModel };
      } else if (backgroundResp && backgroundResp.error) {
        throw new Error(backgroundResp.error);
      }
    } catch (bgError) {
      if (!isBackgroundUnavailableError(bgError)) {
        // Use fallback
      }
      result = await summarizeViaDirectProvider({
        provider: currentProvider,
        apiKey: config.apiKey,
        model: selectedModel,
        baseUrl: config.baseUrl,
        report: lastReport,
        settings,
      });
    }

    if (!result) {
      result = await summarizeViaDirectProvider({
        provider: currentProvider,
        apiKey: config.apiKey,
        model: selectedModel,
        baseUrl: config.baseUrl,
        report: lastReport,
        settings,
      });
    }

    summaryTextEl.textContent = result.summary;
    lastGeneratedSummary = result.summary;
    const tokenInfo =
      result.usage && result.usage.total_tokens
        ? ` tokens: ${result.usage.total_tokens}`
        : '';
    setAiStatus(`AI brief generated (${result.model}${tokenInfo}).`, 'success');
    return result.summary;
  } catch (error) {
    setAiStatus(`AI generation failed: ${error.message}`, 'error');
    return null;
  } finally {
    summarizeButton.disabled = false;
  }
}

async function copySummary() {
  const placeholderText = 'AI brief will appear here after generation.';
  const currentText = (summaryTextEl.textContent || '').trim();
  let textToCopy = lastGeneratedSummary.trim();

  if (!textToCopy && currentText && currentText !== placeholderText) {
    textToCopy = currentText;
    lastGeneratedSummary = currentText;
  }

  if (!textToCopy) {
    setAiStatus('No brief yet. Generating now...');
    const generated = await generateAiBrief();
    if (!generated) return;
    textToCopy = generated.trim();
  }

  try {
    await navigator.clipboard.writeText(textToCopy);
    setAiStatus('AI brief copied to clipboard.', 'success');
  } catch (error) {
    setAiStatus(`Copy failed: ${error.message}`, 'error');
  }
}

async function syncSelectedModelToStorage() {
  try {
    await saveProviderLocalConfig({ provider: currentProvider, model: getSelectedModel() });
  } catch { /* Ignore model sync errors. */ }
}

// === Video Panel Logic ===

function formatVideoSize(bytes) {
  const parsed = Number(bytes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = parsed;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    value >= 100 || unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

function sanitizeFileStem(name) {
  if (typeof name !== 'string') {
    return 'video';
  }
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || 'video';
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

function inferVideoFormat(video) {
  if (video.playlist) {
    return /\.mpd(\?|$)/i.test(video.url) ? 'DASH' : 'HLS';
  }
  if (/\.webm(\?|$)/i.test(video.url)) {
    return 'WEBM';
  }
  if (/\.mov(\?|$)/i.test(video.url)) {
    return 'MOV';
  }
  return 'MP4';
}

function inferDownloadExtension(video) {
  if (video.playlist) {
    return /\.mpd(\?|$)/i.test(video.url) ? 'mpd' : 'm3u8';
  }
  const extFromUrl = extractExtFromUrl(video.url);
  if (extFromUrl) {
    return extFromUrl;
  }
  if (typeof video.contentType === 'string' && video.contentType.includes('webm')) {
    return 'webm';
  }
  return 'mp4';
}

function buildDownloadFilename(video) {
  const ext = inferDownloadExtension(video);
  const base = sanitizeFileStem(
    video.fileName || (() => {
      try {
        return new URL(video.url).pathname.split('/').pop() || 'video';
      } catch {
        return 'video';
      }
    })()
  );
  if (base.toLowerCase().endsWith(`.${ext}`)) {
    return base;
  }
  return `${base}.${ext}`;
}

function getVideoSizeLabel(video) {
  const calculated = formatVideoSize(video.sizeBytes);
  if (calculated) {
    return calculated;
  }
  if (typeof video.sizeText === 'string' && video.sizeText.trim()) {
    return video.sizeText.trim();
  }
  return video.playlist ? 'Stream playlist' : 'Size unknown';
}

function getVideoAvailabilityLabel(video) {
  if (video.requiresMux) {
    return 'Video-only stream';
  }
  if (video.hasAudio === false) {
    return 'No audio track';
  }
  return '';
}

function hasAudioCandidate(video) {
  return typeof video.audioUrl === 'string' && video.audioUrl.length > 0;
}

function canDownloadMp3(video) {
  return Boolean(video.mp3Available) && hasAudioCandidate(video);
}

function buildMp3Filename(video) {
  const base = sanitizeFileStem(
    video.fileName || (() => {
      try {
        return new URL(video.url).pathname.split('/').pop() || 'audio';
      } catch {
        return 'audio';
      }
    })()
  );
  return base.toLowerCase().endsWith('.mp3') ? base : `${base}.mp3`;
}

function applyMetadataToVideoItem(item, metadata) {
  if (!item || !metadata) {
    return;
  }
  const thumb = item.querySelector('.videoThumb');
  if (
    thumb &&
    metadata.thumbnailUrl &&
    typeof metadata.thumbnailUrl === 'string' &&
    !thumb.src
  ) {
    thumb.src = metadata.thumbnailUrl;
    thumb.classList.remove('is-hidden');
  }

  const sizeBadge = item.querySelector('.videoBadge.size');
  if (sizeBadge) {
    const text =
      metadata.sizeText ||
      formatVideoSize(metadata.sizeBytes) ||
      (metadata.playlist ? 'Stream playlist' : 'Size unknown');
    sizeBadge.textContent = text;
  }

  const audioBtn = item.querySelector('.videoAudioBtn');
  if (audioBtn && metadata.mp3Available) {
    audioBtn.disabled = false;
    audioBtn.title = '';
    audioBtn.classList.remove('muted');
  }
}

async function hydrateVideoMetadata(tabId, video, item) {
  if (!Number.isInteger(tabId) || !video?.url || !item) {
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_VIDEO_METADATA',
      tabId,
      url: video.url,
    });
    if (response?.ok && response.metadata) {
      applyMetadataToVideoItem(item, response.metadata);
    }
  } catch {
    // Metadata hydration is best-effort.
  }
}

async function triggerVideoScan(tabId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await withTimeout(
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_PAGE_VIDEOS' }),
        3000
      );
      return;
    } catch (error) {
      if (!isNoReceiverError(error)) {
        throw error;
      }
      await ensureContentScriptLoaded(tabId);
    }
  }
}

function renderVideoList(videos, tabId) {
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

    const thumb = document.createElement('img');
    thumb.className = 'videoThumb';
    thumb.alt = 'Video thumbnail';
    thumb.loading = 'lazy';
    if (video.thumbnailUrl) {
      thumb.src = video.thumbnailUrl;
    } else {
      thumb.classList.add('is-hidden');
    }
    item.appendChild(thumb);

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
    formatBadge.textContent = inferVideoFormat(video);
    meta.appendChild(formatBadge);

    if (video.isPrimary) {
      const primaryBadge = document.createElement('span');
      primaryBadge.className = 'videoBadge primary';
      primaryBadge.textContent = 'Main';
      meta.appendChild(primaryBadge);
    }

    if (video.quality && video.quality !== 'N/A') {
      const qualityBadge = document.createElement('span');
      qualityBadge.className = 'videoBadge quality';
      qualityBadge.textContent = video.quality;
      meta.appendChild(qualityBadge);
    }

    const sizeBadge = document.createElement('span');
    sizeBadge.className = 'videoBadge size';
    sizeBadge.textContent = getVideoSizeLabel(video);
    meta.appendChild(sizeBadge);

    info.appendChild(meta);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'videoActions';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'videoDownloadBtn';
    const unavailableReason = getVideoAvailabilityLabel(video);
    if (unavailableReason) {
      dlBtn.textContent = 'Unavailable';
      dlBtn.disabled = true;
      dlBtn.title = unavailableReason;
    } else {
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => downloadVideo(video));
    }
    actions.appendChild(dlBtn);

    if (hasAudioCandidate(video)) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'videoAudioBtn';
      audioBtn.textContent = 'MP3';
      if (!canDownloadMp3(video)) {
        audioBtn.classList.add('muted');
        audioBtn.title = 'MP3 extraction is not possible for this stream.';
      }
      audioBtn.addEventListener('click', () => downloadMp3(video));
      actions.appendChild(audioBtn);
    }

    item.appendChild(actions);

    videoListEl.appendChild(item);

    void hydrateVideoMetadata(tabId, video, item);
  }

  setVideoStatus(`${videos.length} video(s) detected.`, 'success');
}

async function downloadVideo(video) {
  try {
    if (video.requiresMux || video.hasAudio === false) {
      throw new Error(
        'Selected stream is not directly downloadable with audio in-browser.'
      );
    }
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_VIDEO',
      url: video.url,
      filename: buildDownloadFilename(video),
    });
    if (response?.ok) {
      setVideoStatus('Download started.', 'success');
    } else {
      throw new Error(response?.error || 'Download was rejected by the browser.');
    }
  } catch (error) {
    setVideoStatus(`Download failed: ${error.message}`, 'error');
  }
}

async function downloadMp3(video) {
  try {
    if (!hasAudioCandidate(video)) {
      throw new Error('No extractable audio track found for this video.');
    }
    if (!canDownloadMp3(video)) {
      throw new Error('MP3 extraction is not possible for this stream.');
    }
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_AUDIO',
      url: video.audioUrl,
      filename: buildMp3Filename(video),
      requireMp3: true,
    });
    if (response?.ok) {
      setVideoStatus('MP3 download started.', 'success');
    } else {
      throw new Error(response?.error || 'MP3 download was rejected.');
    }
  } catch (error) {
    setVideoStatus(`MP3 unavailable: ${error.message}`, 'error');
  }
}

async function downloadAllVideos() {
  try {
    const activeTab = await getActiveTabOrThrow();
    const response = await chrome.runtime.sendMessage({
      type: 'GET_TAB_VIDEOS',
      tabId: activeTab.id,
    });
    if (response?.ok && response.videos?.length) {
      const downloadableVideos = response.videos.filter(
        (video) => !getVideoAvailabilityLabel(video)
      );
      if (!downloadableVideos.length) {
        setVideoStatus('No directly downloadable video streams found.', 'error');
        return;
      }
      for (const video of downloadableVideos) {
        await downloadVideo(video);
      }
    }
  } catch (error) {
    setVideoStatus(`Download all failed: ${error.message}`, 'error');
  }
}

async function refreshVideoList() {
  try {
    const activeTab = await getActiveTabOrThrow();
    try {
      await triggerVideoScan(activeTab.id);
      await wait(220);
    } catch {
      // Keep going with cached detections from background storage.
    }
    const response = await chrome.runtime.sendMessage({
      type: 'GET_TAB_VIDEOS',
      tabId: activeTab.id,
    });
    if (response?.ok) {
      renderVideoList(response.videos, activeTab.id);
    }
  } catch (error) {
    setVideoStatus(error.message, 'error');
  }
}

// === Event Binding ===

function bindEvents() {
  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const cat = button.dataset.category;
      const cfg = CATEGORIES[cat];
      if (cfg) {
        setActiveView(cfg.views[0]);
        saveSettings();
      }
    });
  });

  levelPresetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveLevelPreset(button.dataset.levelPreset);
      saveSettings();
      refreshPreview({ silent: true });
    });
  });

  [formatSelect, optimizeToggle].forEach((element) => {
    element.addEventListener('change', () => {
      saveSettings();
      refreshPreview({ silent: true });
    });
  });

  [modelSelect, summaryStyleSelect].forEach((element) => {
    element.addEventListener('change', () => {
      saveSettings();
      if (element === modelSelect) syncSelectedModelToStorage();
    });
  });

  modelInput.addEventListener('change', () => { syncSelectedModelToStorage(); });

  [maxEntriesInput, maxCharsInput].forEach((element) => {
    element.addEventListener('input', () => { saveSettings(); scheduleRefreshPreview(); });
    element.addEventListener('change', () => { saveSettings(); refreshPreview({ silent: true }); });
  });

  refreshButton.addEventListener('click', () => { refreshPreview(); });
  copyButton.addEventListener('click', copyPreview);
  summarizeButton.addEventListener('click', generateAiBrief);
  copySummaryButton.addEventListener('click', copySummary);
  extractContextButton.addEventListener('click', generatePageContext);
  condenseContextButton.addEventListener('click', condensePageContextWithAi);
  copyContextButton.addEventListener('click', copyPageContext);
  saveKeyButton.addEventListener('click', saveApiKey);
  clearKeyButton.addEventListener('click', clearApiKey);
  saveOllamaUrlButton.addEventListener('click', saveOllamaUrl);
  providerSelect.addEventListener('change', () => { switchProvider(providerSelect.value); });

  // SEO panel
  scanSeoButton.addEventListener('click', scanSeoMeta);
  copySeoButton.addEventListener('click', copySeoReport);

  // Schema panel
  scanSchemaButton.addEventListener('click', scanStructuredData);
  testRichResultsButton.addEventListener('click', openRichResultsTest);
  copySchemaButton.addEventListener('click', copySchemaData);

  // Sitemap panel
  fetchSitemapButton.addEventListener('click', fetchSitemap);
  copySitemapUrlsButton.addEventListener('click', copySitemapUrls);
  if (downloadSitemapTextButton) downloadSitemapTextButton.addEventListener('click', downloadSitemapText);
  if (downloadSitemapJsonButton) downloadSitemapJsonButton.addEventListener('click', downloadSitemapJson);
  if (sitemapSearchInputEl) {
    sitemapSearchInputEl.addEventListener('input', () => { if (sitemapAllUrls.length > 0) refreshSitemapDisplay(); });
  }
  if (sitemapPatternInputEl) {
    sitemapPatternInputEl.addEventListener('input', () => { if (sitemapAllUrls.length > 0) refreshSitemapDisplay(); });
  }

  // Video panel
  downloadAllButton.addEventListener('click', downloadAllVideos);
}

// === Initialize ===

async function initialize() {
  loadSettings();
  saveSettings();
  bindEvents();
  setAiStatus('AI brief status: idle');
  setContextStatus('Context status: idle');
  setSettingsStatus('Settings status: idle');
  setVideoStatus('Video status: scanning...');
  contextAiTextEl.textContent = 'AI condensed context will appear here after generation.';
  await Promise.all([refreshPreview(), loadAiConfig(), refreshVideoList()]);
}

document.addEventListener('DOMContentLoaded', () => {
  initialize().catch((error) => {
    setStatus(`Initialization failed: ${error.message}`, 'error');
  });
});
