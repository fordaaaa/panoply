<div align="center">

# ai-skills

**Portable slash commands for AI coding agents.**
Write them once — run them in Claude Code, opencode, Cursor, or anything with a text box.

<br>

[![Stars](https://img.shields.io/github/stars/fordaaaa/ai-skills?style=for-the-badge&logo=github&color=f5c542&labelColor=1c1c1c)](https://github.com/fordaaaa/ai-skills/stargazers)
[![License](https://img.shields.io/github/license/fordaaaa/ai-skills?style=for-the-badge&color=4c9a2a&labelColor=1c1c1c)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/fordaaaa/ai-skills?style=for-the-badge&color=5b8def&labelColor=1c1c1c)](https://github.com/fordaaaa/ai-skills/commits/main)
[![Issues](https://img.shields.io/github/issues/fordaaaa/ai-skills?style=for-the-badge&color=d1495b&labelColor=1c1c1c)](https://github.com/fordaaaa/ai-skills/issues)

<br>

![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=flat-square&logo=anthropic&logoColor=white)
![opencode](https://img.shields.io/badge/opencode-1c1c1c?style=flat-square&logo=terminal&logoColor=white)
![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white)
![Any LLM](https://img.shields.io/badge/…and_anything_else-6e7681?style=flat-square)

</div>

---

## What this is

Three commands that do real work, kept in **one canonical place** and compiled out to each tool's own format:

| Command | What it does |
|:--|:--|
| **`/cr-run`** `[low\|medium\|high]` | Fans out parallel read-only subagents across your code, verifies every finding, and reports them ranked by severity. Optionally files them as GitHub issues. **Never edits files.** |
| **`/cr-fix`** `<issue#…\|all>` | Picks up issues filed by `/cr-run`, fixes them on one branch, verifies the fix actually works, and opens a PR. **This one does edit code.** |
| **`/prompt`** `[what you want]` | Turns a half-formed request into a structured, intent-preserving prompt plus a base plan. Runs on the cheapest model available, so it costs almost nothing. |

Everything is plain markdown. No runtime, no dependencies, no telemetry.

## Install

```bash
git clone https://github.com/fordaaaa/ai-skills.git
cd ai-skills
node build.mjs
```

That generates the command directory for every supported tool. Then open the repo in your agent and type `/cr-run`.

**To use these in your own project**, copy the directory your tool reads:

```bash
cp -r ai-skills/.claude/commands   your-project/.claude/     # Claude Code
cp -r ai-skills/.opencode/commands your-project/.opencode/   # opencode
cp -r ai-skills/.cursor/commands   your-project/.cursor/     # Cursor
```

Using something else? Open [`prompts/`](prompts/), copy the file, replace `{{ARGUMENTS}}`, paste.

## First run sets itself up

You don't configure anything up front. The first time you run any command, it bootstraps itself — installs into whichever tool you're in, asks **two** plain-language questions, connects your GitHub login, and saves the answers to `.ai-skills/config.md`:

```
# ai-skills config
filing: high-only     # all | high-only | local
tracker: github       # github
autoclose: on         # on | off
setup-complete: true
```

| Setting | Options |
|:--|:--|
| `filing` | `all` — file every finding · `high-only` — only 🔴 and 🟠 · `local` — file nothing, never touch git, just fix things in your working tree |
| `autoclose` | `on` — merge the PR and close the issues once tests pass · `off` — open the PR and stop |

After that it never asks again. Say *"reconfigure"* to change it, or just edit the file.

> **`filing: local` is a real escape hatch.** Nothing gets filed, committed, or pushed — findings are shown on screen, and fixes land uncommitted in your working tree for you to review, commit, or throw away.

## Severity scale

| | Level | Meaning |
|:--:|:--|:--|
| 🔴 | Critical | crashes, data loss, security vulnerability, broken core functionality |
| 🟠 | High | real bug with clear user-facing impact |
| 🟡 | Medium | logic error, meaningful perf issue, maintainability hazard |
| 🟢 | Low | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial | style/naming, no functional impact |

Subagents also self-score confidence 1–10 and **only report 8+**. Anything the main thread can't verify by opening the file itself gets dropped. A false positive filed as an issue costs you more than a missed bug does.

## How the build works

Edit **`commands/`** only. Everything else is generated.

```
commands/                    ← the only files you edit
├── _bootstrap.md            ← shared setup, injected via {{BOOTSTRAP}}
├── cr-run.md
├── cr-fix.md
└── prompt.md
      │
      │   node build.mjs
      ▼
.claude/commands/            ← Claude Code   (description + argument-hint)
.opencode/commands/          ← opencode      (hint folded into description)
.cursor/commands/            ← Cursor
prompts/                     ← portable      ($ARGUMENTS → {{ARGUMENTS}})
```

Each target renders the same body into that tool's frontmatter dialect. `node build.mjs --check` exits non-zero if anything is stale, so you can wire it into CI.

Adding a command is one file in `commands/` with this frontmatter:

```yaml
---
name: my-command
description: One line, shown in the tool's command picker
argument-hint: "[optional arg hint]"
bootstrap: true    # false to skip the setup step
---
```

## MCP configuration

Each tool reads MCP from a different place, and **Claude Code's path is not negotiable** — it must be `.mcp.json` at the repo root. It cannot live under `.claude/`.

| Tool | File | Shape |
|:--|:--|:--|
| Claude Code | `.mcp.json` (root, fixed) | `{ "mcpServers": { … } }` |
| opencode | `opencode.json` | `{ "mcp": { … } }` with `type: local\|remote` |
| Cursor | `.cursor/mcp.json` | `{ "mcpServers": { … } }` |

Both configs here declare the remote **GitHub MCP server** (`https://api.githubcopilot.com/mcp/`). It needs a one-time OAuth approval — in Claude Code, run `/mcp`.

**`gh` is the backup path, by design.** If the MCP server is unauthenticated, rate-limited, or just misbehaving, every command falls back to the GitHub CLI, which needs nothing but `gh auth login` and handles unlimited issue create/list/comment/close. Neither command depends on the MCP server being up.

## Credits

The parallel-subagent review structure and the severity/confidence scoring grew out of Anthropic's MIT-licensed [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review).

<div align="center">
<br>

**MIT** · [Report an issue](https://github.com/fordaaaa/ai-skills/issues) · ⭐ if it saved you a code review

</div>
