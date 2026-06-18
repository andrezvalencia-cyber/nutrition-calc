#!/usr/bin/env bash
#
# audit-test-validation.sh — deterministic blocking gate for Nutrition SME
# release sign-off. "Verify by machine, not by eye."
#
# Reads v2/tests/VALIDATION.md (the persistent SME sign-off record for the
# current release cycle) and FAILS (exit 1) unless every named sign-off in the
# checklist is checked. Wired into CI (.github/workflows/verify-build.yml via
# `npm run audit:test-validation`) so an unsigned validation artifact blocks the
# merge — SME approval becomes a deterministic gate, not reviewer memory.
#
# THREAT MODEL (read before relaxing any rule below)
# ---------------------------------------------------
# This script enforces COMPLETENESS of the artifact, not AUTHENTICITY of the
# signer. A line-based grep is markdown-unaware. An earlier version that merely
# COUNTED checkboxes could be gamed (gate exits 0 with no real sign-off) by
# hiding the real items from the counter and/or padding decoy `- [x]` lines, via:
#   1. HTML comments  — `<!-- - [ ] real item -->`   (line starts with `<`)
#   2. blockquotes    — `> - [ ] real item`          (line starts with `>`)
#   3. zero-width chars — U+200B before the marker    (not POSIX [[:space:]])
#   4. decoy padding  — replace named items with N generic `- [x]` lines
# Counting alone cannot distinguish a decoy `- [x]` from a real sign-off, so this
# gate does NOT count — it PINS to the specific required labels (REQUIRED_KEYS).
# Each named sign-off must appear on a checked, ASCII-anchored, in-section line:
#   * Scoped to the `## Required checklist` section (decoys elsewhere, and the
#     header's `<!-- ... -->` metadata placeholders above it, never matter).
#   * ASCII/byte matching (LC_ALL=C) with the marker anchored at column 0
#     (`^[-*+]`), so blockquote / comment / zero-width prefixes don't qualify as
#     a checked line — hiding a required item removes its sign-off -> FAIL.
#   * Any `<!--` inside the section is treated as tampering and FAILS.
#   * No empty checkboxes may remain in the section.
# Authenticity — proof the *Nutrition SME* (not just any committer) signed — is
# enforced out-of-band by .github/CODEOWNERS on v2/tests/VALIDATION.md plus a
# branch-protection rule requiring code-owner review. This script intentionally
# does not (and cannot) verify identity.
#
# Adding/removing a checklist item: update REQUIRED_KEYS here AND the matching
# `- [ ] **<label>**` line in v2/tests/VALIDATION.md, in lockstep.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATION_FILE="$SCRIPT_DIR/../tests/VALIDATION.md"

# Stable label substrings for each required SME sign-off. Matched as fixed
# strings (grep -F), so regex metacharacters in a label (e.g. `&`) are literal.
REQUIRED_KEYS=(
  "Nutrition math & formulas reviewed"
  "Test corpus verified"
  "Nutrient targets validated"
)

FAIL_MSG="FAIL: Nutrition SME sign-off incomplete in v2/tests/VALIDATION.md"

fail() {
  echo "$FAIL_MSG" >&2
  echo "  $1" >&2
  echo "  The Nutrition SME must mark every checkbox [x] in the '## Required checklist' section before this PR can merge." >&2
  exit 1
}

if [ ! -f "$VALIDATION_FILE" ]; then
  fail "(file not found — the SME sign-off record is missing)"
fi

# Body of the '## Required checklist' section: lines after that heading up to the
# next level-2 heading (or EOF). Literal heading match (single space after ##) —
# no whitespace class needed, portable across gawk/mawk.
section="$(awk '/^## Required checklist/{f=1; next} /^## /{f=0} f' "$VALIDATION_FILE")"

if [ -z "${section//[$'\n\t ']/}" ]; then
  fail "('## Required checklist' section is missing or empty)"
fi

# HTML comment inside the section is the documented hide-the-real-item bypass.
if printf '%s\n' "$section" | LC_ALL=C grep -q '<!--'; then
  fail "(HTML comment found inside the checklist section — not allowed)"
fi

# Marker anchored at column 0; ASCII byte matching so a zero-width / non-ASCII
# prefix fails the `^[-*+]` anchor instead of sneaking past.
CHECKED_RE='^[-*+][[:space:]]+\[[[:space:]]*[xX][[:space:]]*\]'
UNCHECKED_RE='^[-*+][[:space:]]+\[[[:space:]]*\]'

# No empty checkbox may remain anywhere in the section.
unchecked="$(printf '%s\n' "$section" | LC_ALL=C grep -cE "$UNCHECKED_RE" || true)"
if [ "$unchecked" -ne 0 ]; then
  fail "found $unchecked empty checkbox(es) in the section (every required sign-off must be [x])"
fi

# The checked lines of the section, computed once.
checked_lines="$(printf '%s\n' "$section" | LC_ALL=C grep -E "$CHECKED_RE" || true)"

# Each named sign-off must appear on one of those checked lines.
for key in "${REQUIRED_KEYS[@]}"; do
  if ! printf '%s\n' "$checked_lines" | LC_ALL=C grep -qF -- "$key"; then
    fail "required sign-off not checked: \"$key\""
  fi
done

echo "PASS: Nutrition SME sign-off complete (${#REQUIRED_KEYS[@]}/${#REQUIRED_KEYS[@]} named checkboxes marked) in v2/tests/VALIDATION.md"
exit 0
