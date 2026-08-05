# claude-tele

A tiny self-hosted Telegram bot that lets you drive your Mac's terminal and
Claude Code from your phone. It uses **long polling**, so it needs no public
URL, webhook, or port forwarding — it works fine behind NAT.

> The easiest way to set this up is the `/telegram` skill in this repo, which
> walks you through creating the bot, writing `config.json`, installing deps,
> and launching. The steps below are the manual equivalent.

## Security model (read first)

This bot runs shell commands and Claude Code on your machine on behalf of
whoever messages it. The **primary, non-negotiable** control is a whitelist of
Telegram numeric user IDs — everything else is defense in depth layered on top:

- **Whitelist (primary).** Every command/message handler is wrapped by the
  `@restricted` decorator in `bot.py`, which drops any update whose sender is
  not in `allowed_user_ids`. The bot refuses to start with an empty whitelist.
  Do not remove that decorator or add a handler without it.
- **The token is a secret.** Anyone with your `bot_token` can impersonate the
  bot. Prefer keeping it in the macOS Keychain or an env var over the plaintext
  file (see *Token handling* below). Wherever it lives in `config.json`, that
  file is **gitignored** and chmod'd to `0600` on startup — never commit it.
- **Telegram is not E2E encrypted** — Telegram's servers can see the traffic.
  Don't pipe real secrets (passwords, keys) through the bot, **and remember
  command _output_ can leak secrets too** (e.g. `cat .env`, `env`).
- **The phone is the real risk.** If the whitelisted phone is unlocked in the
  wrong hands, the bot is too. That's why the raw shell is **off by default**
  and, when on, sits behind a passphrase unlock with an idle auto-relock.

### Defense-in-depth features

- **Shell off by default** (`shell_enabled: false`). When enabled it is gated by
  a `/unlock <passphrase>` state machine with idle auto-relock (see *Shell
  unlock* below).
- **Catastrophic-command denylist** refuses obviously machine-destroying
  commands (`rm -rf /`, `rm -rf ~`, `mkfs`, `dd of=/dev/…`, fork bombs,
  `shutdown`/`reboot`, redirects to raw disks). This is a **guardrail, not a
  sandbox** — a whitelisted user can trivially evade it; it exists to stop
  fat-finger disasters.
- **Per-command timeout** (`command_timeout_seconds`, default 300s) kills runaway
  shell/Claude subprocesses.
- **No-root guard**: the bot refuses to start as root unless `allow_root: true`.
- **Audit log**: every executed prompt/shell command plus unlock/lock/shutdown
  and unauthorized attempts is appended to `claude-tele/audit.log` (gitignored,
  `0600`).
- **Owner alerts + lockout**: an unauthorized message pings the owner (throttled
  per offender), and after repeated attempts that id is locked out for a
  cooldown so a spammer can't flood you.
- **Workspace root**: shell and Claude run with `cwd` set to `workspace_root`
  (a soft guardrail, not a jail).

## Config fields

| field | default | meaning |
|---|---|---|
| `bot_token` | placeholder | BotFather token (secret). Overridden by env/Keychain — see *Token handling*. |
| `allowed_user_ids` | `[123456789]` | Telegram numeric IDs allowed to control the machine. The whitelist. |
| `owner_chat_id` | `null` | Where unauthorized-access alerts go. `null` ⇒ the lowest whitelisted id. |
| `work_dir` | `.` | Legacy working dir; `workspace_root` defaults to it. |
| `workspace_root` | `.` | Directory Claude/shell commands run in (soft sandbox). |
| `claude_bin` | `claude` | Path/name of the Claude Code binary. |
| `shell_enabled` | `false` | Enable raw shell (`!`/`/sh`). Off by default. |
| `shell_passphrase_hash` | `""` | Salted hash for `/unlock` (see *Shell unlock*). Required to use the shell. |
| `idle_lock_seconds` | `300` | Auto-relock the shell after this much inactivity. |
| `command_timeout_seconds` | `300` | Kill any shell/Claude subprocess after this long. |
| `allow_root` | `false` | Permit running as root (strongly discouraged). |
| `unauthorized_lockout_threshold` | `5` | Attempts within the window before an id is locked out. |
| `unauthorized_lockout_window_seconds` | `60` | Sliding window for counting attempts. |
| `unauthorized_lockout_cooldown_seconds` | `900` | How long a locked-out id is ignored. |
| `owner_alert_throttle_seconds` | `60` | Minimum gap between owner alerts per offender. |

JSON can't hold comments, so `config.example.json` carries the keys and this
table explains them.

## Token handling

The token is resolved at startup in priority order — the first that yields a
value wins:

1. **Env var** `CLAUDE_TELE_BOT_TOKEN` (recommended for launchd/scripts).
2. **macOS Keychain** (recommended for interactive use):
   ```bash
   security add-generic-password -s claude-tele-bot-token -a claude-tele -w '<token>'
   ```
   The bot reads it with `security find-generic-password -s claude-tele-bot-token -w`.
3. **`config.json`'s `bot_token`** (simplest, least safe — plaintext on disk).

With env or Keychain you can leave `bot_token` as the placeholder in
`config.json`. The startup permission check still tightens `config.json` to
`0600` regardless.

## Shell unlock (when `shell_enabled` is true)

The raw shell is armed per-chat and re-locks itself when idle:

1. Generate a passphrase hash (the plaintext is never stored):
   ```bash
   cd claude-tele && python3 hashpw.py         # prompts twice, prints the line
   ```
   Paste the printed `"shell_passphrase_hash": "pbkdf2_sha256$…"` into
   `config.json` and set `"shell_enabled": true`.
2. From Telegram, `/unlock <passphrase>` arms the shell for that chat.
3. Run shell commands with `!<cmd>` or `/sh <cmd>` while unlocked.
4. It auto-relocks after `idle_lock_seconds` of inactivity, or immediately with
   `/lock`. While locked, shell commands reply `🔒 locked — /unlock first`.

If `shell_enabled` is true but no `shell_passphrase_hash` is set, the shell
stays unusable (by design) until you add one.

## Stopping the bot

Three ways, in order of preference:

- **`./stop.sh`** — the definitive stop. Reads `claude-tele.pid`, sends SIGTERM
  (graceful: stops caffeinate + outbox watcher, removes the pidfile), waits, then
  escalates to SIGKILL if needed, sweeps any orphaned `caffeinate`, and clears
  the pidfile.
- **`/shutdown`** from Telegram — cleanly stops polling and runs the same
  graceful shutdown, then the process exits.
- **Ctrl-C** on the `run.sh`/`bot.py` process — SIGINT hits the same graceful
  path (caffeinate stopped, pidfile removed).
- **Last resort:** `pkill -f bot.py` (then, if needed, `pkill -f 'caffeinate -dimsu'`).

A **single-instance guard** refuses to start a second bot while a live pidfile
exists — run `./stop.sh` first.

## Requirements

- Python 3.10+
- `python-telegram-bot` v20+ (see `requirements.txt`)
- macOS `caffeinate` (preinstalled on macOS) to keep the Mac awake

## Setup (manual)

1. **Create the bot.** On Telegram, message **@BotFather**, send `/newbot`,
   follow the prompts, and copy the token it gives you.
2. **Find your user ID.** Message **@userinfobot** (or **@RawDataBot**) and
   copy the numeric `id`.
3. **Write config.**
   ```bash
   cd claude-tele
   cp config.example.json config.json
   # edit config.json: paste bot_token, put your numeric id in allowed_user_ids
   ```
   See **Config fields** above for every key. At minimum set `bot_token` (or use
   env/Keychain) and `allowed_user_ids`. The raw shell is **off by default**; to
   use it, set `shell_enabled: true` and a `shell_passphrase_hash` (see *Shell
   unlock*).
4. **Install deps** (a venv is recommended):
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
5. **Run:**
   ```bash
   ./run.sh
   ```

## Usage (from Telegram)

- Send **any text** → runs as a Claude Code prompt (`claude -p "<text>"`) in
  `workspace_root`; output is sent back (chunked if it exceeds Telegram's
  4096-char limit).
- Prefix with `!` or use `/sh <cmd>` → runs a raw shell command (requires
  `shell_enabled: true` **and** an active `/unlock` — see *Shell unlock*).
- `/unlock <passphrase>` / `/lock` → arm / disarm the shell.
- `/status` → show the running job + shell lock state · `/cancel` → kill it.
- `/shutdown` → stop the bot (see *Stopping the bot*).
- `/start`, `/help` → info.

Long-running commands don't block the bot; use `/cancel` to stop the current
job in a chat.

## Keep-awake (caffeinate)

On macOS the bot spawns `caffeinate -dimsu` as a child on startup and
terminates it on shutdown, so the Mac won't sleep and kill the bot while it's
running. `run.sh` additionally wraps the whole process in `caffeinate` as a
belt-and-suspenders measure. This is macOS-only and skipped on other
platforms.

## Integration hook

`media.py` is the stable surface other modules build against to send media
back to the user. **A browser-capture module that produces a gif/video should
NOT touch the bot internals — it should hand the file off one of two ways:**

1. **In-process** (you have a reference to the running `telegram.Bot`):
   ```python
   from media import send_video, send_animation, send_photo, send_document
   await send_video(bot, chat_id, "/abs/path/clip.mp4", caption="captured")
   # or auto-pick the type by extension:
   from media import send_auto
   await send_auto(bot, chat_id, "/abs/path/clip.gif")
   ```

2. **Out-of-process** (a separate script/module, no bot reference, no event
   loop) — the recommended path for a decoupled capture module:
   ```python
   from media import push_to_outbox
   push_to_outbox("/abs/path/clip.gif", caption="captured gif")
   ```
   `push_to_outbox` copies the file into `claude-tele/outbox/` atomically. The
   running bot polls that directory (`media.start_outbox_watch`, started in
   `bot.py`'s `_post_init`) every ~2s and delivers anything dropped there to
   every whitelisted user, then archives it under `outbox/.sent/`.

Signatures the browser agent should target:

```python
async def send_photo(bot, chat_id: int, path: str, caption: str | None = None)
async def send_animation(bot, chat_id: int, path: str, caption: str | None = None)  # gif
async def send_video(bot, chat_id: int, path: str, caption: str | None = None)
async def send_document(bot, chat_id: int, path: str, caption: str | None = None)
async def send_auto(bot, chat_id: int, path: str, caption: str | None = None)       # by ext
def      push_to_outbox(path: str, caption: str | None = None) -> Path               # out-of-process
```

The `outbox/` directory is gitignored. The whitelist is enforced at the
inbound-handler layer; the outbox is a local-filesystem channel (a process
that can write to it already has local access), so `push_to_outbox` performs
no ID check itself.
