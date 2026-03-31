import { createSignal, createToolSignal } from '../core/signal.js';
import { createId } from '../utils/id.js';
import type {
  MemoryScopeApi,
  MemoryScopeInput,
  MemoryServiceLike,
  ModelAccessLike,
  ModelRequest,
  ModelProviderContext,
  ModelStreamEvent,
  SchedulerLike,
  SignalLike,
  TaskRecord,
  TaskRuntimeLike,
  ToolCallSignalResultPayload,
  ToolAccessLike,
  UnknownRecord,
  WaitInput,
} from './types.js';

interface WaitForTaskSignalInput {
  task: TaskRecord;
  appId: string;
  input?: string | WaitInput;
  tasks: TaskRuntimeLike;
  scheduler: SchedulerLike;
  agentId: string;
  clearTaskTimeout: (task: TaskRecord) => void;
}

interface WaitForTaskDependenciesInput {
  task: TaskRecord;
  appId: string;
  dependencyTaskIds: string | string[];
  options?: WaitInput;
  tasks: TaskRuntimeLike;
  scheduler: SchedulerLike;
  agentId: string;
  clearTaskTimeout: (task: TaskRecord) => void;
}

interface ApplyWaitTimeoutInput {
  task: TaskRecord;
  appId: string;
  waitInput: WaitInput;
  tasks: TaskRuntimeLike;
  scheduler: SchedulerLike;
  agentId: string;
}

interface HandleToolCallSignalInput {
  signal: SignalLike;
  task?: TaskRecord | null;
  tasks: TaskRuntimeLike;
  tools: ToolAccessLike;
  agentId: string;
  receiveSignal: (signal: SignalLike) => Promise<SignalLike> | SignalLike;
}

export function describeError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

export function createMemoryScope(memory: MemoryServiceLike, scope: MemoryScopeInput): MemoryScopeApi {
  return {
    get: (key, fallback) => memory.get(scope, key, fallback),
    set: (key, value) => memory.set(scope, key, value),
    delete: (key) => memory.delete(scope, key),
    entries: () => memory.entries(scope),
    merge: (values) => memory.merge(scope, values),
    clear: () => memory.clear(scope),
  };
}

export function waitForTaskSignal({
  task,
  appId,
  input = 'waiting',
  tasks,
  scheduler,
  agentId,
  clearTaskTimeout,
}: WaitForTaskSignalInput): TaskRecord {
  const currentTask = tasks.getTask(task.id) ?? task;
  clearTaskTimeout(currentTask);

  const waitInput: WaitInput = typeof input === 'object' && input !== null
    ? { ...input }
    : { reason: input };

  applyWaitTimeout({
    task,
    appId,
    waitInput,
    tasks,
    scheduler,
    agentId,
  });

  return tasks.waitTask(task.id, waitInput);
}

export function waitForTaskDependencies({
  task,
  appId,
  dependencyTaskIds,
  options = {},
  tasks,
  scheduler,
  agentId,
  clearTaskTimeout,
}: WaitForTaskDependenciesInput): TaskRecord {
  const currentTask = tasks.getTask(task.id) ?? task;
  clearTaskTimeout(currentTask);

  const waitInput: WaitInput = {
    ...options,
    reason: options.reason ?? `waiting for ${Array.isArray(dependencyTaskIds) ? dependencyTaskIds.length : 1} task(s)`,
  };

  applyWaitTimeout({
    task,
    appId,
    waitInput,
    tasks,
    scheduler,
    agentId,
  });

  return tasks.waitForTasks(task.id, dependencyTaskIds, waitInput);
}

function applyWaitTimeout({
  task,
  appId,
  waitInput,
  tasks,
  scheduler,
  agentId,
}: ApplyWaitTimeoutInput): void {
  if (waitInput.timeoutMs === undefined || waitInput.timeoutMs === null) {
    return;
  }

  const timeoutType = waitInput.timeoutType ?? 'task.timeout';
  const timeoutRecord = scheduler.scheduleDelay({
    delayMs: waitInput.timeoutMs,
    label: `timeout:${task.id}`,
    metadata: {
      system: true,
    },
    signal: createSignal({
      kind: 'timer',
      type: timeoutType,
      to: agentId,
      from: agentId,
      payload: waitInput.timeoutPayload ?? {
        reason: waitInput.reason ?? 'waiting',
        taskId: task.id,
      },
      conversationId: task.conversationId,
      targetAppId: waitInput.targetAppId ?? appId,
      targetTaskId: task.id,
      metadata: {
        ...(waitInput.timeoutMetadata ?? {}),
        taskTimeout: true,
      },
    }),
  });

  waitInput.timeoutTimerId = timeoutRecord.id;
  waitInput.timeoutAt = timeoutRecord.dueAt;
  waitInput.timeoutSignalType = timeoutType;

  tasks.recordEvent(task.id, {
    type: 'task.timeout.scheduled',
    signalId: null,
    data: {
      timerId: timeoutRecord.id,
      scheduleId: timeoutRecord.id,
      dueAt: timeoutRecord.dueAt,
      signalType: timeoutType,
    },
  });
}

export async function* observeModelStream(
  models: ModelAccessLike,
  request: ModelRequest,
  modelContext: ModelProviderContext,
  observeEvent: (event: ModelStreamEvent) => void,
): AsyncGenerator<ModelStreamEvent, void, unknown> {
  for await (const event of models.stream(request, modelContext)) {
    observeEvent(event);
    yield event;
  }
}

export async function handleToolCallSignal({
  signal,
  task = null,
  tasks,
  tools,
  agentId,
  receiveSignal,
}: HandleToolCallSignalInput): Promise<void> {
  const signalPayload = signal.payload ?? {};
  const signalMetadata = signal.metadata ?? {};
  const callId = typeof signalPayload.callId === 'string'
    ? signalPayload.callId
    : typeof signalMetadata.toolCallId === 'string'
      ? signalMetadata.toolCallId
      : createId('tool');
  const toolName = typeof signalPayload.toolName === 'string'
    ? signalPayload.toolName
    : typeof signalMetadata.toolName === 'string'
      ? signalMetadata.toolName
      : null;
  const input = Object.hasOwn(signalPayload, 'input') ? signalPayload.input : null;
  const appId = signal.targetAppId ?? task?.appId ?? null;

  if (task) {
    tasks.recordEvent(task.id, {
      type: 'tool.call.signal',
      signalId: signal.id,
      data: {
        callId,
        toolName,
        input,
      },
    });
  }

  let resultPayload: ToolCallSignalResultPayload;
  try {
    if (!toolName) {
      throw new Error('Tool call signal requires payload.toolName.');
    }

    const output = await tools.callTool(toolName, input, {
      agentId,
      appId,
      taskId: task?.id ?? signal.targetTaskId ?? null,
      signal,
    });

    resultPayload = {
      callId,
      toolName,
      input,
      ok: true,
      output,
      error: null,
    };
  } catch (error) {
    resultPayload = {
      callId,
      toolName,
      input,
      ok: false,
      output: null,
      error: describeError(error),
    };
  }

  if (task) {
    tasks.recordEvent(task.id, {
      type: 'tool.result.signal',
      signalId: signal.id,
      data: resultPayload,
    });
  }

  await receiveSignal(
    createToolSignal({
      type: 'tool.result',
      to: agentId,
      from: agentId,
      payload: resultPayload,
      conversationId: signal.conversationId ?? task?.conversationId,
      targetAppId: signal.targetAppId ?? task?.appId ?? null,
      targetTaskId: signal.targetTaskId ?? task?.id ?? null,
      metadata: {
        ...signalMetadata,
        toolCallId: callId,
        toolName,
      },
    }),
  );
}
