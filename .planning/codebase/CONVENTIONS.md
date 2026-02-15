# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- kebab-case filenames: `background.js`, `content-script.js`, `page-logger.js`, `ai-providers.js`
- Extensions: JavaScript uses `.js` exclusively
- UI files: HTML (`popup.html`), CSS (`popup.css`), JS (`popup.js`)

**Functions:**
- camelCase for all function names: `generateId()`, `getTabVideos()`, `addVideoLinks()`, `normalizeWhitespace()`
- Private/internal functions: No prefix convention, but functions used within closures (e.g., `stringifyArg`, `compressStack`)
- Exported functions (ES modules): Explicitly marked with `export` keyword

**Variables:**
- camelCase for all variable names: `tabVideoData`, `currentProvider`, `logs`, `statusEl`
- Constants: UPPER_CASE only for true constants defined at module level (e.g., `LOG_LIMIT`, `EVENT_NAME`, `CONTEXT_MAX_TEXT_CHARS`)
- DOM elements: Typically suffixed with `El` (e.g., `statusEl`, `aiStatusEl`, `previewTextEl`, `videoListEl`)
- Configuration objects: camelCase with descriptive names (e.g., `DEFAULT_SETTINGS`, `AI_PROVIDERS`)

**Types/Modules:**
- Constructor/config objects use object literal syntax with no class declarations
- Configuration exported as objects: `export const AI_PROVIDERS = { ... }`
- Storage key constants: `PROVIDER_STORAGE_KEYS`, `SETTINGS_KEY`

## Code Style

**Formatting:**
- No formatter/linter configuration detected (no `.eslintrc`, `.prettierrc`, or `package.json`)
- Manual formatting observed across all files
- Consistent 2-space indentation throughout
- Single quotes for strings (occasional template literals for multi-line or interpolation)
- Semicolons used consistently

**Linting:**
- No automated linting tools configured
- Code style follows patterns established within source files

**Line Length:**
- Lines vary widely; some exceed 120 characters
- No strict line length limit enforced

## Import Organization

**Order:**
1. ES module imports at file top (if module uses ES6 imports)
   - Example: `import { AI_PROVIDERS, PROVIDER_STORAGE_KEYS, buildFetchOptions, parseAiResponse } from './lib/ai-providers.js';`

2. Constants and configuration objects
   - Example: `const CATEGORIES = { ... };`

3. Function declarations and utilities

4. DOM references (for UI files like popup.js)

5. Event listeners and initialization code at end

**Path Aliases:**
- Not used; absolute relative paths: `'./lib/ai-providers.js'`
- Background worker uses ES modules: `import { ... } from './lib/ai-providers.js';`

## Error Handling

**Patterns:**

1. **Explicit error throwing with descriptive messages:**
   ```javascript
   if (!config) throw new Error(`Unknown provider: ${provider}`);
   if (!normalizedKey) throw new Error('API key is empty.');
   if (!AI_PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
   ```

2. **Try-catch with inline comment dismissal (parser functions):**
   ```javascript
   try {
     const data = JSON.parse(responseText);
     // ... parsing logic
   } catch (e) { /* ignore parse errors */ }
   ```
   - Used extensively in `watcher.js` for site-specific parsers where parse failures are expected and acceptable

3. **Try-catch with error re-throw for critical operations:**
   ```javascript
   try {
     // ... operation
   } catch (error) {
     if (!isNoReceiverError(error)) {
       throw error;  // Re-throw if not a known error type
     }
   }
   ```

4. **Async error handling within message handlers:**
   ```javascript
   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
     (async () => {
       try {
         // ... handler logic
       } catch (error) {
         sendResponse({
           ok: false,
           error: error instanceof Error ? error.message : 'Unknown background error',
         });
       }
     })();
     return true;
   });
   ```

5. **Fetch response validation:**
   ```javascript
   const response = await fetch(endpoint, { ... });
   const rawText = await response.text();
   if (!response.ok) {
     let errorReason = `${response.status} ${response.statusText}`;
     try {
       const parsed = JSON.parse(rawText);
       errorReason = parsed.error?.message || parsed.message || errorReason;
     } catch (error) { /* ... */ }
     throw new Error(`${providerLabel} request failed: ${errorReason}`);
   }
   ```

**Return Values on Error:**
- Functions throw `Error` with descriptive messages
- Silent failures (caught and ignored) used only in speculative parsers

## Logging

**Framework:** No logging library; console methods not used in production code

**Patterns:**
- Console calls captured via `page-logger.js` (method wrapping): `console.log()`, `console.warn()`, `console.error()`, etc.
- No direct console logging in extension code itself

## Comments

**When to Comment:**
- Section headers with `===` markers for organizational blocks:
  ```javascript
  // === Video Link Storage (per tab) ===
  // === AI Config Helpers ===
  // === Message Handler ===
  ```
- Parser-specific comments explaining domain logic:
  ```javascript
  // --- Instagram Parser ---
  // --- Vimeo Parser ---
  ```
- Inline comments for error suppression in parsers:
  ```javascript
  } catch (e) { /* ignore parse errors */ }
  ```

**JSDoc/TSDoc:**
- Not used; no type annotations or formal documentation blocks

## Function Design

**Size:**
- Functions range from 5 lines (utility helpers) to 200+ lines (data processors like `extractPageContext()`)
- No strict maximum enforced
- Larger functions (`popup.js` event handlers) tend to be procedural with nested logic

**Parameters:**
- Destructured object parameters for configuration-heavy functions:
  ```javascript
  export function buildFetchOptions({
    provider,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    baseUrl,
    temperature = 0.2,
    maxTokens = 900,
  }) { ... }
  ```
- Individual parameters for simple utilities:
  ```javascript
  function trimToMaxChars(text, maxChars) { ... }
  ```

**Return Values:**
- Explicit returns; no implicit undefined
- Objects returned for multi-value results:
  ```javascript
  return {
    summary,
    usage: usage || null,
    model: respModel || model,
  };
  ```
- Arrays for collections:
  ```javascript
  return entries;  // array of deduped log entries
  ```

## Module Design

**Exports:**
- ES modules via `export const` and `export function`:
  ```javascript
  export const AI_PROVIDERS = { ... };
  export const PROVIDER_STORAGE_KEYS = { ... };
  export function buildFetchOptions({ ... }) { ... }
  export function parseAiResponse(provider, parsed) { ... }
  ```

**Barrel Files:**
- Not used; single exports from `lib/ai-providers.js`
- Direct imports: `import { AI_PROVIDERS, ... } from './lib/ai-providers.js';`

**Dependency Injection:**
- Configuration passed via objects/parameters rather than globals
- Chrome API accessed directly (`chrome.runtime`, `chrome.storage`, `chrome.downloads`, etc.)

**Namespace/Modules:**
- IIFEs (Immediately Invoked Function Expressions) used for isolation:
  ```javascript
  (() => {
    // content-script.js wraps all code
    // page-logger.js wraps all code
    // watcher.js wraps all code
  })();
  ```
- Prevents global namespace pollution; all logic contained

## Type Safety

**No Type System:**
- Vanilla JavaScript; no TypeScript
- Type validation done manually via `typeof` checks:
  ```javascript
  if (typeof text !== 'string') { return ''; }
  if (typeof value === 'string') { ... }
  ```

## Data Structures

**Configuration Objects:**
```javascript
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
```

**Message Format (Chrome Runtime):**
```javascript
{
  type: 'MESSAGE_TYPE',
  tabId: number,
  // ... payload properties
}
```

**Log Entry Format:**
```javascript
{
  timestamp: string,  // ISO 8601
  level: string,      // 'log', 'warn', 'error', etc.
  source: string,     // 'console', 'window.error', etc.
  message: string,
  count: number,      // for deduped entries
  lastTimestamp: string,
}
```

---

*Convention analysis: 2026-02-15*
