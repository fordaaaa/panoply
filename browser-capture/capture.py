"""
capture.py — drive a real browser and capture media of a web app working.

This is the "drive the browser + capture media + hand to the bot" half of a
loop where Claude Code builds a web app, then autonomously exercises it in a
real Chromium browser and delivers a screenshot / gif / short video of it
working to the user's phone via the existing claude-tele Telegram bot.

It uses Playwright's **async** API and is usable two ways:

  * as a library:
        from capture import screenshot, record_video, record_gif, capture_and_send
        await capture_and_send("http://localhost:3000", kind="gif",
                               caption="login flow", actions=my_actions)

  * as a CLI:
        python capture.py screenshot http://localhost:3000 --out shot.png
        python capture.py video      http://localhost:3000 --duration 6
        python capture.py gif        http://localhost:3000 --caption "login flow"
        python capture.py send-gif   http://localhost:3000 --caption "login flow"

Design notes / robustness:
  * Headless by default; sane default viewport (1280x800); explicit timeouts.
  * The browser + context are always torn down (even on error) via
    `async with` / finally blocks, so a failed capture never leaks a browser.
  * A clear, actionable error is raised when the URL is unreachable — the most
    common failure, because the app under test often hasn't started yet.
  * Playwright cannot emit a gif directly. `record_gif` captures a sequence of
    periodic screenshots and assembles them with Pillow — no ffmpeg required.
    If ffmpeg IS present we instead record a video and transcode it (smoother
    result); if it's absent we degrade gracefully to the Pillow frame path.

Delivery to Telegram:
  `capture_and_send` calls `push_to_outbox` from the claude-tele bot's
  `media.py` (the documented, decoupled integration hook). We import that
  module by path — the repo layout is fixed: this file lives at
  `<repo>/browser-capture/capture.py` and the hook at `<repo>/claude-tele/media.py`.
  We do NOT import any other bot internals.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import logging
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Awaitable, Callable, Optional, Sequence

log = logging.getLogger("browser-capture")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_VIEWPORT = {"width": 1280, "height": 800}
# How long to wait for a navigation / the page to settle, in milliseconds.
DEFAULT_NAV_TIMEOUT_MS = 30_000
# Default length of a video/gif session, in seconds.
DEFAULT_DURATION_S = 6.0
# Frames-per-second for the gif frame-capture path.
DEFAULT_GIF_FPS = 5

# An `actions` callback drives the page. It receives the Playwright `Page` and
# may click/type/scroll/etc. to show the app actually being used.
Actions = Callable[["Page"], Awaitable[None]]  # noqa: F821 (Page is a runtime type)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class CaptureError(RuntimeError):
    """Raised for capture-layer failures with an actionable message."""


def _require_playwright():
    """Import the async Playwright API, or raise a clear install hint."""
    try:
        from playwright.async_api import async_playwright  # noqa: WPS433
        return async_playwright
    except ImportError as exc:  # pragma: no cover - depends on env
        raise CaptureError(
            "Playwright is not installed. From browser-capture/ run:\n"
            "    python3 -m venv .venv && source .venv/bin/activate\n"
            "    pip install -r requirements.txt\n"
            "    playwright install chromium"
        ) from exc


def _friendly_nav_error(url: str, exc: Exception) -> CaptureError:
    """Turn a raw Playwright navigation error into an actionable one."""
    msg = str(exc)
    hint = ""
    if "ERR_CONNECTION_REFUSED" in msg or "NS_ERROR_CONNECTION_REFUSED" in msg:
        hint = (
            f"\nNothing is listening at {url}. Is the web app actually running? "
            "Start it first (e.g. `npm run dev`) and confirm the port matches."
        )
    elif "ERR_NAME_NOT_RESOLVED" in msg:
        hint = f"\nThe host in {url} could not be resolved — check the URL."
    elif "Timeout" in msg or "timeout" in msg:
        hint = (
            f"\nTimed out loading {url}. The server may be slow to start or the "
            "page may never reach the requested load state."
        )
    return CaptureError(f"Failed to load {url}: {msg}{hint}")


# ---------------------------------------------------------------------------
# Chromium browser launch (async) — a small context manager helper.
# ---------------------------------------------------------------------------

class _Chromium:
    """
    Launch Chromium and yield a fresh browser context.

    Usage:
        async with _Chromium(viewport=..., record_video_dir=...) as (ctx, browser):
            page = await ctx.new_page()
            ...

    Guarantees the context and browser are closed even if the body raises, so
    a failed capture never leaks a browser process. Video files are only
    finalized by Playwright when the context is closed, so callers that record
    video must read the file AFTER the `async with` block exits.
    """

    def __init__(
        self,
        viewport: Optional[dict] = None,
        record_video_dir: Optional[Path] = None,
        headless: bool = True,
    ):
        self.viewport = viewport or DEFAULT_VIEWPORT
        self.record_video_dir = record_video_dir
        self.headless = headless
        self._pw = None
        self._pw_cm = None
        self.browser = None
        self.context = None

    async def __aenter__(self):
        async_playwright = _require_playwright()
        self._pw_cm = async_playwright()
        self._pw = await self._pw_cm.__aenter__()
        try:
            self.browser = await self._pw.chromium.launch(headless=self.headless)
        except Exception as exc:  # pragma: no cover - depends on env
            await self._pw_cm.__aexit__(type(exc), exc, exc.__traceback__)
            raise CaptureError(
                "Could not launch Chromium. Have you run `playwright install chromium`?\n"
                f"Underlying error: {exc}"
            ) from exc
        ctx_kwargs: dict = {"viewport": self.viewport}
        if self.record_video_dir is not None:
            self.record_video_dir.mkdir(parents=True, exist_ok=True)
            ctx_kwargs["record_video_dir"] = str(self.record_video_dir)
            ctx_kwargs["record_video_size"] = self.viewport
        self.context = await self.browser.new_context(**ctx_kwargs)
        self.context.set_default_navigation_timeout(DEFAULT_NAV_TIMEOUT_MS)
        self.context.set_default_timeout(DEFAULT_NAV_TIMEOUT_MS)
        return self.context, self.browser

    async def __aexit__(self, exc_type, exc, tb):
        # Close the context first (this is what finalizes any recorded video),
        # then the browser, then the Playwright driver — each guarded so one
        # failure doesn't mask the others or the original exception.
        for closer in (self.context, self.browser):
            if closer is not None:
                try:
                    await closer.close()
                except Exception:  # noqa: BLE001
                    log.debug("teardown: close failed", exc_info=True)
        if self._pw_cm is not None:
            try:
                await self._pw_cm.__aexit__(exc_type, exc, tb)
            except Exception:  # noqa: BLE001
                log.debug("teardown: playwright stop failed", exc_info=True)
        return False  # never suppress the original exception


async def _goto(page, url: str, wait_for: Optional[str] = None):
    """Navigate to `url`, raising a friendly error if it's unreachable."""
    try:
        await page.goto(url, wait_until="load")
    except Exception as exc:  # noqa: BLE001
        raise _friendly_nav_error(url, exc) from exc
    if wait_for:
        try:
            await page.wait_for_selector(wait_for)
        except Exception as exc:  # noqa: BLE001
            raise CaptureError(
                f"Loaded {url} but the selector {wait_for!r} never appeared: {exc}"
            ) from exc


# ---------------------------------------------------------------------------
# Public capture functions
# ---------------------------------------------------------------------------

async def screenshot(
    url: str,
    out_path: str,
    full_page: bool = True,
    viewport: Optional[dict] = None,
    wait_for: Optional[str] = None,
    actions: Optional[Actions] = None,
    headless: bool = True,
) -> Path:
    """
    Navigate to `url` and save a PNG screenshot to `out_path`.

    full_page : capture the whole scrollable page (True) or just the viewport.
    viewport  : {"width", "height"} override; defaults to 1280x800.
    wait_for  : optional CSS selector to wait for before shooting (lets you
                wait until a specific element of the app has rendered).
    actions   : optional async callback(page) run before the shot, so you can
                drive the app into the state you want to capture.
    headless  : run Chromium without a visible window (default True).
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    async with _Chromium(viewport=viewport, headless=headless) as (ctx, _browser):
        page = await ctx.new_page()
        await _goto(page, url, wait_for=wait_for)
        if actions is not None:
            await actions(page)
        await page.screenshot(path=str(out), full_page=full_page)
    log.info("screenshot saved: %s", out)
    return out


async def record_video(
    url: str,
    out_path: str,
    actions: Optional[Actions] = None,
    duration: float = DEFAULT_DURATION_S,
    viewport: Optional[dict] = None,
    wait_for: Optional[str] = None,
    headless: bool = True,
) -> Path:
    """
    Record a webm video of a browser session and save it to `out_path`.

    Playwright records video per-context into a directory (`record_video_dir`)
    and only writes the file when the context closes, with a name it chooses —
    so we record into a temp dir, then move the produced file to `out_path`.

    actions  : optional async callback(page) to exercise the app (click, type,
               scroll). If None, the page is simply left to sit for `duration`
               seconds. If given, we run the actions and still hold for the
               remainder of `duration` so short scripts still yield a clip.
    duration : minimum session length in seconds.

    Note: Playwright emits **webm**. If `out_path` ends in .mp4 and ffmpeg is
    available we transcode; otherwise we keep webm and log a note (Telegram
    plays webm fine as a video).
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="bc-video-") as tmp:
        tmp_dir = Path(tmp)
        video_path: Optional[Path] = None
        async with _Chromium(viewport=viewport, record_video_dir=tmp_dir, headless=headless) as (ctx, _b):
            page = await ctx.new_page()
            await _goto(page, url, wait_for=wait_for)
            start = asyncio.get_event_loop().time()
            if actions is not None:
                await actions(page)
            elapsed = asyncio.get_event_loop().time() - start
            remaining = duration - elapsed
            if remaining > 0:
                await page.wait_for_timeout(remaining * 1000)
            # Grab the handle now; the file is finalized on context close below.
            try:
                video_path = Path(await page.video.path()) if page.video else None
            except Exception:  # noqa: BLE001
                video_path = None
        # Context is closed here → the webm is fully written. Locate & move it.
        produced = video_path if (video_path and video_path.exists()) else None
        if produced is None:
            webms = sorted(tmp_dir.glob("*.webm"))
            produced = webms[0] if webms else None
        if produced is None or not produced.exists():
            raise CaptureError("Video recording produced no file.")

        if out.suffix.lower() == ".mp4" and shutil.which("ffmpeg"):
            _ffmpeg_transcode(produced, out)
        else:
            if out.suffix.lower() == ".mp4":
                out = out.with_suffix(".webm")
                log.info("ffmpeg not found — keeping webm at %s (Telegram plays webm)", out)
            shutil.move(str(produced), str(out))
    log.info("video saved: %s", out)
    return out


async def record_gif(
    url: str,
    out_path: str,
    actions: Optional[Actions] = None,
    duration: float = DEFAULT_DURATION_S,
    fps: int = DEFAULT_GIF_FPS,
    viewport: Optional[dict] = None,
    wait_for: Optional[str] = None,
    headless: bool = True,
) -> Path:
    """
    Capture a short session and produce an animated GIF at `out_path`.

    Two strategies, chosen by what's available (graceful degradation):

      * ffmpeg present  -> record a video (smooth) and transcode video->gif.
      * ffmpeg absent   -> capture a sequence of periodic screenshots and
                           assemble them into a gif with Pillow. No external
                           binary needed; slightly larger / lower-fidelity.

    Never hard-crashes when ffmpeg is missing.
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg"):
        log.info("ffmpeg found — recording video then transcoding to gif")
        with tempfile.TemporaryDirectory(prefix="bc-gif-") as tmp:
            webm = Path(tmp) / "session.webm"
            await record_video(
                url, str(webm), actions=actions, duration=duration,
                viewport=viewport, wait_for=wait_for, headless=headless,
            )
            # record_video may have kept .webm even though we asked for .webm.
            produced = webm if webm.exists() else next(Path(tmp).glob("*.webm"))
            _ffmpeg_video_to_gif(produced, out, fps=fps)
        log.info("gif saved (ffmpeg path): %s", out)
        return out

    log.info("ffmpeg not found — building gif from a screenshot sequence (Pillow)")
    await _frames_to_gif(
        url, out, actions=actions, duration=duration, fps=fps,
        viewport=viewport, wait_for=wait_for, headless=headless,
    )
    log.info("gif saved (frame-sequence path): %s", out)
    return out


# ---------------------------------------------------------------------------
# ffmpeg / Pillow helpers (all degrade gracefully)
# ---------------------------------------------------------------------------

def _run_ffmpeg(args: Sequence[str]) -> None:
    import subprocess

    cmd = ["ffmpeg", "-y", "-loglevel", "error", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)  # noqa: S603
    if proc.returncode != 0:
        raise CaptureError(f"ffmpeg failed: {proc.stderr.strip() or proc.returncode}")


def _ffmpeg_transcode(src: Path, dst: Path) -> None:
    """Transcode a video (e.g. webm) to `dst` (e.g. mp4) with ffmpeg."""
    _run_ffmpeg([
        "-i", str(src),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ])


def _ffmpeg_video_to_gif(src: Path, dst: Path, fps: int = DEFAULT_GIF_FPS) -> None:
    """Convert a video to a palette-optimized gif with ffmpeg."""
    # Two-pass palette for decent gif quality without exploding size.
    vf = f"fps={fps},scale=iw:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
    _run_ffmpeg(["-i", str(src), "-vf", vf, str(dst)])


async def _frames_to_gif(
    url: str,
    out: Path,
    actions: Optional[Actions],
    duration: float,
    fps: int,
    viewport: Optional[dict],
    wait_for: Optional[str],
    headless: bool = True,
) -> None:
    """
    ffmpeg-free gif path: drive the page while periodically snapshotting the
    viewport, then stitch the PNG frames into a gif with Pillow.

    The `actions` callback runs concurrently with frame capture so the gif
    shows the app being used. If it finishes early we keep snapshotting until
    `duration` elapses; if it runs long we stop at `duration`.
    """
    try:
        from PIL import Image  # noqa: WPS433
    except ImportError as exc:
        raise CaptureError(
            "Pillow is required for the ffmpeg-free gif path. "
            "pip install Pillow (it's in requirements.txt)."
        ) from exc

    interval = 1.0 / max(fps, 1)
    with tempfile.TemporaryDirectory(prefix="bc-frames-") as tmp:
        frames_dir = Path(tmp)
        frame_paths: list[Path] = []
        async with _Chromium(viewport=viewport, headless=headless) as (ctx, _b):
            page = await ctx.new_page()
            await _goto(page, url, wait_for=wait_for)

            stop = asyncio.Event()

            async def _drive():
                if actions is not None:
                    try:
                        await actions(page)
                    finally:
                        # Let capture keep running for the rest of duration.
                        pass

            async def _snap():
                loop = asyncio.get_event_loop()
                start = loop.time()
                i = 0
                while (loop.time() - start) < duration and not stop.is_set():
                    fp = frames_dir / f"frame_{i:04d}.png"
                    try:
                        await page.screenshot(path=str(fp), full_page=False)
                        frame_paths.append(fp)
                        i += 1
                    except Exception:  # noqa: BLE001
                        # Page may be mid-navigation; skip this frame.
                        log.debug("frame capture skipped", exc_info=True)
                    await asyncio.sleep(interval)

            # Run the driver and the snapshotter together.
            driver = asyncio.create_task(_drive())
            snapper = asyncio.create_task(_snap())
            await snapper           # bounded by `duration`
            stop.set()
            if not driver.done():
                driver.cancel()
            try:
                await driver
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        if not frame_paths:
            raise CaptureError("No frames were captured for the gif.")

        images = [Image.open(p).convert("P", palette=Image.ADAPTIVE) for p in frame_paths]
        duration_ms = int(interval * 1000)
        images[0].save(
            out,
            save_all=True,
            append_images=images[1:],
            duration=duration_ms,
            loop=0,
            optimize=True,
            disposal=2,
        )


# ---------------------------------------------------------------------------
# Telegram delivery via the claude-tele media hook
# ---------------------------------------------------------------------------

def _load_media_hook():
    """
    Import `push_to_outbox` from the claude-tele bot's media.py by path.

    Repo layout is fixed: this file is <repo>/browser-capture/capture.py and
    the hook lives at <repo>/claude-tele/media.py. We import that file directly
    (not the whole bot) so we depend only on the documented integration surface.
    """
    media_path = Path(__file__).resolve().parent.parent / "claude-tele" / "media.py"
    if not media_path.is_file():
        raise CaptureError(
            f"claude-tele media hook not found at {media_path}. "
            "The claude-tele bot must be present in this repo to deliver media. "
            "See claude-tele/README.md (Integration hook)."
        )
    spec = importlib.util.spec_from_file_location("claude_tele_media", media_path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise CaptureError(f"Could not load media hook from {media_path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "push_to_outbox"):
        raise CaptureError(
            f"{media_path} has no push_to_outbox() — the integration hook changed. "
            "Update capture.py to match claude-tele/media.py."
        )
    return module.push_to_outbox


async def capture_and_send(
    url: str,
    kind: str = "gif",
    out_path: Optional[str] = None,
    caption: Optional[str] = None,
    actions: Optional[Actions] = None,
    duration: float = DEFAULT_DURATION_S,
    viewport: Optional[dict] = None,
    wait_for: Optional[str] = None,
    full_page: bool = True,
    headless: bool = True,
) -> Path:
    """
    Capture media of `url` and deliver it to the user's phone via the running
    claude-tele Telegram bot.

    kind : "gif" (default), "video", or "screenshot".

    Captures the media, then calls the bot's `push_to_outbox(path, caption)` —
    which atomically drops the file into claude-tele/outbox/ where the running
    bot's watcher picks it up and sends it to every whitelisted user. This is
    fully decoupled: no bot object, no event loop sharing, no token needed here.
    The bot must be running for delivery to actually happen.

    Returns the captured file path (delivery is async on the bot's side).
    """
    kind = kind.lower()
    captures_dir = Path(__file__).resolve().parent / "captures"
    if out_path is None:
        ext = {"gif": ".gif", "video": ".mp4", "screenshot": ".png"}.get(kind, ".bin")
        captures_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(captures_dir / f"capture_{int(asyncio.get_event_loop().time()*1000)}{ext}")

    if kind == "screenshot":
        path = await screenshot(
            url, out_path, full_page=full_page, viewport=viewport,
            wait_for=wait_for, actions=actions, headless=headless,
        )
    elif kind == "video":
        path = await record_video(
            url, out_path, actions=actions, duration=duration,
            viewport=viewport, wait_for=wait_for, headless=headless,
        )
    elif kind == "gif":
        path = await record_gif(
            url, out_path, actions=actions, duration=duration,
            viewport=viewport, wait_for=wait_for, headless=headless,
        )
    else:
        raise CaptureError(f"Unknown kind {kind!r}; expected gif|video|screenshot.")

    # Resolve the hook late (only when we actually have something to deliver),
    # so pure capture works even if claude-tele isn't set up.
    push_to_outbox = _load_media_hook()
    queued = push_to_outbox(str(path), caption)
    log.info("queued for Telegram delivery via outbox: %s", queued)
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="capture.py",
        description="Drive a browser and capture a screenshot/gif/video of a web app, "
                    "optionally delivering it to Telegram via the claude-tele bot.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def _common(sp):
        sp.add_argument("url", help="URL to open, e.g. http://localhost:3000")
        sp.add_argument("--out", help="output file path (a sensible default is chosen)")
        sp.add_argument("--caption", help="caption sent with the media to Telegram")
        sp.add_argument("--width", type=int, default=DEFAULT_VIEWPORT["width"])
        sp.add_argument("--height", type=int, default=DEFAULT_VIEWPORT["height"])
        sp.add_argument("--wait-for", help="CSS selector to wait for before capturing")
        sp.add_argument("--headed", action="store_true",
                        help="run with a visible browser window (default: headless)")
        sp.add_argument("--send", action="store_true",
                        help="deliver the result to Telegram via the outbox hook")

    for name in ("screenshot", "video", "gif"):
        sp = sub.add_parser(name, help=f"capture a {name}")
        _common(sp)
        if name != "screenshot":
            sp.add_argument("--duration", type=float, default=DEFAULT_DURATION_S,
                            help="session length in seconds")
        if name == "gif":
            sp.add_argument("--fps", type=int, default=DEFAULT_GIF_FPS)
        if name == "screenshot":
            sp.add_argument("--no-full-page", action="store_true",
                            help="capture only the viewport, not the whole page")

    # Convenience aliases that always send.
    for name in ("send-screenshot", "send-video", "send-gif"):
        sp = sub.add_parser(name, help=f"capture a {name.split('-')[1]} and send to Telegram")
        _common(sp)
        if "screenshot" not in name:
            sp.add_argument("--duration", type=float, default=DEFAULT_DURATION_S)
        if "gif" in name:
            sp.add_argument("--fps", type=int, default=DEFAULT_GIF_FPS)
    return p


def _dispatch(args) -> Path:
    viewport = {"width": args.width, "height": args.height}
    kind = args.cmd.replace("send-", "")
    send = getattr(args, "send", False) or args.cmd.startswith("send-")
    headless = not args.headed

    async def _run() -> Path:
        if send:
            return await capture_and_send(
                args.url, kind=kind, out_path=args.out, caption=args.caption,
                duration=getattr(args, "duration", DEFAULT_DURATION_S),
                viewport=viewport, wait_for=args.wait_for,
                full_page=not getattr(args, "no_full_page", False),
                headless=headless,
            )
        out = args.out
        if kind == "screenshot":
            if out is None:
                out = "screenshot.png"
            return await screenshot(
                args.url, out, full_page=not getattr(args, "no_full_page", False),
                viewport=viewport, wait_for=args.wait_for, headless=headless,
            )
        if kind == "video":
            if out is None:
                out = "video.mp4"
            return await record_video(
                args.url, out, duration=args.duration, viewport=viewport,
                wait_for=args.wait_for, headless=headless,
            )
        if kind == "gif":
            if out is None:
                out = "capture.gif"
            return await record_gif(
                args.url, out, duration=args.duration, fps=getattr(args, "fps", DEFAULT_GIF_FPS),
                viewport=viewport, wait_for=args.wait_for, headless=headless,
            )
        raise CaptureError(f"Unknown command {args.cmd!r}")

    return asyncio.run(_run())


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        path = _dispatch(args)
    except CaptureError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"captured: {path}")
    if getattr(args, "send", False) or args.cmd.startswith("send-"):
        print("queued for Telegram delivery (the claude-tele bot must be running).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
