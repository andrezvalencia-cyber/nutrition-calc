// Insights engine — pure functions that derive the InsightsScreen view-model
// from saved history + today's running totals. Mirrors gap-engine.js: browser
// global, depends on data.js globals (NUTRIENT_KEYS, OBJECTIVES, getStatus,
// MACRO_KEYS, VITAMIN_KEYS, MINERAL_KEYS, emptyNutrients, todayStr).
//
// Public API: Modules.Insights.{ buildDays, aggregate, buildHeatmap, heatmapColor }
(function (global) {
  function buildDays(state, runningTotals, gapsClosed) {
    var hist = (state.dayHistory || []).map(function (d) {
      return {
        date: d.date,
        totals: d.totals || emptyNutrients(),
        gapsClosed: d.gapsClosed || 0,
        energy: d.energy != null ? d.energy : null,
        digestion: d.digestion != null ? d.digestion : null,
      };
    });
    if ((state.dayLog || []).length > 0) {
      var today = state.currentDate || todayStr();
      if (!hist.some(function (d) { return d.date === today; })) {
        hist.push({
          date: today,
          totals: Object.assign({}, runningTotals),
          gapsClosed: gapsClosed,
          energy: null,
          digestion: null,
        });
      }
    }
    hist.sort(function (a, b) { return a.date.localeCompare(b.date); });
    return hist;
  }

  function aggregate(sliced) {
    if (sliced.length === 0) return null;
    var avgGaps = sliced.reduce(function (s, d) { return s + d.gapsClosed; }, 0) / sliced.length;
    var energyDays = sliced.filter(function (d) { return d.energy !== null; });
    var digestDays = sliced.filter(function (d) { return d.digestion !== null; });
    var avgEnergy = energyDays.length > 0
      ? energyDays.reduce(function (s, d) { return s + d.energy; }, 0) / energyDays.length
      : null;
    var avgDigestion = digestDays.length > 0
      ? digestDays.reduce(function (s, d) { return s + d.digestion; }, 0) / digestDays.length
      : null;

    var hitCounts = {};
    NUTRIENT_KEYS.forEach(function (k) { hitCounts[k] = 0; });
    sliced.forEach(function (d) {
      NUTRIENT_KEYS.forEach(function (k) {
        if (getStatus(k, d.totals[k] || 0).closed) hitCounts[k]++;
      });
    });
    var hitRate = {};
    NUTRIENT_KEYS.forEach(function (k) { hitRate[k] = hitCounts[k] / sliced.length; });

    var topHits = NUTRIENT_KEYS
      .filter(function (k) { return hitRate[k] >= 0.8; })
      .sort(function (a, b) { return hitRate[b] - hitRate[a]; });
    var chronicGaps = NUTRIENT_KEYS
      .filter(function (k) { return hitRate[k] <= 0.3; })
      .sort(function (a, b) { return hitRate[a] - hitRate[b]; });

    return {
      avgGaps: avgGaps,
      avgEnergy: avgEnergy,
      avgDigestion: avgDigestion,
      topHits: topHits,
      chronicGaps: chronicGaps,
      hitRate: hitRate,
    };
  }

  function heatmapColor(pct, isDark, isMaxType) {
    if (pct === null || pct === undefined) {
      return isDark ? "hsl(0,0%,18%)" : "hsl(0,0%,92%)";
    }
    var effective = isMaxType ? Math.max(0, 120 - pct) : Math.min(pct, 120);
    var hue = (Math.max(0, Math.min(effective, 120)) / 120) * 130;
    if (isDark) {
      var sat = effective === 0 && !isMaxType ? 0 : 60;
      var light = effective === 0 && !isMaxType ? 18 : 25 + (effective / 120) * 10;
      return "hsl(" + hue + "," + sat + "%," + light + "%)";
    }
    var sat2 = effective === 0 && !isMaxType ? 0 : 50;
    var light2 = effective === 0 && !isMaxType ? 92 : 82 - (effective / 120) * 18;
    return "hsl(" + hue + "," + sat2 + "%," + light2 + "%)";
  }

  function buildHeatmap(sliced, isDark, colorFn) {
    colorFn = colorFn || heatmapColor;
    var data = {};
    var groups = [
      { label: "Macros", keys: MACRO_KEYS },
      { label: "Vitamins", keys: VITAMIN_KEYS },
      { label: "Minerals", keys: MINERAL_KEYS },
    ];
    groups.forEach(function (g) {
      g.keys.forEach(function (k) {
        var isMaxType = OBJECTIVES[k] && OBJECTIVES[k].type === "maximum";
        data[k] = sliced.map(function (d) {
          var val = d.totals[k] || 0;
          var s = getStatus(k, val);
          return {
            pct: s.pct,
            value: val,
            date: d.date,
            closed: s.closed,
            color: colorFn(s.pct, isDark, isMaxType),
          };
        });
      });
    });
    return data;
  }

  var api = {
    buildDays: buildDays,
    aggregate: aggregate,
    buildHeatmap: buildHeatmap,
    heatmapColor: heatmapColor,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.Insights = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
