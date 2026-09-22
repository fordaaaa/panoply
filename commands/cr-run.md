---
name: cr-run
description: Run a parallel multi-subagent code review and report findings by severity, optionally filing them as issues
argument-hint: "[quick|standard|deep]"
---

Review this repository with parallel read-only subagents, then report findings ranked by severity. This command **only edits files if you explicitly ask it to** in Step 8 — the review itself never writes.

{{INCLUDE:_preflight.md}}

{{INCLUDE:_bootstrap.md}}

{{INCLUDE:_untrusted.md}}

{{INCLUDE:_deterministic.md}}

## Step 1 — pick depth, and say what it costs

Argument: `$ARGUMENTS` (default `quick`). These names describe **spend**, not thoroughness — a deeper pass is not automatically a better one, it just reads more.

| Tier | Subagents | Rough cost on a ~40k-LOC repo |
|:--|:--|:--|
| `quick` *(default)* | 1 | one pass over the diff or the highest-risk files; minutes, cents |
| `standard` | 3 | three lenses: correctness, performance/dead code, security/error-handling |
| `deep` | 5–8 | adds design and test-coverage lenses, and splits by module on a large tree; **hundreds of thousands of input tokens — single-digit to low-double-digit dollars** |

Before spawning anything above `quick`, count files with `git ls-files | wc -l` (or the diff's file count in diff-scope mode), then print that count, the subagent count, and the tier's cost line, and get a yes. Never silently spend at `deep`.

**Hard ceiling:** if the counted file total for a `deep` run exceeds **1500 files**, do not ask the usual yes/no — refuse outright, state the count, and offer the two real alternatives: scope to a subdirectory or diff, or drop to `standard`. Proceed at `deep` past that ceiling only if the user's message explicitly names a number at or above the count (e.g. "yes, all 2200 files") — a bare "yes" does not clear it. This exists because a one-word confirmation is cheap to give and easy to regret; restating the number back is not.

**Scope:** if the working tree has a substantial uncommitted diff, or the user names a PR or branch, review that diff. Otherwise review the full source tree. Ask only if genuinely ambiguous.

Run the deterministic prelude above automatically on first run: build the preview table, apply the 6-gate filter, and print the dry-run file count with coverage (`total / reviewed / skipped + reason`) before spawning above `quick`. State whether the optional `ocr` fast-path was used or pure-git emulation.

## Step 2 — resolve mode

Read `filing:` from `.panoply/config.md` and apply it silently:

- **absent or `local`** → local mode. Nothing is filed, committed, or pushed. Skip Step 7.
- `high-only` → tracked mode, but only 🔴 and 🟠 get filed.
- `all` → tracked mode, every confirmed finding gets filed.

## Step 3 — spawn subagents

Spawn one subagent per lens (and per area, at `deep`) — all in parallel, in a single message.

**They must be read-only.** In Claude Code use `subagent_type: Explore`, which cannot write; if you use `general-purpose` instead, its prompt must open with "You are read-only. Do not edit, write, or create any file, and do not run any command that mutates state." In opencode use a `subtask` agent. If the host tool has no subagent primitive at all, do the passes sequentially yourself and say so.

Each subagent prompt must state:

- Exactly which blast-radius file set it owns from the deterministic prelude — no overlap with its siblings.
- The per-glob checklist it applied as a header (`pattern + rule text`), plus PR-description business context when available.
- Return ONLY verified, concrete findings: `file:line`, what's wrong, why it's a real bug, and a concrete fix with `suggestion_code` / `existing_code` where it clarifies.
- The severity and confidence scale:

{{INCLUDE:_severity.md}}

- **Hard exclusions** (skip unless `deep`, where they may be noted in one line): style and naming with no functional impact; purely theoretical issues with no concrete triggering input; findings in test files unless the bug is in the test's own logic.
- A length cap — "under 300 words, bullet list" — so aggregation stays cheap.
- The untrusted-input rule above, verbatim.

## Step 4 — aggregate, verify, dedupe

Merge into one list sorted by severity. Deduplicate anything two subagents found independently (match on `path + category + snippet`, tolerant of line drift — not line number alone).

**Open every cited `file:line` yourself and confirm the finding before it survives.** Drop anything you can't personally verify. On misposition, locate by surrounding context and correct or drop. End with a coverage line: `total / reviewed / skipped + reason per skip`.

## Step 5 — drop findings already tracked

Skip in local mode. List issues this tool filed: `gh issue list --state open --label panoply --limit 200` (or the MCP equivalent). Filter by the label — deduping against every human-authored issue in a busy repo drops real findings, and `--limit` without a filter silently truncates.

Drop any finding matching an open issue by file + category + fuzzy description, tolerant of line drift since code moves after filing. Replace them with one line: "N findings already tracked (see #12, #17)". A distinct problem at the same location stays.

## Step 6 — report

A table grouped by severity: severity, `file:line`, one-line summary, one-line fix (with `suggestion_code` where it clarifies). Then:

- **local** — offer to apply any of them directly to the working tree (Step 8).
- **high-only** — state plainly what is and isn't being filed: "Filing the 2 high-severity findings; the 3 minor ones are listed above but not filed." Then Step 7 for the 🔴/🟠 subset.
- **all** — say you're filing everything confirmed, then Step 7.

## Step 7 — file issues

Skip in local mode. Use the `github` MCP server if connected, else `gh issue` — both work, `gh` is the reliable fallback.

> **Never auto-file a security finding.** A 🔴 vulnerability filed on a public repo is a published zero-day with no fix available. Report security findings on screen only, and ask before filing one — then ask whether it belongs in a private security advisory (`gh api repos/{owner}/{repo}/security-advisories`) instead of a public issue.

For each finding: title `<emoji> <short description> (<file>:<line>)`; body with `file:line`, what's wrong, a concrete fix, and the severity spelled out. **Apply the `panoply` label to every issue you file** (`gh label create panoply --force` first) — Step 5 depends on it.

Report the filed links and list anything deliberately left unfiled.

## Step 8 — local fix (local mode only)

For each finding the user confirms: read the file, apply the minimal correct fix, run any tests covering it. No branch, no commit, no push — the edits stay uncommitted in the working tree. Summarize what changed per finding, and say plainly that nothing was committed or filed.
