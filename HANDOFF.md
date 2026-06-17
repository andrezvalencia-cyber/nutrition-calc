# HANDOFF — Vitality Nutrition Calculator (v2)

State snapshot for an engineer (or agent) picking this up cold. Pair with
[`CLAUDE.md`](CLAUDE.md) (build/seam/security rules), [`RETIRED.md`](RETIRED.md)
(scheduled removals), and [`CHANGELOG.md`](CHANGELOG.md) (deprecation announcements).

## What this is
A single-user nutrition-tracking PWA. Runs entirely in the browser. No bundler,
no TypeScript, no ES imports — React 18 UMD via CDN, JSX compiled by Babel CLI.
The whole app lives under `v2/`; CI deploys `v2/` to **GitHub Pages**
([`deploy.yml`](.github/workflows/deploy.yml)). The only outbound calls are
opt-in: Anthropic (AI estimation) and Supabase (cloud sync).

## Architecture in one screen
- **UI**: `v2/src/app.jsx` → compiled to the committed `v2/app.js`. Never hand-edit
  `app.js`; the pre-commit hook and CI enforce `app.js == babel(app.jsx)` byte-for-byte.
- **Logic modules**: `v2/src/modules/<context>/*.js`, each a self-attaching
  `window.Modules.*` IIFE. Pure-logic modules are **dual-mode** — also
  `require()`-able from Node for server-free unit tests. Each file's header is the
  authoritative Public-API contract.
- **Cloud-sync stack** (`v2/src/store/*`): `RemoteStore` (reads) ·
  `WriteBehind.enqueue` (writes, debounced + circuit-broken + IndexedDB-backed) ·
  `SyncLeader` (one-tab-per-origin election, carryover never crosses the wire) ·
  `Modules.SyncMap` (pure row-mapping + `isSyncEnabled` guard).
- **State**: two localStorage keys — `nutrition_calc_v2` (app state) and
  `nutrition_calc_v2_api_key` (Anthropic key, never logged/exported).

## Recently landed (#11–#16)
- **#16** Deprecation contract for `Modules.Recipes.computeMealNutrients` (now an
  alias of `calculateNutrition`) — tracked in `RETIRED.md`, gated by `audit:legacy`.
- **#15** Pure-logic performance benchmark for hot `Modules.*` functions (`npm run bench`).
- **#14** BottomNav Liquid-Glass restyle (z-index contract, iOS safe-area, Playwright oracle).
- **#13** Unity fallback engine (`Modules.Fallbacks.resolveTarget`) + first-login onboarding.
- **#12** Camera-driven barcode scanner (`Modules.Scanner`, SRI-pinned `html5-qrcode`).
- **#11** Extracted `sync-map` + `heatmapColor` into dual-mode IIFE modules.

## In-flight obligations
- **Deprecation**: `computeMealNutrients` alias is removed at **2.5.0 OR 2026-12-17**,
  whichever first. Full mechanical checklist in [`RETIRED.md`](RETIRED.md). CI fails
  (`audit:legacy`) if the legacy name reappears under `v2/src/`.
- **Dead-code removal pending**: the `perf-gate` job in `deploy.yml` is disabled
  (`if: false`) and slated for removal alongside `tests/perf-benchmark.js`,
  `tests/perf-baseline.json`, and `perf-baseline.yml`.
- Version labels (`2.3.0`, `2.5.0`) are the documented deprecation contract only;
  `v2/package.json` is still `1.0.0` until release tagging is formalized.

## Gated paths (stop at <95% confidence — see CLAUDE.md)
`v2/src/store/*`, `v2/src/modules/identity/auth.js`, CSP in `v2/index.html`, the
API-key path, `.github/workflows/**`. Run `security-reviewer` + `/security-review`
before merging changes to any of these.

## Commands
```
cd v2
npm install                 # prepare script wires the git hooks (.githooks)
npm run build:all           # build:css && build && build:stamp
npx serve -p 8765           # tests need this server on :8765 first (won't auto-start)
npm test                    # Playwright integration suite
npm run audit:legacy        # deprecation gate (also runs in CI)
```

## Known rough edges
- `test:unit` in `v2/package.json` hardcodes an absolute machine path — it is not
  portable across checkouts. Use it only as a reference; CI does not run it.
