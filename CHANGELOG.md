# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## [Unreleased]

### Added

- **`secret-scan` skill**: drives the betterleaks CLI over staged changes, the working tree, git history or a remote repo, always with `--redact`, and sorts each finding into rotate, purge or allowlist. `/commit` now blocks on betterleaks findings when the binary is installed.
- **`security-audit` and `unslop` skills**: vendored from cloudflare/security-audit-skill (MIT) and heydamir/unslop (CC BY 4.0), each with its license and a `SOURCE.md` pinning the upstream commit.
- **Six opencode agents**: `orchestrator`, `builder`, `grunt`, `investigator`, `reviewer` and `verifier`. The agent frontmatter now passes `variant` through to `opencode.json`.
- **`/impl` command**: test-first implementation of one spec task.

### Changed

- **`npx panoply init` now installs skills** into `~/.claude/skills/` (with `--global`) or `.claude/skills/`. It skips any skill folder you wrote yourself.
- **The README leads with skills, MCP servers and agents.** The slash commands moved to a Legacy section; they still install and work.
- **The default browser MCP is now `camoufox`** (`camoufox-mcp-server@2.6.0`, needs Node 22+). `playwright` is now opt-in: re-add it with `npx panoply init --with playwright` if you rely on `PANOPLY_BROWSER_CDP`.

### Fixed

- The build now copies skill subdirectories (`references/`, `scripts/`) and allows skill descriptions up to Claude Code's 1024-char cap.

- **`opencode-bridge` MCP server** (`servers/opencode-bridge/`) — an opt-in zero-dependency stdio server that wraps your local `opencode` CLI login as three tools: `ask_opencode` (one fresh `opencode run` per call, `timeoutSecs` up to 600, transient 429/5xx retries, timeout errors carry run metadata only), `list_opencode_models`, and `zen_chat` (direct Zen endpoint via `OPENCODE_ZEN_API_KEY`). Enable with `npx panoply init --with opencode-bridge`. Requires `opencode` on PATH and logged in; spends your own quota. See `servers/opencode-bridge/README.md`.

- **`brig` MCP server entry** (`mcp/servers.json`, opt-in) — wires the external brig checkout's 7 code-graph tools (`search_symbols`, `get_symbol`, `get_outline`, `callers_callees`, `blast_radius`, `check_refs`) over stdio via `uv`. Enable with `npx panoply init --with brig`, replacing `/abs/path/to/context-mcp` with your checkout, then `brig index . --slug <name>` per repo.

- **`brig-investigator` / `brig-builder` / `brig-reviewer` skills** (`skills/brig-*/`) — Claude-Code skills porting the index-first workflow: read-only `path:line — symbol` findings with `_meta` scan counts, plan-only execution in 1–2 file steps with receipt lines and terminal refusal lines, and diff-vs-plan review ending in `verdict: accept | request-changes`.

- **`templates/AGENTS.md`** — a copy-paste starter workflow combining the above: startup MCP check, `ask_opencode` parameter and timeout discipline, brig search-before-read order, and the three roles. All paths are `<PLACEHOLDER>`s; no personal layout baked in.

- **`gh-cli` MCP server** (`servers/gh-cli/`) — an opt-in stdio server that wraps the local `gh` CLI instead of the hosted GitHub MCP endpoint, covering the full CLI surface the default server does not: Actions workflows + runs, Releases, **Projects v2** (list/view/create/edit, fields, items: add/edit/archive/delete), labels, and search, plus a `gh_api` / `gh_graphql` raw passthrough and a `gh_cli` generic passthrough that can invoke any `gh` subcommand. Authenticates through the user's existing `gh auth` session — no token forwarding or `GITHUB_MCP_TOKEN` required. Enable with `npx panoply init --with gh-cli`. ~32 tools vs the default server's ~38; the difference is coverage of Actions/Projects/Releases, not overlap.

