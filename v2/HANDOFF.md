# Font Fallback Overrides — Handoff Reference

## What

Metric-matched `@font-face` fallbacks in `input.css` eliminate CLS caused by
web-font swap (FOUT). The overrides make the system fallback (Arial / Roboto)
occupy the same line box as the target web font, so swapping in the real font
produces zero layout shift.

## Shipped font versions (as of 2026-06-20)

| Font | Source | Weights |
|------|--------|---------|
| Manrope | Google Fonts (`&family=Manrope:wght@400;600;700;800`) | 400, 600, 700, 800 |
| Inter | Google Fonts (`&family=Inter:wght@400;500;600`) | 400, 500, 600 |
| Material Symbols Outlined | Google Fonts (variable axes) | — |

## How the override values were derived

```bash
node v2/scripts/gen-font-fallbacks.mjs
```

The script uses OS/2 table metrics from the font files:

| Metric | Manrope | Inter | Arial (fallback) |
|--------|---------|-------|-------------------|
| unitsPerEm | 1000 | 2048 | 2048 |
| ascent | 1068 | 2048 | 1854 |
| descent | 292 | 512 | 434 |
| lineGap | 0 | 0 | 67 |
| xAvgCharWidth | 550 | 918 | 904 |

Formula (per CSS Fonts Level 4 + capsize):
- `size-adjust` = `(target.xAvgCharWidth / target.upm) / (fallback.xAvgCharWidth / fallback.upm) * 100`
- `ascent-override` = `target.ascent / target.upm / (sizeAdjust / 100) * 100`
- `descent-override` = `|target.descent| / target.upm / (sizeAdjust / 100) * 100`
- `line-gap-override` = `target.lineGap / target.upm / (sizeAdjust / 100) * 100`

## When to regenerate

If the primary web fonts change (version bump, weight range change, or font
swap), re-run `node v2/scripts/gen-font-fallbacks.mjs` with updated OS/2 metrics
and paste the new values into `v2/input.css`. The dashboard CLS test in
`v2/tests/integration.test.js` will fail if the overrides drift.
