// One-off script to compute metric-matched @font-face overrides.
// Uses OS/2 table metrics from the shipped Google Fonts files.
// Run: node scripts/gen-font-fallbacks.mjs

const manrope = { ascent: 1068, descent: 292, lineGap: 0, upm: 1000, xAvgW: 550 };
const inter   = { ascent: 2048, descent: 512, lineGap: 0, upm: 2048, xAvgW: 918 };
const arial   = { ascent: 1854, descent: 434, lineGap: 67, upm: 2048, xAvgW: 904 };

function compute(target, fallback) {
  const sa = (target.xAvgW * fallback.upm) / (fallback.xAvgW * target.upm) * 100;
  const ao = target.ascent / target.upm / (sa / 100) * 100;
  const d  = target.descent / target.upm / (sa / 100) * 100;
  const lg = target.lineGap / target.upm / (sa / 100) * 100;
  return { sizeAdjust: sa, ascentOverride: ao, descentOverride: d, lineGapOverride: lg };
}

for (const [name, metrics] of [["Manrope", manrope], ["Inter", inter]]) {
  const r = compute(metrics, arial);
  console.log(`${name} -> Arial:`);
  console.log(`  ascent-override: ${r.ascentOverride.toFixed(2)}%`);
  console.log(`  descent-override: ${r.descentOverride.toFixed(2)}%`);
  console.log(`  line-gap-override: ${r.lineGapOverride.toFixed(2)}%`);
  console.log(`  size-adjust: ${r.sizeAdjust.toFixed(2)}%`);
  console.log();
}
