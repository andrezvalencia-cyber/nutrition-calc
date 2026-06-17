# RETIRED — scheduled removals & sunset tracker

This file is the single source of truth for **deprecated APIs awaiting removal**.
Each entry has a hard removal trigger so legacy code is never forgotten
indefinitely ("context rot"). The release manager removes an item once its
trigger fires; the per-item checklist makes the removal mechanical.

Companion docs: deprecation announcements live in [`CHANGELOG.md`](CHANGELOG.md);
the inline deprecation warning is emitted from
`v2/src/modules/recipes/recipes.js`.

---

## Pending removals

### `Modules.Recipes.computeMealNutrients` → `calculateNutrition`

| Field | Value |
|---|---|
| **Deprecated in** | 2.3.0 — 2026-06-17 |
| **Replacement** | `Modules.Recipes.calculateNutrition` / `NutritionCalculator.calculateNutrition` |
| **Removal trigger** | **2.5.0 OR 2026-12-17 (6 months), whichever comes first** |
| **Enforcement** | `npm run audit:legacy` (CI-blocking, `.github/workflows/verify-build.yml`) |

**Why deprecated:** the nutrient-summing seam was renamed to the clearer
`calculateNutrition`. The old name is kept as a one-sunset-cycle alias so callers
migrate without a stop-the-world refactor of core nutrition math.

**Removal checklist (do all, in `v2/src/modules/recipes/recipes.js` unless noted):**
1. Delete the `computeMealNutrients` alias function and its `// @deprecated` export
   line; remove it from the module header's Public API block.
2. Delete `v2/scripts/audit-legacy-usage.sh`, the `audit:legacy` script in
   `v2/package.json`, and the "Audit legacy nutrition-engine usage" step in
   `.github/workflows/verify-build.yml`.
3. Drop the Migration Guide row + Deprecated entry from `CHANGELOG.md` (or move to
   a `### Removed` entry under the removal version).
4. Remove this section from `RETIRED.md`.
5. Rebuild (`cd v2 && npm run build`) so `v2/app.js` is regenerated, and run the
   Playwright suite to confirm no caller still depends on the alias.

> Keep `window.NutritionCalculator` and `Modules.Recipes.calculateNutrition` —
> only the `computeMealNutrients` alias is being retired.
