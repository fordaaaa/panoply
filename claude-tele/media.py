"""
media.py — outbound media primitives for claude-tele.

This module is the INTEGRATION HOOK that other modules (e.g. a future
browser-capture module) build against. It exposes small, cleanly-named
coroutines to push a photo / animation (gif) / video / document to a
Telegram chat, plus an outbox mechanism so an *external process* that
can't touch the running bot's event loop can still deliver a file to the
user by simply dropping it in a directory.

Two ways to send a file to the user:

  1. In-process (you have a reference to the telegram Bot):
         from media import send_video
         await send_video(bot, chat_id, "/path/to/clip.mp4", caption="done")

  2. Out-of-process (a separate script/module — no bot reference):
         from media import push_to_outbox
         push_to_outbox("/path/to/clip.mp4", caption="captured gif")
     The running bot watches the outbox directory (see start_outbox_watch)
     and delivers anything dropped there to every allowed user.

Nothing here enforces the whitelist — callers inside the bot pass a
chat_id that is already known to belong to an allowed user, and the
outbox is a local-filesystem-only channel (a process that can write to
the outbox already has local machine access). The whitelist is enforced
at the inbound handler layer in bot.py.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Iterable, Optional

log = logging.getLogger("claude-tele.media")

# Directory an external process drops files into. Kept alongside this file
# so the path is stable regardless of the bot's working directory.
OUTBOX_DIR = Path(__file__).resolve().parent / "outbox"
# Files that finished sending are moved here so they aren't sent twice.
_SENT_DIR = OUTBOX_DIR / ".sent"


# --------------------------------------------------------------------------
# In-process send primitives.
# Each takes the telegram Bot, a chat_id, a filesystem path, and an optional
# caption. These are the functions an in-process module should call.
# --------------------------------------------------------------------------

async def send_photo(bot, chat_id: int, path: str, caption: Optional[str] = None):
    """Send a still image (jpg/png/webp)."""
    with open(path, "rb") as fh:
        return await bot.send_photo(chat_id=chat_id, photo=fh, caption=caption)


async def send_animation(bot, chat_id: int, path: str, caption: Optional[str] = None):
    """Send an animation / gif (Telegram renders .gif and .mp4 as animations)."""
    with open(path, "rb") as fh:
        return await bot.send_animation(chat_id=chat_id, animation=fh, caption=caption)


async def send_video(bot, chat_id: int, path: str, caption: Optional[str] = None):
    """Send a video file (mp4 recommended)."""
    with open(path, "rb") as fh:
        return await bot.send_video(chat_id=chat_id, video=fh, caption=caption)


async def send_document(bot, chat_id: int, path: str, caption: Optional[str] = None):
    """Send any file as a document (no re-encoding, preserves the original)."""
    with open(path, "rb") as fh:
        return await bot.send_document(chat_id=chat_id, document=fh, caption=caption)


# Map a file extension to the most appropriate send primitive so the outbox
# watcher (and external callers) can auto-pick the right kind.
_EXT_DISPATCH = {
    ".jpg": send_photo, ".jpeg": send_photo, ".png": send_photo, ".webp": send_photo,
    ".gif": send_animation,
    ".mp4": send_video, ".mov": send_video, ".webm": send_video, ".mkv": send_video,
}


async def send_auto(bot, chat_id: int, path: str, caption: Optional[str] = None):
    """Pick send_photo/animation/video by extension, falling back to document."""
    fn = _EXT_DISPATCH.get(Path(path).suffix.lower(), send_document)
    return await fn(bot, chat_id, path, caption)


# --------------------------------------------------------------------------
# Out-of-process outbox: a separate process drops a file here; the bot
# delivers it. This is the hook a browser-capture module should use when it
# does NOT share the bot's event loop.
# --------------------------------------------------------------------------

def push_to_outbox(path: str, caption: Optional[str] = None) -> Path:
    """
    Copy `path` into the outbox so the running bot picks it up and sends it
    to every allowed user. Safe to call from any process. Returns the path
    of the queued copy.

    A tiny sidecar `<name>.caption.txt` carries the caption if provided.
    Files are staged with a leading '.' then atomically renamed so the
    watcher never sees a half-written file.
    """
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    src = Path(path)
    if not src.is_file():
        raise FileNotFoundError(path)
    stamp = f"{int(time.time() * 1000)}_{src.name}"
    staging = OUTBOX_DIR / f".{stamp}"
    final = OUTBOX_DIR / stamp
    shutil.copy2(src, staging)
    if caption:
        (OUTBOX_DIR / f"{stamp}.caption.txt").write_text(caption, encoding="utf-8")
    staging.rename(final)  # atomic on the same filesystem
    return final


async def _drain_outbox_once(bot, chat_ids: Iterable[int]):
    """Send every ready file in the outbox to each chat_id, then archive it."""
    if not OUTBOX_DIR.is_dir():
        return
    _SENT_DIR.mkdir(parents=True, exist_ok=True)
    chat_ids = list(chat_ids)
    for entry in sorted(OUTBOX_DIR.iterdir()):
        # Skip staging files, the archive dir, and caption sidecars.
        if entry.name.startswith(".") or entry.suffix == ".txt" and entry.name.endswith(".caption.txt"):
            continue
        if not entry.is_file():
            continue
        caption_file = OUTBOX_DIR / f"{entry.name}.caption.txt"
        caption = caption_file.read_text(encoding="utf-8") if caption_file.exists() else None
        for cid in chat_ids:
            try:
                await send_auto(bot, cid, str(entry), caption=caption)
            except Exception:  # noqa: BLE001 — never let one bad file kill the watcher
                log.exception("failed to send outbox file %s to %s", entry, cid)
        # Archive so it is not resent on the next tick.
        try:
            entry.rename(_SENT_DIR / entry.name)
            if caption_file.exists():
                caption_file.unlink()
        except OSError:
            log.exception("failed to archive outbox file %s", entry)


def start_outbox_watch(bot, chat_ids: Iterable[int], interval: float = 2.0) -> asyncio.Task:
    """
    Start a background task that polls the outbox every `interval` seconds and
    delivers anything found to `chat_ids`. Returns the asyncio.Task so the
    caller can cancel it on shutdown. Call this once after the bot is up.
    """
    chat_ids = list(chat_ids)
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)

    async def _loop():
        log.info("outbox watcher started: %s (every %ss)", OUTBOX_DIR, interval)
        while True:
            try:
                await _drain_outbox_once(bot, chat_ids)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("outbox watcher tick failed")
            await asyncio.sleep(interval)

    return asyncio.create_task(_loop())
