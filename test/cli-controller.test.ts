import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommandLine } from '../src/cli/command-parser.js';
import { RuntimeController } from '../src/cli/runtime-controller.js';

test('command parser supports quoted JSON payload and app option', () => {
  const parsed = parseCommandLine("event worker workflow.start '{\"note\":\"hello world\"}' --app domain.workflow");

  assert.deepEqual(parsed, {
    command: 'event',
    args: ['worker', 'workflow.start', '{"note":"hello world"}'],
    options: { appId: 'domain.workflow' },
  });
});

test('runtime controller can create agents, install apps, and dispatch events', async () => {
  const controller = new RuntimeController();

  await controller.createAgent('console-worker', ['system.app-manager']);
  await controller.installApp('console-worker', 'domain.workflow');
  controller.ingestEvent({
    to: 'console-worker',
    type: 'workflow.start',
    appId: 'domain.workflow',
    payload: { note: 'from cli' },
  });
  await controller.waitForIdle();

  const self = controller.inspectAgent('console-worker');
  const memory = controller.inspectMemory('console-worker');

  assert.deepEqual(
    self.apps.map((entry) => entry.appId).sort(),
    ['domain.workflow', 'system.app-manager'],
  );
  assert.deepEqual(memory.agent['workflow:last'], {
    status: 'completed',
    note: 'from cli',
  });

  controller.runtime.dispose();
});

test('runtime controller broadcasts plain text to all created agents', async () => {
  const controller = new RuntimeController();

  await controller.createAgent('alpha');
  await controller.createAgent('beta');

  const broadcast = await controller.broadcastText('hello everyone');

  assert.equal(broadcast.replies.length, 2);
  assert.deepEqual(
    broadcast.replies.map((reply) => reply.agentId).sort(),
    ['alpha', 'beta'],
  );
  assert.equal(
    (controller.inspectMemory('alpha').agent['echo:lastText'] as { text?: string }).text,
    'hello everyone',
  );
  assert.equal(
    (controller.inspectMemory('beta').agent['echo:lastText'] as { text?: string }).text,
    'hello everyone',
  );

  controller.runtime.dispose();
});

test('runtime controller resolves command aliases through the shared command catalog', async () => {
  const controller = new RuntimeController();

  await controller.createAgent('alias-worker');
  const parsed = parseCommandLine('agents');

  assert.ok(parsed);
  const result = await controller.execute(parsed);

  assert.ok(Array.isArray(result));
  const agentSummaries = result as Array<{ agentId?: string }>;
  assert.equal(agentSummaries[0]?.agentId, 'alias-worker');

  controller.runtime.dispose();
});
