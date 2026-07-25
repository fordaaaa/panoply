---
description: Run a parallel multi-subagent SECURITY review of the repo and report vulnerabilities by severity (optionally filing GitHub issues)
argument-hint: "[low|medium|high]"
---

Run a security-focused review of this repository using parallel read-only subagents, then report vulnerability findings ranked by severity. This is the security counterpart to `/cr-run` — use `/cr-run` for general correctness/perf/style review, `/cr-sec` for security only. This command never edits files by itself — see `/cr-fix` for that.

The vulnerability taxonomy, exclusion list, and severity/confidence scoring below are adapted from Anthropic's open-source [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) action (MIT licensed) — see the README for attribution.

## Step 0 — parse complexity level

Argument: `$ARGUMENTS` (default `medium` if empty).

- **low** — 1 subagent, single quick pass over the diff/repo for high-confidence, high-impact vulnerabilities only.
- **medium** — 3 subagents in parallel, split by category group: (1) input validation & injection (SQLi, command injection, XXE, template/NoSQL injection, path traversal), (2) auth/crypto/secrets (authn/authz bypass, session/JWT flaws, hardcoded secrets, weak crypto), (3) code execution & data exposure (insecure deserialization, eval injection, XSS, sensitive data logging/leakage).
- **high** — 5+ subagents: the same category split AND by area of the codebase if it's large (one subagent per top-level module/directory) so no single subagent has to read everything.

Scope: if there's a substantial uncommitted diff, or a PR/branch is specified, review only that diff (this is the common case — security review is usually run per-PR). Otherwise review the full source tree — ask if genuinely ambiguous.

## Step 0.2 — choose trace mode

Before doing any review work, ask the user once (`AskUserQuestion` if available, otherwise a plain question) how they want this run handled once findings are in:

- **GitHub mode (default)** — normal flow: report findings, then if the user confirms in Step 3, file them as GitHub issues (or the configured tracker) per Step 4, giving a visible paper trail others can see and that `/cr-fix` can later pick up.
- **Local-only mode** — nothing gets filed, committed, or pushed anywhere. After the Step 3 report, if the user wants any findings fixed now, apply the fix directly to the working tree yourself (Step 4b) — no branch, no commit, no push, no issue. The change sits uncommitted for the user to review, commit, or discard on their own.

Carry this choice through the rest of the run — don't ask again per finding. In local-only mode, skip Step 4 (issue filing) entirely.

## Step 0.3 — offer to recheck existing issues first (GitHub mode only)

Skip this step entirely in local-only mode — there's no tracker to reconcile against. In GitHub mode, ask the user once: "Want me to run `/cr-recheck` on the currently open review issues first, so stale ones don't get treated as still-known before this review starts?"

- If yes: run the `/cr-recheck` flow now for `all` open items filed by `/cr-run`/`/cr-sec`, using whichever tracker [Tracker selection](#tracker-selection) resolves. This closes stale issues and corrects moved line numbers on ones still confirmed, so the "currently open" set used in Step 2.5 below is accurate rather than stale.
- If no: skip straight to Step 0.4 and treat whatever's currently open as-is.

This does not change the complexity level chosen in Step 0 — the review itself still runs at that level afterward, unless the user asks for a different level here too.

## Step 0.4 — load map & learned notes (optional grounding)

Before anything else, cheaply load persistent context so subagents don't re-explore from scratch:

- **Codebase map** — if `.claude/cr/codebase-map.md` exists, read it and pass its **Entry points**, **Trust boundaries**, and **Sensitive sinks** sections into each subagent's prompt as a pre-computed attack-surface map. This focuses subagents on real sinks instead of blind reading. If it's missing or looks stale (commit sha differs a lot from `HEAD`), suggest the user run `/cr-map` first, but proceed without it.
- **Learned notes** — if `.claude/cr/learn.enabled` exists, read `.claude/cr/notes.md` and fold it in: honor `false-positive` notes (do not re-flag those classes), and tell subagents to give `hotspot` areas extra scrutiny. If learning is off, skip silently.
- **Baseline** — if `.claude/cr/baseline.md` exists (see `/cr-baseline`), read it and, at aggregation time, drop findings that match a baselined entry (file + category + fuzzy description, tolerant of line drift). Replace them in the report with a single "N baselined findings suppressed — `/cr-baseline list` to review" line so the report stays focused on new issues.

## Step 0.5 — static analysis grounding (optional)

Before spawning subagents, check `ToolSearch` (query `"mcp__semgrep"`) for a configured Semgrep MCP server:

- **If available**, run it once over the review scope (the diff's files, or the full tree) using its default/security rulesets. Collect the raw findings (rule id, file:line, message).
- **If a `gitleaks` binary is available** (check with a quick `which gitleaks`/`gitleaks version`), run `gitleaks detect` (or `gitleaks protect` for a diff) over the same scope for hardcoded secrets. Run `gitleaks detect --log-opts="--all"` at least once to catch secrets committed and later "removed" — a secret is only really gone if it was rotated, not just deleted from the working tree.
- **Dependency / SBOM audit** — if a lockfile-native auditor is available for the stack, run it over the review scope and treat confirmed advisories as leads for the auth/crypto/secrets subagent: `npm audit --production` (npm/pnpm/yarn), `pip-audit` or `uv pip audit` (Python), `govulncheck ./...` (Go), `cargo audit` (Rust), `osv-scanner -r .` (any, if installed). Only surface advisories that are actually reachable from the app's own code — an advisory in an unused transitive dep is noise; note it at most as LOW.
- Pass any raw hits into the relevant subagent's prompt in Step 1 as supporting evidence, tagged by category (Semgrep secrets/crypto hits and gitleaks hits go to the auth/crypto/secrets subagent; other Semgrep rule categories go to the matching subagent). Subagents must independently verify each tool hit against the actual code — a Semgrep/gitleaks match is a lead, not an automatic finding, since both tools have their own false positives.
- **If neither tool is available**, skip this step and proceed exactly as before — note in the final report that findings are LLM-only review (no static-analysis grounding) so the user knows the confidence bar reflects that.

## Step 1 — spawn subagents

Use the `Agent` tool with `subagent_type: Explore` or `general-purpose` (read-only, no edits) for each category/area, in parallel (single message, multiple tool calls). Each subagent prompt must include:

**Objective**: Identify HIGH-CONFIDENCE security vulnerabilities with real exploitation potential — newly introduced or pre-existing in its assigned scope. Not a general code review; skip style/theoretical/low-impact issues.

**Categories to examine** (assign the relevant subset per subagent):
- Input validation: SQL injection, command injection, XXE, template injection, NoSQL injection, path traversal
- Auth & authz: authentication bypass, privilege escalation, session management flaws, JWT vulnerabilities, authorization bypasses
- Access control (object-level): IDOR / BOLA — an authenticated user reaching another user's/tenant's records because the handler filters by the supplied id but not by the caller's ownership. Check every route that takes a resource id.
- Mass assignment / over-posting: request bodies bound straight to models/ORM objects where a client can set fields it shouldn't (`is_admin`, `role`, `price`, `user_id`).
- SSRF: outbound requests whose **host or protocol** is attacker-influenced (not just the path) — webhook URLs, image/PDF fetchers, URL preview, proxy endpoints.
- Crypto & secrets: hardcoded API keys/passwords/tokens, weak crypto algorithms, improper key storage, weak randomness, certificate validation bypasses
- Injection & code execution: insecure deserialization (pickle, YAML), eval injection, RCE, XSS (reflected/stored/DOM)
- Data exposure: sensitive data logging, PII handling violations, API data leakage, debug info exposure

**Hard exclusions** (do not report these):
- Denial-of-service / resource exhaustion / rate limiting
- Secrets on disk that are otherwise secured
- Outdated third-party library vulnerabilities (handled separately, e.g. dependabot)
- Memory safety issues (buffer overflow, use-after-free) in memory-safe languages
- Findings in test-only files or documentation/markdown files
- Log spoofing from unsanitized input in logs; logging URLs
- SSRF that only controls the path (not host/protocol)
- Regex injection / regex DoS
- Lack of general hardening/best-practices with no concrete exploit
- Race conditions that are theoretical rather than concretely problematic
- Client-side JS/TS lacking permission checks (server is the trust boundary)
- React/Angular XSS unless using `dangerouslySetInnerHTML`/`bypassSecurityTrustHtml` or similar unsafe escapes
- Command injection in shell scripts unless there's a concrete untrusted-input path
- Environment variables / CLI flags treated as attacker-controlled

**Severity scale**: HIGH (RCE, data breach, auth bypass), MEDIUM (significant impact but needs specific conditions), LOW (defense-in-depth). Only report LOW if grouped as minor notes — focus output on HIGH/MEDIUM.

**Confidence**: assign 1-10; only include findings scoring 8+ (i.e. >80% confident of actual exploitability). Drop anything below that threshold rather than including it as a caveat.

**Output per finding**: file:line, severity, category (e.g. `sql_injection`, `xss`), description, concrete exploit scenario, fix recommendation. Cap response length (e.g. under 300 words per finding, bullet list).

## Step 2 — aggregate, dedupe, and false-positive filter

Once subagents report back:

1. Merge all findings, sorted by severity descending (HIGH → LOW).
2. Deduplicate anything two subagents flagged independently.
3. For each remaining finding, spot-check the cited file:line yourself against the hard-exclusions list above and drop any that match — err toward dropping rather than flooding the report with noise.
4. Drop anything you can't personally verify by reading the cited code.
5. Mark any finding that was also flagged by Semgrep or gitleaks (Step 0.5) as **tool-confirmed** in the report — this is a stronger signal than LLM-only findings and should be called out distinctly (e.g. a column/tag) in Step 3.
6. If `WebSearch`/`WebFetch` are available and a finding involves a specific third-party library/version, do a quick search for a matching known CVE or advisory (e.g. NVD, GitHub Advisory Database) and cite it if found — this turns a vague "this pattern looks risky" into a concrete "this matches CVE-2024-XXXX." Don't block the report waiting on this; skip it if the lookup is inconclusive.
7. If a `postgres` MCP server is configured and a finding involves a database query, use it to check the actual schema/column types instead of guessing from the code — this sharpens SQL-injection findings (e.g. confirming a raw string really does reach a query, not just something that looks like one) and helps rule out false positives where an ORM already parameterizes the call.

If a Sentry MCP server is configured (see [Tracker selection](#tracker-selection)), cross-reference each HIGH finding against recent production errors/issues in Sentry before finalizing severity — a finding that's already causing crashes in prod should be called out explicitly as such.

## Step 2.5 — drop findings already tracked as open issues (GitHub mode only)

Skip this step entirely in local-only mode. List currently open review issues (reuse the list from Step 0.3 if you already fetched it there; otherwise `gh issue list --state open --limit 100` or the tracker equivalent). For each finding surviving Step 2, check whether it matches an open issue by file + category + fuzzy description — same tolerant-of-line-drift matching `/cr-baseline` uses, since the code may have shifted slightly since filing. Drop matches from the main report and replace them with a single "N findings already tracked as open issues (see #12, #17, ...)" line so the report stays focused on what's genuinely new. If a finding shares a location with an open issue but is clearly a distinct vulnerability, don't drop it — report it as new. This is independent of (and stacks with) the `/cr-baseline` suppression from Step 0.4 — baseline is for things you've deliberately accepted; this is for things already sitting in the tracker.

## Step 3 — report to the user

Present findings as a table: severity, category, file:line, one-line summary, exploit scenario, fix suggestion. Then, per the mode chosen in Step 0.2: in **GitHub mode**, ask the user explicitly whether to file issues for some/all of these — do not create issues without confirmation. In **local-only mode**, instead ask whether to apply some/all of the fixes directly to the working tree now (Step 4b).

If a Slack MCP server is configured, the user is in GitHub mode, and they want findings posted there too, ask which channel, then post a short summary of HIGH-severity findings only (channel messages should stay skimmable — link to the filed issues rather than repeating full detail). Skip this in local-only mode — the whole point is that nothing gets posted anywhere.

## Step 4 — file issues (GitHub mode only, after user confirms)

Skip this step entirely in local-only mode. Pick a tracker per [Tracker selection](#tracker-selection) below. List existing open items first and skip anything already filed (compare by file/line/description, not title wording). For each confirmed finding, create an item with:

- Title: `[security] <category> — <short description> (<file>:<line>)`
- Body: file:line, description, exploit scenario, fix recommendation, severity, and a `security` label/tag (plus severity label if the tracker has matching labels — create with `gh label create` or the tracker's equivalent only if the user agrees).

Report back the filed item links, and list anything left unfiled (too speculative, needs more discussion, etc). Findings filed this way are compatible with `/cr-fix` for remediation.

## Step 4b — local fix (local-only mode only)

Skip this step entirely in GitHub mode. For each finding the user confirmed in Step 3, read the file, apply the minimal correct fix, and run tests if any exist for the affected code. Don't create a branch, don't commit, don't push — leave the edited files sitting uncommitted in the working tree. Report a short summary of what changed per finding instead of issue links.

## Step 5 — record lessons (only if learning is enabled)

If `.claude/cr/learn.enabled` exists (see `/cr-learn`), append any genuinely new, durable lessons from this run to `.claude/cr/notes.md`, deduping against what's already there. Good candidates:
- a `false-positive` note for any finding you investigated and confirmed safe, so the next run doesn't re-flag it;
- a `hotspot` note if an area produced a confirmed HIGH/MEDIUM finding;
- a `convention` note for a project-specific safe pattern you had to learn (e.g. "all queries go through the `db.q()` wrapper which parameterizes").

Keep it terse and durable — skip anything already obvious from the code or the codebase map. If learning is off, skip this step entirely.

## Tracker selection

Before filing anything, check `ToolSearch` (query `"mcp__linear"`) for a configured Linear MCP server:

- **If Linear MCP tools are available**, use them (`create_issue`, `list_issues`, `update_issue`, `create_comment`) instead of `gh issue`. Ask the user which Linear team/project to file into if it's not obvious.
- **Otherwise**, use the `github` MCP server's tools if configured, or plain `gh issue` (GitHub CLI) if not — either way, GitHub issues as before.

See the root [README](../../README.md#mcp-integrations) for how to configure Linear, Slack, and Sentry MCP servers.
