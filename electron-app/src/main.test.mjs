// Wiring tests for the main process. main.js can't be imported normally — it
// talks to Electron at load — so Electron and the notification server are
// stubbed in the require cache and the real file is loaded on top of them.
//
// These exist because a tray handler once called a function that had been
// renamed out from under it. `node --check` reports that file as valid: it is
// syntactically fine, and the ReferenceError only appears when the menu item is
// clicked. Nothing but exercising the handler catches it.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'footman-')), 'config.json');

// What the stubs record, so a test can inspect what main.js did.
const recorded = {
  menu: null,          // the tray menu template, as built
  sent: [],            // messages pushed to the renderer
  bounds: { x: 100, y: 500, width: 380, height: 180 },
  windowArgs: null,
};

const noop = () => {};

const webContents = {
  send: (channel, payload) => recorded.sent.push({ channel, payload }),
  openDevTools: noop,
};

class FakeWindow {
  constructor(args) {
    recorded.windowArgs = args;
  }
  loadFile() {}
  setIgnoreMouseEvents() {}
  on() {}
  isDestroyed() { return false; }
  show() {}
  hide() {}
  setPosition() {}
  getBounds() { return { ...recorded.bounds }; }
  setBounds(next) { recorded.bounds = { ...next }; }
  get webContents() { return webContents; }
  static getAllWindows() { return []; }
}

const electronStub = {
  app: {
    requestSingleInstanceLock: () => true,
    quit: noop,
    on: noop,
    getPath: () => os.tmpdir(),
    commandLine: { appendSwitch: noop },
    whenReady: () => Promise.resolve(),
    dock: { hide: noop },
  },
  BrowserWindow: FakeWindow,
  ipcMain: { on: noop },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  Tray: class {
    setToolTip() {}
    setContextMenu(menu) { recorded.menu = menu; }
  },
  Menu: { buildFromTemplate: (template) => template },
  nativeImage: { createFromPath: () => ({ setTemplateImage: noop }) },
};

// Find a menu item by label prefix, at the top level or inside a submenu.
function item(label) {
  const top = recorded.menu.find((entry) => (entry.label || '').startsWith(label));
  assert.ok(top, `no menu item labelled ${label}`);
  return top;
}

function submenuItem(label, childLabel) {
  const child = item(label).submenu.find((entry) => entry.label === childLabel);
  assert.ok(child, `no ${childLabel} under ${label}`);
  return child;
}

before(async () => {
  process.env.FOOTMAN_CONFIG = CONFIG;
  delete process.env.FOOTMAN_SKIN;
  delete process.env.FOOTMAN_SCALE;

  // The click-through poller would keep the test process alive forever.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => {
    const timer = realSetInterval(fn, ms);
    timer.unref?.();
    return timer;
  };

  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: electronStub };
  require.cache[require.resolve('./server.js')] = {
    id: 'server', filename: 'server', loaded: true,
    exports: { start: noop, setWindow: noop, storeResponse: noop },
  };

  require(path.join(HERE, 'main.js'));
  await new Promise((resolve) => setImmediate(resolve)); // let whenReady() run
});

test('the tray menu offers every skin and every size', () => {
  assert.deepEqual(item('Skin').submenu.map((s) => s.label), ['Footman', 'Knight', 'Peasant']);
  assert.deepEqual(item('Size').submenu.map((s) => s.label), ['1×', '2×', '3×']);
});

test('the window is launched at the resting size for the active scale', () => {
  assert.equal(recorded.windowArgs.width, 380);
  assert.equal(recorded.windowArgs.height, 180);
});

test('the resolved skin and scale reach the renderer as launch arguments', () => {
  assert.deepEqual(recorded.windowArgs.webPreferences.additionalArguments, ['--skin=footman', '--scale=1']);
});

// The regression this file was written for.
test('picking a skin persists it and tells the renderer, without throwing', () => {
  recorded.sent.length = 0;
  submenuItem('Skin', 'Knight').click();

  assert.deepEqual(JSON.parse(fs.readFileSync(CONFIG, 'utf8')), { skin: 'knight' });
  assert.deepEqual(recorded.sent, [{ channel: 'skin-changed', payload: 'knight' }]);
});

test('picking a size persists it, resizes the window and tells the renderer', () => {
  recorded.sent.length = 0;
  const before = { ...recorded.bounds };
  submenuItem('Size', '3×').click();

  assert.deepEqual(recorded.sent, [{ channel: 'scale-changed', payload: 3 }]);
  assert.deepEqual(recorded.bounds, {
    x: before.x,
    y: before.y + before.height - 308, // grows upward from the bottom edge
    width: 508,
    height: 308,
  });
});

// Setting the size must not drop the skin that was already chosen.
test('the two settings share one config file without clobbering each other', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(CONFIG, 'utf8')), { skin: 'knight', scale: 3 });
});

test('the menu check marks follow the active skin and size', () => {
  assert.equal(submenuItem('Skin', 'Knight').checked, true);
  assert.equal(submenuItem('Skin', 'Footman').checked, false);
  assert.equal(submenuItem('Size', '3×').checked, true);
  assert.equal(submenuItem('Size', '1×').checked, false);
});
