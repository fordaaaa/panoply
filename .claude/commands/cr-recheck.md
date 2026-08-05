---
description: Re-verify open GitHub issues filed by /cr-run or /cr-sec against current code and auto-close ones that no longer apply
argument-hint: "[issue-number(s)|all]"
---

Re-check previously filed issues against the *current* state of the code, so `/cr-fix` never burns tokens re-investigating something that already got fixed, refactored away, or deleted while other work continued. This command is read-only with respect to code — it never edits source, it only reads it and updates/closes issues.

## Step 0 — resolve target issues

Pick a tracker per [Tracker selection](#tracker-selection) below. Argument: `$ARGUMENTS` (default `all` open items filed by `/cr-run`/`/cr-sec` if empty).

- If one or more issue numbers/IDs, fetch each (`gh issue view <n>`, or the tracker's equivalent).
- If `all`, list open items and use every one that looks like a review finding (has a `file:line` reference in the title/body, or a severity/category label).
- If there are none, say so and stop — nothing to recheck.

## Step 1 — refresh each issue's location

For each issue, don't trust the file:line as gospel — the code may have moved since filing:

1. Read the file at the recorded line plus generous surrounding context (the enclosing function/block).
2. If the described problem is clearly still there at that location, mark it **confirmed**.
3. If the file/function still exists but the specific line has shifted (e.g. code was reformatted or things were added above it), search the file for the original snippet/symbol named in the issue body and re-locate it. If found and the issue still applies, mark it **confirmed** (note the corrected line number).
4. If the code at that location no longer matches the issue's description — because it was already fixed, refactored, or the surrounding logic changed such that the original vulnerability/bug no longer applies — mark it **stale**.
5. If the file or function was deleted entirely, mark it **stale**.
6. If you genuinely can't tell from reading the code (e.g. the change is ambiguous, or it depends on runtime behavior you can't verify by reading), mark it **needs-human**.

Do this for all target issues in parallel using the `Agent` tool (`subagent_type: Explore`, read-only) when there are more than a handful, one subagent per issue or small batch of issues in the same file — each subagent reports back confirmed/stale/needs-human plus a one-line reason.

## Step 2 — act on the results

- **confirmed**: leave the issue open. If the line number moved, comment with the corrected `file:line` so `/cr-fix` doesn't have to re-search, and update the issue title/body if it references the old line.
- **stale**: comment explaining specifically why it no longer applies (e.g. "Lines 40-52 were refactored in a later commit and no longer construct the query via string concatenation — already using parameterized queries.") and close it. Never delete the issue, just close it — it's useful history.
- **needs-human**: comment noting what's ambiguous and leave it open with a `needs-review` label if one exists (don't create new labels without asking).

## Step 3 — report

Give the user a summary table: issue number, verdict (confirmed/stale/needs-human), one-line reason. Call out the count closed as stale so they can see the token/time saved before running `/cr-fix` on the rest.

## Tracker selection

Before doing anything, check `ToolSearch` (query `"mcp__linear"`) for a configured Linear MCP server:

- **If Linear MCP tools are available**, use them (`list_issues`, `get_issue`, `create_comment`, `update_issue`) instead of `gh issue`.
- **Otherwise**, use plain `gh issue` (GitHub CLI) — GitHub issues as before.

See the root [README](../../README.md#mcp-integrations) for how to configure the Linear MCP server.
