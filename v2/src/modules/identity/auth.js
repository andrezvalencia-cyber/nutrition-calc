/* Vitality v2 — Identity & Auth module.
 *
 * Thin wrapper around supabase-js auth. Public surface:
 *   window.Modules.Identity.isConfigured()           -> boolean
 *   window.Modules.Identity.getClient()              -> SupabaseClient | null
 *   window.Modules.Identity.getSession()             -> Promise<Session|null>
 *   window.Modules.Identity.signIn(email, password)  -> Promise<{ user, session }>
 *   window.Modules.Identity.signOut()                -> Promise<void>
 *   window.Modules.Identity.onAuthStateChange(cb)    -> unsubscribe()
 *
 * Lazy client init: nothing hits the network until a method is called and
 * the config has real (non-placeholder) values.
 */
(function () {
  "use strict";

  var PLACEHOLDER_URL = "TODO_SUPABASE_URL";
  var PLACEHOLDER_KEY = "TODO_SUPABASE_ANON_KEY";

  var _client = null;

  function cfg() { return window.SupabaseConfig || {}; }

  function isConfigured() {
    var c = cfg();
    return !!(c.url && c.anonKey &&
      c.url !== PLACEHOLDER_URL && c.anonKey !== PLACEHOLDER_KEY);
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
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; });
  }

  function signIn(email, password) {
    var c = getClient();
    if (!c) return Promise.reject(notConfiguredError());
    return c.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        if (r && r.error) throw r.error;
        return r && r.data;
      });
  }

  function signOut() {
    var c = getClient();
    if (!c) return Promise.resolve();
    return c.auth.signOut().then(function () { return undefined; });
  }

  function onAuthStateChange(cb) {
    var c = getClient();
    if (!c) return function () {};
    var sub = c.auth.onAuthStateChange(function (_event, session) { cb(session || null); });
    return function () {
      try { sub && sub.data && sub.data.subscription && sub.data.subscription.unsubscribe(); }
      catch (_) { /* ignore */ }
    };
  }

  window.Modules = window.Modules || {};
  window.Modules.Identity = {
    isConfigured: isConfigured,
    getClient: getClient,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,
  };
})();
