import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentPolicy, createRuntime, createEvent } from '../src/index.js';
import { AppHost } from '../src/apps/app-host.js';
import type { AppDefinition, AppLike } from '../src/apps/types.js';
import { TaskRuntime } from '../src/kernel/task-runtime.js';

function createBoundaryAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.boundary-check',
    kind: 'domain',
    version: '0.1.0',
    title: 'Boundary Check',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.type === 'text';
      },
      async onSignal(context) {
        context.complete({
          hasRuntime: Object.hasOwn(context, 'runtime'),
          hasTaskFacade: typeof context.task.wait === 'function',
          hasMemoryScope: typeof context.memory.scope === 'function',
          hasToolRequest: typeof context.tools.request === 'function',
        });
      },
    }),
  } satisfies AppDefinition;
}

function createTestApp(appId: string, priority: number): AppLike {
  return {
    manifest: {
      id: appId,
      kind: 'domain',
      version: '0.1.0',
      title: appId,
      priority,
    },
    async onSignal() {},
  } satisfies AppLike;
}

test('execution context exposes syscall facades without leaking raw runtime', async () => {
  const runtime = createRuntime({
    appDefinitions: [createBoundaryAppDefinition()],
  });
  const agent = await runtime.createAgent({
    id: 'boundary-agent',
    apps: ['domain.boundary-check'],
  });

  const result = await agent.text('check boundary', {
    app: 'domain.boundary-check',
    conversationId: 'boundary-thread',
  }).result();
  assert.ok(result);
  const boundaryResult = result as {
    hasRuntime?: boolean;
    hasTaskFacade?: boolean;
    hasMemoryScope?: boolean;
    hasToolRequest?: boolean;
  };

  assert.equal(boundaryResult.hasRuntime, false);
  assert.equal(boundaryResult.hasTaskFacade, true);
  assert.equal(boundaryResult.hasMemoryScope, true);
  assert.equal(boundaryResult.hasToolRequest, true);

  runtime.dispose();
});

test('task runtime resolves signal ids and waiting tasks through indexes', () => {
  const runtime = new TaskRuntime();

  const firstSignal = createEvent({
    to: 'worker',
    type: 'alpha.start',
    conversationId: 'conv-alpha',
  });
  const secondSignal = createEvent({
    to: 'worker',
    type: 'beta.start',
    conversationId: 'conv-beta',
  });

  const alphaTask = runtime.createTask({
    appId: 'domain.alpha',
    signal: firstSignal,
  });
  const betaTask = runtime.createTask({
    appId: 'domain.beta',
    signal: secondSignal,
  });

  runtime.waitTask(alphaTask.id, {
    reason: 'waiting alpha',
    type: 'alpha.resume',
  });
  runtime.waitTask(betaTask.id, {
    reason: 'waiting beta',
    type: 'beta.resume',
  });

  assert.equal(runtime.findTaskBySignalId(firstSignal.id)?.id, alphaTask.id);
  assert.equal(runtime.findTaskBySignalId(secondSignal.id)?.id, betaTask.id);

  const resumeSignal = createEvent({
    to: 'worker',
    type: 'beta.resume',
    conversationId: 'conv-beta',
  });

  assert.equal(runtime.findResumableTask(resumeSignal)?.id, betaTask.id);

  runtime.resumeTask(betaTask.id, resumeSignal);
  assert.equal(runtime.findTaskBySignalId(resumeSignal.id)?.id, betaTask.id);
});

test('app host invalidates cached priority order on install and uninstall', () => {
  const host = new AppHost(new AgentPolicy());

  host.install(createTestApp('domain.low', 10));
  host.install(createTestApp('domain.high', 50));

  assert.deepEqual(
    host.getAppsByPriority().map((app) => app.manifest.id),
    ['domain.high', 'domain.low'],
  );

  host.uninstall('domain.high');
  host.install(createTestApp('domain.mid', 30));

  assert.deepEqual(
    host.getAppsByPriority().map((app) => app.manifest.id),
    ['domain.mid', 'domain.low'],
  );
});
