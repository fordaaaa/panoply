# cr-status — open-findings dashboard prompt

Portable version of Claude Code's `/cr-status` command. Paste this into any coding agent. No placeholders to fill in.

Gives a glance-able summary of open review findings previously filed by a `cr-run.md`/`cr-sec.md` style review, so you can decide what to run next (`cr-recheck.md`, `cr-fix.md`, or another review pass) without opening the tracker yourself. Fully read-only — never edits code, comments, closes, or files anything.

If your tool has an MCP server connected for an issue tracker other than GitHub (e.g. Linear), use that instead of `gh issue`. See the Claude Code version's [MCP integrations](../README.md#mcp-integrations) for the pattern this is based on.

---

## Step 1 — collect open items

List all open issues (`gh issue list --state open --limit 100`, or ask the human to paste a list if you have no `gh`/repo-hosting access). Keep only the ones that look like review findings: title starts with a severity emoji (from `cr-run.md`) or `[security]` (from `cr-sec.md`), or has a `file:line` reference. Ignore unrelated open issues.

If there are none, say so and stop.

## Step 2 — classify each item

For each finding, without re-reading the code (this is a summary, not a recheck):

- **Source**: code review or security review, from title format.
- **Severity**: parse the emoji/label — 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low, ⚪ Trivial. If unlabeled, mark "unlabeled".
- **Age**: days since creation.
- **file:line** and one-line description.

## Step 3 — flag recheck candidates

Mark an item as a recheck candidate if either is true:
- Age exceeds 14 days.
- The file it references has had commits since the issue was filed (`git log --since=<issue-date> -- <file>` if you have local repo access) — a light signal, not a verification. Skip silently if the path can't be resolved.

Don't verify the finding itself — that's what `cr-recheck.md` is for.

## Step 4 — report

Present:

1. **Counts by severity**, split by source (code review vs security review).
2. **Oldest 5 open items**: number, title, age in days, severity.
3. **Recheck candidates**: issue numbers with the reason each was flagged, and a suggestion of which numbers to run `cr-recheck.md` on (or note if most items qualify, i.e. run it on all).
4. **Everything else**: remaining open count, so nothing is silently dropped from the picture.

Keep this to a summary — no per-issue deep dives, no fix suggestions. Point to `gh issue view <n>` for detail on a specific item rather than reproducing it here.
