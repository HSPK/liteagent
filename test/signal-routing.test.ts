import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntime } from '../src/index.js';
import type {
  ExecutionContext,
  RoutingContext,
  SignalLike as AgentSignalLike,
  TaskEventRecord,
  TaskInboxEntry,
  TaskRecord,
} from '../src/agent/types.js';
import type { AppDefinition, AppRouteDecision } from '../src/apps/types.js';

function createDirectedRoutingAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.directed-routing',
    kind: 'domain',
    version: '0.1.0',
    title: 'Directed Routing',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal: AgentSignalLike) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('job.');
      },
      async routeSignal(context: RoutingContext, signal: AgentSignalLike): Promise<AppRouteDecision> {
        const waitingTasks = context.tasks.list({ status: 'waiting' }) as TaskRecord[];

        switch (signal.type) {
          case 'job.start':
            return {
              action: 'spawn',
              title: `job:${signal.payload?.jobId ?? 'unknown'}`,
            };
          case 'job.finish': {
            const match = waitingTasks.find((task) =>
              context.memory.task(task.id).get('jobId') === signal.payload?.jobId);

            if (!match) {
              return { action: 'ignore' };
            }

            return {
              action: 'resume',
              taskId: match.id,
            };
          }
          default:
            return null;
        }
      },
      async onSignal(context: ExecutionContext, signal: AgentSignalLike) {
        switch (signal.type) {
          case 'job.start':
            context.memory.task.set('jobId', signal.payload?.jobId ?? null);
            context.task.awaitSignal({
              reason: 'waiting for job.finish',
              type: 'job.finish',
            });
            return;
          case 'job.finish':
            context.complete({
              jobId: context.memory.task.get('jobId'),
              note: signal.payload?.note ?? null,
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

test('apps can direct signal routing to a specific waiting task by inspecting task memory', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createDirectedRoutingAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'router-agent',
    installedApps: ['domain.directed-routing'],
  });

  const startA = runtime.event({
    to: 'router-agent',
    type: 'job.start',
    app: 'domain.directed-routing',
    conversationId: 'routing-thread',
    payload: {
      jobId: 'a',
    },
  });
  const startB = runtime.event({
    to: 'router-agent',
    type: 'job.start',
    app: 'domain.directed-routing',
    conversationId: 'routing-thread',
    payload: {
      jobId: 'b',
    },
  });

  await agent.whenIdle();
  assert.equal(startA.task()?.status, 'waiting');
  assert.equal(startB.task()?.status, 'waiting');

  runtime.ingestEvent({
    to: 'router-agent',
    type: 'job.finish',
    targetAppId: 'domain.directed-routing',
    conversationId: 'routing-thread',
    payload: {
      jobId: 'b',
      note: 'finish second task first',
    },
  });

  const resultB = await startB.result();
  const resultA = startA.task()?.result ?? null;
  const eventsB = startB.events() as TaskEventRecord[];

  assert.deepEqual(resultB, {
    jobId: 'b',
    note: 'finish second task first',
  });
  assert.equal(resultA, null);
  assert.ok(eventsB.some((event) => event.type === 'signal.received'
    && (event.data as { routeSource?: string } | null | undefined)?.routeSource === 'app-router'));
  assert.equal(startA.task()?.status, 'waiting');
  assert.equal(startB.task()?.status, 'completed');

  runtime.dispose();
});

function createInboxRoutingAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.inbox-routing',
    kind: 'domain',
    version: '0.1.0',
    title: 'Inbox Routing',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal: AgentSignalLike) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('ctx.');
      },
      async routeSignal(context: RoutingContext, signal: AgentSignalLike): Promise<AppRouteDecision> {
        const waitingTasks = context.tasks.list({ status: 'waiting' }) as TaskRecord[];
        const matchTask = waitingTasks.find((task) =>
          context.memory.task(task.id).get('jobId') === signal.payload?.jobId);

        switch (signal.type) {
          case 'ctx.start':
            return { action: 'spawn', title: `ctx:${signal.payload?.jobId ?? 'unknown'}` };
          case 'ctx.add':
            return matchTask
              ? { action: 'queue', taskId: matchTask.id }
              : { action: 'ignore' };
          case 'ctx.finish':
            return matchTask
              ? { action: 'resume', taskId: matchTask.id }
              : { action: 'ignore' };
          default:
            return null;
        }
      },
      async onSignal(context: ExecutionContext, signal: AgentSignalLike) {
        switch (signal.type) {
          case 'ctx.start':
            context.memory.task.set('jobId', signal.payload?.jobId ?? null);
            context.task.awaitSignal({
              reason: 'waiting for ctx.finish',
              type: 'ctx.finish',
            });
            return;
          case 'ctx.finish': {
            const notes = context.task.inbox.drain().map((entry: TaskInboxEntry) => entry.signal.payload?.note ?? null);
            context.complete({
              jobId: context.memory.task.get('jobId'),
              notes,
              final: signal.payload?.final ?? null,
            });
            return;
          }
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

test('apps can queue signals into a waiting task inbox and consume them later', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createInboxRoutingAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'inbox-agent',
    installedApps: ['domain.inbox-routing'],
  });

  const start = runtime.event({
    to: 'inbox-agent',
    type: 'ctx.start',
    app: 'domain.inbox-routing',
    conversationId: 'ctx-thread',
    payload: {
      jobId: 'job-1',
    },
  });

  await agent.whenIdle();
  assert.equal(start.task()?.status, 'waiting');

  runtime.ingestEvent({
    to: 'inbox-agent',
    type: 'ctx.add',
    targetAppId: 'domain.inbox-routing',
    conversationId: 'ctx-thread',
    payload: {
      jobId: 'job-1',
      note: 'first',
    },
  });
  runtime.ingestEvent({
    to: 'inbox-agent',
    type: 'ctx.add',
    targetAppId: 'domain.inbox-routing',
    conversationId: 'ctx-thread',
    payload: {
      jobId: 'job-1',
      note: 'second',
    },
  });

  await agent.whenIdle();
  assert.equal(start.task()?.status, 'waiting');
  const queuedTask = start.task() as { inboxSize?: number } | null;
  assert.equal(queuedTask?.inboxSize, 2);

  runtime.ingestEvent({
    to: 'inbox-agent',
    type: 'ctx.finish',
    targetAppId: 'domain.inbox-routing',
    conversationId: 'ctx-thread',
    payload: {
      jobId: 'job-1',
      final: 'done',
    },
  });

  const result = await start.result();
  const events = start.events();

  assert.deepEqual(result, {
    jobId: 'job-1',
    notes: ['first', 'second'],
    final: 'done',
  });
  assert.ok(events.some((event) => event.type === 'task.inbox.enqueued'));
  assert.ok(events.some((event) => event.type === 'task.inbox.drained'));

  runtime.dispose();
});

test('task inbox survives snapshot and restore before the task resumes', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createInboxRoutingAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'durable-inbox-agent',
    installedApps: ['domain.inbox-routing'],
  });

  const start = runtime.event({
    to: 'durable-inbox-agent',
    type: 'ctx.start',
    app: 'domain.inbox-routing',
    conversationId: 'durable-ctx-thread',
    payload: {
      jobId: 'job-restore',
    },
  });

  await agent.whenIdle();
  runtime.ingestEvent({
    to: 'durable-inbox-agent',
    type: 'ctx.add',
    targetAppId: 'domain.inbox-routing',
    conversationId: 'durable-ctx-thread',
    payload: {
      jobId: 'job-restore',
      note: 'persisted note',
    },
  });
  await agent.whenIdle();

  const snapshot = await runtime.snapshot();
  runtime.dispose();

  const restored = createRuntime({
    builtinApps: false,
    appDefinitions: [createInboxRoutingAppDefinition()],
  });
  await restored.restore(snapshot);

  restored.ingestEvent({
    to: 'durable-inbox-agent',
    type: 'ctx.finish',
    targetAppId: 'domain.inbox-routing',
    conversationId: 'durable-ctx-thread',
    payload: {
      jobId: 'job-restore',
      final: 'after-restore',
    },
  });

  await restored.whenIdle();
  const restoredAgent = restored.getAgent('durable-inbox-agent');
  assert.ok(restoredAgent);
  const task = restoredAgent.findTaskBySignalId(start.signal.id);
  assert.ok(task);

  assert.deepEqual(task.result, {
    jobId: 'job-restore',
    notes: ['persisted note'],
    final: 'after-restore',
  });

  restored.dispose();
});

function createDependencyAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.dependencies',
    kind: 'domain',
    version: '0.1.0',
    title: 'Dependencies',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal: AgentSignalLike) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('dep.');
      },
      async routeSignal(context: RoutingContext, signal: AgentSignalLike): Promise<AppRouteDecision> {
        const waitingTasks = context.tasks.list({ status: 'waiting' }) as TaskRecord[];
        const match = waitingTasks.find((task) =>
          context.memory.task(task.id).get('jobId') === signal.payload?.jobId
          && context.memory.task(task.id).get('kind') === 'prepare');

        switch (signal.type) {
          case 'dep.prepare.start':
          case 'dep.execute.start':
            return { action: 'spawn', title: signal.type };
          case 'dep.prepare.finish':
            return match ? { action: 'resume', taskId: match.id } : { action: 'ignore' };
          default:
            return null;
        }
      },
      async onSignal(context: ExecutionContext, signal: AgentSignalLike) {
        switch (signal.type) {
          case 'dep.prepare.start':
            context.memory.task.set('kind', 'prepare');
            context.memory.task.set('jobId', signal.payload?.jobId ?? null);
            context.memory.app.set(`prepare:${signal.payload?.jobId ?? ''}`, {
              taskId: context.task.id,
            });
            context.task.awaitSignal({
              reason: 'waiting for dep.prepare.finish',
              type: 'dep.prepare.finish',
            });
            return;
          case 'dep.prepare.finish':
            context.complete({
              kind: 'prepare',
              jobId: context.memory.task.get('jobId'),
            });
            return;
          case 'dep.execute.start': {
            const jobId = signal.payload?.jobId ?? null;
            const dependency = context.memory.app.get(`prepare:${jobId}`) as { taskId?: string };
            context.memory.task.set('kind', 'execute');
            context.memory.task.set('jobId', jobId);
            context.task.awaitTasks([dependency.taskId ?? ''], {
              reason: 'waiting for prepare task',
            });
            return;
          }
          case 'task.dependency.ready':
            context.complete({
              kind: 'execute',
              jobId: context.memory.task.get('jobId'),
              dependencyTaskId: signal.payload?.dependencyTaskId ?? null,
              dependencyTaskStatus: signal.payload?.dependencyTaskStatus ?? null,
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

test('tasks can wait for other tasks to complete before resuming', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createDependencyAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'dependency-agent',
    installedApps: ['domain.dependencies'],
  });

  const prepare = runtime.event({
    to: 'dependency-agent',
    type: 'dep.prepare.start',
    app: 'domain.dependencies',
    conversationId: 'dep-thread',
    payload: {
      jobId: 'job-dep',
    },
  });
  const execute = runtime.event({
    to: 'dependency-agent',
    type: 'dep.execute.start',
    app: 'domain.dependencies',
    conversationId: 'dep-thread',
    payload: {
      jobId: 'job-dep',
    },
  });

  await agent.whenIdle();
  assert.equal(prepare.task()?.status, 'waiting');
  assert.equal(execute.task()?.status, 'waiting');

  runtime.ingestEvent({
    to: 'dependency-agent',
    type: 'dep.prepare.finish',
    targetAppId: 'domain.dependencies',
    conversationId: 'dep-thread',
    payload: {
      jobId: 'job-dep',
    },
  });

  const executeResult = await execute.result();
  const executeEvents = execute.events() as TaskEventRecord[];

  assert.deepEqual(executeResult, {
    kind: 'execute',
    jobId: 'job-dep',
    dependencyTaskId: prepare.task()?.id ?? null,
    dependencyTaskStatus: 'completed',
  });
  assert.ok(executeEvents.some((event) => event.type === 'task.dependency.progress'));
  assert.ok(executeEvents.some((event) => event.type === 'task.dependency.ready'));

  runtime.dispose();
});

function createInterruptibleAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.interruptible',
    kind: 'domain',
    version: '0.1.0',
    title: 'Interruptible',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal: AgentSignalLike) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('intr.') || signal.type === 'task.interrupt';
      },
      async routeSignal(context: RoutingContext, signal: AgentSignalLike): Promise<AppRouteDecision> {
        const waitingTasks = context.tasks.list({ status: 'waiting' }) as TaskRecord[];
        const match = waitingTasks.find((task) =>
          context.memory.task(task.id).get('jobId') === signal.payload?.jobId);

        switch (signal.type) {
          case 'intr.start':
            return { action: 'spawn', title: `intr:${signal.payload?.jobId ?? 'unknown'}` };
          case 'intr.context':
            return match ? { action: 'interrupt', taskId: match.id } : { action: 'ignore' };
          case 'intr.finish':
            return match ? { action: 'resume', taskId: match.id } : { action: 'ignore' };
          default:
            return null;
        }
      },
      async onSignal(context: ExecutionContext, signal: AgentSignalLike) {
        switch (signal.type) {
          case 'intr.start':
            context.memory.task.set('jobId', signal.payload?.jobId ?? null);
            context.memory.task.set('notes', []);
            context.task.awaitSignal({
              reason: 'waiting for intr.finish',
              type: 'intr.finish',
            });
            return;
          case 'task.interrupt': {
            const notes = context.task.inbox.drain().map((entry: TaskInboxEntry) => entry.signal.payload?.note ?? null);
            const existingNotes = context.memory.task.get('notes', []) as unknown[];
            context.memory.task.set('notes', [
              ...existingNotes,
              ...notes,
            ]);
            context.task.awaitSignal({
              reason: 'waiting for intr.finish',
              type: 'intr.finish',
            });
            return;
          }
          case 'intr.finish':
            context.complete({
              jobId: context.memory.task.get('jobId'),
              notes: context.memory.task.get('notes', []),
              final: signal.payload?.final ?? null,
            });
            return;
          default:
            context.complete({ ignored: signal.type });
        }
      },
    }),
  } satisfies AppDefinition;
}

test('apps can interrupt a waiting task, inject context, and continue waiting', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createInterruptibleAppDefinition()],
  });

  const agent = await runtime.createAgent({
    id: 'interrupt-agent',
    installedApps: ['domain.interruptible'],
  });

  const start = runtime.event({
    to: 'interrupt-agent',
    type: 'intr.start',
    app: 'domain.interruptible',
    conversationId: 'interrupt-thread',
    payload: {
      jobId: 'job-interrupt',
    },
  });

  await agent.whenIdle();
  runtime.ingestEvent({
    to: 'interrupt-agent',
    type: 'intr.context',
    targetAppId: 'domain.interruptible',
    conversationId: 'interrupt-thread',
    payload: {
      jobId: 'job-interrupt',
      note: 'new context',
    },
  });

  await agent.whenIdle();
  assert.equal(start.task()?.status, 'waiting');

  runtime.ingestEvent({
    to: 'interrupt-agent',
    type: 'intr.finish',
    targetAppId: 'domain.interruptible',
    conversationId: 'interrupt-thread',
    payload: {
      jobId: 'job-interrupt',
      final: 'done',
    },
  });

  const result = await start.result();

  assert.deepEqual(result, {
    jobId: 'job-interrupt',
    notes: ['new context'],
    final: 'done',
  });
  assert.ok(start.events().some((event) => event.type === 'task.inbox.enqueued'));
  assert.ok(start.events().some((event) => event.type === 'task.inbox.drained'));

  runtime.dispose();
});
