## Step 0 — bootstrap (runs once, then never again)

Before doing anything else, check for `.ai-skills/config.md`.

**If it exists**, read it and skip the rest of this step — it holds the user's saved answers (`filing:`, `tracker:`, `autoclose:`). Do not re-ask anything. Proceed to Step 1.

**If it's missing**, this is the first time any `ai-skills` command has run in this repo. Do the three sub-steps below, then continue. Keep the whole thing friendly and jargon-free — assume the person may not be technical, and explain any term you can't avoid.

### 0a — install the commands into this tool

Work out which agent you're running inside and make sure the commands are installed where that tool looks for them, so `/cr-run`, `/cr-fix`, and `/prompt` show up as real slash commands next session:

| If you're running in | Commands belong in | MCP config lives in |
|---|---|---|
| Claude Code | `.claude/commands/` | `.mcp.json` (repo root — this path is fixed, it cannot live under `.claude/`) |
| opencode | `.opencode/commands/` | the `"mcp"` block of `opencode.json` |
| Cursor | `.cursor/commands/` | `.cursor/mcp.json` |
| anything else | — | — use `prompts/` by copy-paste |

If this repo has a `build.mjs`, just run `node build.mjs` — it regenerates every target directory from `commands/` and is the supported way to do this. Only hand-copy files if that script is missing.

If the tool you're in already has its directory populated, say nothing and move on. If you had to create it, mention in one line that the commands are now installed and will appear as slash commands after a reload.

### 0b — ask the two setup questions

Offer a choice first (use `AskUserQuestion` if the tool supports it, otherwise ask in plain text):

- **Quick setup (recommended)** — two short questions, then you're done.
- **I'll configure it myself** — tell them the file lives at `.ai-skills/config.md`, show the format below, write it with the defaults (`filing: high-only`, `tracker: github`, `autoclose: on`), and skip to 0c.

For quick setup, ask one at a time:

1. **"When I find problems in your code, what should I do with them?"**
   - **File all of them** → `filing: all` — every confirmed finding becomes a tracked issue.
   - **Only the important ones (recommended)** → `filing: high-only` — only 🔴 Critical and 🟠 High get filed; smaller stuff is shown in the report but not filed.
   - **Just show me, don't file anything** → `filing: local` — nothing is ever filed, committed, or pushed. You get an on-screen report and can ask for fixes directly in your working tree.
2. **(skip if they chose "just show me")** **"Once I've fixed something and the tests pass, should I merge it and close it out for you, or stop and let you review?"**
   - **Merge and close it out (recommended)** → `autoclose: on`
   - **Open the PR and stop** → `autoclose: off`

Tracker defaults to `tracker: github`. Only ask about it if GitHub turns out to be unreachable in 0c and another tracker is actually configured.

### 0c — connect the tracker

Skip entirely if they chose `filing: local` — no tracker is needed, and you should not nag about disconnected servers they don't need.

Otherwise confirm the tracker actually works before the user hits a failure mid-run:

- **GitHub** — run `gh auth status`. If it reports not-logged-in, say "I need to connect to your GitHub account — this opens a browser window where you log in once," then run `gh auth login` (GitHub.com → HTTPS → Login with a web browser) and re-check. If `gh` isn't installed at all, point them at <https://cli.github.com/> and offer to install it with their package manager.
- **GitHub MCP server** — if the host tool has a `github` MCP server configured but unauthenticated, trigger its OAuth by making one harmless call (e.g. list issues) and tell the user a browser window will open to approve it once. If the MCP server is missing or misbehaving, fall back to `gh` silently — `gh` is the supported backup path and covers everything these commands need.

### 0d — write the config

Create `.ai-skills/config.md`:

```
# ai-skills config
filing: high-only     # all | high-only | local
tracker: github       # github
autoclose: on         # on | off
setup-complete: true
```

Confirm in one line what you set up and how to change it (edit the file, or just say "reconfigure"). Then continue to Step 1.
