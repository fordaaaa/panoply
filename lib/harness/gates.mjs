#!/usr/bin/env node
// Deterministic 6-gate file filter (part 1): port of commands/_deterministic.md.
// Gates run in order; first match wins. No external packages.
//
// Zero dependencies, by design. Nothing here phones home.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Gate 2 — secret patterns, dropped with reason `secret`. */
const SECRET_PATTERNS = [".ssh/id_*", ".env*", "*.pem", "*.key", "credentials*.json"];

/** Gate 5 — basenames always dropped as lockfiles. */
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "Cargo.lock", "Gemfile.lock"]);

/** Gate 5 — extensions that survive (lowercase, no dot). */
const ALLOWED_EXT = new Set([
  "go", "java", "ts", "js", "mjs", "cjs", "mts", "cts", "tsx", "jsx",
  "py", "rs", "php", "rb", "c", "h", "cpp",
  "cs", "swift", "kt", "scala", "sh", "tf", "yaml", "yml", "json",
  "md", "sql", "graphql",
]);

/** Gate 6 — default excludes, dropped with reason `default-exclude`. */
const DEFAULT_EXCLUDES = [
  "*_test.go", "*.test.ts", "__tests__/", "fixtures/", "snapshots/",
  "*.gen.*", "*.pb.go", "vendor/", "node_modules/", "dist/", "target/",
];

/**
 * Tiny glob matcher supporting `*`, `**`, and `?` — no dependencies.
 * `*` spans within a segment, `**` spans segments, `?` is one non-slash char.
 * A trailing `/` means "this directory and everything under it".
 * Patterns without a leading double-star prefix also match at any depth,
 * so a `*.pem` pattern catches `certs/key.pem` and `.ssh/id_*`
 * catches `home/.ssh/id_rsa`.
 *
 * @param {string} path - repo-relative file path (forward or back slashes)
 * @param {string} pattern - glob pattern
 * @returns {boolean} true when the path matches
 */
export function matchGlob(path, pattern) {
  const s = String(path ?? "").replace(/\\/g, "/");
  const p = String(pattern ?? "").replace(/\\/g, "/");
  if (!s || !p) return false;
  if (matchOne(s, p)) return true;
  if (!p.includes("/")) {
    const base = s.slice(s.lastIndexOf("/") + 1);
    if (matchOne(base, p)) return true;
  } else if (!p.startsWith("**/")) {
    if (matchOne(s, `**/${p}`)) return true;
  }
  return false;
}

/**
 * Match a whole string against one glob with no fallback.
 *
 * @param {string} str - string to test
 * @param {string} pat - glob pattern
 * @returns {boolean} true on full match
 */
function matchOne(str, pat) {
  let re = "";
  const p = pat.endsWith("/") ? `${pat}**` : pat;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      let j = i;
      while (p[j + 1] === "*") j++;
      if (j > i) {
        i = j;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+.^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`).test(str);
}

/**
 * Lowercase extension without the dot, or "" when there is none.
 * Dotfiles like `.env` count as extensionless here (gate 2 owns them).
 *
 * @param {string} path - repo-relative file path
 * @returns {string} extension or ""
 */
function extOf(path) {
  const base = String(path).slice(String(path).lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Gate 5 predicate: true when the path has an unsupported extension,
 * is a lockfile, or is generated protobuf.
 *
 * @param {string} path - repo-relative file path
 * @returns {boolean} true when gate 5 drops the file
 */
function isUnsupported(path) {
  const base = String(path).slice(String(path).lastIndexOf("/") + 1);
  if (LOCKFILES.has(base)) return true;
  if (String(path).includes(".gen.") || path.endsWith(".pb.go")) return true;
  return !ALLOWED_EXT.has(extOf(path));
}

/**
 * Per-glob review checklist — the embedded rule essence from
 * commands/_deterministic.md. Only these four exist; nothing invented.
 *
 * @param {string} path - repo-relative file path
 * @returns {string} checklist text, or "" when no glob covers the path
 */
export function checklistFor(path) {
  const ext = extOf(path);
  if (ext === "go" || ext === "java") {
    return "null/NPE validation on every dereference; map + mutex thread-safety; tx rollback on every error return.";
  }
  if (ext === "ts" || ext === "js" || ext === "mjs" || ext === "cjs" || ext === "mts" || ext === "cts" || ext === "tsx" || ext === "jsx") {
    return "unhandled promise/async error paths; template-escaping/XSS on every interpolated string; null/undefined guards at boundaries.";
  }
  if (ext === "py") {
    return "unhandled exception paths; SQL binding (no string-concatenated queries); mutable-default-arg and None-guard checks.";
  }
  if (ext === "rs" || ext === "php") {
    return "unchecked unwrap/error paths; XSS/escaping on output; SQLi/binding on queries.";
  }
  return "";
}

/**
 * Load `.opencodereview/rule.json` (`{include[], exclude[], rules[]}`)
 * for gates 3–4. Absent file (or unreadable/invalid JSON) skips silently.
 *
 * @param {string} [cwd=process.cwd()] - repo root
 * @returns {object|null} parsed rule.json, or null when absent
 */
export function loadRuleJson(cwd = process.cwd()) {
  const file = join(String(cwd), ".opencodereview", "rule.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // corrupt rule file skips silently, like an absent one
  }
}

/**
 * Apply the 6-gate filter in exact order; first match wins.
 * 1 binary → `binary`; 2 secrets → `secret`; 3 ruleJson.exclude →
 * `rule-exclude`; 4 ruleJson.include → kept, later gates bypassed;
 * 5 unsupported ext → `unsupported`; 6 default excludes → `default-exclude`.
 *
 * @param {Array<object>} [files=[]] - preview rows ({path, ...})
 * @param {object} [opts={}] - options
 * @param {object|null} [opts.ruleJson] - parsed `.opencodereview/rule.json`
 * @returns {{reviewed: Array<object>, skipped: Array<{path: string, reason: string}>}}
 *   reviewed rows carry a `checklist` string; every skip carries a reason
 */
export function applyGates(files, { ruleJson } = {}) {
  const reviewed = [];
  const skipped = [];
  const exclude = ruleJson?.exclude ?? [];
  const include = ruleJson?.include ?? [];
  for (const file of files ?? []) {
    const path = file?.path;
    if (!path) continue;
    if (file.isBinary) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    if (SECRET_PATTERNS.some((p) => matchGlob(path, p))) {
      skipped.push({ path, reason: "secret" });
      continue;
    }
    if (exclude.some((p) => matchGlob(path, p))) {
      skipped.push({ path, reason: "rule-exclude" });
      continue;
    }
    if (include.some((p) => matchGlob(path, p))) {
      reviewed.push({ ...file, checklist: checklistFor(path) });
      continue;
    }
    if (isUnsupported(path)) {
      skipped.push({ path, reason: "unsupported" });
      continue;
    }
    if (DEFAULT_EXCLUDES.some((p) => matchGlob(path, p))) {
      skipped.push({ path, reason: "default-exclude" });
      continue;
    }
    reviewed.push({ ...file, checklist: checklistFor(path) });
  }
  return { reviewed, skipped };
}
