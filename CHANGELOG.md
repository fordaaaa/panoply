# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## [Unreleased]

### Added

- **`gh-cli` MCP server** (`servers/gh-cli/`) — an opt-in stdio server that wraps the local `gh` CLI instead of the hosted GitHub MCP endpoint, covering the full CLI surface the default server does not: Actions workflows + runs, Releases, **Projects v2** (list/view/create/edit, fields, items: add/edit/archive/delete), labels, and search, plus a `gh_api` / `gh_graphql` raw passthrough and a `gh_cli` generic passthrough that can invoke any `gh` subcommand. Authenticates through the user's existing `gh auth` session — no token forwarding or `GITHUB_MCP_TOKEN` required. Enable with `npx panoply init --with gh-cli`. ~32 tools vs the default server's ~38; the difference is coverage of Actions/Projects/Releases, not overlap.

