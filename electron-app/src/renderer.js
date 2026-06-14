// State management
let currentState = 'idle';

// Resting window height, matched to BrowserWindow's initial height in main.js
const DEFAULT_WINDOW_HEIGHT = 180;
const sounds = {
  workComplete: new Audio('../../assets/sounds/work-completed.mp3'),
  yesMyLord: new Audio('../../assets/sounds/yes-my-lord.mp3'),
  atOnceSire: new Audio('../../assets/sounds/at-once-sire.mp3'),
  awaitingOrders: new Audio('../../assets/sounds/awaiting-orders.mp3'),
  myLord: new Audio('../../assets/sounds/my-lord.mp3'),
  asYouWish: new Audio('../../assets/sounds/as-you-wish.mp3'),
  yourCommand: new Audio('../../assets/sounds/your-command.mp3'),
  atYourService: new Audio('../../assets/sounds/at-your-service.mp3'),
  error: new Audio('../../assets/sounds/my-lord.mp3') // Use my-lord for error as placeholder
};

// Two voice lines per action, weighted — the Footman varies what he says (and
// the matching sound) so he feels less repetitive. The first is the more common.
const LINES = {
  prompt: [
    { text: 'My Lord?', sound: 'myLord', weight: 3 },
    { text: 'Your command?', sound: 'yourCommand', weight: 1 },
  ],
  ack: [
    { text: 'As you wish!', sound: 'asYouWish', weight: 3 },
    { text: 'At your service!', sound: 'atYourService', weight: 1 },
  ],
  working: [
    { sound: 'atOnceSire', weight: 3 },
    { sound: 'yesMyLord', weight: 1 },
  ],
  complete: [
    { text: 'Work complete!', sound: 'workComplete', weight: 3 },
    { text: 'It is done, my Lord!', sound: 'workComplete', weight: 1 },
  ],
};

// Pick a weighted-random line for an action.
function pickLine(action) {
  const lines = LINES[action] || [];
  const total = lines.reduce((sum, l) => sum + (l.weight || 1), 0);
  let r = Math.random() * total;
  for (const l of lines) {
    r -= l.weight || 1;
    if (r < 0) return l;
  }
  return lines[0] || {};
}

// Load authentic WC2 Footman portrait
function loadFootmanPortrait() {
  const portraitContainer = document.getElementById('footman-portrait');

  const img = document.createElement('img');
  img.src = '../../assets/sprites/footman.jpg';
  img.alt = 'Footman';
  img.id = 'footman-img';

  img.onerror = () => {
    console.error('Failed to load portrait:', img.src);
    portraitContainer.innerHTML = '<div style="width:64px;height:64px;background:#666;border:2px solid #333;"></div>';
  };

  portraitContainer.innerHTML = '';
  portraitContainer.appendChild(img);
  changeExpression('neutral');
}

// Change facial expression
function changeExpression(expression) {
  const portrait = document.getElementById('footman-portrait');
  const expressions = {
    neutral: { eyebrows: 0, mouth: 0 },
    satisfied: { eyebrows: 2, mouth: 2 },
    concerned: { eyebrows: -2, mouth: -2 },
    alert: { eyebrows: 3, mouth: 1 }
  };

  // This will be implemented when we have the actual SVG with animatable parts
  portrait.setAttribute('data-expression', expression);
}

// ---- Speech balloon: a stack of recent messages ----------------------------
// Messages accumulate instead of overwriting each other. Transient messages
// (completions, errors, acknowledgements) fade after a few seconds; the working
// status and permission prompts stay until they resolve.

const MAX_MESSAGES = 6;
let messages = [];        // { id, type, text, persistent, settled, timer, promptId, options, sessionId, answered, shownAt }
let messageSeq = 0;
let balloonShown = false;
let showSessionPanel = false; // toggled by clicking the session counter

// Remember each session's working directory so we can label its messages with a
// human-readable project (folder) name instead of a raw session id.
const sessionCwd = new Map();

// Add a message to the stack. Returns its id. `opts` may carry prompt details
// (promptId, options, sessionId) for messages of type 'prompt'.
function pushMessage(type, text, opts = {}) {
  const { persistent = false, duration = 5000, promptId = null, options = null, sessionId = null, workingSessions = null } = opts;
  const id = ++messageSeq;
  const message = {
    id, type, text, persistent, settled: false, timer: null,
    promptId, options, sessionId, workingSessions, answered: false, shownAt: Date.now(),
  };
  messages.push(message);

  // Keep the stack small — drop the oldest dismissable message first. Never
  // auto-drop an unanswered prompt; the user still needs to act on it.
  while (messages.length > MAX_MESSAGES) {
    const idx = messages.findIndex((m) => !m.persistent && !(m.type === 'prompt' && !m.answered));
    if (idx === -1) break;
    const [dropped] = messages.splice(idx, 1);
    if (dropped.timer) clearTimeout(dropped.timer);
  }

  if (!persistent && duration > 0) {
    message.timer = setTimeout(() => removeMessage(id), duration);
  }
  renderStack();
  return id;
}

function removeMessage(id) {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const [message] = messages.splice(idx, 1);
  if (message.timer) clearTimeout(message.timer);
  renderStack();
}

// A short, stable id fragment, used when no project name is known yet.
function shortSession(id) {
  const s = String(id || '');
  return s.length > 8 ? `#${s.slice(0, 8)}` : `#${s}`;
}

// A human-readable label for a session: its project (folder) name when we know
// the working directory, otherwise a short id fragment.
function sessionLabel(sessionId) {
  const cwd = sessionCwd.get(sessionId);
  if (cwd) {
    const name = String(cwd).split('/').filter(Boolean).pop();
    if (name) return name;
  }
  return sessionId ? shortSession(sessionId) : '';
}

// A stable colour from a label (project name), so every message for the same
// project shares one accent. Dark enough to read against the cream balloon.
function labelColor(label) {
  if (!label) return null;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 360;
  return `hsl(${hash}, 60%, 36%)`;
}

// Colour for a session — keyed off its project label, so two sessions in the
// same project look the same.
function sessionColor(sessionId) {
  return labelColor(sessionLabel(sessionId));
}

// Count sessions per project label, preserving first-seen order.
function projectCounts(sessionIds) {
  const counts = new Map();
  for (const id of sessionIds) {
    const label = sessionLabel(id);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

// Render the consolidated working line: "Working…" for a single project, or
// "Working on a, b, c…" (each project coloured) when several sessions are busy.
function renderWorkingLabel(label, m) {
  const counts = projectCounts(m.workingSessions || []);
  const projects = [...counts.keys()];

  // A single project (even with several sessions in it) → just "Working…".
  if (projects.length <= 1) {
    label.appendChild(document.createTextNode('Working'));
  } else {
    label.appendChild(document.createTextNode('Working on '));
    projects.forEach((name, i) => {
      const count = counts.get(name);
      const span = document.createElement('span');
      span.textContent = count > 1 ? `${name} ×${count}` : name;
      const c = labelColor(name);
      if (c) {
        span.style.color = c;
        span.style.fontWeight = 'bold';
      }
      label.appendChild(span);
      if (i < projects.length - 1) label.appendChild(document.createTextNode(', '));
    });
  }
  const dots = document.createElement('span');
  dots.className = 'working-dots';
  dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
  label.appendChild(dots);
}

// Toggle the session overview, shown by clicking the counter bar.
function toggleSessionPanel() {
  showSessionPanel = !showSessionPanel;
  renderStack();
}

// A breakdown of known sessions grouped into ongoing (working) and paused
// (awaiting an answer or idle), each labelled by project and colour.
function renderSessionPanel(parent) {
  const entries = [...sessions.entries()];
  const ongoing = entries.filter(([, s]) => s.state === 'working');
  const paused = entries.filter(([, s]) => s.state !== 'working');

  const panel = document.createElement('div');
  panel.className = 'session-panel';

  const group = (icon, title, ids) => {
    const g = document.createElement('div');
    g.className = 'session-group';

    const heading = document.createElement('div');
    heading.className = 'session-group-title';
    heading.textContent = `${icon} ${title} (${ids.length})`;
    g.appendChild(heading);

    const counts = projectCounts(ids); // one row per project, with a ×N count
    if (counts.size === 0) {
      const none = document.createElement('div');
      none.className = 'session-row session-none';
      none.textContent = '—';
      g.appendChild(none);
    } else {
      for (const [name, count] of counts) {
        const row = document.createElement('div');
        row.className = 'session-row';
        const colour = labelColor(name);

        const dot = document.createElement('span');
        dot.className = 'session-dot';
        if (colour) dot.style.background = colour;
        row.appendChild(dot);

        const label = document.createElement('span');
        label.textContent = count > 1 ? `${name} ×${count}` : name;
        if (colour) label.style.color = colour;
        row.appendChild(label);

        g.appendChild(row);
      }
    }
    panel.appendChild(g);
  };

  group('⚔', 'Ongoing', ongoing.map(([id]) => id));
  group('💤', 'Paused', paused.map(([id]) => id));
  parent.appendChild(panel);
}

function clearStack() {
  for (const m of messages) if (m.timer) clearTimeout(m.timer);
  messages = [];
  renderStack();
}

// A permission prompt arrives as "tool\ndetail": the tool name on the first
// line, then the command / file path / URL / JSON it wants to run. Show the
// tool name as a heading and the detail in a code preview — long lines scroll
// sideways instead of wrapping into an unreadable wall of text. A plain nudge
// (no detail line) just renders as its heading.
function renderPromptLabel(label, m, colour) {
  const text = m.text || '';
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? '' : text.slice(nl + 1);

  const heading = document.createElement('span');
  heading.textContent = head;
  label.appendChild(heading);

  // Tag the prompt with its session's project name.
  if (m.sessionId) {
    const tag = document.createElement('span');
    tag.className = 'session-tag';
    tag.textContent = sessionLabel(m.sessionId);
    if (colour) tag.style.color = colour;
    label.appendChild(tag);
  }

  if (body) {
    const pre = document.createElement('pre');
    pre.className = 'balloon-code';
    const code = document.createElement('code');
    code.textContent = body;
    pre.appendChild(code);
    label.appendChild(pre);
  }
}

// Render the whole stack. Prompt messages carry their own option buttons, so
// several prompts can stack and each stays independently answerable.
function renderStack() {
  const balloon = document.getElementById('speech-balloon');
  const textEl = document.getElementById('balloon-text');

  textEl.innerHTML = '';

  // Session overview, shown when the counter bar is clicked.
  const panelShown = showSessionPanel && sessions.size > 0;
  if (panelShown) renderSessionPanel(textEl);

  for (const m of messages) {
    const line = document.createElement('div');
    line.className = `balloon-msg balloon-msg-${m.type}${m.settled ? ' balloon-msg-settled' : ''}`;

    // Colour-code each line by session so concurrent sessions are easy to tell
    // apart at a glance.
    const colour = sessionColor(m.sessionId);
    if (colour) {
      line.style.borderLeft = `3px solid ${colour}`;
      line.style.paddingLeft = '6px';
    }

    const label = document.createElement('div');
    if (m.type === 'working') {
      renderWorkingLabel(label, m);
    } else if (m.type === 'prompt') {
      renderPromptLabel(label, m, colour);
    } else {
      label.textContent = m.text;
    }
    line.appendChild(label);

    if (m.type === 'prompt' && !m.answered && Array.isArray(m.options) && m.options.length > 0) {
      const opts = document.createElement('div');
      opts.className = 'balloon-options';
      m.options.forEach((option) => {
        const btn = document.createElement('button');
        btn.className = 'balloon-option';
        btn.textContent = option;
        btn.addEventListener('click', () => answerPrompt(m, option));
        opts.appendChild(btn);
      });
      line.appendChild(opts);
    }
    textEl.appendChild(line);
  }

  const visible = messages.length > 0 || panelShown;
  if (visible && !balloonShown) balloon.classList.add('balloon-fade-in');
  balloon.classList.toggle('hidden', !visible);
  if (!visible) balloon.classList.remove('balloon-fade-in');

  if (visible !== balloonShown) {
    balloonShown = visible;
    ipcRenderer.send('balloon-visible', balloonShown);
  }
  updatePortraitState();
  requestResize();
}

// The portrait animation follows the most salient current state.
function updatePortraitState() {
  let state = 'idle';
  if (messages.some((m) => m.type === 'prompt' && !m.answered)) state = 'prompt';
  else if (messages.some((m) => m.type === 'error')) state = 'error';
  else if (messages.some((m) => m.type === 'working' && !m.settled)) state = 'working';
  else if (messages.some((m) => m.type === 'complete')) state = 'complete';

  setState(state);
  changeExpression({ prompt: 'alert', error: 'concerned', complete: 'satisfied' }[state] || 'neutral');
}

// A prompt stays up until it is answered — here, in Claude Code's own UI, or by
// timing out. The hook (and the MCP server) poll GET /response/:id the whole
// time a prompt is live, so the widget polls GET /prompts/active to learn which
// prompts still have a poller behind them; the rest are stale and get dismissed.
const PROMPT_DISMISS_GRACE_MS = 3000;
let promptPollTimer = null;

function ensurePromptPolling() {
  if (promptPollTimer) return;
  promptPollTimer = setInterval(pollPromptLiveness, 1000);
}

async function pollPromptLiveness() {
  const pending = messages.filter((m) => m.type === 'prompt' && !m.answered && m.promptId);
  if (pending.length === 0) {
    clearInterval(promptPollTimer);
    promptPollTimer = null;
    return;
  }

  let active;
  try {
    const res = await fetch('http://localhost:6112/prompts/active');
    if (!res.ok) return;
    ({ active } = await res.json());
  } catch {
    return; // server unreachable — keep prompts rather than dismiss falsely
  }

  const live = new Set(active);
  const now = Date.now();
  for (const m of pending) {
    // Give the poller a moment to register before judging a prompt stale.
    if (now - m.shownAt < PROMPT_DISMISS_GRACE_MS) continue;
    if (!live.has(m.promptId)) removeMessage(m.id);
  }
}

// Resize the window so the whole balloon is visible. The balloon is anchored to
// the bottom of the window and grows upward, so tall messages are never clipped.
// When the balloon is hidden, the window returns to its resting height.
function requestResize() {
  requestAnimationFrame(() => {
    const balloon = document.getElementById('speech-balloon');
    if (!balloon || balloon.classList.contains('hidden')) {
      ipcRenderer.send('resize-window', { height: DEFAULT_WINDOW_HEIGHT });
      return;
    }
    // scrollHeight is the full content height even when max-height clamps it,
    // plus the container padding and balloon borders.
    const needed = balloon.scrollHeight + 40;
    ipcRenderer.send('resize-window', { height: needed });
  });
}

// Change widget state
function setState(state) {
  const container = document.getElementById('widget-container');

  // Remove all state classes
  container.className = '';

  // Add new state class
  container.classList.add(`state-${state}`);
  currentState = state;
}

// Play sound safely
function playSound(soundName) {
  if (sounds[soundName]) {
    sounds[soundName].currentTime = 0;
    sounds[soundName].play().catch(err => {
      console.warn('Sound playback failed:', err);
    });
  }
}

// Maintain the single, consolidated working line from the set of sessions that
// are currently working. One project → "Working…"; several → a project list.
function refreshWorking() {
  const ids = [...sessions.entries()].filter(([, s]) => s.state === 'working').map(([id]) => id);
  const existing = messages.find((m) => m.type === 'working');

  if (ids.length === 0) {
    if (existing) removeMessage(existing.id);
    return;
  }

  // Colour the line by project when every working session is in the same one.
  const oneProject = new Set(ids.map(sessionLabel)).size === 1;
  const colourId = oneProject ? ids[0] : null;

  if (existing) {
    existing.workingSessions = ids;
    existing.sessionId = colourId;
    renderStack();
  } else {
    pushMessage('working', 'Working', {
      persistent: true,
      sessionId: colourId,
      workingSessions: ids,
    });
    playSound(pickLine('working').sound);
  }
}

// Notification handlers — each adds to the stack instead of replacing it.
function notifyWorkComplete(message = 'Work complete!', sessionId = null) {
  const line = pickLine('complete');
  // Vary the default phrasing, but keep a custom completion message as-is.
  const text = message && message !== 'Work complete!' ? message : line.text;
  pushMessage('complete', text, { duration: 6000, sessionId });
  playSound(line.sound);
}

function notifyError(message = 'Something went wrong', sessionId = null) {
  pushMessage('error', message, { duration: 8000, sessionId });
  playSound('error');
}

function notifyPrompt(question, options = [], promptId = null, sessionId = null) {
  const hasOptions = promptId && Array.isArray(options) && options.length > 0;
  const line = pickLine('prompt');
  if (hasOptions) {
    // An answerable prompt — show the request verbatim, keep until resolved.
    pushMessage('prompt', question, { persistent: true, promptId, options, sessionId });
    ensurePromptPolling();
  } else {
    // A nudge with nothing to act on — use a varied greeting unless Claude sent
    // its own notification text.
    const text = question && question !== 'My lord?' ? question : line.text;
    pushMessage('prompt', text, { duration: 6000 });
  }
  playSound(line.sound);
}

// Deliver the user's choice and return the Footman to the working state —
// once permission is granted (or a question answered), the agent resumes.
function answerPrompt(message, option) {
  if (!message || message.answered) return;
  message.answered = true;
  ipcRenderer.send('prompt-response', { id: message.promptId, choice: option });

  // Let the answered question linger briefly as history, then fade.
  message.persistent = false;
  if (message.timer) clearTimeout(message.timer);
  message.timer = setTimeout(() => removeMessage(message.id), 2000);

  const line = pickLine('ack');
  pushMessage('ack', line.text, { duration: 3000 });
  playSound(line.sound);

  // Back to work — mark this session working again and refresh the working line.
  touchSession(message.sessionId, 'working');
  refreshWorking();
}

// Mock notification system for testing
function startMockNotifications() {
  // Test sequence: idle -> working -> complete -> idle -> prompt
  let step = 0;

  setInterval(() => {
    step++;
    switch (step % 5) {
      case 0:
        endSession('mock-session');
        clearStack();
        break;
      case 1:
        touchSession('mock-session', 'working');
        refreshWorking();
        break;
      case 2:
        notifyWorkComplete('Build successful!');
        break;
      case 3:
        notifyPrompt('Continue with tests?', ['Yes', 'No']);
        break;
      case 4:
        notifyError('Test failed');
        break;
    }
  }, 4000);
}

// Per-session state tracking for the session counter
const sessions = new Map();

function touchSession(sessionId, state) {
  if (!sessionId) return;
  sessions.set(sessionId, { state, lastSeen: Date.now() });
  updateSessionStatus();
}

function endSession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
  updateSessionStatus();
}

function updateSessionStatus() {
  const bar = document.getElementById('session-status');
  const states = [...sessions.values()].map(s => s.state);
  if (states.length === 0) {
    bar.classList.add('hidden');
    if (showSessionPanel) { showSessionPanel = false; renderStack(); }
    return;
  }
  const working = states.filter(s => s === 'working').length;
  const awaiting = states.length - working;
  bar.textContent = `⚔ ${working} · 💤 ${awaiting}`;
  bar.title = `${states.length} session(s) open — ${working} ongoing, ${awaiting} paused — click for details`;
  bar.classList.remove('hidden');
  // Keep the open overview in sync as sessions change.
  if (showSessionPanel) renderStack();
}

// Prune sessions silent for 6+ hours (closed without a session_end event)
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (changed) updateSessionStatus();
}, 60 * 1000);

// Listen for notifications from main process
const { ipcRenderer } = require('electron');

ipcRenderer.on('notification', (event, data) => {
  const { type, message, options, sessionId, promptId, cwd } = data;

  // Remember the session's project directory for its human-readable label.
  if (sessionId && cwd) sessionCwd.set(sessionId, cwd);

  switch (type) {
    case 'task_complete':
      touchSession(sessionId, 'idle');
      notifyWorkComplete(message, sessionId);
      refreshWorking();
      break;
    case 'task_working':
      touchSession(sessionId, 'working');
      refreshWorking();
      break;
    case 'prompt':
      touchSession(sessionId, 'awaiting');
      notifyPrompt(message, options, promptId, sessionId);
      refreshWorking();
      break;
    case 'error':
      touchSession(sessionId, 'idle');
      notifyError(message, sessionId);
      refreshWorking();
      break;
    case 'session_start':
      // Bookkeeping only — no balloon or sound
      touchSession(sessionId, 'idle');
      break;
    case 'session_end':
      endSession(sessionId);
      refreshWorking();
      break;
    default:
      console.warn('Unknown notification type:', type);
  }
});

// Occasional fidget while idle, so he feels alive between tasks
function startIdleFidget() {
  setInterval(() => {
    if (currentState !== 'idle') return;
    const portrait = document.getElementById('footman-portrait');
    portrait.classList.add('fidget');
    setTimeout(() => portrait.classList.remove('fidget'), 600);
  }, 25000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadFootmanPortrait();
  setState('idle');
  startIdleFidget();

  // Click the session counter to expand/collapse the ongoing-vs-paused overview.
  const statusBar = document.getElementById('session-status');
  if (statusBar) statusBar.addEventListener('click', toggleSessionPanel);

  // Start mock notifications in development
  if (process.argv && process.argv.includes('--dev')) {
    setTimeout(() => startMockNotifications(), 2000);
  }
});

// Export for HTTP server to use later
window.FootmanWidget = {
  notifyWorkComplete,
  notifyPrompt,
  notifyError,
  refreshWorking
};
