# webtest — drive a web app in a browser, capture media, deliver to your phone

Portable version of Claude Code's `/webtest` command. Paste this into any coding
agent that can read/write files and run shell commands, in a checkout of this
repo. Replace `{{URL}}` with the running app's URL and `{{FLOW}}` with an optional
description of the flow to exercise (leave `{{FLOW}}` blank to just capture the
landing state).

Drive the **running** local web app at `{{URL}}` in a real Chromium browser using
the `browser-capture/` module, capture media of it working (default: a short
**gif** of the flow), and deliver that media to the user's phone through the
claude-tele Telegram bot's outbox hook. The capture module already exists in
`browser-capture/` — point it at the app and script the flow; don't rewrite it.

Flow to exercise: `{{FLOW}}`

## Prerequisites (check, don't assume)

1. **Playwright + Chromium.** If `browser-capture/.venv` is missing, create it and
   install:
   ```bash
   cd browser-capture && python3 -m venv .venv && source .venv/bin/activate \
     && pip install -r requirements.txt && playwright install chromium
   ```
   `playwright install chromium` is a one-time ~100 MB download. `ffmpeg` is
   optional (nicer gif/video) — the module degrades gracefully without it, so
   don't block on it.
2. **The app must already be running** at `{{URL}}`. This module does not start
   the app; if the URL is unreachable the capture errors clearly — start the app
   (e.g. `npm run dev`) first.
3. **Delivery to phone needs the claude-tele bot running & configured** (see
   `prompts/telegram.md`). If it isn't, you can still capture locally — say so and
   report the file path rather than claiming it was sent.

## Steps

1. **Pick the media kind** — default **gif** (best for a flow); `video` for longer
   detail, `screenshot` for a single state.
2. **Script the flow** as Playwright steps in an `actions(page)` callback that
   actually *uses* the app (click, fill, scroll, `wait_for_selector`) so the media
   shows it being used, not idle. Keep it a few seconds.
3. **Capture + deliver in one call** via `capture_and_send`:
   ```bash
   cd browser-capture && ./.venv/bin/python -c "
   import asyncio; from capture import capture_and_send
   async def flow(page):
       await page.click('text=Log in')
       await page.fill('#email', 'demo@example.com')
       await page.click('button[type=submit]')
       await page.wait_for_selector('#dashboard')
   asyncio.run(capture_and_send('{{URL}}', kind='gif',
              caption='{{FLOW}}', actions=flow, duration=6))
   "
   ```
   For a no-flow capture, use the CLI: `./.venv/bin/python capture.py send-gif {{URL}} --caption "..."`.
   `capture_and_send` captures, then calls `push_to_outbox(path, caption)` from
   `claude-tele/media.py`, which drops the file in `claude-tele/outbox/` for the
   running bot to deliver to every whitelisted user.
4. **Report** the captured file path and whether it was delivered (queued to the
   outbox) or only captured locally (bot not running). If `{{URL}}` was
   unreachable, say so plainly and point at starting the app.

## Notes

- Headless by default; the browser is torn down even on error, with a clear
  message when the URL is unreachable (the app hasn't started).
- Don't touch bot internals beyond `push_to_outbox` — that's the whole contract.
  See `browser-capture/README.md` and `claude-tele/README.md` (Integration hook).
- The `outbox/` and `browser-capture/.venv|captures|videos` dirs are gitignored;
  don't commit captured media.
