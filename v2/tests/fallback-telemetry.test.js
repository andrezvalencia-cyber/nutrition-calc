// Node unit tests for fallback-engine.js
// Run with: node tests/fallback-telemetry.test.js
"use strict";

var assert = require("assert");

// Load the module (attaches to module.exports in Node)
var Fallbacks = require("../src/modules/fallbacks/fallback-engine.js");
assert.ok(Fallbacks, "Fallbacks module must be defined");
assert.ok(typeof Fallbacks.resolveTarget === "function", "resolveTarget must be a function");
assert.ok(typeof Fallbacks.buildProfile === "function", "buildProfile must be a function");

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✔ " + name);
  } catch (e) {
    failed++;
    console.error("  ✘ " + name);
    console.error("    " + e.message);
  }
}

console.log("\nfallback-engine tests\n");

// ── Assertion A: data gap fires callback exactly once ────────────────────────
test("missing profile value falls back to defaults and fires callback once", function () {
  var calls = [];
  var mock = function (ctx) { calls.push(ctx); };

  var result = Fallbacks.resolveTarget("calories", {}, {
    defaults: { calories: 2400 },
    onFallbackTriggered: mock,
  });

  assert.strictEqual(result, 2400);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].key, "calories");
  assert.strictEqual(calls[0].reason, "missing_profile_value");
  assert.strictEqual(calls[0].value, 2400);
  assert.strictEqual(calls[0].source, "default");
});

// ── Assertion B: profile value present → no callback ─────────────────────────
test("profile value present returns it and fires zero times", function () {
  var calls = [];
  var mock = function (ctx) { calls.push(ctx); };

  var result = Fallbacks.resolveTarget("calories", { calories: 1800 }, {
    defaults: { calories: 2400 },
    onFallbackTriggered: mock,
  });

  assert.strictEqual(result, 1800);
  assert.strictEqual(calls.length, 0);
});

// ── Assertion B (cont): fallback returns defaults number ─────────────────────
test("null profile falls back to defaults value", function () {
  var calls = [];
  var result = Fallbacks.resolveTarget("protein", null, {
    defaults: { protein: 116 },
    onFallbackTriggered: function (ctx) { calls.push(ctx); },
  });

  assert.strictEqual(result, 116);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].source, "default");
});

// ── Resilience: malformed defaults → unity 1.0, FALLBACK_CONFIG_ERROR ────────
test("malformed defaults (null) returns unity 1.0 and fires FALLBACK_CONFIG_ERROR", function () {
  var calls = [];
  var result = Fallbacks.resolveTarget("calories", null, {
    defaults: null,
    onFallbackTriggered: function (ctx) { calls.push(ctx); },
  });

  assert.strictEqual(result, 1.0);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].reason, "FALLBACK_CONFIG_ERROR");
  assert.strictEqual(calls[0].value, 1.0);
  assert.strictEqual(calls[0].source, "unity");
});

test("NaN in defaults triggers unity fallback", function () {
  var calls = [];
  var result = Fallbacks.resolveTarget("calories", { calories: NaN }, {
    defaults: { calories: NaN },
    onFallbackTriggered: function (ctx) { calls.push(ctx); },
  });

  assert.strictEqual(result, 1.0);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].reason, "FALLBACK_CONFIG_ERROR");
});

test("string in defaults triggers unity fallback", function () {
  var calls = [];
  var result = Fallbacks.resolveTarget("calories", { calories: "bad" }, {
    defaults: { calories: "also bad" },
    onFallbackTriggered: function (ctx) { calls.push(ctx); },
  });

  assert.strictEqual(result, 1.0);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].reason, "FALLBACK_CONFIG_ERROR");
});

// ── Adversarial: BOTH profile AND defaults malformed ─────────────────────────
test("both profile and defaults malformed → unity 1.0, exactly one FALLBACK_CONFIG_ERROR, no throw", function () {
  var calls = [];
  var threw = false;
  var result;
  try {
    result = Fallbacks.resolveTarget("anything", "not an object", {
      defaults: 42,
      onFallbackTriggered: function (ctx) { calls.push(ctx); },
    });
  } catch (e) {
    threw = true;
  }

  assert.strictEqual(threw, false, "must not throw");
  assert.strictEqual(result, 1.0, "must return unity");
  assert.strictEqual(calls.length, 1, "must fire exactly one callback");
  assert.strictEqual(calls[0].reason, "FALLBACK_CONFIG_ERROR");
  assert.strictEqual(calls[0].source, "unity");
});

// ── Custom unity override ────────────────────────────────────────────────────
test("custom unity override is used when falling through", function () {
  var result = Fallbacks.resolveTarget("x", null, {
    defaults: null,
    onFallbackTriggered: function () {},
    unity: 42,
  });
  assert.strictEqual(result, 42);
});

// ── No callback provided → does not crash ────────────────────────────────────
test("no onFallbackTriggered callback does not crash", function () {
  var result = Fallbacks.resolveTarget("x", null, { defaults: { x: 10 } });
  assert.strictEqual(result, 10);

  var result2 = Fallbacks.resolveTarget("x", null, { defaults: null });
  assert.strictEqual(result2, 1.0);
});

// ── buildProfile tests ───────────────────────────────────────────────────────
test("buildProfile maps 4 answers to profile with completed flag", function () {
  var profile = Fallbacks.buildProfile({
    calories: 2400,
    goal: "maintain",
    diet: "omnivore",
    protein: "standard",
  });

  assert.ok(profile, "must return an object");
  assert.strictEqual(profile.completed, true);
  assert.strictEqual(profile.calories, 2400);
  assert.strictEqual(profile.goal, "maintain");
  assert.strictEqual(profile.diet, "omnivore");
  assert.ok(typeof profile.protein === "number", "protein should be derived as number");
  assert.ok(typeof profile.carbs === "number", "carbs should be derived as number");
  assert.ok(typeof profile.fat === "number", "fat should be derived as number");
});

test("buildProfile with lose goal reduces calories", function () {
  var profile = Fallbacks.buildProfile({
    calories: 2400,
    goal: "lose",
    diet: "omnivore",
    protein: "standard",
  });

  assert.strictEqual(profile.calories, Math.round(2400 * 0.85));
});

test("buildProfile with high protein increases protein target", function () {
  var standard = Fallbacks.buildProfile({ calories: 2400, goal: "maintain", diet: "omnivore", protein: "standard" });
  var high = Fallbacks.buildProfile({ calories: 2400, goal: "maintain", diet: "omnivore", protein: "high" });

  assert.ok(high.protein > standard.protein, "high protein target should exceed standard");
});

test("buildProfile with null/undefined returns null", function () {
  assert.strictEqual(Fallbacks.buildProfile(null), null);
  assert.strictEqual(Fallbacks.buildProfile(undefined), null);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + passed + " passed, " + failed + " failed\n");
if (failed > 0) process.exit(1);
