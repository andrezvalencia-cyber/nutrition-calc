# ToDo — Vitality Nutrition Calculator

> Synthesized 2026-04-16 from [CLAUDE.md](CLAUDE.md) + git history. No
> `docs/features/` or `REVIEWS.md` existed at the time of writing (their
> absence is item §3.2). Keep this file **under 150 lines**; when an item
> lands, delete it — don't strike it through.

## 1. Legend

- **Priority:** HIGH (architectural impact / unblocks other work) · MED · LOW
- Every item links to the canonical file and states a Definition of Done.
- "Why" captures rationale Claude can't infer by reading code alone.

---

## 2. New Features

### 2.1 [HIGH] Aura Glass design system rollout
- **Spec:** [stitch_preview/…/DESIGN.md](stitch_preview/stitch_nutrition_calc_ios_26/aura_glass/DESIGN.md)
- **Why:** A complete "Editorial Liquid Glass" design spec lives in-repo but
  is unimplemented. Current UI uses generic Tailwind surfaces instead of the
  `surface-container-*`, squircle, and refractive-gradient tokens the spec
  mandates. Ships meaningful product polish.
- **DoD:**
  - Design tokens added to [v2/input.css](v2/input.css) inside `@layer base`.
  - Progress ring in [v2/src/app.jsx](v2/src/app.jsx) uses the refractive
    gradient from §5 of the spec (not the current flat stroke).
  - New Playwright test in [v2/tests/integration.test.js](v2/tests/integration.test.js)
    pins squircle radius on a card component.

### 2.2 [MED] AI model migration path for existing users
- **Files:** [v2/src/app.jsx:17](v2/src/app.jsx), [:325](v2/src/app.jsx), [:1431](v2/src/app.jsx)
- **Why:** Per [CLAUDE.md §5](CLAUDE.md), `DEFAULT_STATE.aiModel` only
  applies on first load — existing users are frozen on whatever model ID
  was saved months ago. Blocks clean rollout of newer Claude models.
- **DoD:**
  - Add a `stateSchemaVersion` field; on load, a migration bumps stale
    model IDs to the current default.
  - Playwright test seeds old localStorage and asserts post-hydration
    `state.aiModel` matches the current default.

### 2.3 [LOW] API-key preservation on "Clear All Data"
- **File:** [v2/src/app.jsx:1378](v2/src/app.jsx)
- **Why:** [CLAUDE.md §7](CLAUDE.md) — the current handler calls
  `localStorage.clear()`, which also wipes `nutrition_calc_v2_api_key`,
  forcing users to re-enter their key. Friction, not broken.
- **DoD:**
  - Handler removes only the `nutrition_calc_v2` key, not the API-key key.
  - Playwright test: set both keys → trigger Clear All Data → assert API
    key survives.

---

## 3. Technical Debt / Refactoring

### 3.1 [HIGH] Delete V1 artifacts from repo root
- **Files to remove:** [index.html](index.html), [app.js](app.js),
  [src/app.jsx](src/app.jsx), [sw.js](sw.js), [manifest.json](manifest.json),
  [icon-192.png](icon-192.png), [icon-512.png](icon-512.png). Verify root
  [package.json](package.json) / [package-lock.json](package-lock.json)
  belong to V1 before deleting (V2 has its own under [v2/](v2/)).
- **Why:** V1 is not deployed (CI ships only `v2/`) and is no longer needed.
  Its presence confuses tooling and contributors — the prompt that spawned
  this ToDo referenced `@src/` expecting V2.
- **DoD:**
  - Single commit deletes all V1 files.
  - [README.md](README.md) and [CLAUDE.md §4](CLAUDE.md) drop the "V1 vs V2"
    isolation language.
  - V2 integration tests still green; `.github/workflows/deploy.yml`
    unchanged (already `v2/`-only).

### 3.2 [HIGH] Establish `docs/features/` + `REVIEWS.md` scaffolding
- **Files (new):** `docs/features/_template.md`, `REVIEWS.md`
- **Why:** This ToDo exists because neither existed. Future feature specs
  and security-review records (per [CLAUDE.md §8](CLAUDE.md)) have nowhere
  to land, so they get lost in chat transcripts.
- **DoD:**
  - Template committed with sections: Problem, Proposed Solution, DoD,
    Rollout, Risks.
  - [CLAUDE.md §4](CLAUDE.md) "Repo Etiquette" references both paths.
  - Aura Glass spec migrated from [stitch_preview/](stitch_preview/stitch_nutrition_calc_ios_26/aura_glass/DESIGN.md)
    into `docs/features/aura-glass.md` as the first real entry.

### 3.3 [MED] Extract fat-soluble carryover magic numbers
- **File:** [v2/src/app.jsx:489](v2/src/app.jsx), [:494](v2/src/app.jsx)
- **Why:** `5000/7` and `268/7` are inlined in two branches each.
  [CLAUDE.md §5](CLAUDE.md) already warns maintainers to "update the weekly
  number in both branches" — that is a code-smell, not a documentation fix.
- **DoD:**
  - `FAT_SOLUBLE_WEEKLY_DOSES = { b12: 5000, vit_e: 268 }` exported from
    [v2/data.js](v2/data.js).
  - `app.jsx` reads from the constant in both branches.
  - Existing carryover tests (commit `40950b2`) still pass unchanged.

### 3.4 [MED] Automate quarterly `npm audit`
- **File (new):** `.github/workflows/security.yml`
- **Why:** [CLAUDE.md §8](CLAUDE.md) mandates quarterly `npm audit --prefix
  v2`, relying on human memory. A scheduled workflow converts policy into
  enforcement.
- **DoD:**
  - Workflow scheduled `cron: '0 12 1 */3 *'` (1st of each quarter).
  - Runs `npm audit --prefix v2 --audit-level=high`; fails the job on
    `high`/`critical`.
  - On failure, opens a GitHub issue via `gh issue create` with audit output.

### 3.5 [LOW] Migrate CI actions to Node.js 24
- **File:** [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Why:** GitHub Actions deprecated Node.js 20 runners; forced migration to Node 24 on 2026-06-02, Node 20 removed 2026-09-16. Currently seeing warnings on every deploy run.
- **DoD:**
  - Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` env in the workflow (or update each action to a Node-24-compatible version).
  - Deploy run passes with no deprecation annotation.

### 3.7 [MED] Front GH Pages with Cloudflare for HTTP/3 + Brotli
- **Files (new/changed):** DNS records (out-of-repo), optional `CNAME` in `v2/`
- **Why:** Phase 2 verification of commit `5a2067a` confirmed GitHub Pages via
  Fastly serves **HTTP/2 + gzip only** for this site — no `alt-svc` header
  (HTTP/3 not advertised) and `Accept-Encoding: br` returns identity bytes
  (26.8KB vs 5.9KB gzip for `tailwind-out.css`). Fronting with Cloudflare
  gives HTTP/3/QUIC termination and Brotli 11 for static assets at no cost,
  preserving the GH Pages deploy pipeline.
- **DoD:**
  - Custom domain CNAME'd through Cloudflare with "Proxied" (orange-cloud) on.
  - `curl -sI https://<domain>/ | grep -i alt-svc` returns `h3=":443"`.
  - `curl -sI -H "Accept-Encoding: br" https://<domain>/tailwind-out.css`
    returns `content-encoding: br` with payload smaller than the gzip variant.
  - No change to `.github/workflows/deploy.yml`; GH Pages remains the origin.

### 3.8 [LOW] Freeze `window.__tracer` against runtime clobbering
- **File:** [v2/tracer.js](v2/tracer.js)
- **Why:** From 2026-04-18 security review of the Phase 4 tracer. A browser
  extension or a later dev-tools snippet can overwrite `window.__tracer` with
  a shim that skips `sanitizeAttrs`, defeating the denylist + value scrubber.
  No active bypass today (attrs are scalars at the one call site), but pure
  defense-in-depth.
- **DoD:**
  - `Object.defineProperty(window, "__tracer", { value, writable: false, configurable: false })`.
  - Playwright test: attempt to reassign `window.__tracer`, trigger AI path,
    assert the real `[otel]` span is still emitted with its denylist intact.

### 3.9 [LOW] Make `span.end()` idempotent
- **File:** [v2/tracer.js](v2/tracer.js)
- **Why:** From the same review. A future edit that adds an early `span.end`
  in the happy path (e.g. before `setState`) would double-log the span with
  different durations. Latent risk, caught cheaply now.
- **DoD:**
  - First `end()` sets an `ended` flag; subsequent calls return the cached
    span without re-logging.
  - Playwright test: call `span.end("ok")` then `span.end("error")`, assert
    `console.info` invoked exactly once with `[otel]`.

### 3.10 [MED] Require `perf-gate` as a status check on `main`
- **File (external):** GitHub branch protection rules for `main`
- **Why:** From the review — `deploy` has `needs: perf-gate` so within a run
  deploy is gated, but nothing in GitHub enforces that a merge into `main`
  saw a green `perf-gate`. A direct push bypasses PR review; the workflow
  still runs, so this is defense-in-depth rather than an active bypass.
- **DoD:**
  - Settings → Branches → `main` → require status check `perf-gate`.
  - A dry-run asserts `gh api repos/:owner/:repo/branches/main/protection`
    lists `perf-gate` in `required_status_checks.contexts`.

### 3.11 [MED] Switch AISkeleton shimmer to transform-based animation
- **File:** [v2/styles.css](v2/styles.css)
- **Why:** From the 2026-04-18 perf audit. `.shimmer-block` animates
  `background-position` on a gradient inside `.liquid-glass`, which has
  `backdrop-filter: blur(40px)`. Every frame re-composites the blurred
  layer — measurable on low-end Android during 3–8s AI waits.
- **DoD:**
  - Animate `transform: translateX(...)` on a pseudo-element with
    `will-change: transform`, or add `contain: paint` to the skeleton root.
  - Verify no regression in the CLS + skeleton visibility tests.

### 3.12 [LOW] Tighten heatmap `min-h` to match natural height
- **File:** [v2/src/app.jsx](v2/src/app.jsx) (heatmap grid container, ~1353)
- **Why:** Same perf audit. Current `min-h-[18rem]` (288 px) may under-reserve
  the heatmap's natural height (~370 px at 16 nutrient rows × 20 px cells +
  gaps + header), so a future first-paint could push content down. Runtime
  CLS test passes at < 0.01 today so not blocking; a silent regression
  wouldn't trip the gate until CLS exceeds that floor.
- **DoD:**
  - Compute reserved height from `nutrients.length * (cellPx + gap) + header`,
    or raise to `min-h-[24rem]`.
  - Extend the CLS test to exercise the heatmap tab switch path.

### 3.6 [LOW] Fix dark-mode class flicker on initial paint
- **Files:** [v2/index.html](v2/index.html), [v2/src/app.jsx:17](v2/src/app.jsx)–[:46](v2/src/app.jsx)
- **Why:** [CLAUDE.md §6](CLAUDE.md) — hardcoded `<html class="dark">` is
  overridden by the `themeMode` effect on mount, causing a flash of dark
  for `light`/`system` users. Cosmetic.
- **DoD:**
  - Synchronous pre-mount theme read via external `<script>` in `<head>`
    (no `unsafe-inline` — CSP preserved per §8).
  - Manual QA in Chrome + Safari confirms no flash in light or system mode.

---

## 4. Blocking Dependencies

| Debt item                 | Unblocks feature              | Rationale |
|---------------------------|-------------------------------|-----------|
| 3.1 V1 deletion           | 2.1 Aura Glass                | Avoids token/CSS collisions during rollout |
| 3.2 `docs/` + `REVIEWS`   | 2.1, 2.2                      | Gives each feature a spec home + DoD anchor |
| 3.3 carryover constants   | (hygiene only)                | Reduces diff noise for future dose changes |
| 3.4 `npm audit` cron      | (hygiene only)                | Security policy compliance |
| 3.5 Node 24 migration     | (hygiene only)                | Deadline: 2026-06-02 forced; 2026-09-16 Node 20 removed |
