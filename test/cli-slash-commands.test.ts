import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeSlashCommand,
  listSlashCommandMatches,
  normalizeSlashCommand,
} from '../src/cli/slash-commands.js';

test('slash command helpers normalize and autocomplete commands', () => {
  assert.equal(normalizeSlashCommand('/help'), 'help');
  assert.deepEqual(listSlashCommandMatches('/cr'), ['create']);
  assert.deepEqual(listSlashCommandMatches('/ag'), ['agents']);
  assert.deepEqual(completeSlashCommand('/cr'), {
    input: '/create ',
    matches: ['create'],
    completed: true,
  });
});
