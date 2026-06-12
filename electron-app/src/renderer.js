// State management
let currentState = 'idle';
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

// Show speech balloon
function showBalloon(text, duration = 5000) {
  const balloon = document.getElementById('speech-balloon');
  const balloonText = document.getElementById('balloon-text');

  // Clear any leftover answer buttons from a previous prompt
  document.getElementById('balloon-options').innerHTML = '';

  balloonText.textContent = text;
  balloon.classList.remove('hidden');
  balloon.classList.add('balloon-fade-in');

  if (duration > 0) {
    setTimeout(() => {
      balloon.classList.add('hidden');
    }, duration);
  }
}

// Hide speech balloon
function hideBalloon() {
  const balloon = document.getElementById('speech-balloon');
  balloon.classList.add('hidden');
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

// Notification handlers
function notifyWorkComplete(message = 'Work complete!') {
  setState('complete');
  changeExpression('satisfied');
  showBalloon(message, 5000);
  playSound('workComplete');

  setTimeout(() => {
    setState('idle');
    changeExpression('neutral');
  }, 5000);
}

function notifyPrompt(question, options = [], promptId = null) {
  setState('prompt');
  changeExpression('alert');
  showBalloon(question, 0); // Don't auto-hide
  playSound('myLord');

  // Render clickable answer options when the prompt expects a response
  if (promptId && Array.isArray(options) && options.length > 0) {
    const container = document.getElementById('balloon-options');
    options.forEach(option => {
      const btn = document.createElement('button');
      btn.className = 'balloon-option';
      btn.textContent = option;
      btn.addEventListener('click', () => {
        ipcRenderer.send('prompt-response', { id: promptId, choice: option });
        showBalloon('As you wish!', 3000);
        playSound('asYouWish');
        setState('idle');
        changeExpression('neutral');
      });
      container.appendChild(btn);
    });
  }
}

function notifyError(message = 'Something went wrong') {
  setState('error');
  changeExpression('concerned');
  showBalloon(message, 5000);
  playSound('error');

  setTimeout(() => {
    setState('idle');
    changeExpression('neutral');
  }, 5000);
}

function notifyWorking(taskDescription = 'Working') {
  setState('working');
  changeExpression('neutral');
  // Strip any trailing dots — the animated ellipsis replaces them
  showBalloon(taskDescription.replace(/\.+\s*$/, ''), 0); // Keep showing until done
  appendWorkingDots();
  playSound('atOnceSire');
}

// Animated "..." appended to the balloon while working
function appendWorkingDots() {
  const balloonText = document.getElementById('balloon-text');
  const dots = document.createElement('span');
  dots.className = 'working-dots';
  dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
  balloonText.appendChild(dots);
}

// Mock notification system for testing
function startMockNotifications() {
  // Test sequence: idle -> working -> complete -> idle -> prompt
  let step = 0;

  setInterval(() => {
    step++;
    switch (step % 5) {
      case 0:
        setState('idle');
        hideBalloon();
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
      notifyPrompt(message, options, promptId);
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
