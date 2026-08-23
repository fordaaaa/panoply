#!/bin/sh
set -e
Xvfb :99 -screen 0 1280x800x24 &
sleep 1
chromium --remote-debugging-address=0.0.0.0 --remote-debugging-port="${CDP_PORT:-9222}" \
  --no-sandbox --disable-gpu --no-first-run --user-data-dir=/tmp/chromium-profile \
  about:blank >/dev/null 2>&1 &
FFPID=""
ffmpeg -f x11grab -video_size 1280x800 -framerate "${FPS:-30}" -i :99 \
  -c:v libx264 -pix_fmt yuv420p "/exports/${LAB_OUTPUT}.mp4" >/dev/null 2>&1 &
FFPID=$!
trap 'kill -INT $FFPID; wait $FFPID' TERM INT
wait $FFPID
