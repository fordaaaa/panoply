# telegram — set up & launch telegram-bot-mcp

Set up and launch **telegram-bot-mcp** (https://github.com/fordaaaa/telegram-bot-mcp) — an npm package (Node/TypeScript) that runs a self-hosted Telegram bot letting a whitelisted phone drive this machine's terminal and Claude Code over long-polling (no public URL). The package is a separate repo; your job is install, first-run config, and launch — not writing the bot.

Portable version of Claude Code's `/telegram` command. Replace `{{INTENT}}` with `setup`, `start`, or `reconfigure` (or leave blank to infer).

> This exposes a shell to whoever can message the bot. The **whitelist** and the **secret token** are the whole security model — handle both carefully and explain them. Never commit the token; config/secrets are gitignored by the package.

## Step 0 — detect state
- Not installed (no `telegram-bot-mcp` on PATH, no local clone) → Step 1.
- Installed but unconfigured (no `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_IDS` and no config file at `./telegram-bot-mcp.config.json` or `~/.config/telegram-bot-mcp/config.json`) → Step 2.
- Configured → ask: (re)start (Step 3) or reconfigure (Step 2). Never print the existing token.

## Step 1 — install
Package isn't on npm yet, so:
- Once published: `npx -y telegram-bot-mcp bot` (no install needed).
- Pre-publish: clone + build + link (Node ≥ 18):
  ```bash
  git clone https://github.com/fordaaaa/telegram-bot-mcp.git ~/telegram-bot-mcp
  cd ~/telegram-bot-mcp && npm install && npm run build && npm link
  ```
  (Or run `node ~/telegram-bot-mcp/dist/cli.js <cmd>` directly instead of linking.)

## Step 2 — collect secrets and configure
Ask for two things:
1. **Bot token** — message **@BotFather**, `/newbot`, copy the token.
2. **Your Telegram numeric user ID** — message **@userinfobot** (or **@RawDataBot**), copy the numeric `id`. (Allow multiple IDs if wanted.)

Configure via any of (resolution order env → Keychain → file):
- Env: `export TELEGRAM_BOT_TOKEN='…'` and `export TELEGRAM_ALLOWED_IDS='111,222'`.
- macOS Keychain (recommended): `security add-generic-password -U -s telegram-bot-mcp-token -a telegram-bot-mcp -w '<token>'`, allowlist via env/file.
- Config file: copy `config.example.json` → fill `bot_token` + `allowed_user_ids` (gitignored, chmod `0600` on startup).

Preserve secure defaults; call these out:
- `shell_enabled` is **false**; enabling it also needs `shell_passphrase_hash` or the shell stays unusable.
- Generate the hash safely with `telegram-bot-mcp hashpw` (never stores plaintext). Then `/unlock <passphrase>` over Telegram arms it; auto-relocks after `idle_lock_seconds` (300) or `/lock`.
- `command_timeout_seconds`, lockout/alert tuning, `owner_chat_id` have safe defaults. Offer `workspace_root` for a specific project dir.

Confirm the method/path set — never the token contents.

## Step 3 — launch
- Published: `npx -y telegram-bot-mcp bot`
- From a clone: `telegram-bot-mcp bot` (if linked) or `node ~/telegram-bot-mcp/dist/cli.js bot`

Long-running; spawns `caffeinate` on macOS to keep the Mac awake. Run backgrounded or in the user's own terminal. Then have them message the bot `/start`. On failure, surface the error (bad/placeholder token, empty whitelist, or Node < 18).

## Step 4 — explain the security model (always)
- The **token is a secret**; keep it in Keychain/env or gitignored config, never commit it.
- **Only whitelisted IDs** can control the machine; the bot refuses to start with an empty whitelist. This is the entire boundary.
- **Telegram bots are NOT end-to-end encrypted** — Telegram's servers see traffic; don't send secrets, and command **output** can leak them too.
- **The phone is the real risk** — raw shell off by default, and when on sits behind `/unlock` with idle auto-relock, a catastrophic-command denylist, and a per-command timeout.
- **Kill switch:** `telegram-bot-mcp stop` (definitive), or `/shutdown` from Telegram, or Ctrl-C. Last resort `pkill -f telegram-bot-mcp`. Single-instance pidfile guard refuses a second bot — run `stop` first.

## Usage reminder
Plain text → Claude Code prompt; `!`/`/sh <cmd>` → raw shell (needs `/unlock` when enabled); `/lock`, `/status`, `/cancel`, `/shutdown`, `/help`.

## Roadmap note
An **MCP server** (`telegram-bot-mcp mcp`, currently a stub) is planned — the outbound direction, a `send_telegram` tool so any Claude session can text/send you media. Wire into `.mcp.json` once implemented:
```json
{ "telegram": { "command": "npx", "args": ["-y", "telegram-bot-mcp", "mcp"],
                "env": { "TELEGRAM_BOT_TOKEN": "…", "TELEGRAM_CHAT_ID": "…" } } }
```
