FROM debian:stable-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg chromium xvfb fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DISPLAY=:99
EXPOSE 9222

ENTRYPOINT ["/entrypoint.sh"]
