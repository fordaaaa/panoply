# panoply-gh

Panoply's branded stdio MCP server for GitHub. A tiny local stdio-to-HTTPS
bridge: reads newline-delimited JSON-RPC on stdin, forwards it to
`https://api.githubcopilot.com/mcp/`, and writes responses back over stdout.

Auth is via the `GITHUB_MCP_TOKEN` environment variable (sent as Bearer) — see
[`docs/mcp-auth.md`](../../docs/mcp-auth.md) for how to get one, verify it,
and troubleshoot it. Toolsets default to `issues,pull_requests,repos`;
override with `PANOPLY_GH_TOOLSETS`.

Config:

```json
{ "mcpServers": { "github": { "type": "stdio", "command": "node", "args": ["servers/gh/index.mjs"] } } }
```

Requires Node >= 18.
