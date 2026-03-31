import type {
  ConversationRecord,
  ConversationTaskSummary,
  DispatchHandleLike,
  ProtocolValue,
  SignalLike,
  TaskEventEntry,
  TaskRecord,
} from '../agent/types.js';

interface DispatchRuntimeLike {
  whenIdle(): Promise<void>;
  getAgent(agentId: string): {
    describeConversation(conversationId?: string | null): ConversationRecord | null;
    findTaskBySignalId(signalId: string): TaskRecord | null;
    listTaskEvents(taskId: string): TaskEventEntry[];
  } | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DispatchHandle<TResult = ProtocolValue | null> implements DispatchHandleLike<TResult> {
  runtime: DispatchRuntimeLike;
  signal: SignalLike;
  conversationId: string | null | undefined;
  to: string;

  constructor({ runtime, signal }: { runtime: DispatchRuntimeLike; signal: SignalLike }) {
    this.runtime = runtime;
    this.signal = clone(signal);
    this.conversationId = signal.conversationId;
    this.to = signal.to;
  }

  async whenIdle(): Promise<this> {
    await this.runtime.whenIdle();
    return this;
  }

  conversation(): ConversationRecord | null {
    return this.runtime.getAgent(this.to)?.describeConversation(this.conversationId) ?? null;
  }

  task(): TaskRecord | null {
    return this.runtime.getAgent(this.to)?.findTaskBySignalId(this.signal.id) ?? null;
  }

  lastTask(): TaskRecord | ConversationTaskSummary | null {
    return this.task() ?? this.conversation()?.lastTask ?? null;
  }

  events(): TaskEventEntry[] {
    const task = this.task();
    if (!task || typeof task.id !== 'string') {
      return [];
    }

    return this.runtime.getAgent(this.to)?.listTaskEvents(task.id) ?? [];
  }

  async result(): Promise<TResult> {
    await this.runtime.whenIdle();
    return (this.task()?.result ?? this.lastTask()?.result ?? null) as TResult;
  }
}
