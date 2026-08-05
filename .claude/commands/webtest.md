---
description: Drive a running local web app in a real browser, capture a screenshot/gif/video of it working, and deliver it to your phone via the claude-tele Telegram bot
argument-hint: "<url> [flow description] (e.g. http://localhost:3000 login as a new user)"
---

Drive a **running** local web app in a real Chromium browser using the
`browser-capture/` module, capture media of it working (default: a short **gif**
of a flow), and deliver that media to the user's phone through the existing
claude-tele Telegram bot's outbox hook. The capture module already exists — your
job is to point it at the app, script the flow, capture, and deliver; not to
rewrite the module.

Request: `$ARGUMENTS` — expect a URL, optionally followed by a description of the
flow to exercise (e.g. `http://localhost:3000 log in and open the dashboard`). If
no URL is given, ask for one and stop. If no flow is described, capture the app's
landing state.

## Prerequisites (check, don't assume)

1. **Playwright + Chromium.** If `browser-capture/.venv` doesn't exist, create it
   and install:
   ```bash
   cd browser-capture && python3 -m venv .venv && source .venv/bin/activate \
     && pip install -r requirements.txt && playwright install chromium
   ```
   `playwright install chromium` is a one-time ~100 MB download — run it on first
   use. `ffmpeg` is optional (nicer gif/video); the module degrades gracefully
   without it, so don't block on it.
2. **The web app must already be running** at the URL. This module does not start
   the app. If the URL is unreachable the capture errors clearly — start the app
   (e.g. `npm run dev`) first, or use the `run` skill to launch it.
3. **Delivery to phone requires the claude-tele bot running & configured** (see
   `/telegram`). If it isn't, you can still capture the media locally — say so and
   report the file path instead of claiming it was sent.

## Steps

1. **Parse** the URL and the flow description from `$ARGUMENTS`.
2. **Pick the media kind** — default **gif** (best for showing a flow). Use
   `video` if the user wants sound-length/longer detail, `screenshot` for a single
   state.
3. **Script the flow** as Playwright steps. Prefer the library form so you can
   pass an `actions(page)` callback that actually *uses* the app (click, fill,
   scroll, `wait_for_selector`) — a gif of the app being used beats one of it
   sitting idle. Keep it short (a few seconds).
4. **Capture + deliver in one call** via `capture_and_send`, e.g.:
   ```bash
   cd browser-capture && ./.venv/bin/python -c "
   import asyncio; from capture import capture_and_send
   async def flow(page):
       await page.click('text=Log in')
       await page.fill('#email', 'demo@example.com')
       await page.click('button[type=submit]')
       await page.wait_for_selector('#dashboard')
   asyncio.run(capture_and_send('http://localhost:3000', kind='gif',
              caption='login flow', actions=flow, duration=6))
   "
   ```
   Or, for a no-flow capture, the CLI: `./.venv/bin/python capture.py send-gif <url> --caption "..."`.
   `capture_and_send` captures, then calls `push_to_outbox(path, caption)` from
   `claude-tele/media.py`, which drops the file in `claude-tele/outbox/` for the
   running bot to deliver to every whitelisted user.
5. **Report** the captured file path and whether it was delivered (queued to the
   outbox) or only captured locally (bot not running). If the URL was unreachable,
   say so plainly and point at starting the app.

## Notes

- Headless by default; the module tears the browser down even on error and gives
  a clear message when the URL is unreachable (the app hasn't started).
- Don't touch bot internals beyond `push_to_outbox` — that's the whole contract.
  See `browser-capture/README.md` and `claude-tele/README.md` (Integration hook).
- The `outbox/` and `browser-capture/.venv|captures|videos` dirs are gitignored;
  don't commit captured media.
