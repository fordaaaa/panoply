---
description: Summarize open findings filed by /cr-run and /cr-sec across trackers — severity breakdown, age, and stale-looking candidates for /cr-recheck
argument-hint: ""
---

Give a dashboard-style summary of open review findings. This command is fully read-only — it never edits code, comments, closes, or files anything. It exists so you can see the state of the backlog before deciding what to run next (`/cr-recheck`, `/cr-fix`, or another `/cr-run`/`/cr-sec` pass), without opening the tracker yourself.

## Step 1 — collect open items

Pick a tracker per [Tracker selection](#tracker-selection) below.

Fetch all open items and keep only the ones that look like review findings: title matches `<emoji> ...` (from `/cr-run`) or `[security] ...` (from `/cr-sec`), or has a `file:line` reference in the title/body. Ignore unrelated open issues/tickets in the repo.

If there are none, say so and stop.

## Step 2 — classify each item

For each finding, extract without re-reading the code (this is a summary, not a recheck):

- **Source**: `/cr-run` or `/cr-sec` (security), from title format.
- **Severity**: parse the emoji/label — 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low, ⚪ Trivial. If unlabeled, mark "unlabeled".
- **Age**: days since creation (from the tracker's timestamp).
- **file:line** and one-line description.

## Step 3 — flag recheck candidates

Mark an item as a **recheck candidate** if either is true:
- Age exceeds 14 days (code has likely moved on since filing).
- The file it references has had commits since the issue was filed (check `git log --since=<issue-date> -- <file>` if the repo is local and the path resolves) — a light signal, not a verification. Skip this check silently if the file path can't be resolved (renamed/deleted, or tracker is on a different repo/machine).

Don't verify the finding itself — that's `/cr-recheck`'s job. Just flag it as worth running that command on.

## Step 4 — report

Present:

1. **Counts by severity**: a simple table, 🔴/🟠/🟡/🟢/⚪/unlabeled, split by source (`/cr-run` vs `/cr-sec`).
2. **Oldest 5 open items**: number, title, age in days, severity.
3. **Recheck candidates**: list of issue numbers with the reason each was flagged (age or recent file activity), and a one-line suggestion: `/cr-recheck <n1> <n2> ...` (or `/cr-recheck all` if most items qualify).
4. **Everything else**: remaining open count, unlisted, so the user knows nothing was silently dropped.

Keep this to a glance-able summary — no per-issue deep dives, no fix suggestions. If the user wants detail on a specific item, point them at `gh issue view <n>` (or the tracker's equivalent) rather than reproducing it here.

## Tracker selection

Before doing anything, check `ToolSearch` (query `"mcp__linear"`) for a configured Linear MCP server:

- **If Linear MCP tools are available**, use them (`list_issues`) instead of `gh issue`.
- **Otherwise**, use plain `gh issue list --state open` (GitHub CLI) — GitHub issues as before.

See the root [README](../../README.md#mcp-integrations) for how to configure the Linear MCP server.
