// Catalog module — read-only access to the ingredient and swap-group catalog.
// Source data still lives in data.js (INGREDIENTS, SWAP_GROUPS) as global vars.
// This module is a thin accessor layer so future swaps (e.g. fetch from server)
// require changing one file instead of every call site.
//
// Public API: window.Modules.Catalog.{ getIngredient, getSwapGroup }
(function (global) {
  function getIngredient(id) {
    return (typeof INGREDIENTS !== "undefined" && INGREDIENTS[id]) || null;
  }

  function getSwapGroup(name) {
    return (typeof SWAP_GROUPS !== "undefined" && SWAP_GROUPS[name]) || null;
  }

  global.Modules = global.Modules || {};
  global.Modules.Catalog = {
    getIngredient: getIngredient,
    getSwapGroup: getSwapGroup,
  };
})(window);
