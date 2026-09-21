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
- [Configuration](#configuration)
- [MCP servers](#mcp-servers)
- [Agents](#agents)
- [Skills](#skills)
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

**Make it yours:** drop a markdown file in `commands/` (or `agents/`, or `skills/`), run `node build.mjs`, and it exists in every agent. The bar in [CONTRIBUTING.md](CONTRIBUTING.md): each addition must beat a plain prompt through *structure* — parallel subagents, a durable artifact, a verification loop, or a cheaper model.

## What it won't do

Worth knowing before you install something that can open pull requests.

- **Won't merge without earning it.** `autoclose` defaults off; even on, five conditions must hold at once. Never passes `--admin`.
- **Won't treat your repo as instructions.** Issue bodies and source text are data; fixes never touch CI config, workflows, lockfiles, or credentials.
- **Won't publish your vulnerabilities.** Security findings stay on screen, with an offer of a private advisory.
- **Won't spend without asking.** `/cr-run deep` prints a cost estimate and waits — and above 1500 files it refuses outright rather than taking a bare "yes".
- **Won't assume.** Not tests, not `main`, not a clean tree, not where `gh` points.

Findings carry a severity (🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ⚪ Trivial). Subagents self-score confidence 1–10 and report only 8+; every cited `file:line` is re-checked and unconfirmable findings dropped.

## Configuration

Two questions, asked the first time you want something filed, saved to `.panoply/config.md` (`filing: local | high-only | all`, `autoclose: off | on`). Until then everything runs in local mode: report only, nothing filed, committed, or pushed. Say *"reconfigure"* or edit the file to change it.

## MCP servers

| Server | Profile | Why it's here |
|:--|:--|:--|
| `github` | default | Files issues and opens PRs. Pinned to `issues,pull_requests,repos` (~5–7k tokens vs ~15–25k unpinned). `gh` is the supported fallback. |
| `context7` | default | Version-accurate library docs — stops `/cr-fix` inventing APIs (~400 tokens). |
| `playwright` | default | Drives a real browser so `/verify` can confirm a UI renders (or hooks into live Chrome/Edge via `PANOPLY_BROWSER_CDP`). |
| `gh-cli` | opt-in | Full `gh` surface the default server lacks: Actions, Releases, **Projects v2**, labels, search, plus a raw passthrough. Reuses your `gh auth` session. |
| `opencode-bridge` | opt-in | Delegates prompts to your local `opencode` CLI (`ask_opencode`, `list_opencode_models`, `zen_chat`) on your own login and quota. |
| `brig` | opt-in | Deterministic code-graph index so agents fetch exact slices instead of reading files. Needs your brig checkout path. |
| `showcase` / `caveman` | opt-in | Session screen-recordings / measured usage signal for the compression hook. |

Opt-ins pull in with `npx panoply init --with <name>`. Everything comes from [`mcp/servers.json`](mcp/servers.json), rendered into `.mcp.json`, `.cursor/mcp.json`, and `opencode.json`. The GitHub server authenticates via `GITHUB_MCP_TOKEN` — see [`docs/mcp-auth.md`](docs/mcp-auth.md) (or skip it and just use `gh`).

## Agents

opencode-only (Claude Code/Cursor have no equivalent): `plan` investigates read-only and writes a plan file; `build` executes it 1–2 files at a time with green tests and receipt lines. Sourced from `agents/*.md`, rendered into `opencode.json`'s `agent` block without touching agents you defined yourself. Starting template for your own repos: [`templates/AGENTS.md`](templates/AGENTS.md).

## Skills

Claude Code only (opencode/Cursor have no equivalent) — sourced from `skills/*/SKILL.md`, rendered to `.claude/skills/`.

| Skill | What it does |
|:--|:--|
| `polyglot` | Detects the stack in the touched files and names the right build/test/lint commands. Ends verification with a checkable `[polyglot: …]` line. |
| `caveman` | Compresses subagent and scratch output to a dense register to cut tokens. Self-reports an estimated reduction so the claim is checkable. |
| `brig-investigator` / `brig-builder` / `brig-reviewer` | Index-first investigate → plan-only execution → diff-vs-plan review, each with a checkable output format. |

## Running in CI / AWS

- **CI:** [`templates/github-workflows/panoply-review.yml`](templates/github-workflows/panoply-review.yml) runs `/cr-run` on every PR (never `/cr-fix`). Setup and cost notes in [`docs/ci-trigger.md`](docs/ci-trigger.md).
- **AWS:** [`templates/docker-compose.floci.yml`](templates/docker-compose.floci.yml) gives `/verify` and `/cr-fix` a local AWS emulator instead of skipping cloud paths as N/A. See [`docs/aws-testing.md`](docs/aws-testing.md).

## Contributing

Edit **`commands/`**, **`skills/`**, **`agents/`**, and **`mcp/servers.json`** only; everything else is generated by `node build.mjs`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the house style.

```
commands/                  ← the files you edit
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

agents/*.md                ← opencode-only, rendered into opencode.json's agent block
  (plan, build)
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
