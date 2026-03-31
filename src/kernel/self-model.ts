import { createId } from '../utils/id.js';
import type {
  AppHostLike,
  ConversationServiceLike,
  MemoryServiceLike,
  ModelAccessLike,
  PolicyLike,
  SchedulerLike,
  ScheduleRecord,
  SelfDescription,
  SelfModelHistoryEntry,
  SelfModelLike,
  TaskRuntimeLike,
  ToolAccessLike,
} from '../agent/types.js';
import type { UnknownRecord } from '../agent/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SelfModelService {
  #agentId: string;
  #policy: PolicyLike;
  #appHost: AppHostLike;
  #tasks: TaskRuntimeLike;
  #conversations: ConversationServiceLike;
  #scheduler: SchedulerLike;
  #tools: ToolAccessLike;
  #models: ModelAccessLike;
  #memory: MemoryServiceLike;
  #history: SelfModelHistoryEntry[] = [];

  constructor({
    agentId,
    policy,
    appHost,
    tasks,
    conversations,
    scheduler,
    tools,
    models,
    memory,
  }: {
    agentId: string;
    policy: PolicyLike;
    appHost: AppHostLike;
    tasks: TaskRuntimeLike;
    conversations: ConversationServiceLike;
    scheduler: SchedulerLike;
    tools: ToolAccessLike;
    models: ModelAccessLike;
    memory: MemoryServiceLike;
  }) {
    this.#agentId = agentId;
    this.#policy = policy;
    this.#appHost = appHost;
    this.#tasks = tasks;
    this.#conversations = conversations;
    this.#scheduler = scheduler;
    this.#tools = tools;
    this.#models = models;
    this.#memory = memory;
  }

  recordChange(type: string, details: UnknownRecord = {}): SelfModelHistoryEntry {
    const entry = {
      id: createId('hist'),
      type,
      details: clone(details),
      createdAt: Date.now(),
    };

    this.#history.push(entry);
    return clone(entry);
  }

  listHistory(): SelfModelHistoryEntry[] {
    return this.#history.map((entry) => clone(entry));
  }

  snapshot(): SelfModelHistoryEntry[] {
    return this.listHistory();
  }

  restore(history: SelfModelHistoryEntry[] = []): void {
    this.#history = history.map((entry) => clone(entry));
  }

  describe(): SelfDescription {
    const schedules = typeof this.#scheduler.listSchedules === 'function'
      ? this.#scheduler.listSchedules()
      : typeof this.#scheduler.listTimers === 'function'
        ? this.#scheduler.listTimers()
        : [] as ScheduleRecord[];

    return {
      agentId: this.#agentId,
      policy: this.#policy.describe(),
      apps: this.#appHost.listApps(),
      tasks: this.#tasks.listTasks(),
      conversations: this.#conversations.listConversations(),
      schedules,
      timers: schedules,
      tools: this.#tools.listTools(),
      models: this.#models.listProviders(),
      memory: this.#memory.summary(),
      history: this.listHistory(),
    };
  }
}
