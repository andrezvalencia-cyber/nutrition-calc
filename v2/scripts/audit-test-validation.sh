#!/usr/bin/env bash
#
# audit-test-validation.sh — deterministic blocking gate for Nutrition SME
# release sign-off. "Verify by machine, not by eye."
#
# Reads v2/tests/VALIDATION.md (the persistent SME sign-off record for the
# current release cycle) and FAILS (exit 1) if the file is missing or if any of
# its sign-off checkboxes is still empty. Wired into CI
# (.github/workflows/verify-build.yml via `npm run audit:test-validation`) so an
# unsigned validation artifact blocks the merge — SME approval becomes a
# deterministic gate instead of a reviewer's memory.
#
# Checkbox detection is whitespace-robust: leading indentation, the list marker
# (-, *, or +), the gap before the bracket, and inner-bracket spacing all vary
# freely in real-world markdown. The two states are mutually exclusive:
#   checked   : ^<ws>[-*+]<ws>[ <x|X> ]   e.g. "- [x]", "  *  [ X ]"
#   unchecked : ^<ws>[-*+]<ws>[ <ws|empty> ]   e.g. "- [ ]", "-[]", "+ []"
# The gate passes only when there are ZERO empty checkboxes AND at least the
# three required sign-off boxes are checked (the second clause guards against a
# truncated or corrupt file that contains no checkboxes at all).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATION_FILE="$SCRIPT_DIR/../tests/VALIDATION.md"
REQUIRED_CHECKS=3

FAIL_MSG="FAIL: Nutrition SME sign-off incomplete in v2/tests/VALIDATION.md"

if [ ! -f "$VALIDATION_FILE" ]; then
  echo "$FAIL_MSG" >&2
  echo "  (file not found — the SME sign-off record is missing)" >&2
  exit 1
fi

# A list item whose bracket holds only whitespace (or nothing) is unchecked.
UNCHECKED_RE='^[[:space:]]*[-*+][[:space:]]+\[[[:space:]]*\]'
# A list item whose bracket holds x or X (any surrounding space) is signed off.
CHECKED_RE='^[[:space:]]*[-*+][[:space:]]+\[[[:space:]]*[xX][[:space:]]*\]'

# grep -c prints "0" and exits 1 on no match; `|| true` keeps `set -e` happy.
unchecked="$(grep -cE "$UNCHECKED_RE" "$VALIDATION_FILE" || true)"
checked="$(grep -cE "$CHECKED_RE" "$VALIDATION_FILE" || true)"

if [ "$unchecked" -ne 0 ] || [ "$checked" -lt "$REQUIRED_CHECKS" ]; then
  echo "$FAIL_MSG" >&2
  echo "  found: $checked checked, $unchecked empty (require $REQUIRED_CHECKS checked and 0 empty)" >&2
  echo "  The Nutrition SME must mark every checkbox [x] before this PR can merge." >&2
  exit 1
fi

echo "PASS: Nutrition SME sign-off complete ($checked/$REQUIRED_CHECKS checkboxes marked) in v2/tests/VALIDATION.md"
exit 0
