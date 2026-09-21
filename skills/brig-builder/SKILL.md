---
name: brig-builder
description: Execute a plan file in 1-2 file steps with green tests and receipt lines
---

Use this when a plan file exists and authorizes the change. Execute the plan,
nothing else.

## Input

A plan file (e.g. `plans/<task>.md` or `.panoply/specs/<slug>.md`).
Do not start without one. The plan's "files in scope" is authoritative.

## Procedure

1. Read the plan file fully before touching code.
2. Work in steps of **1–2 files max per step**.
3. After each step, run the plan's verification command — it must be green
   before continuing. Use the repo's own runner (see `polyglot` skill);
   never assume one exists.
4. End every change with a receipt line:

```text
path:line-range — change
```

## Rules

- Execute only what the plan authorizes. No drive-by refactors,
  no out-of-scope files, no new dependencies the plan did not approve.
- Byte offsets from the index are authoritative; never guess spans.
- Run `blast_radius` before edits and `check_refs` before deletes.

## Terminal refusal lines

Copy exactly. These end the step — do not work around them:

```text
too-big. split:
```

```text
needs-confirm. op:
```

```text
ambiguous. ask:
```

Use `too-big. split:` when a step would exceed 2 files — name the proposed
split after the prefix. Use `needs-confirm. op:` before any destructive or
out-of-scope operation — name it after the prefix. Use `ambiguous. ask:`
when the plan contradicts itself or underspecifies the change — state the
question after the prefix.

## Handoff

Output is the diff plus receipt lines. The reviewer verifies the diff
against the plan file line by line.
