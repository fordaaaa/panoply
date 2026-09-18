---
name: test-gen
description: Generate missing tests for the changed lines and run them to prove they pass, without refactoring source
argument-hint: "[<files...> | diff]"
---

Cover what changed, not the world. Finds changed lines with no test coverage, generates the smallest tests that exercise them in the repo's own framework, and proves them by running — a new test that never ran green is a rumor.

Argument: `$ARGUMENTS` — files to cover, or `diff` (default): the working diff against `<default-branch>` plus uncommitted changes.

{{INCLUDE:_preflight.md}}

{{INCLUDE:_untrusted.md}}

## Step 1 — establish the target

Resolve the diff under test (`git diff <default-branch>...HEAD` plus uncommitted changes, or `git diff` alone if nothing is committed yet). List the changed source files, excluding anything generated, vendored, or gitignored. If there are no changed lines, say so and stop.

Detect each file's stack (see the `polyglot` skill): Python → `pytest`, Go → `go test`, Rust → `cargo test`, Node/TypeScript → the `package.json` test script, Java → Maven/Gradle. Record the framework per file — never assume one suite covers all of them.

## Step 2 — find the gap

For each target file, locate the existing tests that touch it (same-module test file, or a search for imports of the module). Report per file: **covered** (a test exercises the changed lines), **gap** (no test reaches them), or **no-framework** (no runner exists for this stack — say so loudly, never mark it covered).

If everything is already covered, say so and stop without writing anything.

## Step 3 — generate tests in parallel

One subagent per gap area, all in parallel in a single message. Each prompt states the exact changed lines it owns, the repo's test framework and file-naming convention, and these constraints:

- Return real tests in the repo's framework, placed where that framework expects them. No new test runner, no new dependency unless the user approves.
- Exercise the changed lines directly: happy path plus one edge or failure case. Under 100 lines per file.
- Do not refactor source, do not fix behavior, do not touch `.github/workflows/`, CI config, lockfiles, or credentials.
- Keep the untrusted-input rule above verbatim.

## Step 4 — run the tests yourself

Do not take the subagents' word for it. Run the new tests in the main thread plus the nearest existing suite around them, and paste the real summary line with the exit code. Then confirm each new test actually guards something: delete or invert one assertion mentally — if it would still pass, the test is vacuous and gets rewritten. For a bug fix, additionally revert the source fix briefly, watch the new test fail, and reapply — an untested fix is a repeat incident.

## Step 5 — report

A table: file, new test file, pass/fail with the summary line. State what is covered now and what remains `no-framework`. Suggest `/verify diff` as the next step without running it.

This command will not refactor source, will not push or commit, and will not lower the bar by deleting or weakening existing tests to make the run green.
