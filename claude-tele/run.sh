#!/usr/bin/env bash
# run.sh — recommended way to launch claude-tele.
#
# - Uses claude-tele/.venv if present (created during /telegram setup), else
#   whatever `python3` is on PATH.
# - On macOS, wraps the whole process in `caffeinate -dimsu` as a
#   belt-and-suspenders keep-awake, in addition to the child caffeinate the
#   bot spawns itself. Either alone is enough; both is harmless.
#
# Usage:  ./run.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ -x "$DIR/.venv/bin/python" ]]; then
  PY="$DIR/.venv/bin/python"
else
  PY="$(command -v python3 || command -v python)"
fi

if [[ ! -f "$DIR/config.json" ]]; then
  echo "config.json not found. Copy config.example.json to config.json and fill it in," >&2
  echo "or run the /telegram skill to set it up." >&2
  exit 1
fi

echo "Launching claude-tele with $PY"
if [[ "$(uname)" == "Darwin" ]] && command -v caffeinate >/dev/null 2>&1; then
  # -dimsu: prevent display/idle/disk sleep and system sleep while running.
  exec caffeinate -dimsu "$PY" "$DIR/bot.py"
else
  exec "$PY" "$DIR/bot.py"
fi
