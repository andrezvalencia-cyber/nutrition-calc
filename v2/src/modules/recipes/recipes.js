// Recipes module — read access to combined recipe catalog and meal-nutrient math.
// Source data (RECIPES, SUPPLEMENT_RECIPES) lives in data.js; this module gives
// the app a stable API for nutrient totals. computeMealNutrients always sums
// from `states` via getIngNutrients — recipe.verifiedTotal is data-only (tested
// as a tripwire in v2/tests/integration.test.js).
//
// Public API: window.Modules.Recipes.{ getAllRecipes, computeMealNutrients }
//
// Soft-fail policy: getIngNutrients warns once (per id) and returns zeros for
// unknown ingredient ids or non-finite/negative qty. Numeric strings ("48") are
// coerced via Number(). Rationale: a typo or stale state must not corrupt the
// totals UI with NaN/Infinity, but must surface in devtools.
(function (global) {
  var _warned = new Set();
  function warnOnce(key, msg) {
    if (_warned.has(key)) return;
    _warned.add(key);
    if (typeof console !== "undefined" && console.warn) console.warn(msg);
  }

  function getAllRecipes() {
    return Object.assign({}, (typeof RECIPES !== "undefined" ? RECIPES : {}),
                             (typeof SUPPLEMENT_RECIPES !== "undefined" ? SUPPLEMENT_RECIPES : {}));
  }

  function getIngNutrients(id, qty) {
    var ing = global.Modules.Catalog.getIngredient(id);
    if (!ing) {
      warnOnce("unknown-ingredient:" + id,
        "Modules.Recipes: unknown ingredient id '" + id + "' — contributing zeros");
      return emptyNutrients();
    }
    var q = Number(qty);
    if (!isFinite(q) || q < 0) {
      warnOnce("invalid-qty:" + id,
        "Modules.Recipes: invalid qty '" + String(qty) + "' for ingredient '" + id + "' — contributing zeros");
      return emptyNutrients();
    }
    var ratio = q / ing.defaultQty;
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
