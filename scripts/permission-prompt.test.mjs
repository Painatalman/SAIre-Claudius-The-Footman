import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDetail, packMessage, buildOptions, nameFrom } from './permission-prompt.mjs';

// The widget gets the packed string; the detail kind travels beside it.
const buildMessage = (payload) => packMessage(buildDetail(payload));

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

const allow = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
const deny = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } } };

test('buildOptions offers just Allow and Deny when there are no suggestions', () => {
  const options = buildOptions({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual(options.map((o) => o.label), ['Allow', 'Deny']);
  assert.deepEqual(options[0].decision, allow);
  assert.deepEqual(options[1].decision, deny);
});

test('buildOptions adds an "Always allow" option from a permission suggestion', () => {
  const suggestion = {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'pnpm vitest *' }],
    behavior: 'allow',
    destination: 'localSettings',
  };
  const options = buildOptions({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm vitest run' },
    permission_suggestions: [suggestion],
  });

  assert.deepEqual(options.map((o) => o.label), [
    'Allow',
    'Always allow Bash(pnpm vitest *)',
    'Deny',
  ]);
  // The "always" option carries the suggestion so the rule can persist
  assert.deepEqual(options[1].decision, {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow', updatedPermissions: [suggestion] },
    },
  });
});

test('buildOptions summarises multiple rules in one suggestion', () => {
  const options = buildOptions({
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [
          { toolName: 'Bash', ruleContent: 'git push *' },
          { toolName: 'Bash', ruleContent: 'git commit *' },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  });
  assert.deepEqual(options.map((o) => o.label), [
    'Allow',
    'Always allow Bash(git push *), Bash(git commit *)',
    'Deny',
  ]);
});

test('buildOptions ignores suggestions that are not allow/addRules', () => {
  const options = buildOptions({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
    permission_suggestions: [
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm *' }], behavior: 'deny', destination: 'localSettings' },
      { type: 'replaceRules', rules: [], behavior: 'allow', destination: 'localSettings' },
    ],
  });
  assert.deepEqual(options.map((o) => o.label), ['Allow', 'Deny']);
});

test('buildDetail names what the detail is, so the widget can render it properly', () => {
  const kind = (payload) => buildDetail(payload).kind;
  assert.equal(kind({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'command');
  assert.equal(kind({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }), 'path');
  assert.equal(kind({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }), 'url');
  assert.equal(kind({ tool_name: 'Task', tool_input: { prompt: 'go' } }), 'text');
  assert.equal(kind({ tool_name: 'Grep', tool_input: { pattern: 'foo' } }), 'json');
  assert.equal(kind({ tool_name: 'Bash', tool_input: {} }), null);
});

test('buildDetail prefers the command over other fields', () => {
  const { detail, kind } = buildDetail({
    tool_name: 'Bash',
    tool_input: { command: 'cat x', file_path: '/x' },
  });
  assert.equal(detail, 'cat x');
  assert.equal(kind, 'command');
});

test('packMessage omits the newline when there is no detail', () => {
  assert.equal(packMessage({ tool: 'Bash', detail: '' }), 'Bash');
});

test('nameFrom picks up a name the payload carries', () => {
  assert.equal(nameFrom({ agent_name: 'git-manager' }, {}), 'git-manager');
  assert.equal(nameFrom({ subagent_type: 'Explore' }, {}), 'Explore');
  assert.equal(nameFrom({ session_name: 'release run' }, {}), 'release run');
});

test('nameFrom falls back to the name set for the session', () => {
  assert.equal(nameFrom({}, { FOOTMAN_SESSION_NAME: 'release run' }), 'release run');
});

test('nameFrom prefers the payload over the environment', () => {
  assert.equal(nameFrom({ agent: 'git-manager' }, { FOOTMAN_SESSION_NAME: 'release run' }), 'git-manager');
});

// With no name anywhere, the widget labels by project alone — nothing invented.
test('nameFrom returns null when there is no name to show', () => {
  assert.equal(nameFrom({ session_id: 'abc', cwd: '/x' }, {}), null);
  assert.equal(nameFrom({}, { FOOTMAN_SESSION_NAME: '  ' }), null);
  assert.equal(nameFrom({ agent_name: '' }, {}), null);
});
