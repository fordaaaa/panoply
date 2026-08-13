---
name: verify
description: Check the working diff against a spec's acceptance criteria and the test suite, then write a pass/fail verdict
argument-hint: "[spec-slug | diff]"
---

Grade the current change against a standard that was written **before** the work started, using parallel checkers, and record the verdict. The failure mode this exists to kill: an agent finishes, says "done, all tests pass," and is wrong about both halves.

Argument: `$ARGUMENTS` — a spec slug grades against that spec's acceptance criteria; `diff` (or empty, with no spec in progress) grades the working diff on general correctness.

{{INCLUDE:_untrusted.md}}

## Step 1 — establish the standard

- **Spec slug** → read `.panoply/specs/<slug>.md`. The acceptance criteria are the standard. Unticked tasks are an automatic **FAIL** — say which.
- **`diff` / empty** → the standard is: the diff does what its commits and the user's request say, breaks nothing, and adds nothing unasked-for.

Establish the diff under review: `git diff <default-branch>...HEAD` plus uncommitted changes, or `git diff` alone if nothing is committed yet. State its size in files and lines before proceeding.

## Step 2 — spawn checkers

Four read-only subagents, in parallel, in one message. Each returns a verdict of **PASS / FAIL / N-A** with evidence — never a narrative.

| Checker | Owns | FAILs when |
|:--|:--|:--|
| **Criteria** | each acceptance criterion | it cannot point at the specific code or test output satisfying a criterion |
| **Tests** | the project's test/typecheck/lint commands | a command fails, or **no test covers the changed lines at all** |
| **Scope** | the diff vs the spec's Files and Non-goals | the diff touches files the spec never named, or does something listed as a non-goal |
| **Regression** | code paths adjacent to the change | a caller, a signature, or an assumption elsewhere was silently broken |

"I couldn't find a test command" is **N-A, stated loudly**, never a PASS. An unverifiable claim is not a satisfied one.

## Step 3 — run the tests yourself

Do not take the Tests checker's word for it. Run the suite in the main thread and paste the real summary line. A subagent reporting "tests pass" is a claim; the exit code is evidence. If tests don't exist, say exactly that — do not substitute reasoning about whether they would pass.

## Step 4 — verdict

One table: checker, verdict, one-line evidence. Then a single overall line:

- **PASS** — every checker PASS or a justified N-A, and the suite genuinely ran green.
- **FAIL** — anything else. List exactly what to fix, in priority order.

Never soften a FAIL into "mostly passing". The whole value of this command is that its PASS is trustworthy, and one hedged verdict destroys that permanently.

## Step 5 — write it back

**Spec mode** — append to the spec file:

```
## Verdict — <ISO date>
<PASS|FAIL> · <n> criteria checked · tests: <summary line or "none">
<per-criterion result>
```

Set `status: verified` **only on PASS**. On FAIL leave `status: in-progress` and add the fixes as new unticked tasks, so `/spec resume` picks them up.

**Diff mode** — report on screen; write nothing.

## Step 6 — next step

On PASS, say what shipping looks like from here (commit, PR, `/cr-run` for a deeper review). On FAIL, point at the first thing to fix. Suggest the next command by name; don't run it — the user presses the key.
