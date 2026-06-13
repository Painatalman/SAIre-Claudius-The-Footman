# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Warcraft 2 Footman desktop notification widget that announces Claude Code activity with speech balloons and authentic voice lines
- MCP server with prompt, working, complete, and error notification tools for Claude Code
- Footman greets prompts with "My lord?", acknowledges work with "At once, sire!" and an animated ellipsis, using the authentic WC2 portrait with audio autoplay
- Golden pulsing aura on the portrait while idle, in the style of a WC2 selected unit
- Occasional idle fidget — the Footman wiggles every 25 seconds between tasks so he feels alive
- Live session counter under the portrait showing how many Claude Code sessions are at work vs awaiting orders, hidden when no sessions are known; sessions silent for over 6 hours are forgotten automatically
- Interactive prompts — the Footman now shows clickable answer buttons in his speech balloon, replies "As you wish!" when you pick one, and delivers your choice back to Claude (waiting up to 5 minutes for an answer)
- SessionStart hook script (`scripts/launch-footman.sh`) that auto-launches the widget if it isn't running and registers each new Claude Code session with the session counter
- PermissionRequest hook documented in the README — the Footman now announces "Permission needed: `<tool name>`" whenever a session shows a permission dialog
- Full setup and reference guide in the README — MCP server registration, all five Claude Code hooks explained, manual run instructions, widget behavior, HTTP API, wired sounds, and troubleshooting
- Permission notifications now show the actual request — the Bash command, file path, URL, or prompt (truncated to 160 characters) on a second line — instead of just the tool name; the speech balloon renders the extra line properly
- Interactive permission prompts — the PermissionRequest hook (`scripts/permission-prompt.mjs`) now shows **Allow**/**Deny** buttons in the balloon and actually approves or blocks the tool call based on your click. The hook is synchronous so it can return the decision to Claude Code; if the widget isn't running or you don't answer within ~55 seconds, it falls back to Claude Code's normal permission dialog
- Permission prompts display the request literally — the tool name and the exact command, file path, or URL (or the full `tool_input` as JSON for other tools), with no rewording and no truncation
- Permission prompts now show the real choices Claude offers instead of a fixed Allow/Deny — an **Always allow `<rule>`** button is added for each entry in the payload's `permission_suggestions`, carrying the suggested rule so it can be remembered, alongside plain Allow and Deny

### Fixed

- Clicks on the transparent parts of the widget window now pass through to the apps behind it instead of being swallowed by the invisible 280×180 window rectangle — the portrait, session counter, and speech balloon (with its answer buttons) remain fully clickable and draggable
- Intermittent dark halo ("black aura") around the widget on macOS — the native window shadow is now disabled for the transparent window
- Container padding so the idle aura glow renders without clipping
- Widget layout is now anchored to the bottom so the speech balloon grows upward — long prompts no longer run off-screen when the widget sits in the bottom corner
- Long balloon messages are no longer clipped by the fixed 280×180 window — the window now grows taller to fit the balloon (anchored at the bottom so it expands upward) and shrinks back when the balloon hides; messages taller than the screen scroll inside the balloon instead of being cut off
- Notifications silently vanishing when another project's Vite dev server bound `[::1]:3000` — IPv6 wins localhost resolution on macOS, so everything sent to the widget landed on Vite instead; the widget's HTTP server now lives on port 6112 (the classic Battle.net game port), with the MCP server, launch script, and README updated to match

### Changed

- Removed the dark border from the portrait so the idle aura blends straight off the portrait edges
- Removed the speech balloon drop shadow, which read as a black border under the balloon
- Lightened the balloon border and tail from near-black to warm parchment-brown
