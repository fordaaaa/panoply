---
description: Set up and launch telegram-bot-mcp — control this Mac's terminal and Claude Code from your phone over Telegram
argument-hint: "[setup|start|reconfigure] (optional)"
---

Set up and launch **[telegram-bot-mcp](https://github.com/fordaaaa/telegram-bot-mcp)** — an npm package (Node/TypeScript) that runs a self-hosted Telegram bot letting a whitelisted phone drive this Mac's terminal and Claude Code over long-polling (no public URL needed). The package is a separate repo; this skill's job is install, first-run config, and launch — not writing the bot.

Optional intent: `$ARGUMENTS` (e.g. `setup`, `start`, `reconfigure`). If empty, infer from state per Step 0.

> This exposes a shell on this machine to whoever can message the bot. The **whitelist** and the **secret token** are the whole security model — handle both carefully and explain them (Step 4). Never echo the token into anything committed; config files and secrets are gitignored by the package.

## Step 0 — detect state

Check whether the package is installed and configured:

- **Not installed** (no global `telegram-bot-mcp` on PATH and no local clone) → go to Step 1.
- **Installed but no config** (no `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_IDS` env and no config file at `./telegram-bot-mcp.config.json` or `~/.config/telegram-bot-mcp/config.json`) → go to Step 2.
- **Configured** → ask whether to **(re)start** (Step 3) or **reconfigure** (redo Step 2). Never print the existing token.

## Step 1 — install the package

The package isn't on the public npm registry yet, so prefer whichever applies:

- **Once published:** nothing to install — `npx -y telegram-bot-mcp bot` fetches it on demand.
- **Pre-publish (today):** clone and build from source, then link so the `telegram-bot-mcp` command exists:
  ```bash
  git clone https://github.com/fordaaaa/telegram-bot-mcp.git ~/telegram-bot-mcp
  cd ~/telegram-bot-mcp && npm install && npm run build && npm link
  ```
  (Requires Node ≥ 18. `npm install` runs the build automatically; `npm link` is optional — you can also run `node ~/telegram-bot-mcp/dist/cli.js <cmd>` directly.)

## Step 2 — collect the two required secrets and configure

Ask the user for exactly two things:

1. **Bot token** — "On Telegram, message **@BotFather**, send `/newbot`, follow the prompts, copy the token (looks like `123456:ABC-DEF…`)."
2. **Your Telegram numeric user ID** — "Message **@userinfobot** (or **@RawDataBot**) and copy the numeric `id`." (Allow more than one ID if the user wants multiple people.)

Then configure via **whichever the user prefers** (all three are supported; resolution order is env → Keychain → config file):

- **Env vars (simplest for `npx`):**
  ```bash
  export TELEGRAM_BOT_TOKEN='123456:ABC-DEF…'
  export TELEGRAM_ALLOWED_IDS='11111111,22222222'   # comma-separated
  ```
- **macOS Keychain (keeps the token off disk — recommended):**
  ```bash
  security add-generic-password -U -s telegram-bot-mcp-token -a telegram-bot-mcp -w '<token>'
  ```
  then set the allowlist via `TELEGRAM_ALLOWED_IDS` or the config file.
- **Config file** (`./telegram-bot-mcp.config.json` or `~/.config/telegram-bot-mcp/config.json`): copy `config.example.json`, fill `bot_token` + `allowed_user_ids`. The file is gitignored and chmod'd `0600` on startup.

**Secure defaults to preserve (call these out):**
- `shell_enabled` is **`false`** — the raw shell (`!`/`/sh`) is off. Enabling it ALSO requires a `shell_passphrase_hash`; the shell stays unusable without one.
- To enable the shell safely: run `telegram-bot-mcp hashpw` (prompts for a passphrase, never stores plaintext, prints a `"shell_passphrase_hash": "pbkdf2_sha256$…"` line). Put it in config and set `shell_enabled: true`. Over Telegram the user arms it with `/unlock <passphrase>`; it auto-relocks after `idle_lock_seconds` (default 300) or `/lock`.
- `command_timeout_seconds`, lockout/alert tuning, and `owner_chat_id` have safe defaults — leave them unless asked. `owner_chat_id: null` sends unauthorized-access alerts to the lowest whitelisted id.
- Offer `workspace_root` if the user wants the bot to operate in a specific project directory.

Confirm what was set (report the path/method, **never** the token contents).

## Step 3 — launch

- **Published:** `npx -y telegram-bot-mcp bot`
- **From a clone:** `telegram-bot-mcp bot` (if linked) or `node ~/telegram-bot-mcp/dist/cli.js bot`

This is long-running and spawns `caffeinate` (macOS) so the Mac stays awake. Start it in the background, or have the user run it in their own terminal so it survives this session. Then tell them to message their bot `/start` from Telegram to confirm it's live.

If launch fails, surface the error — usual causes are a missing/placeholder token, an empty whitelist (the bot refuses to start without valid IDs), or Node < 18.

## Step 4 — explain the security model (always)

- The **bot token is a secret** — anyone with it can impersonate the bot. Keep it in Keychain/env or the gitignored config; never commit it.
- **Only whitelisted numeric IDs** can control the machine; every handler enforces this and the bot won't start with an empty whitelist. This is the entire security boundary — the bot runs shell commands on the host.
- **Telegram is NOT end-to-end encrypted for bots** — Telegram's servers see the traffic. Don't send passwords/keys through it, and remember command **output** can leak secrets too.
- **The phone is the real risk.** Raw shell is off by default and, when on, sits behind `/unlock <passphrase>` with idle auto-relock, plus a catastrophic-command denylist and per-command timeout.
- **Kill switch:** `telegram-bot-mcp stop` (definitive — SIGTERM→SIGKILL, sweeps caffeinate, clears the pidfile), or `/shutdown` from Telegram, or Ctrl-C the process. Last resort: `pkill -f telegram-bot-mcp`. A single-instance pidfile guard refuses a second bot — run `stop` first if it complains.

## Usage reminder (share with the user)

From Telegram: send **plain text** to run it as a Claude Code prompt; prefix `!` (or `/sh <cmd>`) for a raw shell command (needs `/unlock` first when the shell is enabled); `/lock` to re-lock; `/status` for the running job + lock state; `/cancel` to stop it; `/shutdown` to stop the bot; `/help` for the rest.

## Roadmap note (mention if relevant)

telegram-bot-mcp will also ship an **MCP server** (`telegram-bot-mcp mcp`, currently a stub) — the *outbound* direction, exposing a `send_telegram` tool so **any** Claude Code session can text/send you media on its own. Once implemented, wire it into a project's `.mcp.json`:
```json
{ "telegram": { "command": "npx", "args": ["-y", "telegram-bot-mcp", "mcp"],
                "env": { "TELEGRAM_BOT_TOKEN": "…", "TELEGRAM_CHAT_ID": "…" } } }
```
