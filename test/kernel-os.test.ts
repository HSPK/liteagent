import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { AgentsRuntime, registerBuiltinApps } from '../src/index.js';
import type { AppDefinition } from '../src/apps/types.js';

function createSignalWaitAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.signal-wait',
    kind: 'domain',
    version: '0.1.0',
    title: 'Signal Wait',
    priority: 70,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || (signal.type ?? '').startsWith('job.');
      },
      async onSignal(context, signal) {
        switch (signal.type) {
          case 'job.start':
            context.memory.task.set('note', signal.payload?.note ?? null);
            context.task.awaitSignal({
              reason: 'waiting for job.finish',
              type: 'job.finish',
              timeoutMs: Number(signal.payload?.timeoutMs ?? 0) || null,
              timeoutType: 'job.timeout',
              timeoutPayload: { note: signal.payload?.note ?? null },
            });
            return;
          case 'job.finish':
            context.complete({
              status: 'finished',
              note: context.memory.task.get('note'),
            });
            return;
          case 'job.timeout':
            context.complete({
              status: 'timed-out',
              note: context.memory.task.get('note', signal.payload?.note ?? null),
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

function createToolSignalAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.tool-signal',
    kind: 'domain',
    version: '0.1.0',
    title: 'Tool Signal',
    priority: 70,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type === 'calc.start' || signal.type === 'tool.result' || signal.type === 'tool.timeout';
      },
      async onSignal(context, signal) {
        switch (signal.type) {
          case 'calc.start': {
            const { callId } = context.tools.request('double', {
              value: signal.payload?.value ?? 0,
            }) as { callId: string };
            context.wait({
              reason: 'waiting for tool.result',
              resumeOnSignals: [
                {
                  kind: 'tool',
                  type: 'tool.result',
                  metadata: { toolCallId: callId },
                },
              ],
              timeoutMs: 40,
              timeoutType: 'tool.timeout',
            });
            return;
          }
          case 'tool.result':
            context.complete({
              status: 'tool-result',
              payload: signal.payload,
            });
            return;
          case 'tool.timeout':
            context.complete({
              status: 'tool-timeout',
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

function createMemoryScopeAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.memory-scope',
    kind: 'domain',
    version: '0.1.0',
    title: 'Memory Scope',
    priority: 70,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.type === 'memory.write';
      },
      async onSignal(context, signal) {
        const scope = context.memory.scope('workspace', (signal.payload?.scopeId ?? 'default') as string);
        scope.merge({
          count: signal.payload?.count ?? 0,
          note: signal.payload?.note ?? null,
        });
        context.complete({
          named: scope.entries(),
        });
      },
    }),
  } satisfies AppDefinition;
}

test('structured wait resumes a waiting task on matching signals without targetTaskId', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  runtime.registerApp(createSignalWaitAppDefinition());

  const agent = await runtime.createAgent({
    id: 'signal-waiter',
    installedApps: ['domain.signal-wait'],
  });

  const startHandle = runtime.event({
    to: 'signal-waiter',
    type: 'job.start',
    app: 'domain.signal-wait',
    conversationId: 'job-thread',
    payload: {
      note: 'deploy api',
      timeoutMs: 40,
    },
  });

  await agent.whenIdle();
  assert.equal(startHandle.task()?.status, 'waiting');

  runtime.ingestEvent({
    to: 'signal-waiter',
    type: 'job.finish',
    targetAppId: 'domain.signal-wait',
    conversationId: 'job-thread',
  });

  const result = (await startHandle.result()) as { status?: string; note?: string } | null;
  const events = startHandle.events() as Array<{ type?: string }>;
  assert.ok(result);

  assert.equal(result.status, 'finished');
  assert.equal(result.note, 'deploy api');
  assert.ok(events.some((event) => event.type === 'task.waiting'));
  assert.ok(events.some((event) => event.type === 'task.timeout.cancelled'));

  runtime.dispose();
});

test('structured wait can complete a task from its timeout signal', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  runtime.registerApp(createSignalWaitAppDefinition());

  const agent = await runtime.createAgent({
    id: 'timeout-waiter',
    installedApps: ['domain.signal-wait'],
  });

  const handle = runtime.event({
    to: 'timeout-waiter',
    type: 'job.start',
    app: 'domain.signal-wait',
    conversationId: 'timeout-thread',
    payload: {
      note: 'ping service',
      timeoutMs: 20,
    },
  });

  await sleep(45);
  const result = (await handle.result()) as { status?: string; note?: string } | null;
  const events = handle.events() as Array<{ type?: string }>;
  assert.ok(result);

  assert.equal(result.status, 'timed-out');
  assert.equal(result.note, 'ping service');
  assert.ok(events.some((event) => event.type === 'task.timeout.scheduled'));

  runtime.dispose();
});

test('tool calls can travel through tool.call/tool.result signals and surface in task events', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  runtime.registerApp(createToolSignalAppDefinition());

  const agent = await runtime.createAgent({
    id: 'tool-agent',
    installedApps: ['domain.tool-signal'],
  });

  agent.registerTool({
    name: 'double',
    description: 'Double a numeric value.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    async execute(input: { value: number }) {
      return {
        doubled: input.value * 2,
      };
    },
  });

  const handle = runtime.event({
    to: 'tool-agent',
    type: 'calc.start',
    app: 'domain.tool-signal',
    conversationId: 'tool-thread',
    payload: {
      value: 21,
    },
  });

  const result = (await handle.result()) as {
    status?: string;
    payload?: { ok?: boolean; output?: { doubled?: number } };
  } | null;
  const events = handle.events() as Array<{ type?: string }>;
  assert.ok(result);
  assert.ok(result.payload);
  assert.ok(result.payload.output);

  assert.equal(result.status, 'tool-result');
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.output.doubled, 42);
  assert.ok(events.some((event) => event.type === 'tool.call.enqueued'));
  assert.ok(events.some((event) => event.type === 'tool.call.signal'));
  assert.ok(events.some((event) => event.type === 'tool.result.signal'));

  runtime.dispose();
});

test('memory named scopes survive snapshot and restore', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  runtime.registerApp(createMemoryScopeAppDefinition());

  await runtime.createAgent({
    id: 'memory-agent',
    installedApps: ['domain.memory-scope'],
  });

  const handle = runtime.event({
    to: 'memory-agent',
    type: 'memory.write',
    app: 'domain.memory-scope',
    conversationId: 'memory-thread',
    payload: {
      scopeId: 'workspace-1',
      count: 3,
      note: 'draft',
    },
  });

  const result = (await handle.result()) as {
    named?: { count?: number; note?: string };
  } | null;
  const snapshot = await runtime.snapshot();
  assert.ok(result?.named);

  assert.equal(result.named.count, 3);
  assert.equal(result.named.note, 'draft');
  const memoryAgent = runtime.getAgent('memory-agent');
  assert.ok(memoryAgent);
  assert.equal(memoryAgent.snapshotMemory().named?.workspace?.['workspace-1']?.count, 3);

  runtime.dispose();

  const restored = registerBuiltinApps(new AgentsRuntime());
  restored.registerApp(createMemoryScopeAppDefinition());
  await restored.restore(snapshot);
  const restoredAgent = restored.getAgent('memory-agent');
  assert.ok(restoredAgent);

  assert.equal(
    restoredAgent.snapshotMemory().named?.workspace?.['workspace-1']?.note,
    'draft',
  );

  restored.dispose();
});
