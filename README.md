# Footman Notifier

A Warcraft 2 Footman-themed desktop widget that announces what Claude Code is doing — with authentic WC2 voice lines.

A footman portrait sits in a corner of your screen, glowing with a golden aura while idle. When Claude starts working he calls out "At once, sire!", when it finishes you hear "Work complete!", and when Claude needs you he asks "My lord?" — with clickable answer buttons whose choice flows back to Claude. A supply-style counter under the portrait shows how many Claude Code sessions are open, at work, and awaiting orders.

## Project Structure

- `electron-app/` — the desktop widget (Electron, always-on-top, draggable)
- `mcp-server/` — MCP server exposing Footman tools to Claude Code
- `scripts/launch-footman.sh` — SessionStart hook script (auto-launch + session registration)
- `assets/` — portrait sprite and WC2 voice lines (MP3)

## Requirements

- macOS (tested) — Linux should work with minor tweaks
- Node.js 18+
- `jq` and `curl` on your PATH (used by the Claude Code hooks)
- Claude Code

## Setup

### 1. Install dependencies

```bash
cd electron-app && npm install
cd ../mcp-server && npm install
```

### 2. Register the MCP server

Add the Footman MCP server to Claude Code (adjust the path to your checkout):

```bash
claude mcp add --scope user footman -- node /path/to/mask-ot/mcp-server/index.js
```

Or add it manually to your MCP config:

```json
{
  "mcpServers": {
    "footman": {
      "command": "node",
      "args": ["/path/to/mask-ot/mcp-server/index.js"]
    }
  }
}
```

This gives Claude four tools:

| Tool | Effect |
| --- | --- |
| `footman_notify_working` | Working state + "At once, sire!" |
| `footman_notify_complete` | Completion nod + "Work complete!" |
| `footman_notify_error` | Shake + error message |
| `footman_prompt` | Question with clickable answer buttons + "My lord?" — blocks up to 5 minutes and returns the clicked choice to Claude |

### 3. Wire up the hooks (automatic notifications)

The MCP tools only fire when Claude chooses to call them. For deterministic notifications on every session, add these hooks to `~/.claude/settings.json` (merge into your existing `hooks` object, adjust paths):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "async": true,
            "timeout": 30,
            "command": "bash /path/to/mask-ot/scripts/launch-footman.sh >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "async": true,
            "timeout": 5,
            "command": "jq -c '{type:\"task_working\",message:\"Working\",sessionId:.session_id}' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "async": true,
            "timeout": 5,
            "command": "jq -c '{type:\"task_complete\",message:\"Work complete!\",sessionId:.session_id}' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "async": true,
            "timeout": 5,
            "command": "jq -c 'if .notification_type == \"permission_prompt\" then empty else {type:\"prompt\",message:(.message // \"My lord?\"),sessionId:.session_id} end' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "timeout": 60,
            "command": "/usr/local/bin/node /ABSOLUTE/PATH/TO/mask-ot/scripts/permission-prompt.mjs"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "async": true,
            "timeout": 5,
            "command": "jq -c '{type:\"session_end\",sessionId:.session_id}' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

What each hook does:

- **SessionStart** → runs `launch-footman.sh`: starts the widget if it isn't running, then registers the session with the counter
- **UserPromptSubmit** → working state ("At once, sire!", animated ellipsis)
- **Stop** → completion ("Work complete!")
- **Notification** → prompt state with the notification text ("My lord?") — fires on idle nudges. Permission notifications are skipped here so they don't clobber the Allow/Deny buttons; those are handled by **PermissionRequest** below
- **PermissionRequest** → shows the request in the balloon **literally** — the tool name and the exact request (the Bash command, file path, or URL; or the whole `tool_input` as JSON for other tools), shown in full with no truncation — and offers **Allow** and **Deny** buttons. Clicking Allow lets the tool run; clicking Deny blocks it. The balloon grows upward to fit the message, so long commands are never cut off. This hook is **synchronous** — Claude Code waits for your click. If you don't answer within ~55 seconds, or the widget isn't running, the hook exits cleanly and Claude Code falls back to its own permission dialog. Replace `/ABSOLUTE/PATH/TO/mask-ot` with the real path to this repo.
- **SessionEnd** → removes the session from the counter

Every hook except **PermissionRequest** is async with short timeouts and failure suppression — if the widget isn't running, Claude Code is unaffected. PermissionRequest is intentionally synchronous so it can return your Allow/Deny decision, but it always degrades to the normal dialog when the widget is unavailable or you don't respond in time.

### 4. Restart Claude Code

Restart (or open `/hooks` once to reload settings, and `/mcp` to reconnect the server). The widget launches automatically on your next session.

## Running the widget manually

```bash
cd electron-app
env -u ELECTRON_RUN_AS_NODE npm start
```

> **Note:** when launching from inside a Claude Code or VSCode terminal, `ELECTRON_RUN_AS_NODE` leaks into the environment and makes Electron start as plain Node, crashing with `Cannot read properties of undefined (reading 'getPath')`. The `env -u` prefix (already handled by the launch script) strips it.

For development with DevTools and mock notifications:

```bash
npm run dev
```

## Widget behavior

- **Draggable** — grab the portrait and place it anywhere; position persists between launches
- **Bottom-anchored** — the balloon grows upward, so the widget works best in a bottom corner
- **Idle** — breathing + pulsing golden aura, with an occasional fidget every ~25s
- **Working** — bobbing, task text with animated `...`
- **Complete** — nod + voice line, returns to idle after 5s
- **Prompt** — alert pulse, question in the balloon, clickable answer buttons; choice plays "As you wish!" and returns to Claude
- **Error** — shake + message (voice line is still a placeholder)
- **Session counter** — `⚔ N · 💤 M` under the portrait: sessions at work / awaiting orders; hover for details; stale sessions pruned after 6h

## HTTP API

The widget listens on `http://localhost:6112`:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | `{"status":"ok","widget":true}` when ready |
| `POST /notify` | Show a notification (see body below) |
| `GET /response/:id` | Poll a prompt answer — `{"choice":"..."}` once clicked, 404 while pending |
| `POST /response/:id` | Store an answer manually (testing) |

`POST /notify` body:

```json
{
  "type": "task_working | task_complete | prompt | error | session_start | session_end",
  "message": "Balloon text (not used for session_* types)",
  "options": ["Only for prompt: clickable choices"],
  "promptId": "Only for prompt: ID for answer polling",
  "sessionId": "Optional: ties the event to the session counter"
}
```

Example:

```bash
curl -X POST http://localhost:6112/notify \
  -H 'Content-Type: application/json' \
  -d '{"type":"task_complete","message":"Work complete!"}'
```

## Sounds

WC2 voice lines live in `assets/sounds/`. Currently wired:

- `at-once-sire.mp3` — working starts
- `work-completed.mp3` — task complete
- `my-lord.mp3` — prompt (and error, as a placeholder)
- `as-you-wish.mp3` — prompt answer clicked

Six more voice lines are present and available for future states.

## Troubleshooting

- **No sound** — Electron blocks autoplay without a user gesture by default; the app sets `autoplay-policy: no-user-gesture-required`, so if sounds are missing, check the paths resolve (`assets/` is at the repo root, two levels above `electron-app/src/`).
- **Widget didn't auto-launch** — run `bash scripts/launch-footman.sh < /dev/null` manually and check `curl http://localhost:6112/health`.
- **Hooks not firing** — open `/hooks` in Claude Code to verify they loaded; a malformed `settings.json` silently disables all hooks.
- **Counter shows nothing** — it only learns about sessions from hook events; sessions appear as they next do something.
