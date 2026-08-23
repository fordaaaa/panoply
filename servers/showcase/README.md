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
