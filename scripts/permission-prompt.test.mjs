import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage, decisionFor } from './permission-prompt.mjs';

test('buildMessage asks to run a Bash command and shows it on a second line', () => {
  const msg = buildMessage({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
  assert.equal(msg, 'May I run this command, my lord?\ngit push origin main');
});

test('buildMessage asks to read a file using file_path', () => {
  const msg = buildMessage({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } });
  assert.equal(msg, 'May I read this file, my lord?\n/etc/hosts');
});

test('buildMessage asks to fetch a URL using url', () => {
  const msg = buildMessage({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } });
  assert.equal(msg, 'May I fetch this URL, my lord?\nhttps://example.com');
});

test('buildMessage falls back to a generic question for unknown tools', () => {
  const msg = buildMessage({ tool_name: 'Frobnicate', tool_input: {} });
  assert.equal(msg, 'May I use Frobnicate, my lord?');
});

test('buildMessage tolerates a missing tool name', () => {
  const msg = buildMessage({});
  assert.equal(msg, 'May I use a tool, my lord?');
});

test('buildMessage truncates the detail to 160 characters', () => {
  const long = 'x'.repeat(500);
  const msg = buildMessage({ tool_name: 'Bash', tool_input: { command: long } });
  assert.equal(msg, `May I run this command, my lord?\n${'x'.repeat(160)}`);
});

test('decisionFor maps Allow to an allow behavior', () => {
  assert.deepEqual(decisionFor('Allow'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
});

test('decisionFor maps Deny to a deny behavior', () => {
  assert.deepEqual(decisionFor('Deny'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny' },
    },
  });
});

test('decisionFor returns null for no answer so the normal dialog is shown', () => {
  assert.equal(decisionFor(null), null);
  assert.equal(decisionFor(undefined), null);
  assert.equal(decisionFor('Maybe'), null);
});
