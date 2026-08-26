const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');
const { SKINS, resolveSkin, SCALES, resolveScale, windowSizeFor } = require('./skins');

let tray = null;

// Only one Footman may run. On startup several Claude Code sessions fire their
// SessionStart hook at once and race to launch Electron before any of them has
// bound port 6112, so the shell health-check guard isn't enough on its own.
// The single-instance lock is the authoritative guard: losers quit immediately.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {

// Allow sounds to play without a user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
const POSITION_FILE = path.join(app.getPath('userData'), 'position.json');

// How the avatar looks — which skin, at what size — persists in a JSON file at
// the repo root, so it survives restarts and can be hand-edited. The matching
// environment variables override it for a one-off launch, which is why a tray
// pick can't outlive a relaunch while one is set, and why the menu says so.
// FOOTMAN_CONFIG points this elsewhere — used by the tests so they never touch
// the real file, and handy for running a second widget off its own config.
const CONFIG_FILE = process.env.FOOTMAN_CONFIG || path.join(__dirname, '..', '..', 'footman.config.json');
const SKIN_ENV = process.env.FOOTMAN_SKIN || '';
const SCALE_ENV = process.env.FOOTMAN_SCALE || '';

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return {};
}

// Merge rather than overwrite, so setting the size doesn't drop the skin.
function writeConfig(patch) {
  try {
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...readConfig(), ...patch }, null, 2)}\n`);
  } catch (err) {
    console.error('Failed to write config:', err);
  }
}

const config = readConfig();
let activeSkin = resolveSkin(SKIN_ENV, config.skin);
let activeScale = resolveScale(SCALE_ENV, config.scale);

// Resting window height. The window grows taller to fit the balloon and returns
// to this height when the balloon is hidden. It tracks the avatar scale, since a
// bigger avatar needs a bigger window to sit in.
let restingHeight = windowSizeFor(activeScale).height;

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
    const restingY = (b.y + b.height) - restingHeight;
    fs.writeFileSync(POSITION_FILE, JSON.stringify({ x: b.x, y: restingY }));
  }
}

function createWindow() {
  const position = loadPosition();

  const { width, height } = windowSizeFor(activeScale);

  mainWindow = new BrowserWindow({
    width,
    height,
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
      contextIsolation: false,
      // The renderer reads --skin=<id> off process.argv at startup, the same
      // channel --dev arrives on, so no handshake is needed before first paint.
      additionalArguments: [`--skin=${activeSkin}`, `--scale=${activeScale}`]
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

  const newHeight = Math.min(Math.max(Math.round(height), restingHeight), workArea.height);
  const newY = Math.max(workArea.y, bottom - newHeight);

  if (newHeight === bounds.height && newY === bounds.y) return;
  mainWindow.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newHeight });
});

// The renderer reports the window-relative bounding boxes of the actual visible
// content (portrait, session counter, balloon). Click-through polling toggles
// solidity only over these boxes, so the rest of the transparent window stays
// click-through — no invisible barrier of dead space around the Footman.
let contentRects = [];
ipcMain.on('content-rects', (event, rects) => {
  contentRects = Array.isArray(rects) ? rects : [];
});

// Click-through management. DOM mousemove can't drive this because
// -webkit-app-region: drag swallows mouse events, so poll the screen
// cursor from the main process instead and toggle setIgnoreMouseEvents.
function startClickThroughPolling() {
  let lastIgnore = null;

  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const pt = screen.getCursorScreenPoint();
    const b = mainWindow.getBounds();
    const x = pt.x - b.x;
    const y = pt.y - b.y;

    const overContent = contentRects.some(
      (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    );

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

// Change the skin from the tray. Persisted for next launch, and applied live
// over IPC — relaunching instead would race the new process against this one
// releasing port 6112, and would drop the session map and any live prompt.
function selectSkin(skinId) {
  if (!SKINS[skinId] || skinId === activeSkin) return;
  activeSkin = skinId;
  writeConfig({ skin: skinId });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('skin-changed', skinId);
  }
  refreshTrayMenu(); // move the radio check to the new skin
}

// Change the avatar size from the tray. The window has to grow with it, and it
// grows from the bottom-left corner it already occupies — the widget lives in a
// screen corner, and resizing shouldn't walk it across the desktop.
function selectScale(scale) {
  if (!SCALES.includes(scale) || scale === activeScale) return;
  activeScale = scale;
  restingHeight = windowSizeFor(scale).height;
  writeConfig({ scale });

  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    const bottom = bounds.y + bounds.height;
    const { width } = windowSizeFor(scale);
    mainWindow.setBounds({ x: bounds.x, y: bottom - restingHeight, width, height: restingHeight });
    // The renderer resizes the portrait and, if a balloon is open, asks for the
    // taller window it now needs.
    mainWindow.webContents.send('scale-changed', scale);
  }
  refreshTrayMenu();
}

function buildTrayMenu() {
  // FOOTMAN_SKIN wins at every startup, so a pick made here wouldn't survive a
  // relaunch. Disable the submenu rather than silently losing the click.
  const overridden = Boolean(SKIN_ENV);
  const sizeOverridden = Boolean(SCALE_ENV);

  return Menu.buildFromTemplate([
    { label: 'Show Avatar', click: () => mainWindow && mainWindow.show() },
    { label: 'Dismiss Avatar', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    {
      label: overridden ? 'Skin (set by FOOTMAN_SKIN)' : 'Skin',
      submenu: Object.entries(SKINS).map(([id, skin]) => ({
        label: skin.name,
        type: 'radio',
        checked: id === activeSkin,
        enabled: !overridden,
        click: () => selectSkin(id),
      })),
    },
    {
      label: sizeOverridden ? 'Size (set by FOOTMAN_SCALE)' : 'Size',
      submenu: SCALES.map((scale) => ({
        label: `${scale}×`,
        type: 'radio',
        checked: scale === activeScale,
        enabled: !sizeOverridden,
        click: () => selectScale(scale),
      })),
    },
    { type: 'separator' },
    { label: 'Reset position', click: resetWindowPosition },
    { type: 'separator' },
    { label: 'Quit Avatar', click: () => app.quit() },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// macOS menu-bar (tray) icon — the avatar lives in the top bar instead of the
// dock, with a small menu to show/hide it, switch skins, recentre it, or quit.
// The menu names the widget rather than the character, since the skin changes.
function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'sprites', 'helmetTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true); // adapt to light/dark menu bar

  tray = new Tray(icon);
  tray.setToolTip('Avatar');
  refreshTrayMenu();
}

app.whenReady().then(() => {
  // Run as a menu-bar accessory: no dock icon, just the tray icon up top.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createWindow();
  // If the port is already taken we lost the startup race — quit cleanly
  // rather than crashing on the unhandled EADDRINUSE.
  server.start(() => app.quit());
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

} // end single-instance guard
