#!/usr/bin/env node
// Deterministic preview harness (part 1): emulate `ocr delegate preview`.
//
// Pure `git` + node:child_process — no external packages, no binary required.
// Never throws on an empty diff: empty git output yields [].
//
// Zero dependencies, by design. Nothing here phones home.

import { execSync } from "node:child_process";

/**
 * A single changed file in the preview.
 *
 * @typedef {object} PreviewFile
 * @property {string} path - repo-relative file path
 * @property {string} status - single-letter git status (A/M/D/R/...) or "?" for untracked
 * @property {number} added - lines added (0 when unknown, e.g. untracked)
 * @property {number} deleted - lines deleted (0 when unknown, e.g. untracked)
 * @property {boolean} isBinary - true when numstat reports `- -`
 * @property {boolean} isUntracked - true for `git ls-files --others` entries
 */

/**
 * Run a git command, returning stdout as a string.
 * Never throws: any failure (not a repo, bad ref, empty diff) yields "".
 *
 * @param {string} cmd - full shell command to run
 * @param {string} cwd - repo root to run in
 * @returns {string} stdout, or "" on any error
 */
function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

/**
 * Quote one shell argument with single quotes.
 *
 * @param {string} arg - raw argument (ref, sha, path)
 * @returns {string} safely quoted argument
 */
function q(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse `git diff --name-status` / `git show --name-status` output.
 * Rename/copy lines (`R100\told\tnew`) resolve to the new path.
 *
 * @param {string} text - raw --name-status stdout
 * @returns {Array<{path: string, status: string}>} one entry per line
 */
export function parseNameStatus(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const raw = (parts[0] ?? "").trim();
    if (!raw) continue;
    const status = raw[0];
    // Renames/copies carry old + new paths; the new path is what we review.
    const path = parts.length > 2 ? parts[parts.length - 1].trim() : (parts[1] ?? "").trim();
    if (!path) continue;
    out.push({ path, status });
  }
  return out;
}

/**
 * Parse `git diff --numstat` / `git show --numstat` output.
 * `- -` marks a binary file.
 *
 * @param {string} text - raw --numstat stdout
 * @returns {Map<string, {added: number, deleted: number, isBinary: boolean}>} by file path
 */
export function parseNumstat(text) {
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const path = parts[parts.length - 1].trim();
    if (!path) continue;
    const isBinary = parts[0].trim() === "-" && parts[1].trim() === "-";
    const added = isBinary ? 0 : (parseInt(parts[0].trim(), 10) || 0);
    const deleted = isBinary ? 0 : (parseInt(parts[1].trim(), 10) || 0);
    out.set(path, { added, deleted, isBinary });
  }
  return out;
}

/**
 * Join --name-status entries with --numstat counts.
 *
 * @param {string} statusOut - raw --name-status stdout
 * @param {string} numstatOut - raw --numstat stdout
 * @param {string} [untrackedOut=""] - raw `git ls-files --others` stdout
 * @returns {PreviewFile[]} preview rows; [] when everything is empty
 */
function merge(statusOut, numstatOut, untrackedOut = "") {
  const counts = parseNumstat(numstatOut);
  const seen = new Set();
  const files = [];
  for (const { path, status } of parseNameStatus(statusOut)) {
    const c = counts.get(path) ?? { added: 0, deleted: 0, isBinary: false };
    seen.add(path);
    files.push({ path, status, added: c.added, deleted: c.deleted, isBinary: c.isBinary, isUntracked: false });
  }
  for (const line of String(untrackedOut ?? "").split("\n")) {
    const path = line.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push({ path, status: "?", added: 0, deleted: 0, isBinary: false, isUntracked: true });
  }
  return files;
}

/**
 * Resolve the changed-file preview for one of three modes:
 * - workspace: staged + unstaged vs HEAD, plus untracked files
 * - range: `git diff --merge-base <from> <to>` (from/to required)
 * - commit: single commit by sha (in {from} or {to})
 *
 * Never throws on an empty diff — returns [].
 *
 * @param {object} [opts={}] - options
 * @param {string} [opts.from] - range base / commit sha
 * @param {string} [opts.to] - range head / commit sha (preferred for commit mode)
 * @param {string} [opts.mode="workspace"] - "workspace" | "range" | "commit"
 * @param {string} [opts.cwd=process.cwd()] - repo root to run git in
 * @returns {PreviewFile[]} [{path, status, added, deleted, isBinary, isUntracked}]
 */
export function getPreview({ from, to, mode = "workspace", cwd = process.cwd() } = {}) {
  if (mode === "workspace") {
    return merge(
      runGit("git diff HEAD --name-status", cwd),
      runGit("git diff HEAD --numstat", cwd),
      runGit("git ls-files --others --exclude-standard", cwd),
    );
  }
  if (mode === "range") {
    if (!from || !to) throw new Error("getPreview: range mode requires {from, to}");
    return merge(
      runGit(`git diff --merge-base ${q(from)} ${q(to)} --name-status`, cwd),
      runGit(`git diff --merge-base ${q(from)} ${q(to)} --numstat`, cwd),
    );
  }
  if (mode === "commit") {
    const sha = to ?? from;
    if (!sha) throw new Error("getPreview: commit mode requires a sha in {from} or {to}");
    return merge(
      runGit(`git show --name-status --format= ${q(sha)}`, cwd),
      runGit(`git show --numstat --format= ${q(sha)}`, cwd),
    );
  }
  throw new Error(`getPreview: unknown mode \`${mode}\` (want workspace|range|commit)`);
}
