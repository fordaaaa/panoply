## Step 0 — preflight

Establish the ground truth before doing anything that writes. Never assume any of it.

| Check | How | If it fails |
|---|---|---|
| Inside a git repo | `git rev-parse --show-toplevel` | Say so and continue in read-only/local mode. Never `git init` uninvited. |
| Default branch | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else `git symbolic-ref refs/remotes/origin/HEAD` | Fall back to the current branch and say which you used. **Never hardcode `main`.** |
| Working tree state | `git status --porcelain` | If dirty and you are about to branch or commit, list the dirty files and ask before touching them. |
| Correct remote | `gh repo view --json nameWithOwner` and `git remote get-url origin` | If `gh` is authed to an account that doesn't own `origin`, or `origin` is an upstream you don't own, stop. Filing or pushing to the wrong repo is not recoverable. |

Refer to the resolved default branch as `<default-branch>` from here on.
