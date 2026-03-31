import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  JsonFileStateBackend,
  JsonlFileObservabilityBackend,
  createRuntime,
} from '../src/index.js';
import type { AppDefinition } from '../src/apps/types.js';

function createSchedulerAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.scheduler',
    kind: 'domain',
    version: '0.1.0',
    title: 'Scheduler',
    priority: 70,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || (signal.type ?? '').startsWith('schedule.');
      },
      async onSignal(context, signal) {
        switch (signal.type) {
          case 'schedule.start': {
            const targetCount = Number(signal.payload?.targetCount ?? 2);
            const record = context.scheduler.recurring({
              type: 'schedule.tick',
              intervalMs: Number(signal.payload?.intervalMs ?? 10),
            }) as { id: string };
            context.memory.task.set('schedule:id', record.id);
            context.memory.task.set('schedule:count', 0);
            context.memory.task.set('schedule:targetCount', targetCount);
            context.wait({
              reason: 'waiting for schedule.tick',
              resumeOnSignals: [{ kind: 'timer', type: 'schedule.tick' }],
            });
            return;
          }
          case 'schedule.tick': {
            const count = Number(context.memory.task.get('schedule:count', 0)) + 1;
            const targetCount = Number(context.memory.task.get('schedule:targetCount', 2));
            context.memory.task.set('schedule:count', count);

            if (count < targetCount) {
              context.wait({
                reason: 'waiting for schedule.tick',
                resumeOnSignals: [{ kind: 'timer', type: 'schedule.tick' }],
              });
              return;
            }

            const scheduleId = context.memory.task.get('schedule:id') as string;
            context.scheduler.cancel(scheduleId);
            context.complete({
              status: 'scheduled',
              count,
              scheduleId,
            });
            return;
          }
          case 'schedule.start-at': {
            const record = context.scheduler.at({
              type: 'schedule.once',
              at: Date.now() + Number(signal.payload?.delayMs ?? 10),
            }) as { id: string };
            context.memory.task.set('schedule:id', record.id);
            context.task.awaitSignal({
              reason: 'waiting for schedule.once',
              type: 'schedule.once',
            });
            return;
          }
          case 'schedule.once':
            context.complete({
              status: 'at-fired',
              scheduleId: signal.metadata?.scheduleId ?? null,
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

function createHoldAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.hold',
    kind: 'domain',
    version: '0.1.0',
    title: 'Hold',
    priority: 70,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || (signal.type ?? '').startsWith('hold.');
      },
      async onSignal(context, signal) {
        switch (signal.type) {
          case 'hold.start':
            context.task.awaitSignal({
              reason: 'waiting for hold.finish',
              type: 'hold.finish',
            });
            return;
          case 'hold.finish':
            context.complete({ status: 'finished' });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

test('scheduler service supports recurring and absolute schedules and emits runtime scheduler events', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createSchedulerAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'scheduler-agent',
    installedApps: ['domain.scheduler'],
  });

  const recurring = runtime.event({
    to: 'scheduler-agent',
    type: 'schedule.start',
    app: 'domain.scheduler',
    conversationId: 'schedule-thread',
    payload: {
      targetCount: 2,
      intervalMs: 10,
    },
  });
  await sleep(35);
  const recurringResult = (await recurring.result()) as { status?: string; count?: number; scheduleId?: string } | null;

  const atHandle = runtime.event({
    to: 'scheduler-agent',
    type: 'schedule.start-at',
    app: 'domain.scheduler',
    conversationId: 'schedule-at-thread',
    payload: {
      delayMs: 10,
    },
  });
  await sleep(20);
  const atResult = (await atHandle.result()) as { status?: string } | null;
  const schedulerEvents = (await runtime.queryEvents({
    agentId: 'scheduler-agent',
    type: 'scheduler.event',
  })) as Array<{ event: { type?: string; schedule?: { kind?: string } } }>;
  const self = agent.describeSelf();
  assert.ok(recurringResult);
  assert.ok(atResult);
  assert.ok(self.schedules);

  assert.equal(recurringResult.status, 'scheduled');
  assert.equal(recurringResult.count, 2);
  assert.equal(atResult.status, 'at-fired');
  assert.ok(self.schedules.some((record) => record.id === recurringResult.scheduleId));
  assert.ok(schedulerEvents.some((entry) => entry.event.type === 'schedule.created'));
  assert.ok(schedulerEvents.some((entry) => entry.event.type === 'schedule.triggered'));
  assert.ok(schedulerEvents.some((entry) => entry.event.type === 'schedule.cancelled'));
  assert.ok(schedulerEvents.some((entry) => entry.event.type === 'schedule.completed' && entry.event.schedule?.kind === 'at'));

  runtime.dispose();
});

test('policy denies new task creation when maxActiveTasks is exceeded', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createHoldAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'limited-agent',
    installedApps: ['domain.hold'],
    policy: {
      maxActiveTasks: 1,
    },
  });

  const first = runtime.event({
    to: 'limited-agent',
    type: 'hold.start',
    app: 'domain.hold',
    conversationId: 'hold-1',
  });
  await runtime.whenIdle();

  runtime.event({
    to: 'limited-agent',
    type: 'hold.start',
    app: 'domain.hold',
    conversationId: 'hold-2',
  });
  await runtime.whenIdle();

  const policyEvents = (await runtime.queryEvents({
    agentId: 'limited-agent',
    type: 'policy.event',
  })) as Array<{ event: { operation?: string; decision?: { reason?: string } } }>;

  assert.equal(first.task()?.status, 'waiting');
  assert.equal(agent.describeSelf().tasks.length, 1);
  assert.ok(policyEvents.some((entry) => entry.event.operation === 'task.create'));
  assert.ok(policyEvents.some((entry) => entry.event.decision?.reason === 'max-active-tasks-exceeded'));

  runtime.ingestEvent({
    to: 'limited-agent',
    type: 'hold.finish',
    targetAppId: 'domain.hold',
    conversationId: 'hold-1',
  });
  await first.result();

  runtime.dispose();
});

test('policy denies recurring schedules and surfaces both task failure and runtime policy events', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createSchedulerAppDefinition()],
  });

  const handle = await runtime.createAgent({
    id: 'policy-scheduler-agent',
    installedApps: ['domain.scheduler'],
    policy: {
      allowRecurringSchedules: false,
    },
  });

  const start = runtime.event({
    to: 'policy-scheduler-agent',
    type: 'schedule.start',
    app: 'domain.scheduler',
    conversationId: 'schedule-policy-thread',
  });
  await runtime.whenIdle();

  const policyEvents = (await runtime.queryEvents({
    agentId: 'policy-scheduler-agent',
    type: 'policy.event',
  })) as Array<{ event: { operation?: string } }>;

  assert.equal(start.task()?.status, 'failed');
  assert.ok(policyEvents.some((entry) => entry.event.operation === 'schedule.recurring'));
  assert.ok(handle.snapshotMemory().agent['kernel:lastPolicyDenial'] as unknown);

  runtime.dispose();
});

test('runtime state and observability backends persist snapshots and runtime events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-kernel-services-'));
  const statePath = join(directory, 'runtime-state.json');
  const eventsPath = join(directory, 'runtime-events.jsonl');

  const runtime = createRuntime({
    stateBackend: new JsonFileStateBackend(statePath),
    observabilityBackend: new JsonlFileObservabilityBackend(eventsPath),
    autoSaveDebounceMs: 5,
  });

  await runtime.createAgent({
    id: 'persistent-agent',
    installedApps: ['domain.echo'],
  });

  const handle = runtime.text({
    to: 'persistent-agent',
    text: 'persist me',
    app: 'domain.echo',
    conversationId: 'persist-thread',
  });
  await handle.result();
  await runtime.flushState();

  const taskEvents = (await runtime.queryEvents({
    agentId: 'persistent-agent',
    type: 'task.event',
    eventType: 'task.completed',
  })) as unknown[];

  assert.ok(taskEvents.length >= 1);

  runtime.dispose();

  const restored = createRuntime({
    stateBackend: new JsonFileStateBackend(statePath),
  });
  await restored.loadState();

  const restoredAgent = restored.getAgent('persistent-agent');
  assert.ok(restoredAgent);
  const memory = restoredAgent.snapshotMemory();
  const fileEvents = (await new JsonlFileObservabilityBackend(eventsPath).query({
    agentId: 'persistent-agent',
    type: 'task.event',
  })) as Array<{ event?: { type?: string } }>;
  const lastText = memory.agent['echo:lastText'] as { text?: string };

  assert.equal(lastText.text, 'persist me');
  assert.ok(fileEvents.some((entry) => entry.event?.type === 'task.completed'));

  restored.dispose();
  await rm(directory, { recursive: true, force: true });
});
