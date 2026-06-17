# Changelog

All notable changes to the Vitality Nutrition Calculator are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Versioning note:** The version labels below (`2.3.0`, `2.5.0`) are the
> documented public **deprecation contract** for the "v2" app line. They are
> intentionally **not** reflected in `v2/package.json` (which remains `1.0.0`)
> until the project formalizes its release tagging. The labels exist so the
> deprecate→remove cycle is unambiguous for the release manager — see
> [`RETIRED.md`](RETIRED.md).

## [2.3.0] — 2026-06-17

### Deprecated
- **`Modules.Recipes.computeMealNutrients(recipe, states)`** is deprecated in
  favor of the renamed canonical function `calculateNutrition`. The old name is
  now a thin alias that logs a one-per-session console warning and delegates to
  the new function. Behavior, signature, and return value are **unchanged**.
  Scheduled for removal in **2.5.0** (see Migration Guide + `RETIRED.md`).

### Added
- `Modules.Recipes.calculateNutrition(recipe, states)` — the canonical
  nutrient-summing function (same implementation previously named
  `computeMealNutrients`).
- `window.NutritionCalculator.calculateNutrition` — public-facing alias of the
  same function object, named in the deprecation warning.
- `v2/scripts/audit-legacy-usage.sh` + `npm run audit:legacy` — a deterministic
  CI gate (wired into `.github/workflows/verify-build.yml`) that fails the build
  if the legacy name is reintroduced anywhere under `v2/src/`.

### Migration Guide

The function was **renamed**, not changed. Update call sites as follows — the
signature `(recipe, states)` and the returned nutrient totals are identical:

| Legacy (deprecated 2.3.0) | Replacement (public) | Replacement (module-internal) |
|---|---|---|
| `Modules.Recipes.computeMealNutrients(recipe, states)` | `NutritionCalculator.calculateNutrition(recipe, states)` | `Modules.Recipes.calculateNutrition(recipe, states)` |

Both replacements resolve to the **same** underlying function — pick whichever
matches your context (app-internal code uses the `Modules.Recipes.*` form to
match the existing namespace idiom; `NutritionCalculator.*` is the public alias).

The legacy alias will be **removed in 2.5.0** (or 2026-12-17, whichever comes
first). After removal, any remaining `computeMealNutrients` reference will throw
`TypeError: ... is not a function`. Run `npm run audit:legacy` locally to find
stragglers before then.
