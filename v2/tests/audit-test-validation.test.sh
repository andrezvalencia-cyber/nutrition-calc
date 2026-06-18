#!/usr/bin/env bash
#
# audit-test-validation.test.sh — regression oracle for the Nutrition SME
# sign-off gate (../scripts/audit-test-validation.sh).
#
# Exercises the REAL gate script against crafted VALIDATION.md fixtures, asserting
# its exit code per case. Covers the adversarial bypass vectors that motivated
# label-pinning: HTML-comment hiding, blockquote hiding, zero-width-space hiding,
# and decoy `- [x]` padding. The gate must FAIL (exit 1) on every bypass.
#
# It mutates ../tests/VALIDATION.md in place and restores it from a backup on
# exit (no test-only seam in the production script). Run: `npm run test:validation-gate`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../scripts/audit-test-validation.sh"
TARGET="$HERE/VALIDATION.md"

BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; }
trap restore EXIT

ZWSP=$'\xe2\x80\x8b'   # U+200B, not POSIX [[:space:]]
PASSES=0
FAILS=0

# emit: build a VALIDATION.md with standard preamble + heading, checklist body
# read from stdin.
emit() {
  {
    printf '# Nutrition SME Validation\n\n'
    printf '**Release cycle:** test\n**Nutrition SME:** <!-- name -->\n\n'
    printf '## Required checklist\n\n'
    cat
  } > "$TARGET"
}

# assert_exit <name> <expected_exit>
assert_exit() {
  local name="$1" expect="$2" rc=0
  bash "$GATE" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq "$expect" ]; then
    printf 'ok     - %s (exit %d)\n' "$name" "$rc"
    PASSES=$((PASSES + 1))
  else
    printf 'NOT OK - %s (exit %d, expected %d)\n' "$name" "$rc" "$expect"
    FAILS=$((FAILS + 1))
  fi
}

# --- Happy path: all three named items checked (mixed case + inner spacing) ---
emit <<EOF
- [x] **Nutrition math & formulas reviewed** — formulas validated.
- [X] **Test corpus verified** — corpus accurate.
-  [ x ] **Nutrient targets validated** — targets reviewed.
EOF
assert_exit "all three named items checked -> PASS" 0

# --- Empty checklist -> FAIL ---
emit <<EOF
- [ ] **Nutrition math & formulas reviewed** — formulas validated.
- [ ] **Test corpus verified** — corpus accurate.
- [ ] **Nutrient targets validated** — targets reviewed.
EOF
assert_exit "all empty -> FAIL" 1

# --- One item left empty -> FAIL ---
emit <<EOF
- [x] **Nutrition math & formulas reviewed** — formulas validated.
- [x] **Test corpus verified** — corpus accurate.
- [ ] **Nutrient targets validated** — targets reviewed.
EOF
assert_exit "one empty -> FAIL" 1

# --- BYPASS 1: real items hidden in HTML comment, decoys added -> FAIL ---
emit <<EOF
<!-- - [ ] **Nutrition math & formulas reviewed** -->
<!-- - [ ] **Test corpus verified** -->
<!-- - [ ] **Nutrient targets validated** -->
- [x] decoy one
- [x] decoy two
- [x] decoy three
EOF
assert_exit "html-comment hide + decoys -> FAIL" 1

# --- BYPASS 2: real items in blockquote, decoys added -> FAIL ---
emit <<EOF
> - [ ] **Nutrition math & formulas reviewed**
> - [ ] **Test corpus verified**
> - [ ] **Nutrient targets validated**
- [x] decoy one
- [x] decoy two
- [x] decoy three
EOF
assert_exit "blockquote hide + decoys -> FAIL" 1

# --- BYPASS 3: real items prefixed with zero-width space, decoys added -> FAIL ---
emit <<EOF
${ZWSP}- [ ] **Nutrition math & formulas reviewed**
${ZWSP}- [ ] **Test corpus verified**
${ZWSP}- [ ] **Nutrient targets validated**
- [x] decoy one
- [x] decoy two
- [x] decoy three
EOF
assert_exit "zero-width-space hide + decoys -> FAIL" 1

# --- BYPASS 4: decoy-only checked lines, none of the named items -> FAIL ---
emit <<EOF
- [x] decoy one
- [x] decoy two
- [x] decoy three
EOF
assert_exit "decoy-only checked (no named items) -> FAIL" 1

# --- Missing section entirely -> FAIL ---
{
  printf '# Nutrition SME Validation\n\n'
  printf 'No checklist section here.\n'
} > "$TARGET"
assert_exit "missing checklist section -> FAIL" 1

# --- Tolerance: all three named items checked + an extra checked decoy -> PASS ---
emit <<EOF
- [x] **Nutrition math & formulas reviewed**
- [x] **Test corpus verified**
- [x] **Nutrient targets validated**
- [x] harmless extra note
EOF
assert_exit "three named + extra checked decoy -> PASS" 0

echo "----"
echo "validation-gate self-test: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
