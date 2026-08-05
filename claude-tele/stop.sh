#!/usr/bin/env bash
# stop.sh — THE definitive stop for claude-tele.
#
# Reads claude-tele.pid, sends SIGTERM (which the bot traps → graceful cleanup:
# stops caffeinate, stops the outbox watcher, removes the pidfile), waits, then
# escalates to SIGKILL if it's still alive. Finally sweeps any orphaned
# caffeinate the bot may have spawned and removes a stale pidfile.
#
# Usage:  ./stop.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$DIR/claude-tele.pid"

alive() { kill -0 "$1" 2>/dev/null; }

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE" 2>/dev/null || true)"
else
  PID=""
fi

if [[ -z "${PID:-}" ]] || ! [[ "$PID" =~ ^[0-9]+$ ]]; then
  echo "No valid pidfile at $PIDFILE. Falling back to pattern kill."
  if pgrep -f "[b]ot.py" >/dev/null 2>&1; then
    echo "Found bot.py processes; sending SIGTERM."
    pkill -f "[b]ot.py" || true
  else
    echo "No running claude-tele found."
  fi
else
  if alive "$PID"; then
    echo "Stopping claude-tele (pid $PID) with SIGTERM…"
    kill -TERM "$PID" 2>/dev/null || true
    # Wait up to ~8s for graceful shutdown.
    for _ in 1 2 3 4 5 6 7 8; do
      alive "$PID" || break
      sleep 1
    done
    if alive "$PID"; then
      echo "Still alive after SIGTERM — escalating to SIGKILL."
      kill -KILL "$PID" 2>/dev/null || true
      sleep 1
    fi
    if alive "$PID"; then
      echo "ERROR: pid $PID is STILL alive. Kill it manually: kill -9 $PID" >&2
      exit 1
    fi
    echo "claude-tele (pid $PID) is stopped."
  else
    echo "Pidfile present but pid $PID is not running (stale)."
  fi
fi

# The bot terminates its own caffeinate child on clean shutdown, but sweep any
# orphan just in case (e.g. after a SIGKILL). Best-effort; harmless if none.
if pgrep -f "caffeinate -dimsu" >/dev/null 2>&1; then
  echo "Sweeping orphaned 'caffeinate -dimsu'…"
  pkill -f "caffeinate -dimsu" || true
fi

# Remove the pidfile so the next start has a clean slate.
rm -f "$PIDFILE"
echo "Done. Pidfile removed."
