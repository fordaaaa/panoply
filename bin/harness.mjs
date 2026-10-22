#!/usr/bin/env node
// Deterministic harness preview CLI (part 3).
//
//   node bin/harness.mjs --preview [--from X --to Y] [--mode workspace|range|commit] [--json] [--lens 3]
//
// Zero dependencies. Imports runHarness from lib/harness/index.mjs —
// that module owns all git + gate logic; this file only parses args,
// prints, and sets the exit code.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const cwd = resolve(process.cwd());
const argv = process.argv.slice(2);

const USAGE = `Deterministic harness preview (no subagents, pure git).

  node bin/harness.mjs --preview [--from X --to Y] [--mode workspace|range|commit] [--json] [--lens 3]

  --preview        print preview table (path | status | +/-) + skipped + coverage + lenses
  --from X         range/commit start (merge-base resolution lives in runHarness)
  --to Y           range end (default HEAD)
  --mode <name>    workspace | range | commit (default: workspace, or range when --from given)
  --lens <n>       lens count for assignments (default 3)
  --json           print full runHarness JSON instead of the human table
  --help           show this text`;

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const flag = (name) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const MODES = ["workspace", "range", "commit"];
let mode = flag("mode");
const from = flag("from");
const to = flag("to");
if (!mode) mode = from || to ? "range" : "workspace";
if (!MODES.includes(mode)) {
  console.error(`! unknown mode \`${mode}\` — one of: ${MODES.join(", ")}`);
  process.exit(1);
}

let lensCount = 3;
const lensRaw = flag("lens");
if (lensRaw !== undefined) {
  lensCount = Number.parseInt(String(lensRaw), 10);
  if (!Number.isFinite(lensCount) || lensCount < 1) {
    console.error(`! --lens must be a positive integer, got \`${lensRaw}\``);
    process.exit(1);
  }
}

const asJson = has("json");

// --- load runHarness (owned by lib/harness, not reimplemented here) --------

let runHarness;
try {
  ({ runHarness } = await import("../lib/harness/index.mjs"));
} catch (err) {
  console.error(
    `! lib/harness/index.mjs is missing or failed to load (${err?.message ?? err}).\n` +
    `  Parts 1/2 (gates + verify) must land first — this CLI only prints what runHarness({cwd, from, to, mode, lensCount}) returns.`,
  );
  process.exit(1);
}
if (typeof runHarness !== "function") {
  console.error(`! lib/harness/index.mjs does not export runHarness({cwd, from, to, mode, lensCount}) — refusing to guess.`);
  process.exit(1);
}

// --- run -------------------------------------------------------------------

let result;
try {
  result = await runHarness({ cwd, from, to, mode, lensCount });
} catch (err) {
  console.error(`! git failed: ${err?.message ?? err}`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Normalize the two naming conventions (camelCase emulation vs ocr snake_case).
// runHarness returns { preview (all files), reviewed (subset), skipped, coverage }.
const previewAll =
  result.preview ?? result.reviewable ?? result.reviewable_files ?? result.files ?? [];
const reviewable =
  result.reviewable ?? result.reviewable_files ?? result.files ?? previewAll;
const skipped =
  result.skipped ?? result.excluded ?? [];
const total = result.total ?? (Array.isArray(previewAll) ? previewAll.length : 0);
const reviewedCount = Array.isArray(result.reviewed)
  ? result.reviewed.length
  : (result.reviewed ?? (Array.isArray(reviewable) ? reviewable.length : 0));
const lenses = result.lenses ?? result.assignments ?? roundRobin(reviewable, lensCount);
const usedOcr = result.fastPath ?? result.ocr ?? null;

function roundRobin(files, n) {
  const out = Array.from({ length: n }, () => []);
  files.forEach((f, i) => out[i % n].push(typeof f === "string" ? f : (f.path ?? String(f))));
  return out;
}

function fileRow(f) {
  if (typeof f === "string") return { path: f, status: "?", delta: "" };
  const status = f.status ?? f.code ?? "?";
  const adds = f.adds ?? f.additions ?? f.plus ?? f.added;
  const dels = f.dels ?? f.deletions ?? f.minus ?? f.deleted;
  const delta = adds !== undefined || dels !== undefined ? `+${adds ?? 0}/-${dels ?? 0}` : (f.delta ?? "");
  return { path: f.path ?? "?", status, delta };
}

function lensFiles(lens) {
  if (Array.isArray(lens)) return lens.map((f) => (typeof f === "string" ? f : (f.path ?? String(f))));
  if (lens && typeof lens === "object") {
    const files = lens.files ?? lens.paths ?? [];
    return { name: lens.name ?? "lens", files: files.map((f) => (typeof f === "string" ? f : (f.path ?? String(f)))) };
  }
  return [];
}

console.log(`Preview (mode: ${mode}${usedOcr ? `, fast-path: ${usedOcr}` : ""})`);
console.log(`path | status | +/-`);
for (const f of reviewable) {
  const r = fileRow(f);
  console.log(`${r.path} | ${r.status} | ${r.delta}`);
}
if (!reviewable.length) console.log(`  (no reviewable files)`);

if (skipped.length) {
  console.log(`\nSkipped:`);
  for (const s of skipped) {
    if (typeof s === "string") console.log(`  ${s}`);
    else console.log(`  ${s.path} — ${s.reason ?? "no reason (coverage bug)"}`);
  }
}

// Coverage line: prefer the lib's own string, else compute it here.
if (typeof result.coverage === "string" && result.coverage.length) {
  console.log(`\n${result.coverage}`);
} else {
  const counts = {};
  for (const s of skipped) {
    const r = typeof s === "string" ? "unknown" : (s.reason ?? "unknown");
    counts[r] = (counts[r] ?? 0) + 1;
  }
  const breakdown = Object.entries(counts).map(([r, n]) => `${r}: ${n}`).join(", ");
  console.log(`\ntotal ${total} / reviewed ${reviewedCount} / skipped ${skipped.length}${breakdown ? ` (${breakdown})` : ""}`);
}

console.log(`\nLenses (${lensCount}):`);
lenses.forEach((lens, i) => {
  const lf = lensFiles(lens);
  if (Array.isArray(lf)) {
    console.log(`  lens ${i + 1}: ${lf.length ? lf.join(", ") : "(none)"}`);
  } else {
    console.log(`  ${lf.name}: ${lf.files.length ? lf.files.join(", ") : "(none)"}`);
  }
});
