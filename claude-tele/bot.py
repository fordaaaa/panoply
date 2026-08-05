"""
bot.py — claude-tele: control your Mac terminal + Claude Code from Telegram.

Self-hosted Telegram bot using long polling (no webhook / public URL, so it
works behind NAT). It lets a *whitelisted* user:

  - send a text message that is run as a Claude Code prompt (`claude -p ...`)
  - run raw shell commands (message prefixed with `!`, or `/sh <cmd>`) — OFF by
    default, and when on, gated behind a `/unlock <passphrase>` state machine
  - cancel a long-running job (`/cancel`)
  - stop the bot entirely (`/shutdown`) — see also stop.sh
  - receive photos / gifs / videos / documents pushed by other modules
    (see media.py — the integration hook for the browser-capture module)

SECURITY MODEL (read this before running):
  The PRIMARY control is the user-ID whitelist. Every handler is wrapped by
  @restricted (below), which drops any update whose sender is not in
  config["allowed_user_ids"]. Do not remove that decorator from any handler.
  Do not add a handler without it. Everything else in this file — shell unlock,
  denylist, rate-limiting, audit log, kill switch — is DEFENSE IN DEPTH layered
  on top of the whitelist, never a replacement for it.

  Telegram traffic is NOT end-to-end encrypted — Telegram's servers see it — so
  never pipe real secrets through the bot, and remember command OUTPUT can leak
  secrets too.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import os
import signal
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import media
import security

# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------
logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("claude-tele")
# python-telegram-bot is chatty at INFO; keep its noise down.
logging.getLogger("httpx").setLevel(logging.WARNING)

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
PID_PATH = HERE / "claude-tele.pid"
AUDIT_PATH = HERE / "audit.log"

# Telegram hard-caps a text message at 4096 chars.
TELEGRAM_MAX = 4096

# --------------------------------------------------------------------------
# Config loading
# --------------------------------------------------------------------------


def load_config() -> dict:
    """Load and validate config.json. Fatal on anything missing/malformed."""
    if not CONFIG_PATH.exists():
        log.error(
            "config.json not found at %s — copy config.example.json to "
            "config.json and fill it in (or run the /telegram skill).",
            CONFIG_PATH,
        )
        sys.exit(1)

    # Secret handling: refuse to leave the token file world/group readable.
    warn = security.tighten_permissions(CONFIG_PATH)
    if warn:
        log.warning(warn)

    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        log.error("config.json is not valid JSON: %s", exc)
        sys.exit(1)

    ids = cfg.get("allowed_user_ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        log.error(
            "config.json: allowed_user_ids must be a non-empty list of integer "
            "Telegram user IDs. This is the whole security model — refusing to "
            "start with an empty/invalid whitelist."
        )
        sys.exit(1)

    # Token can come from env var / Keychain / config (in that priority order).
    token = security.resolve_bot_token(cfg)
    if not token:
        log.error(
            "No bot token found. Set CLAUDE_TELE_BOT_TOKEN, add it to the macOS "
            "Keychain (security add-generic-password -s claude-tele-bot-token "
            "-a claude-tele -w '<token>'), or put bot_token in config.json."
        )
        sys.exit(1)
    cfg["_resolved_token"] = token

    # Secure defaults. Missing key ALWAYS resolves to the safe choice.
    cfg.setdefault("work_dir", ".")
    cfg.setdefault("workspace_root", cfg["work_dir"])
    cfg.setdefault("claude_bin", "claude")
    cfg.setdefault("shell_enabled", False)               # OFF by default
    cfg.setdefault("shell_passphrase_hash", "")
    cfg.setdefault("idle_lock_seconds", 300)
    cfg.setdefault("command_timeout_seconds", 300)
    cfg.setdefault("owner_chat_id", None)
    cfg.setdefault("allow_root", False)
    cfg.setdefault("unauthorized_lockout_threshold", 5)
    cfg.setdefault("unauthorized_lockout_window_seconds", 60)
    cfg.setdefault("unauthorized_lockout_cooldown_seconds", 900)
    cfg.setdefault("owner_alert_throttle_seconds", 60)
    return cfg


CONFIG = load_config()
ALLOWED_USER_IDS = set(CONFIG["allowed_user_ids"])
WORKSPACE_ROOT = str(Path(CONFIG["workspace_root"]).expanduser())
CLAUDE_BIN = CONFIG["claude_bin"]
SHELL_ENABLED = bool(CONFIG["shell_enabled"])
SHELL_PASSPHRASE_HASH = CONFIG["shell_passphrase_hash"]
IDLE_LOCK_SECONDS = int(CONFIG["idle_lock_seconds"])
COMMAND_TIMEOUT_SECONDS = int(CONFIG["command_timeout_seconds"])
OWNER_CHAT_ID = CONFIG["owner_chat_id"] or sorted(ALLOWED_USER_IDS)[0]
LOCKOUT_THRESHOLD = int(CONFIG["unauthorized_lockout_threshold"])
LOCKOUT_WINDOW = int(CONFIG["unauthorized_lockout_window_seconds"])
LOCKOUT_COOLDOWN = int(CONFIG["unauthorized_lockout_cooldown_seconds"])
ALERT_THROTTLE = int(CONFIG["owner_alert_throttle_seconds"])


# --------------------------------------------------------------------------
# No-root footgun check. Running a remote-shell bot as root is a disaster.
# --------------------------------------------------------------------------
if hasattr(os, "geteuid") and os.geteuid() == 0 and not CONFIG["allow_root"]:
    log.error(
        "Refusing to run as root — this bot executes shell commands. Run it as "
        "a normal user, or set \"allow_root\": true in config.json if you really "
        "mean it (strongly discouraged)."
    )
    sys.exit(1)


# --------------------------------------------------------------------------
# Unauthorized-access tracking (rate-limit / lockout + throttled owner alerts).
# --------------------------------------------------------------------------
_UNAUTH_HITS: dict[int, deque] = defaultdict(deque)   # uid -> recent attempt ts
_LOCKED_OUT_UNTIL: dict[int, float] = {}              # uid -> cooldown expiry ts
_LAST_ALERT: dict[int, float] = {}                    # uid -> last owner-alert ts


def _record_unauthorized(uid: Optional[int]) -> tuple[bool, bool]:
    """Record an unauthorized attempt from `uid`.
    Returns (is_locked_out, should_alert):
      is_locked_out — the id is in cooldown; the bot should stay silent.
      should_alert  — enough time has passed to send the owner one more alert.
    """
    now = time.monotonic()
    if uid is None:
        return (False, False)

    # Already in cooldown?
    until = _LOCKED_OUT_UNTIL.get(uid)
    if until and now < until:
        return (True, False)
    if until and now >= until:
        _LOCKED_OUT_UNTIL.pop(uid, None)
        _UNAUTH_HITS[uid].clear()

    hits = _UNAUTH_HITS[uid]
    hits.append(now)
    while hits and now - hits[0] > LOCKOUT_WINDOW:
        hits.popleft()
    if len(hits) >= LOCKOUT_THRESHOLD:
        _LOCKED_OUT_UNTIL[uid] = now + LOCKOUT_COOLDOWN

    last = _LAST_ALERT.get(uid, 0.0)
    should_alert = (now - last) >= ALERT_THROTTLE
    if should_alert:
        _LAST_ALERT[uid] = now
    return (False, should_alert)


# --------------------------------------------------------------------------
# SECURITY: whitelist decorator. This is centralized on purpose so it cannot
# be forgotten on an individual handler. EVERY handler is wrapped with it.
# It is the PRIMARY control; the audit/alert/lockout logic here is additive.
# --------------------------------------------------------------------------


def restricted(handler):
    """Reject any update whose sender is not in the whitelist, before the
    wrapped handler runs. Logs + audits every rejected attempt, alerts the
    owner (throttled), and locks out flooders (rate-limited)."""

    @functools.wraps(handler)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *a, **kw):
        user = update.effective_user
        uid = user.id if user else None
        if uid not in ALLOWED_USER_IDS:
            uname = user.username if user else "?"
            log.warning("UNAUTHORIZED attempt from id=%s username=%s — ignored", uid, uname)
            security.append_audit(AUDIT_PATH, uid, "UNAUTHORIZED", f"username={uname}")

            locked, should_alert = _record_unauthorized(uid)
            if locked:
                # In cooldown — go fully silent so a spammer gets nothing.
                return
            # Alert the owner (throttled per offending id).
            if should_alert:
                try:
                    await context.bot.send_message(
                        chat_id=OWNER_CHAT_ID,
                        text=f"⚠️ unauthorized attempt from id={uid} username={uname}",
                    )
                except Exception:  # noqa: BLE001
                    pass
            # Reply once so a curious stranger knows it's locked, then stop.
            try:
                if update.effective_message:
                    await update.effective_message.reply_text("unauthorized")
            except Exception:  # noqa: BLE001
                pass
            return
        return await handler(update, context, *a, **kw)

    return wrapper


# --------------------------------------------------------------------------
# Shell unlock state machine. shell_enabled gates the feature; a per-chat
# unlock (with idle auto-relock) gates each execution.
# --------------------------------------------------------------------------
_SHELL_UNLOCKED_AT: dict[int, float] = {}   # chat_id -> last activity monotonic ts


def shell_is_unlocked(chat_id: int) -> bool:
    """True if the chat is currently unlocked and not idle-expired."""
    ts = _SHELL_UNLOCKED_AT.get(chat_id)
    if ts is None:
        return False
    if time.monotonic() - ts > IDLE_LOCK_SECONDS:
        _SHELL_UNLOCKED_AT.pop(chat_id, None)
        return False
    return True


def shell_touch(chat_id: int) -> None:
    """Refresh the idle timer after successful shell activity."""
    if chat_id in _SHELL_UNLOCKED_AT:
        _SHELL_UNLOCKED_AT[chat_id] = time.monotonic()


async def _shell_gate(update: Update) -> bool:
    """Return True if a shell command is allowed to run right now, else reply
    with the reason and return False. Order: feature flag → passphrase set →
    unlocked."""
    if not SHELL_ENABLED:
        await update.effective_message.reply_text("Shell commands are disabled in config.json.")
        return False
    if not SHELL_PASSPHRASE_HASH:
        await update.effective_message.reply_text(
            "Shell is enabled but no shell_passphrase_hash is set. Generate one "
            "with `python3 hashpw.py` and add it to config.json before using the "
            "shell."
        )
        return False
    if not shell_is_unlocked(update.effective_chat.id):
        await update.effective_message.reply_text("🔒 locked — /unlock first")
        return False
    return True


# --------------------------------------------------------------------------
# Output chunking — Telegram messages max out at 4096 chars.
# --------------------------------------------------------------------------


def chunk_text(text: str, limit: int = TELEGRAM_MAX) -> list[str]:
    """Split text into <=limit chunks, preferring newline boundaries."""
    text = text if text else "(no output)"
    chunks: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(text[:cut])
        text = text[cut:].lstrip("\n")
    if text:
        chunks.append(text)
    return chunks


async def reply_chunked(update: Update, text: str, prefix: str = "") -> None:
    """Send possibly-long text back to the user as one or more messages."""
    body = (prefix + text) if prefix else text
    for chunk in chunk_text(body):
        await update.effective_message.reply_text(chunk)


# --------------------------------------------------------------------------
# Subprocess execution — long-running, non-blocking, cancellable, time-limited.
# We track ONE running job per chat so /cancel has an unambiguous target.
# --------------------------------------------------------------------------

# chat_id -> asyncio.subprocess.Process
_RUNNING: dict[int, asyncio.subprocess.Process] = {}


async def run_subprocess(update, context, argv=None, shell_cmd=None, label="job"):
    """Run a command without blocking the event loop, wait for completion (up to
    command_timeout_seconds), then reply with chunked stdout+stderr. Registers
    the process so /cancel can kill it. Always runs with cwd=WORKSPACE_ROOT."""
    chat_id = update.effective_chat.id
    if chat_id in _RUNNING:
        await update.effective_message.reply_text(
            "A job is already running in this chat. Use /cancel first."
        )
        return

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
    try:
        if shell_cmd is not None:
            proc = await asyncio.create_subprocess_shell(
                shell_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=WORKSPACE_ROOT,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=WORKSPACE_ROOT,
            )
    except FileNotFoundError as exc:
        await update.effective_message.reply_text(f"cannot start {label}: {exc}")
        return

    _RUNNING[chat_id] = proc
    try:
        try:
            stdout, _ = await asyncio.wait_for(
                proc.communicate(), timeout=COMMAND_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()
            await update.effective_message.reply_text(
                f"[{label}] timed out after {COMMAND_TIMEOUT_SECONDS}s and was killed."
            )
            return
        text = stdout.decode("utf-8", errors="replace") if stdout else ""
        header = f"[{label} exit={proc.returncode}]\n"
        await reply_chunked(update, text, prefix=header)
    except asyncio.CancelledError:
        raise
    finally:
        _RUNNING.pop(chat_id, None)
        shell_touch(chat_id)


# --------------------------------------------------------------------------
# Command handlers — every one is @restricted.
# --------------------------------------------------------------------------


@restricted
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "claude-tele is online.\n"
        "• Send any text → run as a Claude Code prompt.\n"
        "• Prefix with ! or use /sh → run a raw shell command (if unlocked).\n"
        "• /unlock <pass> /lock — arm/disarm the shell.\n"
        "• /status — what's running · /cancel — stop it · /shutdown — stop the "
        "bot · /help — details."
    )


@restricted
async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "claude-tele commands:\n"
        f"  (plain text)   run as `{CLAUDE_BIN} -p \"<text>\"` in {WORKSPACE_ROOT}\n"
        "  !<cmd> or /sh <cmd>   run a raw shell command (requires /unlock)\n"
        "  /unlock <passphrase>  arm the shell for this chat\n"
        "  /lock   re-lock the shell now (auto-locks when idle)\n"
        "  /status   show the currently running job (if any)\n"
        "  /cancel   kill the currently running job\n"
        "  /shutdown   stop the bot (also: ./stop.sh)\n"
        "  /start /help   this info\n\n"
        "Security: only whitelisted Telegram IDs can use this bot; it runs a "
        "shell on the host. Telegram traffic is not end-to-end encrypted — "
        "don't send secrets, and remember command output can leak them too."
    )


@restricted
async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    proc = _RUNNING.get(update.effective_chat.id)
    unlocked = "unlocked" if shell_is_unlocked(update.effective_chat.id) else "locked"
    if proc and proc.returncode is None:
        await update.effective_message.reply_text(
            f"1 job running (pid {proc.pid}). /cancel to stop. Shell: {unlocked}."
        )
    else:
        await update.effective_message.reply_text(f"Idle — no job running. Shell: {unlocked}.")


@restricted
async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    proc = _RUNNING.get(update.effective_chat.id)
    if not proc or proc.returncode is not None:
        await update.effective_message.reply_text("Nothing to cancel.")
        return
    try:
        proc.kill()
        await update.effective_message.reply_text("Job cancelled.")
    except ProcessLookupError:
        await update.effective_message.reply_text("Job already finished.")


@restricted
async def cmd_unlock(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """`/unlock <passphrase>` — arm the shell for this chat if the passphrase
    matches the stored hash."""
    chat_id = update.effective_chat.id
    uid = update.effective_user.id
    if not SHELL_ENABLED:
        await update.effective_message.reply_text("Shell commands are disabled in config.json.")
        return
    if not SHELL_PASSPHRASE_HASH:
        await update.effective_message.reply_text(
            "No shell_passphrase_hash configured. Generate one with "
            "`python3 hashpw.py` and add it to config.json."
        )
        return
    passphrase = " ".join(context.args) if context.args else ""
    if not passphrase:
        await update.effective_message.reply_text("Usage: /unlock <passphrase>")
        return
    if security.verify_passphrase(passphrase, SHELL_PASSPHRASE_HASH):
        _SHELL_UNLOCKED_AT[chat_id] = time.monotonic()
        security.append_audit(AUDIT_PATH, uid, "UNLOCK", "shell armed")
        await update.effective_message.reply_text(
            f"🔓 shell unlocked — auto-locks after {IDLE_LOCK_SECONDS}s idle, or /lock."
        )
    else:
        security.append_audit(AUDIT_PATH, uid, "UNLOCK_FAIL", "bad passphrase")
        await update.effective_message.reply_text("Wrong passphrase.")


@restricted
async def cmd_lock(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """`/lock` — re-lock the shell immediately."""
    _SHELL_UNLOCKED_AT.pop(update.effective_chat.id, None)
    security.append_audit(AUDIT_PATH, update.effective_user.id, "LOCK", "shell locked")
    await update.effective_message.reply_text("🔒 shell locked.")


@restricted
async def cmd_shutdown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """`/shutdown` — cleanly stop the bot (polling → graceful shutdown → exit).
    The post_shutdown hook stops caffeinate, the outbox watcher, and removes the
    pidfile. This is one of the three definitive stops (see also stop.sh, pkill)."""
    security.append_audit(AUDIT_PATH, update.effective_user.id, "SHUTDOWN", "requested")
    await update.effective_message.reply_text("Shutting down claude-tele. Bye 👋")
    log.info("shutdown requested by id=%s", update.effective_user.id)
    # Stops run_polling from within the handler; triggers _post_shutdown, which
    # tears down caffeinate + outbox and removes the pidfile, then the process
    # exits cleanly.
    context.application.stop_running()


async def _run_shell(update, context, cmd: str):
    """Shared shell path for /sh and `!cmd`: gate → denylist → execute."""
    if not await _shell_gate(update):
        return
    reason = security.catastrophic_reason(cmd)
    if reason:
        security.append_audit(
            AUDIT_PATH, update.effective_user.id, "SHELL_BLOCKED", f"{reason}: {cmd}"
        )
        await update.effective_message.reply_text(
            f"⛔ refused — matches catastrophic pattern ({reason}). "
            "This is a guardrail, not a sandbox; edit the command if you really mean it."
        )
        return
    shell_touch(update.effective_chat.id)
    log.info("shell (%s): %s", update.effective_user.id, cmd)
    security.append_audit(AUDIT_PATH, update.effective_user.id, "SHELL", cmd)
    await run_subprocess(update, context, shell_cmd=cmd, label="sh")


@restricted
async def cmd_sh(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Run a raw shell command from `/sh <cmd>`. Powerful — guarded by the
    whitelist, the shell_enabled flag, the /unlock state machine, and the
    catastrophic-command denylist."""
    cmd = " ".join(context.args) if context.args else ""
    if not cmd.strip():
        await update.effective_message.reply_text("Usage: /sh <command>")
        return
    await _run_shell(update, context, cmd)


@restricted
async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Default message handler: `!cmd` → shell, anything else → Claude prompt."""
    text = (update.effective_message.text or "").strip()
    if not text:
        return

    if text.startswith("!"):
        cmd = text[1:].strip()
        if not cmd:
            await update.effective_message.reply_text("Usage: !<command>")
            return
        await _run_shell(update, context, cmd)
        return

    # Otherwise: run as a Claude Code prompt. -p is non-interactive/print mode.
    log.info("claude prompt (%s): %s", update.effective_user.id, text[:120])
    security.append_audit(AUDIT_PATH, update.effective_user.id, "CLAUDE", text)
    await run_subprocess(
        update, context, argv=[CLAUDE_BIN, "-p", text], label="claude"
    )


# --------------------------------------------------------------------------
# caffeinate: keep the Mac awake so sleep doesn't kill the bot (macOS only).
# --------------------------------------------------------------------------

_caffeinate: Optional[asyncio.subprocess.Process] = None


async def start_caffeinate() -> None:
    """Spawn `caffeinate -dimsu` as a child on macOS to prevent sleep."""
    global _caffeinate
    if sys.platform != "darwin":
        log.info("not macOS — skipping caffeinate.")
        return
    try:
        _caffeinate = await asyncio.create_subprocess_exec(
            "caffeinate", "-dimsu",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        log.info("caffeinate started (pid %s) — Mac will stay awake while the bot runs.", _caffeinate.pid)
    except FileNotFoundError:
        log.warning("caffeinate not found — Mac may sleep and stop the bot.")


async def stop_caffeinate() -> None:
    """Terminate the caffeinate child on shutdown so we don't leak it."""
    global _caffeinate
    if _caffeinate and _caffeinate.returncode is None:
        try:
            _caffeinate.terminate()
            await _caffeinate.wait()
            log.info("caffeinate stopped.")
        except ProcessLookupError:
            pass
    _caffeinate = None


# --------------------------------------------------------------------------
# Pidfile — single-instance guard + a stable target for stop.sh.
# --------------------------------------------------------------------------


def _pid_alive(pid: int) -> bool:
    """True if a process with `pid` currently exists."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists but owned by someone else
    return True


def acquire_pidfile() -> None:
    """Write our pid to the pidfile, refusing to start if another live instance
    already holds it. A stale pidfile (dead pid) is simply overwritten."""
    if PID_PATH.exists():
        try:
            existing = int(PID_PATH.read_text(encoding="utf-8").strip() or "0")
        except (ValueError, OSError):
            existing = 0
        if existing and existing != os.getpid() and _pid_alive(existing):
            log.error(
                "claude-tele already running (pid %s). Stop it first: ./stop.sh "
                "(or /shutdown from Telegram). Refusing to start a second instance.",
                existing,
            )
            sys.exit(1)
        log.warning("removing stale pidfile for dead pid %s", existing)
    PID_PATH.write_text(str(os.getpid()), encoding="utf-8")


def release_pidfile() -> None:
    """Remove the pidfile if it still points at us. Safe to call repeatedly."""
    try:
        if PID_PATH.exists():
            content = PID_PATH.read_text(encoding="utf-8").strip()
            if content == str(os.getpid()):
                PID_PATH.unlink()
    except OSError:
        pass


# --------------------------------------------------------------------------
# App lifecycle
# --------------------------------------------------------------------------

_outbox_task: Optional[asyncio.Task] = None


async def _post_init(app: Application) -> None:
    """Runs once after the bot starts polling: caffeinate + outbox watcher."""
    await start_caffeinate()
    global _outbox_task
    # The outbox watcher (media.py) delivers files an external module drops in
    # claude-tele/outbox/ to every whitelisted user. This is how the browser
    # module hands captured gifs/videos to the user without touching the bot.
    _outbox_task = media.start_outbox_watch(app.bot, ALLOWED_USER_IDS)
    log.info(
        "claude-tele ready. workspace_root=%s allowed_ids=%s shell_enabled=%s",
        WORKSPACE_ROOT, sorted(ALLOWED_USER_IDS), SHELL_ENABLED,
    )


async def _post_shutdown(app: Application) -> None:
    """Graceful cleanup on EVERY exit path (SIGINT/SIGTERM via stop_signals,
    /shutdown via stop_running, or stop.sh's SIGTERM): stop the outbox watcher,
    stop the caffeinate child, and remove the pidfile."""
    global _outbox_task
    if _outbox_task:
        _outbox_task.cancel()
        try:
            await _outbox_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _outbox_task = None
    await stop_caffeinate()
    release_pidfile()
    log.info("claude-tele shut down cleanly (caffeinate stopped, pidfile removed).")


def main() -> None:
    # Single-instance guard + definitive-stop target. Do this before building
    # the app so we fail fast and never leave two bots fighting over one token.
    acquire_pidfile()

    app = (
        Application.builder()
        .token(CONFIG["_resolved_token"])
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )

    # Register handlers. NOTE: every handler below is @restricted at its
    # definition — the whitelist check happens before any of them do work.
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("cancel", cmd_cancel))
    app.add_handler(CommandHandler("unlock", cmd_unlock))
    app.add_handler(CommandHandler("lock", cmd_lock))
    app.add_handler(CommandHandler("shutdown", cmd_shutdown))
    app.add_handler(CommandHandler("sh", cmd_sh))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    # Python 3.12+ deprecated implicit main-thread loop creation; 3.14 removed
    # it entirely, so PTB's internal asyncio.get_event_loop() raises. Ensure a
    # loop exists before run_polling drives it.
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    log.info("Starting long-polling (no webhook / public URL needed).")
    try:
        # run_polling traps SIGINT/SIGTERM (stop_signals) and drives
        # post_init/post_shutdown, so Ctrl-C and stop.sh's SIGTERM both hit the
        # graceful cleanup path above.
        app.run_polling(
            allowed_updates=Update.ALL_TYPES,
            stop_signals=(signal.SIGINT, signal.SIGTERM),
        )
    finally:
        # Belt-and-suspenders: if we ever exit without post_shutdown running
        # (e.g. a startup crash), make sure the pidfile is not left behind.
        release_pidfile()


if __name__ == "__main__":
    main()
