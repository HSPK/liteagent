import { filterObservedEvents } from './filter-events.js';
import type { RuntimeEventFilter, RuntimeObservedEvent } from '../../runtime/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryObservabilityBackend {
  #events: RuntimeObservedEvent[] = [];
  #maxEvents: number | null;

  constructor({ maxEvents = 1000 }: { maxEvents?: number | null } = {}) {
    if (maxEvents !== null && (!Number.isInteger(maxEvents) || maxEvents <= 0)) {
      throw new Error('maxEvents must be a positive integer or null.');
    }

    this.#maxEvents = maxEvents;
  }

  async record(event: RuntimeObservedEvent): Promise<void> {
    this.#events.push(clone(event));

    if (this.#maxEvents !== null && this.#events.length > this.#maxEvents) {
      this.#events.splice(0, this.#events.length - this.#maxEvents);
    }
  }

  async query(filters: RuntimeEventFilter = {}): Promise<RuntimeObservedEvent[]> {
    return filterObservedEvents(this.#events, filters);
  }

  snapshot(): RuntimeObservedEvent[] {
    return this.#events.map((event) => clone(event));
  }
}
