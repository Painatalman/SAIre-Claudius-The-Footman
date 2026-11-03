// Demo mode: a scripted tour of the widget for an audience. Pure data and plain
// functions — no Electron imports — so it loads in the main process and under
// `node --test`, like skins.js.
//
// The tour is a list of steps. A step does exactly one thing: fire a
// notification, put a question to the audience, or switch the skin; then it
// lingers (`hold`) so the person talking over it can keep up. The runner plays
// the steps through the same HTTP API the hooks use, so what the audience sees
// is the real product, not a mock.
//
// Two rules keep it from leaving a mess behind:
//   - every session it invents is `demo-` prefixed, and every one is ended again
//     however the run finishes;
//   - it never answers a question itself and never writes the saved skin — the
//     only things that change what persists are the presenter's own clicks.

const { SKINS } = require('./skins');

const DEMO_PREFIX = 'demo-';

// How long a question waits for a click before the demo moves on without one.
const PATIENCE_MS = 45000;

// The widget drops a prompt once whatever is polling for its answer has been
// silent for 2.5s, so the poll has to beat well inside that. A question is on
// screen only while it is being polled: once the poll stops — answered, given up
// on, or the demo stopped — the widget clears it on its own.
const POLL_MS = 1000;

const MASK_OT = { id: `${DEMO_PREFIX}1`, cwd: '/demo/mask-ot' };
const STOREFRONT = { id: `${DEMO_PREFIX}2`, cwd: '/demo/storefront' };
const API_GATEWAY = { id: `${DEMO_PREFIX}3`, cwd: '/demo/api-gateway' };

const checkIn = (s) => ({ type: 'session_start', sessionId: s.id, cwd: s.cwd });
const working = (s) => ({ type: 'task_working', sessionId: s.id, cwd: s.cwd });
const complete = (s) => ({ type: 'task_complete', sessionId: s.id, cwd: s.cwd });

// The parade's three beats, played once per skin so each character is heard on
// its working, completed and question pools.
function paradeSteps(skinId) {
  const name = SKINS[skinId] ? SKINS[skinId].name : skinId;
  return [
    { act: `Skin parade: ${name}`, skin: skinId, hold: 1500 },
    { act: `${name} starts work`, notify: working(MASK_OT), hold: 2500 },
    { act: `${name} finishes`, notify: complete(MASK_OT), hold: 3000 },
    // A nudge, not a question: no options, so nothing waits on a click and the
    // widget writes the skin's own line.
    { act: `${name} asks`, notify: { type: 'prompt', sessionId: MASK_OT.id, cwd: MASK_OT.cwd }, hold: 3500 },
  ];
}

function buildScript(skinIds = Object.keys(SKINS)) {
  return [
    { act: 'A session checks in', notify: checkIn(MASK_OT), hold: 2500 },
    { act: 'Work begins', notify: working(MASK_OT), hold: 3500 },

    { act: 'A second project joins', notify: checkIn(STOREFRONT), hold: 800 },
    { act: 'A third project joins', notify: checkIn(API_GATEWAY), hold: 800 },
    { act: 'Storefront starts work', notify: working(STOREFRONT), hold: 1500 },
    { act: 'API gateway starts work', notify: working(API_GATEWAY), hold: 3000 },

    {
      act: 'A question',
      ask: {
        type: 'prompt',
        message: 'Which package manager should I use?',
        options: ['npm', 'pnpm', 'yarn'],
        sessionId: MASK_OT.id,
        cwd: MASK_OT.cwd,
      },
      hold: 3500,
    },
    {
      act: 'A question with several answers',
      ask: {
        type: 'prompt',
        message: 'Which checks should I run before committing?',
        options: ['Lint', 'Unit tests', 'Type check', 'Build'],
        multiSelect: true,
        sessionId: MASK_OT.id,
        cwd: MASK_OT.cwd,
      },
      hold: 3500,
    },
    {
      act: 'A permission request',
      ask: {
        type: 'prompt',
        kind: 'permission',
        // "<tool>\n<detail>" — the shape the permission hook packs and the widget unpacks.
        message: 'Bash\nnpm test -- --coverage',
        detailKind: 'command',
        options: ['Allow', 'Always allow Bash(npm test:*)', 'Deny'],
        sessionId: MASK_OT.id,
        cwd: MASK_OT.cwd,
      },
      hold: 3500,
    },

    { act: 'Work completes', notify: complete(MASK_OT), hold: 4000 },
    { act: 'Storefront signs off', notify: { type: 'session_end', sessionId: STOREFRONT.id }, hold: 800 },
    { act: 'API gateway signs off', notify: { type: 'session_end', sessionId: API_GATEWAY.id }, hold: 1500 },
    {
      act: 'Something breaks',
      notify: { type: 'error', message: 'Build failed: 2 type errors in src/cart.ts', sessionId: MASK_OT.id, cwd: MASK_OT.cwd },
      hold: 4500,
    },

    ...skinIds.flatMap(paradeSteps),
  ];
}

// Resolves after `ms`, or at once if the demo is stopped, so "Stop demo" is
// felt immediately instead of after the current hold runs out.
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

// Talk to the widget's own server the way the hooks do.
function createTransport(baseUrl, fetchImpl = globalThis.fetch) {
  return {
    async notify(payload) {
      const res = await fetchImpl(`${baseUrl}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Widget refused ${payload.type}: HTTP ${res.status}`);
    },

    // The answer, once there is one. Every poll doubles as the heartbeat that
    // keeps the prompt on screen, so an unreachable server is "not yet" rather
    // than a reason to abandon the question.
    async poll(promptId) {
      try {
        const res = await fetchImpl(`${baseUrl}/response/${promptId}`);
        if (!res.ok) return undefined;
        return (await res.json()).choice;
      } catch {
        return undefined;
      }
    },
  };
}

// Play the steps. `io` supplies everything with a side effect — the transport,
// the skin, the clock — so the runner itself can be tested without any of them.
async function runDemo(steps, io) {
  const { notify, poll, getSkin, setSkin, sleep: wait, newId, signal, log = () => {} } = io;
  const startSkin = getSkin();
  const open = new Set(); // sessions this run has registered and not yet ended

  async function send(payload) {
    if (payload.type === 'session_start') open.add(payload.sessionId);
    if (payload.type === 'session_end') open.delete(payload.sessionId);
    await notify(payload);
  }

  // Put a question up and keep it alive until it is answered or its patience runs out.
  async function ask(payload) {
    const promptId = newId();
    await send({ ...payload, promptId });
    for (let i = 0; i < Math.ceil(PATIENCE_MS / POLL_MS) && !signal.aborted; i++) {
      const choice = await poll(promptId);
      if (choice !== undefined) return;
      await wait(POLL_MS, signal);
    }
  }

  try {
    for (const step of steps) {
      if (signal.aborted) break;
      log(step.act);
      if (step.skin) setSkin(step.skin);
      if (step.notify) await send(step.notify);
      if (step.ask) await ask(step.ask);
      await wait(step.hold, signal);
    }
  } finally {
    for (const sessionId of open) {
      try { await notify({ type: 'session_end', sessionId }); } catch { /* the widget is gone; nothing left to tidy */ }
    }
    setSkin(startSkin);
  }
}

module.exports = { DEMO_PREFIX, PATIENCE_MS, POLL_MS, buildScript, runDemo, createTransport, sleep };
