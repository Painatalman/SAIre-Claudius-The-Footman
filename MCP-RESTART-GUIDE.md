# MCP Server Not Loading - Restart Instructions

## The Problem
Claude Code uses a persistent background process that doesn't restart when you close/reopen the window.

**Current Status:**
- Claude Code process started: **9:29 PM**
- MCP config created: **10:57 PM**
- **Process never restarted** → MCP server never loaded

## How to Properly Restart

### Option 1: Using VS Code Command Palette (Recommended)
1. Press `Cmd+Shift+P` (or `Ctrl+Shift+P`)
2. Type: "Developer: Reload Window"
3. Press Enter
4. Wait for window to reload

### Option 2: Quit VS Code Completely
1. Press `Cmd+Q` to quit VS Code (not just close window)
2. Wait 5 seconds
3. Reopen VS Code
4. Reopen this project folder

### Option 3: Kill the Process (Last Resort)
```bash
# Kill the Claude Code extension process
pkill -f "anthropic.claude-code"

# Then reload VS Code window with Cmd+Shift+P → "Developer: Reload Window"
```

## After Restart - Verify MCP Loaded

Ask Claude:
```
What tools do you have from the footman server?
```

**Expected response:** 4 tools:
- footman_notify_complete
- footman_notify_working
- footman_notify_error
- footman_prompt

## Troubleshooting

If tools still don't appear:
1. Check logs: `tail -50 ~/Library/Logs/Claude/main.log`
2. Verify config: `cat ~/.claude/claude.json`
3. Test server manually: `cd mcp-server && node index.js`

---

**Remember:** The Footman widget is already running and working perfectly. It's just waiting for Claude Code to load the MCP tools!
