import type { SignalLike, TaskRecord } from '../agent/types.js';

export class TaskIndexes {
  #signalIndex = new Map<string, string>();
  #waitingByConversation = new Map<string, Set<string>>();
  #waitingWithoutConversation = new Set<string>();
  #waitingByDependency = new Map<string, Set<string>>();

  clear(): void {
    this.#signalIndex.clear();
    this.#waitingByConversation.clear();
    this.#waitingWithoutConversation.clear();
    this.#waitingByDependency.clear();
  }

  indexSignal(taskId: string, signalId: string | null | undefined): void {
    if (!signalId) {
      return;
    }

    this.#signalIndex.set(signalId, taskId);
  }

  findTaskBySignalId(signalId: string): string | null {
    return this.#signalIndex.get(signalId) ?? null;
  }

  indexWaitingTask(task: TaskRecord): void {
    if (task.status !== 'waiting') {
      return;
    }

    const resumeOnSignals = task.wait?.resumeOnSignals;
    if (Array.isArray(resumeOnSignals) ? resumeOnSignals.length > 0 : !!resumeOnSignals) {
      if (!task.conversationId) {
        this.#waitingWithoutConversation.add(task.id);
      } else {
        if (!this.#waitingByConversation.has(task.conversationId)) {
          this.#waitingByConversation.set(task.conversationId, new Set());
        }

        const scoped = this.#waitingByConversation.get(task.conversationId);
        if (scoped) {
          scoped.add(task.id);
        }
      }
    }

    for (const dependencyTaskId of task.wait?.pendingDependencyTaskIds ?? []) {
      if (!this.#waitingByDependency.has(dependencyTaskId)) {
        this.#waitingByDependency.set(dependencyTaskId, new Set());
      }

      const dependencyWaiters = this.#waitingByDependency.get(dependencyTaskId);
      if (dependencyWaiters) {
        dependencyWaiters.add(task.id);
      }
    }
  }

  deindexWaitingTask(task: TaskRecord): void {
    this.#waitingWithoutConversation.delete(task.id);

    if (task.conversationId) {
      const scoped = this.#waitingByConversation.get(task.conversationId);
      if (scoped) {
        scoped.delete(task.id);
        if (scoped.size === 0) {
          this.#waitingByConversation.delete(task.conversationId);
        }
      }
    }

    for (const dependencyTaskId of task.wait?.pendingDependencyTaskIds ?? []) {
      const dependencyWaiters = this.#waitingByDependency.get(dependencyTaskId);
      if (!dependencyWaiters) {
        continue;
      }

      dependencyWaiters.delete(task.id);
      if (dependencyWaiters.size === 0) {
        this.#waitingByDependency.delete(dependencyTaskId);
      }
    }
  }

  candidateTaskIdsForSignal(signal: SignalLike): string[] {
    const candidateIds = new Set(this.#waitingWithoutConversation);

    if (signal.conversationId && this.#waitingByConversation.has(signal.conversationId)) {
      for (const taskId of this.#waitingByConversation.get(signal.conversationId) ?? new Set()) {
        candidateIds.add(taskId);
      }
    }

    return Array.from(candidateIds);
  }

  candidateTaskIdsForDependency(taskId: string): string[] {
    return Array.from(this.#waitingByDependency.get(taskId) ?? []);
  }
}
