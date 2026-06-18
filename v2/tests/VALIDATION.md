# Nutrition SME Validation — Release Sign-Off

> Persistent record of **Nutrition Subject-Matter-Expert (SME)** sign-off for the
> **current release cycle**. CI blocks any merge until every checkbox below is
> marked complete (`[x]`). The gate is `v2/scripts/audit-test-validation.sh`
> (run via `npm run audit:test-validation`). "Verify by machine, not by eye."
>
> When a new release cycle opens: reset every box to `[ ]`, refresh the metadata
> below, and have the Nutrition SME re-validate before the next merge.

**Release cycle:** <!-- e.g. v2.4.0 -->
**Nutrition SME:** <!-- name -->
**Sign-off date (UTC):** <!-- YYYY-MM-DD -->

## Required checklist

- [ ] **Nutrition math & formulas reviewed** — calculation logic, carryover (B12 + Vit E weekly ÷ 7, Vit D intentionally 0; see `v2/src/modules/carryover/carryover-engine.js`) and fallback target resolution (`v2/src/modules/fallbacks/fallback-engine.js`) produce SME-correct values.
- [ ] **Test corpus verified** — `INGREDIENTS`, `RECIPES`, and `SUPPLEMENT_RECIPES` nutrient fields in `v2/data.js` (and any test fixtures) match authoritative nutrition data.
- [ ] **Nutrient targets validated** — per-nutrient RDA/target values reviewed against an authoritative source (DRI/RDA).
