import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  AgentsRuntime,
  JsonFileRuntimeStore,
  registerBuiltinApps,
} from '../src/index.js';

test('runtime snapshot restores waiting tasks, conversation memory, and active timers', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  await runtime.createAgent({
    id: 'durable-worker',
    installedApps: ['domain.workflow', 'system.router'],
  });

  runtime.ingestEvent({
    to: 'durable-worker',
    type: 'router.configure',
    targetAppId: 'system.router',
    conversationId: 'router-config',
    payload: {
      rules: [{ id: 'ops', when: { topic: 'ops' }, route: 'operations' }],
      defaultRoute: 'general',
    },
  });
  runtime.ingestEvent({
    to: 'durable-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'router-thread',
    payload: { topic: 'ops' },
  });
  runtime.ingestEvent({
    to: 'durable-worker',
    type: 'workflow.start',
    targetAppId: 'domain.workflow',
    conversationId: 'workflow-thread',
    payload: { note: 'persist reminder', reminderMs: 45 },
  });

  await runtime.whenIdle();

  const durableWorker = runtime.getAgent('durable-worker');
  assert.ok(durableWorker);
  const before = durableWorker.describeSelf();
  const snapshot = await runtime.snapshot();

  assert.equal(before.tasks.find((task) => task.appId === 'domain.workflow')?.status, 'waiting');
  assert.equal(before.timers?.some((timer) => timer.active) ?? false, true);

  runtime.dispose();

  const restored = registerBuiltinApps(new AgentsRuntime());
  await restored.restore(snapshot);

  await sleep(80);
  await restored.whenIdle();

  const agent = restored.getAgent('durable-worker');
  assert.ok(agent);
  const self = agent.describeSelf();
  const memory = agent.snapshotMemory();
  const workflowLast = memory.agent['workflow:last'] as { status?: string };
  const routerThread = memory.conversations['router-thread'] as Record<string, unknown>;

  assert.equal(self.tasks.find((task) => task.appId === 'domain.workflow')?.status, 'completed');
  assert.equal(workflowLast.status, 'reminded');
  assert.equal(routerThread['router:lastRoute'], 'operations');
  assert.ok(agent.describeConversation('workflow-thread'));

  restored.dispose();
});

test('JSON file store round-trips runtime snapshots', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  await runtime.createAgent({
    id: 'file-worker',
    installedApps: ['system.router'],
  });

  runtime.ingestEvent({
    to: 'file-worker',
    type: 'router.configure',
    targetAppId: 'system.router',
    conversationId: 'file-config',
    payload: {
      rules: [{ id: 'billing', when: { topic: 'billing' }, route: 'finance' }],
      defaultRoute: 'general',
    },
  });
  runtime.ingestEvent({
    to: 'file-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'file-thread',
    payload: { topic: 'billing' },
  });

  await runtime.whenIdle();

  const snapshot = await runtime.snapshot();
  const directory = await mkdtemp(join(tmpdir(), 'agents-runtime-'));
  const store = new JsonFileRuntimeStore(join(directory, 'runtime.json'));

  await store.save(snapshot);
  const loaded = await store.load();

  runtime.dispose();

  const restored = registerBuiltinApps(new AgentsRuntime());
  await restored.restore(loaded);

  const fileWorker = restored.getAgent('file-worker');
  assert.ok(fileWorker);
  const memory = fileWorker.snapshotMemory();
  const routerMemory = memory.apps['system.router'] as { defaultRoute?: string };
  const fileThread = memory.conversations['file-thread'] as Record<string, unknown>;

  assert.equal(routerMemory.defaultRoute, 'general');
  assert.equal(fileThread['router:lastRoute'], 'finance');

  restored.dispose();
  await rm(directory, { recursive: true, force: true });
});
