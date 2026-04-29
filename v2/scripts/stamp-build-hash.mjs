#!/usr/bin/env node
// Replaces __BUILD_HASH__ in sw.js and index.html with the current
// commit SHA (short). Designed to run from CI after the build steps,
// just before the Pages artifact upload. Idempotent: re-running with
// no placeholders left is a no-op.
//
// Source priority:
//   1. process.env.GITHUB_SHA (set by GitHub Actions)
//   2. `git rev-parse --short HEAD`
//   3. literal "dev" (last-resort fallback)
//
// Local dev: do NOT run this routinely. The SW + index.html are
// committed with the literal __BUILD_HASH__ placeholder so cache names
// stay stable in dev. CLAUDE.md §10 documents the rule.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const v2Root = resolve(here, "..");

function resolveHash() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const hash = resolveHash().slice(0, 8);
const targets = ["sw.js", "index.html"];
let total = 0;

for (const rel of targets) {
  const path = resolve(v2Root, rel);
  const src = readFileSync(path, "utf8");
  const next = src.replaceAll("__BUILD_HASH__", hash);
  if (next !== src) {
    writeFileSync(path, next);
    total += 1;
  }
}

if (!process.env.GITHUB_SHA && total > 0) {
  console.warn("[stamp] WARNING: ran outside CI and modified " + total + " file(s). " +
    "Do not commit these changes — sw.js and index.html should keep the __BUILD_HASH__ placeholder.");
}
console.log("[stamp] build hash: " + hash + " (" + total + " file(s) updated)");
