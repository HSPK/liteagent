import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeController } from '../src/cli/runtime-controller.js';
import {
  HELP_TEXT,
  createPromptEntry,
  executeConsoleInput,
  formatEntryText,
  isExitInput,
} from '../src/cli/ui-helpers.js';

test('ui helpers format prompt entries and recognize exit inputs', () => {
  assert.deepEqual(createPromptEntry('hello'), {
    kind: 'user',
    author: 'You',
    text: 'hello',
  });
  assert.deepEqual(createPromptEntry('/help'), {
    kind: 'command',
    text: '/help',
  });
  assert.equal(formatEntryText({ kind: 'agent', author: 'alpha', text: 'hello' }), 'alpha: hello');
  assert.match(HELP_TEXT, /\/list \| \/agents/);
  assert.match(HELP_TEXT, /\/exit \| \/quit/);
  assert.equal(isExitInput('/exit'), true);
  assert.equal(isExitInput('quit'), true);
  assert.equal(isExitInput('hello'), false);
});

test('executeConsoleInput returns structured agent replies for chat input', async () => {
  const controller = new RuntimeController();

  await controller.createAgent('alpha');
  const entries = await executeConsoleInput(controller, 'hello ink');

  assert.deepEqual(entries, [
    {
      kind: 'agent',
      author: 'alpha',
      text: 'hello ink',
    },
  ]);

  controller.runtime.dispose();
});
