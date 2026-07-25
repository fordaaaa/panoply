# cr-run — parallel code review prompt

Portable version of Claude Code's `/cr-run` command. Paste this into any coding agent (Cursor, Aider, Codex, ChatGPT, etc.) — replace `{{LEVEL}}` with `low`, `medium`, or `high` first.

---

Run a code review of this repository using parallel read-only subagents (or, if your tool has no subagent/multi-session concept, simulate it by doing sequential passes with a different focus each time), then report findings ranked by severity. Do not edit any files — this is a review-only pass.

If your tool has an MCP server connected for an issue tracker other than GitHub (e.g. Linear), use that instead of `gh issue` wherever this prompt says to file/list issues. See the Claude Code version's [MCP integrations](../README.md#mcp-integrations) for the pattern this is based on.

## Step 0 — parse complexity level

Level: `{{LEVEL}}` (default `medium` if you don't set one). This controls how many passes/subagents you use and how deep each goes:

- **low** — 1 pass, quick scan of the whole diff/repo for obvious correctness bugs only.
- **medium** — 3 passes/subagents, each with a focused lens: (1) correctness/logic bugs, (2) performance/efficiency/dead code, (3) security/error-handling.
- **high** — 5+ passes/subagents, split by both lens (correctness, performance, security, style/design, test coverage) AND by area of the codebase if it's large (e.g. one pass per top-level module/directory) so no single pass has to cover everything.

Scope: if there's a substantial uncommitted diff, or a PR/branch is specified, review that diff. Otherwise review the full source tree — ask if genuinely ambiguous.

## Step 0.2 — choose trace mode

Before doing any review work, ask the human once how they want this run handled once findings are in:

- **GitHub mode (default)** — normal flow: report findings, then if confirmed in Step 3, file them as GitHub issues (or the tracker's equivalent) per Step 4, giving a visible paper trail others can see and that a `cr-fix` pass can later pick up.
- **Local-only mode** — nothing gets filed, committed, or pushed anywhere. After the Step 3 report, if the human wants any findings fixed now, apply the fix directly to the working tree yourself (Step 4b) — no branch, no commit, no push, no issue. The change sits uncommitted for them to review, commit, or discard on their own.

Carry this choice through the rest of the run — don't ask again per finding. In local-only mode, skip Step 4 (issue filing) entirely.

## Step 0.3 — offer to recheck existing issues first (GitHub mode only)

Skip this step entirely in local-only mode — there's no tracker to reconcile against. In GitHub mode, ask the human once: "Want me to recheck the currently open review issues first (the `cr-recheck` prompt), so stale ones don't get treated as still-known before this review starts?"

- If yes: run the `cr-recheck.md` flow now against `all` currently open review issues. This closes stale ones and corrects moved line numbers on ones still confirmed, so the "currently open" set used in Step 2.5 below is accurate rather than stale.
- If no: skip straight to Step 0.5 and treat whatever's currently open as-is.

This does not change the complexity level chosen in Step 0 — the review itself still runs at that level afterward, unless the human asks for a different level here too.

## Step 0.5 — static analysis grounding (optional)

If your tool can run shell commands and `semgrep` is installed, run `semgrep --config auto <path>` over the review scope before your own read. Treat its output as leads, not findings — verify each hit against the actual code yourself, since it produces false positives. If not installed, skip this step.

## Step 1 — review

For each lens/area, read the relevant files and identify only real, verified problems (file:line, what's wrong, why it's a real issue — no speculation or unsolicited style nitpicks). Assign each finding a severity:

| Emoji | Level | Meaning |
|---|---|---|
| 🔴 | Critical (5) | crashes, data loss, security vulnerability, broken core functionality |
| 🟠 | High (4) | real bug with clear user-facing impact |
| 🟡 | Medium (3) | logic error, meaningful perf issue, or maintainability hazard in an edge case |
| 🟢 | Low (2) | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial (1) | style/naming/cleanup, no functional impact |

Also assign a confidence score 1-10; only report findings scoring 8+ (>80% confident it's real and reproducible) — drop the rest. Apply these hard exclusions (skip unless doing a deep/high-effort pass, where they may be noted briefly as low-priority): style/naming nitpicks with no functional impact unless explicitly requested; purely theoretical issues with no concrete triggering input/state; findings in test-only files unless the bug is in the test's own logic.

## Step 2 — aggregate and dedupe

Merge all findings into one list, sorted by severity descending (🔴 → ⚪). Deduplicate anything flagged more than once. Drop anything you can't verify by rereading the cited file:line. Mark any finding also caught by Semgrep (Step 0.5) as tool-confirmed.

## Step 2.5 — drop findings already tracked as open issues (GitHub mode only)

Skip this step entirely in local-only mode. List currently open review issues (reuse the list from Step 0.3 if you already fetched it there; otherwise `gh issue list --state open --limit 100` or the tracker equivalent). For each finding surviving Step 2, check whether it matches an open issue by file + category + fuzzy description — tolerant of line drift, since the code may have shifted slightly since filing. Drop matches from the main report and replace them with a single "N findings already tracked as open issues (see #12, #17, ...)" line so the report stays focused on what's genuinely new. If a finding shares a location with an open issue but is clearly a distinct problem, don't drop it — report it as new.

## Step 3 — report

Present findings as a table: severity emoji, file:line, one-line summary, one-line fix suggestion. Then, per the mode chosen in Step 0.2: in **GitHub mode**, ask whether to file these as GitHub issues — do not create issues without explicit confirmation. In **local-only mode**, instead ask whether to apply some/all of the fixes directly to the working tree now (Step 4b).

## Step 4 — file issues (GitHub mode only, after confirmation)

Skip this step entirely in local-only mode. If you (or the human) have `gh` CLI access: run `gh issue list --state all --limit 100` first, skip anything already filed (compare by file/line/description, not title wording), then for each confirmed finding run `gh issue create` with:

- Title: `<severity emoji> <short description> (<file>:<line>)`
- Body: file:line, what's wrong, concrete fix suggestion, spelled-out severity level.

If you don't have `gh` access, just output the issues as formatted markdown the human can paste in manually.

Report back what was filed (or drafted) and what was left out (too trivial, needs discussion, etc).

## Step 4b — local fix (local-only mode only)

Skip this step entirely in GitHub mode. For each finding confirmed in Step 3, read the file, apply the minimal correct fix, and run tests if any exist for the affected code. Don't create a branch, don't commit — leave the edited files sitting uncommitted in the working tree. Report a short summary of what changed per finding instead of issue text.
