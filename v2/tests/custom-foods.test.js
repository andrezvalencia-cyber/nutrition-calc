// Node unit tests for custom-foods.js
// Run with: node tests/custom-foods.test.js
"use strict";

const assert = require("assert");
const path = require("path");

const CustomFoods = require("../src/modules/customfoods/custom-foods.js");

// Schema oracle: module's NUTRIENT_KEYS must match data.js's.
const dataPath = path.resolve(__dirname, "../data.js");
const dataSource = require("fs").readFileSync(dataPath, "utf8");
const match = dataSource.match(/const NUTRIENT_KEYS\s*=\s*\[([\s\S]*?)\];/);
const dataKeys = match[1].match(/"(\w+)"/g).map((s) => s.replace(/"/g, ""));
assert.deepStrictEqual(
  CustomFoods.NUTRIENT_KEYS, dataKeys,
  "Module NUTRIENT_KEYS must match data.js"
);

// sanitizeNutrients — negatives → 0
(() => {
  const out = CustomFoods.sanitizeNutrients({ protein: -5, carbs: 10 });
  assert.strictEqual(out.protein, 0, "negative → 0");
  assert.strictEqual(out.carbs, 10, "positive preserved");
})();

// sanitizeNutrients — NaN / undefined / strings → 0
(() => {
  const out = CustomFoods.sanitizeNutrients({
    protein: NaN, carbs: undefined, fat: "hello", fiber: Infinity,
  });
  assert.strictEqual(out.protein, 0, "NaN → 0");
  assert.strictEqual(out.carbs, 0, "undefined → 0");
  assert.strictEqual(out.fat, 0, "non-numeric string → 0");
  assert.strictEqual(out.fiber, 0, "Infinity → 0 (non-finite)");
})();

// sanitizeNutrients — unknown keys dropped, all 16 present
(() => {
  const out = CustomFoods.sanitizeNutrients({ protein: 20, bogus: 999 });
  assert.strictEqual(Object.keys(out).length, 16, "exactly 16 keys");
  assert.strictEqual(out.bogus, undefined, "unknown key dropped");
  assert.strictEqual(out.protein, 20);
  assert.strictEqual(out.zinc, 0, "missing key defaults to 0");
})();

// sanitizeNutrients — numeric strings coerce correctly
(() => {
  const out = CustomFoods.sanitizeNutrients({ protein: "25.5", iron: "0" });
  assert.strictEqual(out.protein, 25.5, "numeric string coerced");
  assert.strictEqual(out.iron, 0, "'0' → 0");
})();

// buildCustomFood — name capped at NAME_MAX
(() => {
  const longName = "A".repeat(100);
  const cf = CustomFoods.buildCustomFood(longName, null, {});
  assert.strictEqual(cf.name.length, CustomFoods.NAME_MAX, "name capped");
  assert.strictEqual(cf.custom, true);
  assert.strictEqual(cf.barcode, null);
  assert.strictEqual(Object.keys(cf.nutrients).length, 16);
})();

// buildCustomFood — barcode preserved
(() => {
  const cf = CustomFoods.buildCustomFood("Test", null, {}, "1234567890");
  assert.strictEqual(cf.barcode, "1234567890");
})();

// addCustomFood — immutable append
(() => {
  const s0 = { customFoods: [] };
  const cf = CustomFoods.buildCustomFood("Apple", null, { protein: 1 });
  const s1 = CustomFoods.addCustomFood(s0, cf);
  assert.strictEqual(s1.customFoods.length, 1);
  assert.strictEqual(s0.customFoods.length, 0, "original unchanged");
})();

// updateCustomFood — merges and re-sanitizes nutrients
(() => {
  const cf = CustomFoods.buildCustomFood("Banana", null, { protein: 5 });
  const s0 = { customFoods: [cf] };
  const s1 = CustomFoods.updateCustomFood(s0, cf.id, { nutrients: { protein: -3, carbs: 20 } });
  assert.strictEqual(s1.customFoods[0].nutrients.protein, 0, "negative re-sanitized");
  assert.strictEqual(s1.customFoods[0].nutrients.carbs, 20);
})();

// removeCustomFood — immutable removal
(() => {
  const cf = CustomFoods.buildCustomFood("Grape", null, {});
  const s0 = { customFoods: [cf] };
  const s1 = CustomFoods.removeCustomFood(s0, cf.id);
  assert.strictEqual(s1.customFoods.length, 0);
  assert.strictEqual(s0.customFoods.length, 1, "original unchanged");
})();

// addCustomFood — works on state without customFoods key
(() => {
  const cf = CustomFoods.buildCustomFood("Mango", null, {});
  const s1 = CustomFoods.addCustomFood({}, cf);
  assert.strictEqual(s1.customFoods.length, 1);
})();

console.log("custom-foods.test.js: all tests passed");
