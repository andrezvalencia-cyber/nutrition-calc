# CLAUDE.md — Vitality Nutrition Calculator

## Build (after any v2/src/app.jsx edit)
`cd v2 && npm run build:css && npm run build` — both must run; CSS scans the JSX, Babel compiles it. Never ship one stale.

## Code constraints
- No bundler, TypeScript, or ES imports. React 18 UMD via CDN, Babel CLI for JSX.
- `v2/data.js` is plain `<script>` — vanilla JS only. Syntax errors silently break mount.
- `window.Modules.*` namespace: non-JSX modules under `v2/src/modules/<context>/` self-attach via IIFE. Reach them through the global, never `import`.
- Single-seam rules — full contracts live in each file's header:
  - Auth + supabase client → `Modules.Identity` (`v2/src/modules/identity/auth.js`)
  - Supabase reads → `RemoteStore` (`v2/src/store/remote-store.js`)
  - Supabase writes → `WriteBehind.enqueue`, guard with `isSyncEnabled` (`v2/src/store/write-behind.js`)
  - Cross-tab hydration → `SyncLeader` (`v2/src/store/sync-leader.js`)
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
- V1 (repo root) and V2 (`v2/`) are fully isolated. CI deploys only `v2/`.
- After editing `v2/src/app.jsx`: commit BOTH `src/app.jsx` and recompiled `app.js`.

## Architecture gotchas
- `v2/tailwind.config.js` `content` MUST include `"./src/app.jsx"`. CSS builds before Babel, so removing it ships a CSS missing every component-level utility class. Local dev hides this.
- API key: `localStorage['nutrition_calc_v2_api_key']` → direct fetch to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`. No proxy.
- Two localStorage keys: `nutrition_calc_v2` (state) and `nutrition_calc_v2_api_key` (key). `localStorage.clear()` wipes both.
- Carryover formulas (B12 + VitE weekly ÷ 7, VitD intentionally 0): `v2/src/modules/carryover/carryover-engine.js` header.
- New ingredient/supplement: edit `v2/data.js` `INGREDIENTS` (16 nutrient fields) AND the matching `RECIPES`/`SUPPLEMENT_RECIPES`. `supp_*` keys auto-promote.

## Env quirks
- Prefer `npx serve` over `python3 -m http.server` — Python sends no cache headers, masks data/model changes.
- Tests need a server on `:8765` first (`reuseExistingServer: true`); won't auto-start.

## Security (non-negotiable)
- No hardcoded API keys. Never log/serialize/export the key.
- Never use `dangerouslySetInnerHTML` or `innerHTML` for user-supplied strings.
- CSP must never regain `unsafe-eval`/`unsafe-inline`. `@babel/standalone` must never re-enter runtime (commit `8c29a66`).
- Anthropic fetches: keep the dangerous-direct-browser-access header, cap user input length, never log request body.
- `npm audit --prefix v2` quarterly; high/critical = release-blocker.

### Security fix workflow (TDD, mandatory)
1. **Reproduce** — failing Playwright test in `v2/tests/integration.test.js` first.
2. **Fix** — edit, run the build sequence above. Commit source + compiled.
3. **Validate** — `(cd v2 && npx serve -p 8765 &) && sleep 1 && cd v2 && npm test`. No regressions.

For changes touching auth/CSP/API key/CI, invoke the `security-reviewer` subagent for an adversarial pass before merging. Run `/security-review` before every PR touching `v2/src/app.jsx`, `v2/index.html`, `v2/package*.json`, or `.github/workflows/**`.

## Deployment (`gh` workflow `deploy.yml`)
1. Lint: `gh workflow view deploy.yml`
2. Find run: `gh run list --workflow deploy.yml --limit 1`
3. Monitor: exponential backoff (1, 2, 4, 8 min) via `gh run view <id> --exit-status` — never `gh run watch` (token-heavy).
4. Live check: `curl -I <url>` for 200 or browser-tool UI verify.
5. Failure → propose `git revert` to last stable.

The `perf-gate` job is disabled (`if: false`); slated for removal with `tests/perf-benchmark.js` and `tests/perf-baseline.json`.

## Pre-cache invariant
`PRECACHE_URLS` in `v2/sw.js` mirrors the `<script>`/`<link rel="stylesheet">` tags in `v2/index.html`. Add new same-origin runtime assets to BOTH. Cache strategy + build-hash flow: `v2/sw.js` header.
