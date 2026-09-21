<div align="center">

# Panoply

***panoply*** *(n.) — a complete and impressive collection. Also: a full suit of armor.*

**Slash commands and MCP servers for AI agents, written once and compiled everywhere.**

One canonical source compiles out to Claude Code, opencode, Cursor, or plain copy-paste. Twelve commands today — a code review that files its own issues, a spec that survives a compacted context, a repo map that stops re-reading the tree, a debug loop that keeps a ledger, plus onboarding, handoffs, commits, test generation, and CI fixes — and room for whatever you add next.

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
- [Skills](#skills)
- [Running in CI](#running-in-ci)
- [Testing AWS code before you push](#testing-aws-code-before-you-push)
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

### Review

| Command | What it does | What it leaves behind |
|:--|:--|:--|
| **`/cr-run`** `[quick\|standard\|deep]` | Parallel read-only subagents review your code. Every finding is re-verified against the actual file before it survives. | GitHub issues, or an on-screen report |
| **`/cr-fix`** `<issue#…\|all>` | Fixes filed issues on one branch, proves the fix by running it, opens a PR. **This one edits code.** | a branch, commits, a PR |

### Plan, verify, debug

| Command | What it does | What it leaves behind |
|:--|:--|:--|
| **`/map`** `[refresh]` | Parallel subagents map the repo once, stamped with the commit. Refreshes only what moved. | `.panoply/map.md` |
| **`/spec`** `[what you want \| resume]` | Turns a request into acceptance criteria + a checklist, then works it one task at a time, ticking boxes on disk. | `.panoply/specs/<slug>.md` |
| **`/verify`** `[spec-slug \| diff]` | Grades the diff against criteria written *before* the work, with four parallel checkers. Runs the suite itself. | a verdict in the spec |
| **`/debug`** `[symptom]` | Every hypothesis gets a falsifying experiment and a recorded result. Nothing is tested twice. | `.panoply/debug/<slug>.md` |
| **`/prompt`** `[what you want]` | Compiles a half-formed request into a structured prompt + plan. Runs on the cheapest model, so it costs ~nothing. | a prompt you can edit |

### Ship

| Command | What it does | What it leaves behind |
|:--|:--|:--|
| **`/commit`** `[<files…>]` | Verifies the diff with the repo's own checks, then commits on the current branch. Never pushes. | a local commit |
| **`/test-gen`** `[<files…>\|diff]` | Finds changed lines with no coverage, generates tests in the repo's framework, proves them green. | new test files |
| **`/ci-fix`** `[<run-id\|pr>]` | Pulls the failing Actions logs, reproduces locally, fixes minimally. Never touches workflows. | uncommitted fix |

### Orient

| Command | What it does | What it leaves behind |
|:--|:--|:--|
| **`/onboard`** `[<path>]` | Lands in an unfamiliar repo, reuses `/map`, detects the real stack, records verified build/test commands. | `.panoply/onboard.md` |
| **`/handoff`** `[save\|resume\|status]` | Snapshots branch, diff, open items, and next actions so a compacted session resumes clean. | `.panoply/handoff.md` |

**The idea:** the repo is the memory; context is disposable. Every command writes or reads a durable artifact, so nothing dies when context compacts or you switch tools. They compose through files (`/map` → `/spec` → `/verify`, `/cr-run` → `/cr-fix`) and still work standalone.

**Make it yours:** drop a markdown file in `commands/` or a server in `mcp/servers.json`, run `node build.mjs`, and it exists in every agent. The bar in [CONTRIBUTING.md](CONTRIBUTING.md): each addition must beat a plain prompt through *structure* — parallel subagents, a durable artifact, a verification loop, or a cheaper model.

## What it won't do

Worth knowing before you install something that can open pull requests.

- **Won't merge without earning it.** `autoclose` defaults off; even on, five conditions must hold at once. Never passes `--admin`.
- **Won't treat your repo as instructions.** Issue bodies and source text are data; fixes never touch CI config, workflows, lockfiles, or credentials.
- **Won't publish your vulnerabilities.** Security findings stay on screen, with an offer of a private advisory.
- **Won't spend without asking.** `/cr-run deep` prints a cost estimate and waits — and above 1500 files it refuses outright rather than taking a bare "yes".
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

The server's OAuth flow doesn't work, so authenticate with a token instead — the generated configs read it from `GITHUB_MCP_TOKEN`. `npx panoply init` checks this for you and prints what to do; for the full get/verify/troubleshoot walkthrough, see [`docs/mcp-auth.md`](docs/mcp-auth.md).

Two more ship alongside, because they earn their context on most repos:

| Server | Why it's here |
|:--|:--|
| `context7` | version-accurate library docs — stops `/cr-fix` inventing APIs on unfamiliar deps (~400 tokens) |
| `playwright` | drives a real browser so `/verify` can confirm a UI actually renders — or hooks into a live Chrome/Edge via `PANOPLY_BROWSER_CDP` (~5k tokens) |

Servers you won't always want get `"profile": "opt-in"` in [`mcp/servers.json`](mcp/servers.json), pulled in later with `npx panoply init --with <name>`. Everything comes from that one file, rendered by the build into `.mcp.json`, `.cursor/mcp.json`, and `opencode.json`.

For a richer GitHub surface than the default server — Actions workflows + runs, Releases, **Projects v2**, labels, and search, plus a generic `gh_cli` passthrough that can run any `gh` subcommand — pull in the **`gh-cli`** server, which wraps your locally-authenticated `gh` binary with no token forwarding (`npx panoply init --with gh-cli`). See [`servers/gh-cli/README.md`](servers/gh-cli/README.md).

To delegate prompts to your local `opencode` CLI as a tool — `ask_opencode`, `list_opencode_models`, `zen_chat`, spending your own opencode login and quota — pull in the **`opencode-bridge`** server (`npx panoply init --with opencode-bridge`). See [`servers/opencode-bridge/README.md`](servers/opencode-bridge/README.md).

To let agents search a deterministic tree-sitter code-graph index instead of reading whole files — `search_symbols`, `get_symbol`, `get_outline`, `callers_callees`, `blast_radius`, `check_refs` — pull in the **`brig`** server (`npx panoply init --with brig`), then point its `--directory` at your brig checkout and index each repo. Pairs with the `brig-*` skills and the `templates/AGENTS.md` starter workflow.

## Skills

Claude Code only (opencode/Cursor have no equivalent) — sourced from `skills/*/SKILL.md`, rendered to `.claude/skills/`.

| Skill | What it does |
|:--|:--|
| `polyglot` | Detects the stack in the touched files (Python, Go, Rust, Node, Java, Docker) and names the right build/test/lint commands. `/commit`, `/test-gen`, and `/ci-fix` lean on it instead of assuming a runner. Ends every verification with a checkable `[polyglot: …]` report line. |
| `caveman` | Compresses subagent reports and background/scratch output to a dense, telegraphic register to cut token usage — never the final message shown to you. Self-reports an estimated token reduction so the claim is checkable, not just vibes. |
| `brig-investigator` | Searches the brig code-graph index first and reports exact `path:line` findings with scan counts — read-only, never edits. Findings feed the plan; they are not an implementation order. |
| `brig-builder` | Executes a plan file in 1–2 file steps with green tests after every step. Ends each change with a `path:line-range — change` receipt; terminal `too-big. split:` / `needs-confirm. op:` / `ambiguous. ask:` lines end the step. |
| `brig-reviewer` | Verifies the diff against the plan line by line and returns `verdict: accept \| request-changes` with one evidence line per hunk. Read-only — reports, never fixes. |

A hook (`.claude/hooks/caveman-nudge.mjs`) nudges Claude to use it, scoped by `.claude/settings.json`'s `caveman.scope` field (or `PANOPLY_CAVEMAN_SCOPE`, which wins): `everywhere` (default here) compresses all output including the final message to you; `subagent` restricts it to `Task`-boundary traffic only, leaving your chat replies untouched. Opt into the `caveman` MCP server (`npx panoply init --with caveman`) for a real usage number instead of a heuristic.

## Running in CI

`/cr-run` normally waits for you to type it. [`templates/github-workflows/panoply-review.yml`](templates/github-workflows/panoply-review.yml) wires it into a GitHub Action instead, so it reviews every PR on open/push like a hosted bot — setup and cost notes in [`docs/ci-trigger.md`](docs/ci-trigger.md). It never runs `/cr-fix`; auto-fixing from CI is a separate trust decision, left out on purpose.

## Testing AWS code before you push

`/verify` and `/cr-fix` skip AWS-dependent code paths as N/A by default — there's no AWS account to call. Copy in [`templates/docker-compose.floci.yml`](templates/docker-compose.floci.yml) (a free local AWS emulator, [Floci](https://floci.io/floci/)) and they'll spin it up, run the suite against `localhost:4566`, and tear it down, instead of reporting untested. See [`docs/aws-testing.md`](docs/aws-testing.md). Opt-in — nothing changes if you don't copy the file in.

## Contributing

Edit **`commands/`**, **`skills/`**, and **`mcp/servers.json`** only; everything else is generated by `node build.mjs`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the house style.

```
commands/                  ← the only files you edit
├── _bootstrap.md          ← shared partials, pulled in via {{INCLUDE:_name.md}}
├── _preflight.md
├── _severity.md
├── _untrusted.md
└── cr-run.md, cr-fix.md         ← review
    map.md, spec.md, verify.md,  ← plan, verify, debug
    debug.md, prompt.md
    commit.md, test-gen.md,      ← ship
    ci-fix.md
    onboard.md, handoff.md       ← orient

skills/*/SKILL.md          ← Claude-Code-only, no opencode/Cursor equivalent
  (caveman, polyglot)
      │
      │   node build.mjs
      ▼
.claude/commands/  .opencode/commands/  .cursor/commands/  prompts/
.claude/skills/
.mcp.json          opencode.json        .cursor/mcp.json
```

## Credits

The parallel-subagent review structure and the severity/confidence scoring grew out of Anthropic's MIT-licensed [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review).

<div align="center">
<br>

**MIT** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/fordaaaa/panoply/issues) · ⭐ if it saved you a code review

</div>
