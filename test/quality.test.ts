import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WebhookIngressServer,
  createRuntime,
} from '../src/index.js';
import type { AppDefinition } from '../src/apps/types.js';

const badMatcherDefinition = {
  manifest: {
    id: 'domain.bad-matcher',
    kind: 'domain',
    version: '0.1.0',
    title: 'Bad Matcher',
    priority: 100,
  },
  provenance: 'test',
  create: () => ({
    manifest: {
      id: 'domain.bad-matcher',
      kind: 'domain',
      version: '0.1.0',
      title: 'Bad Matcher',
      priority: 100,
    },
    canHandle(signal) {
      if (signal.type === 'text') {
        throw new Error('matcher exploded');
      }

      return false;
    },
    async onSignal(context, signal) {
      context.complete({ ignored: signal.type });
    },
  }),
} satisfies AppDefinition;

test('runtime rejects duplicate agent ids', async () => {
  const runtime = createRuntime();
  await runtime.createAgent('duplicate-agent');

  await assert.rejects(
    () => runtime.createAgent('duplicate-agent'),
    /Agent already exists: duplicate-agent/,
  );

  runtime.dispose();
});

test('duplicate app installation is idempotent', async () => {
  const runtime = createRuntime();
  const agent = await runtime.createAgent('idempotent-worker');

  await agent.installAppById('domain.echo');
  await agent.installAppById('domain.echo');

  const self = agent.describeSelf();
  const installEvents = self.history.filter(
    (entry) => entry.type === 'app.installed' && entry.details?.appId === 'domain.echo',
  );

  assert.equal(self.apps.filter((entry) => entry.appId === 'domain.echo').length, 1);
  assert.equal(installEvents.length, 1);

  runtime.dispose();
});

test('dispatch handles resolve the task result for their originating signal', async () => {
  const runtime = createRuntime();
  const { writer } = await runtime.createAgents([
    { id: 'writer', apps: ['domain.echo'] },
  ]);

  const first = writer.text('first draft', {
    app: 'domain.echo',
    conversationId: 'shared-conversation',
  });
  const second = writer.text('second draft', {
    app: 'domain.echo',
    conversationId: 'shared-conversation',
  });

  const firstResult = await first.result();
  const secondResult = await second.result();
  assert.ok(firstResult);
  assert.ok(secondResult);
  const firstEcho = firstResult as { text?: string };
  const secondEcho = secondResult as { text?: string };

  assert.equal(firstEcho.text, 'first draft');
  assert.equal(secondEcho.text, 'second draft');
  assert.notEqual(first.signal.id, second.signal.id);
  assert.notEqual(first.task()?.id, second.task()?.id);

  runtime.dispose();
});

test('webhook ingress returns 400 for malformed requests and 404 for unknown agents', async () => {
  const runtime = createRuntime();
  const ingress = new WebhookIngressServer({
    runtime,
    path: '/hooks',
  });

  const server = await ingress.start();
  assert.ok(server.url);
  const malformed = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
  const unknownAgent = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: 'missing-agent',
      type: 'text',
    }),
  });

  assert.equal(malformed.status, 400);
  assert.equal(unknownAgent.status, 404);

  await ingress.stop();
  runtime.dispose();
});

test('bad canHandle implementations do not wedge the mailbox', async () => {
  const runtime = createRuntime({
    appDefinitions: [badMatcherDefinition],
  });
  const { resilient } = await runtime.createAgents([
    { id: 'resilient', apps: ['domain.bad-matcher', 'domain.echo'] },
  ]);

  const result = await resilient.text('still works', {
    conversationId: 'resilient-thread',
  }).result();
  assert.ok(result);
  const echoResult = result as { text?: string };
  const lastText = resilient.snapshotMemory().agent['echo:lastText'] as { text?: string };

  assert.equal(echoResult.text, 'still works');
  assert.equal(lastText.text, 'still works');
  assert.ok(
    resilient
      .describeSelf()
      .history.some((entry) => entry.type === 'app.matchFailed' && entry.details?.appId === 'domain.bad-matcher'),
  );

  runtime.dispose();
});

test('runtime restore validates snapshot version', async () => {
  const runtime = createRuntime();

  await assert.rejects(
    () => runtime.restore({ version: 2, agents: [] }),
    /Unsupported runtime snapshot version: 2/,
  );

  runtime.dispose();
});
