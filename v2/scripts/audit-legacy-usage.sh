#!/usr/bin/env bash
#
# audit-legacy-usage.sh — deterministic deprecation gate for the legacy
# nutrient-math name `Modules.Recipes.computeMealNutrients`.
#
# As of v2.3.0 the canonical name is `Modules.Recipes.calculateNutrition`
# (public alias: `NutritionCalculator.calculateNutrition`). The old name is a
# thin deprecated alias kept for one sunset cycle (removal v2.5.0 / 2026-12-17,
# whichever first — see RETIRED.md).
#
# This script FAILS (exit 1) if any source file under v2/src/ references the
# legacy name, EXCLUDING the definition file where the alias legitimately lives.
# It is wired into CI (.github/workflows/verify-build.yml via `npm run
# audit:legacy`) so reintroduction blocks the merge — advisory becomes
# deterministic enforcement.
#
# Detection is intentionally broad (verified by an adversarial Skeptic Pass):
# call form `computeMealNutrients(`, member access `.computeMealNutrients`,
# bracket access `['computeMealNutrients']` / ["computeMealNutrients"], and the
# object-key / destructuring-rename form `computeMealNutrients:` (e.g.
# `const { computeMealNutrients: f } = Modules.Recipes`) are all flagged, so
# aliasing the function out of the namespace cannot smuggle the legacy name past
# the gate. Scanned extensions cover current + likely-future source files.
#
# Known residuals (deliberately not handled — not maintenance-accident shaped):
#   - name and `(` split across two lines (grep is line-based);
#   - runtime-concatenated names like `['compute'+'MealNutrients']`.
# Closing these needs an AST lint (e.g. eslint no-restricted-syntax), out of scope.
#
# Out of scope by design: compiled v2/app.js (generated, outside src/), v2/tests/
# (the deprecation test calls the old name on purpose), and this script itself.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
# The one file allowed to mention the legacy name: the deprecated alias + export.
EXCLUDE="modules/recipes/recipes.js"

# Banned forms: call site, dot-access, object-key/destructuring, and bracket
# access (single/double quotes). -E extended regex; matches the name as a call or
# as any property reference/binding.
PATTERN="(computeMealNutrients[[:space:]]*\(|\.computeMealNutrients|computeMealNutrients[[:space:]]*:|\[[[:space:]]*['\"]computeMealNutrients['\"][[:space:]]*\])"

# grep exits 1 on no-match; under `set -e` that would abort, so guard with `|| true`.
hits="$(grep -rnE "$PATTERN" "$SRC_DIR" \
          --include='*.js' --include='*.jsx' \
          --include='*.mjs' --include='*.ts' --include='*.tsx' \
          | grep -v "$EXCLUDE" || true)"

if [ -n "$hits" ]; then
  echo "FAIL: legacy Modules.Recipes.computeMealNutrients usage detected in v2/src/:" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "Migrate to Modules.Recipes.calculateNutrition() (public alias:" >&2
  echo "NutritionCalculator.calculateNutrition()). See CHANGELOG.md migration guide." >&2
  exit 1
fi

echo "PASS: no legacy computeMealNutrients usage in v2/src/ (excluding $EXCLUDE)"
exit 0
