(() => {
  if (window.__devToolkitContentScriptInstalled) {
    return;
  }
  window.__devToolkitContentScriptInstalled = true;

  const LOG_LIMIT = 5000;
  const CONTEXT_MAX_TEXT_CHARS = 22000;
  const CONTEXT_FULL_TEXT_LIMIT = 120000;
  const CONTEXT_RELEVANT_LINES = 18;
  const CONTEXT_MAX_INTERACTIVES = 36;
  const CONTEXT_MAX_HEADINGS = 20;
  const CONTEXT_MAX_LINKS = 20;
  const CONTEXT_MAX_SECTIONS = 8;
  const CONTEXT_MAX_TRANSCRIPT_LINES = 120;
  const CONTEXT_MAX_SOURCE_LINES = 2400;
  const CONTEXT_OUTPUT_MAX_CHARS = 90000;
  const CONTEXT_SCROLL_STEP_FACTOR = 0.82;
  const CONTEXT_SCROLL_MAX_STEPS = 48;
  const CONTEXT_SCROLL_SETTLE_MS = 130;
  const CONTEXT_TOP_FRAME_SHELL_DELAY_MS = 9000;
  const CONTEXT_TOP_FRAME_LOW_SIGNAL_DELAY_MS = 2200;
  const CONTEXT_NOISE_SELECTORS = ["script", "style", "noscript", "template"];
  const CONTEXT_LAYOUT_NOISE_SELECTORS = [
    "header",
    "footer",
    "nav",
    "aside",
    '[role="banner"]',
    '[role="navigation"]',
    '[role="contentinfo"]',
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]',
    '[id*="cookie" i]',
    '[id*="consent" i]',
    '[class*="cookie" i]',
    '[class*="consent" i]',
  ];
  const CONTEXT_MAIN_ROOT_SELECTORS = [
    "main",
    '[role="main"]',
    "article",
    "#main",
    "#content",
    '[data-testid*="conversation" i]',
    '[aria-label*="conversation" i]',
    '[aria-label*="messages" i]',
    '[id*="content" i]',
    '[class*="content" i]',
  ];
  const CONTEXT_TEXT_BLOCK_SELECTORS = [
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "article",
    "section",
    "main",
    "div",
    "span",
  ];
  const CHAT_MESSAGE_SELECTORS_BY_HOST = {
    "instagram.com": [
      '[data-pagelet="IGDMessagesList"] div[dir="auto"]',
      '[data-pagelet="IGDMessagesList"] span[dir="auto"]',
      '[data-pagelet="IGDMessagesList"] [style*="opacity: 1"] div[dir="auto"]',
      '[role="main"] [role="listitem"]',
      'main [role="listitem"]',
      '[role="main"] div[dir="auto"]',
      'main div[dir="auto"]',
      '[role="log"] [role="listitem"]',
    ],
    "facebook.com": [
      '[role="main"] [role="listitem"]',
      '[role="main"] [role="row"]',
      '[aria-label*="Conversation" i] [dir="auto"]',
      '[role="log"] [role="article"]',
      '[data-testid*="message" i]',
    ],
  };
  const CHAT_MESSAGE_SELECTORS_GENERIC = [
    '[role="log"] [role="listitem"]',
    '[role="log"] [role="article"]',
    '[role="feed"] [role="article"]',
    '[data-testid*="message" i]',
    '[class*="message" i] p',
    '[class*="chat" i] p',
  ];
  const CONTEXT_LAYOUT_NOISE_SELECTOR_QUERY =
    CONTEXT_LAYOUT_NOISE_SELECTORS.join(",");
  const CONTEXT_MAIN_ROOT_SELECTOR_QUERY =
    CONTEXT_MAIN_ROOT_SELECTORS.join(",");
  const CONTEXT_TEXT_BLOCK_SELECTOR_QUERY =
    CONTEXT_TEXT_BLOCK_SELECTORS.join(",");
  const logs = [];

  // === Video ID Generator ===

  function generateId() {
    let id =
      Math.random().toString(36).substr(2, 9) +
      Date.now().toString(36).substr(3);
    for (let i = 0; i < id.length; i++) {
      if (Math.random() > 0.5) {
        id = id.substr(0, i) + id[i].toUpperCase() + id.substr(i + 1);
      }
    }
    return id;
  }

  // === Console Log Formatting ===

  function stringifyArg(arg, options) {
    if (!options) options = {};
    const pretty = Boolean(options.pretty);

    if (arg === null || arg === undefined) {
      return String(arg);
    }
    if (
      typeof arg === "string" ||
      typeof arg === "number" ||
      typeof arg === "boolean"
    ) {
      return String(arg);
    }
    try {
      return JSON.stringify(arg, null, pretty ? 2 : 0);
    } catch {
      return "[Unserializable value]";
    }
  }

  function formatWithPlaceholders(args) {
    if (!Array.isArray(args) || args.length === 0) {
      return "";
    }

    const first = args[0];
    if (typeof first !== "string") {
      return "";
    }

    let argIndex = 1;
    const text = first.replace(/%%|%[sdifoOc]/g, (token) => {
      if (token === "%%") {
        return "%";
      }

      if (token === "%c") {
        argIndex += 1;
        return "";
      }

      const value = args[argIndex];
      argIndex += 1;

      if (value === undefined) {
        return token;
      }

      if (token === "%d" || token === "%i") {
        const nextValue = Number.parseInt(value, 10);
        return Number.isNaN(nextValue) ? "NaN" : String(nextValue);
      }
      if (token === "%f") {
        const nextValue = Number(value);
        return Number.isNaN(nextValue) ? "NaN" : String(nextValue);
      }
      return stringifyArg(value, { pretty: false });
    });

    const remaining = args
      .slice(argIndex)
      .map((arg) => stringifyArg(arg, { pretty: false }));
    return [text, ...remaining].filter(Boolean).join(" ").trim();
  }

  function formatArgsPlain(args) {
    return args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        return stringifyArg(arg, { pretty: true });
      })
      .join(" ");
  }

  function formatArgsCompact(args) {
    const formatted = formatWithPlaceholders(args);
    if (formatted) {
      return formatted;
    }
    return args.map((arg) => stringifyArg(arg, { pretty: false })).join(" ");
  }

  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function compressStack(text, maxStackLines) {
    const lines = text
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    if (lines.length <= 1) {
      return text;
    }

    const stackStart = lines.findIndex((line) =>
      line.trimStart().startsWith("at "),
    );
    if (stackStart === -1) {
      return lines.join(" | ");
    }

    const head = lines.slice(0, stackStart);
    const stack = lines.slice(stackStart);
    const keptStack = stack.slice(0, maxStackLines);
    const hiddenStackFrames = stack.length - keptStack.length;

    const compressed = head.concat(keptStack);
    if (hiddenStackFrames > 0) {
      compressed.push(`... +${hiddenStackFrames} stack frames`);
    }

    return compressed.join(" | ");
  }

  function truncateText(text, maxCharsPerEntry) {
    if (text.length <= maxCharsPerEntry) {
      return text;
    }
    const remaining = text.length - maxCharsPerEntry;
    return `${text.slice(0, maxCharsPerEntry)} ... [truncated ${remaining} chars]`;
  }

  function textFromNode(node) {
    if (!node) {
      return "";
    }
    return normalizeWhitespace(node.textContent || "");
  }

  function optimizeMessageForAi(message, options) {
    let text = message || "[empty log]";
    text = compressStack(text, options.maxStackLines);
    text = normalizeWhitespace(text);
    text = truncateText(text, options.maxCharsPerEntry);
    return text || "[empty log]";
  }

  function dedupeEntries(entries) {
    const byKey = new Map();
    const ordered = [];

    for (const entry of entries) {
      const key = `${entry.level}|${entry.source}|${entry.message}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastTimestamp = entry.timestamp;
        continue;
      }

      const nextEntry = {
        ...entry,
        count: 1,
        lastTimestamp: entry.timestamp,
      };
      byKey.set(key, nextEntry);
      ordered.push(nextEntry);
    }

    return ordered;
  }

  function summarizeLevelCounts(entries) {
    const levelCounts = {};
    for (const entry of entries) {
      const key = typeof entry.level === "string" ? entry.level : "log";
      levelCounts[key] = (levelCounts[key] || 0) + (entry.count || 1);
    }
    return levelCounts;
  }

  function includeByLevelPreset(level, levelPreset) {
    if (levelPreset === "errors") {
      return level === "error";
    }
    if (levelPreset === "warnings") {
      return level === "error" || level === "warn";
    }
    return true;
  }

  function buildEntries(options) {
    const maxEntries = Number.isFinite(options.maxEntries)
      ? Math.min(LOG_LIMIT, Math.max(1, Math.floor(options.maxEntries)))
      : logs.length;

    const selectedLogs = logs.slice(Math.max(0, logs.length - maxEntries));
    const normalized = selectedLogs
      .map((entry) => {
        const level = typeof entry.level === "string" ? entry.level : "log";
        const source =
          typeof entry.source === "string" ? entry.source : "console";
        if (!includeByLevelPreset(level, options.levelPreset)) {
          return null;
        }

        const baseMessage =
          options.format === "plain"
            ? formatArgsPlain(entry.args || [])
            : formatArgsCompact(entry.args || []);

        const message = options.optimizeForAi
          ? optimizeMessageForAi(baseMessage, options)
          : baseMessage || "[empty log]";

        return {
          timestamp: entry.timestamp || new Date().toISOString(),
          level,
          source,
          message,
        };
      })
      .filter(Boolean);

    const dedupe = options.optimizeForAi || options.format === "ai";
    const entries = dedupe
      ? dedupeEntries(normalized)
      : normalized.map((entry) => ({
          ...entry,
          count: 1,
          lastTimestamp: entry.timestamp,
        }));

    return {
      totalCaptured: logs.length,
      totalCount: normalized.length,
      uniqueCount: entries.length,
      entries,
      levelCounts: summarizeLevelCounts(entries),
    };
  }

  // === Report Builders ===

  function escapeXml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function toSingleLine(text) {
    return String(text).replaceAll("\n", "\\n");
  }

  function buildPlainReport(report) {
    if (report.totalCount === 0) {
      return [
        `URL: ${window.location.href}`,
        "Captured console logs: 0",
        "",
        "No console logs captured yet.",
      ].join("\n");
    }

    const header = [
      `URL: ${window.location.href}`,
      `Captured at: ${new Date().toISOString()}`,
      `Captured console logs: ${report.totalCount}`,
      `Unique after dedupe: ${report.uniqueCount}`,
      "",
    ];

    const lines = report.entries.map((entry, index) => {
      const source = entry.source ? ` [${entry.source}]` : "";
      const repeat = entry.count > 1 ? ` x${entry.count}` : "";
      return `${index + 1}. ${entry.timestamp} [${entry.level}]${source}${repeat} ${entry.message}`;
    });

    return header.concat(lines).join("\n");
  }

  function buildAiCompactReport(report) {
    const header = [
      "AI_LOGS_V1",
      `url=${window.location.href}`,
      `captured=${new Date().toISOString()}`,
      `preset=${report.levelPreset}`,
      `total=${report.totalCount}`,
      `unique=${report.uniqueCount}`,
      `levels=${JSON.stringify(report.levelCounts)}`,
    ];

    const lines = report.entries.map(
      (entry, index) =>
        `${index + 1}|${entry.timestamp}|${entry.level}|${entry.count}|${entry.source}|${toSingleLine(
          entry.message,
        )}`,
    );

    return header.concat(lines).join("\n");
  }

  function buildXmlReport(report) {
    const rows = report.entries
      .map((entry, index) => {
        return `<e i="${index + 1}" t="${escapeXml(entry.timestamp)}" l="${escapeXml(
          entry.level,
        )}" s="${escapeXml(entry.source)}" c="${entry.count}">${escapeXml(entry.message)}</e>`;
      })
      .join("\n");

    return `<logs url="${escapeXml(window.location.href)}" captured="${escapeXml(
      new Date().toISOString(),
    )}" preset="${escapeXml(report.levelPreset)}" total="${report.totalCount}" unique="${
      report.uniqueCount
    }">
${rows}
</logs>`;
  }

  // === SEO Meta Extraction ===

  function getMetaContent(selector) {
    const value = document.querySelector(selector)?.getAttribute("content");
    if (typeof value !== "string") {
      return "";
    }
    return normalizeWhitespace(value);
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function getInteractiveLabel(element) {
    return (
      textFromNode(element) ||
      normalizeWhitespace(element.getAttribute("aria-label") || "") ||
      normalizeWhitespace(element.getAttribute("title") || "") ||
      normalizeWhitespace(element.getAttribute("placeholder") || "") ||
      normalizeWhitespace(element.getAttribute("name") || "") ||
      normalizeWhitespace(element.id || "")
    );
  }

  function collectHeadings() {
    const headings = [];
    const seen = new Set();
    const nodes = document.querySelectorAll("h1, h2, h3");
    for (const node of nodes) {
      if (!isElementVisible(node)) {
        continue;
      }
      const text = textFromNode(node);
      if (!text) {
        continue;
      }
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      headings.push({
        level: node.tagName.toLowerCase(),
        text: truncateText(text, 240),
      });
      if (headings.length >= CONTEXT_MAX_HEADINGS) {
        break;
      }
    }
    return headings;
  }

  function collectKeyLinks() {
    const links = [];
    const seen = new Set();
    const allLinks = document.querySelectorAll("a[href]");
    for (const node of allLinks) {
      if (!isElementVisible(node)) {
        continue;
      }
      const href = node.href;
      if (
        !href ||
        href.startsWith("javascript:") ||
        href.endsWith("#") ||
        href.startsWith(`${window.location.href}#`)
      ) {
        continue;
      }
      const label = getInteractiveLabel(node);
      const cleanedLabel = truncateText(label, 140);
      if (!cleanedLabel) {
        continue;
      }
      const key = href;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push({
        text: cleanedLabel,
        href: truncateText(href, 240),
        external: !href.startsWith(window.location.origin),
      });
      if (links.length >= CONTEXT_MAX_LINKS) {
        break;
      }
    }
    return links;
  }

  function pruneFullPageDom() {
    const root = document.body || document.documentElement;
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll(CONTEXT_NOISE_SELECTORS.join(","))
      .forEach((noiseNode) => noiseNode.remove());
    clone
      .querySelectorAll('[hidden], [aria-hidden="true"]')
      .forEach((hiddenNode) => hiddenNode.remove());
    return clone;
  }

  function getNormalizedHost() {
    return window.location.hostname.toLowerCase().replace(/^www\./, "");
  }

  function hostMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }

  function isNodeInsideLayoutNoise(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    if (node.matches(CONTEXT_LAYOUT_NOISE_SELECTOR_QUERY)) {
      return true;
    }
    return Boolean(node.closest(CONTEXT_LAYOUT_NOISE_SELECTOR_QUERY));
  }

  function isLikelyPayloadLine(line) {
    if (!line) {
      return false;
    }
    const braceDensity =
      (line.match(/[{}[\]<>=;]/g) || []).length / Math.max(1, line.length);
    if (braceDensity > 0.16 && !/[.!?]/.test(line)) {
      return true;
    }
    if (
      /^\{.*\}$/.test(line) &&
      /(require|Bootloader|ScheduledServerJS|qplTimingsServerJS|rsrcMap|__bbox)/i.test(
        line,
      )
    ) {
      return true;
    }
    if (
      /(function\s*\(|=>|const\s+[a-z$_]|let\s+[a-z$_]|var\s+[a-z$_]|<\/?[a-z][^>]*>)/i.test(
        line,
      ) &&
      /[{[;]/.test(line)
    ) {
      return true;
    }
    if (/https?:\/\/[^\s]+\.js(\?|$)/i.test(line) && line.length > 80) {
      return true;
    }
    if (/^[A-Za-z0-9+/=]{80,}$/.test(line.replace(/\s+/g, ""))) {
      return true;
    }
    return false;
  }

  function isLikelyUiChromeLine(line) {
    if (!line) {
      return true;
    }
    if (line.length <= 2) {
      return true;
    }
    if (
      /^(home|menu|search|about|contact|privacy|terms|cookies?|settings|help|next|previous|back)$/i.test(
        line,
      )
    ) {
      return true;
    }
    if (
      /^(log in|login|sign up|create account|accept all|reject all|allow all cookies)$/i.test(
        line,
      )
    ) {
      return true;
    }
    return false;
  }

  function isMeaningfulContentLine(line) {
    if (!line) {
      return false;
    }
    if (isLikelyPayloadLine(line) || isLikelyUiChromeLine(line)) {
      return false;
    }
    const alphaCount = (line.match(/[A-Za-z]/g) || []).length;
    const numberCount = (line.match(/\d/g) || []).length;
    const symbolCount = (line.match(/[^A-Za-z0-9\s]/g) || []).length;
    if (alphaCount === 0 && numberCount < 3) {
      return false;
    }
    if (line.length > 26 && symbolCount > alphaCount * 1.2) {
      return false;
    }
    return true;
  }

  function scoreRootCandidate(node) {
    if (!(node instanceof Element)) {
      return Number.NEGATIVE_INFINITY;
    }
    if (node !== document.body && !isElementVisible(node)) {
      return Number.NEGATIVE_INFINITY;
    }
    const text = normalizeWhitespace(node.innerText || node.textContent || "");
    if (!text) {
      return Number.NEGATIVE_INFINITY;
    }
    const textLength = text.length;
    if (textLength < 80 && node !== document.body) {
      return Number.NEGATIVE_INFINITY;
    }
    let score = Math.min(40, Math.floor(textLength / 220));
    if (node.matches('main, article, [role="main"]')) {
      score += 8;
    }
    if (
      node.matches(
        '[data-testid*="conversation" i], [aria-label*="conversation" i], [aria-label*="messages" i]',
      )
    ) {
      score += 10;
    }
    if (
      node.matches('#main, #content, [id*="content" i], [class*="content" i]')
    ) {
      score += 4;
    }
    if (node === document.body) {
      score -= 4;
    }
    if (isNodeInsideLayoutNoise(node)) {
      score -= 10;
    }
    const listLikeCount = node.querySelectorAll(
      'p, li, [role="listitem"]',
    ).length;
    score += Math.min(6, Math.floor(listLikeCount / 6));
    return score;
  }

  function describeNode(node) {
    if (!(node instanceof Element)) {
      return "unknown";
    }
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const className = normalizeWhitespace(node.className || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .join(".");
    const classSuffix = className ? `.${className}` : "";
    return `${tag}${id}${classSuffix}`;
  }

  function selectPrimaryContentRoot() {
    const roots = new Set();
    document
      .querySelectorAll(CONTEXT_MAIN_ROOT_SELECTOR_QUERY)
      .forEach((node) => roots.add(node));
    if (document.body) {
      roots.add(document.body);
    }
    let bestNode = document.body || document.documentElement;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of roots) {
      const score = scoreRootCandidate(candidate);
      if (score > bestScore) {
        bestNode = candidate;
        bestScore = score;
      }
    }
    return {
      node: bestNode,
      hint: describeNode(bestNode),
    };
  }

  function collectUniqueVisibleLinesFromNodes(nodes, options) {
    if (!options) options = {};
    const maxLines = Number.isFinite(options.maxLines)
      ? options.maxLines
      : CONTEXT_MAX_SOURCE_LINES;
    const lines = [];
    const seen = new Set();
    for (const node of nodes) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (!isElementVisible(node)) {
        continue;
      }
      if (isNodeInsideLayoutNoise(node)) {
        continue;
      }
      const rawText = node.innerText || node.textContent || "";
      if (!rawText) {
        continue;
      }
      if (
        node.children.length > 0 &&
        rawText.length > 320 &&
        !node.matches("p, li, blockquote, figcaption, pre, h1, h2, h3, h4")
      ) {
        continue;
      }
      const parts = rawText.split("\n");
      for (const part of parts) {
        const line = normalizeWhitespace(part);
        if (!isMeaningfulContentLine(line)) {
          continue;
        }
        const dedupeKey = line.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        lines.push(line);
        if (lines.length >= maxLines) {
          return lines;
        }
      }
    }
    return lines;
  }

  function isLikelyChatPage() {
    const host = getNormalizedHost();
    const path = window.location.pathname.toLowerCase();
    if (hostMatches(host, "instagram.com") && path.includes("/direct")) {
      return true;
    }
    if (hostMatches(host, "facebook.com") && /(messages|\/t\/)/.test(path)) {
      return true;
    }
    return Boolean(
      document.querySelector(
        '[role="log"], [role="feed"], [aria-label*="conversation" i], [data-testid*="message" i]',
      ),
    );
  }

  function getChatSelectorsForCurrentHost() {
    const host = getNormalizedHost();
    const selectors = [...CHAT_MESSAGE_SELECTORS_GENERIC];
    for (const [domain, domainSelectors] of Object.entries(
      CHAT_MESSAGE_SELECTORS_BY_HOST,
    )) {
      if (hostMatches(host, domain)) {
        selectors.unshift(...domainSelectors);
      }
    }
    return Array.from(new Set(selectors));
  }

  function collectChatCandidateNodes(selectors) {
    const candidateSet = new Set();
    for (const selector of selectors) {
      document
        .querySelectorAll(selector)
        .forEach((node) => candidateSet.add(node));
    }
    return Array.from(candidateSet).sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function isLikelyInstagramShellFrameUrl() {
    const host = getNormalizedHost();
    const path = window.location.pathname.toLowerCase();
    return (
      hostMatches(host, "facebook.com") &&
      /^\/instagram\/login_sync\/?/.test(path)
    );
  }

  function collectInstagramDmPageletLines() {
    const pagelet = document.querySelector('[data-pagelet="IGDMessagesList"]');
    if (!pagelet) {
      return [];
    }

    const nodes = pagelet.querySelectorAll('span[dir="auto"], div[dir="auto"]');
    const lines = [];
    const seen = new Set();

    for (const node of nodes) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (node.closest('[role="progressbar"]')) {
        continue;
      }
      if (node.closest('a[aria-label*="Open the profile page" i]')) {
        continue;
      }

      let hiddenByOpacity = false;
      let walker = node;
      for (
        let depth = 0;
        walker && walker !== pagelet && depth < 12;
        depth += 1
      ) {
        const styleAttr = walker.getAttribute("style") || "";
        if (/opacity\s*:\s*0(?:[; ]|$)/i.test(styleAttr)) {
          hiddenByOpacity = true;
          break;
        }
        walker = walker.parentElement;
      }
      if (hiddenByOpacity) {
        continue;
      }

      if (!isElementVisible(node)) {
        continue;
      }

      const nestedDirNodes = node.querySelectorAll('[dir="auto"]').length;
      const text = normalizeWhitespace(node.textContent || "");
      if (!text || text.length < 2) {
        continue;
      }
      if (nestedDirNodes > 0 && text.length > 280) {
        continue;
      }
      if (/^(loading|loading\.\.\.|user-profile-picture)$/i.test(text)) {
        continue;
      }
      if (!isMeaningfulContentLine(text) && !/\d{1,2}:\d{2}/.test(text)) {
        continue;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      lines.push(text);
    }

    return lines;
  }

  function normalizeTranscriptLines(lines) {
    return lines.filter(
      (line) =>
        !/^(type a message|message|send|seen|delivered|new message|search|details|info|chat info|loading|loading\.\.\.)$/i.test(
          line,
        ),
    );
  }

  function appendUniqueLines(target, seen, incoming, maxLines) {
    for (const line of incoming) {
      const normalized = normalizeWhitespace(line);
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      target.push(normalized);
      if (target.length >= maxLines) {
        return;
      }
    }
  }

  function isScrollableElement(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    if (!isElementVisible(node)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY || "";
    if (!/(auto|scroll)/i.test(overflowY)) {
      return false;
    }
    return node.scrollHeight - node.clientHeight > 80;
  }

  function pickBestChatScrollContainer(selectors) {
    const query = [
      '[data-pagelet="IGDMessagesList"]',
      '[role="log"]',
      '[aria-label*="conversation" i]',
      '[data-testid*="conversation" i]',
      '[class*="conversation" i]',
      '[class*="chat" i]',
      '[role="main"]',
      "main",
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(query)).filter(
      (node) => isScrollableElement(node),
    );
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const node of candidates) {
      const messageCount = node.querySelectorAll(selectors.join(",")).length;
      const viewportBonus = Math.floor((node.clientHeight || 0) / 120);
      const depthBonus = Math.floor(
        (node.scrollHeight || 0) / Math.max(1, node.clientHeight || 1),
      );
      const score = messageCount * 8 + viewportBonus + Math.min(20, depthBonus);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  async function captureWhileElementScrolls(element, captureStep) {
    if (!(element instanceof Element)) {
      return;
    }
    const originalTop = element.scrollTop;
    const originalBehavior = element.style.scrollBehavior;
    element.style.scrollBehavior = "auto";
    try {
      element.scrollTop = 0;
      await sleep(CONTEXT_SCROLL_SETTLE_MS);
      for (let step = 0; step < CONTEXT_SCROLL_MAX_STEPS; step += 1) {
        captureStep();
        const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
        if (maxTop <= 0 || element.scrollTop >= maxTop - 2) {
          break;
        }
        const delta = Math.max(
          140,
          Math.floor(element.clientHeight * CONTEXT_SCROLL_STEP_FACTOR),
        );
        const nextTop = Math.min(maxTop, element.scrollTop + delta);
        if (nextTop === element.scrollTop) {
          break;
        }
        element.scrollTop = nextTop;
        await sleep(CONTEXT_SCROLL_SETTLE_MS);
      }
      captureStep();
    } finally {
      element.scrollTop = originalTop;
      element.style.scrollBehavior = originalBehavior;
    }
  }

  async function captureWhileWindowScrolls(captureStep) {
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) {
      captureStep();
      return;
    }
    const originalTop = scroller.scrollTop;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      await sleep(CONTEXT_SCROLL_SETTLE_MS);
      for (let step = 0; step < CONTEXT_SCROLL_MAX_STEPS; step += 1) {
        captureStep();
        const maxTop = Math.max(0, scroller.scrollHeight - window.innerHeight);
        if (maxTop <= 0 || scroller.scrollTop >= maxTop - 2) {
          break;
        }
        const delta = Math.max(
          200,
          Math.floor(window.innerHeight * CONTEXT_SCROLL_STEP_FACTOR),
        );
        const nextTop = Math.min(maxTop, scroller.scrollTop + delta);
        if (nextTop === scroller.scrollTop) {
          break;
        }
        window.scrollTo({ top: nextTop, left: 0, behavior: "auto" });
        await sleep(CONTEXT_SCROLL_SETTLE_MS);
      }
      captureStep();
    } finally {
      window.scrollTo({ top: originalTop, left: 0, behavior: "auto" });
      document.documentElement.style.scrollBehavior = originalBehavior;
    }
  }

  function collectChatTranscriptLinesSnapshot(selectors) {
    const instagramPageletLines = collectInstagramDmPageletLines();
    if (instagramPageletLines.length > 0) {
      return normalizeTranscriptLines(instagramPageletLines);
    }

    const candidates = collectChatCandidateNodes(selectors);
    const scopedLines = normalizeTranscriptLines(
      collectUniqueVisibleLinesFromNodes(candidates, {
        maxLines: CONTEXT_MAX_SOURCE_LINES,
      }),
    );
    if (scopedLines.length > 0) {
      return scopedLines;
    }
    const source =
      document.body?.innerText || document.documentElement?.innerText || "";
    return normalizeTranscriptLines(
      source
        .split("\n")
        .map((line) => normalizeWhitespace(line))
        .filter((line) => line.length >= 2 && !isLikelyPayloadLine(line))
        .slice(0, CONTEXT_MAX_SOURCE_LINES),
    );
  }

  async function collectChatTranscriptLines(options) {
    if (!options) options = {};
    if (!isLikelyChatPage()) {
      return {
        mode: "prominent-content",
        lines: [],
        transcriptLines: [],
        rootHint: "",
      };
    }

    const selectors = getChatSelectorsForCurrentHost();
    const lines = [];
    const seen = new Set();
    const captureStep = () => {
      const nextLines = collectChatTranscriptLinesSnapshot(selectors);
      appendUniqueLines(lines, seen, nextLines, CONTEXT_MAX_SOURCE_LINES);
    };

    captureStep();
    if (options.autoScroll && lines.length < CONTEXT_MAX_SOURCE_LINES) {
      const container = pickBestChatScrollContainer(selectors);
      if (container) {
        await captureWhileElementScrolls(container, captureStep);
      } else {
        await captureWhileWindowScrolls(captureStep);
      }
    }

    if (lines.length < 6) {
      return {
        mode: "prominent-content",
        lines: [],
        transcriptLines: [],
        rootHint: "",
      };
    }

    return {
      mode: "chat-transcript",
      lines,
      transcriptLines: lines.slice(-CONTEXT_MAX_TRANSCRIPT_LINES),
      rootHint: "chat-thread",
    };
  }

  function collectProminentLinesSnapshot() {
    const { node: rootNode, hint: rootHint } = selectPrimaryContentRoot();
    const scopedNodes = [
      rootNode,
      ...rootNode.querySelectorAll(CONTEXT_TEXT_BLOCK_SELECTOR_QUERY),
    ];
    let lines = collectUniqueVisibleLinesFromNodes(scopedNodes, {
      maxLines: CONTEXT_MAX_SOURCE_LINES,
    });
    if (lines.length === 0) {
      const source =
        document.body?.innerText || document.documentElement?.innerText || "";
      lines = source
        .split("\n")
        .map((line) => normalizeWhitespace(line))
        .filter((line) => line.length >= 2 && !isLikelyPayloadLine(line))
        .slice(0, CONTEXT_MAX_SOURCE_LINES);
    }
    return {
      lines,
      rootHint,
    };
  }

  async function collectProminentLinesWithScroll(options) {
    if (!options) options = {};
    const mergedLines = [];
    const seen = new Set();
    let rootHint = "";
    const captureStep = () => {
      const snap = collectProminentLinesSnapshot();
      if (snap.rootHint) {
        rootHint = snap.rootHint;
      }
      appendUniqueLines(
        mergedLines,
        seen,
        snap.lines,
        CONTEXT_MAX_SOURCE_LINES,
      );
    };
    captureStep();
    if (options.autoScroll && mergedLines.length < CONTEXT_MAX_SOURCE_LINES) {
      await captureWhileWindowScrolls(captureStep);
    }
    return {
      lines: mergedLines,
      rootHint,
    };
  }

  async function collectFullPageText(options) {
    if (!options) options = {};
    const transcript = await collectChatTranscriptLines({
      autoScroll: options.autoScroll,
    });
    if (transcript.mode === "chat-transcript") {
      const fullText = transcript.lines.join("\n");
      return {
        sourceChars: fullText.length,
        fullText,
        lines: transcript.lines,
        extractionMode: transcript.mode,
        transcriptLines: transcript.transcriptLines,
        rootHint: transcript.rootHint,
      };
    }

    const prominent = await collectProminentLinesWithScroll({
      autoScroll: options.autoScroll,
    });
    const fullText = prominent.lines.join("\n");
    return {
      sourceChars: fullText.length,
      fullText,
      lines: prominent.lines,
      extractionMode: "prominent-content",
      transcriptLines: [],
      rootHint: prominent.rootHint,
    };
  }

  function scoreRelevantLine(line, index) {
    const hasKeyword =
      /(error|warning|failed|failure|critical|issue|problem|bug|exception|fix|payment|checkout|login|auth|order|total|price|api|token|required|important|message|conversation|summary)/i.test(
        line,
      );
    const navNoise =
      /^(home|menu|search|about|contact|privacy|terms|cookies?|settings|help)$/i.test(
        line,
      );
    let score = 0;
    if (line.length >= 24 && line.length <= 240) {
      score += 3;
    } else if (line.length > 240) {
      score += 1;
    }
    if (/[.!?]/.test(line)) {
      score += 1;
    }
    if (hasKeyword) {
      score += 2;
    }
    if (/\d/.test(line)) {
      score += 1;
    }
    if (/[$£€%]/.test(line)) {
      score += 1;
    }
    if (index < 100) {
      score += 1;
    }
    if (navNoise) {
      score -= 4;
    }
    if (isLikelyPayloadLine(line)) {
      score -= 8;
    }
    return score;
  }

  function collectRelevantLines(lines, options) {
    if (!options) options = {};
    const mode =
      typeof options.mode === "string" ? options.mode : "prominent-content";
    const normalizedLines = lines.filter((line) =>
      isMeaningfulContentLine(line),
    );
    if (mode === "chat-transcript") {
      return normalizedLines
        .slice(-CONTEXT_RELEVANT_LINES)
        .map((line) => truncateText(line, 240));
    }

    const ranked = normalizedLines
      .map((line, index) => ({
        line,
        index,
        score: scoreRelevantLine(line, index),
      }))
      .filter((item) => item.line.length >= 18 && item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const picked = [];
    const seen = new Set();
    for (const item of ranked) {
      const key = item.line.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      picked.push(item.line);
      if (picked.length >= CONTEXT_RELEVANT_LINES) {
        break;
      }
    }

    if (picked.length === 0) {
      return normalizedLines
        .slice(0, CONTEXT_RELEVANT_LINES)
        .map((line) => truncateText(line, 240));
    }

    return picked.map((line) => truncateText(line, 240));
  }

  function collectSectionSnippets(lines) {
    const snippets = [];
    const seen = new Set();
    for (const line of lines) {
      const text = normalizeWhitespace(line);
      if (text.length < 45) {
        continue;
      }
      const dedupeKey = text.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      snippets.push(truncateText(text, 220));
      if (snippets.length >= CONTEXT_MAX_SECTIONS) {
        break;
      }
    }
    return snippets;
  }

  function collectInteractiveElements() {
    const interactives = [];
    const seen = new Set();
    const nodes = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]',
    );

    for (const node of nodes) {
      if (!isElementVisible(node)) {
        continue;
      }
      const label = truncateText(getInteractiveLabel(node), 140);
      if (!label) {
        continue;
      }
      const tag = node.tagName.toLowerCase();
      const type = normalizeWhitespace(node.getAttribute("type") || "");
      const destination =
        tag === "a"
          ? node.href
          : normalizeWhitespace(node.getAttribute("action") || "");
      const key = `${tag}|${label}|${destination}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      interactives.push({
        element: type ? `${tag}[${type}]` : tag,
        label,
        destination: destination ? truncateText(destination, 220) : "",
      });
      if (interactives.length >= CONTEXT_MAX_INTERACTIVES) {
        break;
      }
    }

    return interactives;
  }

  function buildDomStats() {
    const allElements = document.querySelectorAll("*");
    const images = Array.from(document.images || []);
    const imagesWithoutAlt = images.filter((image) => {
      const alt = normalizeWhitespace(image.getAttribute("alt") || "");
      return !alt;
    });

    return {
      elementsScanned: allElements.length,
      links: document.querySelectorAll("a[href]").length,
      headings: document.querySelectorAll("h1, h2, h3").length,
      paragraphs: document.querySelectorAll("p").length,
      lists: document.querySelectorAll("ul, ol").length,
      tables: document.querySelectorAll("table").length,
      forms: document.querySelectorAll("form").length,
      images: images.length,
      imagesWithoutAlt: imagesWithoutAlt.length,
    };
  }

  function buildTimingSnapshot() {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) {
      return null;
    }
    return {
      type: nav.type || "",
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEventMs: Math.round(nav.loadEventEnd || 0),
      transferSize: Number(nav.transferSize) || 0,
      encodedBodySize: Number(nav.encodedBodySize) || 0,
    };
  }

  async function extractPageContext(options) {
    if (!options) options = {};
    const rootClone = pruneFullPageDom();
    const cleanedText = textFromNode(rootClone);
    const {
      sourceChars,
      fullText,
      lines,
      extractionMode,
      transcriptLines,
      rootHint,
    } = await collectFullPageText({ autoScroll: Boolean(options.autoScroll) });
    const maxContextChars = Number.isFinite(options.maxContextChars)
      ? options.maxContextChars
      : CONTEXT_FULL_TEXT_LIMIT;
    const fullTextSample = truncateText(fullText, maxContextChars);
    const relevantLines = collectRelevantLines(lines, { mode: extractionMode });
    const snippets = collectSectionSnippets(lines);
    const truncated = fullTextSample.length < fullText.length;

    return {
      page: {
        url: window.location.href,
        title: document.title || "",
        lang:
          document.documentElement?.getAttribute("lang") ||
          document.documentElement?.lang ||
          "",
        contentType: document.contentType || "",
        readyState: document.readyState || "",
        referrer: document.referrer || "",
        capturedAt: new Date().toISOString(),
        lastModified: document.lastModified || "",
      },
      meta: {
        description: truncateText(
          getMetaContent('meta[name="description"]'),
          220,
        ),
        keywords: truncateText(getMetaContent('meta[name="keywords"]'), 220),
        canonical: truncateText(
          document.querySelector('link[rel="canonical"]')?.href || "",
          240,
        ),
        ogTitle: truncateText(getMetaContent('meta[property="og:title"]'), 220),
        ogDescription: truncateText(
          getMetaContent('meta[property="og:description"]'),
          220,
        ),
      },
      content: {
        rootSelector: rootHint || "body",
        extractionMode,
        summaryText: truncateText(cleanedText, CONTEXT_MAX_TEXT_CHARS),
        fullTextSample,
        relevantLines,
        transcriptLines: transcriptLines.map((line) => truncateText(line, 220)),
        snippets,
        interactiveElements: collectInteractiveElements(),
        headings: collectHeadings(),
        keyLinks: collectKeyLinks(),
        textCharsOriginal: fullText.length,
        textCharsIncluded: fullTextSample.length,
        renderedTextChars: sourceChars,
        textWasTruncated: truncated,
      },
      structure: {
        domStats: buildDomStats(),
        timing: buildTimingSnapshot(),
      },
    };
  }

  function buildContextMarkdown(pageContext) {
    const lines = [];
    lines.push("# Page Context (Prominent Content Capture)");
    lines.push(`- URL: ${pageContext.page.url}`);
    lines.push(`- Title: ${pageContext.page.title || "[none]"}`);
    const modeLabel =
      pageContext.content.extractionMode === "chat-transcript"
        ? "chat transcript extraction (conversation-priority)"
        : "prominent visible content extraction (layout-noise filtered)";
    lines.push(`- Scan mode: ${modeLabel}`);
    lines.push("- Capture flow: auto-scroll sweep from top to bottom");
    lines.push(`- Primary root: ${pageContext.content.rootSelector}`);
    if (pageContext.meta.description) {
      lines.push(`- Description: ${pageContext.meta.description}`);
    }
    if (pageContext.meta.canonical) {
      lines.push(`- Canonical: ${pageContext.meta.canonical}`);
    }
    lines.push(`- Captured: ${pageContext.page.capturedAt}`);
    lines.push(
      `- Coverage: ${pageContext.content.renderedTextChars} rendered chars across ${pageContext.structure.domStats.elementsScanned || 0} DOM elements`,
    );
    lines.push("");

    lines.push("## Most Relevant Content");
    if (pageContext.content.relevantLines.length > 0) {
      pageContext.content.relevantLines.forEach((line) => {
        lines.push(`- ${line}`);
      });
    } else {
      lines.push(
        "- No high-signal lines detected; use supporting snippets below.",
      );
    }
    lines.push("");

    if (
      pageContext.content.extractionMode === "chat-transcript" &&
      pageContext.content.transcriptLines.length > 0
    ) {
      lines.push("## Chat Transcript");
      pageContext.content.transcriptLines.forEach((line) => {
        lines.push(`- ${line}`);
      });
      lines.push("");
    }

    if (pageContext.content.headings.length > 0) {
      lines.push("## Page Headings");
      pageContext.content.headings.forEach((heading) => {
        lines.push(`- ${heading.level.toUpperCase()}: ${heading.text}`);
      });
      lines.push("");
    }

    lines.push("## Key Page Content");
    if (pageContext.content.snippets.length > 0) {
      pageContext.content.snippets.forEach((snippet) => {
        lines.push(`- ${snippet}`);
      });
    } else if (pageContext.content.summaryText) {
      lines.push(`- ${truncateText(pageContext.content.summaryText, 900)}`);
    } else {
      lines.push("- No meaningful page text detected.");
    }
    lines.push("");

    if (pageContext.content.interactiveElements.length > 0) {
      lines.push("## Key UI Elements");
      pageContext.content.interactiveElements.forEach((item) => {
        if (item.destination) {
          lines.push(`- ${item.element}: ${item.label} -> ${item.destination}`);
        } else {
          lines.push(`- ${item.element}: ${item.label}`);
        }
      });
      lines.push("");
    }

    if (pageContext.content.keyLinks.length > 0) {
      lines.push("## Key Links");
      pageContext.content.keyLinks.forEach((link) => {
        const marker = link.external ? "external" : "internal";
        lines.push(`- [${marker}] ${link.text}: ${link.href}`);
      });
      lines.push("");
    }

    lines.push("## Full Text Capture");
    if (pageContext.content.fullTextSample) {
      lines.push(pageContext.content.fullTextSample);
    } else {
      lines.push("[no text captured]");
    }
    lines.push("");

    lines.push("");
    lines.push("## Context Stats");
    lines.push(`- Extraction mode: ${pageContext.content.extractionMode}`);
    lines.push(
      `- Text included: ${pageContext.content.textCharsIncluded}/${pageContext.content.textCharsOriginal} chars`,
    );
    lines.push(`- DOM links: ${pageContext.structure.domStats.links}`);
    lines.push(`- DOM headings: ${pageContext.structure.domStats.headings}`);
    lines.push(`- DOM forms: ${pageContext.structure.domStats.forms}`);

    const raw = lines.join("\n").trim();
    if (raw.length <= CONTEXT_OUTPUT_MAX_CHARS) {
      return raw;
    }

    const hidden = raw.length - CONTEXT_OUTPUT_MAX_CHARS;
    return `${raw.slice(0, CONTEXT_OUTPUT_MAX_CHARS)}\n\n... [truncated ${hidden} chars for prompt efficiency]`;
  }

  async function buildContextPayload(options) {
    const pageContext = await extractPageContext({
      maxContextChars: options.maxContextChars,
      autoScroll: options.autoScroll,
    });
    const text = buildContextMarkdown(pageContext);

    return {
      text,
      pageUrl: pageContext.page.url,
      sourceTextChars: pageContext.content.renderedTextChars,
      elementsScanned: pageContext.structure.domStats.elementsScanned || 0,
      relevantCount: pageContext.content.relevantLines.length,
      estimatedTokens: estimateTokenCount(text),
    };
  }

  function estimateTokenCount(text) {
    return Math.ceil(text.length / 4);
  }

  function buildReportText(options) {
    const report = buildEntries(options);
    const reportWithPreset = {
      ...report,
      levelPreset: options.levelPreset,
    };
    const builder =
      options.format === "xml"
        ? buildXmlReport
        : options.format === "plain"
          ? buildPlainReport
          : buildAiCompactReport;

    const text = builder(reportWithPreset, options);
    return {
      ...reportWithPreset,
      text,
      estimatedTokens: estimateTokenCount(text),
    };
  }

  // === SEO Meta Extraction ===

  function extractSeoMeta() {
    const title = document.title || "";
    const titleLen = title.length;
    const titleStatus =
      titleLen >= 50 && titleLen <= 60
        ? "pass"
        : titleLen >= 30 && titleLen <= 70
          ? "warn"
          : titleLen === 0
            ? "fail"
            : "warn";

    const desc = getMetaContent('meta[name="description"]');
    const descLen = desc.length;
    const descStatus =
      descLen >= 120 && descLen <= 160
        ? "pass"
        : descLen >= 70 && descLen <= 200
          ? "warn"
          : descLen === 0
            ? "fail"
            : "warn";

    const canonical =
      document.querySelector('link[rel="canonical"]')?.href || "";
    const robots = getMetaContent('meta[name="robots"]');
    const viewport = getMetaContent('meta[name="viewport"]');

    const og = {
      title: getMetaContent('meta[property="og:title"]'),
      description: getMetaContent('meta[property="og:description"]'),
      image: getMetaContent('meta[property="og:image"]'),
      url: getMetaContent('meta[property="og:url"]'),
      type: getMetaContent('meta[property="og:type"]'),
      siteName: getMetaContent('meta[property="og:site_name"]'),
    };

    const twitter = {
      card: getMetaContent('meta[name="twitter:card"]'),
      title: getMetaContent('meta[name="twitter:title"]'),
      description: getMetaContent('meta[name="twitter:description"]'),
      image: getMetaContent('meta[name="twitter:image"]'),
      creator: getMetaContent('meta[name="twitter:creator"]'),
      site: getMetaContent('meta[name="twitter:site"]'),
    };

    const hreflangLinks = Array.from(
      document.querySelectorAll('link[rel="alternate"][hreflang]'),
    );
    const hreflang = hreflangLinks.map((link) => ({
      lang: link.getAttribute("hreflang") || "",
      href: link.href || "",
    }));

    const allHeadings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    );
    const h1Count = document.querySelectorAll("h1").length;
    const hierarchy = allHeadings.slice(0, 50).map((h) => ({
      level: parseInt(h.tagName.substring(1), 10),
      text: normalizeWhitespace(h.textContent || "").slice(0, 120),
    }));
    const headingIssues = [];
    if (h1Count === 0) headingIssues.push("No H1 tag found");
    if (h1Count > 1) headingIssues.push(`Multiple H1 tags (${h1Count})`);
    for (let i = 1; i < hierarchy.length; i++) {
      if (hierarchy[i].level > hierarchy[i - 1].level + 1) {
        headingIssues.push(
          `Heading skip: H${hierarchy[i - 1].level} → H${hierarchy[i].level}`,
        );
        break;
      }
    }

    const images = Array.from(document.images || []);
    const withAlt = images.filter(
      (img) => (img.getAttribute("alt") || "").trim().length > 0,
    ).length;
    const withoutAlt = images.length - withAlt;
    const coverage =
      images.length > 0 ? Math.round((withAlt / images.length) * 100) : 100;
    const imgStatus =
      coverage >= 80 ? "pass" : coverage >= 50 ? "warn" : "fail";

    return {
      title: { value: title, length: titleLen, status: titleStatus },
      metaDescription: { value: desc, length: descLen, status: descStatus },
      canonical,
      robots,
      viewport,
      og,
      twitter,
      hreflang,
      headings: {
        h1Count,
        hierarchy,
        issues: headingIssues,
        status: h1Count === 1 ? "pass" : h1Count === 0 ? "warn" : "fail",
      },
      images: {
        total: images.length,
        withAlt,
        withoutAlt,
        coverage,
        status: imgStatus,
      },
    };
  }

  // === Structured Data Extraction ===

  const SCHEMA_RULES = {
    Article: {
      required: ["headline", "author", "datePublished"],
      recommended: ["image", "publisher"],
    },
    NewsArticle: {
      required: ["headline", "datePublished"],
      recommended: ["author", "image", "publisher"],
    },
    BlogPosting: {
      required: ["headline", "author", "datePublished"],
      recommended: ["image"],
    },
    Product: {
      required: ["name"],
      recommended: ["image", "description", "offers"],
    },
    FAQPage: { required: ["mainEntity"], recommended: [] },
    BreadcrumbList: { required: ["itemListElement"], recommended: [] },
    Organization: { required: ["name"], recommended: ["url", "logo"] },
    LocalBusiness: {
      required: ["name", "address"],
      recommended: ["telephone", "openingHoursSpecification"],
    },
    Event: {
      required: ["name", "startDate"],
      recommended: ["location", "image"],
    },
    Person: { required: ["name"], recommended: ["jobTitle"] },
    WebSite: { required: ["name", "url"], recommended: ["potentialAction"] },
    Recipe: {
      required: ["name"],
      recommended: ["image", "recipeIngredient", "recipeInstructions"],
    },
    VideoObject: {
      required: ["name", "uploadDate"],
      recommended: ["description", "thumbnailUrl"],
    },
    HowTo: { required: ["name", "step"], recommended: ["image"] },
  };

  function validateSchemaType(type, data) {
    const rules = SCHEMA_RULES[type];
    if (!rules) return { errors: [], warnings: [] };
    const errors = rules.required
      .filter((prop) => !data[prop])
      .map((prop) => `Missing required: ${prop}`);
    const warnings = rules.recommended
      .filter((prop) => !data[prop])
      .map((prop) => `Missing recommended: ${prop}`);
    return { errors, warnings };
  }

  function extractJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    const results = [];
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data)
          ? data
          : data["@graph"]
            ? data["@graph"]
            : [data];
        for (const item of items) {
          const type = item["@type"] || "Unknown";
          const validation = validateSchemaType(type, item);
          results.push({
            raw: item,
            type,
            errors: validation.errors,
            warnings: validation.warnings,
          });
        }
      } catch (e) {
        results.push({
          raw: null,
          type: "ParseError",
          errors: [e.message],
          warnings: [],
        });
      }
    }
    return results;
  }

  function extractMicrodata() {
    const scopes = document.querySelectorAll("[itemscope]");
    return Array.from(scopes)
      .slice(0, 20)
      .map((scope) => {
        const type = scope.getAttribute("itemtype") || "";
        const shortType = type.split("/").pop() || type;
        const props = {};
        scope.querySelectorAll("[itemprop]").forEach((propEl) => {
          const name = propEl.getAttribute("itemprop");
          const value =
            propEl.getAttribute("content") ||
            propEl.textContent?.trim() ||
            propEl.getAttribute("href") ||
            "";
          props[name] = normalizeWhitespace(value).slice(0, 200);
        });
        return { type: shortType, fullType: type, properties: props };
      });
  }

  function extractRdfa() {
    const elements = document.querySelectorAll("[typeof]");
    return Array.from(elements)
      .slice(0, 20)
      .map((el) => {
        const type = el.getAttribute("typeof") || "";
        const about = el.getAttribute("about") || "";
        const props = {};
        el.querySelectorAll("[property]").forEach((propEl) => {
          const name = propEl.getAttribute("property") || "";
          const value =
            propEl.getAttribute("content") || propEl.textContent?.trim() || "";
          props[name] = normalizeWhitespace(value).slice(0, 200);
        });
        return { type, about, properties: props };
      });
  }

  function extractStructuredData() {
    const jsonLd = extractJsonLd();
    const microdata = extractMicrodata();
    const rdfa = extractRdfa();

    const allTypes = new Set();
    jsonLd.forEach((item) => allTypes.add(item.type));
    microdata.forEach((item) => allTypes.add(item.type));
    rdfa.forEach((item) => allTypes.add(item.type));

    let totalWarnings = 0;
    jsonLd.forEach((item) => {
      totalWarnings += item.errors.length + item.warnings.length;
    });

    return {
      jsonLd,
      microdata,
      rdfa,
      stats: {
        typesFound: allTypes.size,
        jsonLdCount: jsonLd.length,
        microdataCount: microdata.length,
        rdfaCount: rdfa.length,
        validationWarnings: totalWarnings,
      },
    };
  }

  // === Video Event Relay ===

  function toAbsoluteHttpUrl(value) {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const resolved = new URL(trimmed, window.location.href);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        return resolved.href;
      }
      return "";
    } catch {
      return "";
    }
  }

  function getPageThumbnailUrl() {
    const ogImage =
      document
        .querySelector('meta[property="og:image"], meta[name="twitter:image"]')
        ?.getAttribute("content") || "";
    const ogUrl = toAbsoluteHttpUrl(ogImage);
    if (ogUrl) {
      return ogUrl;
    }
    const videoPoster =
      document.querySelector("video[poster]")?.getAttribute("poster") || "";
    return toAbsoluteHttpUrl(videoPoster);
  }

  function normalizeVideoTitleCandidate(value) {
    if (typeof value !== "string") {
      return "";
    }
    const cleaned = value
      .replace(/\s+/g, " ")
      .replace(/^[\s"'\-:|]+|[\s"'\-:|]+$/g, "")
      .replace(
        /\s*[|•·-]\s*(tiktok|instagram|youtube|facebook|x|twitter).*$/i,
        "",
      )
      .trim();
    if (!cleaned) {
      return "";
    }
    if (/^(tiktok|instagram|youtube|video|watch)$/i.test(cleaned)) {
      return "";
    }
    return cleaned.slice(0, 120);
  }

  function deriveVideoTitleFromPageUrl() {
    try {
      const path = window.location.pathname || "";
      const tikTokMatch = path.match(/\/video\/(\d{8,})/);
      if (tikTokMatch) {
        return `tiktok_${tikTokMatch[1]}`;
      }
      const instaMatch = path.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,})/);
      if (instaMatch) {
        return `instagram_${instaMatch[1]}`;
      }
      const slug = path.split("/").filter(Boolean).pop() || "";
      if (slug && slug.length >= 5) {
        return slug.replace(/[_-]+/g, " ");
      }
    } catch {
      // Ignore URL parsing errors.
    }
    return "video";
  }

  function getPreferredVideoTitle() {
    const titleCandidates = [
      document.querySelector('[data-e2e="browse-video-desc"]')?.textContent ||
        "",
      document.querySelector('[data-e2e="video-desc"]')?.textContent || "",
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content") || "",
      document
        .querySelector('meta[name="twitter:title"]')
        ?.getAttribute("content") || "",
      document.querySelector("article h1")?.textContent || "",
      document.querySelector("h1")?.textContent || "",
      document.title || "",
    ];
    for (let i = 0; i < titleCandidates.length; i++) {
      const normalized = normalizeVideoTitleCandidate(titleCandidates[i]);
      if (normalized) {
        return normalized;
      }
    }
    return deriveVideoTitleFromPageUrl();
  }

  function getVideoElementFocusMetrics(videoEl, idx) {
    const rect = videoEl.getBoundingClientRect();
    const width = Math.max(0, rect.width || 0);
    const height = Math.max(0, rect.height || 0);
    const area = width * height;
    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
    );
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
    );
    const visibleArea = visibleWidth * visibleHeight;
    const visibleRatio = area > 0 ? Math.min(1, visibleArea / area) : 0;
    const isPlaying =
      !videoEl.paused &&
      !videoEl.ended &&
      videoEl.readyState >= 2 &&
      Number(videoEl.currentTime) > 0;
    const isVisible = visibleRatio >= 0.2 && width >= 140 && height >= 140;
    let score = 0;
    if (isPlaying) score += 6000;
    if (isVisible) score += 2200;
    score += Math.min(Math.floor(area / 120), 3000);
    score += Math.round(visibleRatio * 2200);
    if (idx === 0) score += 120;
    return {
      score,
      isPlaying,
      isVisible,
      visibleRatio: Math.round(visibleRatio * 1000) / 1000,
    };
  }

  function parseSrcsetUrls(srcsetValue) {
    if (typeof srcsetValue !== "string" || !srcsetValue.trim()) {
      return [];
    }
    return srcsetValue
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function parseCssImageUrls(value) {
    if (typeof value !== "string" || !value.includes("url(")) {
      return [];
    }
    const matches = [];
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let match = re.exec(value);
    while (match) {
      const raw = (match[2] || "").trim();
      if (raw && !raw.startsWith("data:")) {
        matches.push(raw);
      }
      match = re.exec(value);
    }
    return matches;
  }

  function normalizeImageFormat(url, contentType = "") {
    const type =
      typeof contentType === "string" ? contentType.toLowerCase() : "";
    if (type.includes("image/jpeg") || type.includes("image/jpg")) return "jpg";
    if (type.includes("image/png")) return "png";
    if (type.includes("image/webp")) return "webp";
    if (type.includes("image/gif")) return "gif";
    if (type.includes("image/svg")) return "svg";
    if (type.includes("image/avif")) return "avif";
    if (type.includes("image/bmp")) return "bmp";
    if (type.includes("image/tiff")) return "tiff";
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const ext = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "";
      if (ext === "jpeg") return "jpg";
      return ext;
    } catch {
      return "";
    }
  }

  function collectDomImageCandidates() {
    const candidates = [];
    const seen = new Set();
    const pageTitle = document.title || "image";
    const lazyAttrs = [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-lazyload",
      "data-image",
      "data-srcset",
      "data-bg",
      "data-background",
    ];

    function pushImage(url, options = {}) {
      const normalizedUrl = toAbsoluteHttpUrl(url);
      if (!normalizedUrl) {
        return;
      }
      const key = normalizedUrl;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const width = Number(options.width) || 0;
      const height = Number(options.height) || 0;
      const contentType =
        typeof options.contentType === "string"
          ? options.contentType.trim()
          : "";
      candidates.push({
        id: generateId(),
        url: normalizedUrl,
        fileName: options.fileName || pageTitle,
        source: options.source || "dom",
        width: width > 0 ? Math.floor(width) : null,
        height: height > 0 ? Math.floor(height) : null,
        altText:
          typeof options.altText === "string"
            ? normalizeWhitespace(options.altText)
            : "",
        titleText:
          typeof options.titleText === "string"
            ? normalizeWhitespace(options.titleText)
            : "",
        contentType,
        format: normalizeImageFormat(normalizedUrl, contentType),
        pageUrl: window.location.href,
      });
    }

    const imageNodes = Array.from(document.images || []).slice(0, 400);
    for (const image of imageNodes) {
      const width = Number(image.naturalWidth) || Number(image.width) || 0;
      const height = Number(image.naturalHeight) || Number(image.height) || 0;
      const altText = image.getAttribute("alt") || "";
      const titleText = image.getAttribute("title") || "";
      if (image.currentSrc) {
        pushImage(image.currentSrc, {
          source: "img-currentSrc",
          width,
          height,
          altText,
          titleText,
        });
      }
      if (image.src) {
        pushImage(image.src, {
          source: "img-src",
          width,
          height,
          altText,
          titleText,
        });
      }
      const srcsetValue = image.getAttribute("srcset") || "";
      const srcsetUrls = parseSrcsetUrls(srcsetValue);
      for (const srcsetUrl of srcsetUrls) {
        pushImage(srcsetUrl, {
          source: "img-srcset",
          width,
          height,
          altText,
          titleText,
        });
      }
    }

    const pictureSources = Array.from(
      document.querySelectorAll("picture source[srcset]"),
    ).slice(0, 300);
    for (const sourceEl of pictureSources) {
      const srcsetUrls = parseSrcsetUrls(sourceEl.getAttribute("srcset") || "");
      for (const srcsetUrl of srcsetUrls) {
        pushImage(srcsetUrl, {
          source: "picture-srcset",
          titleText: sourceEl.getAttribute("title") || "",
        });
      }
    }

    const lazyNodes = Array.from(
      document.querySelectorAll(
        "img, source, [data-src], [data-bg], [data-background]",
      ),
    ).slice(0, 500);
    for (const node of lazyNodes) {
      const width =
        Number(node.naturalWidth || node.width || node.clientWidth) || 0;
      const height =
        Number(node.naturalHeight || node.height || node.clientHeight) || 0;
      for (const attr of lazyAttrs) {
        const raw = node.getAttribute(attr) || "";
        if (!raw) {
          continue;
        }
        if (attr.includes("srcset")) {
          const srcsetUrls = parseSrcsetUrls(raw);
          for (const srcsetUrl of srcsetUrls) {
            pushImage(srcsetUrl, {
              source: `lazy-${attr}`,
              width,
              height,
              altText: node.getAttribute?.("alt") || "",
              titleText: node.getAttribute?.("title") || "",
            });
          }
        } else {
          pushImage(raw, {
            source: `lazy-${attr}`,
            width,
            height,
            altText: node.getAttribute?.("alt") || "",
            titleText: node.getAttribute?.("title") || "",
          });
        }
      }
    }

    const styleNodes = Array.from(
      document.querySelectorAll(
        '[style*="background"], [style*="background-image"]',
      ),
    ).slice(0, 500);
    for (const node of styleNodes) {
      const inlineStyle = node.getAttribute("style") || "";
      const cssUrls = parseCssImageUrls(inlineStyle);
      const rect = node.getBoundingClientRect();
      for (const cssUrl of cssUrls) {
        pushImage(cssUrl, {
          source: "style-background",
          width: rect.width,
          height: rect.height,
          titleText: node.getAttribute("title") || "",
        });
      }
    }

    const metaImageSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ];
    for (const selector of metaImageSelectors) {
      const value =
        document.querySelector(selector)?.getAttribute("content") || "";
      if (!value) {
        continue;
      }
      pushImage(value, {
        source: `meta-${selector}`,
      });
    }

    return candidates;
  }

  function scanDomForImagesAndRelay() {
    const images = collectDomImageCandidates();
    if (images.length) {
      chrome.runtime.sendMessage({
        message: "add-image-links",
        imageLinks: images,
      });
    }
    return images;
  }

  function collectDomVideoCandidates() {
    const candidates = [];
    const seen = new Set();
    const fallbackThumb = getPageThumbnailUrl();
    const pageTitle = getPreferredVideoTitle();
    const mediaPattern = /\.(m3u8|mpd|mp4|webm|m4v|mov|ts)(\?|$)/i;

    function addCandidate(url, options = {}) {
      const resolvedUrl = toAbsoluteHttpUrl(url);
      if (!resolvedUrl) {
        return;
      }
      // Accept URLs with video extensions OR any URL from a <video> element (options.fromVideoEl)
      if (!options.fromVideoEl && !mediaPattern.test(resolvedUrl)) {
        return;
      }
      const quality = options.quality || "N/A";
      const playlist =
        Boolean(options.playlist) || /\.(m3u8|mpd)(\?|$)/i.test(resolvedUrl);
      const key = `${resolvedUrl}|${quality}|${playlist ? "1" : "0"}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({
        url: resolvedUrl,
        quality,
        fileName: options.fileName || pageTitle,
        id: generateId(),
        playlist,
        thumbnailUrl: options.thumbnailUrl || fallbackThumb || "",
        source: options.source || "dom",
        pageUrl: window.location.href,
        hasAudio:
          options.hasAudio === true || options.hasAudio === false
            ? options.hasAudio
            : null,
        isPrimary: Boolean(options.isPrimary),
        matchesCurrentPage: Boolean(options.matchesCurrentPage),
        domScore: Number(options.domScore) || 0,
        isPlaying: Boolean(options.isPlaying),
        inViewport: Boolean(options.inViewport),
        visibleRatio:
          Number.isFinite(Number(options.visibleRatio)) &&
          Number(options.visibleRatio) > 0
            ? Math.min(1, Math.max(0, Number(options.visibleRatio)))
            : 0,
      });
    }

    const videoElements = Array.from(document.querySelectorAll("video")).slice(
      0,
      25,
    );
    const videoEntries = videoElements.map((videoEl, idx) => ({
      videoEl,
      idx,
      metrics: getVideoElementFocusMetrics(videoEl, idx),
    }));
    videoEntries.sort((a, b) => b.metrics.score - a.metrics.score);
    const primaryVideoElement = videoEntries[0]?.videoEl || null;

    for (let idx = 0; idx < videoEntries.length; idx++) {
      const entry = videoEntries[idx];
      const videoEl = entry.videoEl;
      const quality =
        Number(videoEl.videoHeight) > 0 ? `${videoEl.videoHeight}p` : "N/A";
      const poster = toAbsoluteHttpUrl(videoEl.poster || "");
      const hasAudioTrack =
        Number(videoEl.mozHasAudio) > 0 ||
        Boolean(videoEl.webkitAudioDecodedByteCount > 0) ||
        Boolean(videoEl.audioTracks && videoEl.audioTracks.length > 0);
      const isPrimary =
        videoEl === primaryVideoElement ||
        (entry.metrics.isPlaying && entry.metrics.isVisible);
      if (videoEl.currentSrc) {
        addCandidate(videoEl.currentSrc, {
          quality,
          fileName: pageTitle,
          thumbnailUrl: poster,
          hasAudio: hasAudioTrack,
          isPrimary,
          matchesCurrentPage: true,
          domScore: entry.metrics.score,
          isPlaying: entry.metrics.isPlaying,
          inViewport: entry.metrics.isVisible,
          visibleRatio: entry.metrics.visibleRatio,
          fromVideoEl: true,
        });
      }
      if (videoEl.src) {
        addCandidate(videoEl.src, {
          quality,
          fileName: pageTitle,
          thumbnailUrl: poster,
          hasAudio: hasAudioTrack,
          isPrimary,
          matchesCurrentPage: true,
          domScore: entry.metrics.score,
          isPlaying: entry.metrics.isPlaying,
          inViewport: entry.metrics.isVisible,
          visibleRatio: entry.metrics.visibleRatio,
          fromVideoEl: true,
        });
      }
      const sourceNodes = Array.from(
        videoEl.querySelectorAll("source[src]"),
      ).slice(0, 12);
      for (const sourceEl of sourceNodes) {
        addCandidate(sourceEl.src || sourceEl.getAttribute("src") || "", {
          quality,
          fileName: pageTitle,
          thumbnailUrl: poster,
          hasAudio: hasAudioTrack,
          isPrimary,
          matchesCurrentPage: true,
          domScore: entry.metrics.score,
          isPlaying: entry.metrics.isPlaying,
          inViewport: entry.metrics.isVisible,
          visibleRatio: entry.metrics.visibleRatio,
          fromVideoEl: true,
        });
      }
    }

    return candidates;
  }

  function scanDomForVideosAndRelay() {
    const candidates = collectDomVideoCandidates();
    if (candidates.length) {
      chrome.runtime.sendMessage({
        message: "add-video-links",
        videoLinks: candidates,
      });
    }
    return candidates.length;
  }

  window.addEventListener("videos-found", (event) => {
    if (!event.detail || !event.detail.length) return;
    const videoLinks = [];
    const fallbackThumbnail = getPageThumbnailUrl();
    const fallbackTitle = getPreferredVideoTitle();
    for (let i = 0; i < event.detail.length; i++) {
      const item = event.detail[i];
      if (Array.isArray(item)) {
        for (let j = 0; j < item.length; j++) {
          const v = item[j];
          const normalizedUrl = toAbsoluteHttpUrl(v.url);
          if (!normalizedUrl) continue;
          videoLinks.push({
            url: normalizedUrl,
            quality: v.quality || "N/A",
            fileName: v.title || v.fileName || fallbackTitle,
            id: v.id || generateId(),
            playlist: v.playlist || false,
            thumbnailUrl:
              toAbsoluteHttpUrl(v.thumbnailUrl || v.thumbnail || "") ||
              fallbackThumbnail ||
              "",
            sizeBytes:
              Number(v.sizeBytes || v.contentLength || v.filesize) || null,
            contentType: typeof v.contentType === "string" ? v.contentType : "",
            source: typeof v.source === "string" ? v.source : "",
            pageUrl: toAbsoluteHttpUrl(v.pageUrl || "") || window.location.href,
            hasAudio:
              v.hasAudio === true || v.hasAudio === false ? v.hasAudio : null,
            requiresMux: Boolean(v.requiresMux),
            audioUrl: toAbsoluteHttpUrl(v.audioUrl || ""),
            audioExt: typeof v.audioExt === "string" ? v.audioExt : "",
            mp3Available: Boolean(v.mp3Available),
            isPrimary: Boolean(v.isPrimary),
            awemeId: typeof v.awemeId === "string" ? v.awemeId : "",
            matchesCurrentPage: Boolean(v.matchesCurrentPage),
            domScore: Number(v.domScore) || 0,
            isPlaying: Boolean(v.isPlaying),
            inViewport: Boolean(v.inViewport),
            visibleRatio:
              Number.isFinite(Number(v.visibleRatio)) &&
              Number(v.visibleRatio) > 0
                ? Math.min(1, Math.max(0, Number(v.visibleRatio)))
                : 0,
          });
        }
      } else {
        const normalizedUrl = toAbsoluteHttpUrl(item.url);
        if (!normalizedUrl) continue;
        videoLinks.push({
          url: normalizedUrl,
          quality: item.quality || "N/A",
          fileName: item.title || item.fileName || fallbackTitle,
          id: item.id || generateId(),
          playlist: item.playlist || false,
          thumbnailUrl:
            toAbsoluteHttpUrl(item.thumbnailUrl || item.thumbnail || "") ||
            fallbackThumbnail ||
            "",
          sizeBytes:
            Number(item.sizeBytes || item.contentLength || item.filesize) ||
            null,
          contentType:
            typeof item.contentType === "string" ? item.contentType : "",
          source: typeof item.source === "string" ? item.source : "",
          pageUrl:
            toAbsoluteHttpUrl(item.pageUrl || "") || window.location.href,
          hasAudio:
            item.hasAudio === true || item.hasAudio === false
              ? item.hasAudio
              : null,
          requiresMux: Boolean(item.requiresMux),
          audioUrl: toAbsoluteHttpUrl(item.audioUrl || ""),
          audioExt: typeof item.audioExt === "string" ? item.audioExt : "",
          mp3Available: Boolean(item.mp3Available),
          isPrimary: Boolean(item.isPrimary),
          awemeId: typeof item.awemeId === "string" ? item.awemeId : "",
          matchesCurrentPage: Boolean(item.matchesCurrentPage),
          domScore: Number(item.domScore) || 0,
          isPlaying: Boolean(item.isPlaying),
          inViewport: Boolean(item.inViewport),
          visibleRatio:
            Number.isFinite(Number(item.visibleRatio)) &&
            Number(item.visibleRatio) > 0
              ? Math.min(1, Math.max(0, Number(item.visibleRatio)))
              : 0,
        });
      }
    }
    if (videoLinks.length) {
      chrome.runtime.sendMessage({ message: "add-video-links", videoLinks });
    }
  });

  // === Message Handler ===

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (sender && sender.id && sender.id !== chrome.runtime.id) {
      return;
    }

    if (message.type === "GET_SEO_META") {
      sendResponse({ ok: true, data: extractSeoMeta() });
      return;
    }

    if (message.type === "GET_STRUCTURED_DATA") {
      sendResponse({ ok: true, data: extractStructuredData() });
      return;
    }

    if (message.type === "GET_AI_CONTEXT") {
      (async () => {
        const maxContextChars = Number(message.maxContextChars);
        const contextPayload = await buildContextPayload({
          maxContextChars: Number.isFinite(maxContextChars)
            ? Math.min(140000, Math.max(6000, Math.floor(maxContextChars)))
            : CONTEXT_FULL_TEXT_LIMIT,
          autoScroll: true,
        });
        const lowSignal =
          (Number(contextPayload.sourceTextChars) || 0) < 80 ||
          (Number(contextPayload.relevantCount) || 0) === 0;
        if (window === window.top && lowSignal) {
          await sleep(
            isLikelyInstagramShellFrameUrl()
              ? CONTEXT_TOP_FRAME_SHELL_DELAY_MS
              : CONTEXT_TOP_FRAME_LOW_SIGNAL_DELAY_MS,
          );
        }
        if (lowSignal && window !== window.top) {
          return;
        }
        sendResponse({
          ok: true,
          format: "ai-context-markdown",
          ...contextPayload,
        });
      })().catch((error) => {
        sendResponse({
          ok: false,
          error:
            error && typeof error.message === "string"
              ? error.message
              : "Context extraction failed.",
        });
      });
      return true;
    }

    if (message.type === "SCAN_PAGE_VIDEOS") {
      const count = scanDomForVideosAndRelay();
      sendResponse({ ok: true, count });
      return;
    }

    if (message.type === "GET_PAGE_THUMBNAIL") {
      sendResponse({
        ok: true,
        thumbnailUrl: getPageThumbnailUrl() || "",
        pageUrl: window.location.href,
      });
      return;
    }

    if (message.type === "GET_PAGE_IMAGES") {
      const images = collectDomImageCandidates();
      sendResponse({ ok: true, images, count: images.length });
      return;
    }

    if (message.type === "SCAN_PAGE_IMAGES") {
      const images = scanDomForImagesAndRelay();
      sendResponse({ ok: true, images, count: images.length });
      return;
    }

    const requestedLevelPreset =
      typeof message.levelPreset === "string" ? message.levelPreset : "full";
    const levelPreset = ["errors", "warnings", "full"].includes(
      requestedLevelPreset,
    )
      ? requestedLevelPreset
      : "full";
    const maxEntries = Number(message.maxEntries);
    const maxCharsPerEntry = Number(message.maxCharsPerEntry);
    const maxStackLines = Number(message.maxStackLines);
    const commonOptions = {
      levelPreset,
      maxEntries: Number.isFinite(maxEntries) ? maxEntries : logs.length,
      maxCharsPerEntry: Number.isFinite(maxCharsPerEntry)
        ? maxCharsPerEntry
        : 700,
      maxStackLines: Number.isFinite(maxStackLines) ? maxStackLines : 6,
    };

    if (message.type !== "GET_CAPTURED_CONSOLE") {
      return;
    }

    const requestedFormat =
      typeof message.format === "string" ? message.format : "ai";
    const format = ["ai", "xml", "plain"].includes(requestedFormat)
      ? requestedFormat
      : "ai";

    const options = {
      format,
      ...commonOptions,
      optimizeForAi: message.optimizeForAi !== false,
    };

    const report = buildReportText(options);

    sendResponse({
      ok: true,
      totalCaptured: report.totalCaptured,
      count: report.totalCount,
      uniqueCount: report.uniqueCount,
      levelCounts: report.levelCounts,
      format,
      levelPreset,
      estimatedTokens: report.estimatedTokens,
      pageUrl: window.location.href,
      text: report.text,
    });
  });

  // === Initialize ===

  setTimeout(() => {
    try {
      scanDomForVideosAndRelay();
    } catch {
      // Ignore scan errors.
    }
  }, 700);
})();
