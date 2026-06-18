// audit-jsdoc.mjs — deterministic JSDoc enforcement for public module interfaces.
//
// Zero-dependency. Regex-based parser scoped to the repo's IIFE + function
// declaration idiom. Enforcement is allowlist-staged: only modules listed in
// ENFORCE are checked. Expand coverage by adding entries.
//
// What it checks per public (non-deprecated) function:
//   1. A /** */ JSDoc block immediately precedes the function declaration.
//   2. The block contains @returns.
//   3. The ordered @param names match the function's real parameter names exactly.
//      Zero-param functions must have no @param tags.
//
// "Types match" is interpreted as name/arity parity — JS has no runtime types,
// so param-name alignment is the reliable deterministic signal.
//
// Exit 0 + "PASS" on success; exit 1 + file:line violations on failure.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Allowlist (single source of enforcement scope) ──────────────────────────
const ENFORCE = [
  { file: "src/modules/recipes/recipes.js", context: "Recipes" },
];

const violations = [];

for (const entry of ENFORCE) {
  const absPath = resolve(__dirname, "..", entry.file);
  let src;
  try {
    src = readFileSync(absPath, "utf8");
  } catch (e) {
    violations.push({ file: entry.file, line: 0, reason: `cannot read file: ${e.message}` });
    continue;
  }

  const lines = src.split("\n");

  // ── Derive public interface from `global.Modules.<context> = { ... }` ───
  const exportRe = new RegExp(
    `global\\.Modules\\.${entry.context}\\s*=\\s*\\{([^}]+)\\}`,
    "s"
  );
  const exportMatch = src.match(exportRe);
  if (!exportMatch) {
    violations.push({
      file: entry.file,
      line: 0,
      reason: `cannot find global.Modules.${entry.context} = { ... } export block`,
    });
    continue;
  }

  const exportBody = exportMatch[1];
  const keyRe = /(\w+)\s*:\s*\w+/g;
  let keyMatch;
  const publicKeys = [];
  while ((keyMatch = keyRe.exec(exportBody)) !== null) {
    publicKeys.push(keyMatch[1]);
  }

  // ── Filter out @deprecated exports ────────────────────────────────────
  const enforced = publicKeys.filter((key) => {
    const keyLineIdx = exportBody.indexOf(key + ":");
    if (keyLineIdx === -1) return true;
    const surroundingSlice = exportBody.slice(
      Math.max(0, keyLineIdx - 10),
      keyLineIdx + key.length + 80
    );
    return !/@deprecated/i.test(surroundingSlice);
  });

  // ── Check each enforced function ──────────────────────────────────────
  for (const fnName of enforced) {
    const fnDeclRe = new RegExp(
      `^(\\s*)function\\s+${fnName}\\s*\\(([^)]*)\\)`,
      "m"
    );
    const fnMatch = src.match(fnDeclRe);
    if (!fnMatch) {
      violations.push({
        file: entry.file,
        line: 0,
        reason: `cannot find function declaration for '${fnName}'`,
      });
      continue;
    }

    const fnOffset = src.indexOf(fnMatch[0]);
    const fnLineNum =
      src.slice(0, fnOffset).split("\n").length;

    // Real param names from the signature
    const rawParams = fnMatch[2].trim();
    const realParams = rawParams
      ? rawParams.split(",").map((p) => p.trim().replace(/\s*=.*$/, ""))
      : [];

    // ── Find the JSDoc block immediately preceding the function ────────
    // Walk backwards from fnLineNum-1 to find */ then scan up to /**
    let jsdocEnd = -1;
    for (let i = fnLineNum - 2; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed === "") continue; // skip blank lines
      if (trimmed.endsWith("*/")) {
        jsdocEnd = i;
        break;
      }
      // If we hit a non-blank, non-comment-end line, there's no JSDoc
      break;
    }

    if (jsdocEnd === -1) {
      violations.push({
        file: entry.file,
        line: fnLineNum,
        reason: `missing JSDoc for '${fnName}'`,
      });
      continue;
    }

    let jsdocStart = -1;
    for (let i = jsdocEnd; i >= 0; i--) {
      if (lines[i].trim().startsWith("/**")) {
        jsdocStart = i;
        break;
      }
    }

    if (jsdocStart === -1) {
      violations.push({
        file: entry.file,
        line: fnLineNum,
        reason: `malformed JSDoc for '${fnName}' (found */ but no /**)`,
      });
      continue;
    }

    const jsdocBlock = lines.slice(jsdocStart, jsdocEnd + 1).join("\n");

    // ── Check @returns ─────────────────────────────────────────────────
    if (!/@returns\s/.test(jsdocBlock)) {
      violations.push({
        file: entry.file,
        line: jsdocStart + 1,
        reason: `JSDoc for '${fnName}' is missing @returns`,
      });
    }

    // ── Check @param names match real signature ────────────────────────
    // Handle nested braces in type expressions like {Array<{id: string, qty: number}>}
    const paramTagRe = /@param\s+\{(?:[^{}]|\{[^{}]*\})*\}\s+(\w+)/g;
    let paramMatch;
    const docParams = [];
    while ((paramMatch = paramTagRe.exec(jsdocBlock)) !== null) {
      docParams.push(paramMatch[1]);
    }

    if (realParams.length === 0 && docParams.length > 0) {
      violations.push({
        file: entry.file,
        line: jsdocStart + 1,
        reason: `'${fnName}' takes no params but JSDoc has @param: [${docParams.join(", ")}]`,
      });
    } else if (realParams.length > 0 && docParams.length === 0) {
      violations.push({
        file: entry.file,
        line: jsdocStart + 1,
        reason: `'${fnName}' has params [${realParams.join(", ")}] but JSDoc has no @param tags`,
      });
    } else if (
      realParams.length !== docParams.length ||
      !realParams.every((p, i) => p === docParams[i])
    ) {
      violations.push({
        file: entry.file,
        line: jsdocStart + 1,
        reason: `param mismatch for '${fnName}': expected [${realParams.join(", ")}], found [${docParams.join(", ")}]`,
      });
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    "FAIL: public-interface JSDoc violations detected:\n"
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line} — ${v.reason}\n`);
  }
  process.exit(1);
} else {
  const files = ENFORCE.map((e) => e.file).join(", ");
  process.stdout.write(
    `PASS: all enforced public interfaces have valid JSDoc (${files})\n`
  );
  process.exit(0);
}
