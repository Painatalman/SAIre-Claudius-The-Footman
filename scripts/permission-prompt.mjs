#!/usr/bin/env node
// Synchronous PermissionRequest hook for Claude Code.
//
// When Claude Code is about to show a permission dialog, this hook asks the
// Footman widget instead — rendering the same choices Claude would offer as
// buttons in the speech balloon — and blocks until the user clicks. The choices
// come from the payload: always "Allow" and "Deny", plus an "Always allow …"
// button for each entry in `permission_suggestions` (the rule Claude suggests
// remembering). The click is translated into a PermissionRequest decision on
// stdout:
//
//   Allow         -> {...decision:{behavior:"allow"}}
//   Always allow… -> {...decision:{behavior:"allow",updatedPermissions:[suggestion]}}
//   Deny          -> {...decision:{behavior:"deny"}}
//   (none)        -> no output, exit 0 -> Claude Code falls back to its normal dialog
//
// MUST be registered with "async": false. Async hooks cannot return a decision.
import { randomUUID } from 'node:crypto';

const FOOTMAN_BASE = process.env.FOOTMAN_URL || 'http://localhost:6112';

// How long to wait for the user to click before deferring to the normal dialog.
// Kept comfortably under the hook's own timeout so the script always exits cleanly.
const RESPONSE_TIMEOUT_MS = Number(process.env.FOOTMAN_PERMISSION_TIMEOUT_MS) || 55_000;
const POLL_INTERVAL_MS = 400;

// Build the permission message from a PermissionRequest payload. The payload
// carries no prose prompt or option list — only tool_name + tool_input — so we
// show those literally and in full: the tool name, then the exact request
// (the command / file path / URL, or the whole tool_input as JSON otherwise).
export function buildMessage(payload = {}) {
  const tool = payload.tool_name || 'Unknown tool';
  const input = payload.tool_input || {};

  const primary = input.command ?? input.file_path ?? input.url ?? input.prompt;
  let detail;
  if (primary !== undefined && primary !== null) {
    detail = String(primary);
  } else if (Object.keys(input).length > 0) {
    detail = JSON.stringify(input, null, 2);
  } else {
    detail = '';
  }

  return detail.length > 0 ? `${tool}\n${detail}` : tool;
}

// A PermissionRequest decision object wrapping the given decision body.
function decision(body) {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: body } };
}

// Build the option buttons from the payload: the choices Claude Code itself
// would offer. Beyond plain Allow/Deny, each entry in `permission_suggestions`
// (e.g. {type:"addRules", rules:[{toolName, ruleContent}], behavior:"allow"})
// becomes an "Always allow …" option that carries the suggestion so the rule
// can be persisted. Returns [{ label, decision }] — the label is shown as a
// button and the decision is emitted when that button is clicked.
export function buildOptions(payload = {}) {
  const options = [{ label: 'Allow', decision: decision({ behavior: 'allow' }) }];

  const suggestions = Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : [];
  for (const suggestion of suggestions) {
    if (
      suggestion &&
      suggestion.type === 'addRules' &&
      suggestion.behavior === 'allow' &&
      Array.isArray(suggestion.rules) &&
      suggestion.rules.length > 0
    ) {
      const summary = suggestion.rules.map((r) => `${r.toolName}(${r.ruleContent})`).join(', ');
      options.push({
        label: `Always allow ${summary}`,
        decision: decision({ behavior: 'allow', updatedPermissions: [suggestion] }),
      });
    }
  }

  options.push({ label: 'Deny', decision: decision({ behavior: 'deny' }) });
  return options;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Show the prompt and its option buttons in the widget. Reuses the existing
// prompt flow, so the renderer needs no changes.
async function sendPrompt(promptId, message, labels, sessionId, cwd) {
  const res = await fetch(`${FOOTMAN_BASE}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'prompt',
      // Distinguishes a permission request (rendered with the framed code
      // preview) from a plain question asked via the footman_prompt MCP tool.
      kind: 'permission',
      message,
      options: labels,
      promptId,
      sessionId,
      cwd,
    }),
  });
  return res.ok;
}

// Poll the widget for the user's click, until the deadline.
async function waitForChoice(promptId, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${FOOTMAN_BASE}/response/${promptId}`);
      if (res.ok) {
        const { choice } = await res.json();
        return choice;
      }
    } catch {
      // Widget restarting or unreachable — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

// Tools whose "permission" is really an interactive question, not an allow/deny.
// A PermissionRequest decision can only allow/deny — it can't carry the user's
// answer — so showing these as Allow/Deny prompts (with their raw tool_input as
// "code") is wrong. Defer them to Claude Code's own question UI instead; a
// dedicated PreToolUse hook can render them in the widget if desired.
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || '{}');
  } catch {
    // Malformed input — defer to the normal dialog.
    process.exit(0);
  }

  // Not a real permission — let Claude Code handle the interaction natively.
  if (QUESTION_TOOLS.has(payload.tool_name)) process.exit(0);

  const promptId = randomUUID();
  const options = buildOptions(payload);

  let sent = false;
  try {
    sent = await sendPrompt(promptId, buildMessage(payload), options.map((o) => o.label), payload.session_id, payload.cwd);
  } catch {
    sent = false;
  }

  // Widget down or unreachable — let Claude Code show its normal dialog.
  if (!sent) process.exit(0);

  const choice = await waitForChoice(promptId, Date.now() + RESPONSE_TIMEOUT_MS);
  const picked = options.find((o) => o.label === choice);

  // No click (or an unrecognised one) — emit nothing so the normal dialog shows.
  if (picked) {
    process.stdout.write(JSON.stringify(picked.decision));
  }
  process.exit(0);
}

// Only run the blocking flow when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
