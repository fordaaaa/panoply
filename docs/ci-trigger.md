# Running `/cr-run` automatically on every PR

By default panoply only runs when you type a slash command. This wires
`/cr-run` into a GitHub Action so it reviews every PR on open/push, the way
a hosted review bot would — without needing infra of your own.

## Setup

1. Copy the template:

   ```bash
   mkdir -p .github/workflows
   cp node_modules/panoply/templates/github-workflows/panoply-review.yml .github/workflows/
   # or, if you installed via the plugin/init flow rather than npm:
   curl -o .github/workflows/panoply-review.yml \
     https://raw.githubusercontent.com/fordaaaa/panoply/main/templates/github-workflows/panoply-review.yml
   ```

2. Add an `ANTHROPIC_API_KEY` repo secret (Settings → Secrets and variables →
   Actions). This is separate from your local Claude Code login — CI runs
   as the API, billed per the API's usage, not your subscription.

3. Make sure panoply itself is installed in the repo (`npx panoply init`) so
   `commands/cr-run.md` and `.panoply/config.md` exist for the action to read.

4. Push it. The next PR opened or updated gets a `/cr-run quick` pass.

## What this does and doesn't do

- Runs read-only. `/cr-run` never edits code on its own — see
  [`commands/cr-run.md`](../commands/cr-run.md). Filing issues still goes
  through the `filing:` setting in `.panoply/config.md`; if that's `local`
  (the default), CI runs post the report as a PR comment and file nothing.
- Does **not** run `/cr-fix`. Auto-fixing and auto-merging from CI is a much
  larger trust boundary than reviewing, and isn't wired up here on purpose —
  set it up yourself only if you've read the `autoclose` warning in
  [`commands/_bootstrap.md`](../commands/_bootstrap.md) and actually want it.
- Skips draft PRs and panoply's own `codereview-fixes-*` branches, so it
  never reviews its own output.
- Ships pinned at `/cr-run quick` (one subagent, cents). Raise it to
  `standard` in the workflow file once you trust the spend; `deep` is
  deliberately left out of the template — its cost estimate exists for a
  human to read before confirming, which doesn't happen in CI.

## Cost

Each run is a real API call, billed to whatever key you put in the secret.
`quick` on a typical PR diff is small — see the cost table in
[`commands/cr-run.md`](../commands/cr-run.md). Watch usage for the first
week before turning up the tier or adding `push` triggers.
