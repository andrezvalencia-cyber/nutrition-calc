// Vitality v2 — Service Worker (Phase 7).
// Cache-first app shell with versioned cache name. Activate handler
// evicts every cache whose name does not match the current build, which
// also folds in the legacy nutri-calc-v1 cleanup that sw-cleanup.js used
// to perform on every page load.
//
// __BUILD_HASH__ is replaced at build time by scripts/stamp-build-hash.mjs.
// In local dev (no stamp step), the literal placeholder is used as the
// cache suffix — every reload reuses the same cache name, which is fine.

const BUILD_HASH = "__BUILD_HASH__";
const SHELL_CACHE = "vitality-v2-shell-" + BUILD_HASH;
const RUNTIME_CACHE = "vitality-v2-runtime-" + BUILD_HASH;

// Mirrors the <script>/<link> tags in index.html. If you add a new
// runtime asset there, add it here too — the SW will not serve it
// offline otherwise. (See CLAUDE.md §10 — pre-cache invariant.)
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.js",
  "/data.js",
  "/styles.css",
  "/tailwind-out.css",
  "/src/store/local-store.js",
  "/src/store/supabase-config.js",
  "/src/store/remote-store.js",
  "/src/store/write-behind.js",
  "/src/store/sync-leader.js",
  "/src/modules/catalog/ingredients.js",
  "/src/modules/recipes/recipes.js",
  "/src/modules/log/day-log.js",
  "/src/modules/log/gap-engine.js",
  "/src/modules/carryover/carryover-engine.js",
  "/src/modules/history/day-history.js",
  "/src/modules/insights/insights-engine.js",
  "/src/modules/observability/tracer.js",
  "/src/modules/identity/auth.js",
  // External CDN bundles are NOT eagerly pre-cached here.
  // They are served cache-first by the unpkg fetch rule on first access,
  // which avoids fetching ~3 MB during SW install on every new build hash.
];

const KEEP_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Use individual add() so one failed CDN URL doesn't poison the install.
    await Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (KEEP_CACHES.has(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isPrecached(url) {
  if (isSameOrigin(url)) {
    return PRECACHE_URLS.includes(url.pathname);
  }
  return PRECACHE_URLS.includes(url.href);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => hit);
  return hit || fetchPromise;
}

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  let timer;
  const network = fetch(request).then((res) => {
    if (res && res.ok && request.method === "GET") {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  });
  try {
    if (timeoutMs && timeoutMs > 0) {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("net-timeout")), timeoutMs);
      });
      const res = await Promise.race([network, timeout]);
      clearTimeout(timer);
      return res;
    }
    return await network;
  } catch (e) {
    clearTimeout(timer);
    // Cache fallback. Note: POST requests are not cacheable per Cache API
    // semantics, so this branch only ever returns hits for GETs. For the
    // Anthropic POST endpoint, this effectively degrades to network-only.
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return; // bypass SW for POST/PUT/DELETE

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Same-origin navigation → SWR for the HTML shell.
  if (request.mode === "navigate" && isSameOrigin(url)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Same-origin precached asset → cache-first.
  if (isSameOrigin(url) && isPrecached(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Supabase data plane → network-first with 3 s timeout, cache fallback.
  if (/(^|\.)supabase\.co$/i.test(url.hostname)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, 3000));
    return;
  }

  // Anthropic API → network-first with cache fallback. POSTs are bypassed
  // above; this only matches the rare GET (e.g., model list pings) but
  // keeps the rule symmetric and intent-clear.
  if (url.hostname === "api.anthropic.com") {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, 0));
    return;
  }

  // Google Fonts CSS + woff2 → cache-first (long-lived, keyed by URL).
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // unpkg CDN (SRI-pinned) → cache-first; URLs are immutable.
  if (url.hostname === "unpkg.com") {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Anything else → network-only (default browser behaviour).
});
