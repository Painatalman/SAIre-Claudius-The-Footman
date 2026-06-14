const express = require('express');
const app = express();
// 6112 — the classic Battle.net game port. Dev servers swarm 3000;
// the original port got shadowed by a Vite server on [::1]:3000.
const PORT = 6112;

app.use(express.json());

let mainWindow = null;

// User answers to interactive prompts, keyed by prompt ID
const responses = new Map();

// Liveness heartbeats for interactive prompts, keyed by prompt ID. A prompt is
// "alive" while something is still polling for its answer (the PermissionRequest
// hook or the MCP server). Once that poller exits — because the request was
// answered here, answered in Claude Code's own UI, or timed out — the heartbeat
// goes stale and the widget can dismiss the prompt.
const promptSeen = new Map();
const PROMPT_ACTIVE_WINDOW_MS = 2500;

function markPromptAlive(id) {
  if (id) promptSeen.set(id, Date.now());
}

// Initialize with Electron window
function setWindow(window) {
  mainWindow = window;
}

// Store a user's answer (called from main process on renderer click)
function storeResponse(id, choice) {
  responses.set(id, choice);
}

// Notification endpoint
app.post('/notify', (req, res) => {
  const { type, kind, message, options, sessionId, promptId, cwd } = req.body;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return res.status(500).json({ error: 'Widget not ready' });
  }

  console.log('Received notification:', { type, kind, message, sessionId, promptId, cwd });

  // A new interactive prompt starts out alive.
  if (type === 'prompt' && promptId) markPromptAlive(promptId);

  // Send to renderer process
  mainWindow.webContents.send('notification', { type, kind, message, options, sessionId, promptId, cwd });

  res.json({ success: true });
});

// Store a response directly (manual testing)
app.post('/response/:id', (req, res) => {
  const { id } = req.params;
  const { choice } = req.body;

  console.log('Received response:', { id, choice });
  storeResponse(id, choice);

  res.json({ success: true });
});

// Poll endpoint for the hook / MCP server to collect the user's answer. Every
// poll doubles as a liveness heartbeat for that prompt.
app.get('/response/:id', (req, res) => {
  const { id } = req.params;
  markPromptAlive(id);

  if (responses.has(id)) {
    const choice = responses.get(id);
    responses.delete(id);
    return res.json({ choice });
  }

  res.status(404).json({ pending: true });
});

// Which prompts still have a poller behind them. The widget uses this to dismiss
// prompts that were answered elsewhere (or timed out).
app.get('/prompts/active', (req, res) => {
  const now = Date.now();
  const active = [];
  for (const [id, lastSeen] of promptSeen) {
    if (now - lastSeen < PROMPT_ACTIVE_WINDOW_MS) active.push(id);
    else promptSeen.delete(id);
  }
  res.json({ active });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', widget: mainWindow && !mainWindow.isDestroyed() });
});

// onError is called if the port can't be bound — typically EADDRINUSE because
// another Footman instance won the startup race. The caller quits gracefully
// instead of letting the unhandled error crash the process.
function start(onError) {
  const httpServer = app.listen(PORT, () => {
    console.log(`Footman notification server listening on http://localhost:${PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} already in use — another Footman is running. Exiting.`);
    } else {
      console.error('Footman server error:', err);
    }
    if (typeof onError === 'function') onError(err);
  });
}

module.exports = { start, setWindow, storeResponse };
