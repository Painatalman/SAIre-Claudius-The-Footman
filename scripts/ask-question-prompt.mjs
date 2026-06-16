#!/usr/bin/env node
// PreToolUse hook for Claude Code's built-in AskUserQuestion tool.
//
// AskUserQuestion isn't a permission to grant — it's a question to answer — so
// it can't be served by the PermissionRequest hook, whose decision can only
// allow/deny and carries no answer. This PreToolUse hook instead renders each
// question in the Footman widget with its options as buttons (plus an "Other…"
// field for a custom free-text answer), waits for the user's pick, and returns
// the answer via permissionDecision:"allow" plus updatedInput.answers, so the
// tool runs already answered.
//
//   answered                         -> {permissionDecision:"allow", updatedInput:{...input, answers}}
//   no widget / no answer / unsupported -> no output, exit 0 -> Claude Code's native picker shows
//
// MUST be registered on a PreToolUse matcher for AskUserQuestion with
// "async": false — async hooks cannot return a decision.
import { randomUUID } from 'node:crypto';

const FOOTMAN_BASE = process.env.FOOTMAN_URL || 'http://localhost:6112';

// How long to wait for the user before deferring to the native picker. Kept
// under the hook's own timeout so the script always exits cleanly.
const RESPONSE_TIMEOUT_MS = Number(process.env.FOOTMAN_QUESTION_TIMEOUT_MS) || 290_000;
const POLL_INTERVAL_MS = 400;

// Whether to leave this call to Claude Code's native UI rather than the widget.
// v1 handles single-select questions that carry options; multi-select and
// option-less questions defer (the widget's buttons return one label each).
export function shouldDefer(payload = {}) {
  if (payload.tool_name !== 'AskUserQuestion') return true;
  const questions = payload.tool_input && payload.tool_input.questions;
  if (!Array.isArray(questions) || questions.length === 0) return true;
  if (questions.some((q) => !q || q.multiSelect)) return true;
  if (questions.some((q) => !Array.isArray(q.options) || q.options.length === 0)) return true;
  return false;
}

// The PreToolUse decision that answers the tool: the original input with an
// `answers` map (question text -> chosen option label) merged in.
export function buildDecision(input, picks) {
  const questions = input.questions || [];
  const answers = {};
  questions.forEach((q, i) => { answers[q.question] = picks[i]; });
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...input, answers },
    },
  };
}

// Show one question and its option buttons in the widget. Reuses the plain
// prompt flow (no `kind`), so it renders as a question, not a permission.
async function sendQuestion(promptId, question, labels, sessionId, cwd) {
  const res = await fetch(`${FOOTMAN_BASE}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'prompt', message: question, options: labels, promptId, sessionId, cwd }),
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

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || '{}');
  } catch {
    process.exit(0); // Malformed input — defer to the native picker.
  }

  // Anything we can't faithfully answer in the widget goes to the native UI.
  if (shouldDefer(payload)) process.exit(0);

  const input = payload.tool_input;
  const questions = input.questions;
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  const picks = [];

  for (const q of questions) {
    const labels = q.options.map((o) => o.label);
    const promptId = randomUUID();

    let sent = false;
    try {
      sent = await sendQuestion(promptId, q.question, labels, payload.session_id, payload.cwd);
    } catch {
      sent = false;
    }
    if (!sent) process.exit(0); // Widget down — defer the whole call.

    const choice = await waitForChoice(promptId, deadline);
    // A preset label, or free text the user typed via "Other" — both are valid
    // answers. Only a missing/empty answer (e.g. a timeout) defers to the
    // native picker.
    if (typeof choice !== 'string' || choice.trim() === '') process.exit(0);
    picks.push(choice);
  }

  process.stdout.write(JSON.stringify(buildDecision(input, picks)));
  process.exit(0);
}

// Only run the blocking flow when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
