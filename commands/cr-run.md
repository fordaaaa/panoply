---
name: cr-run
description: Run a parallel multi-subagent code review of the repo and report findings by severity (optionally filing GitHub issues)
argument-hint: "[low|medium|high]"
bootstrap: true
---

Run a code review of this repository using parallel read-only subagents, then report findings ranked by severity. This command never edits files by itself — see `/cr-fix` for that.

{{INCLUDE:_bootstrap.md}}

## Step 1 — parse complexity level

Argument: `$ARGUMENTS` (default `medium` if empty). This controls how many subagents you spawn and how deep each one goes:

- **low** — 1 subagent, single quick pass over the whole diff/repo for obvious correctness bugs only.
- **medium** — 3 subagents in parallel, each with a focused lens: (1) correctness/logic bugs, (2) performance/efficiency/dead code, (3) security/error-handling. Each subagent reads the relevant source files itself.
- **high** — 5+ subagents in parallel: split by both lens (correctness, performance, security, design, test coverage) AND by area of the codebase if it's large (e.g. one subagent per top-level module) so no single subagent has to read everything.

Scope: if the repo has a substantial uncommitted diff or the user references a PR/branch, review that diff. Otherwise review the full source tree. Ask only if genuinely ambiguous.

## Step 2 — resolve mode from config

Read `filing:` from `.ai-skills/config.md` and apply it silently — the user already answered this during bootstrap, so do not ask again:

- `filing: local` → **local mode**: nothing is filed, committed, or pushed. Skip Step 6 entirely; offer direct working-tree fixes in Step 7 instead.
- `filing: all` → **tracked mode**, every confirmed finding gets filed.
- `filing: high-only` → **tracked mode**, but only 🔴 Critical and 🟠 High get filed.

## Step 3 — spawn subagents

Spawn one read-only subagent per lens/area, all in parallel in a single message. In Claude Code that's the `Agent` tool with `subagent_type: Explore` or `general-purpose`; in opencode, a `subtask` agent; elsewhere, whatever the tool's parallel-agent primitive is. If the tool has no subagent support at all, do the passes sequentially yourself and say so.

Each subagent prompt must:

- State exactly which files/directories or diff it owns.
- Return ONLY verified, concrete findings — file:line, what's wrong, why it's a real bug. No speculation, no style nitpicks unless asked.
- Self-assign a severity per finding:
  - 🔴 Critical (5) — crashes, data loss, security vulnerability, broken core functionality
  - 🟠 High (4) — real bug with clear user-facing impact, but not catastrophic
  - 🟡 Medium (3) — logic error, meaningful perf issue, or maintainability hazard in an edge case
  - 🟢 Low (2) — minor inefficiency, dead code, unclear error handling
  - ⚪ Trivial (1) — style/naming/cleanup, no functional impact
- Self-assign a confidence 1–10 and report only 8+. Drop the rest rather than including them as caveats.
- Apply these hard exclusions (skip unless `high` tier, where they may be noted briefly): style/naming nitpicks with no functional impact; purely theoretical issues with no concrete triggering input; findings in test-only files unless the bug is in the test's own logic.
- Cap response length ("under 300 words, bullet list") to keep aggregation cheap.

## Step 4 — aggregate and dedupe

Merge all findings into one list sorted by severity descending. Deduplicate anything two subagents flagged independently. **Drop anything you can't personally verify by spot-checking the cited file:line yourself** — subagents report false positives, and an unverified finding filed as an issue costs the user more than a missed one.

## Step 5 — drop findings already tracked

Skip in local mode. List open issues (`gh issue list --state open --limit 100`, or the GitHub MCP equivalent). Drop any finding matching an open issue by file + category + fuzzy description — tolerant of line drift, since code moves after filing. Replace them with a single line: "N findings already tracked (see #12, #17)". If a finding shares a location with an open issue but is clearly a distinct problem, keep it as new.

## Step 6 — report

Present findings as a table: severity emoji, file:line, one-line summary, one-line fix suggestion. Then:

- **`filing: all`** — say you're filing all confirmed findings, then go to Step 7.
- **`filing: high-only`** — say explicitly what's being filed and what isn't ("Filing the 2 high-severity issues; the 3 minor ones are listed above but not filed"), then go to Step 7 for the 🔴/🟠 subset only.
- **`filing: local`** — ask whether to apply any of these fixes directly to the working tree now (Step 8).

## Step 7 — file issues

Skip entirely in local mode. Prefer the `github` MCP server if it's connected and working; fall back to `gh issue` otherwise — both are fine, and `gh` is the reliable backup.

List existing open issues first and skip anything already filed (compare by file/line/description, not title wording). For each finding:

- Title: `<severity emoji> <short description> (<file>:<line>)`
- Body: file:line, what's wrong, a concrete fix suggestion, and the severity spelled out.

Report the filed issue links, and list anything deliberately left unfiled.

## Step 8 — local fix (local mode only)

For each finding the user confirmed, read the file, apply the minimal correct fix, and run tests if any cover the affected code. No branch, no commit, no push — leave the edits uncommitted in the working tree. Summarize what changed per finding instead of issue links.
