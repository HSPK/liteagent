import type { ConversationRecord, SignalLike, TaskRecord } from '../agent/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

export class ConversationService {
  #conversations = new Map<string, ConversationRecord>();

  recordSignal(signal: SignalLike): ConversationRecord | null {
    if (!signal.conversationId) {
      return null;
    }

    const conversation = this.#ensureConversation(signal.conversationId, signal.createdAt);
    conversation.updatedAt = signal.createdAt ?? Date.now();
    conversation.signalCount += 1;
    conversation.lastSignal = {
      id: signal.id,
      kind: signal.kind,
      type: signal.type,
      from: signal.from,
      to: signal.to,
      createdAt: signal.createdAt ?? Date.now(),
    };

    pushUnique(conversation.participants, signal.from);
    pushUnique(conversation.participants, signal.to);

    return clone(conversation);
  }

  recordTask(task: TaskRecord | null, options: { appId?: string | null } = {}): ConversationRecord | null {
    if (!task?.conversationId) {
      return null;
    }

    const appId = options.appId ?? task.appId;
    const conversation = this.#ensureConversation(task.conversationId, task.createdAt);
    conversation.updatedAt = task.updatedAt ?? Date.now();
    pushUnique(conversation.taskIds, task.id);
    pushUnique(conversation.appIds, appId);
    conversation.lastTask = {
      id: task.id,
      appId,
      title: task.title,
      status: task.status,
      updatedAt: task.updatedAt ?? Date.now(),
      waitingReason: task.waitingReason ?? null,
      result: task.result ?? null,
      error: task.error ?? null,
    };

    return clone(conversation);
  }

  getConversation(conversationId: string | null): ConversationRecord | null {
    if (!conversationId) {
      return null;
    }

    const conversation = this.#conversations.get(conversationId);
    return conversation ? clone(conversation) : null;
  }

  listConversations(): ConversationRecord[] {
    return Array.from(this.#conversations.values())
      .map((conversation) => clone(conversation))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  snapshot(): ConversationRecord[] {
    return this.listConversations();
  }

  restore(conversations: Array<ConversationRecord> = []): void {
    this.#conversations.clear();

    for (const conversation of conversations) {
      this.#conversations.set(conversation.conversationId, clone(conversation));
    }
  }

  /**
   */
  #ensureConversation(conversationId: string, createdAt = Date.now()): ConversationRecord {
    if (!this.#conversations.has(conversationId)) {
      this.#conversations.set(conversationId, {
        conversationId,
        createdAt,
        updatedAt: createdAt,
        signalCount: 0,
        participants: [],
        appIds: [],
        taskIds: [],
        lastSignal: null,
        lastTask: null,
      });
    }

    return this.#conversations.get(conversationId) as ConversationRecord;
  }
}
