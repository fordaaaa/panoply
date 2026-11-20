#!/usr/bin/env node
// Vendors brig's investigator/builder/reviewer skills into panoply
// as brig-investigator/brig-builder/brig-reviewer.
//
// Brig is the source of truth for these three primitives. Panoply
// copies them (renaming frontmatter) so Claude renders them standalone;
// this script is the only sanctioned way to update the copies.
//
//   node bin/sync-brig-skills.mjs [--brig <path>] [--dry-run]
//
// Default brig path: $BRIG_CHECKOUT, else ~/Documents/GitHub/context-mcp,
// else <panoply>/../context-mcp. Stamps each vendored file with the brig
// commit it was synced from. After syncing run `node build.mjs` to
// regenerate .claude/skills/.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const brig = resolve(
  flag("brig") ??
    process.env.BRIG_CHECKOUT ??
    join(homedir(), "Documents", "GitHub", "context-mcp"),
);

const MAP = [
  ["investigator", "brig-investigator"],
  ["builder", "brig-builder"],
  ["reviewer", "brig-reviewer"],
];

function gitHead(cwd) {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

/** Split leading --- frontmatter --- from body. Frontmatter is flat `key: value`. */
function split(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const attrs = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) attrs[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { attrs, body: m[2].trim() };
}

const head = gitHead(brig);
console.log(`brig checkout: ${brig} @ ${head}`);

for (const [srcName, destName] of MAP) {
  const srcPath = join(brig, "skills", srcName, "SKILL.md");
  let raw;
  try { raw = readFileSync(srcPath, "utf8"); }
  catch { console.error(`  skip ${destName}: ${srcPath} not found`); process.exit(1); }
  const { attrs, body } = split(raw);
  const desc = attrs.description ?? "";
  if (!desc || desc.length > 200) throw new Error(`${srcPath}: description missing or >200 chars`);
  const provenance = `<!-- Source: brig@${head} skills/${srcName}/SKILL.md — vendored by bin/sync-brig-skills.mjs. Edit brig, not this copy. -->`;
  const out = `---\nname: ${destName}\ndescription: ${desc}\n---\n\n${provenance}\n\n${body}\n`;
  const destDir = join(root, "skills", destName);
  const destPath = join(destDir, "SKILL.md");
  if (dryRun) { console.log(`  would sync ${destName} from ${srcName}`); continue; }
  mkdirSync(destDir, { recursive: true });
  writeFileSync(destPath, out);
  console.log(`  synced ${destName} from ${srcName}@${head}`);
}
if (!dryRun) console.log("Run `node build.mjs` next to regenerate .claude/skills/.");
