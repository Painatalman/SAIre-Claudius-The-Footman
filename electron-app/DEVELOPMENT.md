# Development Guide

## Project Structure

```
electron-app/
├── src/
│   ├── main.js         # Electron main process (window management)
│   ├── index.html      # Widget HTML structure
│   ├── styles.css      # All styling and animations
│   └── renderer.js     # Widget logic and state management
├── package.json
└── .gitignore
```

## Running the Widget

**Normal mode:**
```bash
npm start
```

**Development mode** (with DevTools and mock notifications every 4 seconds):
```bash
npm run dev
```

## How It Works

### Main Process (main.js)
- Creates a frameless, transparent, always-on-top window
- Handles window positioning and saves/restores position
- Sets up draggable behavior

### Renderer Process (renderer.js)
- Manages widget state (idle, working, complete, prompt, error)
- Controls animations via CSS class changes
- Handles sound playback
- Provides notification API: `window.FootmanWidget.notifyWorkComplete()`, etc.

### Animations (styles.css)
- `breathe`: Idle state, gentle scaling
- `work`: Working state, subtle bobbing
- `nod`: Completion acknowledgment
- `alert`: Attention pulse for prompts
- `shake`: Error indication

## Tests

`npm test` in `electron-app/`, `scripts/` and `mcp-server/` — all `node --test`, no
display or Electron needed, all three run in CI.

- `skins.test.mjs` / `message-format.test.mjs` — the pure data and formatting helpers.
- `renderer.test.mjs` — the real `renderer.js` loaded into jsdom by `renderer-harness.mjs`,
  covering what the balloon actually shows and what a click sends back.
- `main.test.mjs` — the real `main.js` with Electron stubbed in the require cache, so the
  tray menu handlers are exercised rather than merely parsed.

## Testing Without MCP Server

In dev mode (`npm run dev`), mock notifications cycle through all states:
1. Idle (3 seconds)
2. Working - "Building project..."
3. Complete - "Build successful!"
4. Prompt - "Continue with tests?"
5. Error - "Test failed"

## Adding Real Voice Lines

Voice lines belong to a skin, not to the widget:

1. Drop the audio in `../assets/skins/<skin>/` (MP3 or WAV).
2. Add each file to that skin's line pools in `src/skins.js` — `working` and `error` are
   sound-only, `ack`, `complete` and `prompt` also carry the balloon text.
3. `npm test` verifies every file you named exists.
4. Restart the widget, or switch skins from the menu-bar icon.

## Customizing the Portrait

Edit `../assets/sprites/footman.svg` to change the Footman's appearance. The SVG uses:
- `#eyes` group for eye animations
- `#eyebrows` group for expression changes
- `#mouth` group for facial expressions

## Next Steps

1. ✅ UI Complete
2. ⏭ Add HTTP server for receiving notifications
3. ⏭ Build MCP server for Claude Code integration
4. ⏭ Add interactive options in speech balloon
5. ⏭ Source/add real WC2 sound files
