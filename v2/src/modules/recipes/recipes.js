// Recipes module — read access to combined recipe catalog and meal-nutrient math.
// Source data (RECIPES, SUPPLEMENT_RECIPES) lives in data.js; this module gives the
// app a stable API and centralizes the swap/qty delta math.
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

  function computeMealNutrients(recipe, states) {
    if (!recipe || !states.length) return emptyNutrients();
    var hasMod = states.some(function (s, i) {
      var o = recipe.ingredients[i];
      if (!o) return true;
      var oi = global.Modules.Catalog.getIngredient(o.id);
      return s.id !== o.id || s.qty !== (oi ? oi.defaultQty : 1);
    });
    if (!hasMod) return Object.assign({}, recipe.verifiedTotal);
    var t = Object.assign({}, recipe.verifiedTotal);
    states.forEach(function (s, i) {
      var o = recipe.ingredients[i];
      if (!o) return;
      var oi = global.Modules.Catalog.getIngredient(o.id);
      if (!oi) return;
      var oq = oi.defaultQty;
      if (s.id !== o.id || s.qty !== oq) {
        var on = getIngNutrients(o.id, oq);
        var nn = getIngNutrients(s.id, s.qty);
        NUTRIENT_KEYS.forEach(function (k) { t[k] = t[k] - on[k] + nn[k]; });
      }
    });
    return t;
  }

  global.Modules = global.Modules || {};
  global.Modules.Recipes = {
    getAllRecipes: getAllRecipes,
    computeMealNutrients: computeMealNutrients,
  };
})(window);
