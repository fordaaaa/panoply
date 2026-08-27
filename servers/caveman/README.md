# panoply-caveman

Zero-dep hand-rolled JSON-RPC 2.0 stdio MCP server. One tool, `usage_snapshot`,
returning an approximate count of bytes/messages this process has seen since
launch — a proxy signal for the `caveman` skill's activation hook, not the
host agent's real context-window accounting (a stdio subprocess has no API
into that).

No auth, no secrets, no network calls.

Config:

```json
{ "mcpServers": { "caveman": { "type": "stdio", "command": "node", "args": ["servers/caveman/index.mjs"] } } }
```

Opt-in — pull it in with `npx panoply init --with caveman`. Requires Node >= 18.
