// Tests for demo mode: the scripted tour the tray's "Demo mode" plays.
//
// The script and the runner are pure — nothing here needs Electron or a socket.
// The last test plays the whole script into the real renderer.js (via the jsdom
// harness) because a payload the renderer silently ignores is the failure that
// would only show up in front of an audience.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import demo from './demo.js';
import skins from './skins.js';
import { createRenderer, closeAll } from './renderer-harness.mjs';

const { buildScript, runDemo, createTransport, DEMO_PREFIX, PATIENCE_MS, POLL_MS } = demo;
const { SKINS } = skins;

after(closeAll);

const SKIN_IDS = Object.keys(SKINS);

const payloads = (steps) => steps.flatMap((s) => [s.notify, s.ask]).filter(Boolean);
const asks = (steps) => steps.filter((s) => s.ask).map((s) => s.ask);

// ---- The script ---------------------------------------------------------------

test('every session the demo invents is recognisable by its demo- prefix', () => {
  const ids = payloads(buildScript(SKIN_IDS)).map((p) => p.sessionId).filter(Boolean);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(id.startsWith(DEMO_PREFIX), `${id} lacks the ${DEMO_PREFIX} prefix`);
});

test('the demo opens by checking a session in, so the counter has something to count', () => {
  const [first] = buildScript(SKIN_IDS);
  assert.equal(first.notify.type, 'session_start');
  assert.ok(first.notify.cwd, 'a session with no project would be labelled by its id');
});

test('every step does exactly one thing and says how long to linger on it', () => {
  for (const step of buildScript(SKIN_IDS)) {
    const things = ['notify', 'ask', 'skin'].filter((k) => step[k]);
    assert.equal(things.length, 1, `"${step.act}" does ${things.join(' + ') || 'nothing'}`);
    assert.ok(step.act, 'every step is named, so a log line can say where the demo is');
    assert.ok(step.hold > 0, `"${step.act}" has no hold, so the next beat would land on top of it`);
  }
});

test('a single question offers choices; a multi-pick one says so and nothing else does', () => {
  const questions = asks(buildScript(SKIN_IDS)).filter((p) => p.kind !== 'permission');
  const multi = questions.filter((p) => p.multiSelect === true);
  const single = questions.filter((p) => !p.multiSelect);

  assert.equal(multi.length, 1);
  assert.equal(single.length, 1);
  for (const q of questions) {
    assert.ok(q.message, 'a question with no text would be a row of unlabelled buttons');
    assert.ok(q.options.length >= 2);
  }
  assert.ok(multi[0].options.length >= 3, 'a checklist of two is just a button pair');
});

test('the permission request is packed as "<tool>\\n<detail>", the shape the widget unpacks', () => {
  const [perm, ...extra] = asks(buildScript(SKIN_IDS)).filter((p) => p.kind === 'permission');

  assert.equal(extra.length, 0);
  assert.match(perm.message, /^[^\n]+\n.+/s);
  assert.equal(perm.detailKind, 'command');
  assert.equal(perm.options[0], 'Allow');
  assert.match(perm.options[1], /^Always allow /);
  assert.equal(perm.options.at(-1), 'Deny');
});

test('no prompt payload carries a promptId — the runner mints a fresh one each time', () => {
  for (const p of payloads(buildScript(SKIN_IDS)).filter((p) => p.type === 'prompt')) {
    assert.equal(p.promptId, undefined);
  }
});

test('the skin parade visits every skin, in the order given', () => {
  const visited = buildScript(SKIN_IDS).filter((s) => s.skin).map((s) => s.skin);
  assert.deepEqual(visited, SKIN_IDS);

  assert.deepEqual(
    buildScript(['peon', 'knight']).filter((s) => s.skin).map((s) => s.skin),
    ['peon', 'knight'],
  );
});

test('each skin is made to speak on all three pools: working, completed, and a question', () => {
  const steps = buildScript(SKIN_IDS);
  const types = (from) => steps.slice(from + 1, from + 4).map((s) => s.notify?.type);

  steps.forEach((step, i) => {
    if (!step.skin) return;
    assert.deepEqual(types(i), ['task_working', 'task_complete', 'prompt'], `after switching to ${step.skin}`);
    // A nudge, not a question: the parade must not wait on a click.
    assert.equal(steps[i + 3].notify.options, undefined);
  });
});

// ---- The runner ---------------------------------------------------------------

// A runner wired to recorders. Sleeping is instant; polling answers at once
// unless a test says otherwise.
function harness(overrides = {}) {
  const controller = new AbortController();
  const calls = { notified: [], skins: [], polled: [], logged: [] };
  let skin = 'knight';
  let ids = 0;

  const io = {
    notify: async (payload) => { calls.notified.push(payload); },
    poll: async (id) => { calls.polled.push(id); return 'Allow'; },
    getSkin: () => skin,
    setSkin: (id) => { skin = id; calls.skins.push(id); },
    sleep: async () => {},
    newId: () => `prompt-${++ids}`,
    signal: controller.signal,
    log: (line) => calls.logged.push(line),
    ...overrides,
  };
  return { io, calls, controller };
}

test('the runner fires every step in order and ends each session it started, once', async () => {
  const { io, calls } = harness();
  const steps = buildScript(SKIN_IDS);
  await runDemo(steps, io);

  const started = calls.notified.filter((p) => p.type === 'session_start').map((p) => p.sessionId);
  const ended = calls.notified.filter((p) => p.type === 'session_end').map((p) => p.sessionId);

  assert.ok(started.length >= 2, 'the crowd act needs more than one session');
  assert.deepEqual([...ended].sort(), [...started].sort());
  assert.equal(new Set(ended).size, ended.length, 'a session must not be ended twice');
  assert.deepEqual(calls.notified.slice(0, 1).map((p) => p.type), ['session_start']);
});

test('an interactive prompt goes out with a fresh promptId and is polled under that id', async () => {
  const { io, calls } = harness();
  await runDemo(buildScript(SKIN_IDS), io);

  const prompts = calls.notified.filter((p) => p.promptId);
  assert.equal(prompts.length, asks(buildScript(SKIN_IDS)).length);
  assert.equal(new Set(prompts.map((p) => p.promptId)).size, prompts.length, 'ids must not repeat');
  assert.deepEqual(calls.polled, prompts.map((p) => p.promptId));
});

test('polling continues until the prompt is answered, then the demo moves on', async () => {
  let polls = 0;
  const { io, calls } = harness({
    poll: async (id) => { calls.polled.push(id); return ++polls < 3 ? undefined : 'npm'; },
  });
  const steps = [
    { act: 'ask', ask: { type: 'prompt', message: 'Q?', options: ['npm', 'pnpm'], sessionId: 'demo-1' }, hold: 1 },
    { act: 'after', notify: { type: 'task_complete', sessionId: 'demo-1' }, hold: 1 },
  ];
  await runDemo(steps, io);

  assert.equal(calls.polled.length, 3);
  assert.equal(calls.notified.at(-1).type, 'task_complete');
});

test('a prompt nobody answers is given up on after its patience, and the demo carries on', async () => {
  const { io, calls } = harness({ poll: async (id) => { calls.polled.push(id); return undefined; } });
  const steps = [
    { act: 'ask', ask: { type: 'prompt', message: 'Q?', options: ['a', 'b'], sessionId: 'demo-1' }, hold: 1 },
    { act: 'after', notify: { type: 'task_complete', sessionId: 'demo-1' }, hold: 1 },
  ];
  await runDemo(steps, io);

  assert.equal(calls.polled.length, Math.ceil(PATIENCE_MS / POLL_MS));
  assert.ok(calls.notified.some((p) => p.type === 'task_complete'), 'the next act still plays');
});

test('polling beats at the cadence the widget needs to keep the prompt on screen', async () => {
  // The widget drops a prompt whose poller has been silent for 2.5s.
  assert.ok(POLL_MS <= 1000);
  const sleeps = [];
  const { io } = harness({
    poll: async () => undefined,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  await runDemo([{ act: 'ask', ask: { type: 'prompt', message: 'Q?', options: ['a', 'b'], sessionId: 'demo-1' }, hold: 7 }], io);

  assert.ok(sleeps.filter((ms) => ms === POLL_MS).length >= 1);
  assert.equal(sleeps.at(-1), 7, 'the hold is slept after the answer or the give-up');
});

test('the skin is switched for skin steps and put back to what it was at the end', async () => {
  const { io, calls } = harness();
  await runDemo(buildScript(SKIN_IDS), io);

  assert.deepEqual(calls.skins.slice(0, -1), SKIN_IDS);
  assert.equal(calls.skins.at(-1), 'knight', 'the starting skin comes back');
});

test('stopping part-way fires no later step, but still ends the sessions and restores the skin', async () => {
  const { io, calls, controller } = harness();
  io.notify = async (payload) => {
    calls.notified.push(payload);
    if (payload.type === 'task_working') controller.abort(); // the presenter clicks "Stop demo"
  };
  await runDemo(buildScript(SKIN_IDS), io);

  assert.equal(calls.notified.filter((p) => p.type === 'prompt').length, 0, 'nothing after the stop');
  assert.ok(calls.notified.some((p) => p.type === 'session_end'));
  assert.equal(calls.skins.at(-1), 'knight');
});

test('a notification that fails stops the demo with the error, after cleaning up', async () => {
  const { io, calls } = harness();
  let n = 0;
  io.notify = async (payload) => {
    if (payload.type === 'session_end') { calls.notified.push(payload); return; }
    if (++n === 3) throw new Error('Widget not ready');
    calls.notified.push(payload);
  };

  await assert.rejects(runDemo(buildScript(SKIN_IDS), io), /Widget not ready/);
  assert.ok(calls.notified.some((p) => p.type === 'session_end'));
  assert.equal(calls.skins.at(-1), 'knight');
});

test('the runner logs each act, so a terminal shows where the demo is', async () => {
  const { io, calls } = harness();
  const steps = buildScript(SKIN_IDS);
  await runDemo(steps, io);
  assert.deepEqual(calls.logged.slice(0, steps.length), steps.map((s) => s.act));
});

// ---- The HTTP transport -------------------------------------------------------

function fakeFetch(handler) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  };
  return { fetchImpl, requests };
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('notify POSTs the payload as JSON to /notify, the way the hooks do', async () => {
  const { fetchImpl, requests } = fakeFetch(() => reply(200, { success: true }));
  await createTransport('http://localhost:6112', fetchImpl).notify({ type: 'session_start', sessionId: 'demo-1' });

  assert.deepEqual(requests, [{
    url: 'http://localhost:6112/notify',
    method: 'POST',
    body: { type: 'session_start', sessionId: 'demo-1' },
  }]);
});

test('notify throws when the widget refuses, rather than carrying on into an empty room', async () => {
  const { fetchImpl } = fakeFetch(() => reply(500, { error: 'Widget not ready' }));
  await assert.rejects(createTransport('http://x', fetchImpl).notify({ type: 'error' }), /500/);
});

test('poll returns the answer once there is one, and undefined while there is not', async () => {
  const answers = [reply(404, { pending: true }), reply(200, { choice: 'Allow' })];
  const { fetchImpl, requests } = fakeFetch(() => answers.shift());
  const { poll } = createTransport('http://localhost:6112', fetchImpl);

  assert.equal(await poll('abc'), undefined);
  assert.equal(await poll('abc'), 'Allow');
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), Array(2).fill('GET http://localhost:6112/response/abc'));
});

test('a poll that cannot reach the server counts as "not answered yet", not as a crash', async () => {
  const { fetchImpl } = fakeFetch(() => { throw new Error('ECONNRESET'); });
  assert.equal(await createTransport('http://x', fetchImpl).poll('abc'), undefined);
});

test('the transport never posts an answer on the audience\'s behalf', async () => {
  const { fetchImpl, requests } = fakeFetch(() => reply(404, {}));
  const t = createTransport('http://x', fetchImpl);
  await t.poll('abc');
  await t.notify({ type: 'task_working', sessionId: 'demo-1' }).catch(() => {});
  assert.ok(requests.every((r) => !r.url.includes('/response/') || r.method === 'GET'));
});

// ---- Against the real renderer ---------------------------------------------------

test('the whole demo plays through the real renderer, and leaves it empty and as it found it', async () => {
  const r = createRenderer({ skin: 'knight' });
  let skin = 'knight';
  const shown = {};      // what the balloon held the first time each prompt was polled
  const switches = [];   // [skin, how many clips had played when it was switched to]

  const io = {
    notify: async (payload) => r.notify(payload),
    poll: async (id) => {
      // Nothing clicks in this test, so earlier questions are still stacked in
      // the balloon; read only the newest one.
      const line = r.all('.balloon-msg-prompt').at(-1);
      shown[id] ??= {
        buttons: [...line.querySelectorAll('.balloon-option')].map((b) => b.textContent),
        checks: line.querySelectorAll('input[type=checkbox]').length,
      };
      return 'ok';
    },
    getSkin: () => skin,
    setSkin: (id) => {
      switches.push([id, r.played.length]);
      skin = id;
      r.ipc('skin-changed', id);
    },
    sleep: async () => {},
    newId: (() => { let n = 0; return () => `p${++n}`; })(),
    signal: new AbortController().signal,
  };
  await runDemo(buildScript(SKIN_IDS), io);

  // Every prompt really rendered: a row of buttons, a checklist, a permission with its three.
  const seen = Object.values(shown);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].buttons.slice(0, 2), asks(buildScript(SKIN_IDS))[0].options.slice(0, 2));
  assert.ok(seen[1].checks >= 3, 'the multi-pick question rendered as checkboxes');
  // (The widget adds its own "Other…" to every option set; it is not one of ours.)
  assert.deepEqual(
    seen[2].buttons.filter((b) => b !== 'Other…'),
    asks(buildScript(SKIN_IDS))[2].options,
  );

  // Each skin spoke on every pool while it was active.
  const ends = [...switches.slice(1).map(([, n]) => n), r.played.length];
  switches.slice(0, SKIN_IDS.length).forEach(([id, from], i) => {
    const clips = r.played.slice(from, ends[i]);
    for (const pool of ['working', 'complete', 'prompt']) {
      const files = new Set(SKINS[id].lines[pool].map((l) => l.file));
      assert.ok(clips.some((f) => files.has(f)), `${id} never spoke from its ${pool} pool`);
    }
  });

  // Left as it was found: the counter is empty and the starting skin is back.
  assert.ok(r.document.getElementById('session-status').classList.contains('hidden'), 'demo sessions linger in the counter');
  assert.equal(skin, 'knight');
  assert.equal(r.document.getElementById('footman-img').alt, SKINS.knight.name);
  r.close();
});
