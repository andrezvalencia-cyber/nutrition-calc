// Pure-function unit tests for the Templates module.
// Run via: node tests/templates.test.js
const assert = require("node:assert/strict");
const T = require("../src/modules/templates/templates.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (err) {
    failed++;
    console.error("  FAIL " + name);
    console.error("       " + (err.stack || err.message));
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const allRecipes = {
  morning_shake: { name: "Morning Shake", emoji: "S", ingredients: [{ id: "pea_protein", swapGroup: null }] },
  supp_b12:      { name: "B12",           emoji: "P", ingredients: [{ id: "supp_b12", swapGroup: null }] },
};
const knownIng = { pea_protein: { defaultQty: 48 }, supp_b12: { defaultQty: 1 } };
const deps = {
  getIngredient: (id) => knownIng[id] || null,
  computeNutrients: (recipe, states) => ({ protein: states.length }),
};

// ── buildTemplate ─────────────────────────────────────────────────────────
test("buildTemplate caps name at NAME_MAX and sets fields", () => {
  const long = "x".repeat(100);
  const tpl = T.buildTemplate(long, "E", [{ recipeId: "morning_shake", ingredientStates: [] }]);
  assert.equal(tpl.name.length, T.NAME_MAX);
  assert.equal(tpl.emoji, "E");
  assert.ok(tpl.id);
  assert.equal(typeof tpl.createdAt, "number");
  assert.equal(tpl.refs.length, 1);
});

test("buildTemplate falls back to 'Untitled' for blank name", () => {
  const tpl = T.buildTemplate("   ", "", []);
  assert.equal(tpl.name, "Untitled");
  assert.deepEqual(tpl.refs, []);
});

// ── add / remove (immutable) ────────────────────────────────────────────────
test("addTemplate appends without mutating the source state", () => {
  const state = { templates: [] };
  const tpl = T.buildTemplate("A", "x", []);
  const next = T.addTemplate(state, tpl);
  assert.equal(next.templates.length, 1);
  assert.equal(state.templates.length, 0); // unchanged
  assert.notEqual(next, state);
});

test("removeTemplate filters by id immutably", () => {
  const tpl = T.buildTemplate("A", "x", []);
  const state = { templates: [tpl] };
  const next = T.removeTemplate(state, tpl.id);
  assert.equal(next.templates.length, 0);
  assert.equal(state.templates.length, 1); // unchanged
});

// ── resolveTemplate (degraded oracle) ───────────────────────────────────────
test("resolveTemplate ok=true when every ref resolves", () => {
  const tpl = T.buildTemplate("Good", "x", [
    { recipeId: "morning_shake", ingredientStates: [{ id: "pea_protein", qty: 48 }] },
  ]);
  const res = T.resolveTemplate(tpl, allRecipes, deps);
  assert.equal(res.ok, true);
  assert.equal(res.missing.length, 0);
  assert.equal(res.entries.length, 1);
  assert.equal(res.entries[0].recipeId, "morning_shake");
});

test("resolveTemplate degraded (ok=false) for a missing recipe — no throw", () => {
  const tpl = T.buildTemplate("Broken", "x", [
    { recipeId: "does_not_exist", ingredientStates: [] },
  ]);
  let res;
  assert.doesNotThrow(() => { res = T.resolveTemplate(tpl, allRecipes, deps); });
  assert.equal(res.ok, false);
  assert.equal(res.entries.length, 0);
  assert.equal(res.missing[0].recipeId, "does_not_exist");
  assert.equal(res.missing[0].reason, "recipe");
});

test("resolveTemplate degraded for a recipe with an unknown ingredient id", () => {
  const tpl = T.buildTemplate("BadIng", "x", [
    { recipeId: "morning_shake", ingredientStates: [{ id: "ghost_ingredient", qty: 1 }] },
  ]);
  const res = T.resolveTemplate(tpl, allRecipes, deps);
  assert.equal(res.ok, false);
  assert.equal(res.missing[0].reason, "ingredient");
});

test("resolveTemplate ok=false for an empty template (nothing to log)", () => {
  const res = T.resolveTemplate({ refs: [] }, allRecipes, deps);
  assert.equal(res.ok, false);
});

// ── seedExamples ─────────────────────────────────────────────────────────────
test("seedExamples builds templates from valid specs, skipping unknown ids", () => {
  const specs = [
    { name: "Breakfast", emoji: "b", recipeIds: ["morning_shake", "ghost_recipe"] },
    { name: "Vitality",  emoji: "v", recipeIds: ["supp_b12"] },
  ];
  const out = T.seedExamples(specs, allRecipes, deps);
  assert.equal(out.length, 2);
  assert.equal(out[0].refs.length, 1); // ghost_recipe skipped
  assert.equal(out[0].refs[0].recipeId, "morning_shake");
  assert.equal(out[1].refs[0].recipeId, "supp_b12");
});

test("seedExamples derives ingredientStates with catalog defaultQty", () => {
  const specs = [{ name: "Breakfast", emoji: "b", recipeIds: ["morning_shake"] }];
  const out = T.seedExamples(specs, allRecipes, deps);
  assert.equal(out[0].refs[0].ingredientStates[0].qty, 48);
});

test("seedExamples rejection budget halts after >3 consecutive invalid ids", () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const specs = [
      { name: "AllBad", emoji: "x", recipeIds: ["n1", "n2", "n3", "n4", "morning_shake"] },
    ];
    const out = T.seedExamples(specs, allRecipes, deps);
    assert.equal(out.length, 0); // halted before reaching morning_shake
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.some((w) => w.includes("SEEDING_DEGRADED")));
});

test("seedExamples: a success resets the consecutive-miss counter", () => {
  const specs = [
    { name: "Mixed", emoji: "x", recipeIds: ["n1", "morning_shake", "n2", "n3"] },
  ];
  const out = T.seedExamples(specs, allRecipes, deps);
  assert.equal(out.length, 1);          // not halted
  assert.equal(out[0].refs.length, 1);  // only morning_shake resolved
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
