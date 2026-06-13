import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage, buildOptions } from './permission-prompt.mjs';

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
