// CustomFoods — user-defined 16-nutrient foods stored in local state.
// Dual-mode IIFE: browser self-attach + Node require() for unit tests.
//
// Custom foods live in state.customFoods[]. They are raw-nutrient entities
// (not recipe refs like templates). Logged as recipe-less day_entries via
// the existing buildEntryRow path (recipeId: null).
//
// Public API:
//   Modules.CustomFoods.{ NUTRIENT_KEYS, NAME_MAX, sanitizeNutrients,
//     buildCustomFood, addCustomFood, updateCustomFood, removeCustomFood }
(function (global) {
  "use strict";

  var NAME_MAX = 40;

  // Canonical 16-key list in data.js order. Self-contained so this module
  // is require-able from Node without loading data.js.
  var NUTRIENT_KEYS = [
    "protein", "carbs", "fat", "fiber", "sat_fat", "epa_dha",
    "calcium", "iron", "zinc", "vit_d", "vit_e", "b12",
    "folate", "vit_c", "potassium", "magnesium"
  ];

  /**
   * Coerce raw input into a safe 16-key nutrients object.
   * Non-finite / negative values clamp to 0; unknown keys are dropped.
   * @param {Object} input - Raw nutrient key-value pairs.
   * @returns {Object} Exactly-16-key object with numeric values >= 0.
   */
  function sanitizeNutrients(input) {
    var out = {};
    for (var i = 0; i < NUTRIENT_KEYS.length; i++) {
      var k = NUTRIENT_KEYS[i];
      var v = Number(input && input[k]);
      out[k] = (Number.isFinite(v) && v > 0) ? v : 0;
    }
    return out;
  }

  /**
   * Build a new custom food object.
   * @param {string} name - Display name (capped at NAME_MAX).
   * @param {string} emoji - Single emoji for the pill.
   * @param {Object} nutrients - Raw nutrients (sanitized internally).
   * @param {string|null} barcode - Optional barcode reference from scanner.
   * @returns {{ id: string, name: string, emoji: string, nutrients: Object, barcode: string|null, createdAt: number, custom: true }}
   */
  function buildCustomFood(name, emoji, nutrients, barcode) {
    var clean = String(name == null ? "" : name).slice(0, NAME_MAX).trim();
    var id;
    if (typeof genId === "function") {
      id = genId();
    } else {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    return {
      id: id,
      name: clean || "Custom Food",
      emoji: emoji || "\u{1F372}",
      nutrients: sanitizeNutrients(nutrients || {}),
      barcode: barcode || null,
      createdAt: Date.now(),
      custom: true,
    };
  }

  /**
   * Add a custom food to state (immutable).
   * @param {Object} state - App state containing customFoods array.
   * @param {Object} cf - Custom food object from buildCustomFood.
   * @returns {Object} New state with the custom food appended.
   */
  function addCustomFood(state, cf) {
    return Object.assign({}, state, {
      customFoods: (state.customFoods || []).concat([cf]),
    });
  }

  /**
   * Update a custom food by id (immutable).
   * @param {Object} state - App state.
   * @param {string} id - Custom food id to update.
   * @param {Object} patch - Fields to merge (nutrients are re-sanitized if present).
   * @returns {Object} New state with the custom food updated.
   */
  function updateCustomFood(state, id, patch) {
    return Object.assign({}, state, {
      customFoods: (state.customFoods || []).map(function (cf) {
        if (cf.id !== id) return cf;
        var updated = Object.assign({}, cf, patch);
        if (patch.name != null) {
          updated.name = String(patch.name).slice(0, NAME_MAX).trim() || cf.name;
        }
        if (patch.nutrients) {
          updated.nutrients = sanitizeNutrients(patch.nutrients);
        }
        return updated;
      }),
    });
  }

  /**
   * Remove a custom food by id (immutable).
   * @param {Object} state - App state.
   * @param {string} id - Custom food id to remove.
   * @returns {Object} New state with the custom food removed.
   */
  function removeCustomFood(state, id) {
    return Object.assign({}, state, {
      customFoods: (state.customFoods || []).filter(function (cf) { return cf.id !== id; }),
    });
  }

  var api = {
    NUTRIENT_KEYS: NUTRIENT_KEYS,
    NAME_MAX: NAME_MAX,
    sanitizeNutrients: sanitizeNutrients,
    buildCustomFood: buildCustomFood,
    addCustomFood: addCustomFood,
    updateCustomFood: updateCustomFood,
    removeCustomFood: removeCustomFood,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.CustomFoods = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
