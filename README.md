<div align="center">

# Panoply

***panoply*** *(n.) — a complete and impressive collection. Also: a full suit of armor.*

**Every skill and MCP server you use, in one place, installable into any agent.**

One canonical source compiles out to Claude Code, opencode, Cursor, or plain copy-paste. Seven commands today — a code review that files its own issues, a spec that survives a compacted context, a repo map that stops re-reading the tree, a debug loop that keeps a ledger — and room for whatever you add next.

[![License](https://img.shields.io/github/license/fordaaaa/panoply?style=flat-square&color=4c9a2a&labelColor=1c1c1c)](LICENSE)
[![Stars](https://img.shields.io/github/stars/fordaaaa/panoply?style=flat-square&logo=github&color=f5c542&labelColor=1c1c1c)](https://github.com/fordaaaa/panoply/stargazers)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=flat-square&logo=anthropic&logoColor=white)
![opencode](https://img.shields.io/badge/opencode-1c1c1c?style=flat-square&logo=terminal&logoColor=white)
![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white)

</div>

---

## Install

Run this **inside your own project**:

```bash
npx panoply init
```

It detects whether you're on Claude Code, opencode, or Cursor, installs the commands there, and stops. It never overwrites a command you wrote yourself.

In Claude Code you can install it as a plugin instead, which keeps it updatable:

```
/plugin marketplace add fordaaaa/panoply
/plugin install panoply@panoply
```

Using something else? Open [`prompts/`](prompts/), copy a file, replace `{{ARGUMENTS}}`, paste it in.

**Nothing is configured on install.** Every command starts in local mode — reports on screen, files nothing, touches git never — and asks about anything more only when you first ask for it.

## What you get

```
> /cr-run standard

  Reviewing 84 files with 3 subagents (correctness · performance · security).
  Estimated ~180k input tokens. Continue? y

  🔴  src/auth/session.ts:142   Session token compared with ==, not timing-safe
                                → use crypto.timingSafeEqual
  🟠  src/api/upload.ts:67      Unbounded read into memory; 2GB upload OOMs the worker
                                → stream to disk, cap at configured limit
  🟡  src/db/pool.ts:23         Pool never drained on SIGTERM; deploys drop in-flight queries

  Verified 3 of 5 reported — dropped 2 I couldn't confirm at the cited line.
  Local mode: nothing filed. Want me to fix any of these, or start filing?
```

| Command | What it does | What it leaves behind |
|:--|:--|:--|
| **`/cr-run`** `[quick\|standard\|deep]` | Parallel read-only subagents review your code. Every finding is re-verified against the actual file before it survives. | GitHub issues, or an on-screen report |
| **`/cr-fix`** `<issue#…\|all>` | Fixes filed issues on one branch, proves the fix by running it, opens a PR. **This one edits code.** | a branch, commits, a PR |
| **`/map`** `[refresh]` | Parallel subagents map the repo once, stamped with the commit. Refreshes only what moved. | `.panoply/map.md` |
| **`/spec`** `[what you want \| resume]` | Turns a request into acceptance criteria + a checklist, then works it one task at a time, ticking boxes on disk. | `.panoply/specs/<slug>.md` |
| **`/verify`** `[spec-slug \| diff]` | Grades the diff against criteria written *before* the work, with four parallel checkers. Runs the suite itself. | a verdict in the spec |
| **`/debug`** `[symptom]` | Every hypothesis gets a falsifying experiment and a recorded result. Nothing is tested twice. | `.panoply/debug/<slug>.md` |
| **`/prompt`** `[what you want]` | Compiles a half-formed request into a structured prompt + plan. Runs on the cheapest model, so it costs ~nothing. | a prompt you can edit |

### The idea

**The repo is the memory; context is disposable.** Every command either writes a durable artifact or reads one a sibling wrote. Nothing of value dies when the context window compacts, the session ends, or you switch tools.

They compose through files, not calls — `/map` feeds `/spec`, `/spec` feeds `/verify`, `/cr-run` feeds `/cr-fix` — and each one still works standalone if the file it likes isn't there.

### Make it yours

This is a **collection**, not a fixed product — it's meant to grow into everything you actually use. Drop a markdown file in `commands/`, add a server to `mcp/servers.json`, run `node build.mjs`, and it exists in every agent you work in. No runtime, no plugin API, no rewriting the same prompt in four dialects.

The bar for anything you add is in [CONTRIBUTING.md](CONTRIBUTING.md): it has to beat a plain prompt through *structure* — parallel subagents, a durable artifact, a verification loop, or a cheaper model. Everything else is just a paragraph you could have typed.

## What it won't do

Worth knowing before you install something that can open pull requests.

- **It won't merge without earning it.** `autoclose` defaults to `off`. Turning it on still requires five conditions to hold at once: a real test suite that covers the change and passes, issues authored by a maintainer, no foreign commits on the branch, and a genuinely mergeable PR. It never passes `--admin` — branch protection exists because someone wanted a human there.
- **It won't treat your repo as instructions.** Issue bodies, comments, and source text are data. A review that reads an issue and a fix that merges to your default branch is a prompt-injection path straight to production; every command carries an explicit rule against following text it finds. Issue-driven fixes never touch CI config, workflows, lockfiles, or credentials.
- **It won't publish your vulnerabilities.** Security findings are never auto-filed — a 🔴 filed as a public issue is a zero-day with no fix shipped. You get it on screen, and an offer to open a private advisory.
- **It won't spend without asking.** `/cr-run deep` is 5–8 subagents reading real source. It prints the file count and cost estimate and waits.
- **It won't assume.** Not that you have tests, not that your default branch is `main`, not that your working tree is clean, not that `gh` is pointed at the repo you think it is.

## Severity scale

| | Level | Meaning |
|:--:|:--|:--|
| 🔴 | Critical | crashes, data loss, security vulnerability, broken core functionality |
| 🟠 | High | real bug with clear user-facing impact |
| 🟡 | Medium | logic error, meaningful perf issue, maintainability hazard |
| 🟢 | Low | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial | style/naming, no functional impact |

Subagents self-score confidence 1–10 and report only 8+. Then the main thread opens every cited `file:line` and drops anything it can't confirm itself. A false positive in your tracker costs more than a missed bug.

## Configuration

Two questions, asked the first time you want something filed, saved to `.panoply/config.md`:

```
filing: local         # local | high-only | all
autoclose: off        # off | on
```

`filing: local` is a real escape hatch, not a demo mode: nothing is filed, committed, or pushed, and fixes land uncommitted in your working tree for you to keep or throw away. Say *"reconfigure"* to change any of it, or just edit the file.

## MCP servers

One server ships on by default — **GitHub**, pinned to the `issues,pull_requests,repos` toolsets. The unpinned server exposes ~90 tools and costs 15–25k tokens of context in every session before you've run anything; pinned, it's 5–7k. **`gh` is the supported fallback** and covers everything these commands need, so nothing breaks if you skip MCP entirely.

Three more are available opt-in, because a server you don't use is a permanent tax on your context window:

```bash
npx panoply init --with context7,playwright,sentry
```

| Server | Why you'd add it |
|:--|:--|
| `context7` | version-accurate library docs — stops `/cr-fix` inventing APIs on unfamiliar deps (~400 tokens) |
| `playwright` | drives a real browser so `/verify` can confirm a UI actually renders (~5k tokens) |
| `sentry` | turns `/cr-run` severity from a guess into "this throws 400×/day in prod" |

All of it comes from one file — [`mcp/servers.json`](mcp/servers.json) — rendered into `.mcp.json`, `.cursor/mcp.json`, and `opencode.json` by the build. Hand-maintaining those three is what let one of them go missing.

## Contributing

Edit **`commands/`** and **`mcp/servers.json`** only; everything else is generated by `node build.mjs`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the house style and the bar a new command has to clear.

```
commands/                  ← the only files you edit
├── _bootstrap.md          ← shared partials, pulled in via {{INCLUDE:_name.md}}
├── _preflight.md
├── _severity.md
├── _untrusted.md
└── cr-run.md, cr-fix.md, map.md, spec.md, verify.md, debug.md, prompt.md
      │
      │   node build.mjs
      ▼
.claude/commands/  .opencode/commands/  .cursor/commands/  prompts/
.mcp.json          opencode.json        .cursor/mcp.json
```

## Credits

The parallel-subagent review structure and the severity/confidence scoring grew out of Anthropic's MIT-licensed [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review).

<div align="center">
<br>

**MIT** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/fordaaaa/panoply/issues) · ⭐ if it saved you a code review

</div>
