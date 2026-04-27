// Gap engine — pure functions that derive runningTotals and gapsClosed from state.
// Used by NutritionContext useMemo blocks; centralizing here means the future
// remote-store can recompute totals after a sync without duplicating math.
//
// Public API: window.Modules.GapEngine.{ computeRunningTotals, computeGapsClosed }
(function (global) {
  function computeRunningTotals(state) {
    var base = emptyNutrients();
    var co = state.fatSolubleCarryover || {};
    NUTRIENT_KEYS.forEach(function (k) { base[k] += (co[k] || 0); });
    (state.dayLog || []).forEach(function (entry) {
      var n = entry.nutrients || emptyNutrients();
      NUTRIENT_KEYS.forEach(function (k) { base[k] += (n[k] || 0); });
    });
    return base;
  }

  function computeGapsClosed(runningTotals) {
    var count = 0;
    NUTRIENT_KEYS.forEach(function (k) {
      if (getStatus(k, runningTotals[k]).closed) count++;
    });
    return count;
  }

  global.Modules = global.Modules || {};
  global.Modules.GapEngine = {
    computeRunningTotals: computeRunningTotals,
    computeGapsClosed: computeGapsClosed,
  };
})(window);
