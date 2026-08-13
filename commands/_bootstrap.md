## Step 0.1 — resolve config

Read `.panoply/config.md`.

**If it exists**, use it and say nothing. Do not re-ask. Continue.

**If it's missing**, do **not** interrogate the user and do **not** write anything yet. Run in **local mode** for now — report findings on screen, file nothing, commit nothing, push nothing. This is the safe default and it needs no setup.

Only when the user actually asks for something that leaves the working tree — "file these", "open a PR", "track this" — ask the two questions below, then write the config. Setup is earned by intent, never charged up front.

1. **"When I find problems, what should I do with them?"**
   - **Just show me (default)** → `filing: local` — nothing is ever filed, committed, or pushed.
   - **Only the important ones** → `filing: high-only` — only 🔴 Critical and 🟠 High get filed; the rest are shown but not filed.
   - **File all of them** → `filing: all` — every confirmed finding becomes a tracked issue.
2. *(skip unless they chose a filing mode)* **"Once a fix is verified, should I open the PR and stop, or merge it for you?"**
   - **Open the PR and stop (default)** → `autoclose: off`
   - **Merge and close it out** → `autoclose: on` — read them the warning under *auto-merge* below before accepting this.

Use `AskUserQuestion` if the host tool supports it; otherwise ask in plain text, one at a time.

> **Auto-merge warning — say this verbatim before writing `autoclose: on`:**
> "This lets me squash-merge my own fixes into `<default-branch>` without you looking at them. I only do it when a real test suite exists and passes. If this repo has no tests, I will never auto-merge regardless of this setting."

### Step 0.2 — connect the tracker

Skip entirely in local mode. Never nag about a tracker the user doesn't need.

- Run `gh auth status`. If it reports not-logged-in, **tell the user and stop** — do not run `gh auth login` yourself. Say: "Filing needs GitHub access. Run `gh auth login` when you're ready and re-run this." Triggering a browser OAuth flow because someone typed a slash command is surprising; let them choose the moment.
- If `gh` isn't installed, point at <https://cli.github.com/> and offer to install it with their package manager — after asking.
- If a `github` MCP server is configured but unauthenticated, say so and let the user approve it via `/mcp`. Do not trigger OAuth by making a silent call. Fall back to `gh` — it covers everything these commands need and is the supported backup path.

### Step 0.3 — write the config

Create `.panoply/config.md`:

```
# panoply config
filing: local         # local | high-only | all
tracker: github       # github
autoclose: off        # off | on
setup-complete: true
```

Then add `.panoply/` to the repo's `.gitignore` unless it's already there — these are one person's preferences, and a committed `autoclose: on` silently applies to every collaborator.

Confirm in one line what you set and how to change it (edit the file, or say "reconfigure"). Continue.
