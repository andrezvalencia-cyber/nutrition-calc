// Pure-function unit tests for the Insights engine (heatmapColor).
// Run via: node tests/insights-engine.test.js
//
// insights-engine.js depends on data.js globals (NUTRIENT_KEYS, etc.) in the
// browser, but heatmapColor is self-contained. We require the module in Node
// via the dual-mode footer.
const assert = require("node:assert/strict");
const Insights = require("../src/modules/insights/insights-engine.js");

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

const heatmapColor = Insights.heatmapColor;

// ═══════════════════════════════════════════════════════════════
// heatmapColor
// ═══════════════════════════════════════════════════════════════

test("null pct → neutral grey (dark)", () => {
  assert.equal(heatmapColor(null, true, false), "hsl(0,0%,18%)");
});

test("null pct → neutral grey (light)", () => {
  assert.equal(heatmapColor(null, false, false), "hsl(0,0%,92%)");
});

test("undefined pct → neutral grey (dark)", () => {
  assert.equal(heatmapColor(undefined, true, false), "hsl(0,0%,18%)");
});

test("undefined pct → neutral grey (light)", () => {
  assert.equal(heatmapColor(undefined, false, false), "hsl(0,0%,92%)");
});

test("0% dark non-max → zero saturation/lightness (grey)", () => {
  const c = heatmapColor(0, true, false);
  assert.match(c, /^hsl\(0,0%,18%\)$/);
});

test("0% light non-max → zero saturation/lightness (grey)", () => {
  const c = heatmapColor(0, false, false);
  assert.match(c, /^hsl\(0,0%,92%\)$/);
});

test("100% dark non-max → high hue (green region)", () => {
  const c = heatmapColor(100, true, false);
  assert.match(c, /^hsl\(/);
  const hue = parseFloat(c.match(/hsl\(([^,]+)/)[1]);
  assert.ok(hue > 90, "hue should be > 90 for 100%, got " + hue);
});

test("100% light non-max → high hue (green region)", () => {
  const c = heatmapColor(100, false, false);
  const hue = parseFloat(c.match(/hsl\(([^,]+)/)[1]);
  assert.ok(hue > 90, "hue should be > 90 for 100%, got " + hue);
});

test("isMaxType inverts: 100% max → low hue (red region)", () => {
  const c = heatmapColor(100, true, true);
  const hue = parseFloat(c.match(/hsl\(([^,]+)/)[1]);
  assert.ok(hue < 40, "hue should be < 40 for 100% max type, got " + hue);
});

test("isMaxType inverts: 0% max → high hue (green region)", () => {
  const c = heatmapColor(0, true, true);
  const hue = parseFloat(c.match(/hsl\(([^,]+)/)[1]);
  assert.ok(hue > 100, "hue should be > 100 for 0% max type, got " + hue);
});

test("pct > 120 is clamped (non-max)", () => {
  const c120 = heatmapColor(120, true, false);
  const c200 = heatmapColor(200, true, false);
  assert.equal(c120, c200);
});

test("dark vs light produce different outputs for same pct", () => {
  const dark = heatmapColor(50, true, false);
  const light = heatmapColor(50, false, false);
  assert.notEqual(dark, light);
});

test("returns a string starting with hsl(", () => {
  for (const pct of [0, 25, 50, 75, 100, 120]) {
    for (const isDark of [true, false]) {
      for (const isMax of [true, false]) {
        const c = heatmapColor(pct, isDark, isMax);
        assert.ok(typeof c === "string" && c.startsWith("hsl("),
          "Expected hsl string for pct=" + pct + " dark=" + isDark + " max=" + isMax + ", got " + c);
      }
    }
  }
});

test("deterministic: same input → same output", () => {
  const a = heatmapColor(75, true, false);
  const b = heatmapColor(75, true, false);
  assert.equal(a, b);
});

// --- Summary ---
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
