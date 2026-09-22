# Plan: codereview-enrichment — port open-code-review + code-review-graph into cr-run

## Goal

Enrich the `cr-run` code-review skill with deterministic preview, rule matching, and blast-radius scoping ported from `alibaba/open-code-review` and `tirth8205/code-review-graph`, running automatically on every first run with no binary dependency.

## Non-goals

- No hard requirement on `ocr` binary, SQLite/graph daemon, embeddings, viewer, telemetry, SARIF, CI Action, or visualizer exports.
- No new npm dependencies, no MCP server changes, no `mcp/servers.json` changes.
- No changes to `cr-fix.md` logic; no hand-edits to generated targets (`.claude/`, `.opencode/`, `.cursor/`, `prompts/`, `opencode.json`).
- No whole-repo `ocr scan` without scoping; 1500-file `deep` ceiling stays.

## Files in scope (authoritative for builder)

- `commands/_deterministic.md` (new partial, no frontmatter)
- `commands/cr-run.md` (edit to INCLUDE + wire steps)

## Background (subagent findings, condensed)

open-code-review portable (markdown-only):
- Delegation emulation: `ocr delegate preview --format json` contract (mode, reviewable_files, excluded+reason) emulated with pure git; optional fast-path only if `which ocr` succeeds.
- 6-gate file filter: binary → secrets → user exclude → user include bypass → unsupported ext → default excludes.
- `.opencodereview/rule.json` support if present (first-match-wins, silent skip if absent).
- 5-10 embedded per-glob checklists (NPE/null, thread-safety, XSS/escaping, SQLi/binding, promise/tx).
- Coverage rule: total/reviewed/skipped + reason; report template grouped by severity with suggestion_code/existing_code; misposition (0,0) recovery.

code-review-graph portable (markdown-only):
- Blast-radius scoping: changed files + 1-2 hop callers/dependents/tests first; risk-ordered; round-robin snippet budget; 40% per-file cap.
- Lens prompt template: detect_changes → affected_flows only if needed → tests_for per high-risk func → impact_radius if unclear.
- Token discipline: minimal context first, targeted queries over listings.

Flagged useless (do NOT port): viewer :5483, session HTML export, OTel, provider/model config, SARIF, max-tokens budget, MCP server, CI Action, pip/SQLite/embeddings/D3/GraphML/Cypher, hub/bridge centrality, Leiden split, VS Code ext, pre-commit hook.

## Steps (1-2 files max each)

### Step 1 — create `commands/_deterministic.md` (1 file)

Create new partial with no frontmatter, sections:
1. Deterministic preview contract (workspace/range/commit, merge-base resolution, reviewable_files + excluded+reason, pure-git emulation commands, optional `ocr` fast-path).
2. 6-gate filter + default excludes list + `--preview` dry-run rule.
3. `.opencodereview/rule.json` first-match-wins handling.
4. Embedded per-glob checklists (go/java/ts/python/rust/php essence, ≤10 bullets total).
5. Blast-radius ordering (2-hop callers/tests via `rg`/`git grep`, risk order, 40% cap, round-robin).
6. Coverage + positioning rules (total/reviewed/skipped, verify every file:line, misposition recovery).

### Step 2 — wire into `commands/cr-run.md` (1 file)

- Add `{{INCLUDE:_deterministic.md}}` after `{{INCLUDE:_untrusted.md}}`.
- Step 1: run deterministic preview automatically on first run; print file count + coverage dry-run before spawning above `quick`; keep 1500-file `deep` ceiling.
- Step 3: subagent prompt must include rule header (pattern + rule text applied), explicit non-overlapping blast-radius file set, business-context injection (PR description), token/length caps.
- Step 4: keep verify-every-file:line; add coverage line + path+category+snippet dedupe note.
- Step 6: report grouped by severity with fix + suggestion_code; note optional `ocr` fast-path used or emulated.

### Verification command

```
node build.mjs --lint && node build.mjs && node build.mjs --check
```

Must be green before continuing after each step. Never assume runner; this repo's runner is `node build.mjs` per `package.json` + `CONTRIBUTING.md`.

## Definition of done

- `node build.mjs --lint` passes (partials start with `_`, no frontmatter on partial, no MARKER in sources).
- `node build.mjs --check` passes after regenerate (all targets: `.claude/commands/cr-run.md`, `.opencode/commands/cr-run.md`, `.cursor/commands/cr-run.md`, `prompts/cr-run.md` in sync).
- `cr-run` first run executes preview → rules → blast-radius ordering automatically, with graceful fallback when `ocr` absent and when `.opencodereview/rule.json` absent.
- No new dependencies; `files in scope` list unchanged.
