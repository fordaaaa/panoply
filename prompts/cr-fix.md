# cr-fix — fix + PR prompt

Portable version of Claude Code's `/cr-fix` command. Paste this into any coding agent — replace `{{ISSUES}}` with an issue number, list of numbers, or `all` first.

---

Fix the following GitHub issue(s), typically ones filed by a `cr-run` review, and open a pull request. This prompt DOES involve editing code.

If your tool has an MCP server connected for an issue tracker other than GitHub (e.g. Linear), use that instead of `gh issue` — note that `Fixes #<n>`-style auto-linking is GitHub-specific, so for other trackers, reference the issue ID in the PR body and update its status via the tracker's API as part of the Step 6 close-out (immediately after the auto-merge when auto-close is on, otherwise once the human merges). See the Claude Code version's [MCP integrations](../README.md#mcp-integrations) for the pattern this is based on.

## Step 0 — resolve target issues

Target: `{{ISSUES}}`.

- If it's one or more issue numbers, fetch each with `gh issue view <n>` (or ask the human to paste the issue content if you have no `gh`/repo-hosting access).
- If it's `all`, list open issues first (`gh issue list --state open --limit 100`) and confirm the subset to fix before touching anything — don't silently batch-fix unrelated issues into one PR.
- If empty, ask which issue(s) to fix.

Group genuinely related issues (same file/root cause) into one PR; keep unrelated issues on separate branches/PRs.

## Step 1 — plan

Read the referenced file:line and surrounding context for each issue. Confirm it's still valid — code may have changed since filing. If stale or already fixed, say so and skip rather than forcing a change.

## Step 1.5 — choose trace mode

Before touching anything, ask the human once how they want this fix delivered:

- **GitHub mode (default)** — continue exactly as below: branch, commit, push, open a PR, and keep the source issues linked/commented per Steps 5-6.
- **Local-only mode** — fix directly on the current branch, in the working tree, no traces left anywhere. Skip Step 2 (no new branch) and skip Step 5's push/PR — the fixes just sit uncommitted in the working tree for the human to review, commit, or discard themselves. Don't comment on or close the source issues in Steps 5/6 either, since there's nothing pushed to point at yet.

In **GitHub mode**, also ask once how to close out (skip this in local-only mode, where nothing is filed): **auto-close on** (the default: once the fixes are done and verified, squash-merge the PR with `--delete-branch` so the merge commit's `Fixes #<n>` closes each fixed issue and the branch is deleted — fully hands-off) or **auto-close off** (open the PR and stop; leave the branch and issues for the human to review and merge).

Apply the chosen mode(s) for the rest of this run.

## Step 2 — branch (GitHub mode only)

Skip this step entirely in local-only mode — stay on the current branch.

Fix everything in this run on a single branch off the default branch — don't create a branch per issue or per subagent, and don't spin up an intermediate integration branch.

- Create one working branch off the latest default branch, e.g. `git checkout -b codereview-fixes main` (name doesn't matter, pick anything reasonable).
- All issue groups from this run land as commits on that same branch. Never commit directly to the default branch.

## Step 3 — fix

Make the minimal correct change per the issue's guidance. Don't scope-creep into unrelated cleanup. Add/run tests if the fix is non-trivial and tests exist or are warranted. In **GitHub mode**, if multiple issues are being fixed, make one commit per issue (or per genuinely related group) on the shared branch so history stays legible, even though they all ship in one PR. In **local-only mode**, skip committing entirely — just leave the edits in the working tree.

## Step 4 — verify

Actually exercise the change (run tests, run the affected code path) rather than just eyeballing the diff.

## Step 5 — commit and PR (GitHub mode only)

Skip this step entirely in local-only mode — nothing gets committed, pushed, or opened as a PR/MR.

Commit each fix with a message explaining why, referencing `Fixes #<n>` so the host (GitHub/GitLab/etc.) auto-links/closes the issue on merge. Once all targeted issues are fixed on the branch, push it and open a single PR/MR targeting the default branch. The PR title can be anything reasonable; the body must list every issue resolved (`Fixes #<n>` for each) and a short test plan covering all of them. Confirm with the human before pushing/opening the PR if that hasn't already been authorized.

Note: the `Fixes #<n>` keyword only closes the issue when the PR is *merged*, not when it's opened. What happens next depends on the auto-close choice from Step 1.5, handled in Step 6. With auto-close off, comment on each issue with the PR link right after opening so it's visibly tracked in the meantime.

## Step 6 — close out (GitHub mode only)

Skip this step entirely in local-only mode. Behavior depends on the auto-close choice from Step 1.5:

- **Auto-close on (default)** — once the fixes are committed and verified (Step 4) and the PR is open, close everything out automatically: squash-merge the PR and delete the branch (`gh pr merge --squash --delete-branch`, or the host's equivalent). Landing on the default branch closes every issue referenced by `Fixes #<n>` in the PR body, and the working branch is removed. Only auto-merge a PR whose fixes actually verified — never on failing tests or an unverified change; fall back to the auto-close-off behavior and say why.
- **Auto-close off** — leave the PR open and the branch intact for review/CI; ask whether to merge now or later. Issues stay open until it merges.

Either way, only close an issue directly (without any PR) if the fix landed via a direct commit the human asked for, or they explicitly ask you to close it out of band.

## Step 7 — report

In **GitHub mode**, report the PR link and the resulting state of each issue in the batch — merged-and-closed with the branch deleted under auto-close on, or open-pending-merge under auto-close off — plus any issues skipped (stale, already fixed, needs discussion), and note if you fell back from auto-merge because verification failed. In **local-only mode**, skip the PR/issue-state details — summarize what changed, in which files, and note that nothing was committed, pushed, or filed; the source issues are still open and untouched, and the fix is sitting in the working tree.
