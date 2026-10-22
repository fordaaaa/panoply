// Blast-radius ordering for reviewed files.
//
// Zero dependencies, by design. Shells out to `rg` (falling back to
// `git grep`) via execSync for importer discovery; every failure
// degrades to "no callers found" rather than throwing.

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SECURITY_RE = /auth|secret|crypto|upload|sql|exec|token|session|password/i;
const TEST_PATH_RE = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/)/i;
const TEST_FILE_RE = /(\.test\.|\.spec\.|_test\.|test_)/i;
const SAFE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;
const MAX_HITS = 200;
const MAX_CALLERS = 50;
const MAX_SECOND_HOP_FANOUT = 10;

/** Basename without its last extension: `src/auth.mjs` -> `auth`. */
function baseOf(p) {
  return basename(p).replace(/\.[^.]+$/, "");
}

/** Single-quote a shell arg. Names are pre-validated, this is belt-and-braces. */
function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Files under cwd mentioning `name`, via rg with a git-grep fallback.
 * Returns [] on any error (rg missing, not a repo, timeout, ...).
 */
function searchFiles(name, cwd) {
  if (!name || !SAFE_NAME_RE.test(name)) return [];
  try {
    const out = execSync(`rg -l --no-messages -- ${shQuote(name)} .`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, MAX_HITS);
  } catch {
    // rg missing or no match (rg exits 1 on no match) — try git grep.
  }
  try {
    const out = execSync(`git grep -l -e ${shQuote(name)} -- .`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, MAX_HITS);
  } catch {
    return [];
  }
}

/** True when the path itself is a test, or a sibling test file exists. */
function hasTestCover(filePath, cwd) {
  if (TEST_PATH_RE.test(filePath)) return true;
  try {
    const dir = dirname(join(cwd, filePath));
    if (!existsSync(dir)) return false;
    const base = baseOf(filePath).replace(/\.(test|spec)$/i, "").toLowerCase();
    if (!base) return false;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const n = e.name;
      if (n.toLowerCase().startsWith(base) && TEST_FILE_RE.test(n)) return true;
    }
    if (existsSync(join(dir, "__tests__"))) return true;
    return false;
  } catch {
    return false;
  }
}

/** Direct importers: files mentioning this file's basename, minus itself. */
function directImporters(filePath, cwd) {
  const hits = searchFiles(baseOf(filePath), cwd);
  const seen = new Set();
  for (const h of hits) {
    const norm = h.replace(/^\.\//, "");
    if (norm === filePath || norm.endsWith(`/${filePath}`)) continue;
    seen.add(norm);
  }
  return [...seen].sort();
}

/** 1-2 hop caller set: direct importers plus importers-of-importers. */
function findCallers(filePath, cwd) {
  const direct = directImporters(filePath, cwd);
  const all = new Set(direct);
  for (const c of direct.slice(0, MAX_SECOND_HOP_FANOUT)) {
    for (const h of searchFiles(baseOf(c), cwd)) {
      const norm = h.replace(/^\.\//, "");
      if (norm === filePath || all.has(norm)) continue;
      all.add(norm);
      if (all.size >= MAX_CALLERS) break;
    }
    if (all.size >= MAX_CALLERS) break;
  }
  all.delete(filePath);
  return { direct, callers: [...all].sort().slice(0, MAX_CALLERS) };
}

function riskOf(filePath, directCount, cwd) {
  if (SECURITY_RE.test(filePath)) return "security";
  if (!hasTestCover(filePath, cwd)) return "no-test";
  if (directCount >= 3) return "hub";
  return "normal";
}

const RISK_RANK = { security: 0, "no-test": 1, hub: 2, normal: 3 };

/**
 * Partition an ordered list into `lensCount` non-overlapping round-robin
 * groups. Every entry appears in exactly one lens.
 */
export function assignLenses(ordered, lensCount = 1) {
  const n = Math.max(1, Math.floor(Number(lensCount) || 1));
  const lenses = Array.from({ length: n }, () => []);
  (ordered ?? []).forEach((entry, i) => lenses[i % n].push(entry));
  return lenses;
}

/**
 * Rank reviewed files by blast-radius risk and split `budget` across them.
 *
 * @param {Array<string | { path?: string, file?: string }>} reviewedFiles
 * @param {{ cwd?: string, budget?: number }} opts
 * @returns {{ ordered: Array<{ path: string, risk: string, callers: string[] }>,
 *   assignments: Array<{ path: string, budget: number }> }}
 */
export function orderBlast(reviewedFiles, { cwd = process.cwd(), budget = 100 } = {}) {
  const paths = [...new Set(
    (reviewedFiles ?? []).map((f) =>
      typeof f === "string" ? f : (f?.path ?? f?.file ?? String(f)),
    ).filter(Boolean),
  )];

  const ordered = paths.map((p) => {
    const { direct, callers } = findCallers(p, cwd);
    return { path: p, risk: riskOf(p, direct.length, cwd), callers };
  }).sort((a, b) =>
    (RISK_RANK[a.risk] - RISK_RANK[b.risk]) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );

  // Round-robin budget split in risk order; no file exceeds 40% of budget.
  const total = Math.max(0, Math.floor(Number(budget) || 0));
  const cap = total > 0 ? Math.max(1, Math.floor(total * 0.4)) : 0;
  const shares = ordered.map(() => 0);
  let remaining = total;
  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < ordered.length && remaining > 0; i++) {
      if (shares[i] < cap) {
        shares[i]++;
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const assignments = ordered.map((e, i) => ({ path: e.path, budget: shares[i] }));

  return { ordered, assignments };
}
