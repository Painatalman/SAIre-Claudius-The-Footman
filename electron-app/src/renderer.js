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
  error: new Audio('../../assets/sounds/my-lord.mp3') // Use my-lord for error as placeholder
};

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

// Add a message to the stack. Returns its id. `opts` may carry prompt details
// (promptId, options, sessionId) for messages of type 'prompt'.
function pushMessage(type, text, opts = {}) {
  const { persistent = false, duration = 5000, promptId = null, options = null, sessionId = null } = opts;
  const id = ++messageSeq;
  const message = {
    id, type, text, persistent, settled: false, timer: null,
    promptId, options, sessionId, answered: false, shownAt: Date.now(),
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

// Turn any running "working" message into settled history that fades out, so
// the only animated line is the current task.
function settleWork() {
  for (const m of messages) {
    if (m.type === 'working' && !m.settled) {
      m.settled = true;
      m.persistent = false;
      if (m.timer) clearTimeout(m.timer);
      m.timer = setTimeout(() => removeMessage(m.id), 4000);
    }
  }
}

function clearStack() {
  for (const m of messages) if (m.timer) clearTimeout(m.timer);
  messages = [];
  renderStack();
}

// Render the whole stack. Prompt messages carry their own option buttons, so
// several prompts can stack and each stays independently answerable.
function renderStack() {
  const balloon = document.getElementById('speech-balloon');
  const textEl = document.getElementById('balloon-text');

  textEl.innerHTML = '';
  for (const m of messages) {
    const line = document.createElement('div');
    line.className = `balloon-msg balloon-msg-${m.type}${m.settled ? ' balloon-msg-settled' : ''}`;

    const label = document.createElement('div');
    label.textContent = m.text;
    if (m.type === 'working' && !m.settled) {
      const dots = document.createElement('span');
      dots.className = 'working-dots';
      dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
      label.appendChild(dots);
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

  const visible = messages.length > 0;
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

// Notification handlers — each adds to the stack instead of replacing it.
function notifyWorkComplete(message = 'Work complete!') {
  settleWork();
  pushMessage('complete', message, { duration: 6000 });
  playSound('workComplete');
}

function notifyWorking(taskDescription = 'Working') {
  // Strip any trailing dots — the animated ellipsis replaces them.
  const text = taskDescription.replace(/\.+\s*$/, '');
  const active = messages.find((m) => m.type === 'working' && !m.settled);
  if (active) {
    // Same ongoing task — update it in place rather than stacking duplicates.
    active.text = text;
    renderStack();
  } else {
    pushMessage('working', text, { persistent: true });
    playSound('atOnceSire');
  }
}

function notifyError(message = 'Something went wrong') {
  settleWork();
  pushMessage('error', message, { duration: 8000 });
  playSound('error');
}

function notifyPrompt(question, options = [], promptId = null, sessionId = null) {
  settleWork();
  const hasOptions = promptId && Array.isArray(options) && options.length > 0;
  if (hasOptions) {
    // An answerable prompt — keep it until answered or dismissed by liveness.
    pushMessage('prompt', question, { persistent: true, promptId, options, sessionId });
    ensurePromptPolling();
  } else {
    // A nudge with nothing to act on (e.g. an idle "My lord?") — let it fade.
    pushMessage('prompt', question, { duration: 6000 });
  }
  playSound('myLord');
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

  pushMessage('ack', 'As you wish!', { duration: 3000 });
  playSound('asYouWish');

  // Back to work.
  touchSession(message.sessionId, 'working');
  pushMessage('working', 'Working', { persistent: true });
}

// Mock notification system for testing
function startMockNotifications() {
  // Test sequence: idle -> working -> complete -> idle -> prompt
  let step = 0;

  setInterval(() => {
    step++;
    switch (step % 5) {
      case 0:
        clearStack();
        break;
      case 1:
        notifyWorking('Building project...');
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
    return;
  }
  const working = states.filter(s => s === 'working').length;
  const awaiting = states.length - working;
  bar.textContent = `⚔ ${working} · 💤 ${awaiting}`;
  bar.title = `${states.length} session(s) open — ${working} at work, ${awaiting} awaiting orders`;
  bar.classList.remove('hidden');
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
  const { type, message, options, sessionId, promptId } = data;

  switch (type) {
    case 'task_complete':
      touchSession(sessionId, 'idle');
      notifyWorkComplete(message);
      break;
    case 'task_working':
      touchSession(sessionId, 'working');
      notifyWorking(message);
      break;
    case 'prompt':
      touchSession(sessionId, 'awaiting');
      notifyPrompt(message, options, promptId, sessionId);
      break;
    case 'error':
      touchSession(sessionId, 'idle');
      notifyError(message);
      break;
    case 'session_start':
      // Bookkeeping only — no balloon or sound
      touchSession(sessionId, 'idle');
      break;
    case 'session_end':
      endSession(sessionId);
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
  notifyWorking
};
