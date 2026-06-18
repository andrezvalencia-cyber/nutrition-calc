# CLAUDE.md — Vitality Nutrition Calculator

## Gated paths — stop at <95% confidence
These have high blast radius. Confirm intent before editing, and run the matching review before merging. Everything else: implement directly.
- `v2/src/store/*` (writes/sync) and `v2/src/modules/identity/auth.js` — data-loss + auth seams.
- CSP in `v2/index.html`, the API-key path, and `.github/workflows/**` — invoke the `security-reviewer` subagent **and** `/security-review` before merging.

## Build
Builds run automatically. Do not invoke them by hand unless debugging hook output.
- **Native git hook** (`.githooks/pre-commit`): runs `npm run build:css` + `npm run build`, blocks commit if `v2/app.js` is stale or either build errors.
- **Claude PreToolUse hook** (`.claude/hooks/pre-commit-build.sh`): rebuilds and auto-stages `v2/app.js` when Claude issues `git commit`.
- **CI** (`.github/workflows/verify-build.yml`): rebuilds on every push/PR; commit cannot land if `v2/app.js` doesn't match `babel(v2/src/app.jsx)`. Bypass via `git commit --no-verify` is therefore non-shippable.
- First-time setup: `cd v2 && npm install` (its `prepare` script wires `core.hooksPath=.githooks`).
- Manual rebuild (debugging only): `cd v2 && npm run build:css && npm run build`.

## Code constraints
- No bundler, TypeScript, or ES imports. React 18 UMD via CDN, Babel CLI for JSX.
- `v2/data.js` is plain `<script>` — vanilla JS only. Syntax errors silently break mount.
- `window.Modules.*` namespace: non-JSX modules under `v2/src/modules/<context>/` self-attach via IIFE. Reach them through the global, never `import`.
- Pure-logic modules are **dual-mode IIFEs**: they self-attach in the browser AND are `require()`-able from Node, enabling server-free unit tests (e.g. `v2/tests/write-behind.test.js`). Each module's header is its contract — read it instead of re-documenting the Public API here.
- All public module interfaces under `v2/src/modules/` MUST include JSDoc with `@param` and `@returns` tags.
- Single-seam rules — full contracts live in each file's header:
  - Auth + supabase client → `Modules.Identity` (`v2/src/modules/identity/auth.js`)
  - Supabase reads → `RemoteStore` (`v2/src/store/remote-store.js`)
  - Supabase writes → `WriteBehind.enqueue`, guard with `isSyncEnabled` (`v2/src/store/write-behind.js`)
  - Cross-tab hydration → `SyncLeader` (`v2/src/store/sync-leader.js`)
  - Pure sync row-mapping + the `isSyncEnabled` guard → `Modules.SyncMap` (`v2/src/modules/sync/sync-map.js`)
- CSS custom properties live in `v2/input.css` `@layer base`, NOT `styles.css`.
- Dark mode is class-based; `<html class="dark">` is overridden on mount by the theme `useEffect`.

## Hermetic Supabase test stub (non-obvious)
Stub `Modules.Identity` in `page.addInitScript` BEFORE `auth.js` runs:
```js
Object.defineProperty(window.Modules, 'Identity', { get: () => stub, set: () => {}, configurable: true });
```
The setter no-ops the real assignment. See `v2/tests/integration.test.js` → `cloud sync hydration`.

## Repo
- `v2/tailwind-out.css` is gitignored — CI regenerates on every push. Never trust your local copy.
- The project lives entirely under `v2/`. CI deploys only `v2/`.
- `v2/app.js` is committed and must equal `babel(v2/src/app.jsx)`. The pre-commit hook enforces this; do not edit `app.js` by hand.

## Repo Etiquette
- Any PR affecting nutrition math or test corpora MUST have all checkboxes in `v2/tests/VALIDATION.md` marked `[x]` by the Nutrition SME to pass CI. The gate is `v2/scripts/audit-test-validation.sh` (`npm run audit:test-validation`), wired blocking into `.github/workflows/verify-build.yml`.

## Architecture gotchas
- `v2/tailwind.config.js` `content` MUST include `"./src/app.jsx"`. CSS builds before Babel, so removing it ships a CSS missing every component-level utility class. Local dev hides this.
- API key: `localStorage['nutrition_calc_v2_api_key']` → direct fetch to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`. No proxy.
- Two localStorage keys: `nutrition_calc_v2` (state) and `nutrition_calc_v2_api_key` (key). `localStorage.clear()` wipes both.
- Carryover formulas (B12 + VitE weekly ÷ 7, VitD intentionally 0): `v2/src/modules/carryover/carryover-engine.js` header.
- Missing nutrient targets resolve via `Modules.Fallbacks.resolveTarget` (profile → defaults → unity 1.0, firing `onFallbackTriggered`): `v2/src/modules/fallbacks/fallback-engine.js` header.
- New ingredient/supplement: edit `v2/data.js` `INGREDIENTS` (16 nutrient fields) AND the matching `RECIPES`/`SUPPLEMENT_RECIPES`. `supp_*` keys auto-promote.

## Env quirks
- Prefer `npx serve` over `python3 -m http.server` — Python sends no cache headers, masks data/model changes.
- Tests need a server on `:8765` first (`reuseExistingServer: true`); won't auto-start.

## Security (non-negotiable)
- No hardcoded API keys. Never log/serialize/export the key.
- Never use `dangerouslySetInnerHTML` or `innerHTML` for user-supplied strings.
- CSP must never regain `unsafe-eval`/`unsafe-inline`. `@babel/standalone` must never re-enter runtime (commit `8c29a66`).
- Anthropic fetches: keep the dangerous-direct-browser-access header, cap user input length, never log request body.
- Observability tracer scrubs span attributes for secrets — never pass api keys, prompts, or request bodies as span attrs (`v2/src/modules/observability/tracer.js`). Beacon export is default-OFF and inert until `window.__observabilityConfig.enabled`.
- Scanner loads `html5-qrcode` from unpkg under a pinned SRI hash (`v2/src/modules/scanner/scanner.js`); bump the `integrity` value in lockstep with any version change. It is cross-origin, so it is NOT in `PRECACHE_URLS`.
- `npm audit --prefix v2` quarterly; high/critical = release-blocker.

### Security fix workflow (TDD, mandatory)
1. **Reproduce** — failing Playwright test in `v2/tests/integration.test.js` first.
2. **Fix** — edit `v2/src/app.jsx`; pre-commit hook compiles + stages `v2/app.js`.
3. **Validate** — `(cd v2 && npx serve -p 8765 &) && sleep 1 && cd v2 && npm test`. No regressions.

For changes touching auth/CSP/API key/CI, invoke the `security-reviewer` subagent for an adversarial pass before merging. Run `/security-review` before every PR touching `v2/src/app.jsx`, `v2/index.html`, `v2/package*.json`, or `.github/workflows/**`.

## Deployment (`gh` workflow `deploy.yml`)
1. Lint: `gh workflow view deploy.yml`
2. Find run: `gh run list --workflow deploy.yml --limit 1`
3. Monitor: exponential backoff (1, 2, 4, 8 min) via `gh run view <id> --exit-status` — never `gh run watch` (token-heavy).
4. Live check: `curl -I <url>` for 200 or browser-tool UI verify.
5. Failure → propose `git revert` to last stable.

The `perf-gate` job is disabled (`if: false`); slated for removal with `tests/perf-benchmark.js` and `tests/perf-baseline.json`.

Scheduled API removals (deprecation contract) are tracked in `RETIRED.md`; deprecations are announced in `CHANGELOG.md`. The `npm run audit:legacy` gate (CI-blocking in `verify-build.yml`) fails the build if a retired-but-not-yet-removed name like `Modules.Recipes.computeMealNutrients` reappears in `v2/src/`.

`npm run audit:docs` (CI-blocking in `verify-build.yml`) enforces JSDoc on public module interfaces deterministically; enforcement is allowlist-staged (currently the Recipes module) and expands via the `ENFORCE` list in `scripts/audit-jsdoc.mjs`.

## Pre-cache invariant
`PRECACHE_URLS` in `v2/sw.js` mirrors the `<script>`/`<link rel="stylesheet">` tags in `v2/index.html`. Add new same-origin runtime assets to BOTH. Cache strategy + build-hash flow: `v2/sw.js` header.
