# Security Audit Report - LighthouseMap

**Date:** 2026-03-09
**Scope:** Full project security scan
**Auditor:** Automated scan + manual code review

---

## Summary

| Category | Status | Severity |
|----------|--------|----------|
| XSS / DOM Injection | PASS | -- |
| Hardcoded Secrets | PASS | -- |
| Data File Injection | PASS | -- |
| CDN Security (HTTPS + Versions) | PASS (pinned versions, HTTPS) | -- |
| CDN Security (SRI Hashes) | PARTIAL FIX | MEDIUM |
| Content Security Policy | ADVISORY | LOW |
| eval() / Function() | PASS | -- |
| External Resource Legitimacy | PASS | -- |
| Tooltip HTML Escaping | PASS | -- |

**Overall: No HIGH severity issues found. One MEDIUM issue partially remediated.**

---

## Detailed Findings

### 1. XSS / innerHTML Usage

**Files examined:** `js/tooltip.js`, `js/main.js`, `js/lightRenderer.js`, `js/lightPatterns.js`

**Finding: PASS - No XSS vulnerabilities detected.**

Two `innerHTML` usages found in `js/tooltip.js`:

- **Line 76:** `el.innerHTML = html;` -- Sets tooltip content. All user-controllable data flows through `escapeHTML()` before being interpolated into the HTML string:
  - `name` (line 55): escaped via `escapeHTML(name)`
  - `characteristic` (line 60): escaped via `escapeHTML(characteristic)`
  - `range` and `height` (lines 66, 69): numeric values coerced via `parseFloat()` in `main.js` -- cannot contain HTML
  - `colorCSS` (line 54): sourced from hardcoded `COLOR_CSS` lookup table -- not user-controllable
  - `lat`/`lon` (line 72): formatted via `formatCoord()` which uses `Math.abs().toFixed()` -- produces only numeric strings

- **Line 145:** `return div.innerHTML;` -- This is the *output* of the `escapeHTML()` function itself. Uses the standard DOM-based escaping pattern (`div.textContent = str; return div.innerHTML`). This is a well-known safe approach.

All other DOM updates in `main.js` use `.textContent` (lines 129, 140, 195, 259), which is inherently safe against XSS.

**No `document.write()`, `outerHTML`, or `insertAdjacentHTML()` usage detected anywhere.**

---

### 2. Hardcoded API Keys, Tokens, or Secrets

**Finding: PASS - No secrets detected.**

Searched all `.js`, `.html`, and `.json` files for patterns: `api_key`, `apikey`, `secret`, `token`, `password`, `credential`.

No matches found. No `.env` files present in the project.

The Overpass API (`scripts/fetch-overpass.js`) uses a public API endpoint (`https://overpass-api.de/api/interpreter`) that requires no authentication.

---

### 3. Data File Injection Vectors

**Finding: PASS - No injection vectors detected.**

Scanned all JSON data files in `data/` for:
- `<script>` tags
- `javascript:` URIs
- `onerror=` / `onload=` event handlers
- `<iframe>`, `<object>`, `<embed>` tags

No matches found.

Additionally, `scripts/process-data.js` includes built-in security defenses:
- **Lines 176-191:** Pre-processing security scan checks raw data for `<script>`, `javascript:`, `<iframe>`, `<object>`, `<embed>` patterns and aborts if found
- **Lines 238-251:** All string fields in output are sanitized by stripping HTML tags via `replace(/<[^>]*>/g, '')`
- **Lines 314-321:** Output JSON validation ensures well-formed output
- **Lines 323-328:** File size sanity check (rejects >100MB output)

---

### 4. CDN Links - HTTPS and Version Pinning

**Finding: PASS - All CDN resources use HTTPS and pinned versions.**

| Resource | URL | HTTPS | Version Pinned |
|----------|-----|-------|----------------|
| MapLibre GL CSS | `https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css` | Yes | Yes (`@4.7.1`) |
| MapLibre GL JS | `https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js` | Yes | Yes (`@4.7.1`) |
| CARTO Basemap | `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` | Yes | N/A (tile service) |

No `@latest`, `@next`, or `@canary` version tags detected. No `http://` URLs used for any external resources (the only `http://` reference is a `data:` URI for the favicon SVG, which is safe).

---

### 5. Subresource Integrity (SRI) for CDN Resources

**Finding: MEDIUM - SRI hashes missing, partially remediated.**

The MapLibre GL JS and CSS are loaded from `unpkg.com` without `integrity` attributes. If the CDN were compromised, a supply-chain attack could inject malicious code.

**Remediation applied:**
- Added `crossorigin="anonymous"` to both the `<link>` and `<script>` tags in `index.html`
- Added a TODO comment with instructions for generating and adding SRI `integrity` hashes

**Remaining action for developer:**
Generate SRI hashes and add them. Run:
```bash
curl -s https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -s https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css | openssl dgst -sha384 -binary | openssl base64 -A
```
Then add `integrity="sha384-<hash>"` to each tag.

---

### 6. Content Security Policy (CSP)

**Finding: LOW - No CSP meta tag or headers configured.**

The application does not define a Content-Security-Policy. For a static file served locally or via a simple HTTP server, this is typical. However, if deployed to production, a CSP would harden against injection attacks.

**Recommended CSP (add to `<head>` in `index.html` if deploying to production):**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://unpkg.com;
  style-src 'self' https://unpkg.com 'unsafe-inline';
  img-src 'self' data: https://*.basemaps.cartocdn.com https://*.carto.com;
  connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
">
```

Note: `'unsafe-inline'` is needed for styles because MapLibre GL JS applies inline styles to map elements. This is a known limitation of CSP with mapping libraries.

---

### 7. eval() / Function() Usage

**Finding: PASS - No unsafe eval detected.**

Searched all JS files for `eval(`, `new Function(`. No matches found. The codebase does not use any dynamic code execution.

---

### 8. External Resource Legitimacy

**Finding: PASS - All external resources are legitimate.**

| Resource | Domain | Purpose | Legitimate |
|----------|--------|---------|------------|
| MapLibre GL JS | `unpkg.com` | Map rendering library | Yes - official CDN for npm packages |
| CARTO Basemap | `basemaps.cartocdn.com` | Dark map tile style | Yes - official CARTO CDN |
| Overpass API | `overpass-api.de` | OSM data fetching (build-time only) | Yes - official Overpass API |
| OpenStreetMap | `openstreetmap.org` | Attribution link only | Yes - official OSM |
| CARTO | `carto.com` | Attribution link only | Yes - official CARTO |

All external links in attribution use `target="_blank" rel="noopener"`, preventing reverse tabnapping.

---

### 9. Tooltip HTML Content Escaping

**Finding: PASS - Properly escaped.**

As detailed in Section 1, the `escapeHTML()` function in `tooltip.js` (lines 142-146) uses the standard DOM-based approach:
```javascript
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
```

This correctly escapes `<`, `>`, `&`, `"` and other HTML-significant characters. All user-derived string data (`name`, `characteristic`) passes through this function before being inserted into the tooltip HTML.

---

## Additional Observations

### Positive Security Practices Already in Place

1. **IIFE pattern:** `main.js` wraps all code in an IIFE with `'use strict'`, preventing global scope pollution
2. **Module pattern:** `LightPatterns`, `LightRenderer`, and `Tooltip` use revealing module pattern, minimizing exposed API surface
3. **Input validation:** `process-data.js` validates JSON output, checks file sizes, and scans for injection patterns
4. **Safe DOM updates:** `main.js` consistently uses `.textContent` for DOM text updates
5. **No dependencies:** No `node_modules` or third-party npm dependencies (only MapLibre via CDN), reducing supply-chain attack surface
6. **Data coercion:** All numeric fields use `parseFloat()` / `parseInt()` which safely return `NaN` for non-numeric input

### Minor Recommendations (Informational)

1. **Debug exports:** `window.LighthouseMap` (main.js line 335) exposes internal state for debugging. Consider removing or gating behind a debug flag for production deployment.
2. **Error messages:** The data load failure message (main.js line 141) reveals internal file paths (`data/ folder`). This is harmless for a local tool but worth noting if deployed publicly.

---

## Files Reviewed

| File | Lines | Status |
|------|-------|--------|
| `index.html` | 63 | Reviewed + Fixed |
| `js/main.js` | 341 | Reviewed |
| `js/tooltip.js` | 149 | Reviewed |
| `js/lightRenderer.js` | 137 | Reviewed |
| `js/lightPatterns.js` | 259 | Reviewed |
| `scripts/process-data.js` | 331 | Reviewed |
| `scripts/fetch-overpass.js` | 132 | Reviewed |
| `css/style.css` | 240 | Reviewed |
| `package.json` | 11 | Reviewed |
| `data/*.json` | (scanned) | Scanned for injection |

---

## Changes Made

1. **`index.html`:** Added `crossorigin="anonymous"` to MapLibre CDN `<link>` and `<script>` tags, plus a TODO comment for adding SRI integrity hashes.

No other code changes were required -- no HIGH severity issues were found.
