// Local persistence layer for V2 — backed by localStorage.
// Public API: window.LocalStore.{ loadState, saveState, clearState,
//                                  loadApiKey, saveApiKey, clearApiKey, KEYS }
// Loaded as a plain <script> before data.js. No bundler, no ESM.
(function (global) {
  var KEYS = {
    state: "nutrition_calc_v2",
    apiKey: "nutrition_calc_v2_api_key",
  };

  function loadState() {
    try {
      var r = localStorage.getItem(KEYS.state);
      return r ? JSON.parse(r) : null;
    } catch (e) {
      console.warn("Failed to load state, using defaults:", e);
      return null;
    }
  }

  function saveState(s) {
    try {
      localStorage.setItem(KEYS.state, JSON.stringify(s));
    } catch (e) {
      console.warn("Failed to save state:", e);
    }
  }

  function clearState() {
    try { localStorage.removeItem(KEYS.state); } catch (e) {}
  }

  function loadApiKey() {
    try { return localStorage.getItem(KEYS.apiKey) || ""; } catch (e) { return ""; }
  }

  function saveApiKey(key) {
    try { localStorage.setItem(KEYS.apiKey, key); } catch (e) {}
  }

  function clearApiKey() {
    try { localStorage.removeItem(KEYS.apiKey); } catch (e) {}
  }

  global.LocalStore = {
    KEYS: KEYS,
    loadState: loadState,
    saveState: saveState,
    clearState: clearState,
    loadApiKey: loadApiKey,
    saveApiKey: saveApiKey,
    clearApiKey: clearApiKey,
  };
})(window);
