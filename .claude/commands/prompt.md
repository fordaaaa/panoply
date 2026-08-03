---
description: Compile a raw request into a structured, intent-preserving prompt plus a base plan, with a token-discipline pass (runs in a cheap subagent)
argument-hint: "[what you want, in plain words]"
---

Treat the user's words as **raw intent**, not a finished instruction. The compilation itself runs in a **subagent** so it doesn't burn main-thread context; your job here is to dispatch it, then relay the result.

The raw intent is: `$ARGUMENTS`

If `$ARGUMENTS` is empty, use the user's most recent message as the intent; if that's also unclear, ask them what they want compiled and stop — don't spawn a subagent for nothing.

## Dispatch — run the compilation in a subagent

Spawn **one** `Agent` with these rule parameters:

- `subagent_type`: `general-purpose`
- `model`: **`haiku`** — this is a lightweight rewriting task; Haiku 4.5 is the cost fit. Do **not** use `sonnet` (Sonnet 5) or `opus` for a routine compile — that's the token waste this rule exists to prevent. Only escalate to `sonnet` if the raw intent is itself large or highly technical (e.g. a multi-part spec), and say so when you do.
- `run_in_background`: `false` — you need the compiled prompt before you can continue.
- `prompt`: the raw intent above, followed verbatim by everything under **"Compilation task"** below.

The subagent's final report is not shown to the user. When it returns, **relay its three-section output verbatim** to the user, then ask: **"Run this now, or do you want to edit it first?"** Do not start executing the compiled prompt until the user says to.

If a critical piece of context is missing, the subagent will flag it under *Assumptions & notes* rather than blocking — surface that to the user, but still show the compiled prompt.

---

## Compilation task

*(This is the subagent's instruction set. Compile the raw intent into a ready-to-run prompt + base plan. Preserve meaning; do not solve a cleaner adjacent problem — that's intent drift. Prefer stating explicit assumptions over asking questions, since you can't talk to the user directly.)*

### Step 1 — extract intent (preserve, never replace)

- **Objective** — the single outcome that means "done."
- **Given context** — constraints, environment, prior decisions already stated.
- **Missing context** — what a competent stranger would need but wasn't said.

The compiled prompt must be losslessly re-derivable from what was actually asked. If a *critical* piece of context is missing (something that changes the answer), pick the safest default, proceed, and record it under *Assumptions & notes* — do not block.

### Step 2 — compile against the quality checklist

Include, in this order, only the parts that apply:

1. **Role + objective** — one sentence: who the model acts as, and the outcome that defines done.
2. **Context the model can't infer** — constraints, environment, prior decisions. Not backstory it already knows.
3. **Output contract** — format, length, what to include/exclude. Biggest quality lever; always include it.
4. **Success criteria** — how the user would check it's right.
5. **Scope boundaries** — what NOT to do, so the model doesn't over-deliver.
6. **Reasoning instruction** — ask for reasoning-before-answer only when the task is non-trivial.

### Step 3 — token-discipline pass

Target **total tokens to a correct result across the whole exchange**, not the shortest first message. In priority order:

1. **Structure over prose** — bullets, tables, labeled fields.
2. **Cut ritual, not content** — drop filler; never cut a constraint, example, or success criterion to save tokens (that causes a re-do — a whole extra turn).
3. **One canonical statement per fact** — remove repetition.
4. **Reference, don't restate** — point at a file/section instead of pasting it.
5. **Right-size reasoning** — no scratchpad on trivial tasks.

### Step 4 — base plan

A short ordered plan (3–7 steps) for executing the compiled prompt, so the run doesn't wander.

### Step 5 — output

Return exactly three sections, nothing else:

```
## Compiled prompt
<the ready-to-run prompt from Steps 2–3>

## Base plan
<the ordered steps from Step 4>

## Assumptions & notes
<assumptions made, intent preserved, or critical clarifications for the user — omit if none>
```
