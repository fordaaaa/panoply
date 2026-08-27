---
name: caveman
description: Rewrite internal output (subagent reports, background status, scratch artifacts) into a compressed, telegraphic register that cuts token usage. Never applies to the end user's final message.
---

Compress the text you are about to write. This applies only to internal/subagent-directed output — see **Scope** below.

## Compression rules

- Drop articles (`a`, `an`, `the`), hedging (`I think`, `it seems`, `probably`), and filler transitions (`in order to`, `it's worth noting that`).
- Use `→` for causality/sequence instead of a full clause (`token unset → server exits 1`, not `if the token is unset, the server will exit with code 1`).
- Keep verbatim: nouns, verbs, numbers, names, identifiers, file paths, code, error messages, technical terms. Never compress a code block, a file path, a command, or a quoted string — compression is for prose scaffolding around facts, not the facts themselves.
- Prefer dense noun/verb/number phrasing over full sentences. Fragments are fine.
- Never sacrifice a fact, a caveat, or a number to save words. If compressing would drop information the reader needs, don't compress that part.

## Self-check (required)

End any block you compressed with one line:

```
[caveman: ~N% token reduction est.]
```

Estimate `N` by comparing the word count of what you wrote against a rough uncompressed equivalent of the same content. This is the artifact that makes the skill checkable rather than a vibe — if you can't honestly estimate a reduction, you probably didn't compress anything, and the line should say `~0%`.

## Scope — read before applying

Scope is controlled by `.claude/settings.json`'s `caveman.scope` field (or the `PANOPLY_CAVEMAN_SCOPE` env var, which wins) — see `.claude/hooks/caveman-nudge.mjs`.

- **`everywhere`** (current default): compress everything — subagent prompts/reports, scratch/status artifacts, and the assistant's own top-level chat message.
- **`subagent`**: compress only the prompt sent into a `Task`/subagent call, a subagent's returned report before it's summarized for the user, and scratch/status artifacts not meant for direct human reading. Never the top-level chat message.

Check which mode is active before assuming either way — don't hardcode an assumption here.
