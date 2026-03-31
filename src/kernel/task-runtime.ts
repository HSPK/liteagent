import { createId } from '../utils/id.js';
import { TaskIndexes } from './task-indexes.js';
import { matchesSignal, normalizeError, normalizeTask, normalizeWait } from './task-runtime-helpers.js';
import type {
  ProtocolValue,
  SignalLike,
  TaskEventEntry,
  TaskEventRecord,
  TaskInboxEntry,
  TaskRecord,
  TaskRuntimeSnapshot,
  TaskUpdatePatch,
  WaitInput,
} from '../agent/types.js';
import type { NormalizedTaskRecord, NormalizedWait } from './task-runtime-helpers.js';

interface StoredTaskRecord extends NormalizedTaskRecord {
  inboxSize?: number;
}

interface StoredTaskEventRecord extends TaskEventEntry {}

interface TaskListener {
  callback: (event: TaskEventEntry) => void;
  taskId: string | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class TaskRuntime {
  #tasks = new Map<string, StoredTaskRecord>();
  #events = new Map<string, StoredTaskEventRecord[]>();
  #inboxes = new Map<string, TaskInboxEntry[]>();
  #listeners = new Set<TaskListener>();
  #indexes = new TaskIndexes();

  createTask({ appId, signal, title }: { appId: string | null; signal: SignalLike; title?: string | null }): StoredTaskRecord {
    const now = Date.now();
    const task = {
      id: createId('task'),
      appId,
      title: title ?? signal.type,
      status: 'running',
      conversationId: signal.conversationId,
      signalIds: [signal.id],
      createdAt: now,
      updatedAt: now,
      lastSignalId: signal.id,
      result: undefined,
      error: null,
      waitingReason: null,
      wait: null,
      metadata: {},
    } as StoredTaskRecord;

    this.#tasks.set(task.id, task);
    this.#events.set(task.id, []);
    this.#inboxes.set(task.id, []);
    this.#indexes.indexSignal(task.id, signal.id);
    this.recordEvent(task.id, {
      type: 'task.created',
      signalId: signal.id,
      data: {
        appId,
        title: task.title,
        signalType: signal.type,
        signalKind: signal.kind,
      },
      createdAt: now,
    });
    return clone(task);
  }

  getTask(taskId: string): StoredTaskRecord | null {
    const task = this.#tasks.get(taskId);
    return task ? this.#cloneTask(task) : null;
  }

  updateTask(taskId: string, patch: TaskUpdatePatch = {}): StoredTaskRecord {
    const task = this.#require(taskId);
    this.#indexes.deindexWaitingTask(task);

    if (patch.title !== undefined && patch.title !== null) {
      task.title = patch.title;
    }

    if (patch.metadata !== undefined) {
      task.metadata = clone(patch.metadata ?? {});
    }

    if (patch.wait !== undefined) {
      task.wait = patch.wait ? normalizeWait(patch.wait) : null;
      task.waitingReason = task.wait?.reason ?? null;
    }

    if (patch.result !== undefined) {
      task.result = clone(patch.result);
    }

    if (patch.error !== undefined) {
      task.error = clone(patch.error);
    }

    if (patch.status !== undefined) {
      task.status = patch.status;
    }

    task.updatedAt = Date.now();
    this.#indexes.indexWaitingTask(task);
    this.recordEvent(task.id, {
      type: 'task.updated',
      data: {
        patch: clone(patch),
      },
    });
    return this.#cloneTask(task);
  }

  resumeTask(taskId: string, signal: SignalLike): StoredTaskRecord {
    const task = this.#require(taskId);
    this.#indexes.deindexWaitingTask(task);

    task.status = 'running';
    task.updatedAt = Date.now();
    task.lastSignalId = signal.id;
    task.waitingReason = null;
    task.wait = null;

    if (!task.conversationId && signal.conversationId) {
      task.conversationId = signal.conversationId;
    }

    if (signal.id && !task.signalIds.includes(signal.id)) {
      task.signalIds.push(signal.id);
    }

    this.#indexes.indexSignal(task.id, signal.id);

    this.recordEvent(task.id, {
      type: 'task.resumed',
      signalId: signal.id,
      data: {
        signalType: signal.type,
        signalKind: signal.kind,
      },
    });

    return this.#cloneTask(task);
  }

  completeTask(taskId: string, result?: ProtocolValue): StoredTaskRecord {
    const task = this.#require(taskId);
    this.#indexes.deindexWaitingTask(task);
    task.status = 'completed';
    task.updatedAt = Date.now();
    task.waitingReason = null;
    task.wait = null;

    if (result !== undefined) {
      task.result = clone(result);
    }

    this.recordEvent(task.id, {
      type: 'task.completed',
      data: {
        hasResult: result !== undefined,
      },
    });

    return this.#cloneTask(task);
  }

  waitTask(taskId: string, reasonOrOptions: string | WaitInput = 'waiting', options: WaitInput = {}): StoredTaskRecord {
    const task = this.#require(taskId);
    const wait = normalizeWait(reasonOrOptions, options);
    this.#indexes.deindexWaitingTask(task);

    task.status = 'waiting';
    task.updatedAt = Date.now();
    task.waitingReason = wait.reason;
    task.wait = wait;
    this.#indexes.indexWaitingTask(task);

    this.recordEvent(task.id, {
      type: 'task.waiting',
      data: {
        wait,
      },
    });

    return this.#cloneTask(task);
  }

  waitForTasks(taskId: string, dependencyTaskIds: string | string[], options: WaitInput = {}): StoredTaskRecord {
    const dependencies = Array.isArray(dependencyTaskIds)
      ? dependencyTaskIds
      : [dependencyTaskIds];
    const normalizedDependencies = Array.from(
      new Set(dependencies.filter((taskEntryId) => typeof taskEntryId === 'string' && taskEntryId.length > 0)),
    );

    return this.waitTask(taskId, {
      ...options,
      reason: options.reason ?? `waiting for ${normalizedDependencies.length} task(s)`,
      dependencyTaskIds: normalizedDependencies,
      pendingDependencyTaskIds: normalizedDependencies,
    });
  }

  failTask(taskId: string, error: unknown): StoredTaskRecord {
    const task = this.#require(taskId);
    this.#indexes.deindexWaitingTask(task);
    task.status = 'failed';
    task.updatedAt = Date.now();
    task.error = normalizeError(error);
    task.waitingReason = null;
    task.wait = null;

    this.recordEvent(task.id, {
      type: 'task.failed',
      data: {
        error: task.error,
      },
    });

    return this.#cloneTask(task);
  }

  cancelTask(taskId: string, reason = 'cancelled'): StoredTaskRecord {
    const task = this.#require(taskId);
    this.#indexes.deindexWaitingTask(task);
    task.status = 'cancelled';
    task.updatedAt = Date.now();
    task.waitingReason = reason;
    task.wait = null;

    this.recordEvent(task.id, {
      type: 'task.cancelled',
      data: {
        reason,
      },
    });

    return this.#cloneTask(task);
  }

  enqueueSignal(taskId: string, signal: SignalLike, { source = 'signal-router' }: { source?: string } = {}): TaskInboxEntry {
    const task = this.#require(taskId);
    const entry = {
      id: createId('inbox'),
      taskId,
      signal: clone(signal),
      source,
      queuedAt: Date.now(),
    } as TaskInboxEntry;

    if (!this.#inboxes.has(taskId)) {
      this.#inboxes.set(taskId, []);
    }

    const inbox = this.#inboxes.get(taskId);
    if (inbox) {
      inbox.push(entry);
    }

    if (signal.id && !task.signalIds.includes(signal.id)) {
      task.signalIds.push(signal.id);
      this.#indexes.indexSignal(task.id, signal.id);
    }

    task.updatedAt = Date.now();
    this.recordEvent(taskId, {
      type: 'task.inbox.enqueued',
      signalId: signal.id,
      data: {
        source,
        signalType: signal.type,
        signalKind: signal.kind,
      },
    });

    return clone(entry);
  }

  listInbox(taskId: string): TaskInboxEntry[] {
    this.#require(taskId);
    return (this.#inboxes.get(taskId) ?? []).map((entry) => clone(entry));
  }

  peekInbox(taskId: string): TaskInboxEntry | null {
    this.#require(taskId);
    const entry = (this.#inboxes.get(taskId) ?? [])[0];
    return entry ? clone(entry) : null;
  }

  inboxSize(taskId: string): number {
    this.#require(taskId);
    return (this.#inboxes.get(taskId) ?? []).length;
  }

  drainInbox(taskId: string): TaskInboxEntry[] {
    this.#require(taskId);
    const inbox = this.#inboxes.get(taskId) ?? [];
    const drained = inbox.map((entry) => clone(entry));
    this.#inboxes.set(taskId, []);
    return drained;
  }

  clearInbox(taskId: string): number {
    this.#require(taskId);
    const count = (this.#inboxes.get(taskId) ?? []).length;
    this.#inboxes.set(taskId, []);
    return count;
  }

  resolveDependency(taskId: string, { resolution = 'completed' }: { resolution?: string } = {}): StoredTaskRecord[] {
    const readyTasks: StoredTaskRecord[] = [];

    for (const waitingTaskId of this.#indexes.candidateTaskIdsForDependency(taskId)) {
      const task = this.#tasks.get(waitingTaskId);
      if (!task || task.status !== 'waiting' || !task.wait?.pendingDependencyTaskIds?.includes(taskId)) {
        continue;
      }

      this.#indexes.deindexWaitingTask(task);
      task.wait.pendingDependencyTaskIds = task.wait.pendingDependencyTaskIds
        .filter((dependencyTaskId) => dependencyTaskId !== taskId);
      task.updatedAt = Date.now();

      this.recordEvent(task.id, {
        type: 'task.dependency.progress',
        data: {
          dependencyTaskId: taskId,
          resolution,
          remainingDependencyTaskIds: clone(task.wait.pendingDependencyTaskIds),
        },
      });

      this.#indexes.indexWaitingTask(task);

      if (task.wait.pendingDependencyTaskIds.length === 0) {
        this.recordEvent(task.id, {
          type: 'task.dependency.ready',
          data: {
            dependencyTaskId: taskId,
            resolution,
            dependencyTaskIds: clone(task.wait.dependencyTaskIds ?? []),
          },
        });
        readyTasks.push(this.#cloneTask(task));
      }
    }

    return readyTasks;
  }

  recordEvent(taskId: string, event: TaskEventRecord): StoredTaskEventRecord {
    this.#require(taskId);

    if (!this.#events.has(taskId)) {
      this.#events.set(taskId, []);
    }

    const normalized = {
      id: createId('evt'),
      taskId,
      type: event.type,
      signalId: event.signalId ?? null,
      createdAt: event.createdAt ?? Date.now(),
      data: clone(event.data ?? {}),
    } as StoredTaskEventRecord;

    const events = this.#events.get(taskId);
    if (events) {
      events.push(normalized);
    }

    for (const listener of this.#listeners) {
      if (listener.taskId !== null && listener.taskId !== taskId) {
        continue;
      }

      listener.callback(clone(normalized));
    }

    return clone(normalized);
  }

  listEvents(taskId: string): StoredTaskEventRecord[] {
    return (this.#events.get(taskId) ?? []).map((event) => clone(event));
  }

  subscribe(callback: (event: StoredTaskEventRecord) => void, { taskId = null }: { taskId?: string | null } = {}): () => void {
    const listener = { callback, taskId };
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  listTasks({
    appId = null,
    status = null,
    conversationId = null,
  }: { appId?: string | null; status?: string | string[] | null; conversationId?: string | null } = {}): StoredTaskRecord[] {
    const statuses = Array.isArray(status) ? new Set(status) : status === null ? null : new Set([status]);

    return Array.from(this.#tasks.values())
      .filter((task) => {
        if (appId !== null && task.appId !== appId) {
          return false;
        }

        if (conversationId !== null && task.conversationId !== conversationId) {
          return false;
        }

        if (statuses !== null && !statuses.has(task.status)) {
          return false;
        }

        return true;
      })
      .map((task) => this.#cloneTask(task))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  countActiveTasks(): number {
    let count = 0;

    for (const task of this.#tasks.values()) {
      if (task.status === 'running' || task.status === 'waiting') {
        count += 1;
      }
    }

    return count;
  }

  findTaskBySignalId(signalId: string): StoredTaskRecord | null {
    const taskId = this.#indexes.findTaskBySignalId(signalId);
    return taskId ? this.getTask(taskId) : null;
  }

  findResumableTask(signal: SignalLike, { appId = null }: { appId?: string | null } = {}): StoredTaskRecord | null {
    const candidates = this.#indexes.candidateTaskIdsForSignal(signal)
      .map((taskId) => this.#tasks.get(taskId))
      .filter((task): task is StoredTaskRecord => Boolean(task))
      .sort((left, right) => left.createdAt - right.createdAt);

    return candidates.find((task) => {
        if (appId !== null && task.appId !== appId) {
          return false;
        }

        if (task.status !== 'waiting' || !task.wait?.resumeOnSignals?.length) {
          return false;
        }

        if (task.conversationId && task.conversationId !== signal.conversationId) {
          return false;
        }

        return task.wait.resumeOnSignals.some((matcher) => matchesSignal(signal, matcher));
      }) ?? null;
  }

  snapshot(): TaskRuntimeSnapshot {
    return {
      tasks: Array.from(this.#tasks.values())
        .map((task) => clone(task))
        .sort((left, right) => left.createdAt - right.createdAt),
      inboxes: Object.fromEntries(
        Array.from(this.#inboxes.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([taskId, inbox]) => [taskId, inbox.map((entry) => clone(entry))]),
      ),
      events: Object.fromEntries(
        Array.from(this.#events.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([taskId, events]) => [taskId, events.map((event) => clone(event))]),
      ),
    };
  }

  restore(snapshot: TaskRuntimeSnapshot | TaskRecord[] = []): void {
    const isLegacyFormat = Array.isArray(snapshot);
    const structuredSnapshot = isLegacyFormat ? null : snapshot;
    const tasks = isLegacyFormat ? snapshot : structuredSnapshot?.tasks ?? [];
    const inboxes = isLegacyFormat ? {} : structuredSnapshot?.inboxes ?? {};
    const events = isLegacyFormat ? {} : structuredSnapshot?.events ?? {};

    this.#tasks.clear();
    this.#events.clear();
    this.#inboxes.clear();
    this.#indexes.clear();

    for (const task of tasks as TaskRecord[]) {
      const normalized = normalizeTask(task) as StoredTaskRecord;
      this.#tasks.set(normalized.id, normalized);
      this.#events.set(
        normalized.id,
        (events[normalized.id] ?? []).map((event) => clone(event)) as StoredTaskEventRecord[],
      );
      this.#inboxes.set(
        normalized.id,
        (inboxes[normalized.id] ?? []).map((entry) => clone(entry)) as TaskInboxEntry[],
      );
      for (const signalId of normalized.signalIds ?? []) {
        this.#indexes.indexSignal(normalized.id, signalId);
      }
      this.#indexes.indexWaitingTask(normalized);
    }
  }

  #require(taskId: string): StoredTaskRecord {
    const task = this.#tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    return task;
  }

  #cloneTask(task: StoredTaskRecord): StoredTaskRecord {
    return {
      ...clone(task),
      inboxSize: (this.#inboxes.get(task.id) ?? []).length,
    };
  }
}
