---
description: Fix one or more GitHub issues filed by /cr-run and open a pull request
argument-hint: "<issue-number> [issue-number ...] | all"
---

Fix GitHub issue(s) previously filed (typically by `/cr-run`) and open a pull request. This command DOES edit code, unlike `/cr-run`.

## Step 0.0 — first-run setup (only if not set up yet)

Look for `.claude/cr/config.md`. **If it exists, read it** — the `filing:` and `tracker:` lines tell you how the user wants fixes delivered and which tracker to use; skip to Step 0. **If it's missing**, this repo hasn't been set up yet: run the plain-language first-run setup from `/cr-run` Step 0.0 (offer quick setup vs. self-configure, ask the filing + tracker questions, run the connection check for the chosen tracker, and write `.claude/cr/config.md`). Keep it friendly and jargon-free — assume the user may not be technical. Then continue.

## Step 0 — resolve target issues

Pick a tracker per [Tracker selection](#tracker-selection) below. Argument: `$ARGUMENTS`.

- If it's one or more issue numbers/IDs, fetch each (`gh issue view <n>`, or the tracker's equivalent).
- If it's `all`, list open items and ask the user to confirm the subset to fix before touching anything (don't silently fix everything — batch-fixing unrelated issues in one PR is usually wrong).
- If empty, ask the user which issue(s) to fix.

Group issues that are genuinely related (same file/root cause) into one PR; keep unrelated issues on separate branches/PRs unless the user says otherwise.

## Step 1 — plan

For each issue (or group), read the referenced file:line and surrounding context. Confirm the issue is still valid (code may have changed since filing) — if it's stale or already fixed, say so and skip it rather than forcing a change.

## Step 1.5 — choose trace mode

**If `.claude/cr/config.md` has a saved `filing:` preference (Step 0.0), use it silently** — `filing: local` → Local-only mode below; `filing: all` or `high-only` → GitHub mode below. Only ask if there's no saved preference:

- **GitHub mode (default)** — continue exactly as below: branch, commit, push, open a PR, and keep the source issues linked/commented per Steps 5-6.
- **Local-only mode** — fix directly on the current branch, in the working tree, no traces left anywhere. Skip Step 2 (no new branch) and skip Step 5's push/PR — the fixes just sit uncommitted in the working tree for the user to review, commit, or discard themselves. Don't comment on or close the source issues in Steps 5/6 either, since there's nothing on GitHub to point at yet.

Apply the chosen mode for the rest of this run.

## Step 2 — branch (GitHub mode only)

Skip this step entirely in local-only mode — stay on the current branch.

Fix everything in this run on a single branch off `main` — don't create a branch per issue or per subagent, and don't spin up an intermediate integration branch.

- Create one working branch off the latest `main`, e.g. `git checkout -b codereview-fixes main` (name doesn't matter, pick anything reasonable).
- All issue groups from this run land as commits on that same branch. Never commit directly to `main`.

## Step 3 — fix

Make the minimal correct change per the guidance already in the issue body. Don't scope-creep into unrelated cleanup. If tests exist, run them; if not, and the fix is non-trivial, consider whether a test is warranted (ask the user if unsure). In **GitHub mode**, if multiple issues are being fixed, make one commit per issue (or per genuinely related group) on the shared branch so history stays legible, even though they all ship in one PR. In **local-only mode**, skip committing entirely — just leave the edits in the working tree.

## Step 4 — verify

Actually exercise the change if there's a way to (run tests, run the affected code path) — don't just eyeball the diff. Use the `verify` skill if applicable.

## Step 5 — commit and PR (GitHub mode only)

Skip this step entirely in local-only mode — nothing gets committed, pushed, or opened as a PR.

Commit each fix with a message describing why (referencing `Fixes #<n>` so GitHub auto-links/closes the issue on merge). Once all targeted issues are fixed on the branch, push it and open a single PR with `gh pr create --base main`. The PR title can be anything reasonable (e.g. summarizing the theme, or just "Code review fixes"); the PR body must list every issue resolved (`Fixes #<n>` for each) and a short test plan covering all of them. Confirm with the user before pushing/opening the PR if they haven't already authorized this flow.

Note: `Fixes #<n>` only auto-closes an issue when the PR is *merged* — opening the PR alone does not close it. Comment on each issue with the PR link right after opening it (`gh issue comment <n> --body "PR: <url>"`) so each is visibly tracked as in-progress.

## Step 6 — close out (GitHub mode only)

Skip this step entirely in local-only mode.

Ask the user whether to merge the PR into `main` now or leave it for review/CI first.

- If they say merge now: run `gh pr merge --squash` (or whatever the repo's convention is). This closes every issue referenced by `Fixes #<n>` in the PR body, since it lands directly on `main`.
- Never close an issue manually with `gh issue close` unless the fix landed without a PR (e.g. direct commit the user asked for) or the user explicitly asks you to close it out of band.

## Step 7 — report

In **GitHub mode**, give the user the PR link, current issue state (open/merged-and-closed) for each issue in the batch, and note any issues you skipped (stale, already fixed, needs discussion). In **local-only mode**, skip the PR/issue-state details — summarize what changed, in which files, and remind the user nothing was committed, pushed, or filed; the source issues are still open and untouched, and the fix is sitting in their working tree for them to handle however they like.

## Tracker selection

Honor the saved `tracker:` from `.claude/cr/config.md` (Step 0.0):

- **`tracker: linear`** — use the Linear MCP tools (`get_issue`, `list_issues`, `update_issue`, `create_comment`) for issue lookups/comments instead of `gh issue`. Check `ToolSearch` (query `"mcp__linear"`) that they're available; if not, the first call opens the browser OAuth login. `Fixes #<n>`-style auto-linking is GitHub-specific — for Linear, include the Linear issue ID in the PR body and update the Linear issue's status manually via MCP once merged (Linear's own GitHub integration will otherwise double-handle it if both are active — check with the user which should own status changes).
- **`tracker: github`** (default) — use plain `gh issue`/`gh pr` (GitHub CLI). If `gh auth status` shows the user isn't logged in, run the connection check from `/cr-run` Step 0.0 first rather than failing.
- **No config** — check `ToolSearch` (query `"mcp__linear"`) for Linear; if present use it, otherwise fall back to `gh`.

See the root [README](../../README.md#mcp-integrations) for how tracker setup works.
