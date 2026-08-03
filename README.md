# ai-codereviewer-skill

A small collection of portable AI skills — parallel severity-ranked code review, turning the results into fixed PR'd code, and compiling raw requests into structured prompts.

- **Claude Code users:** use `.claude/commands/` — `/cr-run` and `/cr-fix` work out of the box with auto-discovery.
- **Any other tool** (Cursor, Aider, Codex, ChatGPT, etc.): use the plain-text prompts in [`prompts/`](prompts/) — copy-paste `prompts/cr-run.md` or `prompts/cr-fix.md`, filling in the `{{LEVEL}}` / `{{ISSUES}}` placeholder, into your tool of choice. Same logic, no Claude Code-specific syntax.

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

After reporting findings, Claude asks whether to file them as GitHub issues via `gh issue create` — it will not file issues without confirmation.

**Usage:**
```
/cr-run
/cr-run high
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

- Re-verifies each issue is still valid before touching anything (skips stale/already-fixed ones).
- Groups related issues into one branch/PR, keeps unrelated ones separate.
- Runs verification (tests / exercising the code path) before committing.
- Opens a PR with `Fixes #<n>` so GitHub auto-links it.

**Usage:**
```
/cr-fix 42
/cr-fix 42 43
/cr-fix all
```

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated for the target repo, for issue/PR creation.
- Run from within the repo you want reviewed.
