import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildComposerFooter,
  buildInputFrame,
  buildInputHint,
  buildSlashCommandMenu,
  buildStatusLine,
  consumeSuppressedTerminalInput,
  extractMouseScrollDelta,
  isMouseInputSequence,
} from '../src/cli/ink-input-helpers.js';

test('ink input helpers build inline hints for idle, slash, and busy states', () => {
  assert.match(buildInputHint('', { busy: false }), /message/);
  assert.match(buildInputHint('/cr', { busy: false }), /complete/);
  assert.match(buildInputHint('hello', { busy: true }), /wait/i);
  assert.match(buildComposerFooter({ slashMode: true }), /complete/);
  assert.match(buildStatusLine({ agentCount: 2, registryCount: 5, scrollOffset: 3 }), /\+3/);
  assert.ok(buildSlashCommandMenu('/cr')[0]?.includes('/create'));
});

test('ink input helpers parse sgr mouse wheel scroll sequences', () => {
  assert.equal(extractMouseScrollDelta('\x1b[<64;40;12M'), 3);
  assert.equal(extractMouseScrollDelta('\x1b[<65;40;12M'), -3);
  assert.equal(extractMouseScrollDelta('\x1b[<64;40;12M\x1b[<65;40;12M'), 0);
  assert.equal(isMouseInputSequence('\x1b[<64;40;12M'), true);
  assert.equal(isMouseInputSequence('hello'), false);
});

test('ink input helpers can suppress raw mouse escape fragments and build fixed-width frames', () => {
  let pendingInput = '\x1b[<64;40;12M';
  const first = consumeSuppressedTerminalInput(pendingInput, '\x1b[<64;');
  pendingInput = first.pendingInput;
  const second = consumeSuppressedTerminalInput(pendingInput, '40;12M');

  assert.equal(first.consumed, true);
  assert.equal(second.consumed, true);
  assert.equal(second.pendingInput, '');

  const frame = buildInputFrame({
    columns: 40,
    inputBuffer: '',
    cursorIndex: 0,
    cursorCharacter: '█',
    hint: 'Chat with assistant',
    footerText: 'Enter sends',
    busy: false,
    promptLabel: 'ask',
  });

  assert.equal(frame.top.length, 40);
  assert.equal(frame.middle.length, 40);
  assert.equal(frame.bottom.length, 40);

  const scrollingFrame = buildInputFrame({
    columns: 24,
    inputBuffer: 'this is a long input buffer',
    cursorIndex: 14,
    cursorCharacter: '█',
    hint: 'hint',
    footerText: 'footer',
    busy: false,
    promptLabel: 'ask',
  });

  assert.equal(scrollingFrame.middle.length, 24);
  assert.match(scrollingFrame.middle, /█/);
});
