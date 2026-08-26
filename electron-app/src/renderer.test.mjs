// Rendering tests against the real renderer.js, running in jsdom.
// These cover what the user actually sees in the balloon: what a status line
// says, how a permission request is broken apart, and what a click sends back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer, closeAll } from './renderer-harness.mjs';

// A test that throws skips its own close(); without this the run would hang.
after(closeAll);

const CWD = '/Users/me/code/mask-ot';

// A renderer with one registered session, ready to receive notifications.
function withSession(opts = {}) {
  const r = createRenderer(opts);
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD });
  return r;
}

function permission(overrides = {}) {
  return {
    type: 'prompt',
    kind: 'permission',
    sessionId: 's1',
    promptId: 'p1',
    options: ['Allow', 'Deny'],
    ...overrides,
  };
}

// ---- Status lines -----------------------------------------------------------

test('the working line names the project even when only one is busy', () => {
  const r = withSession();
  r.notify({ type: 'task_working', sessionId: 's1' });

  assert.match(r.text('.balloon-msg-working'), /Starting work on mask-ot/);
  r.close();
});

test('the working line lists every busy project', () => {
  const r = withSession();
  r.notify({ type: 'session_start', sessionId: 's2', cwd: '/Users/me/code/other-app' });
  r.notify({ type: 'task_working', sessionId: 's1' });
  r.notify({ type: 'task_working', sessionId: 's2' });

  const line = r.text('.balloon-msg-working');
  assert.match(line, /mask-ot/);
  assert.match(line, /other-app/);
  r.close();
});

test('a completion uses plain wording and names the project', () => {
  const r = withSession();
  r.notify({ type: 'task_complete', message: 'Work complete!', sessionId: 's1' });

  assert.equal(r.text('.balloon-msg-complete'), 'Work completed on mask-ot');
  r.close();
});

// A caller's own message says more than either the default or the themed line.
test("a completion keeps the caller's own message and appends the project", () => {
  const r = withSession();
  r.notify({ type: 'task_complete', message: 'Build succeeded in 4s', sessionId: 's1' });

  assert.equal(r.text('.balloon-msg-complete'), 'Build succeeded in 4s on mask-ot');
  r.close();
});

test('an unknown session falls back to the bare verb rather than a dangling "on"', () => {
  const r = createRenderer();
  r.notify({ type: 'task_working', sessionId: 'ghost' });

  assert.doesNotMatch(r.text('.balloon-msg-working'), /on\s*\./);
  r.close();
});

// ---- Tool identity ----------------------------------------------------------

test('a plain tool is shown with its own name and its category glyph', () => {
  const r = withSession();
  r.notify(permission({ message: 'Bash\nls', detailKind: 'command' }));

  const head = r.document.querySelector('.tool-head');
  assert.ok(head.classList.contains('tool-exec'));
  assert.match(head.textContent, /Bash/);
  r.close();
});

test('an MCP tool is split into server and operation', () => {
  const r = withSession();
  r.notify(permission({ message: 'mcp__figma__get_design_context\n{}', detailKind: 'json' }));

  const head = r.document.querySelector('.tool-head');
  assert.ok(head.classList.contains('tool-mcp'));
  assert.equal(r.text('.tool-server'), 'figma');
  assert.match(head.textContent, /figma · get design context/);
  r.close();
});

test('a read-only tool is tinted apart from one that can change the machine', () => {
  const r = withSession();
  r.notify(permission({ message: 'Read\n/etc/hosts', detailKind: 'path' }));

  assert.ok(r.document.querySelector('.tool-head').classList.contains('tool-read'));
  r.close();
});

// ---- Request details --------------------------------------------------------

test('a command is framed as code', () => {
  const r = withSession();
  r.notify(permission({ message: 'Bash\nnpm run build', detailKind: 'command' }));

  const pre = r.document.querySelector('.balloon-code');
  assert.ok(pre.classList.contains('balloon-code-command'));
  assert.equal(pre.textContent, 'npm run build');
  r.close();
});

test('a path is not framed as code, and its filename is separated from its directories', () => {
  const r = withSession();
  r.notify(permission({ message: `Read\n${CWD}/electron-app/src/renderer.js`, detailKind: 'path' }));

  assert.equal(r.document.querySelector('.balloon-code'), null);
  assert.equal(r.text('.path-base'), 'renderer.js');
  assert.match(r.text('.path-dir'), /electron-app\/src\//);
  r.close();
});

test('a URL is not framed as code, and its host is separated from the rest', () => {
  const r = withSession();
  r.notify(permission({ message: 'WebFetch\nhttps://api.github.com/repos/x', detailKind: 'url' }));

  assert.equal(r.document.querySelector('.balloon-code'), null);
  assert.equal(r.text('.url-host'), 'api.github.com');
  assert.equal(r.text('.url-scheme'), 'https://');
  r.close();
});

test('JSON keys are coloured apart from their values', () => {
  const r = withSession();
  r.notify(permission({ message: 'Grep\n{\n  "pattern": "foo"\n}', detailKind: 'json' }));

  assert.deepEqual(r.all('.json-key').map((e) => e.textContent), ['"pattern"']);
  assert.deepEqual(r.all('.json-string').map((e) => e.textContent), ['"foo"']);
  r.close();
});

// An older hook that doesn't send detailKind must still render something.
test('a detail with no declared kind falls back to the plain code frame', () => {
  const r = withSession();
  r.notify(permission({ message: 'Mystery\nsome detail' }));

  const pre = r.document.querySelector('.balloon-code');
  assert.equal(pre.textContent, 'some detail');
  assert.equal(pre.classList.contains('balloon-code-command'), false);
  r.close();
});

// ---- Copy and collapse ------------------------------------------------------

test('the copy button puts the detail on the clipboard', () => {
  const r = withSession();
  r.notify(permission({ message: 'Bash\nnpm run build', detailKind: 'command' }));

  r.document.querySelector('.detail-action').click();
  assert.deepEqual(r.copied, ['npm run build']);
  r.close();
});

test('a long detail is folded, and says how much is hidden', () => {
  const r = withSession();
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  r.notify(permission({ message: `Bash\n${long}`, detailKind: 'command' }));

  assert.equal(r.document.querySelector('.balloon-code').textContent.split('\n').length, 8);
  assert.match(r.all('.detail-action')[1].textContent, /22 more lines/);
  r.close();
});

// Copying the truncated view would be worse than having no button.
test('copy yields the whole detail even while it is folded', () => {
  const r = withSession();
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  r.notify(permission({ message: `Bash\n${long}`, detailKind: 'command' }));

  r.document.querySelector('.detail-action').click();
  assert.equal(r.copied[0].split('\n').length, 30);
  r.close();
});

test('the fold-out toggle reveals the rest and offers to fold it back', () => {
  const r = withSession();
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  r.notify(permission({ message: `Bash\n${long}`, detailKind: 'command' }));

  r.all('.detail-action')[1].click();
  assert.equal(r.document.querySelector('.balloon-code').textContent.split('\n').length, 30);
  assert.match(r.all('.detail-action')[1].textContent, /show less/);
  r.close();
});

// ---- Answering --------------------------------------------------------------

test('a single-select answer is sent as one label', () => {
  const r = withSession();
  r.notify(permission({ message: 'Bash\nls', detailKind: 'command' }));

  r.document.querySelectorAll('.balloon-option')[0].click();
  const { payload } = r.sent.find((s) => s.channel === 'prompt-response');
  assert.equal(payload.id, 'p1');
  assert.equal(payload.choice, 'Allow');
  r.close();
});

test('a multi-select question renders checkboxes, not buttons', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', multiSelect: true, message: 'Which?', options: ['A', 'B', 'C'] });

  assert.equal(r.all('.balloon-check input').length, 3);
  r.close();
});

// An empty answer defers to Claude Code's own picker — a confusing way to lose clicks.
test('Confirm is disabled until something is ticked', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', multiSelect: true, message: 'Which?', options: ['A', 'B'] });

  assert.equal(r.document.querySelector('.balloon-confirm').disabled, true);

  r.all('.balloon-check input')[0].click();
  assert.equal(r.document.querySelector('.balloon-confirm').disabled, false);
  assert.match(r.text('.balloon-confirm'), /Confirm \(1\)/);
  r.close();
});

test('a multi-select answer is sent as a list of every ticked label', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', multiSelect: true, message: 'Which?', options: ['A', 'B', 'C'] });

  r.all('.balloon-check input')[0].click();
  r.all('.balloon-check input')[2].click();
  r.document.querySelector('.balloon-confirm').click();

  const { payload } = r.sent.find((s) => s.channel === 'prompt-response');
  assert.equal(payload.id, 'q1');
  assert.deepEqual([...payload.choice], ['A', 'C']);
  r.close();
});

test('unticking a box takes it back out of the answer', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', multiSelect: true, message: 'Which?', options: ['A', 'B'] });

  r.all('.balloon-check input')[0].click();
  r.all('.balloon-check input')[1].click();
  r.all('.balloon-check input')[0].click();
  r.document.querySelector('.balloon-confirm').click();

  assert.deepEqual([...r.sent.find((s) => s.channel === 'prompt-response').payload.choice], ['B']);
  r.close();
});

test('a custom answer on a checklist adds a ticked row instead of submitting', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', multiSelect: true, message: 'Which?', options: ['A'] });

  r.document.querySelector('.balloon-option-other').click();
  const input = r.document.querySelector('.balloon-other-input');
  input.value = 'Something else';
  r.document.querySelector('.balloon-other-send').click();

  assert.equal(r.sent.some((s) => s.channel === 'prompt-response'), false);
  assert.deepEqual(r.all('.balloon-check').map((e) => e.textContent), ['A', 'Something else']);
  assert.equal(r.all('.balloon-check input')[1].checked, true);
  r.close();
});

test('a custom answer on a single-select question submits it directly', () => {
  const r = withSession();
  r.notify({ type: 'prompt', sessionId: 's1', promptId: 'q1', message: 'Which?', options: ['A'] });

  r.document.querySelector('.balloon-option-other').click();
  r.document.querySelector('.balloon-other-input').value = 'Something else';
  r.document.querySelector('.balloon-other-send').click();

  assert.equal(r.sent.find((s) => s.channel === 'prompt-response').payload.choice, 'Something else');
  r.close();
});

// ---- Skin and size ----------------------------------------------------------

test('the launch arguments choose the skin and its portrait', () => {
  const r = createRenderer({ skin: 'peasant' });
  assert.match(r.document.getElementById('footman-img').src, /skins\/peasant\/portrait\.webp$/);
  r.close();
});

test('a skin change swaps the portrait in place', () => {
  const r = createRenderer({ skin: 'footman' });
  r.ipc('skin-changed', 'knight');

  assert.match(r.document.getElementById('footman-img').src, /skins\/knight\/portrait\.webp$/);
  r.close();
});

test('a skin change swaps the voice too, not just the portrait', () => {
  const r = withSession({ skin: 'footman' });
  r.notify({ type: 'task_complete', sessionId: 's1' });
  assert.equal(r.played.at(-1), 'work-completed.mp3'); // the Footman's only completion clip

  r.ipc('skin-changed', 'knight');
  r.notify({ type: 'task_complete', sessionId: 's1' });
  assert.match(r.played.at(-1), /^completed-.*\.wav$/); // now one of the Knight's
  r.close();
});

test('an unknown skin is refused rather than leaving the avatar broken', () => {
  const r = createRenderer({ skin: 'footman' });
  r.ipc('skin-changed', 'orc');

  assert.match(r.document.getElementById('footman-img').src, /skins\/footman\//);
  r.close();
});

test('the scale sets the avatar size and the height the window returns to', () => {
  const r = createRenderer({ scale: 3 });
  assert.equal(r.document.documentElement.style.getPropertyValue('--avatar-size'), '192px');

  const resize = r.sent.filter((s) => s.channel === 'resize-window').at(-1);
  assert.equal(resize.payload.height, 308);
  r.close();
});

test('a size change resizes the avatar in place', () => {
  const r = createRenderer({ scale: 1 });
  r.ipc('scale-changed', 2);

  assert.equal(r.document.documentElement.style.getPropertyValue('--avatar-size'), '128px');
  r.close();
});

// ---- Names ------------------------------------------------------------------

test('a named session is labelled project · name', () => {
  const r = createRenderer();
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD, name: 'git-manager' });
  r.notify({ type: 'task_working', sessionId: 's1' });

  assert.match(r.text('.balloon-msg-working'), /Starting work on mask-ot · git-manager/);
  r.close();
});

test('a completion from a named session names it too', () => {
  const r = createRenderer();
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD, name: 'Explore' });
  r.notify({ type: 'task_complete', sessionId: 's1' });

  assert.equal(r.text('.balloon-msg-complete'), 'Work completed on mask-ot · Explore');
  r.close();
});

test('an unnamed session is still labelled by project alone', () => {
  const r = withSession();
  r.notify({ type: 'task_complete', sessionId: 's1' });

  assert.equal(r.text('.balloon-msg-complete'), 'Work completed on mask-ot');
  r.close();
});

// The MCP tools have no session to attach to; they describe themselves instead.
test('a notification with no session is labelled from what it carried', () => {
  const r = createRenderer();
  r.notify({ type: 'task_complete', cwd: CWD, name: 'git-manager' });

  assert.equal(r.text('.balloon-msg-complete'), 'Work completed on mask-ot · git-manager');
  r.close();
});

test('a notification carrying only a directory is labelled by project', () => {
  const r = createRenderer();
  r.notify({ type: 'task_complete', cwd: CWD });

  assert.equal(r.text('.balloon-msg-complete'), 'Work completed on mask-ot');
  r.close();
});

// Otherwise each agent would fragment its project's colour.
test('every agent in a project shares the project colour', () => {
  const r = createRenderer();
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD, name: 'git-manager' });
  r.notify({ type: 'session_start', sessionId: 's2', cwd: CWD });
  r.notify({ type: 'task_complete', sessionId: 's1' });
  r.notify({ type: 'task_complete', sessionId: 's2' });

  const [a, b] = r.all('.balloon-msg-complete');
  assert.equal(a.style.borderLeft, b.style.borderLeft);
  assert.notEqual(a.style.borderLeft, '');
  r.close();
});

test('a different project gets a different colour', () => {
  const r = createRenderer();
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD });
  r.notify({ type: 'session_start', sessionId: 's2', cwd: '/Users/me/code/other-app' });
  r.notify({ type: 'task_complete', sessionId: 's1' });
  r.notify({ type: 'task_complete', sessionId: 's2' });

  const [a, b] = r.all('.balloon-msg-complete');
  assert.notEqual(a.style.borderLeft, b.style.borderLeft);
  r.close();
});

test('a permission prompt is tagged with the project and name it came from', () => {
  const r = createRenderer();
  r.notify({ type: 'session_start', sessionId: 's1', cwd: CWD, name: 'git-manager' });
  r.notify(permission({ message: 'Bash\nls', detailKind: 'command' }));

  assert.equal(r.text('.session-tag'), 'mask-ot · git-manager');
  r.close();
});
