// Templates module — reusable meal/supplement "stacks" the user can re-log in
// one tap, plus first-run example seeding. Pure (no React, no DOM) and
// require-able from Node for unit tests, mirroring carryover-engine.js.
//
// Persistence: a `templates` array inside the existing nutrition_calc_v2
// localStorage state (NOT IndexedDB — that stays reserved for the write-behind
// queue). State transformers here are immutable, like Modules.Log.
//
// Template shape (state.templates[]):
//   { id, name, emoji, refs: [{ recipeId, ingredientStates: [{id,qty,swapGroup}] }], createdAt }
// Nutrients are NOT stored — they are recomputed at log time from refs so
// edits to INGREDIENTS stay accurate and unknown ids soft-fail to zeros.
//
// Resilience ("Fallback to Unity" / degraded state): resolveTemplate() reports
// any ref whose recipe is missing from the catalog (or whose ingredient ids no
// longer resolve) via `missing` and `ok=false`, so the UI can render a disabled
// chip instead of throwing on mount.
//
// Public API: Modules.Templates.{ addTemplate, removeTemplate, buildTemplate,
//                                  resolveTemplate, seedExamples, NAME_MAX }
(function (global) {
  "use strict";

  var NAME_MAX = 40;            // blast-radius cap, mirrors MAX_QUICK_TEXT
  var SEED_REJECTION_BUDGET = 3; // >3 consecutive invalid recipeIds halts seeding

  // ── Dependency defaults (resolved at call time, not load time) ──────────
  function realCatalogGet() {
    var C = global.Modules && global.Modules.Catalog;
    return (C && C.getIngredient) ? C.getIngredient : function () { return null; };
  }
  function realCompute() {
    var R = global.Modules && global.Modules.Recipes;
    return (R && R.calculateNutrition) ? R.calculateNutrition : function () { return {}; };
  }
  function newId() {
    if (typeof genId === "function") return genId();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Derive editable ingredient states for a recipe, defaulting qty to the
  // catalog defaultQty (|| 1 — the unit fallback) so a missing ingredient
  // contributes a benign quantity instead of NaN.
  function deriveStates(recipe, getIngredient) {
    getIngredient = getIngredient || realCatalogGet();
    return (recipe.ingredients || []).map(function (ing) {
      var data = getIngredient(ing.id);
      return {
        id: ing.id,
        qty: (data && data.defaultQty) || 1,
        swapGroup: ing.swapGroup || null,
      };
    });
  }

  // ── Pure constructor ────────────────────────────────────────────────────
  function buildTemplate(name, emoji, refs) {
    var clean = String(name == null ? "" : name).slice(0, NAME_MAX).trim();
    return {
      id: newId(),
      name: clean || "Untitled",
      emoji: emoji || "\u{1F37D}",
      refs: Array.isArray(refs) ? refs : [],
      createdAt: Date.now(),
    };
  }

  // ── Immutable state transformers ──────────────────────────────────────────
  function addTemplate(state, template) {
    return Object.assign({}, state, {
      templates: (state.templates || []).concat([template]),
    });
  }

  function removeTemplate(state, id) {
    return Object.assign({}, state, {
      templates: (state.templates || []).filter(function (t) { return t.id !== id; }),
    });
  }

  /**
   * Merge partial changes into an existing template by id.
   * @param {object} state - App state containing templates array
   * @param {string} id - Template id to update
   * @param {object} changes - Partial fields to merge (name, emoji, ingredientText, nutrients, etc.)
   * @returns {object} New state with updated template
   */
  function updateTemplate(state, id, changes) {
    return Object.assign({}, state, {
      templates: (state.templates || []).map(function (t) {
        if (t.id !== id) return t;
        return Object.assign({}, t, changes);
      }),
    });
  }

  // ── Resolution + degraded-state oracle ────────────────────────────────────
  // Returns { ok, entries, missing }. `entries` are loggable dayLog entries
  // for the refs that DID resolve; `missing` lists refs that didn't. `ok` is
  // true only when every ref resolved. Never throws.
  function resolveTemplate(template, allRecipes, deps) {
    deps = deps || {};
    var getIngredient = deps.getIngredient || realCatalogGet();
    var computeNutrients = deps.computeNutrients || realCompute();
    allRecipes = allRecipes || {};

    var entries = [];
    var missing = [];
    var refs = (template && template.refs) || [];

    refs.forEach(function (ref) {
      var recipe = allRecipes[ref.recipeId];
      if (!recipe) {
        missing.push({ recipeId: ref.recipeId, reason: "recipe" });
        return;
      }
      var states = ref.ingredientStates || [];
      var badIngredient = states.some(function (s) { return getIngredient(s.id) == null; });
      if (badIngredient) {
        missing.push({ recipeId: ref.recipeId, reason: "ingredient" });
        return;
      }
      entries.push({
        id: newId(),
        recipeId: ref.recipeId,
        name: recipe.name,
        emoji: recipe.emoji,
        nutrients: computeNutrients(recipe, states),
        ingredientStates: states,
        timestamp: Date.now(),
      });
    });

    return { ok: missing.length === 0 && refs.length > 0, entries: entries, missing: missing };
  }

  // ── First-run seeding ─────────────────────────────────────────────────────
  // Builds example templates from specs ([{ name, emoji, recipeIds }]). Skips
  // any recipeId absent from allRecipes. Rejection budget: >3 consecutive
  // invalid recipeIds halts seeding and warns SEEDING_DEGRADED (the caller sets
  // onboarded=true regardless, so this never loops). Returns template[].
  function seedExamples(specs, allRecipes, deps) {
    deps = deps || {};
    var getIngredient = deps.getIngredient || realCatalogGet();
    allRecipes = allRecipes || {};
    specs = specs || [];

    var out = [];
    var consecutiveMisses = 0;

    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var refs = [];
      var ids = (spec && spec.recipeIds) || [];
      for (var j = 0; j < ids.length; j++) {
        var recipe = allRecipes[ids[j]];
        if (!recipe) {
          consecutiveMisses++;
          if (consecutiveMisses > SEED_REJECTION_BUDGET) {
            if (typeof console !== "undefined" && console.warn) {
              console.warn("SEEDING_DEGRADED: halted after " + consecutiveMisses +
                " consecutive invalid recipeIds (last: '" + ids[j] + "')");
            }
            return out;
          }
          continue;
        }
        consecutiveMisses = 0;
        refs.push({ recipeId: ids[j], ingredientStates: deriveStates(recipe, getIngredient) });
      }
      if (refs.length) out.push(buildTemplate(spec.name, spec.emoji, refs));
    }
    return out;
  }

  var api = {
    NAME_MAX: NAME_MAX,
    addTemplate: addTemplate,
    removeTemplate: removeTemplate,
    updateTemplate: updateTemplate,
    buildTemplate: buildTemplate,
    resolveTemplate: resolveTemplate,
    seedExamples: seedExamples,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.Templates = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
