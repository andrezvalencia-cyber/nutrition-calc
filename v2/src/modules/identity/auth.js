/* Vitality v2 — Identity & Auth module.
 *
 * Thin wrapper around supabase-js auth. Public surface:
 *   window.Modules.Identity.isConfigured()           -> boolean
 *   window.Modules.Identity.init()                   -> Promise<void>
 *   window.Modules.Identity.getClient()              -> SupabaseClient | null
 *   window.Modules.Identity.getSession()             -> Promise<Session|null>
 *   window.Modules.Identity.signIn(email, password)  -> Promise<{ user, session }>
 *   window.Modules.Identity.signOut()                -> Promise<void>
 *   window.Modules.Identity.onAuthStateChange(cb)    -> unsubscribe()
 *
 * Lazy client init: the supabase-js UMD is dynamically injected on the first
 * call to any auth method. Until then `getClient()` returns null and
 * RemoteStore reports unavailable, so the app runs in LocalStore-only mode.
 * This keeps ~120 KB off the iPhone Safari critical path on first load.
 *
 * iOS Safari floor: SRI on dynamically-injected scripts is enforced on
 * iOS Safari 14.5+. Older iOS treats `integrity` as advisory. The project's
 * support floor is iOS 15+, so this is acceptable.
 *
 * Tests stub Modules.Identity via page.addInitScript before this IIFE runs;
 * the stub uses Object.defineProperty with a getter, so re-assignment here
 * is a no-op when stubbed (see CLAUDE.md hermetic test stub note).
 */
(function () {
  "use strict";

  var PLACEHOLDER_URL = "TODO_SUPABASE_URL";
  var PLACEHOLDER_KEY = "TODO_SUPABASE_ANON_KEY";

  // Pinned: must match the integrity hash that previously lived in
  // v2/index.html line 130. Bump together when upgrading supabase-js.
  var SUPABASE_CDN_URL = "https://unpkg.com/@supabase/supabase-js@2.105.0/dist/umd/supabase.js";
  var SUPABASE_CDN_INTEGRITY = "sha384-OMZvx3Vy2g+m2/bV7wq4vKCSjS3P2+OVcOXSaqWaoK3ZoSAHaje1LSM9FK4MNk2J";

  var _client = null;
  var _scriptPromise = null;

  function cfg() { return window.SupabaseConfig || {}; }

  function isConfigured() {
    var c = cfg();
    return !!(c.url && c.anonKey &&
      c.url !== PLACEHOLDER_URL && c.anonKey !== PLACEHOLDER_KEY);
  }

  function loadSupabaseScript() {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return Promise.resolve();
    }
    if (_scriptPromise) return _scriptPromise;
    _scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = SUPABASE_CDN_URL;
      s.crossOrigin = "anonymous";
      s.integrity = SUPABASE_CDN_INTEGRITY;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        _scriptPromise = null; // permit retry on later call
        // Surface the failure once so blocked CDNs / firewalls / SRI
        // mismatches stay diagnosable; init() callers swallow the rejection.
        try { console.warn("[Identity] supabase-js CDN load failed:", SUPABASE_CDN_URL); } catch (_) {}
        reject(new Error("Supabase CDN load failed"));
      };
      document.head.appendChild(s);
    });
    return _scriptPromise;
  }

  // Public: kick off the dynamic load. Resolves when supabase-js is ready
  // (or immediately when not configured / load failed — caller should treat
  // a null getClient() afterwards as "cloud unavailable", same as before).
  function init() {
    if (!isConfigured()) return Promise.resolve();
    return loadSupabaseScript().catch(function () { /* degrade silently */ });
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (_client) return _client;
    var sb = window.supabase;
    if (!sb || typeof sb.createClient !== "function") return null;
    _client = sb.createClient(cfg().url, cfg().anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    return _client;
  }

  function notConfiguredError() {
    var e = new Error("Cloud sync is not configured yet.");
    e.code = "not_configured";
    return e;
  }

  function getSession() {
    if (!isConfigured()) return Promise.resolve(null);
    return init().then(function () {
      var c = getClient();
      if (!c) return null;
      return c.auth.getSession().then(function (r) {
        return (r && r.data && r.data.session) || null;
      });
    });
  }

  function signIn(email, password) {
    if (!isConfigured()) return Promise.reject(notConfiguredError());
    return init().then(function () {
      var c = getClient();
      if (!c) throw notConfiguredError();
      return c.auth.signInWithPassword({ email: email, password: password })
        .then(function (r) {
          if (r && r.error) throw r.error;
          return r && r.data;
        });
    });
  }

  function signOut() {
    if (!isConfigured()) return Promise.resolve();
    return init().then(function () {
      var c = getClient();
      if (!c) return undefined;
      return c.auth.signOut().then(function () { return undefined; });
    });
  }

  // Sync return shape preserved (caller gets unsubscribe immediately) but
  // real subscription is deferred until the script loads. If load fails or
  // module is unconfigured, unsubscribe is a no-op.
  function onAuthStateChange(cb) {
    var realUnsub = function () {};
    var unsubscribed = false;
    if (isConfigured()) {
      init().then(function () {
        if (unsubscribed) return;
        var c = getClient();
        if (!c) return;
        var sub = c.auth.onAuthStateChange(function (_event, session) { cb(session || null); });
        realUnsub = function () {
          try { sub && sub.data && sub.data.subscription && sub.data.subscription.unsubscribe(); }
          catch (_) { /* ignore */ }
        };
      });
    }
    return function () { unsubscribed = true; realUnsub(); };
  }

  window.Modules = window.Modules || {};
  window.Modules.Identity = {
    isConfigured: isConfigured,
    init: init,
    getClient: getClient,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,
  };
})();
