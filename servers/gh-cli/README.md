# panoply-gh-cli

An MCP server that wraps the **local `gh` CLI**, so an agent can drive GitHub
(repos, issues, PRs, Actions, Releases, and Projects v2) from any MCP host
without forwarding a token.

It does **not** talk to GitHub's API directly. It shells out to `gh`, reusing
whichever account you've already authenticated with `gh auth login`. That means
no `GITHUB_MCP_TOKEN`, no OAuth, no extra secrets — just `gh` already logged in.

## What it covers

A curated set of ~32 tools spanning the whole `gh` surface:

- **Auth** — `gh_auth_status`
- **Repos** — `gh_repo_view` · `gh_repo_list` · `gh_repo_create` · `gh_repo_edit` · `gh_repo_delete`
- **Labels** — `gh_label_list` · `gh_label_create` · `gh_label_edit` · `gh_label_delete`
- **Issues** — `gh_issue_list` · `gh_issue_create` · `gh_issue_view` · `gh_issue_edit` · `gh_issue_close` · `gh_issue_reopen` · `gh_issue_comment` · `gh_issue_delete`
- **Pull requests** — `gh_pr_list` · `gh_pr_view` · `gh_pr_create` · `gh_pr_edit` · `gh_pr_merge` · `gh_pr_close` · `gh_pr_reopen` · `gh_pr_review` · `gh_pr_comment` · `gh_pr_checkout` · `gh_pr_checks` · `gh_pr_diff`
- **Actions — workflows** — `gh_workflow_list` · `gh_workflow_view` · `gh_workflow_run` · `gh_workflow_disable` · `gh_workflow_enable`
- **Actions — runs** — `gh_run_list` · `gh_run_view` · `gh_run_rerun` · `gh_run_cancel` · `gh_run_watch` · `gh_run_download`
- **Releases** — `gh_release_list` · `gh_release_view` · `gh_release_create` · `gh_release_upload` · `gh_release_delete`
- **Projects v2** (first-class — the "bit more") — `gh_project_list` · `gh_project_view` · `gh_project_create` · `gh_project_edit` · `gh_project_field_list` · `gh_project_field_create` · `gh_project_item_list` · `gh_project_item_create` · `gh_project_item_add` · `gh_project_item_edit` · `gh_project_item_archive` · `gh_project_item_delete` · `gh_project_delete`
- **Raw API** — `gh_api` (any REST endpoint by path) · `gh_graphql` (GraphQL query)
- **Generic passthrough** — `gh_cli` (raw `gh` args, exactly as typed) so nothing in the CLI is unreachable
- **Search** — `gh_search_issues` · `gh_search_prs` · `gh_search_repos`

The `gh_cli` tool means: if `gh` can do it, this server can do it — even subcommands
the curated tools don't wrap yet.

## The difference vs. the existing `panoply-gh` server

`servers/gh/index.mjs` is a thin stdio→HTTPS bridge to the *hosted* GitHub MCP
server (`api.githubcopilot.com`), filtered to `issues, pull_requests, repos`
toolsets — **no Actions, no Projects**. `panoply-gh-cli` instead wraps the
local `gh` binary, which natively supports Projects v2, Actions, Releases,
and every other `gh` subcommand, and it authenticates through your existing
`gh auth` session.

## Config

Opt-in — add it with `npx panoply init --with gh-cli`, or point any agent at it:

```jsonc
// .mcp.json  (Claude Code)
{ "mcpServers": { "gh-cli": { "type": "stdio", "command": "node", "args": ["servers/gh-cli/index.mjs"] } } }
```

```jsonc
// opencode.json  (opencode)
{ "mcp": { "gh-cli": { "type": "local", "command": ["node", "servers/gh-cli/index.mjs"], "enabled": true } } }
```

## Requirements

- `gh` installed and authenticated (`gh auth status`). The server does not
  install or log in for you — if you're not logged in, the `gh_*` tools that
  hit the API return auth errors. Run `gh auth login` and retry.
- Node >= 18 (same constraint as every panoply server).

Every tool result is the raw `gh` stdout (JSON where `gh` emits JSON), so the
agent can parse it or hand it off to another tool unchanged.
