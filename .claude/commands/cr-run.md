---
description: Run a parallel multi-subagent code review of the repo and report findings by severity (optionally filing GitHub issues)
argument-hint: "[low|medium|high]"
---

Run a code review of this repository using parallel read-only subagents, then report findings ranked by severity. This command never edits files by itself — see `/cr-fix` for that.

## Step 0 — parse complexity level

Argument: `$ARGUMENTS` (default `medium` if empty). This controls how many subagents you spawn and how deep each one goes:

- **low** — 1 subagent, single quick pass over the whole diff/repo for obvious correctness bugs only.
- **medium** — 3 subagents in parallel, each with a focused lens: (1) correctness/logic bugs, (2) performance/efficiency/dead code, (3) security/error-handling. Each subagent reads the relevant source files itself.
- **high** — 5+ subagents in parallel: split by both lens (correctness, performance, security, style/design, test coverage) AND by area of the codebase if it's large (e.g. one subagent per top-level module/directory) so no single subagent has to read everything.

Scope: if the repo has a substantial uncommitted diff or the user references a PR/branch, review that diff. Otherwise review the full source tree (use judgment — ask the user if genuinely ambiguous, e.g. "review everything or just recent changes?").

## Step 0.2 — choose trace mode

Before doing any review work, ask the user once (`AskUserQuestion` if available, otherwise a plain question) how they want this run handled once findings are in:

- **GitHub mode (default)** — normal flow: report findings, then if the user confirms in Step 3, file them as GitHub issues (or the configured tracker) per Step 4, giving a visible paper trail others can see and that `/cr-fix` can later pick up.
- **Local-only mode** — nothing gets filed, committed, or pushed anywhere. After the Step 3 report, if the user wants any findings fixed now, apply the fix directly to the working tree yourself (Step 4b) — no branch, no commit, no push, no issue. The change sits uncommitted for the user to review, commit, or discard on their own.

Carry this choice through the rest of the run — don't ask again per finding. In local-only mode, skip Step 4 (issue filing) entirely.

## Step 0.3 — offer to recheck existing issues first (GitHub mode only)

Skip this step entirely in local-only mode — there's no tracker to reconcile against. In GitHub mode, ask the user once: "Want me to run `/cr-recheck` on the currently open review issues first, so stale ones don't get treated as still-known before this review starts?"

- If yes: run the `/cr-recheck` flow now for `all` open items filed by `/cr-run`/`/cr-sec`, using whichever tracker [Tracker selection](#tracker-selection) resolves. This closes stale issues and corrects moved line numbers on ones still confirmed, so the "currently open" set used in Step 2.5 below is accurate rather than stale.
- If no: skip straight to Step 0.4 and treat whatever's currently open as-is.

This does not change the complexity level chosen in Step 0 — the review itself still runs at that level afterward, unless the user asks for a different level here too.

## Step 0.4 — load map & learned notes (optional grounding)

Cheaply load persistent context before spawning subagents so a long run doesn't re-explore from scratch:

- **Codebase map** — if `.claude/cr/codebase-map.md` exists, read it and pass the relevant sections (Modules, Entry points, Build/run) into subagent prompts so each knows the layout without re-deriving it. If missing, suggest `/cr-map` but proceed.
- **Learned notes** — if `.claude/cr/learn.enabled` exists, read `.claude/cr/notes.md` and fold it in: honor `false-positive` notes, give `hotspot` areas extra scrutiny, respect `convention` notes so you don't flag intentional patterns. If learning is off, skip silently.
- **Baseline** — if `.claude/cr/baseline.md` exists (see `/cr-baseline`), read it and drop matching findings at aggregation time (file + category + fuzzy description, tolerant of line drift), replacing them with a single "N baselined findings suppressed" line so the report stays focused on new issues.

## Step 0.5 — static analysis grounding (optional)

Before spawning subagents, check `ToolSearch` (query `"mcp__semgrep"`) for a configured Semgrep MCP server. If available, run it once over the review scope using its correctness/best-practice rulesets (not just security) and pass raw hits into the relevant subagent's prompt in Step 1 as supporting evidence — a subagent must independently verify any tool hit against the actual code before reporting it as a finding, since Semgrep has its own false positives. If unavailable, skip this step and proceed exactly as before.

## Step 1 — spawn subagents

Use the `Agent` tool with `subagent_type: Explore` or `general-purpose` (read-only findings, no edits) for each lens/area determined above, in parallel (single message, multiple tool calls). Each subagent prompt must:

- State exactly which files/directories or diff it's responsible for.
- Ask it to return ONLY verified, concrete findings (file:line, what's wrong, why it's a real bug/issue — not speculation or style nitpicks unless explicitly asked).
- Ask it to self-assign a severity per finding using this scale:
  - 🔴 Critical (5) — crashes, data loss, security vulnerability, broken core functionality
  - 🟠 High (4) — real bug with clear user-facing impact, but not catastrophic
  - 🟡 Medium (3) — logic error, meaningful perf issue, or maintainability hazard in an edge case
  - 🟢 Low (2) — minor inefficiency, dead code, unclear error handling
  - ⚪ Trivial (1) — style/naming/cleanup, no functional impact
- Assign each finding a confidence score 1-10; only report findings scoring 8+ (>80% confident it's a real, reproducible issue) — drop the rest rather than including them as caveats.
- Apply these hard exclusions (skip unless `high` tier, where they may be noted briefly as low-priority): style/naming nitpicks with no functional impact unless explicitly requested; purely theoretical issues with no concrete triggering input/state; findings in test-only files unless the bug is in the test's own logic (e.g. an assertion that can't fail).
- Cap response length (e.g. "under 300 words, bullet list") to keep aggregation cheap.

## Step 2 — aggregate and dedupe

Once subagents report back, merge all findings into one list, sorted by severity descending (🔴 → ⚪). Deduplicate anything two subagents flagged independently. Drop anything you can't personally verify by spot-checking the cited file:line yourself. Mark any finding also flagged by Semgrep (Step 0.5) as tool-confirmed — call this out distinctly in the Step 3 report.

## Step 2.5 — drop findings already tracked as open issues (GitHub mode only)

Skip this step entirely in local-only mode. List currently open review issues (reuse the list from Step 0.3 if you already fetched it there; otherwise `gh issue list --state open --limit 100` or the tracker equivalent). For each finding surviving Step 2, check whether it matches an open issue by file + category + fuzzy description — same tolerant-of-line-drift matching `/cr-baseline` uses, since the code may have shifted slightly since filing. Drop matches from the main report and replace them with a single "N findings already tracked as open issues (see #12, #17, ...)" line so the report stays focused on what's genuinely new. If a finding shares a location with an open issue but is clearly a distinct problem, don't drop it — report it as new. This is independent of (and stacks with) the `/cr-baseline` suppression from Step 0.4 — baseline is for things you've deliberately accepted; this is for things already sitting in the tracker.

## Step 3 — report to the user

Present the findings as a table or list: severity emoji, file:line, one-line summary, one-line fix suggestion. Then, per the mode chosen in Step 0.2: in **GitHub mode**, ask the user explicitly whether to file GitHub issues for some/all of these findings — do not create issues without this confirmation. In **local-only mode**, instead ask whether to apply some/all of the fixes directly to the working tree now (Step 4b).

## Step 4 — file issues (GitHub mode only, after user confirms)

Skip this step entirely in local-only mode. Pick a tracker per [Tracker selection](#tracker-selection) below. List existing open items first and skip anything already filed (compare by file/line/description, not title wording). For each confirmed finding, create an item with:

- Title: `<severity emoji> <short description> (<file>:<line>)`
- Body: file:line, what's wrong, concrete fix suggestion, severity level (spelled out), and a severity label/tag if the tracker supports one (create new labels only if the user agrees).

Report back the filed item links, and list anything left unfiled (too trivial, needs more discussion, etc).

## Step 4b — local fix (local-only mode only)

Skip this step entirely in GitHub mode. For each finding the user confirmed in Step 3, read the file, apply the minimal correct fix, and run tests if any exist for the affected code. Don't create a branch, don't commit, don't push — leave the edited files sitting uncommitted in the working tree. Report a short summary of what changed per finding instead of issue links or a PR.

## Step 5 — record lessons (only if learning is enabled)

If `.claude/cr/learn.enabled` exists (see `/cr-learn`), append any genuinely new, durable lessons to `.claude/cr/notes.md`, deduping against existing notes — e.g. a `hotspot` note for an area with a confirmed bug, a `convention` note for an intentional pattern you initially misread, or a `false-positive` note for something you confirmed is fine. Terse and durable only; skip if learning is off.

## Tracker selection

Before filing anything, check `ToolSearch` (query `"mcp__linear"`) for a configured Linear MCP server:

- **If Linear MCP tools are available**, use them (`create_issue`, `list_issues`, `update_issue`, `create_comment`, etc.) instead of `gh issue`. Ask the user which Linear team/project to file into if it's not obvious from context.
- **Otherwise**, use the `github` MCP server's tools if configured, or plain `gh issue` (GitHub CLI) if not — either way, GitHub issues as before.

See the root [README](../../README.md#mcp-integrations) for how to configure the Linear MCP server.
