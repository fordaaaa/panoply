## Deterministic prelude — runs automatically on first run

Do this before spawning any subagent. It is pure `git` + `rg` — no binary required. Ported from `alibaba/open-code-review` delegation/preview and `tirth8205/code-review-graph` blast-radius scoping. Useless parts (viewer, telemetry, SARIF, SQLite/graph daemon, embeddings, CI Action) are deliberately not ported.

### Preview contract (emulated `ocr delegate preview`)

Resolve mode first: workspace (staged + unstaged + untracked), range (`--from`/`--to` via merge-base), or single commit. Then emit a preview table: `path | status | +/-` plus an excluded list with reasons.

- Optional fast-path: if `which ocr` succeeds, run `ocr delegate preview --format json` and `ocr delegate rule --format json <paths>` and use that output. Otherwise emulate below. Never require install.
- Emulate with: `git diff HEAD --name-status`, `git diff --merge-base <from> <to> --name-status` for ranges, `git show --stat` for single commits, `git ls-files --others --exclude-standard` for untracked.
- Inject PR description as business context into every subagent prompt when available (`gh pr view --json body -q .body`). This is the `--background` equivalent.
- `--preview` dry-run: on `deep`, print the preview file list before spawning so the user sees coverage before spend.

### 6-gate file filter

Apply in order; first match wins. List what each gate dropped with reason.

1. Binary files → drop (`git diff --numstat` with `- -`).
2. Secrets → drop: `.ssh/id_*`, `.env*`, `*.pem`, `*.key`, `credentials*.json`.
3. Repo `.opencodereview/rule.json` `exclude` → drop if present; absent → skip silently.
4. Repo `.opencodereview/rule.json` `include` → keep even if a later gate would drop.
5. Unsupported extension → drop (non-text, lockfiles, generated protobuf).
6. Default excludes → drop: `*_test.go`, `*.test.ts`, `__tests__/`, `fixtures/`, `snapshots/`, `*.gen.*`, `*.pb.go`, `vendor/`, `node_modules/`, `dist/`, `target/`.

`.opencodereview/rule.json` shape when present: `{include[], exclude[], rules[{path, rule, merge_system_rule}]}`. Rules match by glob in declaration order; first match wins; `--rule` arg overrides file.

### Per-glob checklists (embedded rule essence)

Assign one checklist per file by glob and paste it into that file's subagent prompt header with the `pattern + rule text` it applied (the `rules check` equivalent). Keep to these; do not invent more:

- `*.go`, `*.java`: null/NPE validation on every dereference; map + mutex thread-safety; tx rollback on every error return.
- `*.ts`, `*.js`: unhandled promise/async error paths; template-escaping/XSS on every interpolated string; null/undefined guards at boundaries.
- `*.py`: unhandled exception paths; SQL binding (no string-concatenated queries); mutable-default-arg and None-guard checks.
- `*.rs`, `*.php`: unchecked unwrap/error paths; XSS/escaping on output; SQLi/binding on queries.

### Blast-radius ordering (graph essence, no daemon)

Order files by risk before assigning to subagents. No SQLite, no embeddings — `rg`/`git grep` only.

- Changed files first, then 1–2 hop callers/dependents/tests found via `rg -l <symbol>` / `git grep -l <name>` on exported functions/classes.
- Risk order: security-adjacent + data-loss paths > callers with no test cover (`tests_for` lookup fails) > hubs imported by many files > everything else.
- One file never exceeds 40% of snippet budget; spend budget round-robin across files.
- Each lens owns an explicit non-overlapping blast-radius file set — no overlap with siblings.
- Minimal context first: changed hunk + enclosing function signature; fetch full file or caller only when the hunk is ambiguous. Prefer one targeted `rg` over a directory listing.

### Coverage + positioning

- End every run with: `total / reviewed / skipped + reason per skip`. Skipped needs a reason. A skipped file without a reason is a coverage bug.
- Verify every cited `file:line` by opening it. Drop unverified findings. On misposition (`0,0` or drifted line), read the file, locate by surrounding context, and correct or drop — never file a floating comment.
- Dedupe re-runs on `path + category + snippet`, tolerant of line drift, not on line number alone.
