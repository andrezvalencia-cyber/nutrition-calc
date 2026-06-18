// Recipes module — read access to combined recipe catalog and meal-nutrient math.
// Source data (RECIPES, SUPPLEMENT_RECIPES) lives in data.js; this module gives
// the app a stable API for nutrient totals. calculateNutrition always sums
// from `states` via getIngNutrients — recipe.verifiedTotal is data-only (tested
// as a tripwire in v2/tests/integration.test.js).
//
// Public API:
//   window.Modules.Recipes.{ getAllRecipes, calculateNutrition }
//   window.NutritionCalculator.calculateNutrition  (public alias of the same fn)
//   window.Modules.Recipes.computeMealNutrients  — @deprecated v2.3.0, remove v2.5.0
//     (warns once per session, delegates to calculateNutrition; see RETIRED.md)
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

  /**
   * Return the merged catalog of food recipes and supplement recipes.
   *
   * @returns {Object<string, Object>} Combined RECIPES + SUPPLEMENT_RECIPES map.
   */
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
  /**
   * Sum a recipe's nutrient totals from its current ingredient states.
   *
   * @param {Object} recipe - Recipe descriptor; presence-checked only. Falsy →
   *   all-zero totals.
   * @param {Array<{id: string, qty: number|string}>} states - Per-ingredient
   *   amounts. Empty/missing, an unknown `id`, or a non-finite/negative `qty`
   *   contributes zero — the emptyNutrients() soft-fail.
   * @returns {Object<string, number>} Totals keyed by NUTRIENT_KEYS
   *   (emptyNutrients() shape); every value finite — never throws, never NaN.
   */
  function calculateNutrition(recipe, states) {
    if (!recipe || !states || !states.length) return emptyNutrients();
    var t = emptyNutrients();
    states.forEach(function (s) {
      var n = getIngNutrients(s.id, s.qty);
      NUTRIENT_KEYS.forEach(function (k) { t[k] += n[k]; });
    });
    return t;
  }

  // @deprecated v2.3.0 — remove v2.5.0. Thin alias kept for one sunset cycle so
  // callers don't break mid-transition. warnOnce de-dups to a single warning per
  // page session, then delegates to the canonical calculateNutrition. The message
  // names the public NutritionCalculator alias. See RETIRED.md + CHANGELOG.md.
  function computeMealNutrients(recipe, states) {
    warnOnce("deprecated:computeMealNutrients",
      "DEPRECATED: Use NutritionCalculator.calculateNutrition()");
    return calculateNutrition(recipe, states);
  }

  global.Modules = global.Modules || {};
  global.Modules.Recipes = {
    getAllRecipes: getAllRecipes,
    calculateNutrition: calculateNutrition,
    computeMealNutrients: computeMealNutrients, // @deprecated v2.3.0 — remove v2.5.0
  };
  // Public-facing alias named in the deprecation message. Same function object as
  // Modules.Recipes.calculateNutrition — single implementation, two access paths.
  global.NutritionCalculator = { calculateNutrition: calculateNutrition };
})(window);
