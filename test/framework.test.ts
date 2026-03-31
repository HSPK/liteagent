import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentsRuntime, registerBuiltinApps } from '../src/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test('workflow app processes external events and completes a task', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'worker',
    installedApps: ['domain.workflow'],
  });

  runtime.ingestEvent({
    to: 'worker',
    type: 'workflow.start',
    targetAppId: 'domain.workflow',
    payload: { note: 'initial job' },
  });

  await runtime.whenIdle();

  const self = agent.describeSelf();
  const memory = agent.snapshotMemory();

  assert.equal(self.tasks.length, 1);
  assert.equal(self.tasks[0].status, 'completed');
  assert.deepEqual(memory.agent['workflow:last'], {
    status: 'completed',
    note: 'initial job',
  });

  runtime.dispose();
});

test('timer signals can resume waiting tasks', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'timer-worker',
    installedApps: ['domain.workflow'],
  });

  runtime.ingestEvent({
    to: 'timer-worker',
    type: 'workflow.start',
    targetAppId: 'domain.workflow',
    payload: { note: 'check server', reminderMs: 25 },
  });

  await agent.whenIdle();
  assert.equal(agent.describeSelf().tasks[0].status, 'waiting');

  await sleep(50);
  await runtime.whenIdle();

  const memory = agent.snapshotMemory();
  const self = agent.describeSelf();

  assert.equal(self.tasks[0].status, 'completed');
  assert.deepEqual(memory.agent['workflow:last'], {
    status: 'reminded',
    note: 'check server',
  });

  runtime.dispose();
});

test('app manager installs apps from the registry and planner uses them', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'planner-worker',
    installedApps: ['system.app-manager', 'system.planner'],
  });

  runtime.ingestEvent({
    to: 'planner-worker',
    type: 'app.install',
    targetAppId: 'system.app-manager',
    payload: { appId: 'system.todo' },
  });
  await runtime.whenIdle();

  runtime.ingestEvent({
    to: 'planner-worker',
    type: 'planner.plan',
    targetAppId: 'system.planner',
    payload: { steps: ['write code', 'review design'] },
  });
  await runtime.whenIdle();

  const memory = agent.snapshotMemory();
  const installedApps = agent.describeSelf().apps.map((entry) => entry.appId).sort();
  const todoMemory = memory.apps['system.todo'] as { items: Array<{ title?: string }> };

  assert.deepEqual(installedApps, ['system.app-manager', 'system.planner', 'system.todo']);
  assert.equal(todoMemory.items.length, 2);
  assert.equal(todoMemory.items[0]?.title, 'write code');
  assert.equal(todoMemory.items[1]?.title, 'review design');

  runtime.dispose();
});

test('runtime routes agent-to-agent messages', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const alice = await runtime.createAgent({
    id: 'alice',
    installedApps: ['domain.workflow'],
  });
  const bob = await runtime.createAgent({
    id: 'bob',
    installedApps: ['domain.workflow'],
  });

  const signal = runtime.sendMessage({
    from: 'alice',
    to: 'bob',
    type: 'workflow.ping',
    targetAppId: 'domain.workflow',
    payload: { note: 'hello' },
  });

  await runtime.whenIdle();

  const memory = alice.snapshotMemory();
  const aliceSelf = alice.describeSelf();
  const bobSelf = bob.describeSelf();

  assert.deepEqual(memory.agent['workflow:lastMessage'], {
    from: 'bob',
    note: 'hello',
  });
  assert.equal(aliceSelf.tasks[0].conversationId, signal.conversationId);
  assert.equal(bobSelf.tasks[0].conversationId, signal.conversationId);
  assert.ok(aliceSelf.conversations.some((entry) => entry.conversationId === signal.conversationId));
  assert.ok(bobSelf.conversations.some((entry) => entry.conversationId === signal.conversationId));

  runtime.dispose();
});
