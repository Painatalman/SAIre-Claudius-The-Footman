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
- Full setup and reference guide in the README — MCP server registration, all five Claude Code hooks explained, manual run instructions, widget behavior, HTTP API, wired sounds, and troubleshooting

### Fixed

- Clicks on the transparent parts of the widget window now pass through to the apps behind it instead of being swallowed by the invisible 280×180 window rectangle — the portrait, session counter, and speech balloon (with its answer buttons) remain fully clickable and draggable
- Intermittent dark halo ("black aura") around the widget on macOS — the native window shadow is now disabled for the transparent window
- Container padding so the idle aura glow renders without clipping
- Widget layout is now anchored to the bottom so the speech balloon grows upward — long prompts no longer run off-screen when the widget sits in the bottom corner

### Changed

- Removed the dark border from the portrait so the idle aura blends straight off the portrait edges
- Removed the speech balloon drop shadow, which read as a black border under the balloon
- Lightened the balloon border and tail from near-black to warm parchment-brown
