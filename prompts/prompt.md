# prompt — intent-to-prompt compiler

Portable version of Claude Code's `/prompt` command. Paste this into any coding agent or chat model (Cursor, Aider, Codex, ChatGPT, etc.) and replace `{{INTENT}}` with what you want, in plain words.

---

Treat the text in `{{INTENT}}` as **raw intent**, not a finished instruction. Compile it into a clean, structured prompt and a base plan — the way a compiler turns source into an efficient runnable form **without changing what it means** — then hand it back to be run.

Raw intent: `{{INTENT}}`

If `{{INTENT}}` is empty or unclear, ask what should be compiled and stop.

## Where to run the compilation

If your tool supports **subagents / sub-sessions with a model choice**, run the compilation task below in one, using the **cheapest capable model** (e.g. Haiku-class) — this is lightweight rewriting, so a top-tier model is a token waste. Only escalate the model if the raw intent is itself large or highly technical. Then relay the subagent's three-section output verbatim.

If your tool has **no subagent concept**, just do the compilation task inline yourself.

Either way, after producing the output, ask: **"Run this now, or do you want to edit it first?"** Do not execute the compiled prompt until told to.

## Compilation task

Preserve meaning; do not solve a cleaner adjacent problem — that's intent drift.

### Step 1 — extract intent (preserve, never replace)

- **Objective** — the single outcome that means "done."
- **Given context** — constraints, environment, prior decisions already stated.
- **Missing context** — what a competent stranger would need but wasn't said.

The compiled prompt must be losslessly re-derivable from what was actually asked. If a *critical* piece of context is missing (something that changes the answer), pick the safest default, proceed, and record it under *Assumptions & notes* — don't block.

### Step 2 — compile against the quality checklist

Include, in this order, only the parts that apply:

1. **Role + objective** — one sentence: who the model acts as, and the outcome that defines done.
2. **Context the model can't infer** — constraints, environment, prior decisions. Not backstory it already knows.
3. **Output contract** — format, length, what to include/exclude. Biggest quality lever; always include it.
4. **Success criteria** — how you'd check it's right.
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
