# Changelog

All notable changes to the Vitality Nutrition Calculator are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Pure-logic performance benchmark (`npm run bench`) guarding hot `Modules.*`
  functions at < 5 ms per 1,000 iterations. Targets: `SyncMap.mergeHydration`,
  `SyncMap.buildEntryRow`, `Carryover.computeCarryover`, `Insights.aggregate`.
  Uses Node `perf_hooks`, median-based gating, env-configurable thresholds.

## Architecture: window.Modules.* namespace

All pure-logic modules live under `v2/src/modules/<context>/` and self-attach to
`window.Modules.*` via dual-mode IIFEs: `module.exports` for Node tests/benchmarks,
`global.Modules.X` in the browser. No bundler or ES imports.

| Module | Global path | Source |
|---|---|---|
| SyncMap | `Modules.SyncMap` | `src/modules/sync/sync-map.js` |
| Carryover | `Modules.Carryover` | `src/modules/carryover/carryover-engine.js` |
| Insights | `Modules.Insights` | `src/modules/insights/insights-engine.js` |
| GapEngine | `Modules.GapEngine` | `src/modules/gaps/gap-engine.js` |
| Recipes | `Modules.Recipes` | `src/modules/recipes/recipes.js` |
| Fallbacks | `Modules.Fallbacks` | `src/modules/fallbacks/fallbacks.js` |
| Templates | `Modules.Templates` | `src/modules/templates/templates.js` |
| Log | `Modules.Log` | `src/modules/log/log.js` |
| History | `Modules.History` | `src/modules/history/history.js` |
| Catalog | `Modules.Catalog` | `src/modules/catalog/catalog.js` |
| Scanner | `Modules.Scanner` | `src/modules/scanner/scanner.js` |
| Identity | `Modules.Identity` | `src/modules/identity/auth.js` |

This namespacing is the established pattern. There is no legacy global layer
to migrate from.
