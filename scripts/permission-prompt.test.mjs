import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage, decisionFor } from './permission-prompt.mjs';

test('buildMessage shows the tool name and the literal Bash command', () => {
  const msg = buildMessage({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
  assert.equal(msg, 'Bash\ngit push origin main');
});

test('buildMessage shows the literal file_path for file tools', () => {
  const msg = buildMessage({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } });
  assert.equal(msg, 'Read\n/etc/hosts');
});

test('buildMessage shows the literal url for WebFetch', () => {
  const msg = buildMessage({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } });
  assert.equal(msg, 'WebFetch\nhttps://example.com');
});

test('buildMessage shows the full tool_input as JSON when there is no obvious primary field', () => {
  const msg = buildMessage({ tool_name: 'Grep', tool_input: { pattern: 'foo', path: '/src' } });
  assert.equal(msg, `Grep\n${JSON.stringify({ pattern: 'foo', path: '/src' }, null, 2)}`);
});

test('buildMessage shows just the tool name when there is no input', () => {
  const msg = buildMessage({ tool_name: 'ListMcpResources', tool_input: {} });
  assert.equal(msg, 'ListMcpResources');
});

test('buildMessage tolerates a missing tool name', () => {
  const msg = buildMessage({ tool_input: { command: 'ls' } });
  assert.equal(msg, 'Unknown tool\nls');
});

test('buildMessage does NOT truncate long commands — the full text is shown', () => {
  const long = 'x'.repeat(500);
  const msg = buildMessage({ tool_name: 'Bash', tool_input: { command: long } });
  assert.equal(msg, `Bash\n${long}`);
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
