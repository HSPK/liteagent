import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTranscriptLines } from '../src/cli/transcript-layout.js';

test('transcript layout wraps long entries and produces a bounded viewport', () => {
  const view = buildTranscriptLines([
    {
      kind: 'user',
      author: 'You',
      text: 'This is a long line that should wrap across multiple terminal rows cleanly.',
    },
    {
      kind: 'agent',
      author: 'assistant',
      text: 'reply',
    },
  ], {
    width: 20,
    height: 8,
    scrollOffset: 0,
  });

  assert.equal(view.lines.length, 8);
  assert.ok(view.totalLines >= 4);
  assert.ok(view.lines.some((line) => line.text.includes('You │')));
  assert.ok(view.lines.some((line) => line.text.includes('assistant │')));
});
