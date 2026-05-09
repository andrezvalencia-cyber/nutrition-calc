#!/usr/bin/env bash
# PreToolUse hook fired by Claude Code before a Bash tool call.
# Reads the proposed command from stdin (Claude Code hook protocol). If the
# command is `git commit ...` AND v2/src/app.jsx (or other build inputs) have
# changes, runs the v2 build pipeline and auto-stages v2/app.js.
#
# Exit semantics (Claude Code):
#   0 → tool call proceeds; stdout is appended to Claude's context.
#   2 → tool call BLOCKED; stderr is fed back to Claude.
#
# Belt-and-suspenders: even if this hook silently fails or is bypassed, the
# native .githooks/pre-commit re-validates v2/app.js before the commit lands.

set -euo pipefail

input="$(cat)"

cmd="$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
    print(payload.get("tool_input", {}).get("command", ""))
except Exception:
    print("")
' 2>/dev/null || true)"

# Match `git commit` but not `git commit-tree` or `git commitGraph` etc.
if ! printf '%s' "$cmd" | grep -qE '(^|[[:space:]&;|])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Resolve repo root from the hook's cwd (Claude runs hooks from the user's cwd).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ] || [ ! -d "$repo_root/v2" ]; then
  exit 0
fi

cd "$repo_root"

# Only build when build inputs are dirty (staged or unstaged).
trigger='^v2/(src/.*\.jsx?|input\.css|tailwind\.config\.js|babel\.config\.js|package(-lock)?\.json)$'
if ! git status --porcelain | awk '{print $2}' | grep -qE "$trigger"; then
  exit 0
fi

if [ ! -d v2/node_modules ]; then
  echo "claude-hook: v2/node_modules missing; skipping build (run 'cd v2 && npm install')." 1>&2
  exit 0
fi

echo "claude-hook: rebuilding v2 before commit..."
(
  cd v2
  if ! npm run build:css >/dev/null 2>&1; then
    echo "claude-hook: 'npm run build:css' FAILED — fix Tailwind config / input.css before committing." 1>&2
    exit 2
  fi
  if ! npm run build >/dev/null 2>&1; then
    echo "claude-hook: 'npm run build' FAILED — fix JSX in src/app.jsx before committing." 1>&2
    exit 2
  fi
)
build_rc=$?
[ "$build_rc" -ne 0 ] && exit "$build_rc"

# Auto-stage v2/app.js if the build changed it. (Per CLAUDE.md, app.js is the
# only artifact under git; tailwind-out.css is gitignored.)
if ! git diff --quiet -- v2/app.js; then
  git add v2/app.js
  echo "claude-hook: rebuilt and staged v2/app.js."
else
  echo "claude-hook: build clean; v2/app.js already in sync."
fi

exit 0
