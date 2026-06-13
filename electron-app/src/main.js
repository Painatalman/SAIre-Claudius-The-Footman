const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');

let tray = null;

// Allow sounds to play without a user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
const POSITION_FILE = path.join(app.getPath('userData'), 'position.json');

// Resting window height. The window grows taller to fit the balloon and
// returns to this height when the balloon is hidden.
const DEFAULT_WINDOW_HEIGHT = 180;

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
    // Anchor by the bottom edge: if the window is currently grown to fit a
    // balloon, store the resting top-left so the position doesn't drift.
    const b = mainWindow.getBounds();
    const restingY = (b.y + b.height) - DEFAULT_WINDOW_HEIGHT;
    fs.writeFileSync(POSITION_FILE, JSON.stringify({ x: b.x, y: restingY }));
  }
}

function createWindow() {
  const position = loadPosition();

  mainWindow = new BrowserWindow({
    width: 280,
    height: DEFAULT_WINDOW_HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    // macOS draws an intermittent dark halo around transparent windows
    // unless the native window shadow is disabled
    hasShadow: false,
    alwaysOnTop: true,
    // Resizable so the main process can grow the window to fit the balloon.
    // The window is frameless and click-through, so the user can't drag-resize it.
    resizable: true,
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

// Resize the window to fit the balloon, keeping the bottom edge fixed so the
// balloon grows upward. Clamped to the display work area so it never runs off
// the top of the screen (beyond that the balloon scrolls internally).
ipcMain.on('resize-window', (event, { height }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const bounds = mainWindow.getBounds();
  const bottom = bounds.y + bounds.height;
  const workArea = screen.getDisplayMatching(bounds).workArea;

  const newHeight = Math.min(Math.max(Math.round(height), DEFAULT_WINDOW_HEIGHT), workArea.height);
  const newY = Math.max(workArea.y, bottom - newHeight);

  if (newHeight === bounds.height && newY === bounds.y) return;
  mainWindow.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newHeight });
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

// Move the widget back to its default bottom-right spot (handy if it drifts
// off-screen — there's no dock icon to fall back on).
function resetWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - 300;
  const y = workArea.y + workArea.height - 200;
  mainWindow.setPosition(x, y);
  mainWindow.show();
  savePosition();
}

// macOS menu-bar (tray) icon — the Footman lives in the top bar instead of the
// dock, with a small menu to show/hide it, recentre it, or quit.
function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'sprites', 'helmetTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true); // adapt to light/dark menu bar

  tray = new Tray(icon);
  tray.setToolTip('Footman');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Footman', click: () => mainWindow && mainWindow.show() },
    { label: 'Hide Footman', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    { label: 'Reset position', click: resetWindowPosition },
    { type: 'separator' },
    { label: 'Quit Footman', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  // Run as a menu-bar accessory: no dock icon, just the tray icon up top.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createWindow();
  server.start();
  startClickThroughPolling();
  createTray();
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
