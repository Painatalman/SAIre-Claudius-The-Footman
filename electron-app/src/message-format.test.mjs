import { test } from 'node:test';
import assert from 'node:assert/strict';

import format from './message-format.js';

const {
  CATEGORIES,
  toolCategory,
  parseToolName,
  elidePath,
  splitUrl,
  elideMiddle,
  highlightJsonLine,
  collapseLines,
} = format;

test('toolCategory separates tools that act from tools that observe', () => {
  assert.equal(toolCategory('Bash'), 'exec');
  assert.equal(toolCategory('Edit'), 'exec');
  assert.equal(toolCategory('Read'), 'read');
  assert.equal(toolCategory('WebFetch'), 'web');
  assert.equal(toolCategory('SomethingNew'), 'other');
});

test('toolCategory recognises any MCP tool by its prefix', () => {
  assert.equal(toolCategory('mcp__figma__get_design_context'), 'mcp');
  assert.equal(toolCategory('mcp__whatever'), 'mcp');
});

test('toolCategory tolerates a missing tool name', () => {
  assert.equal(toolCategory(undefined), 'other');
  assert.equal(toolCategory(''), 'other');
});

test('every category has a glyph', () => {
  for (const [name, def] of Object.entries(CATEGORIES)) {
    assert.ok(def.glyph && def.glyph.length > 0, `${name} has no glyph`);
  }
});

test('parseToolName leaves a plain tool name alone', () => {
  assert.deepEqual(parseToolName('Bash'), { server: null, name: 'Bash', display: 'Bash' });
});

test('parseToolName splits an MCP tool into server and operation', () => {
  assert.deepEqual(parseToolName('mcp__figma__get_design_context'), {
    server: 'figma',
    name: 'get design context',
    display: 'figma · get design context',
  });
});

// Real server names carry single underscores; only the double underscore separates.
test('parseToolName keeps underscores inside the server name', () => {
  const parsed = parseToolName('mcp__claude_ai_Gamma__export_gamma');
  assert.equal(parsed.server, 'claude_ai_Gamma');
  assert.equal(parsed.name, 'export gamma');
});

test('parseToolName handles an MCP name with no operation segment', () => {
  assert.deepEqual(parseToolName('mcp__lonely'), { server: null, name: 'lonely', display: 'lonely' });
});

test('elidePath drops the middle of a deep path and keeps the basename', () => {
  assert.deepEqual(elidePath('/Users/me/code/app/src/main.js'), {
    dir: '…/app/src/',
    base: 'main.js',
  });
});

test('elidePath leaves a shallow absolute path intact', () => {
  assert.deepEqual(elidePath('/etc/hosts'), { dir: '/etc/', base: 'hosts' });
});

test('elidePath handles a bare filename', () => {
  assert.deepEqual(elidePath('README.md'), { dir: '', base: 'README.md' });
});

test('splitUrl emphasises the host', () => {
  assert.deepEqual(splitUrl('https://api.github.com/repos/foo?page=2'), {
    scheme: 'https://',
    host: 'api.github.com',
    rest: '/repos/foo?page=2',
  });
});

test('splitUrl falls back to showing an unparseable value whole', () => {
  assert.deepEqual(splitUrl('not a url'), { scheme: '', host: 'not a url', rest: '' });
});

test('elideMiddle keeps both ends of an over-long string', () => {
  const out = elideMiddle('a'.repeat(100), 21);
  assert.equal(out.length, 21);
  assert.ok(out.includes('…'));
});

test('elideMiddle leaves a short string alone', () => {
  assert.equal(elideMiddle('short', 60), 'short');
});

test('highlightJsonLine marks a key apart from its string value', () => {
  const tokens = highlightJsonLine('  "nodeId": "1:23",');
  assert.deepEqual(
    tokens.filter((t) => t.token),
    [
      { text: '"nodeId"', token: 'key' },
      { text: '"1:23"', token: 'string' },
    ],
  );
});

test('highlightJsonLine marks numbers and literals', () => {
  const tokens = highlightJsonLine('  "count": 42, "ok": true, "gone": null');
  assert.deepEqual(
    tokens.filter((t) => t.token).map((t) => t.token),
    ['key', 'number', 'key', 'literal', 'key', 'literal'],
  );
});

test('highlightJsonLine round-trips the original text', () => {
  const line = '  "path": "/tmp/x", "n": -1.5e3';
  assert.equal(highlightJsonLine(line).map((t) => t.text).join(''), line);
});

test('highlightJsonLine is not confused by a colon inside a string', () => {
  const tokens = highlightJsonLine('  "url": "https://x.dev:8080/a"');
  assert.deepEqual(
    tokens.filter((t) => t.token),
    [
      { text: '"url"', token: 'key' },
      { text: '"https://x.dev:8080/a"', token: 'string' },
    ],
  );
});

test('highlightJsonLine handles an empty line', () => {
  assert.deepEqual(highlightJsonLine(''), []);
});

test('collapseLines leaves a short block whole', () => {
  const { shown, hidden } = collapseLines('a\nb\nc', 8);
  assert.deepEqual(shown, ['a', 'b', 'c']);
  assert.equal(hidden, 0);
});

// Hiding a single line behind a toggle costs a row to save a row.
test('collapseLines does not collapse a block that is one line over', () => {
  const { hidden } = collapseLines(Array.from({ length: 9 }, (_, i) => i).join('\n'), 8);
  assert.equal(hidden, 0);
});

test('collapseLines holds back the tail of a long block', () => {
  const { shown, hidden } = collapseLines(Array.from({ length: 30 }, (_, i) => i).join('\n'), 8);
  assert.equal(shown.length, 8);
  assert.equal(hidden, 22);
});
