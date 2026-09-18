---
name: ci-fix
description: Pull a failing GitHub Actions run, reproduce it locally, fix minimally, and verify before shipping
argument-hint: "[<run-id | pr-url>]"
---

Fix the red check, not a cleaner adjacent problem. Fetches the actual failing logs, reproduces the failure on your machine, makes the minimal change that turns it green, and proves it — all without touching workflow files.

Argument: `$ARGUMENTS` — a run id, a PR URL/number, or empty (uses the newest failing run on the current branch).

{{INCLUDE:_preflight.md}}

{{INCLUDE:_bootstrap.md}}

{{INCLUDE:_untrusted.md}}

## Step 1 — resolve the failing run

Use the `gh-cli` MCP server if configured, else `gh` — both work, `gh` is the reliable fallback:

- Run id → `gh run view <id> --json jobs,conclusion,headBranch`.
- PR URL/number → `gh pr checks <n>` then pick the failing check's run.
- Empty → `gh run list --branch <current-branch> --limit 10` and take the newest failed run. If none failed, say so and stop.

Record the failing job(s), the failing step(s), and the head sha. If the run's sha does not match your local HEAD, say so — you may be fixing code you do not have.

## Step 2 — read the logs, not the summary

Fetch the failing step's logs (`gh run view <id> --job <job-id> --log-failed`, or the MCP equivalent). Quote the exact failing command and the first error line. A red annotation without the log is a guess; do not theorize from the check name alone.

## Step 3 — reproduce locally

Run the same command the failing step ran, locally, in the main thread. Match its environment as far as cheap: toolchain version, working directory, env vars named in the workflow (read-only — never edit the workflow file to find out).

- **Reproduced** → continue with the exact local repro written down.
- **Not reproduced** → stop and say so, with the local output vs the CI output side by side. Fixing an unreproduced CI failure by reading code is how you land a confident fix for a bug that was never there. Note the likely axis (OS, version, cache, secret-dependent step) and wait.

## Step 4 — minimal fix

Fix the cause from Step 3 with the smallest change that turns the repro green. Do not refactor around it, do not upgrade dependencies to make it pass, and never modify `.github/workflows/`, CI config, lockfiles, or any credential to get there — those need a human. One commit per root cause at most; in local mode, no commit at all.

## Step 5 — verify and report

Re-run the exact repro from Step 3 plus the nearest test suite covering the changed files. Paste the real summary line with the exit code — a subagent reporting "CI would pass now" is a claim, not evidence.

Report: the run and job, the root cause in one line, what changed and where, and the local verification output. State plainly that nothing was pushed and the remote check is still red until someone pushes. Suggest the next step by name (`/commit`, `/verify diff`) without running it.

This command will not edit workflow files, will not push or merge, and will not close or re-run the remote run itself.
