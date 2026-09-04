# panoply-browser

Panoply's branded stdio MCP server for browser automation. Thin wrapper that
spawns `@playwright/mcp` as a child process and forwards JSON-RPC over stdio,
with a default browser profile at `~/.panoply/browser` — unless you point it at
a browser that's already running.

## Hook into an existing browser (CDP)

Set `PANOPLY_BROWSER_CDP` to the Chrome DevTools Protocol endpoint of a live
Chromium-based browser and the wrapper passes `--cdp-endpoint` through to
`@playwright/mcp` instead of launching its own instance:

```bash
# 1. Start Chrome with remote debugging on a dedicated profile — use your own
#    profile dir so a fresh Chrome doesn't silently reuse an existing instance.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/pw-cdp &

# 2. Point the MCP server at it.
PANOPLY_BROWSER_CDP=http://localhost:9222 node servers/browser/index.mjs
```

The agent then drives your *live* browser — tabs, logins and cookies included —
and closing the client leaves the browser running. Works with Chrome, Edge, and
Brave. Since the wrapper forwards the process environment, you can also set
`PLAYWRIGHT_MCP_CDP_ENDPOINT` directly and skip `PANOPLY_BROWSER_CDP`.

Config (Claude Code `.mcp.json`, Cursor uses no `type`, opencode uses a single `command` array):

```json
{ "mcpServers": { "playwright": { "type": "stdio", "command": "node", "args": ["servers/browser/index.mjs"] } } }
```

Requires Node >= 18 and `npx`. Override the profile location with
`PANOPLY_BROWSER_DIR`; override the target browser with `PANOPLY_BROWSER_CDP`.
