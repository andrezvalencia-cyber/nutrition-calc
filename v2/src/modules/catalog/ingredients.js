// Catalog module — read-only access to the ingredient and swap-group catalog.
// Source data still lives in data.js (INGREDIENTS, SWAP_GROUPS) as global vars.
// This module is a thin accessor layer so future swaps (e.g. fetch from server)
// require changing one file instead of every call site.
//
// Public API: window.Modules.Catalog.{ getIngredient, getSwapGroup, searchIngredients }
(function (global) {
  function getIngredient(id) {
    return (typeof INGREDIENTS !== "undefined" && INGREDIENTS[id]) || null;
  }

  function getSwapGroup(name) {
    return (typeof SWAP_GROUPS !== "undefined" && SWAP_GROUPS[name]) || null;
  }

  /**
   * Case-insensitive name search over the food ingredient catalog.
   * Excludes category "supplement" by default (logged via the Supplements tab).
   * @param {string} query - User text; empty/blank returns [].
   * @param {{ includeSupplements?: boolean, limit?: number }} [opts]
   * @returns {Array<{ id: string, name: string, category: string, defaultQty: number, unit: string }>} Matching ingredients with id, sorted by name.
   */
  function searchIngredients(query, opts) {
    if (typeof INGREDIENTS === "undefined") return [];
    var q = (query || "").toLowerCase().trim();
    if (!q) return [];
    var includeSuppls = opts && opts.includeSupplements;
    var limit = (opts && opts.limit) || 50;
    var results = [];
    var keys = Object.keys(INGREDIENTS);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var ing = INGREDIENTS[id];
      if (!includeSuppls && ing.category === "supplement") continue;
      if (ing.name.toLowerCase().indexOf(q) !== -1) {
        results.push({ id: id, name: ing.name, category: ing.category, defaultQty: ing.defaultQty, unit: ing.unit });
      }
    }
    results.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    if (results.length > limit) results.length = limit;
    return results;
  }

  global.Modules = global.Modules || {};
  global.Modules.Catalog = {
    getIngredient: getIngredient,
    getSwapGroup: getSwapGroup,
    searchIngredients: searchIngredients,
  };
})(window);
