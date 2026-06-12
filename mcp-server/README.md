# Footman MCP Server

MCP server that integrates Claude Code with the Footman notification widget.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Add to your Claude Code configuration (`~/.claude/claude.json`):
```json
{
  "mcpServers": {
    "footman": {
      "command": "node",
      "args": ["/Users/dengun/Documents/Projects/mask-ot/mcp-server/index.js"]
    }
  }
}
```

3. Restart Claude Code to load the MCP server

## Available Tools

The MCP server provides these tools to Claude Code:

- `footman_notify_complete` - Show task completion notification
- `footman_notify_working` - Show work-in-progress notification
- `footman_notify_error` - Show error notification
- `footman_prompt` - Ask user a question

## How It Works

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Claude Code    │────────▶│   MCP Server     │────────▶│ Footman Widget  │
│                 │  Tool   │  (this project)  │  HTTP   │ (Electron app)  │
│  When you use   │  Calls  │                  │  POST   │                 │
│  Claude Code    │         │  localhost:3000  │         │ Shows on screen │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

When Claude Code completes a task, it calls the MCP tools, which send notifications to the Footman widget via HTTP.

## Testing

With the Footman widget running (`cd ../electron-app && npm run dev`), Claude Code can now:

1. Notify you when tasks complete
2. Show working status during long tasks
3. Display errors with voice lines
4. Ask questions (future: clickable options)

Try asking Claude: "Can you test the Footman notification by sending a completion message?"
