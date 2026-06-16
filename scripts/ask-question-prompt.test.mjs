import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldDefer, buildDecision } from './ask-question-prompt.mjs';

const singleSelect = {
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      {
        question: 'Where should the link live?',
        header: 'Placement',
        options: [
          { label: 'On Profile', description: 'Add to the profile page' },
          { label: 'On Home', description: 'Add a home section' },
        ],
        multiSelect: false,
      },
    ],
  },
};

test('shouldDefer is false for a single-select question with options', () => {
  assert.equal(shouldDefer(singleSelect), false);
});

test('shouldDefer is true for a non-AskUserQuestion tool', () => {
  assert.equal(shouldDefer({ tool_name: 'Bash', tool_input: { command: 'ls' } }), true);
});

test('shouldDefer is true when there are no questions', () => {
  assert.equal(shouldDefer({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } }), true);
});

test('shouldDefer is true for a multi-select question (v1 limitation)', () => {
  const ms = structuredClone(singleSelect);
  ms.tool_input.questions[0].multiSelect = true;
  assert.equal(shouldDefer(ms), true);
});

test('shouldDefer is true when a question carries no options', () => {
  const noOpts = structuredClone(singleSelect);
  noOpts.tool_input.questions[0].options = [];
  assert.equal(shouldDefer(noOpts), true);
});

test('buildDecision maps each question to its chosen label and keeps the input', () => {
  const decision = buildDecision(singleSelect.tool_input, ['On Home']);
  assert.deepEqual(decision, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        questions: singleSelect.tool_input.questions,
        answers: { 'Where should the link live?': 'On Home' },
      },
    },
  });
});

test('buildDecision accepts a custom (free-text) answer from "Other"', () => {
  const decision = buildDecision(singleSelect.tool_input, ['Somewhere else entirely']);
  assert.equal(
    decision.hookSpecificOutput.updatedInput.answers['Where should the link live?'],
    'Somewhere else entirely',
  );
});

test('buildDecision handles multiple questions aligned to picks', () => {
  const input = {
    questions: [
      { question: 'Q1', options: [{ label: 'A' }, { label: 'B' }] },
      { question: 'Q2', options: [{ label: 'C' }, { label: 'D' }] },
    ],
  };
  const decision = buildDecision(input, ['B', 'C']);
  assert.deepEqual(decision.hookSpecificOutput.updatedInput.answers, { Q1: 'B', Q2: 'C' });
});
