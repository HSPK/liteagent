import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentsRuntime, registerBuiltinApps } from '../src/index.js';

type RouterMemory = {
  rules: unknown[];
};

test('conversation memory is isolated by conversation id', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'router-worker',
    installedApps: ['system.router'],
  });

  runtime.ingestEvent({
    to: 'router-worker',
    type: 'router.configure',
    targetAppId: 'system.router',
    conversationId: 'conv-config',
    payload: {
      rules: [
        { id: 'high-priority', when: { priority: 'high' }, route: 'urgent' },
        { id: 'billing', when: { topic: 'billing' }, route: 'finance' },
        { id: 'support', when: { topic: 'support' }, route: 'support' },
      ],
      defaultRoute: 'general',
    },
  });
  await runtime.whenIdle();

  runtime.ingestEvent({
    to: 'router-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'conv-a',
    payload: { topic: 'billing', priority: 'high' },
  });
  runtime.ingestEvent({
    to: 'router-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'conv-a',
    payload: { topic: 'support' },
  });
  runtime.ingestEvent({
    to: 'router-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'conv-b',
    payload: { topic: 'other' },
  });

  await runtime.whenIdle();

  const memory = agent.snapshotMemory();
  const self = agent.describeSelf();
  const routerMemory = memory.apps['system.router'] as RouterMemory;
  const convA = /** @type {Record<string, unknown>} */ (memory.conversations['conv-a']);
  const convB = /** @type {Record<string, unknown>} */ (memory.conversations['conv-b']);
  const convADescription = agent.describeConversation('conv-a');

  assert.equal(routerMemory.rules.length, 3);
  assert.equal(convA['router:turnCount'], 2);
  assert.equal(convA['router:lastRoute'], 'support');
  assert.equal(convA['router:lastRuleId'], 'support');
  assert.equal(convB['router:turnCount'], 1);
  assert.equal(convB['router:lastRoute'], 'general');
  assert.ok(self.conversations.some((entry) => entry.conversationId === 'conv-a'));
  assert.ok(self.conversations.some((entry) => entry.conversationId === 'conv-b'));
  assert.ok((convADescription?.taskIds ?? []).length > 0);

  runtime.dispose();
});

test('router app is deterministic and uses first-match rule order', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'router-order-worker',
    installedApps: ['system.router'],
  });

  runtime.ingestEvent({
    to: 'router-order-worker',
    type: 'router.configure',
    targetAppId: 'system.router',
    conversationId: 'conv-order-config',
    payload: {
      rules: [
        { id: 'high-priority', when: { priority: 'high' }, route: 'urgent' },
        { id: 'billing', when: { topic: 'billing' }, route: 'finance' },
      ],
      defaultRoute: 'general',
    },
  });
  runtime.ingestEvent({
    to: 'router-order-worker',
    type: 'router.route',
    targetAppId: 'system.router',
    conversationId: 'conv-order',
    payload: { topic: 'billing', priority: 'high' },
  });

  await runtime.whenIdle();

  const self = agent.describeSelf();
  const memory = agent.snapshotMemory();
  const latestTask = self.tasks.at(-1);
  const latestResult = (latestTask?.result ?? null) as { route?: string; ruleId?: string } | null;
  const orderConversation = memory.conversations['conv-order'] as Record<string, unknown>;

  assert.ok(latestResult);
  assert.equal(latestResult.route, 'urgent');
  assert.equal(latestResult.ruleId, 'high-priority');
  assert.equal(orderConversation['router:lastRoute'], 'urgent');
  assert.equal(orderConversation['router:lastRuleId'], 'high-priority');

  runtime.dispose();
});
