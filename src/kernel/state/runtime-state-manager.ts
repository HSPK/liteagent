import type { RuntimeSnapshot, RuntimeStateEvent } from '../../runtime/types.js';

interface RuntimeStateBackendLike {
  save(snapshot: RuntimeSnapshot): Promise<void>;
  load(): Promise<RuntimeSnapshot>;
}

interface RuntimeSnapshotRuntimeLike {
  snapshot(options?: { waitForIdle?: boolean }): Promise<RuntimeSnapshot>;
}

export class RuntimeStateManager {
  #runtime: RuntimeSnapshotRuntimeLike;
  #backend: RuntimeStateBackendLike | null;
  #debounceMs: number;
  #emitEvent: (event: RuntimeStateEvent) => void;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<RuntimeSnapshot | null> | null = null;
  #queuedReason: string | null = null;

  constructor({
    runtime,
    backend = null,
    debounceMs = 25,
    emitEvent = () => {},
  }: {
    runtime: RuntimeSnapshotRuntimeLike;
    backend?: RuntimeStateBackendLike | null;
    debounceMs?: number;
    emitEvent?: (event: RuntimeStateEvent) => void;
  }) {
    this.#runtime = runtime;
    this.#backend = backend;
    this.#debounceMs = debounceMs;
    this.#emitEvent = emitEvent;
  }

  hasBackend(): boolean {
    return this.#backend !== null;
  }

  queueSave(reason = 'runtime.event'): void {
    if (!this.hasBackend()) {
      return;
    }

    this.#queuedReason = reason;

    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
    }

    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.flush({ reason: this.#queuedReason ?? reason });
    }, this.#debounceMs);
  }

  async flush({ reason = 'manual', waitForIdle = true }: { reason?: string; waitForIdle?: boolean } = {}): Promise<RuntimeSnapshot | null> {
    if (!this.hasBackend()) {
      return null;
    }

    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }

    if (this.#inFlight) {
      this.#queuedReason = reason;
      await this.#inFlight;
      if (this.#queuedReason !== null) {
        const nextReason = this.#queuedReason;
        this.#queuedReason = null;
        return this.flush({ reason: nextReason, waitForIdle });
      }
      return null;
    }

    const currentReason = this.#queuedReason ?? reason;
    this.#queuedReason = null;
    this.#inFlight = this.#save(currentReason, waitForIdle);

    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = null;
      if (this.#queuedReason !== null) {
        const nextReason = this.#queuedReason;
        this.#queuedReason = null;
        return this.flush({ reason: nextReason, waitForIdle });
      }
    }
  }

  async load(): Promise<RuntimeSnapshot> {
    if (!this.hasBackend()) {
      throw new Error('Runtime state backend is not configured.');
    }

    const backend = this.#backend;
    if (!backend) {
      throw new Error('Runtime state backend is not configured.');
    }

    const snapshot = await backend.load();
    this.#emitEvent({
      type: 'state.loaded',
      createdAt: Date.now(),
      reason: 'load',
      agentCount: Array.isArray(snapshot?.agents) ? snapshot.agents.length : 0,
    });
    return snapshot;
  }

  dispose(): void {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  async #save(reason: string, waitForIdle: boolean): Promise<RuntimeSnapshot> {
    const snapshot = await this.#runtime.snapshot({ waitForIdle });
    await this.#backend?.save(snapshot);
    this.#emitEvent({
      type: 'state.saved',
      createdAt: Date.now(),
      reason,
      agentCount: snapshot.agents?.length ?? 0,
    });
    return snapshot;
  }
}
