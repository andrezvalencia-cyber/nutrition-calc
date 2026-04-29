# CLAUDE.md — Vitality Nutrition Calculator

> **Confidence rule:** Do not make any changes until you have 95% confidence in intent and scope.
> Ask follow-up questions until you reach that threshold.

---

## 1. Bash Commands

```bash
# V2 — after any change to v2/src/app.jsx, run BOTH (one-liner recommended):
cd v2 && npm run build:css && npm run build
# ...or individually:
cd v2 && npm run build:css   # Tailwind: scans src/app.jsx → tailwind-out.css
cd v2 && npm run build       # Babel: src/app.jsx → app.js

# CI also runs build:stamp (writes the build hash into sw.js + index.html).
# Do NOT run build:stamp locally for normal dev — see §10.
# cd v2 && npm run build:stamp

# Run Node unit tests (no server needed)
node /Users/andyv/Projects/nutrition-calculator/v2/tests/write-behind.test.js
node /Users/andyv/Projects/nutrition-calculator/v2/tests/sync-leader.test.js

# Run integration tests (server on :8765 must be running first)
cd v2 && npm test              # full Playwright reporter
cd v2 && npm run test:headless # list reporter (terser CI-style output)

# One-shot: start server in background, then run tests
(cd v2 && npx serve -p 8765 &) && sleep 1 && cd v2 && npm test

# Local preview (prefer npx serve over python — sends cache headers)
npx serve v2 -p 8765
# fallback: python3 -m http.server 8765 --directory v2
```

The two build steps are independent — CSS can run anytime (scans the JSX source),
Babel compiles the same source file. Never run only one and ship the other stale.

---

## 2. Code Style

- **No bundler, no TypeScript, no ES module imports.** V2 uses React 18 UMD via CDN
  and Babel CLI for JSX transpilation. Keep it that way.
- **`v2/data.js` must stay vanilla JS** — it is loaded as a plain `<script>` before
  React mounts. No JSX, no `import`, no top-level `await`.
- **`window.Modules.*` namespace convention.** Non-JSX modules under
  `v2/src/modules/<context>/` are loaded as plain `<script>` tags in `index.html`
  and attach themselves to `window.Modules.<Context>` from inside an IIFE. App
  code reaches them via that global — never via `require`/`import`. Current
  members: `Modules.Catalog`, `Modules.Recipes`, `Modules.Log`, `Modules.GapEngine`,
  `Modules.Carryover`, `Modules.History`, `Modules.Insights`, `Modules.Identity`.
  Each module is independently testable in Node when it has no DOM/React deps.
  JSX (Contexts, components) stays inline in `src/app.jsx` because the build
  compiles only that one entry point.
- **`window.Modules.Identity` is the only entry point for auth + the Supabase
  client.** No file outside the Identity module may call `supabase.createClient`
  or read `localStorage` for session tokens. Components that need the client
  call `Modules.Identity.getClient()`; auth UI subscribes via
  `Modules.Identity.onAuthStateChange(cb)`. This single seam is what makes the
  hermetic test stub below possible.
- **`window.RemoteStore` is the only entry point for Supabase reads.** Defined
  in `v2/src/store/remote-store.js`; calls `Modules.Identity.getClient()` and
  exposes `fetchDays` / `fetchEntries` (Phase 4 read-only) plus `mapDayRow` /
  `mapEntryRow` so callers stay declarative. Never bypass it with ad-hoc
  `.from(...)` calls in `app.jsx`.
- **`window.WriteBehind` is the only entry point for Supabase writes (Phase 5).**
  Defined in `v2/src/store/write-behind.js`. All mutations in `app.jsx` that
  must sync to Supabase call `WriteBehind.enqueue({ table, op, payload, rollback,
  immediate })`. Never call `getClient().from(...).upsert(...)` directly from
  components. Guard every enqueue call with `isSyncEnabled(auth, state)` so
  writes only happen when `state.cloudSync === true` AND user is signed in.
- **Phase 5 write rules:**
  - `day_entries` upserts use `idempotency_key = entry.id` (stable `genId()`
    value) as the Supabase conflict key — never regenerate on retry.
  - `day_entries` deletes are soft-deletes (`deleted_at` timestamp), not physical
    `DELETE` — required for LWW merge safety across devices.
  - `days` rows upsert on `(user_id, day_date)` conflict target; always pass
    `immediate: true` to bypass the 2 s debounce.
  - Backoff formula: `min(500ms × 2^n + jitter(0..500ms), 30 s)`, max 6 tries.
    At n=6 the delay deterministically clamps to 30 000 ms.
  - Circuit breaker opens after 3 consecutive failures; closes on `online` event
    + successful `auth.getSession()` ping. While open, queued items persist to
    IndexedDB via `idb-keyval` (`vitality-v2-wbq / write_queue` store).
  - On retry exhaustion: rollback thunk is called (undo optimistic update), then
    `wbq:failed` CustomEvent fires → `ToastProvider` shows "Could not save — tap
    to retry".
- **`window.SyncLeader` is the only entry point for cross-tab hydration
  coordination (Phase 6).** Defined in `v2/src/store/sync-leader.js`. Uses
  `BroadcastChannel("sync-leader")` to elect one leader tab per origin; the
  leader is the only tab that calls `RemoteStore.fetchDays` /
  `fetchEntries` on boot. Followers subscribe via `SyncLeader.onPayload(cb)`
  and apply the same append-only merge — zero extra network reads. The
  `CloudSync` effect in `app.jsx` is the only caller; do not invoke
  `RemoteStore.fetch*` from components directly.
- **Phase 6 carryover invariant:** payloads carry only the raw
  `{ days, entries, userId, ts }` rows fetched from Supabase.
  `fatSolubleCarryover` and `carryoverDaysRemaining` are tab-local — every
  tab keeps using `Modules.Carryover.computeCarryover()` at Log Day time
  ([app.jsx:710](v2/src/app.jsx)). `SyncLeader.broadcastPayload()`
  defensively strips any `carryover` field before publishing, so it cannot
  leak across the wire by mistake. Followers compare `payload.userId` to
  their own session and discard mismatches (cross-account sign-in race).
- **Hermetic Supabase test stub (Phase 4 pattern).** Integration tests must
  not hit real Supabase. Stub `Modules.Identity` in `page.addInitScript` BEFORE
  the real `auth.js` runs by installing a non-overwritable property:
  ```js
  window.Modules = window.Modules || {};
  Object.defineProperty(window.Modules, 'Identity', {
    get: () => stub, set: () => {}, configurable: true,
  });
  ```
  The setter no-ops the real assignment in `auth.js`, so the stub survives.
  See `v2/tests/integration.test.js` → `cloud sync hydration (phase 4)` for
  the full fake-client shape (`auth.getSession`, `auth.onAuthStateChange`,
  `from(table).select(...).eq(...).order(...)` thenable chain).
- **CSS custom properties** (`--color-surface`, `--color-on-surface`, `--color-ring-bg`,
  etc.) are defined in `v2/input.css` inside `@layer base`. They are NOT in `styles.css`.
  Edit them there; `styles.css` only has component-level overrides.
- **Dark mode is class-based** (Tailwind `darkMode: "class"`). The `.dark` class sits on
  `<html>` and is toggled at runtime by a `useEffect` watching `state.themeMode`.
  Do not rely on `prefers-color-scheme` as the sole source of truth.
- Tailwind utility classes come only from compiled `tailwind-out.css`.
  Custom glass/sheet/animation classes live in `styles.css`.

---

## 3. Testing

- **Framework:** Playwright — config at `v2/playwright.config.js`, tests at
  `v2/tests/integration.test.js` (6 tests, 15 s timeout each).
- **Prerequisite:** a server must be running on port 8765 before `npm test`.
  Config uses `reuseExistingServer: true` — it will not start one for you.
- **What the tests assert:**
  - CSP meta tag contains no `unsafe-eval`
  - `@babel/standalone` is not loaded (Safari-safe check)
  - `app.js` loads as a pre-compiled script
  - App mounts and progress ring renders
  - Food logging happy path: special-character input (XSS-like `<script>`, quotes)
    is accepted without crashing, and a 200-char name is not truncated
  - Export triggers a Blob download without CSP errors

---

## 4. Repo Etiquette

- **`v2/tailwind-out.css` is gitignored.** CI regenerates it on every push
  (see `.github/workflows/deploy.yml`). Never commit it. Never treat your
  local copy as canonical for what ships.
- **V1 and V2 are fully isolated.** V1 lives at the **repo root**
  (`index.html`, `app.js`, `src/`, `sw.js`, `manifest.json`, `icon-*.png`);
  V2 lives in `v2/`. Different localStorage keys, no shared state, no shared
  build. CI deploys only the `v2/` directory to GitHub Pages; V1 is not deployed.
- **After editing `v2/src/app.jsx`**, commit both the source (`src/app.jsx`) and the
  recompiled output (`app.js`). They must stay in sync.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).

---

## 5. Architecture Decisions

- **Tailwind content array** in `v2/tailwind.config.js` MUST include `"./src/app.jsx"`.
  CI runs `build:css` before `build` (Babel), so `app.js` does not exist at CSS build time.
  If you remove `src/app.jsx` from content, the deployed CSS will be missing every
  component-level utility class (`grid-cols-2`, `flex-col`, `fixed`, `absolute`, etc.)
  and the live site will break — even though local dev looks fine (gitignored local file).

- **API key flow:** user enters key in Settings → stored in localStorage under
  `nutrition_calc_v2_api_key` → sent directly to `api.anthropic.com` with header
  `anthropic-dangerous-direct-browser-access: true`. There is no proxy server.

- **Fat-soluble carryover rule** (see `v2/src/app.jsx:482–496`):
  The magic numbers are **weekly doses divided across 7 days**, so the daily
  carryover = `round(weekly_dose / 7)`. To change a dose, update the weekly
  number in both branches of the `if/else if`.
  - B12: if a day's log contains ≥ 1000 mcg B12 → carry `5000/7 ≈ 714 mcg/day`
    for the next 6 days (weekly dose = 5000 mcg)
  - Vit E: if a day's log contains ≥ 100 mg Vit E → carry `268/7 ≈ 38 mg/day`
    for the next 6 days (weekly dose = 268 mg)
  - Vit D: carryover field exists in state but is always 0 (not implemented)

- **Two localStorage keys:**
  - `nutrition_calc_v2` — full app state (dayLog, history, themeMode, aiModel, etc.)
  - `nutrition_calc_v2_api_key` — Claude API key (stored separately)

- **Default AI model** (`claude-sonnet-4-6`) only takes effect on first load or after
  "Clear All Data". Existing users retain whatever model is in their saved state.
  (Verify the current default in `v2/src/app.jsx` — grep for `aiModel ||`.)

---

## 6. Env Quirks

- **Python's `http.server` sends no `Cache-Control` headers.** Browsers cache `.js` and
  `.css` files aggressively. During dev, prefer `npx serve` which sends proper headers.
  If testing a data or model change and the old value persists in the browser, this is why.

- **`<html class="dark">` in `index.html` is immediately overridden** by the theme
  `useEffect` on mount, which reads `state.themeMode` from localStorage.
  When writing tests or using `preview_eval`, re-apply dark mode manually:
  `document.documentElement.classList.add('dark')`.

- **Layout looks correct locally but breaks on the live site?**
  First check `v2/tailwind.config.js` — confirm `content` still includes `./src/app.jsx`.
  The live site always uses the CI-regenerated CSS, not your local file.

---

## 7. Common Gotchas

- **`localStorage.clear()` wipes the API key** as well as app state — both keys are gone.
  Users will need to re-enter their key after a full clear.

- **Adding a new ingredient or supplement** requires two edits in `v2/data.js`:
  1. Add the entry to `INGREDIENTS` (with all 16 nutrient fields)
  2. Add it to the relevant `RECIPES` ingredients array or `SUPPLEMENT_RECIPES`
  Nutrient totals are computed on the fly; there is no separate store to update.

- **Progress ring gradient** is an SVG `<linearGradient>` defined in `<defs>` inside the
  component — not a CSS gradient. To change the ring colors, edit the `stopColor` props
  on the `<stop>` elements inside `ProgressRing`, not `styles.css` or Tailwind config.

- **Changing `DEFAULT_STATE.aiModel`** only affects users with no existing localStorage
  state. For existing users, patch `state.aiModel` via the Settings screen or by clearing
  their storage.

- **`v2/data.js` is loaded before React** — any syntax error in that file (even a trailing
  comma issue in some browsers) will silently prevent the app from mounting with no
  clear React error boundary message.

---

## 8. Security Policies

This app is client-only: the browser is the entire trust boundary, the Anthropic API
key lives in `localStorage`, and user-supplied text flows straight into JSX and into
Claude prompts. The rules below are non-negotiable.

### Invariants

- **No hardcoded API keys** anywhere in the repo. The only allowed storage for an
  Anthropic key is `localStorage['nutrition_calc_v2_api_key']`, populated via the
  Settings screen. Never log, serialize, or export this key — it must not appear in
  `console.*`, in the JSON export blob, or in any error-reporting payload.
- **Never render user-supplied strings via `dangerouslySetInnerHTML` or `innerHTML`.**
  Food names, ingredient names, and notes must flow through React's default text
  interpolation. No exceptions.
- **CSP in `v2/index.html` must never regain `unsafe-eval` or `unsafe-inline`** in
  `script-src`. `@babel/standalone` must never be re-added to runtime — JSX is
  pre-compiled (see commit `8c29a66`, which exists specifically to close this hole).
- **Anthropic fetch calls** must preserve the `anthropic-dangerous-direct-browser-access: true`
  header and the `api.anthropic.com` host. Do not log the request body. Cap user-input
  length before interpolating into prompts to limit prompt-injection blast radius.
- **Dependency hygiene**: run `npm audit --prefix v2` quarterly. Treat any `high` or
  `critical` advisory in a runtime dependency as release-blocking.

### Security fix workflow (TDD, mandatory)

Every security fix lands via this three-step loop. No shortcuts.

1. **Reproduce.** Write a failing Playwright test in `v2/tests/integration.test.js`
   that demonstrates the vulnerability (XSS payload rendered verbatim, API key leaked
   to `console`, CSP violation in console, etc.). Commit the failing test first if the
   fix is non-trivial.
2. **Fix.** Edit `v2/src/app.jsx` (or the relevant file). Run the mandatory rebuild
   from §1: `cd v2 && npm run build:css && npm run build`. Commit both source and
   compiled output.
3. **Validate.** Run the full suite:
   `(cd v2 && npx serve -p 8765 &) && sleep 1 && cd v2 && npm test`.
   Confirm the new test passes and all existing tests still pass. No regressions.

### Skeptical-reviewer pattern (required for non-trivial fixes)

Two-agent review for anything touching auth, CSP, the API key, or CI:

- **Builder pass** — the main Claude session writes the fix on a branch.
- **Skeptic pass** — explicitly invoke the `security-reviewer` subagent with the
  instruction *"Try to break this fix. Look for race conditions, bypass paths, and
  regressions the builder missed."* The subagent is read-only and reports findings
  only. Only merge after the skeptic pass returns with no unresolved findings.

### When to run `/security-review`

Run the `/security-review` slash command before every PR that touches any of:

- `v2/src/app.jsx`
- `v2/index.html`
- `v2/package.json` or `v2/package-lock.json`
- `.github/workflows/**`

The command runs `npm audit`, greps for risky patterns, verifies CSP invariants,
audits the deploy workflow, and (on branches) delegates a diff review to the
`security-reviewer` subagent. Treat its output as a merge checklist, not a
suggestion.

---

## 9. Deployment Verification

Before completing a task that requires deployment via `.github/workflows/deploy.yml`:

1. **Lint Workflow:** Run `gh workflow view deploy.yml` to ensure the YAML is valid and the triggers are correctly configured.
2. **Trigger and Monitor:** After pushing changes, use `gh run list --workflow deploy.yml --limit 1` to find the current run.
3. **Agentic Monitoring:** Use manual exponential backoff (checking at 1, 2, 4, and 8 minutes) using:
   `gh run view <run-id> --exit-status`
   *Do not* use `gh run watch` as it produces excessive output that burns tokens.
4. **Live Check:** Once the GitHub Action is green, use `curl -I <production-url>` to verify a `200 OK` response or use the browser tool to verify the UI visually.
5. **Rollback Plan:** If the deployment fails, immediately propose a `git revert` to the last known stable state.

---

## 10. Service Worker (Phase 7)

`v2/sw.js` is the only Service Worker. It implements a cache-first app
shell with versioned cache names keyed off the build hash, plus
network-first fallbacks for the data plane (Supabase, Anthropic).

### Cache strategies

| Request | Strategy | Cache |
|---|---|---|
| Same-origin navigation (HTML) | Stale-while-revalidate | `vitality-v2-shell-<hash>` |
| Same-origin precached asset | Cache-first | `vitality-v2-shell-<hash>` |
| `*.supabase.co` | Network-first (3 s timeout) + cache fallback | `vitality-v2-runtime-<hash>` |
| `api.anthropic.com` | Network-first + cache fallback (POSTs are uncacheable per Cache API; effectively network-only at runtime) | `vitality-v2-runtime-<hash>` |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Cache-first | `vitality-v2-runtime-<hash>` |
| `unpkg.com` | Cache-first (URLs are SRI-pinned + immutable) | `vitality-v2-shell-<hash>` |
| Anything else | Network-only (passthrough) | — |

### Build hash injection

- `__BUILD_HASH__` is the placeholder in `v2/sw.js` and `v2/index.html`.
- CI (`.github/workflows/deploy.yml`) runs `npm run build:stamp` after
  `build:css` + `build`, which executes `v2/scripts/stamp-build-hash.mjs`
  and replaces every `__BUILD_HASH__` with `${GITHUB_SHA::8}`.
- **Do not run `build:stamp` locally** for normal dev. The committed
  source must keep the literal `__BUILD_HASH__` placeholder so cache
  names stay stable across local reloads. The script logs a warning if
  it modifies files outside CI.

### Pre-cache invariant

The `PRECACHE_URLS` array in `v2/sw.js` mirrors the `<script>` and
`<link rel="stylesheet">` tags in `v2/index.html`. Every time you add a
new same-origin runtime asset to `index.html`, add the corresponding
URL to `PRECACHE_URLS`. Forgetting this means the asset will not be
available offline and the SW will pass through to the network.

### Lifecycle

- `install` populates `SHELL_CACHE` and calls `self.skipWaiting()`.
- `activate` deletes every cache whose name is not the current
  `SHELL_CACHE` or `RUNTIME_CACHE` (this also evicts the legacy
  `nutri-calc-v1` cache that the old `sw-cleanup.js` used to clear),
  then calls `self.clients.claim()` so the new SW controls open pages
  immediately.
- The page listens for `controllerchange` and reloads once when a new
  SW takes control — this is the stuck-shell guard.

### Registration

`v2/src/app.jsx` registers `sw.js` once per page load on the `load`
event. The Modules namespace is unaware of the SW; it operates entirely
at the network layer.

### CSP

Workers require `worker-src 'self'`. Do not regress this to `'none'` —
the SW will silently fail to register. CSP `connect-src` already covers
Supabase + Anthropic, and `script-src 'self' https://unpkg.com` covers
the SW script itself (same-origin) and the precached unpkg URLs.
