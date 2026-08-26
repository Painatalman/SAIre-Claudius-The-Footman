# Skins: swappable character voices + portrait

**Date:** 2026-08-26
**Status:** Approved, ready to implement

## Problem

The widget is hardcoded to one character. The portrait path (`assets/sprites/footman.jpg`),
the sound files, and the balloon text all live as literals in `renderer.js`. Two new
character sets exist on disk (Knight/Paladin and Peasant), each with a portrait and voice
lines for the same three moments the Footman covers, but there is no way to select one.

## Scope

A skin is **a portrait plus a set of voice lines**. Nothing else — not the tray icon, not
the balloon styling, not the window title. Three skins ship: `footman` (unchanged
behaviour), `knight`, `peasant`.

## 1. Asset layout

```
assets/skins/
  footman/   portrait.jpg   + the 10 existing .mp3 files (names unchanged)
  knight/    portrait.webp  + 19 .wav  (action- 8, completed- 5, question- 6)
  peasant/   portrait.webp  + 16 .wav  (action- 7, completed- 5, question- 4)
```

- `git mv` for the tracked Footman assets; plain `mv` for the two untracked new dirs.
- `assets/sprites/` keeps `helmetTemplate.png` / `helmetTemplate@2x.png` — the macOS tray
  icon is not skin content and does not change with the skin.
- `peasant/question-mlord.wav` is dropped: byte-identical to `question-milord.wav`
  (md5 `0f6adb7cfb5df028e512b442b79abb16`).
- `assets/sounds/README.md` moves to `assets/skins/footman/README.md`.
- `assets/sprites/footman.svg` is referenced nowhere in the code and stays put.

Three Footman sounds are on disk but unreferenced today (`awaiting-orders.mp3`,
`yes-sire.mp3`, `your-orders.mp3`). They move with the rest and stay unreferenced — this
change preserves Footman behaviour exactly, it does not extend it.

## 2. Skin selection

`footman.config.json` at the repo root is the persisted choice:

```json
{ "skin": "knight" }
```

Startup resolution in `main.js`: `process.env.FOOTMAN_SKIN` → config file → `"footman"`.
An unknown id logs a warning and falls back to `footman`, so a typo degrades instead of
crashing.

The resolved id reaches the renderer through
`webPreferences.additionalArguments: ['--skin=knight']`, read from `process.argv` — the
same channel the renderer already uses for `--dev`, so no new IPC handshake at startup.

**Tray submenu.** `Skin ▸` with radio items (Footman / Knight / Peasant), checked on the
active one. Picking one writes `footman.config.json` *and* applies immediately over IPC:
the renderer swaps the portrait and rebuilds its sound map in place. The tray menu is
rebuilt after a pick so the radio check moves.

Hot-swap rather than `app.relaunch()`, because a relaunch races the new process against
the old one releasing port 6112, and `server.start()` quits on `EADDRINUSE` — a mistimed
relaunch makes the widget vanish. It would also drop the session map and any live
permission prompt. Swapping in place costs one `applySkin(id)` function that init needs
anyway.

The config file and env var are still read only at startup: hand-editing the JSON needs a
restart. The tray is the live path.

**Env var caveat.** `FOOTMAN_SKIN` wins at every startup, so a tray pick would not survive
a relaunch while it is set. When it is set, the submenu renders disabled with a
`Skin ▸ (set by FOOTMAN_SKIN)` label rather than silently losing the click.

**Repo hygiene.** `footman.config.json` is gitignored and ships as
`footman.config.example.json`. README gets a "Choosing a skin" section.

## 3. The skin manifest

New `electron-app/src/skins.js` — one block per skin, plus two pure helpers. No Electron
imports, so it runs under plain `node --test`.

```js
const SKINS = {
  knight: {
    name: 'Knight',
    dir: 'knight',
    portrait: 'portrait.webp',
    fit: 'contain',
    lines: {
      working:  [ { file: 'action-fortheking.wav' }, ... ],              // sound only
      ack:      [ { file: 'action-fortheking.wav', text: 'For the King!' }, ... ],
      complete: [ { file: 'completed-ready.wav', text: 'Ready to serve!' }, ... ],
      prompt:   [ { file: 'question-sire.wav', text: 'Sire?' }, ... ],
      error:    [ { file: 'question-sire.wav' }, ... ],                  // sound only
    },
  },
  ...
}
```

Helpers: `resolveSkin(envValue, configValue)` and `pickLine(skinId, action)` (the weighted
pick, moved out of the renderer).

### Action mapping

The widget has five actions; the new sets have three filename categories:

| widget action | source | balloon text |
|---|---|---|
| `working` (task starts) | `action-` | none — the balloon builds "Working on x, y…" itself |
| `ack` (a prompt was answered, work resumes) | `action-` | yes |
| `complete` | `completed-` | yes |
| `prompt` | `question-` | yes |
| `error` | `question-` | none — the balloon shows the caller's error message |

`working` and `ack` share the `action-` pool because both mean "starting work"; the only
difference is whether text is shown. `error` reuses the `question-` pool, mirroring
Footman, which already reuses `my-lord.mp3` for errors.

### Weights

All knight and peasant lines carry weight 1 — annoyed lines sit in the same pool as the
rest. Footman keeps its current 3:1 weighting so nothing about it changes.

### Portrait fit

Footman's `portrait.jpg` is 1280×720 and needs `object-fit: cover` to crop its black side
bars. The knight and peasant portraits are 46×38 WC2 sprites, already tightly framed —
`cover` at 64×64 would slice ~7px off each side, into the helmet. They use `contain`,
letterboxed against the transparent window. `image-rendering: pixelated` is unchanged.
`fit` is a per-skin manifest field applied as an inline style on the `<img>`.

### Transcripts

Balloon text is inferred from the filenames — the audio was not listened to. Correct any
that are wrong; they live in one place.

**Knight** — `action-`: At your service. / Defending the realm! / Don't push it, buddy! /
For the King! / In your name! / Of course! / Very well! / We move!
`completed-`: Don't force me to hurt ya! / Give me a quest! / I'm alive! / I need orders! /
Ready to serve!
`question-`: I'm growing impatient! / Make it quick! / Sire? / What ho? / Yes? /
Your Majesty?

**Peasant** — `action-`: Alright. / Don't you have something better to do? /
Leave me alone! / Okay. / Righto! / Uh-huh. / Yes!
`completed-`: Job's done! / More work? / I'm not doing that! / Now what? / Ready to work!
`question-`: Hello? / M'lord? / Ohh, what?! / What?

## 4. Code changes

**`renderer.js`** — the hardcoded `sounds` and `LINES` consts are deleted. In their place:

- `applySkin(id)` — swaps the portrait `src` and `object-fit`, rebuilds the `Audio` map
  from that skin's line pool (one `Audio` per distinct file, deduped since `working`,
  `ack` and `prompt`, `error` share files), stores the active id.
- `playSound(name)` becomes `playLine(action)` — picks the line, plays its audio, returns
  the line so callers can use `line.text`. This drops the current sound-key indirection,
  where every clip needed a nickname in one object and a filename in another.
- `loadFootmanPortrait()` → `loadPortrait()`. DOM ids stay `footman-portrait` /
  `footman-img` so `styles.css` and the click-through `reportContentRects()` list do not
  churn.
- Reads `--skin=` from `process.argv` at init; listens for `skin-changed` from main.

**`main.js`** — `readSkinConfig()` / `writeSkinConfig()` against the repo-root JSON,
resolution at startup, `additionalArguments`, the `Skin ▸` submenu, and a `skin-changed`
send to the renderer on pick.

**`server.js`, `mcp-server/`, `scripts/`** — untouched. Skins are purely a
widget-presentation concern.

## 5. Failure modes

All degrade rather than crash:

| failure | behaviour |
|---|---|
| unreadable or malformed `footman.config.json` | warn, use `footman` |
| unknown skin id (config, env, or IPC) | warn, use `footman` |
| missing audio file | the existing `.play().catch()` swallows it; balloon text still shows |
| missing portrait file | the existing `img.onerror` grey-box fallback |

## 6. Testing

New `electron-app/src/skins.test.mjs` under `node --test`:

- every skin's five action pools are non-empty
- every `file` in the manifest exists on disk — catches a typo in any of ~40 filenames,
  the one mistake that is invisible until you hear silence
- every line outside `working` and `error` has non-empty `text`
- `resolveSkin` precedence: env > config > default, and unknown ids fall back

`package.json` gets `"test": "node --test src"`. CI gets a fourth job mirroring the
existing `scripts · node:test` one, with `working-directory: electron-app`.

**Manual check.** `npm start` per skin; confirm portrait and voice on start / complete /
question, then a tray swap mid-session to confirm the session counter and any live prompt
survive it.

## Amendments after implementation

- **Per-skin `fit` dropped.** The design gave the Footman `cover` and the WC2 sprites
  `contain`, which rendered the sprites visibly smaller than the Footman. Every portrait
  now uses `cover`; losing a few pixels off the sides beats an inconsistent avatar size.
- **Avatar size added.** 1×, 2× or 3×, chosen from `Size ▸` in the tray or `scale` in
  `footman.config.json` (`FOOTMAN_SCALE` overrides). The window grows by exactly the extra
  avatar pixels, anchored at its bottom-left corner.
- **Written status lines standardised.** "Starting work on <project>" and "Work completed
  on <project>" replace the skin's themed completion text in the balloon. The voice lines
  stay in character; their transcripts remain in the manifest for reference.
