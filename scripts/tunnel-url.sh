#!/bin/sh
# Prints the current Cloudflare quick-tunnel URL (changes every time the tunnel container restarts).
cd "$(dirname "$0")/.." || exit 1
docker compose --env-file .env.bs logs --no-log-prefix --no-color tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -n 1
