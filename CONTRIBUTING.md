# Contributing

**Edit `commands/*.md` and `mcp/servers.json`. Nothing else is a source file.**

`.claude/`, `.opencode/`, `.cursor/`, `prompts/`, `.mcp.json`, and the `mcp` block of `opencode.json` are all generated. A PR that edits them by hand will be overwritten by the next build, and CI will fail.

```bash
node build.mjs          # regenerate every target
node build.mjs --lint   # validate sources without writing
node build.mjs --check  # exit 1 if anything is stale (what CI runs)
```

Commit the generated output along with your source change — the Claude Code plugin loads `.claude/commands/` straight from the checkout, so it has to be in git.

## Adding a command

One file in `commands/`:

```yaml
---
name: my-command          # must match the filename
description: One line, shown in the tool's command picker (max 200 chars)
argument-hint: "[what it takes]"   # required if the body reads $ARGUMENTS
---
```

Use `$ARGUMENTS` for input; the portable target rewrites it to `{{ARGUMENTS}}`. Pull in a shared partial with `{{INCLUDE:_name.md}}` — `_`-prefixed files are partials and never become commands themselves.

**The bar for a new command:** it must do something a plain prompt to the agent doesn't already do well, and it must earn that through *structure* — parallel subagents, a durable artifact on disk, a verification loop, or a cheaper model. "Be careful when you refactor" is not a command. If the entire output is prose in the transcript that dies with the context window, it isn't one either.

## Adding an MCP server

Add it to `mcp/servers.json` with a `why` — the linter requires one. Every declared server injects its tool definitions into every session, so an unused server is a permanent tax on the user's context.

Default to `"profile": "opt-in"`. `"default"` is reserved for servers the shipped commands actually name.

## House style

- Numbered `## Step N — <verb>` sections. The agent follows them in order.
- Imperative voice. Say what to do, not what one might consider.
- Every external tool gets a stated fallback (`gh` backs the GitHub MCP server).
- Say what the command *won't* do as clearly as what it will.
- Never hardcode `main`, and never assume a test suite exists.
