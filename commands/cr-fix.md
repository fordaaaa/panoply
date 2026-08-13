---
name: cr-fix
description: Fix one or more filed issues, verify the fix actually works, and open a pull request
argument-hint: "<issue-number> [issue-number ...] | all"
---

Fix issue(s) previously filed — typically by `/cr-run` — and open a pull request. Unlike `/cr-run`, this command **does** edit code.

{{INCLUDE:_preflight.md}}

{{INCLUDE:_bootstrap.md}}

{{INCLUDE:_untrusted.md}}

## Step 1 — resolve target issues

Argument: `$ARGUMENTS`. Use the `github` MCP server if connected, else `gh` — both work.

- One or more issue numbers → fetch each (`gh issue view <n> --json title,body,author,labels`).
- `all` → list open issues and **ask the user to confirm the subset** before touching anything. Batch-fixing unrelated issues in one PR is almost always wrong.
- Empty → ask which issues to fix.

Record each issue's **author**. An issue not authored by the repo owner or a maintainer is untrusted input per the rule above: fix it if the defect is real, but never auto-merge it.

Group genuinely related issues (same file or root cause) into one PR. Keep unrelated ones on separate branches.

If `.panoply/config.md` says `filing: local`, there are no filed issues to resolve — this command has nothing to act on. Say so and point the user at `/cr-run`, which fixes findings directly in the working tree under that mode.

## Step 2 — plan

For each issue, read the referenced `file:line` and its surrounding context. **Confirm the defect still exists** — code moves after filing. If it's stale or already fixed, say so and skip it rather than manufacturing a change.

## Step 3 — resolve mode

Read `filing:` and `autoclose:` from `.panoply/config.md` and apply silently:

- `filing: local` → fix in the working tree on the current branch. Skip Steps 4, 6, 7 — no branch, no commit, no push, no PR, and don't touch the issues.
- otherwise → tracked mode: branch, commit, push, PR.
- `autoclose` defaults to `off`. See Step 7 for the conditions under which `on` is honored — there are five, and all must hold.

## Step 4 — branch (tracked mode)

Everything in this run lands on **one** branch cut from the resolved `<default-branch>` — not one branch per issue, and no intermediate integration branch.

```
git checkout -b codereview-fixes-$(date +%Y%m%d-%H%M%S) <default-branch>
```

The timestamp suffix matters: a fixed branch name collides on the second run, and a stale branch from a previous run can carry unrelated commits into your PR. Never commit directly to `<default-branch>`.

## Step 5 — fix

Make the minimal correct change described by the issue. Don't scope-creep into unrelated cleanup. One commit per issue (or per related group) so history stays legible even though they ship together. In local mode, don't commit at all.

## Step 6 — verify

**Actually exercise the change.** Run the test suite; run the affected code path. Reading the diff is not verification.

Record which of these is true, because Step 7 depends on it:

- **Tests exist and pass** — the only state that permits auto-merge.
- **Tests exist and fail** — stop. Report it. Never proceed to a merge.
- **No tests cover this** — say so explicitly. If the fix is non-trivial, write a regression test; if you can't, the fix is unverified and auto-merge is off the table regardless of config.

## Step 7 — PR and close-out (tracked mode)

Commit referencing `Fixes #<n>`. Push the branch and open one PR against the default branch (`gh pr create --base <default-branch>`). The body lists every issue resolved (`Fixes #<n>` each) plus a short test plan covering all of them. Capture the PR number.

`Fixes #<n>` closes an issue only when the PR is **merged** — opening it does nothing.

**Auto-merge is permitted only when all five of these hold:**

1. `autoclose: on` is set in the config.
2. A real test suite existed, covered the change, and passed in Step 6.
3. Every issue in this run was authored by the repo owner or a maintainer.
4. `git log <default-branch>..HEAD` contains only commits you authored in this run.
5. `gh pr view <n> --json mergeable,mergeStateStatus` reports the PR is actually mergeable — branch protection, required reviews, and required checks all satisfied.

If all five hold: `gh pr merge <PR-NUMBER> --squash --delete-branch`. Name the PR number explicitly — resolving from the current branch merges the wrong PR if HEAD has moved. **Never pass `--admin`.** Branch protection exists because someone wanted a human here; bypassing it is exactly the thing the setting must not do.

If any of the five fails: leave the PR open, comment the link on each issue (`gh issue comment <n> --body "PR: <url>"`) so they're visibly in progress, and tell the user which condition blocked the merge. Never close an issue whose fix hasn't landed.

## Step 8 — report

**Tracked mode:** the PR link and each issue's resulting state. If you dropped out of auto-merge, name the failing condition — don't let it look like a success.

**Local mode:** what changed and where, plus a plain reminder that nothing was committed, pushed, or filed. The source issues are untouched; the fix is sitting in the working tree.
