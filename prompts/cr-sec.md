# cr-sec — parallel SECURITY review prompt

Portable version of Claude Code's `/cr-sec` command. Paste this into any coding agent (Cursor, Aider, Codex, ChatGPT, etc.) — replace `{{LEVEL}}` with `low`, `medium`, or `high` first.

This is the security-focused counterpart to `cr-run.md` — use that one for general correctness/perf/style review, this one for vulnerabilities only. Do not edit any files — this is a review-only pass.

The vulnerability taxonomy, exclusion list, and confidence scoring below are adapted from Anthropic's open-source [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) action (MIT licensed) — see the repo README for attribution.

If your tool has an MCP server connected for an issue tracker (Linear), CVE/advisory lookup, or Slack, use those instead of `gh issue`/manual search wherever this prompt mentions them. See the Claude Code version's [MCP integrations](../README.md#mcp-integrations) for the pattern this is based on.

---

Run a security review of this repository using parallel read-only subagents (or, if your tool has no subagent/multi-session concept, simulate it with sequential passes, one category group per pass), then report vulnerability findings ranked by severity.

## Step 0 — parse complexity level

Level: `{{LEVEL}}` (default `medium` if you don't set one).

- **low** — 1 pass, quick scan for high-confidence, high-impact vulnerabilities only.
- **medium** — 3 passes, split by category group: (1) input validation & injection, (2) auth/crypto/secrets, (3) code execution & data exposure.
- **high** — 5+ passes, same category split AND by area of the codebase if it's large.

Scope: if there's a substantial uncommitted diff, or a PR/branch is specified, review that diff (the common case). Otherwise review the full source tree — ask if genuinely ambiguous.

## Step 0.2 — choose trace mode

Before doing any review work, ask the human once how they want this run handled once findings are in:

- **GitHub mode (default)** — normal flow: report findings, then if confirmed in Step 3, file them as GitHub issues (or the tracker's equivalent) per Step 4, giving a visible paper trail others can see and that a `cr-fix` pass can later pick up.
- **Local-only mode** — nothing gets filed, committed, or pushed anywhere. After the Step 3 report, if the human wants any findings fixed now, apply the fix directly to the working tree yourself (Step 4b) — no branch, no commit, no push, no issue. The change sits uncommitted for them to review, commit, or discard on their own.

Carry this choice through the rest of the run — don't ask again per finding. In local-only mode, skip Step 4 (issue filing) entirely.

## Step 0.3 — offer to recheck existing issues first (GitHub mode only)

Skip this step entirely in local-only mode — there's no tracker to reconcile against. In GitHub mode, ask the human once: "Want me to recheck the currently open review issues first (the `cr-recheck` prompt), so stale ones don't get treated as still-known before this review starts?"

- If yes: run the `cr-recheck.md` flow now against `all` currently open review issues. This closes stale ones and corrects moved line numbers on ones still confirmed, so the "currently open" set used in Step 2.5 below is accurate rather than stale.
- If no: skip straight to Step 0.5 and treat whatever's currently open as-is.

This does not change the complexity level chosen in Step 0 — the review itself still runs at that level afterward, unless the human asks for a different level here too.

## Step 0.5 — static analysis grounding (optional)

If your tool can run shell commands and `semgrep` and/or `gitleaks` are installed, run them over the review scope before your own read: `semgrep --config auto <path>` for static analysis, `gitleaks detect`/`gitleaks protect` for secrets. Treat their output as leads, not findings — verify each hit against the actual code yourself before reporting it, since both tools produce false positives. If neither is installed, skip this step and note in the final report that the review is LLM-only.

## Step 1 — review

**Objective**: identify HIGH-CONFIDENCE security vulnerabilities with real exploitation potential. Not a general code review — skip style/theoretical/low-impact issues.

**Categories:**
- Input validation: SQL injection, command injection, XXE, template injection, NoSQL injection, path traversal
- Auth & authz: authentication bypass, privilege escalation, session management flaws, JWT vulnerabilities, authorization bypasses
- Crypto & secrets: hardcoded API keys/passwords/tokens, weak crypto algorithms, improper key storage, weak randomness, certificate validation bypasses
- Injection & code execution: insecure deserialization (pickle, YAML), eval injection, RCE, XSS (reflected/stored/DOM)
- Data exposure: sensitive data logging, PII handling violations, API data leakage, debug info exposure

**Hard exclusions** (do not report):
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

**Severity**: HIGH (RCE, data breach, auth bypass), MEDIUM (significant impact, needs specific conditions), LOW (defense-in-depth, only note briefly).

**Confidence**: score each finding 1-10; only keep findings scoring 8+ (>80% confident of actual exploitability). Drop the rest rather than including them as caveats.

**Per finding**, capture: file:line, severity, category (e.g. `sql_injection`, `xss`), description, concrete exploit scenario, fix recommendation.

## Step 2 — aggregate, dedupe, filter

Merge findings, sorted by severity descending. Deduplicate anything flagged more than once. Re-check each remaining finding against the hard-exclusions list and drop matches — err toward dropping rather than flooding the report with noise. Drop anything you can't verify by rereading the cited code. Mark any finding also caught by Semgrep/gitleaks (Step 0.5) as tool-confirmed in the report.

## Step 2.5 — drop findings already tracked as open issues (GitHub mode only)

Skip this step entirely in local-only mode. List currently open review issues (reuse the list from Step 0.3 if you already fetched it there; otherwise `gh issue list --state open --limit 100` or the tracker equivalent). For each finding surviving Step 2, check whether it matches an open issue by file + category + fuzzy description — tolerant of line drift, since the code may have shifted slightly since filing. Drop matches from the main report and replace them with a single "N findings already tracked as open issues (see #12, #17, ...)" line so the report stays focused on what's genuinely new. If a finding shares a location with an open issue but is clearly a distinct vulnerability, don't drop it — report it as new.

## Step 3 — report

Present findings as a table: severity, category, file:line, one-line summary, exploit scenario, fix suggestion. Then, per the mode chosen in Step 0.2: in **GitHub mode**, ask whether to file these as GitHub issues — do not create issues without explicit confirmation. In **local-only mode**, instead ask whether to apply some/all of the fixes directly to the working tree now (Step 4b).

## Step 4 — file issues (GitHub mode only, after confirmation)

Skip this step entirely in local-only mode. If you (or the human) have `gh` CLI access: run `gh issue list --state all --limit 100` first, skip anything already filed, then for each confirmed finding run `gh issue create` with:

- Title: `[security] <category> — <short description> (<file>:<line>)`
- Body: file:line, description, exploit scenario, fix recommendation, severity, and a `security` label if the repo has one.

If you don't have `gh` access, output the issues as formatted markdown the human can paste in manually.

Report back what was filed (or drafted) and what was left out (too speculative, needs discussion, etc). Findings filed this way are compatible with `cr-fix.md` for remediation.

## Step 4b — local fix (local-only mode only)

Skip this step entirely in GitHub mode. For each finding confirmed in Step 3, read the file, apply the minimal correct fix, and run tests if any exist for the affected code. Don't create a branch, don't commit — leave the edited files sitting uncommitted in the working tree. Report a short summary of what changed per finding instead of issue text.
