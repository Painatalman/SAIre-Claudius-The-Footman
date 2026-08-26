// Loads the real renderer.js into a jsdom window so its rendering can be tested
// in plain `node --test`, with no display and no Electron.
//
// renderer.js is a classic script, not a module: it has no exports and reaches
// for `document`, `require('electron')`, `Audio` and `process.argv` at load. So
// it is eval'd inside a window that has those prepared. Its top-level `function`
// declarations land on the window, which is how the tests reach them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Every window opened by a test. renderer.js runs intervals (the idle fidget,
// session pruning, prompt liveness) that keep the process alive, so a test that
// throws before closing its window would hang the whole run.
const OPEN = new Set();

export function closeAll() {
  for (const window of OPEN) window.close();
  OPEN.clear();
}

// Everything the renderer sent outwards during a test.
export function createRenderer({ skin = 'footman', scale = 1 } = {}) {
  const sent = [];           // ipcRenderer.send calls
  const copied = [];         // clipboard writes
  const played = [];         // audio files played
  const ipcHandlers = new Map();

  const dom = new JSDOM(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8'), {
    // 'outside-only' gives window.eval a real script context: injected globals
    // are visible to the script, and the script's own function declarations
    // come back out on the window. Without it, window.eval is Node's own eval
    // and the two sides can't see each other.
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const { window } = dom;
  OPEN.add(window);

  // requestResize defers through rAF. Running the callback synchronously keeps
  // resize assertions deterministic, and avoids jsdom's own animation loop —
  // which never idles, and so would hold the test process open.
  window.requestAnimationFrame = (cb) => { cb(0); return 0; };
  window.cancelAnimationFrame = () => {};

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
    }
    play() {
      played.push(this.src.split('/').pop());
      return Promise.resolve();
    }
  }

  const electronStub = {
    ipcRenderer: {
      send: (channel, payload) => sent.push({ channel, payload }),
      on: (channel, handler) => ipcHandlers.set(channel, handler),
    },
    clipboard: { writeText: (text) => copied.push(text) },
  };

  window.require = (id) => {
    if (id === 'electron') return electronStub;
    return require(path.join(HERE, id));
  };
  window.process = { argv: [`--skin=${skin}`, `--scale=${scale}`] };
  window.Audio = FakeAudio;
  // Prompt liveness polling would otherwise reach for a server that isn't there.
  window.fetch = () => Promise.reject(new Error('no server in tests'));

  window.eval(fs.readFileSync(path.join(HERE, 'renderer.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  return {
    window,
    document: window.document,
    sent,
    copied,
    played,
    // Deliver a notification the way the main process would.
    notify: (data) => ipcHandlers.get('notification')?.(null, data),
    ipc: (channel, payload) => ipcHandlers.get(channel)?.(null, payload),
    // The balloon's rendered lines, one element per message.
    lines: () => [...window.document.querySelectorAll('.balloon-msg')],
    text: (selector) => window.document.querySelector(selector)?.textContent ?? null,
    all: (selector) => [...window.document.querySelectorAll(selector)],
    close: () => { window.close(); OPEN.delete(window); },
  };
}
