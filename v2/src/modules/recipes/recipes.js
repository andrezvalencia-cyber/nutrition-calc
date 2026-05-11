// Recipes module — read access to combined recipe catalog and meal-nutrient math.
// Source data (RECIPES, SUPPLEMENT_RECIPES) lives in data.js; this module gives
// the app a stable API for nutrient totals. computeMealNutrients always sums
// from `states` via getIngNutrients — recipe.verifiedTotal is data-only (tested
// as a tripwire in v2/tests/integration.test.js).
//
// Public API: window.Modules.Recipes.{ getAllRecipes, computeMealNutrients }
(function (global) {
  function getAllRecipes() {
    return Object.assign({}, (typeof RECIPES !== "undefined" ? RECIPES : {}),
                             (typeof SUPPLEMENT_RECIPES !== "undefined" ? SUPPLEMENT_RECIPES : {}));
  }

  function getIngNutrients(id, qty) {
    var ing = global.Modules.Catalog.getIngredient(id);
    if (!ing) return emptyNutrients();
    var ratio = qty / ing.defaultQty;
    var n = {};
    NUTRIENT_KEYS.forEach(function (k) { n[k] = (ing[k] || 0) * ratio; });
    return n;
  }

  // Single sum path. verifiedTotal in data.js is data-only (tested as a tripwire
  // in v2/tests/integration.test.js — must equal sum of ingredients at defaults).
  function computeMealNutrients(recipe, states) {
    if (!recipe || !states || !states.length) return emptyNutrients();
    var t = emptyNutrients();
    states.forEach(function (s) {
      var n = getIngNutrients(s.id, s.qty);
      NUTRIENT_KEYS.forEach(function (k) { t[k] += n[k]; });
    });
    return t;
  }

  global.Modules = global.Modules || {};
  global.Modules.Recipes = {
    getAllRecipes: getAllRecipes,
    computeMealNutrients: computeMealNutrients,
  };
})(window);
