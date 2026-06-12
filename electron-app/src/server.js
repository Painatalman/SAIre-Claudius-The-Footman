const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

let mainWindow = null;

// Initialize with Electron window
function setWindow(window) {
  mainWindow = window;
}

// Notification endpoint
app.post('/notify', (req, res) => {
  const { type, message, options } = req.body;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return res.status(500).json({ error: 'Widget not ready' });
  }

  console.log('Received notification:', { type, message });

  // Send to renderer process
  mainWindow.webContents.send('notification', { type, message, options });

  res.json({ success: true });
});

// Callback endpoint for user responses
app.post('/response/:id', (req, res) => {
  const { id } = req.params;
  const { choice } = req.body;

  console.log('Received response:', { id, choice });

  // Store response for MCP to poll
  // TODO: Implement callback mechanism

  res.json({ success: true });
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

module.exports = { start, setWindow };
