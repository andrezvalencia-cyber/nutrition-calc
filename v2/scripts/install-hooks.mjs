#!/usr/bin/env node
// Idempotent: sets core.hooksPath=.githooks for the enclosing repo.
// Runs from `npm install` via the `prepare` lifecycle. Silently no-ops in
// non-git contexts (e.g. tarball installs, certain CI shapes).
import { execSync } from 'node:child_process';

try {
  const root = execSync('git rev-parse --show-toplevel', {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();

  if (!root) process.exit(0);

  execSync('git config core.hooksPath .githooks', {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  // Not a git repo, no permission, or git missing — leave hooks unconfigured.
}
