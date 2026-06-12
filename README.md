# Footman Notifier

A Warcraft 2 Footman-themed notification widget for AI task completion.

> **📋 See [SESSION.md](SESSION.md) for complete project status and continuation guide.**

## Project Structure

- `electron-app/` - Electron-based desktop widget
- `mcp-server/` - MCP server for Claude Code integration (coming soon)
- `assets/` - Shared sprites and sounds

## Features

- Always-on draggable Footman portrait
- Speech balloon notifications
- Classic WC2 voice lines ("Work complete!", "Yes, my lord?")
- Simple pixel art animations

## Quick Start

```bash
cd electron-app
npm install
npm start
```

For development with DevTools and mock notifications:
```bash
npm run dev
```

## Current Status

✅ **Completed:**
- Draggable, always-on-top transparent widget
- Pixel art Footman portrait (WC2-inspired)
- Speech balloon with tail
- 5 animation states (idle, working, complete, prompt, error)
- Position persistence (remembers where you placed it)
- Mock notification system for testing

🚧 **Coming Soon:**
- Sound effects (WC2 voice lines)
- MCP server integration
- HTTP API for Claude Code communication

## Widget Features

- **Draggable:** Click and drag the Footman anywhere on screen
- **Persistent Position:** Remembers location between sessions
- **Animation States:**
  - Idle: Gentle breathing animation
  - Working: Subtle bobbing motion
  - Complete: Nod animation + "Work complete!" message
  - Prompt: Alert pulse + question in balloon
  - Error: Shake animation + error message

## Adding Sounds

Place MP3 files in `assets/sounds/`:
- `work-complete.mp3` - "Work complete!"
- `yes-my-lord.mp3` - "Yes, my lord?"
- `error.mp3` - Grunt/error sound

See `assets/sounds/README.md` for details.
