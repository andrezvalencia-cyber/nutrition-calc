// Unity Fallback engine — pure resolver for nutrient targets.
// Loaded as a <script> in the browser AND require-able from Node (unit tests).
//
// Resolution order for resolveTarget(key, profile, deps):
//   1. profile[key] is a finite number >= 0 → return it (no fallback fired)
//   2. defaults[key] is finite → fire onFallbackTriggered, return it
//   3. Otherwise → console.warn, fire onFallbackTriggered, return unity (1.0)
//
// Public API:
//   Modules.Fallbacks.resolveTarget(key, profile, deps) → number
//   Modules.Fallbacks.buildProfile(answers) → object
(function (global) {
  "use strict";

  function isUsable(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  function resolveTarget(key, profile, deps) {
    var defaults = (deps && typeof deps.defaults === "object" && deps.defaults) || null;
    var onFallbackTriggered = (deps && typeof deps.onFallbackTriggered === "function")
      ? deps.onFallbackTriggered
      : null;
    var unity = (deps && isUsable(deps.unity)) ? deps.unity : 1.0;

    if (typeof profile === "object" && profile !== null && isUsable(profile[key])) {
      return profile[key];
    }

    if (defaults !== null && isUsable(defaults[key])) {
      if (onFallbackTriggered) {
        onFallbackTriggered({
          key: key,
          reason: "missing_profile_value",
          value: defaults[key],
          source: "default",
        });
      }
      return defaults[key];
    }

    if (typeof console !== "undefined" && console.warn) {
      console.warn("FALLBACK_CONFIG_ERROR: no valid target for '" + key + "', using unity (" + unity + ")");
    }
    if (onFallbackTriggered) {
      onFallbackTriggered({
        key: key,
        reason: "FALLBACK_CONFIG_ERROR",
        value: unity,
        source: "unity",
      });
    }
    return unity;
  }

  var GOAL_CALORIE_MULTIPLIER = {
    maintain: 1.0,
    lose: 0.85,
    gain: 1.15,
  };

  var PROTEIN_MULTIPLIER = {
    standard: 1.0,
    high: 1.3,
  };

  function buildProfile(answers) {
    if (!answers || typeof answers !== "object") return null;

    var profile = {};
    var goal = answers.goal || "maintain";
    var protein = answers.protein || "standard";

    if (isUsable(answers.calories)) {
      var mult = GOAL_CALORIE_MULTIPLIER[goal] || 1.0;
      profile.calories = Math.round(answers.calories * mult);
    }

    if (isUsable(answers.calories)) {
      var baseCals = profile.calories || answers.calories;
      var pMult = PROTEIN_MULTIPLIER[protein] || 1.0;
      profile.protein = Math.round((baseCals * 0.15 / 4) * pMult);
      profile.carbs = Math.round(baseCals * 0.55 / 4);
      profile.fat = Math.round(baseCals * 0.275 / 9);
    }

    profile.diet = answers.diet || "omnivore";
    profile.goal = goal;
    profile.completed = true;

    return profile;
  }

  var api = {
    resolveTarget: resolveTarget,
    buildProfile: buildProfile,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.Fallbacks = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
