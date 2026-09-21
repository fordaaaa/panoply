# panoply-opencode-bridge

An MCP server that wraps your **local `opencode` CLI login**, so any MCP host
(Claude Code, Cursor, Cline) can delegate a prompt to opencode as a tool.
No token extraction, no subscription proxy — it spends the same quota as
running `opencode` yourself.

## Tools

- `ask_opencode(prompt, model?, directory?, agent?, variant?, timeoutSecs?)` —
  runs `opencode run ... --format json`, returns text. Defaults to
  `opencode/muse-spark-1.3-contributor-free` @ `xhigh` (override via
  `OPENCODE_DEFAULT_MODEL` / `OPENCODE_DEFAULT_VARIANT`). Stateless: each call
  is a fresh `opencode run`. For implementation tasks set `timeoutSecs: 600`
  and split implement vs. test into separate calls.
- `list_opencode_models(freeOnly?, contains?)` — runs `opencode models`.
- `zen_chat(message, model?, system?)` — calls
  `https://opencode.ai/zen/v1/chat/completions` directly. Needs
  `OPENCODE_ZEN_API_KEY` from `https://opencode.ai/auth`.

## Config

Opt-in — add it with `npx panoply init --with opencode-bridge`, or point any agent at it:

```jsonc
// .mcp.json  (Claude Code)
{ "mcpServers": { "opencode-bridge": { "type": "stdio", "command": "node", "args": ["servers/opencode-bridge/index.mjs"] } } }
```

```jsonc
// opencode.json  (opencode)
{ "mcp": { "opencode-bridge": { "type": "local", "command": ["node", "servers/opencode-bridge/index.mjs"], "enabled": true } } }
```

Env you can set per entry:

```jsonc
"env": {
  "OPENCODE_DEFAULT_MODEL": "opencode/muse-spark-1.3-contributor-free",
  "OPENCODE_DEFAULT_VARIANT": "xhigh",
  "OPENCODE_BIN": "opencode",
  "OPENCODE_ZEN_API_KEY": "<only for zen_chat>"
}
```

## Requirements

- `opencode` on PATH and already logged in (`opencode auth`).
- Node >= 18 (same constraint as every panoply server).

## Notes / limits

- Each `ask_opencode` call = one fresh `opencode run` (stateless). It does NOT
  share sessions between calls.
- Timeouts default to 180s and max out at 600s. Timeout errors include only
  safe run metadata (session id, event/step/tool counts, byte counts), never
  prompt/output content. The server terminates the child process tree on
  timeout. Long agentic runs can still exceed MCP client timeouts — keep
  prompts scoped.
- Transient provider errors (429/5xx/rate limit/capacity) are retried twice
  with backoff; auth errors and timeouts are not.
- Never expose this over the network. The server runs your CLI with your
  credentials; treat it like your terminal.
- Not a way to get "more tokens" than your plan.

## What was left out

The standalone bridge also ships a long-lived Anthropic-compatible proxy
launcher (`claude-opencode`, `proxy.ts`). That stays out of panoply on
purpose: panoply servers are short-lived stdio tools, not daemons.
