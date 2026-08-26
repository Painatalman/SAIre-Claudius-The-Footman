// State management
let currentState = 'idle';

const {
  SKINS, DEFAULT_SKIN, pickLine,
  SCALES, DEFAULT_SCALE, avatarSize, windowSizeFor,
} = require('./skins');
const {
  CATEGORIES, toolCategory, parseToolName, elidePath, splitUrl, elideMiddle,
  highlightJsonLine, collapseLines,
} = require('./message-format');

// How much of a framed detail is shown before it folds behind a toggle.
const MAX_DETAIL_LINES = 8;

// The active skin: a portrait plus a set of voice lines. The main process picks
// it (FOOTMAN_SKIN or footman.config.json) and passes it in as --skin=<id>; the
// tray menu can swap it live.
let activeSkin = DEFAULT_SKIN;

// One Audio per distinct file of the active skin. Built up front so the first
// line of a session doesn't wait on a disk read, and keyed by filename because
// the working and ack pools share their clips (as do prompt and error).
let audio = new Map();

// Avatar scale (1×–3×). The main process owns the window's size; the renderer
// grows the portrait to match and keeps its resting-height maths in step, since
// that height is what it asks the window to shrink back to.
let activeScale = DEFAULT_SCALE;
let restingHeight = windowSizeFor(DEFAULT_SCALE).height;

function applyScale(scale) {
  activeScale = SCALES.includes(scale) ? scale : DEFAULT_SCALE;
  restingHeight = windowSizeFor(activeScale).height;
  document.documentElement.style.setProperty('--avatar-size', `${avatarSize(activeScale)}px`);
  requestResize();
  reportContentRects();
}

// Swap the whole skin — portrait and voices. Safe to call at any time.
function applySkin(skinId) {
  if (!SKINS[skinId]) {
    console.warn(`Unknown skin "${skinId}", keeping ${activeSkin}`);
    return;
  }
  activeSkin = skinId;
  loadPortrait();
  loadVoices();
}

function loadVoices() {
  const skin = SKINS[activeSkin];
  audio = new Map();
  for (const pool of Object.values(skin.lines)) {
    for (const line of pool) {
      if (audio.has(line.file)) continue;
      audio.set(line.file, new Audio(`../../assets/skins/${skin.dir}/${line.file}`));
    }
  }
}

// Play the line for an action and hand it back, so the caller can show its text.
// Lines for sound-only actions (working, error) carry no text.
function playLine(action) {
  const line = pickLine(activeSkin, action);
  const clip = line.file && audio.get(line.file);
  if (clip) {
    clip.currentTime = 0;
    clip.play().catch((err) => console.warn('Sound playback failed:', err));
  }
  return line;
}

// Load the active skin's portrait.
function loadPortrait() {
  const skin = SKINS[activeSkin];
  const portraitContainer = document.getElementById('footman-portrait');

  const img = document.createElement('img');
  img.src = `../../assets/skins/${skin.dir}/${skin.portrait}`;
  img.alt = skin.name;
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
// human-readable project (folder) name instead of a raw session id, and its name
// when one was supplied — a named agent, or a name set for the session.
const sessionCwd = new Map();
const sessionName = new Map();

// Add a message to the stack. Returns its id. `opts` may carry prompt details
// (promptId, options, sessionId) for messages of type 'prompt'.
function pushMessage(type, text, opts = {}) {
  const { persistent = false, duration = 5000, promptId = null, options = null, sessionId = null, workingSessions = null, kind = null, detailKind = null, multiSelect = false, cwd = null, name = null } = opts;
  const id = ++messageSeq;
  const message = {
    id, type, kind, detailKind, text, persistent, settled: false, timer: null,
    promptId, options, multiSelect, sessionId, cwd, name, workingSessions, answered: false, shownAt: Date.now(),
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

// The project (folder) name a working directory belongs to.
function projectFromCwd(cwd) {
  if (!cwd) return '';
  return String(cwd).split('/').filter(Boolean).pop() || '';
}

// "project · name" when both are known — the project first, since that is the
// grouping you scan by, with the name qualifying it.
function joinLabel(project, name) {
  if (project && name) return `${project} · ${name}`;
  return name || project || '';
}

// The project half of a label. Colour keys off this, so every agent working in
// a project shares its accent instead of fragmenting it.
function labelProject(label) {
  return String(label || '').split(' · ')[0];
}

// A human-readable label for a session: its project name and, when one was
// given, the name of whoever is working — falling back to a short id fragment.
function sessionLabel(sessionId) {
  const project = projectFromCwd(sessionCwd.get(sessionId));
  const label = joinLabel(project, sessionName.get(sessionId));
  if (label) return label;
  return sessionId ? shortSession(sessionId) : '';
}

// A message's label. Notifications from the MCP tools carry no session id — they
// describe themselves instead — so fall back to what the message itself brought.
function messageLabel(m) {
  if (m.sessionId && (sessionCwd.has(m.sessionId) || sessionName.has(m.sessionId))) {
    return sessionLabel(m.sessionId);
  }
  if (m.cwd || m.name) return joinLabel(projectFromCwd(m.cwd), m.name);
  return m.sessionId ? sessionLabel(m.sessionId) : '';
}

// A stable colour from a label (project name), so every message for the same
// project shares one accent. Dark enough to read against the cream balloon.
function labelColor(label) {
  if (!label) return null;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 360;
  return `hsl(${hash}, 60%, 36%)`;
}

// Colour for a session — keyed off its project, so two sessions in the same
// project look the same however they are named.
function sessionColor(sessionId) {
  return labelColor(labelProject(sessionLabel(sessionId)));
}

function messageColor(m) {
  return labelColor(labelProject(messageLabel(m)));
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

// Render the consolidated working line, each project coloured. The project is
// always named, even when only one is busy — the verb alone leaves you guessing
// which window just spoke.
function renderWorkingLabel(label, m) {
  const counts = projectCounts(m.workingSessions || []);
  // A session whose cwd we never learned has no name to show; fall back to the
  // bare verb rather than printing "Working on ".
  const projects = [...counts.keys()].filter(Boolean);

  if (projects.length === 0) {
    label.appendChild(document.createTextNode('Starting work'));
  } else {
    label.appendChild(document.createTextNode('Starting work on '));
    projects.forEach((name, i) => {
      const count = counts.get(name);
      const span = document.createElement('span');
      span.className = 'project-name';
      span.textContent = count > 1 ? `${name} ×${count}` : name;
      const c = labelColor(labelProject(name));
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
        const colour = labelColor(labelProject(name));

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

// Tag a message with the project (and name) it came from.
function appendSessionTag(label, m, colour) {
  const text = messageLabel(m);
  if (!text) return;
  const tag = document.createElement('span');
  tag.className = 'session-tag';
  tag.textContent = text;
  if (colour) tag.style.color = colour;
  label.appendChild(tag);
}

// A completion always names the project it finished, mirroring the working
// line — "Job's done!" on its own leaves you guessing which window just spoke.
function renderCompleteLabel(label, m, colour) {
  label.appendChild(document.createTextNode(m.text));

  const name = messageLabel(m);
  if (!name) return;

  label.appendChild(document.createTextNode(' on '));
  const span = document.createElement('span');
  span.className = 'project-name';
  span.textContent = name;
  span.style.fontWeight = 'bold';
  if (colour) span.style.color = colour;
  label.appendChild(span);
}

// Render a prompt's label. Permission requests (kind === 'permission') arrive
// as "tool\ndetail": the tool that wants to run on the first line, then what it
// wants to run on. Every other prompt (a plain question from footman_prompt, or
// a nudge) is just prose.
function renderPromptLabel(label, m, colour) {
  if (m.kind !== 'permission') {
    label.textContent = m.text;
    appendSessionTag(label, m, colour);
    return;
  }

  const text = m.text || '';
  const nl = text.indexOf('\n');
  const tool = nl === -1 ? text : text.slice(0, nl);
  const detail = nl === -1 ? '' : text.slice(nl + 1);

  label.appendChild(renderToolHeading(tool));
  appendSessionTag(label, m, colour);
  if (detail) label.appendChild(renderDetail(detail, m));
}

// The tool identity line: a category glyph, then a readable name. An MCP tool
// arrives as mcp__figma__get_design_context — a wall of underscores that hides
// which server is actually asking — so it is split into server and operation.
function renderToolHeading(tool) {
  const category = toolCategory(tool);
  const heading = document.createElement('span');
  heading.className = `tool-head tool-${category}`;

  const glyph = document.createElement('span');
  glyph.className = 'tool-glyph';
  glyph.textContent = CATEGORIES[category].glyph;
  heading.appendChild(glyph);

  const { server, name, display } = parseToolName(tool);
  if (server) {
    const srv = document.createElement('span');
    srv.className = 'tool-server';
    srv.textContent = server;
    heading.appendChild(srv);
    heading.appendChild(document.createTextNode(` · ${name}`));
  } else {
    heading.appendChild(document.createTextNode(display));
  }
  return heading;
}

// Show the request as what it actually is: a path is not a command, and neither
// is a JSON payload. Without a detailKind — an older hook — fall back to the
// framed code block everything used to get.
function renderDetail(detail, m) {
  const wrap = document.createElement('div');
  wrap.className = 'balloon-detail';

  switch (m.detailKind) {
    case 'path': wrap.appendChild(renderPathDetail(detail)); break;
    case 'url': wrap.appendChild(renderUrlDetail(detail)); break;
    case 'text': wrap.appendChild(renderTextDetail(detail)); break;
    case 'json': wrap.appendChild(renderFrame(detail, m, 'json')); break;
    case 'command': wrap.appendChild(renderFrame(detail, m, 'command')); break;
    default: wrap.appendChild(renderFrame(detail, m, null));
  }

  wrap.appendChild(renderDetailActions(detail, m));
  return wrap;
}

// Copy and fold-out, in one row under the detail. Copy always yields the whole
// value — a truncated view is exactly when you most want the real thing, and
// silently copying the elided version would be worse than no button at all.
function renderDetailActions(detail, m) {
  const row = document.createElement('div');
  row.className = 'detail-actions';

  const copy = document.createElement('button');
  copy.className = 'detail-action';
  copy.textContent = '⧉ copy';
  copy.addEventListener('click', () => {
    clipboard.writeText(String(detail));
    copy.textContent = '✓ copied';
    copy.classList.add('detail-action-done');
    setTimeout(() => {
      copy.textContent = '⧉ copy';
      copy.classList.remove('detail-action-done');
    }, 1200);
  });
  row.appendChild(copy);

  const { hidden } = collapseLines(detail, MAX_DETAIL_LINES);
  if (hidden > 0) {
    const toggle = document.createElement('button');
    toggle.className = 'detail-action';
    toggle.textContent = m.expanded ? '⌃ show less' : `⌄ ${hidden} more lines`;
    toggle.addEventListener('click', () => { m.expanded = !m.expanded; renderStack(); });
    row.appendChild(toggle);
  }

  return row;
}

// A path, unframed: directories dimmed and the middle dropped, the file itself
// bold — the part you actually check before allowing a write.
function renderPathDetail(detail) {
  const { dir, base } = elidePath(detail);
  const el = document.createElement('div');
  el.className = 'balloon-path';

  if (dir) {
    const d = document.createElement('span');
    d.className = 'path-dir';
    d.textContent = dir;
    el.appendChild(d);
  }

  const b = document.createElement('span');
  b.className = 'path-base';
  b.textContent = base;
  el.appendChild(b);
  return el;
}

// A URL, unframed, with the host emphasised — the part that decides whether you
// trust the request at all.
function renderUrlDetail(detail) {
  const { scheme, host, rest } = splitUrl(detail);
  const el = document.createElement('div');
  el.className = 'balloon-url';

  const add = (text, cls) => {
    if (!text) return;
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    el.appendChild(span);
  };

  add(scheme, 'url-scheme');
  add(host, 'url-host');
  add(elideMiddle(rest, 48), 'url-rest');
  return el;
}

function renderTextDetail(detail) {
  const el = document.createElement('div');
  el.className = 'balloon-prose';
  el.textContent = detail;
  return el;
}

// The dark frame, for commands and JSON. Long blocks fold behind a toggle so a
// fat MCP payload can't grow the window to the top of the screen; the open
// state lives on the message, so an arriving notification doesn't re-collapse
// what was just expanded.
function renderFrame(detail, m, mode) {
  const pre = document.createElement('pre');
  pre.className = `balloon-code${mode === 'command' ? ' balloon-code-command' : ''}`;
  const code = document.createElement('code');

  const lines = m.expanded
    ? String(detail).split('\n')
    : collapseLines(detail, MAX_DETAIL_LINES).shown;

  lines.forEach((line, i) => {
    if (i > 0) code.appendChild(document.createTextNode('\n'));
    if (mode === 'json') appendJsonLine(code, line);
    else code.appendChild(document.createTextNode(line));
  });

  pre.appendChild(code);
  return pre;
}

// Colour JSON keys apart from their values, so a payload can be skimmed.
function appendJsonLine(code, line) {
  for (const { text, token } of highlightJsonLine(line)) {
    if (!token) {
      code.appendChild(document.createTextNode(text));
      continue;
    }
    const span = document.createElement('span');
    span.className = `json-${token}`;
    span.textContent = text;
    code.appendChild(span);
  }
}

// Single-select: one button per option, answered on the click.
function renderOptionButtons(m) {
  const opts = document.createElement('div');
  opts.className = 'balloon-options';

  m.options.forEach((option) => {
    const btn = document.createElement('button');
    btn.className = 'balloon-option';
    btn.textContent = option;
    btn.addEventListener('click', () => answerPrompt(m, option));
    opts.appendChild(btn);
  });

  renderOtherOption(opts, m);
  return opts;
}

// Multi-select: tick as many as apply, then Confirm. The ticks live on the
// message so a re-render mid-answer doesn't clear them, and Confirm stays
// disabled while nothing is ticked — an empty answer defers to Claude Code's
// own picker, which is a confusing way to lose your clicks.
function renderChecklist(m) {
  if (!(m.picked instanceof Set)) m.picked = new Set();

  const opts = document.createElement('div');
  opts.className = 'balloon-options balloon-checklist';

  // Custom answers typed via "Other…" join the list as extra rows.
  for (const option of [...m.options, ...(m.extras || [])]) {
    const row = document.createElement('label');
    row.className = 'balloon-check';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = m.picked.has(option);
    box.addEventListener('change', () => {
      if (box.checked) m.picked.add(option);
      else m.picked.delete(option);
      renderStack();
    });

    row.appendChild(box);
    row.appendChild(document.createTextNode(option));
    opts.appendChild(row);
  }

  renderOtherOption(opts, m);

  const confirm = document.createElement('button');
  confirm.className = 'balloon-option balloon-confirm';
  confirm.textContent = m.picked.size > 0 ? `Confirm (${m.picked.size})` : 'Confirm';
  confirm.disabled = m.picked.size === 0;
  confirm.addEventListener('click', () => answerPrompt(m, [...m.picked]));
  opts.appendChild(confirm);

  return opts;
}

// Render the "Other…" affordance beneath a question's preset options: a button
// that, once clicked, becomes a text field for a custom answer. The open state
// and typed text live on the message so a re-render (e.g. a new notification
// arriving) doesn't discard a half-typed answer.
function renderOtherOption(opts, m) {
  if (!m.otherOpen) {
    const other = document.createElement('button');
    other.className = 'balloon-option balloon-option-other';
    other.textContent = 'Other…';
    other.addEventListener('click', () => { m.otherOpen = true; renderStack(); });
    opts.appendChild(other);
    return;
  }

  const form = document.createElement('div');
  form.className = 'balloon-other';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'balloon-other-input';
  input.placeholder = 'Type your answer…';
  input.value = m.otherText || '';
  input.addEventListener('input', () => { m.otherText = input.value; });

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;

    // On a checklist a custom answer is one more tick, not the whole answer.
    if (m.multiSelect) {
      m.extras = [...(m.extras || []), text];
      if (!(m.picked instanceof Set)) m.picked = new Set();
      m.picked.add(text);
      m.otherOpen = false;
      m.otherText = '';
      renderStack();
      return;
    }

    answerPrompt(m, text);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      m.otherOpen = false;
      m.otherText = '';
      renderStack();
    }
  });

  const send = document.createElement('button');
  send.className = 'balloon-option balloon-other-send';
  send.textContent = 'Send';
  send.addEventListener('click', submit);

  form.appendChild(input);
  form.appendChild(send);
  opts.appendChild(form);

  // Put the caret in the field when it first opens (and keep it at the end if a
  // re-render rebuilds the input mid-answer).
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
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
    const colour = messageColor(m);
    if (colour) {
      line.style.borderLeft = `3px solid ${colour}`;
      line.style.paddingLeft = '6px';
    }

    const label = document.createElement('div');
    if (m.type === 'working') {
      renderWorkingLabel(label, m);
    } else if (m.type === 'prompt') {
      renderPromptLabel(label, m, colour);
    } else if (m.type === 'complete') {
      renderCompleteLabel(label, m, colour);
    } else {
      label.textContent = m.text;
    }
    line.appendChild(label);

    if (m.type === 'prompt' && !m.answered && Array.isArray(m.options) && m.options.length > 0) {
      line.appendChild(m.multiSelect ? renderChecklist(m) : renderOptionButtons(m));
    }
    textEl.appendChild(line);
  }

  const visible = messages.length > 0 || panelShown;
  if (visible && !balloonShown) balloon.classList.add('balloon-fade-in');
  balloon.classList.toggle('hidden', !visible);
  if (!visible) balloon.classList.remove('balloon-fade-in');

  if (visible !== balloonShown) balloonShown = visible;
  updatePortraitState();
  requestResize();
  reportContentRects();
}

// Report the on-screen rectangles of the interactive content (portrait, the
// session counter, and the balloon) to the main process, which uses them to
// decide where the window is click-through. Window-relative coords, padded a
// hair so the very edge of each element is still grabbable. This replaces a
// hardcoded hit box that was larger than the visible Footman — the source of
// the "invisible barrier" of dead space around him.
function reportContentRects() {
  const PAD = 2;
  const rects = [];
  for (const id of ['footman-portrait', 'session-status', 'speech-balloon']) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    rects.push({
      left: r.left - PAD,
      top: r.top - PAD,
      right: r.right + PAD,
      bottom: r.bottom + PAD,
    });
  }
  ipcRenderer.send('content-rects', rects);
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
      ipcRenderer.send('resize-window', { height: restingHeight });
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
    playLine('working');
  }
}

// Notification handlers — each adds to the stack instead of replacing it.
function notifyWorkComplete(message = 'Work complete!', sessionId = null, origin = {}) {
  // The voice stays in character; the written line does not. "I'm alive!" has
  // personality but tells you nothing — a caller's own message is kept, since
  // it says more than either, and the default is plain wording.
  playLine('complete');
  const custom = message && message !== 'Work complete!' ? message : null;
  pushMessage('complete', custom || 'Work completed', { duration: 6000, sessionId, ...origin });
}

function notifyError(message = 'Something went wrong', sessionId = null, origin = {}) {
  pushMessage('error', message, { duration: 8000, sessionId, ...origin });
  playLine('error');
}

function notifyPrompt(question, opts = {}) {
  const { options = [], promptId = null, sessionId = null, kind = null, detailKind = null, multiSelect = false, cwd = null, name = null } = opts;
  const hasOptions = promptId && Array.isArray(options) && options.length > 0;
  const line = playLine('prompt');
  if (hasOptions) {
    // An answerable prompt — show the request verbatim, keep until resolved.
    pushMessage('prompt', question, { persistent: true, promptId, options, sessionId, kind, detailKind, multiSelect, cwd, name });
    ensurePromptPolling();
  } else {
    // A nudge with nothing to act on — use a varied greeting unless Claude sent
    // its own notification text.
    const text = question && question !== 'My lord?' ? question : line.text;
    pushMessage('prompt', text, { duration: 6000, sessionId, cwd, name });
  }
}

// Deliver the user's choice and return the Footman to the working state —
// once permission is granted (or a question answered), the agent resumes.
function answerPrompt(message, answer) {
  if (!message || message.answered) return;
  message.answered = true;
  // One label for a single-select question, an array of them for a checklist —
  // the hook understands both, and IPC carries either.
  ipcRenderer.send('prompt-response', { id: message.promptId, choice: answer });

  // Let the answered question linger briefly as history, then fade.
  message.persistent = false;
  if (message.timer) clearTimeout(message.timer);
  message.timer = setTimeout(() => removeMessage(message.id), 2000);

  const line = playLine('ack');
  pushMessage('ack', line.text, { duration: 3000 });

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
        notifyPrompt('Continue with tests?', { options: ['Yes', 'No'] });
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
  // The counter appears/disappears without resizing the window, so refresh the
  // click-through hit boxes here too.
  reportContentRects();
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
const { ipcRenderer, clipboard } = require('electron');

// The tray menu can change the skin mid-session; swapping in place keeps the
// session map and any live permission prompt intact.
ipcRenderer.on('skin-changed', (event, skinId) => applySkin(skinId));
ipcRenderer.on('scale-changed', (event, scale) => applyScale(scale));

ipcRenderer.on('notification', (event, data) => {
  const { type, kind, detailKind, message, options, multiSelect, sessionId, promptId, cwd, name } = data;

  // Remember the session's project directory, and the name of whoever is
  // working in it, for its human-readable label.
  if (sessionId && cwd) sessionCwd.set(sessionId, cwd);
  if (sessionId && name) sessionName.set(sessionId, name);

  switch (type) {
    case 'task_complete':
      touchSession(sessionId, 'idle');
      notifyWorkComplete(message, sessionId, { cwd, name });
      refreshWorking();
      break;
    case 'task_working':
      touchSession(sessionId, 'working');
      refreshWorking();
      break;
    case 'prompt':
      touchSession(sessionId, 'awaiting');
      notifyPrompt(message, { options, promptId, sessionId, kind, detailKind, multiSelect, cwd, name });
      refreshWorking();
      break;
    case 'error':
      touchSession(sessionId, 'idle');
      notifyError(message, sessionId, { cwd, name });
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
  // main.js resolves the skin (FOOTMAN_SKIN, then footman.config.json) and
  // passes it through as --skin=<id>, the same channel --dev arrives on.
  const argValue = (name) => {
    const arg = (process.argv || []).find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.slice(name.length + 3) : null;
  };
  applyScale(Number(argValue('scale')) || DEFAULT_SCALE);
  applySkin(argValue('skin') || DEFAULT_SKIN);
  setState('idle');
  startIdleFidget();

  // Report the resting hit box (just the portrait) once laid out, and again
  // whenever the main process resizes the window to fit a balloon — the
  // bottom-anchored content shifts on resize, so the boxes must be remeasured.
  requestAnimationFrame(reportContentRects);
  window.addEventListener('resize', reportContentRects);

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
