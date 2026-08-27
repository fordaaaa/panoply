# Authenticating MCP servers

## Which servers need this

Only **`github`** needs a secret. `context7`, `playwright`, `showcase`, and
`caveman` all declare `"auth": "none"` in [`mcp/servers.json`](../mcp/servers.json)
and need nothing from you.

## Get a token

The GitHub server's OAuth flow doesn't work here — it authenticates by header
instead. If you already have `gh` set up, reuse its token:

```bash
export GITHUB_MCP_TOKEN="$(gh auth token)"
```

Put that line in your shell's startup file (`~/.bashrc`, `~/.zshrc`, etc.) so
it's set in every shell your agent launches from — not just the one you typed
it into.

No `gh`? Use a fine-grained personal access token with `repo` scope instead,
and export that.

## Verify it took

```bash
echo ${#GITHUB_MCP_TOKEN}
```

Want `40`, not `0`. A `0` means the variable isn't set in the process that's
actually launching your agent — `${GITHUB_MCP_TOKEN}` gets expanded at load
time, so if it's unset there it reaches GitHub as the literal string
`${GITHUB_MCP_TOKEN}` and comes back `HTTP 400`.

## Troubleshoot

Both failure modes below surface identically, as a raw `upstream 400` with no
further hint (see `servers/gh/index.mjs`, which forwards whatever status
GitHub's API returned):

- **Variable not set in the launching process.** Check with `echo
  ${#GITHUB_MCP_TOKEN}` above. Launch your agent from a shell that sources
  the file where you exported it.
- **Token went stale.** `gh auth token` is snapshotted at shell startup and
  rotates over time. Open a fresh shell and re-export, or switch to a
  long-lived fine-grained PAT so it doesn't need refreshing.

`gh` itself is the supported fallback — skipping the MCP server entirely
breaks nothing.

## Opt-in servers

`showcase` and `caveman` need no secrets — just pull them in:

```bash
npx panoply init --with caveman,showcase
```

## Adding a new server later

If a future server needs real secrets, document it here in the same
get/export/verify/troubleshoot shape rather than growing a duplicate copy in
its own `servers/<name>/README.md`. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for the `why`/`profile` rules every entry in `mcp/servers.json` must satisfy.
