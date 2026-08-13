#!/usr/bin/env node
// Installs the panoply commands into whichever agent this project uses.
//
//   npx panoply init                 detect the tool and install
//   npx panoply init --tool cursor   force one tool
//   npx panoply init --all           install for every supported tool
//   npx panoply init --with playwright,context7
//   npx panoply init --dry-run
//
// Zero dependencies, by design. Nothing here phones home.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = resolve(process.cwd());
const argv = process.argv.slice(2);

const USAGE = `Installs the panoply commands into whichever agent this project uses.

  npx panoply init                 detect the tool and install
  npx panoply init --tool cursor   force one tool (claude-code, opencode, cursor)
  npx panoply init --all           install for every supported tool
  npx panoply init --with playwright,context7
  npx panoply init --dry-run       show what would happen, write nothing
  npx panoply init --help`;

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

const dryRun = has("dry-run");
const extras = (flag("with") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const TOOLS = {
  "claude-code": { from: ".claude/commands", to: ".claude/commands", mcp: ".mcp.json", label: "Claude Code" },
  opencode:      { from: ".opencode/commands", to: ".opencode/commands", mcp: "opencode.json", label: "opencode" },
  cursor:        { from: ".cursor/commands", to: ".cursor/commands", mcp: ".cursor/mcp.json", label: "Cursor" },
};

/** Which agents does this project already show signs of? */
function detect() {
  const found = [];
  if (existsSync(join(cwd, ".claude")) || existsSync(join(cwd, "CLAUDE.md"))) found.push("claude-code");
  if (existsSync(join(cwd, ".opencode")) || existsSync(join(cwd, "opencode.json"))) found.push("opencode");
  if (existsSync(join(cwd, ".cursor"))) found.push("cursor");
  return found;
}

function mcpFor(tool) {
  const path = join(pkgRoot, "mcp", "servers.json");
  if (!existsSync(path)) return {};
  const all = JSON.parse(readFileSync(path, "utf8"));
  const out = {};
  for (const [name, s] of Object.entries(all)) {
    if (name.startsWith("$")) continue;
    if (s.profile !== "default" && !extras.includes(name)) continue;
    const isStdio = s.transport === "stdio";
    if (tool === "opencode") {
      out[name] = isStdio
        ? { type: "local", command: [s.command, ...(s.args ?? [])], enabled: true }
        : { type: "remote", url: s.url, enabled: true };
    } else if (tool === "cursor") {
      out[name] = isStdio ? { command: s.command, args: s.args ?? [] } : { url: s.url };
    } else {
      out[name] = isStdio ? { type: "stdio", command: s.command, args: s.args ?? [] } : { type: "http", url: s.url };
    }
  }
  return out;
}

/** Merge our servers into the project's existing MCP config without clobbering theirs. */
function installMcp(tool) {
  const { mcp } = TOOLS[tool];
  const dest = join(cwd, mcp);
  const servers = mcpFor(tool);
  if (!Object.keys(servers).length) return null;

  const key = tool === "opencode" ? "mcp" : "mcpServers";
  let config = {};
  if (existsSync(dest)) {
    try { config = JSON.parse(readFileSync(dest, "utf8")); }
    catch { return `! ${mcp} is not valid JSON — left it alone, add the servers by hand`; }
  } else if (tool === "opencode") {
    config = { $schema: "https://opencode.ai/config.json" };
  }

  const existing = config[key] ?? {};
  const added = [];
  for (const [name, spec] of Object.entries(servers)) {
    if (name in existing) continue; // never overwrite a server the user configured
    existing[name] = spec;
    added.push(name);
  }
  if (!added.length) return `  ${mcp} already has these servers`;

  config[key] = existing;
  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, JSON.stringify(config, null, 2) + "\n");
  }
  return `  ${mcp} ← ${added.join(", ")}`;
}

function install(tool) {
  const { from, to, label } = TOOLS[tool];
  const src = join(pkgRoot, from);
  if (!existsSync(src)) {
    console.error(`! ${label}: ${from} is missing from the package — run \`node build.mjs\` first`);
    return;
  }
  const dest = join(cwd, to);
  const names = readdirSync(src).filter((f) => f.endsWith(".md"));

  console.log(`\n${label}`);
  if (!dryRun) mkdirSync(dest, { recursive: true });
  for (const name of names) {
    const target = join(dest, name);
    const overwriting = existsSync(target);
    if (overwriting && !readFileSync(target, "utf8").includes("GENERATED by build.mjs")) {
      console.log(`  skipped ${name} — you already have your own command by that name`);
      continue;
    }
    if (!dryRun) cpSync(join(src, name), target);
    console.log(`  ${overwriting ? "updated" : "installed"} ${to}/${name}`);
  }
  const note = installMcp(tool);
  if (note) console.log(note);
}

// --- main --------------------------------------------------------------------

const cmd = argv[0] && !argv[0].startsWith("-") ? argv[0] : "init";
if (!["init", "install"].includes(cmd)) {
  console.error(`unknown command \`${cmd}\` — usage: npx panoply init [--tool <name>] [--all] [--with a,b] [--dry-run]`);
  process.exit(1);
}

const forced = flag("tool");
if (forced && !TOOLS[forced]) {
  console.error(`unknown tool \`${forced}\` — one of: ${Object.keys(TOOLS).join(", ")}`);
  process.exit(1);
}

let chosen;
if (forced) chosen = [forced];
else if (has("all")) chosen = Object.keys(TOOLS);
else {
  chosen = detect();
  if (!chosen.length) {
    console.log(
      "Couldn't tell which agent this project uses.\n" +
      "Re-run with one of:\n" +
      Object.entries(TOOLS).map(([k, v]) => `  npx panoply init --tool ${k}   (${v.label})`).join("\n") +
      "\n  npx panoply init --all\n\n" +
      "Using something else? Copy a file from prompts/ and paste it in.",
    );
    process.exit(0);
  }
}

// Running the installer inside panoply itself would copy every file onto
// itself; cpSync throws ERR_FS_CP_EINVAL on the first one.
if (cwd === pkgRoot) {
  console.error(
    "This is the panoply repo itself — there is nothing to install into.\n" +
    "Run `node build.mjs` to regenerate the commands, or run this from another project.",
  );
  process.exit(1);
}

console.log(`Installing panoply into ${cwd}${dryRun ? "  (dry run — nothing written)" : ""}`);
for (const tool of chosen) install(tool);

console.log(
  `\nDone. Reload your agent and the commands appear as /cr-run, /cr-fix, /map, /spec, /verify, /debug, /prompt.` +
  `\nNothing is configured yet — the commands run in local mode (report only, no filing, no git) until you ask for more.` +
  (Object.keys(mcpFor(chosen[0])).length ? `\nThe GitHub MCP server authenticates by header, not OAuth. Export a token where your agent will see it:\n  export GITHUB_MCP_TOKEN="$(gh auth token)"\nan unset variable reaches GitHub as a literal \${GITHUB_MCP_TOKEN} and comes back HTTP 400. Or skip it and just use \`gh\`.` : ""),
);
