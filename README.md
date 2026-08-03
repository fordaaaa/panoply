# ai-codereviewer-skill

A small collection of portable AI skills — parallel severity-ranked code review, turning the results into fixed PR'd code, and compiling raw requests into structured prompts.

- **Claude Code users:** use `.claude/commands/` — `/cr-run`, `/cr-sec`, `/cr-recheck`, `/cr-status`, `/cr-fix`, and `/prompt` work out of the box with auto-discovery.
- **Any other tool** (Cursor, Aider, Codex, ChatGPT, etc.): use the plain-text prompts in [`prompts/`](prompts/) — copy-paste `prompts/cr-run.md`, `prompts/cr-sec.md`, `prompts/cr-recheck.md`, `prompts/cr-status.md`, `prompts/cr-fix.md`, or `prompts/prompt.md`, filling in any `{{LEVEL}}` / `{{ISSUES}}` / `{{INTENT}}` placeholder, into your tool of choice. Same logic, no Claude Code-specific syntax.

## Commands

### `/cr-run [low|medium|high]`

Runs a read-only code review using parallel subagents. Never edits files.

- `low` — 1 subagent, quick pass for obvious bugs.
- `medium` (default) — 3 subagents, split by lens: correctness, performance/dead code, security/error-handling.
- `high` — 5+ subagents, split by lens and by codebase area for deep coverage.

Findings are ranked and tagged with a severity scale:

| Emoji | Level | Meaning |
|---|---|---|
| 🔴 | Critical | crashes, data loss, security vuln, broken core functionality |
| 🟠 | High | clear user-facing bug |
| 🟡 | Medium | logic error / meaningful perf issue / maintainability hazard |
| 🟢 | Low | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial | style/naming, no functional impact |

Before reviewing anything, Claude asks you to pick a **trace mode**:

- **GitHub mode (default)** — after reporting findings, asks whether to file them as GitHub issues via `gh issue create` — never files without confirmation.
- **Local-only mode** — nothing is filed, committed, or pushed. If you want a finding fixed, Claude edits the file directly and leaves it uncommitted in your working tree for you to review, commit, or discard yourself.

In GitHub mode, it also offers to run `/cr-recheck` on the currently open review issues before it starts, so stale ones (already fixed/refactored away) don't muddy the comparison — then, regardless of whether you say yes, it fetches whatever's currently open and drops any new finding that matches one from the main report (replaced with a "N already tracked, see #12, #17" line), so you only see what's actually new. This runs at the same complexity level chosen above unless you ask for a different one.

**Usage:**
```
/cr-run
/cr-run high
```

### `/cr-sec [low|medium|high]`

Runs a read-only **security** review using parallel subagents — the security-only counterpart to `/cr-run`. Never edits files.

- `low` — 1 subagent, quick pass for high-confidence, high-impact vulnerabilities.
- `medium` (default) — 3 subagents, split by category group: input validation & injection, auth/crypto/secrets, code execution & data exposure.
- `high` — 5+ subagents, split by category and by codebase area.

Covers SQL/command/template/NoSQL injection, path traversal, auth bypass, privilege escalation, JWT/session flaws, hardcoded secrets, weak crypto, insecure deserialization, RCE, XSS, and sensitive data exposure — with a curated exclusion list (DoS, outdated deps, theoretical race conditions, etc.) and an 8/10+ confidence bar to keep noise down. Same GitHub-issue-filing flow, trace-mode option, and recheck-first/skip-already-tracked behavior as `/cr-run`, tagged `[security]`.

The vulnerability taxonomy, severity/confidence scoring, and exclusion list are adapted from Anthropic's open-source [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) GitHub Action (MIT licensed) — full credit to that project for the underlying security review methodology.

**Usage:**
```
/cr-sec
/cr-sec high
```

### `/cr-recheck [issue-number(s)|all]`

Re-verifies open issues against the *current* code before you spend fix effort on them. If you file an issue, keep coding, and never get around to fixing it, the surrounding code may have already changed — the bug might be gone, moved, or refactored away. Read-only with respect to code; only reads source and updates/closes issues.

- Re-reads each issue's `file:line` and surrounding context fresh — doesn't trust the recorded line number.
- **confirmed** — still valid, left open (with a corrected line number comment if it moved).
- **stale** — no longer applies (already fixed/refactored/deleted); closed with a comment explaining why, so it's not re-investigated later.
- **needs-human** — ambiguous from reading code alone; left open and flagged.

Run this before `/cr-fix` on any batch of older issues to avoid wasting tokens re-diagnosing things that already resolved themselves.

**Usage:**
```
/cr-recheck
/cr-recheck 42 43
```

### `/cr-status`

Read-only dashboard summarizing open findings filed by `/cr-run`/`/cr-sec`, across whichever tracker you're using. Doesn't verify or touch anything — it's for deciding what to run next, not for re-diagnosing findings (that's `/cr-recheck`).

Reports: counts by severity split by source (code review vs security review), the oldest 5 open items, and a list of **recheck candidates** — items flagged either because they're over 14 days old or because their referenced file has had commits since filing (a light signal, not a verification). Ends with a ready-to-run suggestion like `/cr-recheck 42 43` for the flagged items.

Useful before deciding whether to spend fix effort on the backlog, run another review pass, or just clean out stale issues first.

**Usage:**
```
/cr-status
```

### `/prompt [what you want, in plain words]`

Compiles a raw request into a ready-to-run prompt plus a base plan, then hands it back for you to run. Treats your words as **intent** and restructures them — without changing what they mean — against a prompt-quality checklist (role/objective, output contract, success criteria, scope boundaries), then runs a token-discipline pass. The compilation runs in a cheap **Haiku subagent** (it's lightweight rewriting, not worth Sonnet/Opus rates) and keeps main-thread context clean. It does not execute the compiled prompt until you say to.

**Usage:**
```
/prompt write a script to rename my photos by date taken
/prompt
```

### `/cr-fix <issue-number(s)|all>`

Fixes GitHub issue(s), typically ones filed by `/cr-run`, and opens a pull request. This command does edit code.

Before touching anything, Claude asks you to pick a **trace mode**:

- **GitHub mode (default)** — branch, commit, push, open a PR, and keep the source issues linked/commented, as described below.
- **Local-only mode** — fixes land directly on your current branch, uncommitted, in the working tree. No branch, no commit, no push, no PR, and the source issues are left untouched. Nothing about the fix is visible anywhere but your machine.

In GitHub mode:
- Re-verifies each issue is still valid before touching anything (skips stale/already-fixed ones) — for a larger batch of older issues, run `/cr-recheck` first instead of relying on this per-issue check.
- Fixes all targeted issues on a single branch (no per-issue or per-subagent branches).
- Runs verification (tests / exercising the code path) before committing.
- Opens one PR with a title of your choosing and a description listing every issue resolved (`Fixes #<n>` per issue) so GitHub auto-links/closes them.

**Usage:**
```
/cr-fix 42
/cr-fix 42 43
/cr-fix all
```

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated for the target repo, for issue/PR creation. Not needed if you're using Linear via MCP instead (see below).
- Run from within the repo you want reviewed.

## MCP integrations

**What MCP actually is, in one sentence:** it's a plug that lets Claude Code call a tool directly (create a Linear ticket, read a Postgres schema, post to Slack) instead of you having to install and script a separate CLI for each one — you configure the plug once in `.mcp.json`, and Claude either finds a matching tool at runtime or quietly skips it.

None of this is required to use `/cr-run`, `/cr-sec`, `/cr-recheck`, `/cr-fix` — they all work today with just `gh` (GitHub CLI). Everything below is optional extra plumbing that's already wired into the commands and ready to switch on: a starter config lives at [`.mcp.json`](.mcp.json), and Claude Code reads it automatically when you run commands from this repo.

**How the fallback works:** each command's "Tracker selection" step checks (via `ToolSearch`) whether a given MCP server's tools are actually available before using them. Unconfigured or unauthenticated server → the command just uses GitHub/`gh` like it always did. Nothing breaks if you ignore this whole section.

| Server | What it's for | What it adds here | Used by |
|---|---|---|---|
| **Linear** | Issue tracker (Jira/Asana-style alternative to GitHub Issues) | File/list/comment/close issues in Linear instead of GitHub | all four commands |
| **GitHub** | Same thing `gh` CLI does, via MCP instead of shelling out | Issue/PR operations if you don't have `gh` installed or prefer MCP | all four commands (fallback under Linear) |
| **Slack** | Team chat | Posts a short summary of HIGH-severity security findings to a channel you pick | `/cr-sec` only, optional |
| **Sentry** | Production error monitoring | Cross-references findings against real crashes/errors so severity reflects what's actually happening in prod, not just what looks risky on paper | `/cr-sec` only, optional |
| **Postgres** | Your app's database | Lets `/cr-sec` check real schema/column types for SQL-injection findings instead of guessing from code | `/cr-sec` only, optional |
| **Semgrep** | Static analysis (SAST) | Grounds findings in actual rule matches instead of pure LLM pattern-matching — subagents treat hits as leads and verify each one before reporting | `/cr-run` and `/cr-sec`, optional |
| **gitleaks** (CLI, not MCP) | Secrets scanner | If the `gitleaks` binary is on `PATH`, `/cr-sec` shells out to it to catch hardcoded secrets before the auth/crypto/secrets subagent reads the code | `/cr-sec` only, optional |

Everything is pre-wired into every command already — you don't need to touch the prompt files, just authenticate/configure the servers you want:

### Setup

1. **Linear, Sentry** — hosted, OAuth, easiest: nothing to configure beyond `.mcp.json` already being there. The first time a command tries to use one, Claude Code opens a browser auth flow. Approve it once; it's remembered after that.
2. **GitHub, Slack, Postgres** — local servers, need credentials as environment variables before you launch Claude Code:
   ```
   export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...      # github (repo scope)
   export SLACK_BOT_TOKEN=xoxb-...                  # slack (chat:write, channels:read scopes)
   export SLACK_TEAM_ID=T0123456
   export DATABASE_URL=postgres://user:pass@host/db # postgres, read-only creds recommended
   ```
   `.mcp.json` reads these from your environment automatically — nothing else to edit. Only export the ones you actually want; the rest just won't start (and commands fall back to `gh`/skip the optional step).
3. **Semgrep** — local server, no credentials needed: requires `uv`/`uvx` installed (`pip install uv` or see [astral.sh/uv](https://astral.sh/uv)); `.mcp.json` already runs `uvx semgrep-mcp` on demand, so nothing else to configure.
4. **gitleaks** — not an MCP server, just a CLI: install it ([github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)) and make sure it's on `PATH`. `/cr-sec` detects it with a plain `which gitleaks` check and shells out directly — no `.mcp.json` entry involved.
5. Restart/reload Claude Code in this repo after changing `.mcp.json` or env vars so it re-reads the server list.

### Also worth adding later

- **Scheduled runs** — wire `/cr-run`/`/cr-sec` into the `schedule` skill for nightly sweeps, with `/cr-recheck` running first each time to keep the tracker clean.
- **CVE/advisory lookup** is already live in `/cr-sec` via plain `WebSearch` (no MCP server needed).
