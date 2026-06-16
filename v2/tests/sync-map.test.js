// Pure-function unit tests for the SyncMap module.
// Run via: node tests/sync-map.test.js
const assert = require("node:assert/strict");
const SyncMap = require("../src/modules/sync/sync-map.js");

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

// ═══════════════════════════════════════════════════════════════
// buildEntryRow
// ═══════════════════════════════════════════════════════════════

test("buildEntryRow: happy path — all fields map correctly", () => {
  const entry = {
    id: "e1",
    recipeId: "r1",
    name: "Oatmeal",
    emoji: "🥣",
    nutrients: { protein: 10 },
    ingredientStates: [{ id: "oats", qty: 1 }],
    timestamp: 1700000000000,
  };
  const row = SyncMap.buildEntryRow(entry, "u1", "2024-11-14");
  assert.equal(row.idempotency_key, "e1");
  assert.equal(row.user_id, "u1");
  assert.equal(row.day_date, "2024-11-14");
  assert.equal(row.recipe_id, "r1");
  assert.equal(row.name, "Oatmeal");
  assert.equal(row.emoji, "🥣");
  assert.deepEqual(row.nutrients, { protein: 10 });
  assert.deepEqual(row.ingredient_states, [{ id: "oats", qty: 1 }]);
  assert.equal(row.logged_at, new Date(1700000000000).toISOString());
});

test("buildEntryRow: missing optionals default safely", () => {
  const entry = { id: "e2", name: "Quick entry", nutrients: { protein: 5 } };
  const row = SyncMap.buildEntryRow(entry, "u1", "2024-01-01");
  assert.equal(row.recipe_id, null);
  assert.equal(row.emoji, "");
  assert.deepEqual(row.ingredient_states, []);
  assert.ok(row.logged_at); // ISO string from Date.now()
});

test("buildEntryRow: null entry does not throw", () => {
  const row = SyncMap.buildEntryRow(null, "u1", "2024-01-01");
  assert.equal(row.user_id, "u1");
  assert.equal(row.recipe_id, null);
  assert.equal(row.emoji, "");
});

// ═══════════════════════════════════════════════════════════════
// buildDayRow
// ═══════════════════════════════════════════════════════════════

test("buildDayRow: happy path — all fields map correctly", () => {
  const hist = {
    date: "2024-11-14",
    gapsClosed: 12,
    energy: 4,
    digestion: 3,
    notes: "Good day",
    totals: { protein: 80 },
  };
  const carry = { b12: 714, vit_e: 0, vit_d: 0 };
  const row = SyncMap.buildDayRow(hist, carry, "u1");
  assert.equal(row.user_id, "u1");
  assert.equal(row.day_date, "2024-11-14");
  assert.equal(row.gaps_closed, 12);
  assert.equal(row.energy, 4);
  assert.equal(row.digestion, 3);
  assert.equal(row.notes, "Good day");
  assert.deepEqual(row.totals, { protein: 80 });
  assert.deepEqual(row.carryover, carry);
  assert.ok(row.updated_at);
});

test("buildDayRow: missing optionals default safely", () => {
  const hist = { date: "2024-01-01" };
  const row = SyncMap.buildDayRow(hist, null, "u1");
  assert.equal(row.gaps_closed, 0);
  assert.equal(row.energy, null);
  assert.equal(row.digestion, null);
  assert.equal(row.notes, "");
  assert.deepEqual(row.totals, {});
  assert.deepEqual(row.carryover, {});
});

test("buildDayRow: null histEntry does not throw", () => {
  const row = SyncMap.buildDayRow(null, null, "u1");
  assert.equal(row.user_id, "u1");
  assert.equal(row.gaps_closed, 0);
});

// ═══════════════════════════════════════════════════════════════
// isSyncEnabled
// ═══════════════════════════════════════════════════════════════

test("isSyncEnabled: all conditions met → true", () => {
  const auth = { status: "signed_in", user: { id: "u1" } };
  const state = { cloudSync: true };
  assert.equal(SyncMap.isSyncEnabled(auth, state, true), true);
});

test("isSyncEnabled: no WriteBehind → false", () => {
  const auth = { status: "signed_in", user: { id: "u1" } };
  const state = { cloudSync: true };
  assert.equal(SyncMap.isSyncEnabled(auth, state, false), false);
});

test("isSyncEnabled: cloudSync off → false", () => {
  const auth = { status: "signed_in", user: { id: "u1" } };
  const state = { cloudSync: false };
  assert.equal(SyncMap.isSyncEnabled(auth, state, true), false);
});

test("isSyncEnabled: not signed in → false", () => {
  const auth = { status: "signed_out", user: null };
  const state = { cloudSync: true };
  assert.equal(SyncMap.isSyncEnabled(auth, state, true), false);
});

test("isSyncEnabled: null auth → false", () => {
  assert.equal(SyncMap.isSyncEnabled(null, { cloudSync: true }, true), false);
});

test("isSyncEnabled: null state → false", () => {
  const auth = { status: "signed_in", user: { id: "u1" } };
  assert.equal(SyncMap.isSyncEnabled(auth, null, true), false);
});

// ═══════════════════════════════════════════════════════════════
// mergeHydration
// ═══════════════════════════════════════════════════════════════

test("mergeHydration: appends new dates, deduplicates existing", () => {
  const prev = {
    dayHistory: [{ date: "2024-01-01", g: 1 }],
    dayLog: [{ id: "e1", n: 1 }],
  };
  const days = [
    { date: "2024-01-02", g: 2 },
    { date: "2024-01-01", g: 99 }, // duplicate — must be dropped
  ];
  const entries = [
    { id: "e2", n: 2 },
    { id: "e1", n: 99 }, // duplicate — must be dropped
  ];
  const result = SyncMap.mergeHydration(prev, days, entries);
  assert.equal(result.dayHistory.length, 2);
  assert.equal(result.dayHistory[0].date, "2024-01-01");
  assert.equal(result.dayHistory[0].g, 1); // original preserved, not overwritten
  assert.equal(result.dayHistory[1].date, "2024-01-02");
  assert.equal(result.dayLog.length, 2);
  assert.equal(result.dayLog[0].id, "e1");
  assert.equal(result.dayLog[0].n, 1); // original preserved
  assert.equal(result.dayLog[1].id, "e2");
});

test("mergeHydration: out-of-order dates are sorted ascending", () => {
  const prev = {
    dayHistory: [{ date: "2024-01-15" }],
    dayLog: [],
  };
  const days = [
    { date: "2024-01-05" },
    { date: "2024-01-25" },
    { date: "2024-01-10" },
  ];
  const result = SyncMap.mergeHydration(prev, days, []);
  const dates = result.dayHistory.map(function (d) { return d.date; });
  assert.deepEqual(dates, ["2024-01-05", "2024-01-10", "2024-01-15", "2024-01-25"]);
});

test("mergeHydration: empty incoming does not mutate", () => {
  const prev = {
    dayHistory: [{ date: "2024-01-01" }],
    dayLog: [{ id: "e1" }],
    otherField: "kept",
  };
  const result = SyncMap.mergeHydration(prev, [], []);
  assert.equal(result.dayHistory.length, 1);
  assert.equal(result.dayLog.length, 1);
  assert.equal(result.otherField, "kept");
});

test("mergeHydration: empty prevState gets populated", () => {
  const result = SyncMap.mergeHydration({}, [{ date: "2024-01-01" }], [{ id: "e1" }]);
  assert.equal(result.dayHistory.length, 1);
  assert.equal(result.dayLog.length, 1);
});

test("mergeHydration: null inputs default safely", () => {
  const result = SyncMap.mergeHydration(null, null, null);
  assert.deepEqual(result.dayHistory, []);
  assert.deepEqual(result.dayLog, []);
});

test("mergeHydration: does not mutate input prevState", () => {
  const prev = {
    dayHistory: [{ date: "2024-01-01" }],
    dayLog: [{ id: "e1" }],
  };
  const snapshot = JSON.stringify(prev);
  SyncMap.mergeHydration(prev, [{ date: "2024-02-01" }], [{ id: "e2" }]);
  assert.equal(JSON.stringify(prev), snapshot);
});

test("mergeHydration: adversarial — duplicate ids across dayLog and incoming entries", () => {
  const prev = {
    dayHistory: [],
    dayLog: [{ id: "dup1", val: "local" }, { id: "dup2", val: "local" }],
  };
  const entries = [
    { id: "dup1", val: "remote" },
    { id: "new1", val: "remote" },
    { id: "dup2", val: "remote" },
    { id: "new2", val: "remote" },
  ];
  const result = SyncMap.mergeHydration(prev, [], entries);
  assert.equal(result.dayLog.length, 4); // 2 local + 2 new
  const ids = result.dayLog.map(function (e) { return e.id; });
  assert.deepEqual(ids, ["dup1", "dup2", "new1", "new2"]);
  // Originals not overwritten
  assert.equal(result.dayLog[0].val, "local");
  assert.equal(result.dayLog[1].val, "local");
});

test("mergeHydration: adversarial — duplicate dates across dayHistory and incoming days", () => {
  const prev = {
    dayHistory: [
      { date: "2024-03-01", val: "local" },
      { date: "2024-01-01", val: "local" },
    ],
    dayLog: [],
  };
  const days = [
    { date: "2024-03-01", val: "remote" }, // dup
    { date: "2024-02-01", val: "remote" },
    { date: "2024-01-01", val: "remote" }, // dup
    { date: "2024-04-01", val: "remote" },
  ];
  const result = SyncMap.mergeHydration(prev, days, []);
  assert.equal(result.dayHistory.length, 4);
  const dates = result.dayHistory.map(function (d) { return d.date; });
  assert.deepEqual(dates, ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]);
  // Originals not overwritten
  const jan = result.dayHistory.find(function (d) { return d.date === "2024-01-01"; });
  assert.equal(jan.val, "local");
  const mar = result.dayHistory.find(function (d) { return d.date === "2024-03-01"; });
  assert.equal(mar.val, "local");
});

// --- Summary ---
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
