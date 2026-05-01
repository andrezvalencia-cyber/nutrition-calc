// Vitality v2 — Service Worker (Phase 7).
// Cache-first app shell with versioned cache name. Activate handler
// evicts every cache whose name does not match the current build, which
// also folds in the legacy nutri-calc-v1 cleanup that sw-cleanup.js used
// to perform on every page load.
//
// __BUILD_HASH__ is replaced at build time by scripts/stamp-build-hash.mjs.
// In local dev (no stamp step), the literal placeholder is used as the
// cache suffix — every reload reuses the same cache name, which is fine.
//
// ES5-compatible: hand-written (not Babel-compiled). Targets iOS Safari 12+.

var BUILD_HASH = "__BUILD_HASH__";
var SHELL_CACHE = "vitality-v2-shell-" + BUILD_HASH;
var RUNTIME_CACHE = "vitality-v2-runtime-" + BUILD_HASH;

// Mirrors the <script>/<link> tags in index.html. If you add a new
// runtime asset there, add it here too — the SW will not serve it
// offline otherwise. (See CLAUDE.md §10 — pre-cache invariant.)
var PRECACHE_URLS = [
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
  "/src/modules/identity/auth.js"
  // External CDN bundles are NOT eagerly pre-cached here.
  // They are served cache-first by the unpkg fetch rule on first access,
  // which avoids fetching ~3 MB during SW install on every new build hash.
];

var KEEP_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

function keepCache(name) {
  for (var i = 0; i < KEEP_CACHES.length; i++) {
    if (KEEP_CACHES[i] === name) return true;
  }
  return false;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // Use individual add() so one failed CDN URL doesn't poison the install.
      var adds = PRECACHE_URLS.map(function (u) {
        return cache.add(u).catch(function () {});
      });
      return Promise.all(adds);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      var deletions = names.map(function (n) {
        return keepCache(n) ? null : caches.delete(n);
      });
      return Promise.all(deletions);
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isPrecached(url) {
  if (isSameOrigin(url)) {
    return PRECACHE_URLS.indexOf(url.pathname) !== -1;
  }
  return PRECACHE_URLS.indexOf(url.href) !== -1;
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok) {
          cache.put(request, res.clone()).catch(function () {});
        }
        return res;
      });
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var fetchPromise = fetch(request).then(function (res) {
        if (res && res.ok) {
          cache.put(request, res.clone()).catch(function () {});
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetchPromise;
    });
  });
}

function networkFirst(request, cacheName, timeoutMs) {
  return caches.open(cacheName).then(function (cache) {
    var timer;
    var network = fetch(request).then(function (res) {
      if (res && res.ok && request.method === "GET") {
        cache.put(request, res.clone()).catch(function () {});
      }
      return res;
    });

    var raced;
    if (timeoutMs && timeoutMs > 0) {
      var timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error("net-timeout")); }, timeoutMs);
      });
      raced = Promise.race([network, timeout]);
    } else {
      raced = network;
    }

    return raced.then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      // Cache fallback. Note: POST requests are not cacheable per Cache API
      // semantics, so this branch only ever returns hits for GETs. For the
      // Anthropic POST endpoint, this effectively degrades to network-only.
      return cache.match(request).then(function (hit) {
        if (hit) return hit;
        throw e;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") return; // bypass SW for POST/PUT/DELETE

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

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

  // Anything else — network-only (default browser behaviour).
});
