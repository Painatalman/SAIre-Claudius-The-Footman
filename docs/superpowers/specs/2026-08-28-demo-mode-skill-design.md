# Demo mode: a guided tour of the widget for an audience

**Date:** 2026-08-28
**Status:** Drafted, not implemented

## Problem

There is no way to show someone what the widget does. Its whole vocabulary — five
characters, six notification types, two flavours of interactive prompt, the multi-session
counter — only appears in response to real Claude Code activity, on someone else's
schedule. Demoing it today means hand-writing `curl` calls at 6112 and hoping the right
thing fires while the audience is looking.

Worse, the two most interesting things to show are the interactive prompts, and those are
the hardest to fire by hand: the widget dismisses a prompt roughly three seconds after it
appears unless something keeps polling for its answer. A `curl` that posts a prompt and
exits produces a balloon that vanishes before anyone reads it.

## Scope

A **project skill** that runs a scripted, act-by-act demo against the already-running
widget: `mask-ot-demo-mode-by-costa`. It fires real notifications through the real HTTP
API — nothing is mocked, the audience sees the actual product.

Out of scope:

- **Automating skin changes.** A skin can only be changed by clicking `Skin ▸` in the tray;
  there is no HTTP or IPC path in from outside. Adding one was considered and rejected for
  this change — the demo asks the presenter to click instead. See *Skin parade* below.
- Any change to `electron-app/`, `mcp-server/` or `scripts/`. The demo is pure orchestration
  on top of what ships today.
- Recording, screen capture, or packaging the demo for people without the repo.

## 1. Where the skill lives

```
.claude/skills/mask-ot-demo-mode-by-costa/
  SKILL.md            the acts, the narration, the pacing
  scripts/demo.mjs    payload builders + the prompt heartbeat
  scripts/demo.test.mjs
```

`.claude/skills/` is where Claude Code natively looks for a project's own skills, so a
clone gets the demo with no install step. That needs the gitignore narrowed:

```diff
-.claude/
+.claude/settings.local.json
```

`.claude/` currently holds nothing but `settings.local.json`, so this tracks the skill and
keeps the machine-local settings out. The cost is that anything Claude Code writes into
`.claude/` in future is tracked by default rather than ignored by default — worth a glance
at `git status` before committing after a session.

## 2. The acts

The demo is a sequence of acts. Claude runs one, says in a line what the audience should be
looking at, and waits for the presenter to say "next" before the following one. Nothing
autoplays: a demo that runs ahead of the person talking over it is useless.

| # | Act | What fires | What the audience sees |
|---|---|---|---|
| 0 | Preflight | `GET /health` | nothing — the demo refuses to start against a dead widget |
| 1 | A session checks in | `session_start` | the counter appears, one session idle |
| 2 | Work begins | `task_working` | an `action-` voice line, "Starting work on mask-ot" |
| 3 | A crowd | two more `session_start` + `task_working` | "Working on `a`, `b`…", one colour per project |
| 4 | A question | `prompt` with `options` | `question-` voice, clickable answer buttons |
| 5 | A question, multi-pick | `prompt` with `multiSelect: true` | checkboxes plus `Confirm` |
| 6 | A permission request | `prompt`, `kind: 'permission'` | the tool name and the literal command, Allow / Always allow `<rule>` / Deny |
| 7 | Work completes | `task_complete` | a `completed-` line, "Work completed on mask-ot" |
| 8 | Something breaks | `error` | the error voice, the caller's message in red |
| 9 | Skin parade | see below | each of the five characters, in turn |
| 10 | Teardown | `session_end` ×3 | the counter empties |

Acts 4–6 are the ones worth rehearsing: they are the only ones where the audience can walk
up and click.

### Skin parade

The presenter clicks `Skin ▸ <character>` in the menu bar; the widget hot-swaps portrait
and voice in place, no restart. The skill then replays a short `task_working` →
`task_complete` → `prompt` triple so the new character is heard on all three of its pools,
and waits before naming the next one. Five passes: Footman, Knight, Peasant, Peon, Goblin
Sapper.

The skill records which skin was active at the start and, at teardown, reminds the presenter
to set it back — a tray pick writes `footman.config.json`, so the last character of the
parade would otherwise become their permanent one.

## 3. Keeping a prompt on screen

This is the part that cannot be done with `curl`, and the reason the skill ships a script.

A prompt stays up only while something is polling `GET /response/:id`. Each poll refreshes a
heartbeat; the widget polls `GET /prompts/active` once a second and removes any prompt whose
heartbeat has gone stale — 2.5s to go stale, with a 3s grace from when it was shown.

So `scripts/demo.mjs` posts the prompt and then keeps polling on a ~1s interval until one of:

- the presenter clicks an answer — the poll returns `{ choice }`, which the demo reports and
  then discards. **The demo never acts on the answer**; it is a display, not a real request.
- the act is dismissed by the presenter moving on, at which point the poll stops and the
  widget cleans the prompt up on its own.
- a ceiling of 5 minutes, matching the real hooks' timeout.

Every prompt gets a fresh `randomUUID()` for its `promptId`, exactly as the hooks do.

## 4. Leaving no trace

The demo fabricates sessions, and those sessions live in the widget's counter until they are
ended or six hours pass. Rules:

- Every fabricated `sessionId` is prefixed `demo-`, so a stray one is recognisable.
- Teardown sends `session_end` for each. If the demo is interrupted, re-running it ends any
  `demo-` session it finds first.
- The demo never writes `footman.config.json`. The only thing that changes it is the
  presenter's own tray clicks.
- The demo never posts to `POST /response/:id`. Answering on the audience's behalf would
  defeat the act.

## 5. Failure modes

| failure | behaviour |
|---|---|
| widget not running | the demo stops at act 0 and tells the presenter to launch it — it does not launch it itself, since a launch takes ~5s and would strand the audience watching a terminal |
| widget running but `widget: false` in `/health` | same — the window is gone, only the server survives |
| a prompt vanishes early | the heartbeat died; the demo says so rather than silently continuing |
| nobody clicks a prompt | after 5 minutes the act ends and the demo moves on |
| a skin has a missing file | the balloon text still shows, the clip is silently skipped — the existing `.play().catch()` |
| presenter picks a skin mid-act | harmless; the swap is live and the next line comes out in the new voice |

## 6. Testing

`scripts/demo.test.mjs` under `node --test`, mirroring how `scripts/` is already tested:

- every act builds a payload the server will accept — the required fields per `type`
- permission acts pack `message` as `"<tool>\n<detail>"`, the shape the widget unpacks
- multi-select acts set `multiSelect`, single-select acts do not
- `demo-` prefix on every fabricated session id
- teardown ends every session the run created

A `--dry-run` flag prints each act's payload without posting, so the sequence can be checked
without a widget. The live path stays a manual check: run it, watch it, listen to it.

## 7. Open questions

- **Does the parade need all five characters every time?** Five passes of three lines is a
  long time to stand still. A `--skins=peon,knight` argument would let a short demo pick two.
- **Is act 3 (the crowd) worth its complexity?** It is the least self-explanatory moment and
  needs the most narration, but it is also the only place the colour-coding makes sense.
