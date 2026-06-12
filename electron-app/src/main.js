const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');

// Allow sounds to play without a user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
const POSITION_FILE = path.join(app.getPath('userData'), 'position.json');

function loadPosition() {
  try {
    if (fs.existsSync(POSITION_FILE)) {
      return JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load position:', err);
  }
  // Default position: bottom-right corner with some padding
  return { x: 1200, y: 600 };
}

function savePosition() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const position = mainWindow.getPosition();
    fs.writeFileSync(POSITION_FILE, JSON.stringify({ x: position[0], y: position[1] }));
  }
}

function createWindow() {
  const position = loadPosition();

  mainWindow = new BrowserWindow({
    width: 280,
    height: 180,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    // macOS draws an intermittent dark halo around transparent windows
    // unless the native window shadow is disabled
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/index.html');

  // Start click-through; the renderer re-enables clicks when the cursor
  // is over the portrait, counter, or balloon (forward keeps mousemove alive)
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Set window for server
  server.setWindow(mainWindow);

  // Save position when window is moved
  mainWindow.on('moved', () => {
    savePosition();
  });

  // Save position before quit
  mainWindow.on('close', () => {
    savePosition();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Relay prompt answers from the renderer to the HTTP response store
ipcMain.on('prompt-response', (event, { id, choice }) => {
  server.storeResponse(id, choice);
});

// The renderer reports balloon visibility so click-through polling
// knows when the balloon area is real content
let balloonVisible = false;
ipcMain.on('balloon-visible', (event, visible) => {
  balloonVisible = visible;
});

// Click-through management. DOM mousemove can't drive this because
// -webkit-app-region: drag swallows mouse events, so poll the screen
// cursor from the main process instead and toggle setIgnoreMouseEvents.
function startClickThroughPolling() {
  // Content rect when only the portrait + counter are visible
  // (bottom-left column: 10px padding, 64px portrait, counter below)
  const COLUMN = { left: 6, right: 92, top: 72 };
  let lastIgnore = null;

  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const pt = screen.getCursorScreenPoint();
    const b = mainWindow.getBounds();
    const x = pt.x - b.x;
    const y = pt.y - b.y;
    const inWindow = x >= 0 && x <= b.width && y >= 0 && y <= b.height;

    let overContent = false;
    if (inWindow) {
      overContent = balloonVisible
        ? true // balloon can occupy most of the window — treat it all as content
        : (x >= COLUMN.left && x <= COLUMN.right && y >= COLUMN.top);
    }

    const ignore = !overContent;
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }, 100);
}

app.whenReady().then(() => {
  createWindow();
  server.start();
  startClickThroughPolling();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
