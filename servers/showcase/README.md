# panoply-showcase

MCP server that records screen capture with ffmpeg (or exports clips from an
existing recording process) into a user-accessible folder. Zero dependencies;
hand-rolled stdio JSON-RPC 2.0.

## Tools

- `showcase_status` — recording state + where exports go
- `showcase_start_recording` — `{fps?}` start an ffmpeg x11grab/avfoundation capture
- `showcase_stop_recording` — stop and save with a timestamped name
- `showcase_export` — `{path, name?, move?}` copy/move a video into the exports folder
- `showcase_setup` — `{exports_dir}` pin the exports folder in `~/.panoply/showcase/config.json`

## Exports folder resolution

1. `exports_dir` from `~/.panoply/showcase/config.json` (written by `showcase_setup` or `npx panoply init`)
2. `~/Videos/panoply` if `~/Videos` exists
3. `./exports` relative to the current working directory

If no config exists at `initialize`, the server emits a logging notification
asking the user to run setup. Every tool result prints the absolute save path.

Requires ffmpeg on PATH (`sudo apt install ffmpeg`, `brew install ffmpeg`, …).

## Lab mode

Host screen capture depends on the desktop (X11 x11grab, macOS avfoundation,
Wayland recorders). Lab mode sidesteps that entirely: it runs a container
(Docker or Podman, detected in PATH) with a virtual X display (Xvfb), plain
chromium exposed over CDP on `http://localhost:9222`, and ffmpeg filming the
display. It records *the agent's browser*, never the user's desktop, and works
identically on X11, Wayland, or headless hosts.

Tools:

- `showcase_lab_start` `{fps?}` — build the image if needed, run the container
  (CDP port 9222 published; exports folder bind-mounted to `/exports`)
- `showcase_lab_stop` — SIGINTs ffmpeg to finalize the mp4, removes the
  container, returns the absolute video path
- `showcase_lab_status` — runtime, container state, CDP endpoint, output file

An agent connects any CDP-capable browser MCP (Playwright, browser-use, …) to
`http://localhost:9222` and drives the recorded chromium directly — no setup
inside the container needed. The container uses host networking, so the CDP
port must be free on the host; set `PANOPLY_SHOWCASE_CDP_PORT` to change it
(the server reports the effective endpoint on start/status).

Videos land in the exports folder as `<timestamp>-lab.mp4`. State persists in
`~/.panoply/showcase/lab.json`, so stop works across tool calls and server
restarts. Requires Docker or Podman installed (`sudo apt install podman`).
