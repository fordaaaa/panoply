# panoply-browser

Panoply's branded stdio MCP server for browser automation. Thin wrapper that
spawns `@playwright/mcp` as a child process and forwards JSON-RPC over stdio,
with a default browser profile at `~/.panoply/browser`.

Config (Claude Code `.mcp.json`, Cursor uses no `type`, opencode uses a single `command` array):

```json
{ "mcpServers": { "playwright": { "type": "stdio", "command": "node", "args": ["servers/browser/index.mjs"] } } }
```

Requires Node >= 18 and `npx`. Override the profile location with `PANOPLY_BROWSER_DIR`.
