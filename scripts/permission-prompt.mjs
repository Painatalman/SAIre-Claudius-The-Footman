#!/usr/bin/env node
// Synchronous PermissionRequest hook for Claude Code.
//
// When Claude Code is about to show a permission dialog, this hook asks the
// Footman widget instead — rendering Allow/Deny buttons in the speech balloon —
// and blocks until the user clicks. The click is translated into a
// PermissionRequest decision on stdout, which Claude Code obeys:
//
//   Allow  -> {hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}
//   Deny   -> {...decision:{behavior:"deny"}}
//   (none) -> no output, exit 0 -> Claude Code falls back to its normal dialog
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

// Map the user's click to a PermissionRequest decision object, or null to defer
// to Claude Code's normal permission dialog.
export function decisionFor(choice) {
  if (choice === 'Allow') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
  }
  if (choice === 'Deny') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } } };
  }
  return null;
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

// Show the Allow/Deny prompt in the widget. Reuses the existing prompt flow,
// so the renderer needs no changes.
async function sendPrompt(promptId, message, sessionId) {
  const res = await fetch(`${FOOTMAN_BASE}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'prompt',
      message,
      options: ['Allow', 'Deny'],
      promptId,
      sessionId,
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

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || '{}');
  } catch {
    // Malformed input — defer to the normal dialog.
    process.exit(0);
  }

  const promptId = randomUUID();

  let sent = false;
  try {
    sent = await sendPrompt(promptId, buildMessage(payload), payload.session_id);
  } catch {
    sent = false;
  }

  // Widget down or unreachable — let Claude Code show its normal dialog.
  if (!sent) process.exit(0);

  const choice = await waitForChoice(promptId, Date.now() + RESPONSE_TIMEOUT_MS);
  const decision = decisionFor(choice);

  if (decision) {
    process.stdout.write(JSON.stringify(decision));
  }
  process.exit(0);
}

// Only run the blocking flow when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
