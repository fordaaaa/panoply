# Contributing

**Edit `commands/*.md`, `skills/*/SKILL.md`, `agents/*.md`, and `mcp/servers.json`. Nothing else is a source file.**

`.claude/`, `.opencode/`, `.cursor/`, `prompts/`, `.mcp.json`, and the `mcp` and `agent` blocks of `opencode.json` are all generated. A PR that edits them by hand will be overwritten by the next build, and CI will fail.

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

## Adding a skill

One directory in `skills/`, e.g. `skills/my-skill/SKILL.md`:

```yaml
---
name: my-skill            # must match the directory name
description: One line, max 200 chars — Claude reads this to decide when to invoke the skill
---
```

Skills are Claude-Code-only (opencode and Cursor have no equivalent) — they render only to `.claude/skills/<name>/SKILL.md`, never to `.opencode/`, `.cursor/`, or `prompts/`.

**The bar for a new skill:** the same one commands hold to, applied to prose instead of tool structure — it must leave something checkable behind, not just tell the agent to "be terse" or "be careful." A durable estimate, a self-reported metric, a required output format — something a reader (or the linter) could point at and say whether it held.

## Adding an agent

One file in `agents/`, e.g. `agents/plan.md`:

```yaml
---
name: plan                 # must match the filename
description: One line, max 200 chars — shown in the agent picker
mode: primary              # primary | subagent | all
model: provider/model      # optional — omit to use the user's default
temperature: 0.2           # optional — a number between 0 and 1
tools: {"write": false}    # optional — inline JSON object
permission: {"edit": "deny"}  # optional — inline JSON object
---
```

The body is the agent's per-message system prompt. Agents are opencode-only (Claude Code and Cursor have no `agent`-block equivalent) — they render into the `agent` block of `opencode.json`, merged over whatever agent names the user already has there. Canonical agents win on name collision; unknown names are left alone, never clobbered.

**The bar for a new agent:** a mode must earn its per-message tax through *restriction* or *role* — denied tools, a read-only investigation loop, a plan-only contract. A second agent that behaves exactly like the default is just context weight.

## Adding an MCP server

Add it to `mcp/servers.json` with a `why` — the linter requires one. Every declared server injects its tool definitions into every session, so an unused server is a permanent tax on the user's context.

Default to `"profile": "opt-in"`. `"default"` is reserved for servers the shipped commands actually name.

## House style

- Numbered `## Step N — <verb>` sections. The agent follows them in order.
- Imperative voice. Say what to do, not what one might consider.
- Every external tool gets a stated fallback (`gh` backs the GitHub MCP server).
- Say what the command *won't* do as clearly as what it will.
- Never hardcode `main`, and never assume a test suite exists.
