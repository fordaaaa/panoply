// Finding verification: confirm each reported {file, line, snippet} still
// matches the working tree, tolerating small line drift.
//
// Zero dependencies, by design.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DRIFT = 5;

/** Dedupe key: path + category + snippet. Line is deliberately ignored. */
function keyOf(f) {
  const p = (f?.file ?? f?.path ?? "").trim();
  const c = (f?.category ?? "").trim();
  const s = (f?.snippet ?? "").trim();
  return `${p}${c}${s}`;
}

/**
 * Drop repeat findings on path+category+snippet, keeping first occurrence.
 *
 * @param {Array<object>} findings
 * @returns {Array<object>}
 */
export function dedupe(findings = []) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** True when a file line satisfies the reported snippet (either direction). */
function lineMatches(lineText, snippet) {
  if (!lineText || !snippet) return false;
  if (lineText.includes(snippet)) return true;
  const t = lineText.trim();
  return t.length >= 3 && snippet.includes(t);
}

/** First 1-based line number whose text matches, or -1. */
function findSnippet(lines, snippet, from = 0, to = lines.length) {
  for (let i = Math.max(0, from); i < Math.min(lines.length, to); i++) {
    if (lineMatches(lines[i], snippet)) return i + 1;
  }
  return -1;
}

/**
 * Verify findings against the files on disk.
 *
 * @param {Array<{ file: string, line: number, snippet: string, category: string }>} findings
 * @param {{ cwd?: string }} opts
 * @returns {{ verified: Array<object & { verifiedLine: number }>,
 *   dropped: Array<{ finding: object, reason: string }> }}
 */
export function verifyFindings(findings = [], { cwd = process.cwd() } = {}) {
  const verified = [];
  const dropped = [];

  for (const finding of findings) {
    const file = finding?.file ?? finding?.path;
    const snippet = (finding?.snippet ?? "").trim();
    const rawLine = Number(finding?.line);

    if (!file) {
      dropped.push({ finding, reason: "missing file" });
      continue;
    }
    if (!snippet) {
      dropped.push({ finding, reason: "empty snippet" });
      continue;
    }
    const abs = join(cwd, file);
    if (!existsSync(abs)) {
      dropped.push({ finding, reason: `file not found: ${file}` });
      continue;
    }
    let lines;
    try {
      lines = readFileSync(abs, "utf8").split("\n");
    } catch (err) {
      dropped.push({ finding, reason: `unreadable file: ${file} (${err?.message ?? err})` });
      continue;
    }

    // Explicitly mispositioned lines (0, negative, NaN, out of range):
    // fall back to a whole-file snippet search instead of trusting the line.
    const mispositioned = !Number.isInteger(rawLine) || rawLine < 1 || rawLine > lines.length;
    if (mispositioned) {
      const hit = findSnippet(lines, snippet);
      if (hit !== -1) {
        verified.push({ ...finding, verifiedLine: hit });
      } else {
        dropped.push({ finding, reason: `mispositioned line ${finding?.line} and snippet not found in ${file}` });
      }
      continue;
    }

    if (lineMatches(lines[rawLine - 1], snippet)) {
      verified.push({ ...finding, verifiedLine: rawLine });
      continue;
    }
    const lo = Math.max(0, rawLine - 1 - DRIFT);
    const hi = Math.min(lines.length, rawLine + DRIFT);
    const corrected = findSnippet(lines, snippet, lo, hi);
    if (corrected !== -1) {
      verified.push({ ...finding, verifiedLine: corrected });
    } else {
      dropped.push({ finding, reason: `snippet not found near line ${rawLine} (±${DRIFT}) in ${file}` });
    }
  }

  return { verified, dropped };
}
