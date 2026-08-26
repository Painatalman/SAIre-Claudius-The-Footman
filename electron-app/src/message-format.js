// Formatting helpers for balloon messages. Pure string work only — the DOM
// building lives in renderer.js — so this file is unit-testable under plain
// `node --test`.
//
// Two jobs: make a tool name readable (an MCP tool arrives as
// `mcp__figma__get_design_context`), and shape the request detail according to
// what it actually is. A shell command, a file path, a URL and a JSON payload
// all used to land in the same dark code frame, which flattens the one
// distinction that matters when you are deciding whether to allow something.

// One entry per category: the glyph shown before the tool name, and the tools
// that map to it. Glyph rendering is a lottery on macOS — some code points get
// substituted with a colour emoji that ignores the CSS tint — so they are
// collected here, one line each, for easy swapping. (⚔ was the first choice for
// `exec` — it matches the session counter — but macOS draws it as a thin ✕,
// which reads as "denied": the opposite of what it marks.)
const CATEGORIES = {
  exec: { glyph: '❯', tools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'KillShell'] },
  read: { glyph: '▤', tools: ['Read', 'Grep', 'Glob', 'NotebookRead', 'TodoWrite'] },
  web: { glyph: '⚑', tools: ['WebFetch', 'WebSearch'] },
  mcp: { glyph: '⚡', tools: [] },
  other: { glyph: '◆', tools: [] },
};

// Which bucket a tool belongs to. Drives both the glyph and the risk tint:
// `exec` can change your machine, the rest mostly observe it.
function toolCategory(tool) {
  const name = String(tool || '');
  if (name.startsWith('mcp__')) return 'mcp';
  for (const [category, def] of Object.entries(CATEGORIES)) {
    if (def.tools.includes(name)) return category;
  }
  return 'other';
}

// Split an MCP tool name into the server that provides it and the operation:
// `mcp__figma__get_design_context` -> figma · get design context.
// The server segment is left verbatim (it is an identifier, and several real
// ones contain single underscores); only the operation is humanised.
function parseToolName(tool) {
  const name = String(tool || '');
  if (!name.startsWith('mcp__')) return { server: null, name, display: name };

  const rest = name.slice('mcp__'.length);
  const split = rest.indexOf('__');
  if (split === -1) {
    const humanised = rest.replace(/_/g, ' ');
    return { server: null, name: humanised, display: humanised };
  }

  const server = rest.slice(0, split);
  const operation = rest.slice(split + 2).replace(/_/g, ' ');
  return { server, name: operation, display: `${server} · ${operation}` };
}

// Split a file path into a dimmed directory prefix and the basename, dropping
// the middle of a deep path: /Users/me/code/app/src/main.js -> …/app/src/ main.js
function elidePath(filePath, keep = 2) {
  const raw = String(filePath || '');
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0) return { dir: '', base: raw };

  const base = segments.pop();
  if (segments.length === 0) return { dir: raw.startsWith('/') ? '/' : '', base };

  const tail = segments.slice(-keep);
  const prefix = tail.length < segments.length ? '…/' : raw.startsWith('/') ? '/' : '';
  return { dir: `${prefix}${tail.join('/')}/`, base };
}

// Split a URL so the host — the part that decides whether you trust it — can be
// emphasised and the rest dimmed. Anything unparseable is shown whole.
function splitUrl(url) {
  const raw = String(url || '');
  try {
    const parsed = new URL(raw);
    return {
      scheme: `${parsed.protocol}//`,
      host: parsed.host,
      rest: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  } catch {
    return { scheme: '', host: raw, rest: '' };
  }
}

// Drop the middle of an over-long string, keeping both ends readable.
function elideMiddle(text, max = 60) {
  const raw = String(text || '');
  if (raw.length <= max) return raw;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${raw.slice(0, head)}…${raw.slice(raw.length - tail)}`;
}

// A string, an optional following colon (which makes it a key), a literal, or a
// number. Everything the regex doesn't match is punctuation and whitespace.
const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

// Tokenise one line of pretty-printed JSON into { text, token } runs, so the
// renderer can colour keys apart from values without pulling in a highlighter.
// Unmatched text comes back with token === null.
function highlightJsonLine(line) {
  const raw = String(line == null ? '' : line);
  const out = [];
  let last = 0;

  JSON_TOKEN.lastIndex = 0;
  let match;
  while ((match = JSON_TOKEN.exec(raw)) !== null) {
    if (match.index > last) out.push({ text: raw.slice(last, match.index), token: null });

    const [full, key, colon, string, literal, number] = match;
    if (key !== undefined) {
      out.push({ text: key, token: 'key' });
      out.push({ text: colon, token: null });
    } else if (string !== undefined) {
      out.push({ text: string, token: 'string' });
    } else if (literal !== undefined) {
      out.push({ text: literal, token: 'literal' });
    } else if (number !== undefined) {
      out.push({ text: number, token: 'number' });
    }
    last = match.index + full.length;
  }

  if (last < raw.length) out.push({ text: raw.slice(last), token: null });
  return out;
}

// Split a block into the lines to show and a count of those held back. A single
// line over the limit is not worth a toggle, so the cap only bites at max + 2.
function collapseLines(text, max = 8) {
  const lines = String(text == null ? '' : text).split('\n');
  if (lines.length <= max + 1) return { shown: lines, hidden: 0 };
  return { shown: lines.slice(0, max), hidden: lines.length - max };
}

module.exports = {
  CATEGORIES,
  toolCategory,
  parseToolName,
  elidePath,
  splitUrl,
  elideMiddle,
  highlightJsonLine,
  collapseLines,
};
