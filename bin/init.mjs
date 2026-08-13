#!/usr/bin/env node
// Installs the panoply commands into whichever agent this project uses.
//
//   npx panoply init                 detect the tool and install
//   npx panoply init --global        install once for every project on this machine
//   npx panoply init --tool cursor   force one tool
//   npx panoply init --all           install for every supported tool
//   npx panoply init --with playwright,context7
//   npx panoply init --dry-run
//
// Zero dependencies, by design. Nothing here phones home.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, cpSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = resolve(process.cwd());
const home = homedir();
const argv = process.argv.slice(2);

const USAGE = `Installs the panoply commands into whichever agent this project uses.

  npx panoply init                 detect the tool and install
  npx panoply init --global        install once for every project on this machine
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
const isGlobal = has("global");
const extras = (flag("with") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Every agent here merges a user-level command dir with the project one, so a
// global install covers every project without touching any of them. The MCP
// file differs per scope: project-scope Claude Code reads `.mcp.json`, but
// user-scope lives under `mcpServers` in the app's own `~/.claude.json`.
const TOOLS = {
  "claude-code": {
    from: ".claude/commands",
    label: "Claude Code",
    project: { to: ".claude/commands", mcp: ".mcp.json" },
    global: { to: join(home, ".claude", "commands"), mcp: join(home, ".claude.json") },
  },
  opencode: {
    from: ".opencode/commands",
    label: "opencode",
    project: { to: ".opencode/commands", mcp: "opencode.json" },
    global: { to: join(home, ".config", "opencode", "commands"), mcp: join(home, ".config", "opencode", "opencode.json") },
  },
  cursor: {
    from: ".cursor/commands",
    label: "Cursor",
    project: { to: ".cursor/commands", mcp: ".cursor/mcp.json" },
    global: { to: join(home, ".cursor", "commands"), mcp: join(home, ".cursor", "mcp.json") },
  },
};

/** Absolute destinations for the scope we're installing into. */
function target(tool) {
  const t = TOOLS[tool];
  if (isGlobal) return { ...t.global, show: (p) => p.replace(home, "~") };
  return { to: join(cwd, t.project.to), mcp: join(cwd, t.project.mcp), show: (p) => p.replace(cwd + "/", "") };
}

/** Which agents show signs of use — in this project, or on this machine. */
function detect() {
  const found = [];
  const seen = (...paths) => paths.some((p) => existsSync(p));
  if (isGlobal) {
    if (seen(join(home, ".claude"), join(home, ".claude.json"))) found.push("claude-code");
    if (seen(join(home, ".config", "opencode"))) found.push("opencode");
    if (seen(join(home, ".cursor"))) found.push("cursor");
    return found;
  }
  if (seen(join(cwd, ".claude"), join(cwd, "CLAUDE.md"))) found.push("claude-code");
  if (seen(join(cwd, ".opencode"), join(cwd, "opencode.json"))) found.push("opencode");
  if (seen(join(cwd, ".cursor"))) found.push("cursor");
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

/**
 * Replace a config file without ever leaving a partial one behind.
 *
 * `~/.claude.json` is not ours — it is the running app's live state file, tens
 * of kilobytes of it, rewritten whenever the app feels like it. Writing in
 * place risks a reader seeing a half-written file, and a bad merge would eat
 * settings we never looked at. So: keep a backup, write a sibling temp file,
 * then rename it over the target, which is atomic within a filesystem.
 */
function writeConfig(dest, config) {
  if (dryRun) return;
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) cpSync(dest, `${dest}.panoply-bak`);
  const tmp = `${dest}.panoply-tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, dest);
}

/** Merge our servers into the existing MCP config without clobbering theirs. */
function installMcp(tool) {
  const { mcp: dest, show } = target(tool);
  const name_ = show(dest);
  const servers = mcpFor(tool);
  if (!Object.keys(servers).length) return null;

  const key = tool === "opencode" ? "mcp" : "mcpServers";
  let config = {};
  if (existsSync(dest)) {
    try { config = JSON.parse(readFileSync(dest, "utf8")); }
    catch { return `! ${name_} is not valid JSON — left it alone, add the servers by hand`; }
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
  if (!added.length) return `  ${name_} already has these servers`;

  config[key] = existing;
  writeConfig(dest, config);
  const backed = isGlobal && existsSync(`${dest}.panoply-bak`) ? `  (backup: ${show(dest)}.panoply-bak)` : "";
  return `  ${name_} ← ${added.join(", ")}${backed}`;
}

function install(tool) {
  const { from, label } = TOOLS[tool];
  const src = join(pkgRoot, from);
  if (!existsSync(src)) {
    console.error(`! ${label}: ${from} is missing from the package — run \`node build.mjs\` first`);
    return;
  }
  const { to: dest, show } = target(tool);
  const names = readdirSync(src).filter((f) => f.endsWith(".md"));

  console.log(`\n${label}`);
  if (!dryRun) mkdirSync(dest, { recursive: true });
  for (const name of names) {
    const file = join(dest, name);
    const overwriting = existsSync(file);
    if (overwriting && !readFileSync(file, "utf8").includes("GENERATED by build.mjs")) {
      console.log(`  skipped ${name} — you already have your own command by that name`);
      continue;
    }
    if (!dryRun) cpSync(join(src, name), file);
    console.log(`  ${overwriting ? "updated" : "installed"} ${show(file)}`);
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
    const where = isGlobal ? "is installed on this machine" : "this project uses";
    const g = isGlobal ? " --global" : "";
    console.log(
      `Couldn't tell which agent ${where}.\n` +
      "Re-run with one of:\n" +
      Object.entries(TOOLS).map(([k, v]) => `  npx panoply init${g} --tool ${k}   (${v.label})`).join("\n") +
      `\n  npx panoply init${g} --all\n\n` +
      "Using something else? Copy a file from prompts/ and paste it in.",
    );
    process.exit(0);
  }
}

// Running the project installer inside panoply itself would copy every file
// onto itself; cpSync throws ERR_FS_CP_EINVAL on the first one. A global
// install writes outside the repo entirely, so it is fine from anywhere.
if (cwd === pkgRoot && !isGlobal) {
  console.error(
    "This is the panoply repo itself — there is nothing to install into.\n" +
    "Run `node build.mjs` to regenerate the commands, `npx panoply init --global`\n" +
    "to install for every project, or run this from another project.",
  );
  process.exit(1);
}

console.log(
  isGlobal
    ? `Installing panoply for every project on this machine${dryRun ? "  (dry run — nothing written)" : ""}`
    : `Installing panoply into ${cwd}${dryRun ? "  (dry run — nothing written)" : ""}`,
);
for (const tool of chosen) install(tool);

console.log(
  `\nDone. Reload your agent and the commands appear as /cr-run, /cr-fix, /map, /spec, /verify, /debug, /prompt` +
  (isGlobal ? ` — in every project, without running this again.` : `.`) +
  `\nNothing is configured yet — the commands run in local mode (report only, no filing, no git) until you ask for more.` +
  (Object.keys(mcpFor(chosen[0])).length ? `\nThe GitHub MCP server authenticates by header, not OAuth. Export a token where your agent will see it:\n  export GITHUB_MCP_TOKEN="$(gh auth token)"\nan unset variable reaches GitHub as a literal \${GITHUB_MCP_TOKEN} and comes back HTTP 400. Or skip it and just use \`gh\`.` : ""),
);
