# Footman Notifier

A Warcraft 2 Footman-themed desktop widget that announces what Claude Code is doing — with authentic WC2 voice lines.

A footman portrait sits in a corner of your screen, glowing with a golden aura while idle. When Claude starts working he calls out "At once, sire!", when it finishes you hear "Work complete!", and when Claude needs you he asks "My lord?" — with clickable answer buttons whose choice flows back to Claude. A supply-style counter under the portrait shows how many Claude Code sessions are open, at work, and awaiting orders.

## Project Structure

- `electron-app/` — the desktop widget (Electron, always-on-top, draggable)
- `mcp-server/` — MCP server exposing Footman tools to Claude Code
- `scripts/launch-footman.sh` — SessionStart hook script (auto-launch + session registration)
- `scripts/permission-prompt.mjs` — PermissionRequest hook (Allow/Deny buttons in the balloon)
- `scripts/ask-question-prompt.mjs` — PreToolUse hook for `AskUserQuestion` (renders Claude's questions as buttons, plus an "Other…" field for a custom answer)
- `assets/skins/` — one folder per skin: a portrait and its WC2 voice lines

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
            "command": "jq -c '{type:\"task_working\",message:\"Working\",sessionId:.session_id,cwd:.cwd}' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
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
            "command": "jq -c '{type:\"task_complete\",message:\"Work complete!\",sessionId:.session_id,cwd:.cwd}' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
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
            "command": "jq -c 'if .notification_type == \"permission_prompt\" then empty else {type:\"prompt\",message:(.message // \"My lord?\"),sessionId:.session_id,cwd:.cwd} end' | curl -s --max-time 2 -X POST http://localhost:6112/notify -H 'Content-Type: application/json' -d @- >/dev/null 2>&1 || true"
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
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "timeout": 300,
            "command": "/usr/local/bin/node /ABSOLUTE/PATH/TO/mask-ot/scripts/ask-question-prompt.mjs"
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
- **PermissionRequest** → shows the request in the balloon **literally** — the tool name and the exact request (the Bash command, file path, or URL; or the whole `tool_input` as JSON for other tools), shown in full with no truncation — and offers the **same choices Claude Code would**: **Allow**, **Deny**, and an **Always allow `<rule>`** button for each entry Claude provides in the payload's `permission_suggestions` (so you can approve once or remember the rule). The balloon grows upward to fit the message, so long commands are never cut off. This hook is **synchronous** — Claude Code waits for your click. If you don't answer within ~55 seconds, or the widget isn't running, the hook exits cleanly and Claude Code falls back to its own permission dialog. Replace `/ABSOLUTE/PATH/TO/mask-ot` with the real path to this repo.
- **PreToolUse** (`AskUserQuestion`) → renders Claude's own multiple-choice questions in the balloon, with each option as a clickable button plus an "Other…" field for typing a custom answer, and returns your pick (or typed text) as the tool's answer. Multi-select questions render as checkboxes with a `Confirm` button, and their answer is comma-joined the way Claude Code's own picker does it. Unlike a permission request, a question can't be answered by an Allow/Deny decision, so it needs this dedicated handler. Also **synchronous** — Claude Code waits for your answer. If you don't answer within ~5 minutes, the widget isn't running, or the question carries no options to click, it exits cleanly and Claude Code shows its native question picker. Replace `/ABSOLUTE/PATH/TO/mask-ot` with the real path to this repo. (The companion `permission-prompt.mjs` skips `AskUserQuestion` and `ExitPlanMode` for the same reason — they're questions, not permissions.)
- **SessionEnd** → removes the session from the counter

Every hook except **PermissionRequest** and **PreToolUse** is async with short timeouts and failure suppression — if the widget isn't running, Claude Code is unaffected. Those two are intentionally synchronous so they can return your decision (Allow/Deny, or a chosen answer), but both always degrade to the normal dialog when the widget is unavailable or you don't respond in time.

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
- **Working** — bobbing, always naming the project(s) at work ("Starting work on mask-ot…"), with animated `...`
- **Complete** — nod + voice line, with a plain written line naming the project that finished ("Work completed on mask-ot"); a caller that sends its own message keeps it. Returns to idle after 5s
- **Prompt** — alert pulse, question in the balloon, clickable answer buttons (checkboxes plus `Confirm` for multi-select); answering plays the skin's acknowledgement line and returns the choice to Claude
- **Permission request** — the tool that wants to run, then what it wants to run on. An MCP tool is shown as `server · operation` rather than `mcp__server__operation`, with a glyph tinted by what the tool can do. The detail is rendered as what it is: commands in a dark frame with a `$` gutter, file paths with the directories dimmed and the filename bold, URLs with the host emphasised, JSON with its keys coloured. Every detail has a click-to-copy button (which always copies the whole value, even when the view is folded), and anything over 8 lines folds behind a `⌄ N more lines` toggle
- **Error** — shake + message (voice line is still a placeholder)
- **Named sessions** — a session with a name (a named agent, or `FOOTMAN_SESSION_NAME`) is labelled `project · name`
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
  "multiSelect": "Only for prompt: render options as checkboxes; the answer comes back as an array",
  "kind": "Only for prompt: 'permission' to render as a tool request rather than prose",
  "detailKind": "Only for kind=permission: command | path | url | text | json — how to render the second line",
  "promptId": "Only for prompt: ID for answer polling",
  "sessionId": "Optional: ties the event to the session counter",
  "cwd": "Optional: the session's directory, used to label it by project name",
  "name": "Optional: who is working — shown as 'project · name'"
}
```

## Naming a session

Messages are labelled by project. When a name is also known they read
`project · name` — "Starting work on mask-ot · git-manager…" — so several agents in one
project stay apart. The project keeps its colour either way, so a named agent doesn't
fragment the accent you scan by.

A name can come from three places, in this order:

1. **The hook payload**, if it carries one — `agent_name`, `subagent_type`, `session_name`
   and a few other plausible keys are checked. None is documented today, so nothing is
   invented: with no name the label is the project alone, exactly as before.
2. **`FOOTMAN_SESSION_NAME`** in the environment, read by the hooks — name a shell, and
   every session started from it is labelled.
3. **The MCP tools**, via an optional `agent` argument on `footman_notify_working`,
   `footman_notify_complete`, `footman_notify_error` and `footman_prompt`. These calls
   carry no session id, so they also send their working directory and are labelled from
   that: a named subagent reports as `project · agent` instead of appearing unattributed.

Example:

```bash
curl -X POST http://localhost:6112/notify \
  -H 'Content-Type: application/json' \
  -d '{"type":"task_complete","message":"Work complete!"}'
```

## Skins

A skin is a portrait plus a set of voice lines. Three ship: **Footman** (default),
**Knight** and **Peasant**.

Pick one from the menu-bar icon under `Skin ▸`, and its size under `Size ▸` (1×, 2× or
3× — the window grows with the avatar, anchored to the corner it already sits in). Both
apply immediately and are saved to `footman.config.json` at the repo root, so they survive
a restart:

```json
{ "skin": "knight", "scale": 2 }
```

That file is gitignored; copy `footman.config.example.json` to start one by hand. Editing
it takes effect on the next launch — the tray menu is the live path.

`FOOTMAN_SKIN=peasant` and `FOOTMAN_SCALE=2` override the file for a one-off launch. While
one is set it wins at every startup, so the matching submenu is disabled and labelled
`(set by FOOTMAN_SKIN)` / `(set by FOOTMAN_SCALE)` rather than accepting a pick it can't
keep.

### Adding a skin

1. Drop a folder in `assets/skins/<id>/` with a portrait and the voice lines.
2. Add a block to `electron-app/src/skins.js`: the portrait filename and the line pools.
   `working` and `error` are sound-only; `ack` and `prompt` also carry the balloon text.
   `complete` keeps transcripts too, though the balloon currently writes plain wording for
   completions — they document what each clip says, which is what you need to correct one.
3. `npm test` in `electron-app/` checks every file you named actually exists.

Lines are picked at random within a pool; an optional `weight` makes one more likely. The
voice stays in character everywhere; the written status lines are deliberately plain, since
"I'm alive!" has personality but tells you nothing about which project just finished.

Portraits are cropped to fill a square frame (`object-fit: cover`), so every skin's avatar
is the same size regardless of the source image's shape.

## Troubleshooting

- **No sound** — Electron blocks autoplay without a user gesture by default; the app sets `autoplay-policy: no-user-gesture-required`, so if sounds are missing, check the paths resolve (`assets/skins/` is at the repo root, two levels above `electron-app/src/`).
- **Widget didn't auto-launch** — run `bash scripts/launch-footman.sh < /dev/null` manually and check `curl http://localhost:6112/health`.
- **Hooks not firing** — open `/hooks` in Claude Code to verify they loaded; a malformed `settings.json` silently disables all hooks.
- **Counter shows nothing** — it only learns about sessions from hook events; sessions appear as they next do something.
