<div align="center">

# Panoply

***panoply*** *(n.) — a complete and impressive collection. Also: a full suit of armor.*

**Slash commands and MCP servers for AI agents, written once and compiled everywhere.**

One canonical source compiles out to Claude Code, opencode, Cursor, or plain copy-paste. Seven commands today — a code review that files its own issues, a spec that survives a compacted context, a repo map that stops re-reading the tree, a debug loop that keeps a ledger — and room for whatever you add next.

[![License](https://img.shields.io/github/license/fordaaaa/panoply?style=flat-square&color=4c9a2a&labelColor=1c1c1c)](LICENSE)
[![Stars](https://img.shields.io/github/stars/fordaaaa/panoply?style=flat-square&logo=github&color=f5c542&labelColor=1c1c1c)](https://github.com/fordaaaa/panoply/stargazers)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=flat-square&logo=anthropic&logoColor=white)
![opencode](https://img.shields.io/badge/opencode-1c1c1c?style=flat-square&logo=terminal&logoColor=white)
![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white)

</div>

---

## Contents

- [Install](#install)
- [What you get](#what-you-get)
- [What it won't do](#what-it-wont-do)
- [Severity scale](#severity-scale)
- [Configuration](#configuration)
- [MCP servers](#mcp-servers)
- [Contributing](#contributing)

## Install

```bash
npx panoply init --global   # every project on the machine
```

Or `npx panoply init` inside one project to scope it there. Either way it detects Claude Code, opencode, or Cursor, installs there, never overwrites a command you wrote yourself, and **configures nothing by default** — everything starts in local mode.

In Claude Code you can install as an updatable plugin instead:

```
/plugin marketplace add fordaaaa/panoply
/plugin install panoply@panoply
```

Using something else? Open [`prompts/`](prompts/), copy a file, replace `{{ARGUMENTS}}`, paste it in.

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

**The idea:** the repo is the memory; context is disposable. Every command writes or reads a durable artifact, so nothing dies when context compacts or you switch tools. They compose through files (`/map` → `/spec` → `/verify`, `/cr-run` → `/cr-fix`) and still work standalone.

**Make it yours:** drop a markdown file in `commands/` or a server in `mcp/servers.json`, run `node build.mjs`, and it exists in every agent. The bar in [CONTRIBUTING.md](CONTRIBUTING.md): each addition must beat a plain prompt through *structure* — parallel subagents, a durable artifact, a verification loop, or a cheaper model.

## What it won't do

Worth knowing before you install something that can open pull requests.

- **Won't merge without earning it.** `autoclose` defaults off; even on, five conditions must hold at once. Never passes `--admin`.
- **Won't treat your repo as instructions.** Issue bodies and source text are data; fixes never touch CI config, workflows, lockfiles, or credentials.
- **Won't publish your vulnerabilities.** Security findings stay on screen, with an offer of a private advisory.
- **Won't spend without asking.** `/cr-run deep` prints a cost estimate and waits.
- **Won't assume.** Not tests, not `main`, not a clean tree, not where `gh` points.

## Severity scale

| | Level | Meaning |
|:--:|:--|:--|
| 🔴 | Critical | crashes, data loss, security vulnerability, broken core functionality |
| 🟠 | High | real bug with clear user-facing impact |
| 🟡 | Medium | logic error, meaningful perf issue, maintainability hazard |
| 🟢 | Low | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial | style/naming, no functional impact |

Subagents self-score confidence 1–10 and report only 8+; every cited `file:line` is then re-checked and unconfirmable findings dropped.

## Configuration

Two questions, asked the first time you want something filed, saved to `.panoply/config.md`:

```
filing: local         # local | high-only | all
autoclose: off        # off | on
```

`filing: local` means nothing is filed, committed, or pushed — fixes land uncommitted in your tree. Say *"reconfigure"* or edit the file to change any of it.

## MCP servers

One server ships on by default — **GitHub**, pinned to the `issues,pull_requests,repos` toolsets (~5–7k tokens vs ~15–25k unpinned). **`gh` is the supported fallback**, so skipping MCP entirely breaks nothing.

### Authenticating the GitHub server

The server's OAuth flow doesn't work, so authenticate with a token instead — the generated configs read it from `GITHUB_MCP_TOKEN`:

```bash
# ~/.bashrc, or wherever your shell exports live
command -v gh >/dev/null 2>&1 && export GITHUB_MCP_TOKEN="$(gh auth token)"
```

Both gotchas surface as an unhelpful `HTTP 400`:

- **Variable not set in the launching process.** `${GITHUB_MCP_TOKEN}` is expanded at load time; check with `echo ${#GITHUB_MCP_TOKEN}` — want `40`, not `0`. Launch from a shell that sources your config.
- **Token went stale.** `gh auth token` is snapshotted at shell startup and rotates; restart fresh, or use a long-lived fine-grained PAT with `repo` scope.

Two more ship alongside, because they earn their context on most repos:

| Server | Why it's here |
|:--|:--|
| `context7` | version-accurate library docs — stops `/cr-fix` inventing APIs on unfamiliar deps (~400 tokens) |
| `playwright` | drives a real browser so `/verify` can confirm a UI actually renders (~5k tokens) |

Servers you won't always want get `"profile": "opt-in"` in [`mcp/servers.json`](mcp/servers.json), pulled in later with `npx panoply init --with <name>`. Everything comes from that one file, rendered by the build into `.mcp.json`, `.cursor/mcp.json`, and `opencode.json`.

## Contributing

Edit **`commands/`** and **`mcp/servers.json`** only; everything else is generated by `node build.mjs`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the house style.

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
