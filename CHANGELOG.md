# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## [Unreleased]

### Added

- **`opencode-bridge` MCP server** (`servers/opencode-bridge/`) — an opt-in zero-dependency stdio server that wraps your local `opencode` CLI login as three tools: `ask_opencode` (one fresh `opencode run` per call, `timeoutSecs` up to 600, transient 429/5xx retries, timeout errors carry run metadata only), `list_opencode_models`, and `zen_chat` (direct Zen endpoint via `OPENCODE_ZEN_API_KEY`). Enable with `npx panoply init --with opencode-bridge`. Requires `opencode` on PATH and logged in; spends your own quota. See `servers/opencode-bridge/README.md`.

- **`brig` MCP server entry** (`mcp/servers.json`, opt-in) — wires the external brig checkout's 7 code-graph tools (`search_symbols`, `get_symbol`, `get_outline`, `callers_callees`, `blast_radius`, `check_refs`) over stdio via `uv`. Enable with `npx panoply init --with brig`, replacing `/abs/path/to/context-mcp` with your checkout, then `brig index . --slug <name>` per repo.

- **`brig-investigator` / `brig-builder` / `brig-reviewer` skills** (`skills/brig-*/`) — Claude-Code skills porting the index-first workflow: read-only `path:line — symbol` findings with `_meta` scan counts, plan-only execution in 1–2 file steps with receipt lines and terminal refusal lines, and diff-vs-plan review ending in `verdict: accept | request-changes`.

- **`templates/AGENTS.md`** — a copy-paste starter workflow combining the above: startup MCP check, `ask_opencode` parameter and timeout discipline, brig search-before-read order, and the three roles. All paths are `<PLACEHOLDER>`s; no personal layout baked in.

- **`gh-cli` MCP server** (`servers/gh-cli/`) — an opt-in stdio server that wraps the local `gh` CLI instead of the hosted GitHub MCP endpoint, covering the full CLI surface the default server does not: Actions workflows + runs, Releases, **Projects v2** (list/view/create/edit, fields, items: add/edit/archive/delete), labels, and search, plus a `gh_api` / `gh_graphql` raw passthrough and a `gh_cli` generic passthrough that can invoke any `gh` subcommand. Authenticates through the user's existing `gh auth` session — no token forwarding or `GITHUB_MCP_TOKEN` required. Enable with `npx panoply init --with gh-cli`. ~32 tools vs the default server's ~38; the difference is coverage of Actions/Projects/Releases, not overlap.

