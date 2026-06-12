# Claude Code Restart Test Plan

## ✅ Pre-Restart Status

- **Footman widget:** Running in background (Process ID: eecf99)
- **HTTP server:** Listening on `localhost:3000`
- **MCP config:** Installed at `~/.claude/claude.json`
- **Manual tests:** All passed (complete, working, error, prompt)

---

## 🔄 Restart Steps

1. **Keep Footman widget running** (don't close it!)
2. **Quit Claude Code completely**
3. **Reopen Claude Code**
4. **Return to this project directory**

---

## 🧪 Tests to Run After Restart

### Test 1: Check MCP Server Loaded
Ask Claude:
```
What tools do you have from the footman server?
```

**Expected response:** Claude should list 4 tools:
- `footman_notify_complete`
- `footman_notify_working`
- `footman_notify_error`
- `footman_prompt`

---

### Test 2: Send Completion Notification
Ask Claude:
```
Test the Footman by sending a completion notification that says "MCP integration successful!"
```

**Expected result:**
- Footman displays the message in speech balloon
- Plays "Work complete!" voice line
- Nod animation

---

### Test 3: Send Working Notification
Ask Claude:
```
Notify the Footman that you're working on something, say "Testing work status..."
```

**Expected result:**
- Footman shows "Testing work status..." in balloon
- Bobbing animation
- Balloon stays visible (doesn't auto-hide)

---

### Test 4: Send Error Notification
Ask Claude:
```
Send an error notification to the Footman saying "Test error - all good!"
```

**Expected result:**
- Footman shows error message
- Shake animation
- Concerned voice line

---

### Test 5: Real-World Usage
Ask Claude to do actual work:
```
Create a simple test file with a hello world function, then notify me when it's done
```

**Expected result:**
- Claude creates the file
- Automatically sends completion notification
- Footman announces "Work complete!"

---

## 🐛 Troubleshooting

### MCP Tools Not Available
**Problem:** Claude says "I don't have those tools"

**Fix:**
1. Check config: `cat ~/.claude/claude.json`
2. Verify path is correct: `/Users/dengun/Documents/Projects/mask-ot/mcp-server/index.js`
3. Make sure file is executable: `chmod +x /Users/dengun/Documents/Projects/mask-ot/mcp-server/index.js`
4. Restart Claude Code again

---

### Notification Doesn't Show
**Problem:** No error, but Footman doesn't display message

**Fix:**
1. Check if widget is still running: Look for Footman on screen
2. Test HTTP endpoint manually:
   ```bash
   curl -X POST http://localhost:3000/notify \
     -H "Content-Type: application/json" \
     -d '{"type":"task_complete","message":"Manual test"}'
   ```
3. If curl works but MCP doesn't, check MCP server logs

---

### Widget Not Running
**Problem:** Footman disappeared

**Fix:**
```bash
cd /Users/dengun/Documents/Projects/mask-ot/electron-app
npm run dev
```

---

## 📊 Success Criteria

✅ All 4 MCP tools available
✅ Completion notification works
✅ Working notification works
✅ Error notification works
✅ Real task triggers automatic notification

---

## 📝 Next Steps After Success

Once all tests pass:
1. Update SESSION.md with test results
2. Plan Phase 2: Interactive prompts with clickable options
3. Consider auto-launching widget with Claude Code
4. Package for distribution

---

**Current Time:** Ready for restart!
**Footman Status:** Running and waiting
**MCP Status:** Configured, needs Claude restart to load
