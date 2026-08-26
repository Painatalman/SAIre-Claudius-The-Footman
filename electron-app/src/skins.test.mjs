import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import skins from './skins.js';

const {
  SKINS, DEFAULT_SKIN, SOUND_ONLY_ACTIONS, resolveSkin, pickLine,
  SCALES, DEFAULT_SCALE, avatarSize, windowSizeFor, resolveScale,
} = skins;

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'skins');
const ACTIONS = ['working', 'ack', 'complete', 'prompt', 'error'];
const entries = Object.entries(SKINS);

test('every skin declares a non-empty pool for every action', () => {
  for (const [id, skin] of entries) {
    for (const action of ACTIONS) {
      const pool = skin.lines[action];
      assert.ok(Array.isArray(pool) && pool.length > 0, `${id}.${action} is empty`);
    }
  }
});

// The one mistake that stays invisible until you hear silence.
test('every declared sound file exists on disk', () => {
  for (const [id, skin] of entries) {
    for (const action of ACTIONS) {
      for (const line of skin.lines[action]) {
        const file = path.join(ASSETS, skin.dir, line.file);
        assert.ok(fs.existsSync(file), `${id}.${action}: missing ${line.file}`);
      }
    }
  }
});

test('every portrait exists on disk', () => {
  for (const [id, skin] of entries) {
    const file = path.join(ASSETS, skin.dir, skin.portrait);
    assert.ok(fs.existsSync(file), `${id}: missing ${skin.portrait}`);
  }
});

test('lines carry balloon text except in the sound-only pools', () => {
  for (const [id, skin] of entries) {
    for (const action of ACTIONS) {
      if (SOUND_ONLY_ACTIONS.includes(action)) continue;
      for (const line of skin.lines[action]) {
        assert.ok(line.text && line.text.trim(), `${id}.${action}: ${line.file} has no text`);
      }
    }
  }
});

test('resolveSkin prefers the environment over the config file', () => {
  assert.equal(resolveSkin('peasant', 'knight'), 'peasant');
});

test('resolveSkin falls back to the config file when the environment is unset', () => {
  assert.equal(resolveSkin('', 'knight'), 'knight');
  assert.equal(resolveSkin(undefined, 'knight'), 'knight');
});

test('resolveSkin defaults when neither is set', () => {
  assert.equal(resolveSkin('', null), DEFAULT_SKIN);
});

test('resolveSkin skips an unknown value rather than leaving the widget mute', () => {
  assert.equal(resolveSkin('orc', 'knight'), 'knight');
  assert.equal(resolveSkin('orc', 'ogre'), DEFAULT_SKIN);
});

test('pickLine only ever returns a line from the requested pool', () => {
  for (const [id, skin] of entries) {
    for (const action of ACTIONS) {
      const files = new Set(skin.lines[action].map((l) => l.file));
      for (let i = 0; i < 50; i++) {
        assert.ok(files.has(pickLine(id, action).file), `${id}.${action} returned a foreign line`);
      }
    }
  }
});

test('pickLine falls back to the default skin for an unknown id', () => {
  const files = new Set(SKINS[DEFAULT_SKIN].lines.prompt.map((l) => l.file));
  assert.ok(files.has(pickLine('orc', 'prompt').file));
});

test('pickLine returns an empty line for an unknown action instead of throwing', () => {
  assert.deepEqual(pickLine(DEFAULT_SKIN, 'nonsense'), {});
});

test('resolveScale prefers the environment over the config file', () => {
  assert.equal(resolveScale('3', 2), 3);
});

test('resolveScale accepts a scale written as a string or a number', () => {
  assert.equal(resolveScale('', '2'), 2);
  assert.equal(resolveScale('', 2), 2);
});

test('resolveScale defaults when neither is set', () => {
  assert.equal(resolveScale('', undefined), DEFAULT_SCALE);
});

// A 12× avatar would cover the screen with no obvious way back.
test('resolveScale rejects a size that is not one of the offered steps', () => {
  assert.equal(resolveScale('12', 2), 2);
  assert.equal(resolveScale('12', 'huge'), DEFAULT_SCALE);
  assert.equal(resolveScale('2.5', null), DEFAULT_SCALE);
});

test('avatarSize scales the 64px base', () => {
  assert.deepEqual(SCALES.map(avatarSize), [64, 128, 192]);
});

// The balloon keeps its width, so each step adds only the extra avatar pixels.
test('windowSizeFor grows the window by exactly the extra avatar pixels', () => {
  assert.deepEqual(windowSizeFor(1), { width: 380, height: 180 });
  assert.deepEqual(windowSizeFor(2), { width: 444, height: 244 });
  assert.deepEqual(windowSizeFor(3), { width: 508, height: 308 });
});
