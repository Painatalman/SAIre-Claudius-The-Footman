#!/bin/bash
# Footman SessionStart hook for Claude Code.
# Ensures the widget is running (launching it if needed), then registers
# the session with the session counter. Receives hook JSON on stdin.

INPUT=$(cat)

HEALTH_URL="http://localhost:6112/health"
NOTIFY_URL="http://localhost:6112/notify"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../electron-app" && pwd)"

if ! curl -s --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
  # ELECTRON_RUN_AS_NODE leaks in from Claude Code's environment and would
  # make Electron start as plain Node — strip it.
  (cd "$APP_DIR" && env -u ELECTRON_RUN_AS_NODE nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &)

  # Wait for the widget to come up (max ~15s)
  for _ in $(seq 1 30); do
    sleep 0.5
    if curl -s --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
      break
    fi
  done
fi

echo "$INPUT" | jq -c '{type:"session_start",sessionId:.session_id,cwd:.cwd}' |
  curl -s --max-time 2 -X POST "$NOTIFY_URL" -H 'Content-Type: application/json' -d @- >/dev/null 2>&1

exit 0
