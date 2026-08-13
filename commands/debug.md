---
name: debug
description: Debug by falsifiable hypothesis with a ledger on disk, so no theory gets tested twice
argument-hint: "[symptom, or an issue number]"
---

Debugging with an agent fails in a specific way: it proposes a cause, tries a fix, the symptom persists, and forty minutes later it proposes the same cause again because the refutation scrolled out of context. This command keeps a **ledger** at `.panoply/debug/<slug>.md`. Every hypothesis is written down with the experiment that would disprove it and the result. Nothing gets tested twice, and the loop ends on evidence rather than exhaustion.

Argument: `$ARGUMENTS` — a symptom description, or an issue number to pull the symptom from.

{{INCLUDE:_untrusted.md}}

## Step 1 — capture the symptom

Do not start theorizing. Establish first:

- **Repro** — the exact command or steps, and whether they reproduce it *right now*. Run it.
- **Expected vs actual** — precisely. "It's broken" is not a symptom.
- **Last known good** — a commit, a version, a date. `git log` around it if there is one.
- **Environment** — anything non-default that could matter.

**If it doesn't reproduce, stop and say so.** Chasing an unreproducible bug by reading code is how you get a confident fix for a bug that was never there. If the user insists, write "NOT REPRODUCED" at the top of the ledger and treat every conclusion as provisional.

## Step 2 — open the ledger

Create or append `.panoply/debug/<slug>.md`:

```
---
slug: <slug>
status: open        # open | fixed | abandoned
opened: <ISO date>
---

# <symptom, one line>

## Repro
<exact command / steps>  → <actual>  (expected: <expected>)

## Hypotheses
| # | Claim | Falsifying experiment | Result |
|:--|:--|:--|:--|
```

If a ledger for this symptom already exists, **read it first**. Everything in the Result column is already-purchased knowledge; re-running a refuted experiment is the exact waste this command exists to prevent.

## Step 3 — generate hypotheses

3–5 candidate causes, ranked by likelihood × cheapness to test. Each needs an experiment that would **disprove** it — a check that comes back clean if the hypothesis is wrong. "Add a log line and look" is usually not falsifiable; "if the cache were stale, clearing it would fix it, and it doesn't" is.

Write all of them into the table before running anything. Committing to the list up front is what stops the search from drifting toward whichever theory feels good after the last result.

## Step 4 — test one hypothesis

Run exactly one experiment. **Write the result into the ledger before reasoning about it** — recording after you've drawn a conclusion is how a refutation gets quietly reinterpreted as support.

Result is `CONFIRMED`, `REFUTED`, or `INCONCLUSIVE` with one line of evidence. An inconclusive experiment means the experiment was bad — rewrite it, don't guess at the answer.

## Step 5 — loop or widen

Repeat Step 4 down the ranked list. After **5 refutations**, stop generating variations of the same idea — the frame is wrong. Widen instead, and log the pivot:

- `git bisect` between last-known-good and now. This beats reasoning and is almost always underused.
- Check the layer below: dependency version, runtime, environment, config, clock, filesystem, network.
- Re-read Step 1. A misdescribed symptom sends every hypothesis to the wrong place.

## Step 6 — fix and prove

On a confirmed cause: make the **minimal** fix, then re-run the original repro from Step 1. Not a similar case — the exact one.

Then write a regression test that fails without the fix and passes with it. Verify that by reverting the fix, watching it fail, and reapplying. An untested bugfix is a bug waiting for its second appearance.

## Step 7 — close the ledger

Append the root cause — the actual mechanism, not "fixed a null check" — and the fix. Set `status: fixed`. Note anything nearby that shares the same shape of bug; you now know something about this codebase that took real work to learn.

If the symptom came from a filed issue, comment the root cause on it. Don't close it — the fix isn't merged yet. `/cr-fix` or a PR does that.
