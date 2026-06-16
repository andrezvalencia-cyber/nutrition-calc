// Precache-parity oracle: asserts that every same-origin <script defer src="src/...">
// and <link rel="stylesheet" href="..."> in index.html appears in sw.js PRECACHE_URLS,
// and vice-versa (no stale entries). Pure Node — no browser required.
// Run via: node tests/precache-parity.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (err) {
    failed++;
    console.error("  FAIL " + name);
    console.error("       " + (err.stack || err.message));
  }
}

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const swJs = fs.readFileSync(path.join(root, "sw.js"), "utf8");

// Extract same-origin script[defer][src^="src/"] hrefs from index.html
const scriptRe = /<script\b[^>]*\bdefer\b[^>]*\bsrc="(src\/[^"]+)"[^>]*>/gi;
const htmlScripts = [];
let m;
while ((m = scriptRe.exec(indexHtml)) !== null) {
  htmlScripts.push("/" + m[1]);
}

// Extract <link rel="stylesheet" href="..."> (same-origin only — no https://)
const linkRe = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"h][^"]*)"[^>]*>/gi;
const htmlStyles = [];
while ((m = linkRe.exec(indexHtml)) !== null) {
  htmlStyles.push("/" + m[1]);
}

// Also capture non-defer local scripts (local-store, data.js, app.js)
const localScriptRe = /<script\b[^>]*\bsrc="((?!https?:\/\/)[^"]+)"[^>]*>/gi;
const allLocalScripts = [];
while ((m = localScriptRe.exec(indexHtml)) !== null) {
  allLocalScripts.push("/" + m[1]);
}

const htmlAssets = new Set([...htmlScripts, ...htmlStyles]);
const allHtmlAssets = new Set([...allLocalScripts, ...htmlStyles]);

// Extract PRECACHE_URLS array entries from sw.js
const precacheBlock = swJs.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
assert.ok(precacheBlock, "Could not find PRECACHE_URLS in sw.js");
const urlRe = /"(\/[^"]+)"/g;
const precacheUrls = [];
while ((m = urlRe.exec(precacheBlock[1])) !== null) {
  precacheUrls.push(m[1]);
}
const precacheSet = new Set(precacheUrls);

// Filter to src/ paths for the forward check (html→sw)
const precacheSrcPaths = precacheUrls.filter(function (u) { return u.startsWith("/src/"); });

// ── Forward: every same-origin asset in index.html must be in PRECACHE_URLS ──

test("every defer script in index.html is in sw.js PRECACHE_URLS", () => {
  const missing = htmlScripts.filter(function (s) { return !precacheSet.has(s); });
  assert.deepEqual(missing, [],
    "Scripts in index.html but missing from PRECACHE_URLS: " + missing.join(", "));
});

test("every local stylesheet in index.html is in sw.js PRECACHE_URLS", () => {
  const missing = htmlStyles.filter(function (s) { return !precacheSet.has(s); });
  assert.deepEqual(missing, [],
    "Stylesheets in index.html but missing from PRECACHE_URLS: " + missing.join(", "));
});

// ── Reverse: every /src/ path in PRECACHE_URLS must be in index.html ──

test("every /src/ path in PRECACHE_URLS has a matching script tag in index.html", () => {
  const stale = precacheSrcPaths.filter(function (u) { return !allHtmlAssets.has(u); });
  assert.deepEqual(stale, [],
    "Paths in PRECACHE_URLS but missing from index.html: " + stale.join(", "));
});

// ── Sanity: both lists are non-empty ──

test("index.html has at least 5 same-origin defer scripts", () => {
  assert.ok(htmlScripts.length >= 5,
    "Expected ≥5 defer scripts, got " + htmlScripts.length);
});

test("PRECACHE_URLS has at least 5 /src/ entries", () => {
  assert.ok(precacheSrcPaths.length >= 5,
    "Expected ≥5 /src/ entries in PRECACHE_URLS, got " + precacheSrcPaths.length);
});

// --- Summary ---
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
