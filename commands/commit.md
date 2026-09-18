---
name: commit
description: Verify the working diff with the project's own checks, then commit it on the current branch without pushing
argument-hint: "[<files...>]"
---

Turn a dirty tree into one clean commit. Verifies before writing history: runs the checks the repo actually has, stages only what was asked for, and never pushes — shipping is `/cr-fix`'s or your own decision later.

Argument: `$ARGUMENTS` — files or directories to include. Empty means: show `git status --porcelain` and ask what to include. Never stage everything unasked.

{{INCLUDE:_preflight.md}}

{{INCLUDE:_untrusted.md}}

## Step 1 — resolve scope

- With arguments → `git status --porcelain -- <args>` must be non-empty, or stop and say what did not match.
- Empty → list dirty files (cap 30) and ask which to include.
- If the tree is clean, say so and stop.

If dirty files outside the scope exist, name them once so they are not silently swept in, then ignore them.

## Step 2 — verify with the repo's own checks

Detect the stack for the staged files (see the `polyglot` skill — Python, Go, Rust, Node/TypeScript, Java). Run only the checks that exist, cheapest first:

1. Formatter/linter for the touched languages (only if configured in the repo).
2. Typecheck, if the repo has one.
3. The tests covering the changed files — full suite only if there is no narrower target.

State each result as its exit code plus one summary line. If the repo has no checks at all, say exactly that and continue — do not substitute reasoning for a run, and do not invent a suite. A failing check stops the commit; report the failure and wait.

## Step 3 — review the staged diff

Run `git diff --cached --stat` plus the full `git diff --cached` when small enough to read. Confirm:

- No secrets, tokens, or credential files.
- No lockfiles, generated output, or unrelated cleanup mixed in.
- Every hunk belongs to the message you are about to write. Unrelated hunks get unstaged, not smuggled along.

## Step 4 — commit

Write a conventional message: `<type>(<scope>): <subject>` (`feat|fix|docs|refactor|test|chore`), subject under 72 chars in the imperative, body only if the why is not obvious from the diff. Commit on the **current branch** with `git commit`. Never switch branches for a commit, never amend someone else's commit, and never touch `.github/workflows/`, CI config, or `.panoply/config.md` as part of it.

## Step 5 — report

The short sha, the message, and the files included. State plainly: committed locally, nothing pushed, nothing filed. Name the next step (`/verify diff`, a PR) without running it.

This command will not push, will not rebase or amend history beyond the new commit, and will not file issues.
