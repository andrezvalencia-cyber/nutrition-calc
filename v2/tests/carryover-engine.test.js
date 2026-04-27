// Pure-function unit tests for the carryover engine.
// Run via: node tests/carryover-engine.test.js
const assert = require("node:assert/strict");
const { computeCarryover, CONSTANTS } = require("../src/modules/carryover/carryover-engine.js");

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

const B12 = CONSTANTS.B12_DAILY_CARRYOVER_MCG;     // 714
const VITE = CONSTANTS.VIT_E_DAILY_CARRYOVER_MG;   // 38
const DAYS = CONSTANTS.CARRYOVER_DAYS;             // 6

// --- Constants sanity ---
test("constants match CLAUDE.md §5: B12 weekly/7 = 714", () => {
  assert.equal(B12, 714);
});
test("constants match CLAUDE.md §5: VitE weekly/7 = 38", () => {
  assert.equal(VITE, 38);
});
test("constants match CLAUDE.md §5: 6-day carryover window", () => {
  assert.equal(DAYS, 6);
});

// --- Empty / no-op ---
test("empty state returns all zeros", () => {
  const r = computeCarryover({});
  assert.deepEqual(r.carryover, { b12: 0, vit_e: 0, vit_d: 0 });
  assert.deepEqual(r.daysRemaining, { b12: 0, vit_e: 0 });
});

test("empty dayLog with no prev daysRemaining → zeros", () => {
  const r = computeCarryover({ dayLog: [], carryoverDaysRemaining: {} });
  assert.deepEqual(r.carryover, { b12: 0, vit_e: 0, vit_d: 0 });
  assert.deepEqual(r.daysRemaining, { b12: 0, vit_e: 0 });
});

// --- B12 trigger ---
test("B12 entry exactly at threshold (1000 mcg) triggers", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { b12: 1000 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.b12, B12);
  assert.equal(r.daysRemaining.b12, 6);
});

test("B12 entry just under threshold (999 mcg) does NOT trigger", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { b12: 999 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.b12, 0);
  assert.equal(r.daysRemaining.b12, 0);
});

test("B12 trigger overrides any prior daysRemaining (resets to 6)", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { b12: 5000 } }],
    carryoverDaysRemaining: { b12: 2 },
  });
  assert.equal(r.carryover.b12, B12);
  assert.equal(r.daysRemaining.b12, 6);
});

// --- B12 decrement ladder ---
[6, 5, 4, 3, 2].forEach((prev) => {
  test(`B12 decrement: prev=${prev} → carry=${B12}, days=${prev - 1}`, () => {
    const r = computeCarryover({
      dayLog: [],
      carryoverDaysRemaining: { b12: prev },
    });
    assert.equal(r.carryover.b12, B12);
    assert.equal(r.daysRemaining.b12, prev - 1);
  });
});

test("B12 decrement: prev=1 → carry=0, days=0 (reset; matches integration test #16)", () => {
  const r = computeCarryover({
    dayLog: [],
    carryoverDaysRemaining: { b12: 1 },
  });
  assert.equal(r.carryover.b12, 0);
  assert.equal(r.daysRemaining.b12, 0);
});

test("B12 decrement: prev=0 → stays 0", () => {
  const r = computeCarryover({
    dayLog: [],
    carryoverDaysRemaining: { b12: 0 },
  });
  assert.equal(r.carryover.b12, 0);
  assert.equal(r.daysRemaining.b12, 0);
});

// --- VitE mirrors B12 ---
test("VitE entry at threshold (100 mg) triggers", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { vit_e: 100 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.vit_e, VITE);
  assert.equal(r.daysRemaining.vit_e, 6);
});

test("VitE just under (99 mg) does NOT trigger", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { vit_e: 99 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.vit_e, 0);
  assert.equal(r.daysRemaining.vit_e, 0);
});

test("VitE decrement: prev=1 → reset", () => {
  const r = computeCarryover({
    dayLog: [],
    carryoverDaysRemaining: { vit_e: 1 },
  });
  assert.equal(r.carryover.vit_e, 0);
  assert.equal(r.daysRemaining.vit_e, 0);
});

// --- VitD dead field ---
test("VitD always 0 even with high VitD entries", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { vit_d: 5000 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.vit_d, 0);
});

test("VitD daysRemaining slot doesn't exist (no leak)", () => {
  const r = computeCarryover({});
  assert.equal(typeof r.daysRemaining.vit_d, "undefined");
});

// --- Combined / independence ---
test("B12 and VitE both trigger independently in the same day", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { b12: 1500, vit_e: 200 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.b12, B12);
  assert.equal(r.carryover.vit_e, VITE);
  assert.equal(r.daysRemaining.b12, 6);
  assert.equal(r.daysRemaining.vit_e, 6);
});

test("B12 trigger + VitE decrement in the same day are independent", () => {
  const r = computeCarryover({
    dayLog: [{ nutrients: { b12: 1500 } }],
    carryoverDaysRemaining: { b12: 0, vit_e: 4 },
  });
  assert.equal(r.carryover.b12, B12);
  assert.equal(r.daysRemaining.b12, 6);
  assert.equal(r.carryover.vit_e, VITE);
  assert.equal(r.daysRemaining.vit_e, 3);
});

// --- Defensive: malformed input ---
test("missing nutrients on an entry doesn't crash", () => {
  const r = computeCarryover({
    dayLog: [{}, { nutrients: { b12: 1000 } }],
    carryoverDaysRemaining: {},
  });
  assert.equal(r.carryover.b12, B12);
});

test("negative prev daysRemaining is treated as ≤ 1 (reset)", () => {
  const r = computeCarryover({
    dayLog: [],
    carryoverDaysRemaining: { b12: -3, vit_e: -1 },
  });
  assert.equal(r.carryover.b12, 0);
  assert.equal(r.carryover.vit_e, 0);
  assert.equal(r.daysRemaining.b12, 0);
  assert.equal(r.daysRemaining.vit_e, 0);
});

// --- Idempotence on the same input ---
test("computeCarryover is referentially deterministic (same input → same output)", () => {
  const input = {
    dayLog: [{ nutrients: { b12: 1500 } }],
    carryoverDaysRemaining: { b12: 3, vit_e: 2 },
  };
  const a = computeCarryover(input);
  const b = computeCarryover(input);
  assert.deepEqual(a, b);
});

test("computeCarryover does not mutate input state", () => {
  const input = {
    dayLog: [{ nutrients: { b12: 1500 } }],
    carryoverDaysRemaining: { b12: 3, vit_e: 2 },
  };
  const snapshot = JSON.stringify(input);
  computeCarryover(input);
  assert.equal(JSON.stringify(input), snapshot);
});

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
