// Pure-logic microbenchmark for hot Modules.* functions.
// Run via: node tests/benchmarks/performance.js   (from v2/)
// Or:      npm run bench                          (from v2/)
//
// Exits 0 when every target's median 1,000-call batch < THRESHOLD ms.
// Exits 1 on any breach.
//
// Env overrides:
//   BENCH_BATCHES=50        — number of timed batches (default 30)
//   BENCH_THRESHOLD_MS=3    — per-batch median ceiling (default 5)

const { performance } = require("node:perf_hooks");

const BATCHES = parseInt(process.env.BENCH_BATCHES, 10) || 30;
const CALLS_PER_BATCH = 1000;
const THRESHOLD_MS = parseFloat(process.env.BENCH_THRESHOLD_MS) || 5;
const WARMUP_CALLS = 2000;

// ---------------------------------------------------------------------------
// Load dual-mode modules
// ---------------------------------------------------------------------------
const SyncMap = require("../../src/modules/sync/sync-map.js");
const Carryover = require("../../src/modules/carryover/carryover-engine.js");
const Insights = require("../../src/modules/insights/insights-engine.js");

// ---------------------------------------------------------------------------
// Stub data.js globals needed by Insights.aggregate
// ---------------------------------------------------------------------------
const NUTRIENT_KEYS = [
  "protein","carbs","fat","fiber","sat_fat","epa_dha",
  "calcium","iron","zinc","vit_d","vit_e","b12",
  "folate","vit_c","potassium","magnesium"
];
const OBJECTIVES = {
  protein:   { min:116, max:145, type:"range" },
  carbs:     { min:363, max:508, type:"range" },
  fat:       { min:65,  max:85,  type:"range" },
  fiber:     { min:38,  max:null, type:"minimum" },
  sat_fat:   { min:null, max:28, type:"maximum" },
  epa_dha:   { min:250, max:1000, type:"range" },
  calcium:   { min:1000, max:null, type:"minimum" },
  iron:      { min:8,   max:null, type:"minimum" },
  zinc:      { min:11,  max:null, type:"minimum" },
  vit_d:     { min:800, max:2000, type:"range" },
  vit_e:     { min:15,  max:20, type:"range" },
  b12:       { min:2.4, max:null, type:"minimum" },
  folate:    { min:400, max:null, type:"minimum" },
  vit_c:     { min:90,  max:null, type:"minimum" },
  potassium: { min:3400, max:4000, type:"range" },
  magnesium: { min:420, max:null, type:"minimum" }
};

function getStatus(key, value) {
  var obj = OBJECTIVES[key];
  if (!obj) return { pct:0, closed:false, label:"?" };
  var min = obj.min, max = obj.max, type = obj.type;
  if (type === "maximum") {
    var pct = Math.round((value / max) * 100);
    return { pct: pct, closed: value < max, label: "" };
  }
  if (type === "minimum") {
    var pct = Math.round((value / min) * 100);
    return { pct: pct, closed: value >= min, label: "" };
  }
  if (value >= min && (max === null || value <= max))
    return { pct:100, closed:true, label:"" };
  if (value < min) {
    var pct = Math.round((value / min) * 100);
    return { pct: pct, closed:false, label:"" };
  }
  var pct = Math.round((value / max) * 100);
  return { pct: pct, closed:false, label:"" };
}

globalThis.NUTRIENT_KEYS = NUTRIENT_KEYS;
globalThis.OBJECTIVES = OBJECTIVES;
globalThis.getStatus = getStatus;

// ---------------------------------------------------------------------------
// Test fixtures — realistic but deterministic
// ---------------------------------------------------------------------------
function makeDayTotals(seed) {
  var t = {};
  NUTRIENT_KEYS.forEach(function (k, i) {
    t[k] = ((seed * 17 + i * 31) % 200) + 10;
  });
  return t;
}

function makeEntries(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      id: "e" + i,
      recipeId: "r" + (i % 5),
      name: "Entry " + i,
      emoji: "",
      nutrients: makeDayTotals(i),
      ingredientStates: [],
      timestamp: Date.now() - i * 60000,
    });
  }
  return out;
}

function makeDayHistory(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      date: "2026-01-" + String(i + 1).padStart(2, "0"),
      totals: makeDayTotals(i + 100),
      gapsClosed: (i * 3) % 16,
      energy: i % 3 === 0 ? null : (i % 5) + 1,
      digestion: i % 4 === 0 ? null : (i % 5) + 1,
    });
  }
  return out;
}

// Fixtures for each target
var prevState = {
  dayHistory: makeDayHistory(14),
  dayLog: makeEntries(8),
};
var remoteDays = makeDayHistory(7).map(function (d, i) {
  d.date = "2026-02-" + String(i + 1).padStart(2, "0");
  return d;
});
var remoteEntries = makeEntries(5).map(function (e, i) {
  e.id = "remote" + i;
  return e;
});

var carryoverState = {
  dayLog: [
    { nutrients: { b12: 1500, vit_e: 200 } },
    { nutrients: { b12: 50, vit_e: 10 } },
  ],
  carryoverDaysRemaining: { b12: 4, vit_e: 3 },
};

var insightsSlice = makeDayHistory(7);

var singleEntry = makeEntries(1)[0];

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------
function median(arr) {
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pct(arr, p) {
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var idx = Math.ceil(s.length * p / 100) - 1;
  return s[Math.max(0, idx)];
}

function mean(arr) {
  return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
}

function bench(name, fn) {
  // Warmup
  var sink = 0;
  for (var w = 0; w < WARMUP_CALLS; w++) {
    var r = fn();
    if (r && typeof r === "object") sink += Object.keys(r).length;
    else if (typeof r === "number") sink += r;
  }

  // Timed batches
  var times = [];
  for (var b = 0; b < BATCHES; b++) {
    var t0 = performance.now();
    for (var c = 0; c < CALLS_PER_BATCH; c++) {
      var r = fn();
      if (r && typeof r === "object") sink += Object.keys(r).length;
      else if (typeof r === "number") sink += r;
    }
    times.push(performance.now() - t0);
  }

  var med = median(times);
  var pass = med < THRESHOLD_MS;

  console.log(
    (pass ? "  PASS " : "  FAIL ") + name +
    "  median=" + med.toFixed(3) + "ms" +
    "  mean=" + mean(times).toFixed(3) + "ms" +
    "  min=" + Math.min.apply(null, times).toFixed(3) + "ms" +
    "  p95=" + pct(times, 95).toFixed(3) + "ms" +
    "  (sink=" + sink + ")"
  );

  return pass;
}

// ---------------------------------------------------------------------------
// Run benchmarks
// ---------------------------------------------------------------------------
console.log("Performance benchmark — " + BATCHES + " batches x " +
  CALLS_PER_BATCH + " calls, threshold < " + THRESHOLD_MS + " ms/batch\n");

var allPass = true;

allPass = bench("SyncMap.mergeHydration", function () {
  return SyncMap.mergeHydration(prevState, remoteDays, remoteEntries);
}) && allPass;

allPass = bench("SyncMap.buildEntryRow", function () {
  return SyncMap.buildEntryRow(singleEntry, "user-123", "2026-06-17");
}) && allPass;

allPass = bench("Carryover.computeCarryover", function () {
  return Carryover.computeCarryover(carryoverState);
}) && allPass;

allPass = bench("Insights.aggregate", function () {
  return Insights.aggregate(insightsSlice);
}) && allPass;

console.log(allPass
  ? "\nAll targets under " + THRESHOLD_MS + " ms threshold."
  : "\nThreshold breached — see FAIL lines above.");

process.exit(allPass ? 0 : 1);
