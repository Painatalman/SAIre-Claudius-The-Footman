import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNotifyBody } from './index.js';

// These calls carry no session id, so the body has to say where it came from.
test('a notification names the directory it was sent from', () => {
  const body = buildNotifyBody('task_complete', 'done', { cwd: '/Users/me/code/mask-ot' });
  assert.equal(body.cwd, '/Users/me/code/mask-ot');
  assert.equal(body.type, 'task_complete');
  assert.equal(body.message, 'done');
});

test('the working directory defaults to the process that is running', () => {
  assert.equal(buildNotifyBody('task_working', 'busy').cwd, process.cwd());
});

test('a named agent is passed through as the name', () => {
  assert.equal(buildNotifyBody('task_complete', 'done', { agent: 'git-manager' }).name, 'git-manager');
  assert.equal(buildNotifyBody('task_complete', 'done', { agent: '  Explore  ' }).name, 'Explore');
});

// An unnamed caller must not produce a label like "mask-ot · ".
test('an absent or blank agent leaves the name unset', () => {
  assert.equal(buildNotifyBody('task_complete', 'done').name, null);
  assert.equal(buildNotifyBody('task_complete', 'done', { agent: '   ' }).name, null);
  assert.equal(buildNotifyBody('task_complete', 'done', { agent: 42 }).name, null);
});

test('a prompt carries its options and id', () => {
  const body = buildNotifyBody('prompt', 'Which?', { options: ['A', 'B'], promptId: 'p1' });
  assert.deepEqual(body.options, ['A', 'B']);
  assert.equal(body.promptId, 'p1');
});
