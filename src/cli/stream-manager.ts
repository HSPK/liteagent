import type { CliEntryPatch, EntryListener } from './types.js';

/**
 * Accumulates streaming text deltas per key and debounces flushes.
 * Extracted from RuntimeController to separate the streaming concern.
 */
export class StreamManager {
  readonly #streams = new Map<string, string>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #emit: EntryListener;

  constructor(onFlush: EntryListener) {
    this.#emit = onFlush;
  }

  append(key: string, agentId: string, delta: string): void {
    const current = this.#streams.get(key) ?? '';
    this.#streams.set(key, current + delta);
    this.#schedule(key, agentId);
  }

  flush(key: string, agentId: string): void {
    const timer = this.#timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(key);
    }

    const text = this.#streams.get(key);
    if (text === undefined) {
      return;
    }

    this.#emit([{ kind: 'agent', author: agentId, text, replaceKey: key }]);
  }

  has(key: string): boolean {
    return this.#streams.has(key);
  }

  remove(key: string): void {
    this.#streams.delete(key);
  }

  dispose(): void {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    this.#streams.clear();
  }

  #schedule(key: string, agentId: string): void {
    if (this.#timers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this.#timers.delete(key);
      this.flush(key, agentId);
    }, 16);
    this.#timers.set(key, timer);
  }
}
