// Wiring tests for the main process. main.js can't be imported normally — it
// talks to Electron at load — so Electron, the notification server and the demo
// runner are stubbed in the require cache and the real file is loaded on top of them.
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

import skins from './skins.js';

const { SKINS } = skins;

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'footman-')), 'config.json');

// What the stubs record, so a test can inspect what main.js did.
const recorded = {
  menu: null,          // the tray menu template, as built
  sent: [],            // messages pushed to the renderer
  bounds: { x: 100, y: 500, width: 380, height: 180 },
  windowArgs: null,
  onceLoaded: null,    // the did-finish-load callback main.js registered, if any
};

const noop = () => {};

// One turn of the event loop: enough for a resolved promise's handlers to run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

const webContents = {
  send: (channel, payload) => recorded.sent.push({ channel, payload }),
  once: (event, callback) => { if (event === 'did-finish-load') recorded.onceLoaded = callback; },
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

// The demo itself is tested in demo.test.mjs. Here main.js is the subject — how
// it starts, stops and lends the demo the widget's skin — so the runner is a
// stand-in that hands back what main gave it and ends when a test says so.
const demoCalls = { skinIds: null, base: null, steps: null, io: null, finish: null, fail: null };

const demoStub = {
  buildScript: (skinIds) => { demoCalls.skinIds = skinIds; return ['the', 'script']; },
  createTransport: (base) => {
    demoCalls.base = base;
    return { notify: async () => {}, poll: async () => undefined };
  },
  sleep: async () => {},
  runDemo: (steps, io) => {
    demoCalls.steps = steps;
    demoCalls.io = io;
    return new Promise((resolve, reject) => { demoCalls.finish = resolve; demoCalls.fail = reject; });
  },
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
    exports: { start: noop, setWindow: noop, storeResponse: noop, PORT: 6112 },
  };
  require.cache[require.resolve('./demo.js')] = { id: 'demo', filename: 'demo', loaded: true, exports: demoStub };

  // Launched as `electron . --demo`, so main.js has to arrange for the demo to start.
  process.argv.push('--demo');
  require(path.join(HERE, 'main.js'));
  await settle(); // let whenReady() run
  process.argv.pop();
});

test('the tray menu offers every skin and every size', () => {
  // Against the manifest rather than a literal list: the menu is built from
  // SKINS, so adding a skin should not need this test edited.
  const names = Object.values(SKINS).map((s) => s.name);
  assert.deepEqual(item('Skin').submenu.map((s) => s.label), names);
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

// ---- Demo mode ------------------------------------------------------------------

test('the tray offers Demo mode, and the Skin menu is usable while it is idle', () => {
  assert.equal(item('Demo mode').label, 'Demo mode');
  assert.ok(item('Skin').submenu.every((entry) => entry.enabled));
});

test('clicking Demo mode plays the tour over the server\'s own port, through every skin', () => {
  item('Demo mode').click();

  assert.deepEqual(demoCalls.skinIds, Object.keys(SKINS));
  assert.equal(demoCalls.base, 'http://localhost:6112');
  assert.deepEqual(demoCalls.steps, ['the', 'script']);
  assert.equal(item('Stop demo').label, 'Stop demo', 'the same entry now stops it');
});

test('while the demo plays, the Skin menu is locked so a pick cannot be saved over its own restore', () => {
  assert.ok(item('Skin').submenu.every((entry) => entry.enabled === false));
});

test('the demo can change the skin live without saving it', () => {
  const saved = fs.readFileSync(CONFIG, 'utf8');
  const { io } = demoCalls;
  assert.equal(io.getSkin(), 'knight');

  recorded.sent.length = 0;
  io.setSkin('peasant');

  assert.deepEqual(recorded.sent, [{ channel: 'skin-changed', payload: 'peasant' }]);
  assert.equal(io.getSkin(), 'peasant');
  assert.equal(submenuItem('Skin', 'Peasant').checked, true, 'the menu check follows the parade');
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), saved, 'the demo must not rewrite footman.config.json');

  io.setSkin('knight'); // what the runner does when the tour ends
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), saved);
});

test('Stop demo aborts the run the demo was given', () => {
  const { signal } = demoCalls.io;
  assert.equal(signal.aborted, false);

  item('Stop demo').click();

  assert.equal(signal.aborted, true);
});

test('once the demo has ended the menu goes back to Demo mode and the Skin menu unlocks', async () => {
  demoCalls.finish();
  await settle();

  assert.equal(item('Demo mode').label, 'Demo mode');
  assert.ok(item('Skin').submenu.every((entry) => entry.enabled));
});

test('a demo that fails is reported, and the menu still recovers', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    item('Demo mode').click();
    demoCalls.fail(new Error('Widget refused task_working: HTTP 500'));
    await settle();
  } finally {
    console.error = realError;
  }

  assert.match(errors.join('\n'), /Widget refused task_working/);
  assert.equal(item('Demo mode').label, 'Demo mode');
  assert.ok(item('Skin').submenu.every((entry) => entry.enabled));
});

test('launching with --demo starts the tour once the window has loaded', async () => {
  assert.equal(typeof recorded.onceLoaded, 'function', 'main.js should wait for the window to load');
  assert.equal(item('Demo mode').label, 'Demo mode', 'not before it has loaded');

  recorded.onceLoaded();
  assert.equal(item('Stop demo').label, 'Stop demo');

  item('Stop demo').click();
  demoCalls.finish();
  await settle();
});
