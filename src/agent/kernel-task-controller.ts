import { createSignal } from '../core/signal.js';
import {
  handleToolCallSignal,
  waitForTaskDependencies,
  waitForTaskSignal,
} from './kernel-helpers.js';
import type {
  AtScheduleRequest,
  ConversationServiceLike,
  DelayScheduleRequest,
  MemoryServiceLike,
  PolicyDecision,
  PolicyDeniedKernelEvent,
  PolicyLike,
  ProtocolRecord,
  ProtocolValue,
  RecurringScheduleRequest,
  SchedulerLike,
  SelfModelLike,
  SignalLike,
  TaskEventRecorder,
  TaskRecord,
  TaskRuntimeLike,
  ToolAccessLike,
  UnknownRecord,
  WaitInput,
} from './types.js';

interface ScheduledSignalInput {
  task: TaskRecord;
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export class KernelTaskController {
  #agentId: string;
  #policy: PolicyLike;
  #tasks: TaskRuntimeLike;
  #scheduler: SchedulerLike;
  #memory: MemoryServiceLike;
  #conversations: ConversationServiceLike;
  #selfModel: SelfModelLike;
  #tools: ToolAccessLike;
  #receiveSignal: (signal: SignalLike) => Promise<SignalLike> | SignalLike;
  #emitKernelEvent: (event: PolicyDeniedKernelEvent) => void;

  constructor({
    agentId,
    policy,
    tasks,
    scheduler,
    memory,
    conversations,
    selfModel,
    tools,
    receiveSignal,
    emitKernelEvent,
  }: {
    agentId: string;
    policy: PolicyLike;
    tasks: TaskRuntimeLike;
    scheduler: SchedulerLike;
    memory: MemoryServiceLike;
    conversations: ConversationServiceLike;
    selfModel: SelfModelLike;
    tools: ToolAccessLike;
    receiveSignal: (signal: SignalLike) => Promise<SignalLike> | SignalLike;
    emitKernelEvent: (event: PolicyDeniedKernelEvent) => void;
  }) {
    this.#agentId = agentId;
    this.#policy = policy;
    this.#tasks = tasks;
    this.#scheduler = scheduler;
    this.#memory = memory;
    this.#conversations = conversations;
    this.#selfModel = selfModel;
    this.#tools = tools;
    this.#receiveSignal = receiveSignal;
    this.#emitKernelEvent = emitKernelEvent;
  }

  async handleToolCallSignal(signal: SignalLike, task: TaskRecord | null = null): Promise<void> {
    return handleToolCallSignal({
      signal,
      task,
      tasks: this.#tasks,
      tools: this.#tools,
      agentId: this.#agentId,
      receiveSignal: (nextSignal) => this.#receiveSignal(nextSignal),
    });
  }

  recordPolicyDenial(operation: string, decision: PolicyDecision, details: UnknownRecord = {}): void {
    const event: PolicyDeniedKernelEvent = {
      category: 'policy',
      type: 'policy.denied',
      operation,
      decision: structuredClone(decision),
      details: structuredClone(details),
      createdAt: Date.now(),
    };

    this.#memory.setAgent('kernel:lastPolicyDenial', {
      operation,
      decision: structuredClone(decision),
      details: structuredClone(details),
    });
    this.#selfModel.recordChange('policy.denied', {
      operation,
      reason: decision.reason,
      details,
    });
    this.#emitKernelEvent(event);
  }

  clearTaskTimeout(task: TaskRecord | null): void {
    const scheduleId = task?.wait?.timeoutTimerId;
    if (!scheduleId) {
      return;
    }

    if (this.#scheduler.cancel(scheduleId) && task?.id) {
      this.#tasks.recordEvent(task.id, {
        type: 'task.timeout.cancelled',
        data: {
          timerId: scheduleId,
          scheduleId,
        },
      });
    }
  }

  completeTask(taskId: string, result?: ProtocolValue): TaskRecord {
    const task = this.#tasks.getTask(taskId);
    if (task) {
      this.clearTaskTimeout(task);
    }

    const completedTask = this.#tasks.completeTask(taskId, result);
    this.#resumeDependencyWaiters(completedTask, 'completed');
    return completedTask;
  }

  failTask(taskId: string, error: unknown): TaskRecord {
    const task = this.#tasks.getTask(taskId);
    if (task) {
      this.clearTaskTimeout(task);
    }

    const failedTask = this.#tasks.failTask(taskId, error);
    this.#resumeDependencyWaiters(failedTask, 'failed');
    return failedTask;
  }

  cancelTask(taskId: string, reason = 'cancelled'): TaskRecord {
    const task = this.#tasks.getTask(taskId);
    if (task) {
      this.clearTaskTimeout(task);
    }

    const cancelledTask = this.#tasks.cancelTask(taskId, reason);
    this.#resumeDependencyWaiters(cancelledTask, 'cancelled');
    return cancelledTask;
  }

  queueSignal(task: TaskRecord, signal: SignalLike, source: string): void {
    this.#tasks.enqueueSignal(task.id, signal, { source });
    this.#conversations.recordTask(this.#tasks.getTask(task.id), { appId: task.appId });
  }

  interruptTask(task: TaskRecord, signal: SignalLike, source: string): void {
    this.queueSignal(task, signal, source);
    void this.#receiveSignal(
      createSignal({
        kind: 'system',
        type: 'task.interrupt',
        to: this.#agentId,
        from: this.#agentId,
        payload: {
          interruptSignalId: signal.id,
          interruptSignalType: signal.type,
          interruptSource: source,
        },
        conversationId: task.conversationId,
        targetAppId: task.appId,
        targetTaskId: task.id,
        metadata: {
          system: true,
          interruptSignalId: signal.id,
          interruptSignalType: signal.type,
        },
      }),
    );
  }

  waitForSignal(task: TaskRecord, appId: string, input: string | WaitInput = 'waiting'): TaskRecord {
    return waitForTaskSignal({
      task,
      appId,
      input,
      tasks: this.#tasks,
      scheduler: this.#scheduler,
      agentId: this.#agentId,
      clearTaskTimeout: (currentTask) => this.clearTaskTimeout(currentTask),
    });
  }

  waitForDependencies(
    task: TaskRecord,
    appId: string,
    dependencyTaskIds: string | string[],
    options: WaitInput = {},
  ): TaskRecord {
    return waitForTaskDependencies({
      task,
      appId,
      dependencyTaskIds,
      options,
      tasks: this.#tasks,
      scheduler: this.#scheduler,
      agentId: this.#agentId,
      clearTaskTimeout: (currentTask) => this.clearTaskTimeout(currentTask),
    });
  }

  scheduleDelayForTask(
    task: TaskRecord,
    appId: string,
    request: DelayScheduleRequest,
    recordTaskEvent: TaskEventRecorder,
  ) {
    const decision = this.#policy.evaluateSchedule({
      recurring: false,
      activeScheduleCount: this.#scheduler.countActiveSchedules({ includeSystem: false }),
    });

    if (!decision.ok) {
      this.recordPolicyDenial('schedule.delay', decision, {
        taskId: task.id,
        appId,
        signalType: request.type,
      });
      throw new Error(`Schedule is not allowed by policy: ${decision.reason}`);
    }

    const signal = this.#createScheduledSignal({
      task,
      type: request.type,
      payload: request.payload,
      targetAppId: request.targetAppId ?? appId,
      targetTaskId: request.targetTaskId ?? task.id,
      metadata: request.metadata ?? {},
    });
    const record = this.#scheduler.scheduleDelay({
      delayMs: request.delayMs,
      signal,
      label: request.type,
    });

    recordTaskEvent('schedule.created', {
      scheduleId: record.id,
      kind: record.kind,
      label: record.label,
      dueAt: record.dueAt,
    });
    return record;
  }

  scheduleAtForTask(
    task: TaskRecord,
    appId: string,
    request: AtScheduleRequest,
    recordTaskEvent: TaskEventRecorder,
  ) {
    const decision = this.#policy.evaluateSchedule({
      recurring: false,
      activeScheduleCount: this.#scheduler.countActiveSchedules({ includeSystem: false }),
    });

    if (!decision.ok) {
      this.recordPolicyDenial('schedule.at', decision, {
        taskId: task.id,
        appId,
        signalType: request.type,
      });
      throw new Error(`Schedule is not allowed by policy: ${decision.reason}`);
    }

    const signal = this.#createScheduledSignal({
      task,
      type: request.type,
      payload: request.payload,
      targetAppId: request.targetAppId ?? appId,
      targetTaskId: request.targetTaskId ?? task.id,
      metadata: request.metadata ?? {},
    });
    const record = this.#scheduler.scheduleAt({
      at: request.at,
      signal,
      label: request.type,
    });

    recordTaskEvent('schedule.created', {
      scheduleId: record.id,
      kind: record.kind,
      label: record.label,
      dueAt: record.dueAt,
    });
    return record;
  }

  scheduleRecurringForTask(
    task: TaskRecord,
    appId: string,
    request: RecurringScheduleRequest,
    recordTaskEvent: TaskEventRecorder,
  ) {
    const decision = this.#policy.evaluateSchedule({
      recurring: true,
      intervalMs: request.intervalMs,
      activeScheduleCount: this.#scheduler.countActiveSchedules({ includeSystem: false }),
    });

    if (!decision.ok) {
      this.recordPolicyDenial('schedule.recurring', decision, {
        taskId: task.id,
        appId,
        signalType: request.type,
      });
      throw new Error(`Schedule is not allowed by policy: ${decision.reason}`);
    }

    const signal = this.#createScheduledSignal({
      task,
      type: request.type,
      payload: request.payload,
      targetAppId: request.targetAppId ?? appId,
      targetTaskId: request.targetTaskId ?? task.id,
      metadata: request.metadata ?? {},
    });
    const record = this.#scheduler.scheduleRecurring({
      intervalMs: request.intervalMs,
      startAt: request.startAt ?? null,
      signal,
      label: request.type,
      maxRuns: request.maxRuns ?? null,
    });

    recordTaskEvent('schedule.created', {
      scheduleId: record.id,
      kind: record.kind,
      label: record.label,
      dueAt: record.dueAt,
      intervalMs: record.intervalMs,
    });
    return record;
  }

  cancelScheduleForTask(_task: TaskRecord, scheduleId: string, recordTaskEvent: TaskEventRecorder): boolean {
    const cancelled = this.#scheduler.cancel(scheduleId);

    if (cancelled) {
      recordTaskEvent('schedule.cancelled', {
        scheduleId,
      });
    }

    return cancelled;
  }

  #resumeDependencyWaiters(task: TaskRecord | null, resolution: string): void {
    if (!task?.id) {
      return;
    }

    for (const waitingTask of this.#tasks.resolveDependency(task.id, { resolution })) {
      void this.#receiveSignal(
        createSignal({
          kind: 'system',
          type: 'task.dependency.ready',
          to: this.#agentId,
          from: this.#agentId,
          payload: {
            dependencyTaskId: task.id,
            dependencyTaskStatus: resolution,
            dependencyTaskIds: waitingTask.wait?.dependencyTaskIds ?? [],
          },
          conversationId: waitingTask.conversationId,
          targetAppId: waitingTask.appId,
          targetTaskId: waitingTask.id,
          metadata: {
            system: true,
            dependencyTaskId: task.id,
            dependencyTaskStatus: resolution,
          },
        }),
      );
    }
  }

  #createScheduledSignal({
    task,
    type,
    payload = null,
    targetAppId,
    targetTaskId,
    metadata = {},
  }: ScheduledSignalInput): SignalLike {
    return createSignal({
      kind: 'timer',
      type,
      to: this.#agentId,
      payload,
      conversationId: task.conversationId,
      targetAppId,
      targetTaskId,
      metadata,
    });
  }
}
