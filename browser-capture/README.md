# browser-capture

Drive a real browser at a running web app, capture a **screenshot / gif / short
video** of it working, and (optionally) deliver that media to your phone through
the [`claude-tele`](../claude-tele/) Telegram bot.

This is the "drive the browser + capture media + hand it to the bot" half of a
loop where Claude Code builds a web app, then autonomously exercises it in a real
Chromium browser and shows you the result on your phone. The `/webtest` skill
(`.claude/commands/webtest.md`) is how Claude Code drives this module.

It uses [Playwright](https://playwright.dev/python/) (async API) and talks to the
bot only through the single documented hook `media.push_to_outbox` — no other bot
internals are imported.

## Requirements

- **Python 3.10+**
- **Playwright** + its Chromium browser
- **(optional) ffmpeg** on `PATH` — enables smoother video and higher-quality
  gifs. Without it, gif capture degrades gracefully to a Pillow-built frame
  sequence, and mp4 requests fall back to Playwright's native webm. Never a hard
  crash.
- For delivery-to-phone: the `claude-tele` bot set up **and running** (see
  [`../claude-tele/README.md`](../claude-tele/README.md)). Capture-only usage
  needs nothing from claude-tele.

## Install

```bash
cd browser-capture
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium        # one-time browser download (~100 MB)
# optional, for nicer gif/video:  brew install ffmpeg   (or your package manager)
```

## Usage — CLI

```bash
# a full-page screenshot
python capture.py screenshot http://localhost:3000 --out shot.png

# a ~6s video of the app (webm; mp4 if ffmpeg is present)
python capture.py video http://localhost:3000 --out clip.mp4 --duration 6

# a short animated gif of the flow
python capture.py gif http://localhost:3000 --caption "login flow"

# capture AND deliver to your phone via the claude-tele bot:
python capture.py send-gif http://localhost:3000 --caption "login flow"
python capture.py gif http://localhost:3000 --send        # equivalent
```

Useful flags: `--width/--height` (viewport, default 1280x800), `--wait-for
"<css-selector>"` (wait for an element before capturing), `--duration` (video/gif
seconds), `--fps` (gif), `--headed` (visible browser), `--no-full-page`
(screenshot: viewport only).

## Usage — library

```python
import asyncio
from capture import screenshot, record_video, record_gif, capture_and_send

async def flow(page):
    # optional: drive the app so the media shows it being USED, not just sitting
    await page.fill("#email", "me@example.com")
    await page.click("button[type=submit]")
    await page.wait_for_selector("#dashboard")

async def main():
    await screenshot("http://localhost:3000", "shot.png", wait_for="#app")
    await record_video("http://localhost:3000", "clip.mp4", actions=flow, duration=8)
    await record_gif("http://localhost:3000", "flow.gif", actions=flow, duration=6)
    # capture + deliver to the phone in one call:
    await capture_and_send("http://localhost:3000", kind="gif",
                           caption="login flow", actions=flow)

asyncio.run(main())
```

`actions` is any `async (page) -> None` callback; inside it you have the full
Playwright `Page` API (click, fill, scroll, `wait_for_selector`, …).

## How delivery to Telegram works

`capture_and_send(...)` (and the `send-*` / `--send` CLI forms) captures the media
then calls **`push_to_outbox(path, caption)`** from `../claude-tele/media.py`. That
function atomically drops the file into `claude-tele/outbox/`, where the running
bot's watcher picks it up (~every 2s) and sends it to every whitelisted Telegram
user, then archives it. This is fully decoupled:

- no Telegram bot object, event loop, or token is needed in this process;
- the module imports `media.py` **by path** (the repo layout is fixed:
  `<repo>/browser-capture/capture.py` ↔ `<repo>/claude-tele/media.py`) and uses
  only `push_to_outbox` — the documented integration surface;
- if `claude-tele/` isn't present you get a clear error, and pure capture still
  works. The **bot must actually be running** for the file to leave your machine —
  `push_to_outbox` only queues it.

## Robustness notes

- Headless by default; explicit navigation timeout (30s); browser + context are
  always torn down, even on error, so a failed capture never leaks a browser.
- Unreachable URL (the app under test hasn't started) → a clear, actionable
  error naming the URL, not a raw stack trace.
- Playwright records video per-context as **webm** and names the file itself; the
  module handles the temp-dir capture and rename to your requested path. mp4 is
  produced only when ffmpeg is available, otherwise the webm is kept (Telegram
  plays webm fine).

## Files

- `capture.py` — the library + CLI.
- `requirements.txt` — `playwright`, `Pillow` (Pillow powers the ffmpeg-free gif).
