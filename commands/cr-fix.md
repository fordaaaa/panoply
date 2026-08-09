---
name: cr-fix
description: Fix one or more issues filed by /cr-run and open a pull request
argument-hint: "<issue-number> [issue-number ...] | all"
bootstrap: true
---

Fix issue(s) previously filed (typically by `/cr-run`) and open a pull request. Unlike `/cr-run`, this command **does** edit code.

{{BOOTSTRAP}}

## Step 1 — resolve target issues

Argument: `$ARGUMENTS`. Use the `github` MCP server if connected, otherwise `gh` — both work.

- One or more issue numbers → fetch each (`gh issue view <n>`).
- `all` → list open issues and ask the user to confirm the subset before touching anything. Never silently fix everything; batch-fixing unrelated issues in one PR is almost always wrong.
- Empty → ask which issue(s) to fix.

Group genuinely related issues (same file or root cause) into one PR. Keep unrelated ones on separate branches.

## Step 2 — plan

For each issue, read the referenced file:line and its surrounding context. **Confirm the issue is still valid** — code changes after filing. If it's stale or already fixed, say so and skip it rather than forcing a change.

## Step 3 — resolve mode from config

Read `filing:` and `autoclose:` from `.ai-skills/config.md` and apply silently:

- `filing: local` → **local mode**: fix on the current branch, in the working tree. Skip Steps 4, 6, and 7 — no branch, no commit, no push, no PR, and don't touch the source issues.
- otherwise → **tracked mode**: branch, commit, push, PR, per the steps below.
- `autoclose: on` → after verification passes, squash-merge the PR and let it close the issues.
- `autoclose: off` → open the PR and stop.

## Step 4 — branch (tracked mode only)

Fix everything in this run on a **single** branch off `main` — not one branch per issue, and no intermediate integration branch.

```
git checkout -b codereview-fixes main
```

All issue groups from this run land as commits on that branch. Never commit directly to `main`.

## Step 5 — fix

Make the minimal correct change per the guidance in the issue body. Don't scope-creep into unrelated cleanup. In tracked mode, make one commit per issue (or per related group) so history stays legible even though they ship in one PR. In local mode, don't commit at all.

## Step 6 — verify

Actually exercise the change — run the tests, run the affected code path. Do not just eyeball the diff. If tests don't exist and the fix is non-trivial, consider whether one is warranted.

**A failing or unverified fix never proceeds to an auto-merge.** If verification fails, stop, report it, and drop to `autoclose: off` behavior regardless of config.

## Step 7 — PR (tracked mode only)

Commit each fix referencing `Fixes #<n>`. Push the branch and open one PR with `gh pr create --base main`. The PR body must list every issue resolved (`Fixes #<n>` each) and a short test plan covering all of them.

`Fixes #<n>` only closes an issue when the PR is **merged** — opening it does nothing. Under `autoclose: off`, comment the PR link on each issue (`gh issue comment <n> --body "PR: <url>"`) so they're visibly in progress.

## Step 8 — close out (tracked mode only)

- **`autoclose: on`** — once fixes are verified and the PR is open: `gh pr merge --squash --delete-branch`. The squash-merge lands on `main`, closing every `Fixes #<n>` issue and deleting the branch.
- **`autoclose: off`** — leave the PR and branch for the user. Ask whether to merge now or later.

Never close an issue whose fix isn't actually landed.

## Step 9 — report

Tracked mode: give the PR link and each issue's resulting state (merged-and-closed under `autoclose: on`, open-pending-merge under `off`). Note anything skipped as stale, and say so plainly if you fell back from auto-merge because verification failed.

Local mode: summarize what changed and in which files, and remind the user nothing was committed, pushed, or filed — the source issues are untouched and the fix is sitting in their working tree.
