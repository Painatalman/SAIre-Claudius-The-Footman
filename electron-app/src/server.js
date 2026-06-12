const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

let mainWindow = null;

// User answers to interactive prompts, keyed by prompt ID
const responses = new Map();

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
  const { type, message, options, sessionId, promptId } = req.body;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return res.status(500).json({ error: 'Widget not ready' });
  }

  console.log('Received notification:', { type, message, sessionId, promptId });

  // Send to renderer process
  mainWindow.webContents.send('notification', { type, message, options, sessionId, promptId });

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

// Poll endpoint for the MCP server to collect the user's answer
app.get('/response/:id', (req, res) => {
  const { id } = req.params;

  if (responses.has(id)) {
    const choice = responses.get(id);
    responses.delete(id);
    return res.json({ choice });
  }

  res.status(404).json({ pending: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', widget: mainWindow && !mainWindow.isDestroyed() });
});

function start() {
  app.listen(PORT, () => {
    console.log(`Footman notification server listening on http://localhost:${PORT}`);
  });
}

module.exports = { start, setWindow, storeResponse };
