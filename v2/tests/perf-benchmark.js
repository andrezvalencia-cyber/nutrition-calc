/*
 * Perf benchmark harness for Vitality Nutrition Calculator V2.
 *
 * Prerequisites (same contract as the integration suite):
 *   - A static server must already be serving v2/ on http://localhost:8765
 *     e.g.   (cd v2 && npx serve -p 8765 &)
 *
 * Usage:
 *   node tests/perf-benchmark.js                       # 10 runs, writes perf-baseline.json
 *   PERF_OUT=perf-after.json node tests/perf-benchmark.js
 *   PERF_RUNS=5 node tests/perf-benchmark.js           # faster smoke
 *
 * What it measures:
 *   Target 1: home page load under Fast 3G throttle
 *     - FCP, LCP, domInteractive, loadEventEnd
 *     - Total Blocking Time proxy (sum of longtask > 50 ms)
 *     - Transfer bytes via PerformanceResourceTiming
 *   Target 2: Log Entry sheet open (click-to-paint) — INP-adjacent
 *     - Time from click on the `add_circle` button to the first paint where
 *       the `.fixed.inset-0.z-50` sheet container is mounted. Not LCP —
 *       post-load UI paints don't update LCP; this is a "time-to-sheet" metric.
 *
 * Output: median + p75 + min/max for each metric, per cold/warm cache.
 */

const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.PERF_URL || "http://localhost:8765/";
const RUNS = parseInt(process.env.PERF_RUNS || "10", 10);
const OUT_PATH = path.join(__dirname, process.env.PERF_OUT || "perf-baseline.json");

// Fast 3G — matches Chrome DevTools preset.
const FAST_3G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8, // bytes/sec
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function p75(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.ceil(s.length * 0.75) - 1, s.length - 1);
  return s[Math.max(0, idx)];
}
function summarize(rows, keys) {
  const out = {};
  for (const k of keys) {
    const vals = rows.map((r) => r[k]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    out[k] = vals.length
      ? {
          median: +median(vals).toFixed(1),
          p75: +p75(vals).toFixed(1),
          min: +Math.min(...vals).toFixed(1),
          max: +Math.max(...vals).toFixed(1),
          n: vals.length,
        }
      : { median: null, p75: null, min: null, max: null, n: 0 };
  }
  return out;
}

async function applyThrottle(client, cold) {
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", FAST_3G);
  if (cold) {
    await client.send("Network.clearBrowserCache");
    await client.send("Network.clearBrowserCookies");
  }
}

// Init script installed before every document: registers buffered observers
// for LCP and long tasks (FCP is buffered by default). Without this,
// performance.getEntriesByType('largest-contentful-paint') returns []
// because Chromium only retains LCP entries when an observer is attached.
const OBSERVER_INIT = `
  (function () {
    window.__perfLcp = null;
    window.__perfLongtasks = [];
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length) window.__perfLcp = entries[entries.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) {}
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) { window.__perfLongtasks.push(e.duration); });
      }).observe({ type: "longtask", buffered: true });
    } catch (e) {}
  })();
`;

async function measureHome(browser, { cold }) {
  const context = await browser.newContext();
  await context.addInitScript(OBSERVER_INIT);
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await applyThrottle(client, cold);

  const t0 = Date.now();
  const response = await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
  if (!response || !response.ok()) {
    await context.close();
    return { error: `bad response ${response && response.status()}` };
  }

  // Allow LCP to stabilize (latest LCP candidate fires up to ~1s after load).
  await page.waitForTimeout(1500);

  const metrics = await page.evaluate(() => {
    const paintEntries = performance.getEntriesByType("paint");
    const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");
    const nav = performance.getEntriesByType("navigation")[0] || {};
    // LCP via buffered PerformanceObserver during the page life (last candidate).
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint") || [];
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null;
    const longtasks = performance.getEntriesByType("longtask") || [];
    const tbt = longtasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0);
    const resources = performance.getEntriesByType("resource");
    const transferBytes = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
    return {
      fcp: fcp ? fcp.startTime : null,
      lcp,
      domInteractive: nav.domInteractive || null,
      domContentLoadedEventEnd: nav.domContentLoadedEventEnd || null,
      loadEventEnd: nav.loadEventEnd || null,
      tbt,
      longtaskCount: longtasks.length,
      transferBytes,
      resourceCount: resources.length,
    };
  });

  await context.close();
  return { ...metrics, wallTimeMs: Date.now() - t0 };
}

async function measureLogOpen(browser, { cold }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await applyThrottle(client, cold);

  await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
  // Give React time to mount and attach event listeners.
  await page.waitForFunction(
    () => !!Array.from(document.querySelectorAll(".material-symbols-outlined")).find(
      (s) => s.textContent.trim() === "add_circle"
    ),
    null,
    { timeout: 15000 }
  );

  const timing = await page.evaluate(async () => {
    const spans = Array.from(document.querySelectorAll(".material-symbols-outlined"));
    const addIcon = spans.find((s) => s.textContent.trim() === "add_circle");
    if (!addIcon) return { error: "add_circle not found" };
    const btn = addIcon.closest("button");
    if (!btn) return { error: "no button wrapper" };

    const sheetAppears = () => !!document.querySelector(".fixed.inset-0.z-50");
    const t0 = performance.now();
    btn.click();
    return await new Promise((resolve) => {
      let rafFired = false;
      const tick = () => {
        if (sheetAppears()) {
          // One more RAF to capture the paint that includes the sheet.
          requestAnimationFrame(() => {
            resolve({ clickToPaintMs: performance.now() - t0 });
          });
          rafFired = true;
        } else if (!rafFired) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
      setTimeout(() => {
        if (!rafFired) resolve({ clickToPaintMs: performance.now() - t0, timedOut: true });
      }, 5000);
    });
  });

  await context.close();
  return timing;
}

async function runBatch(browser, label, fn, runs) {
  const rows = [];
  for (let i = 0; i < runs; i++) {
    process.stdout.write(`  ${label} run ${i + 1}/${runs}... `);
    try {
      const row = await fn();
      rows.push(row);
      console.log(JSON.stringify(row));
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      rows.push({ error: err.message });
    }
  }
  return rows;
}

function fmt(n) {
  return n == null || Number.isNaN(n) ? "   —  " : String(n).padStart(7);
}

function printTable(label, summary, keys) {
  console.log(`\n  ${label}`);
  console.log(
    `    ${"metric".padEnd(18)} ${"median".padStart(8)} ${"p75".padStart(8)} ${"min".padStart(8)} ${"max".padStart(8)}   n`
  );
  for (const k of keys) {
    const s = summary[k];
    if (!s) continue;
    console.log(
      `    ${k.padEnd(18)} ${fmt(s.median).padStart(8)} ${fmt(s.p75).padStart(8)} ${fmt(s.min).padStart(8)} ${fmt(s.max).padStart(8)}   ${s.n}`
    );
  }
}

(async () => {
  console.log(`Perf benchmark — ${RUNS} runs per config, Fast 3G throttling`);
  console.log(`URL: ${BASE_URL}`);
  console.log(`Output: ${OUT_PATH}\n`);

  const browser = await chromium.launch();
  const report = {
    timestamp: new Date().toISOString(),
    url: BASE_URL,
    runs: RUNS,
    throttle: FAST_3G,
    home: { cold: null, warm: null },
    logOpen: { cold: null, warm: null },
  };

  for (const cold of [true, false]) {
    const label = `home ${cold ? "cold" : "warm"}`;
    console.log(`\n== ${label} ==`);
    const raw = await runBatch(browser, label, () => measureHome(browser, { cold }), RUNS);
    report.home[cold ? "cold" : "warm"] = {
      raw,
      summary: summarize(raw, [
        "fcp",
        "lcp",
        "domInteractive",
        "domContentLoadedEventEnd",
        "loadEventEnd",
        "tbt",
        "transferBytes",
      ]),
    };
  }

  for (const cold of [true, false]) {
    const label = `logOpen ${cold ? "cold" : "warm"}`;
    console.log(`\n== ${label} ==`);
    const raw = await runBatch(browser, label, () => measureLogOpen(browser, { cold }), RUNS);
    report.logOpen[cold ? "cold" : "warm"] = {
      raw,
      summary: summarize(raw, ["clickToPaintMs"]),
    };
  }

  await browser.close();
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n============================================================`);
  console.log(` SUMMARY — ${OUT_PATH}`);
  console.log(`============================================================`);
  printTable("home / cold", report.home.cold.summary, [
    "lcp",
    "fcp",
    "domInteractive",
    "loadEventEnd",
    "tbt",
    "transferBytes",
  ]);
  printTable("home / warm", report.home.warm.summary, [
    "lcp",
    "fcp",
    "domInteractive",
    "loadEventEnd",
    "tbt",
    "transferBytes",
  ]);
  printTable("logOpen / cold", report.logOpen.cold.summary, ["clickToPaintMs"]);
  printTable("logOpen / warm", report.logOpen.warm.summary, ["clickToPaintMs"]);
  console.log();
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
