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

### Fixed

- Container padding so the idle aura glow renders without clipping

### Changed

- Removed the dark border from the portrait so the idle aura blends straight off the portrait edges
- Removed the speech balloon drop shadow, which read as a black border under the balloon
- Lightened the balloon border and tail from near-black to warm parchment-brown
