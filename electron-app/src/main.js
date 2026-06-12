const { app, BrowserWindow, ipcMain } = require('electron');
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
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/index.html');

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

app.whenReady().then(() => {
  createWindow();
  server.start();
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
