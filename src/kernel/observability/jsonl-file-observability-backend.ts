import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { filterObservedEvents } from './filter-events.js';
import type { RuntimeEventFilter, RuntimeObservedEvent } from '../../runtime/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseJsonLines(content: string): RuntimeObservedEvent[] {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RuntimeObservedEvent);
}

export class JsonlFileObservabilityBackend {
  #filePath: string;
  #events: RuntimeObservedEvent[] = [];
  #loaded = false;

  constructor(filePath: string) {
    if (!filePath) {
      throw new Error('JsonlFileObservabilityBackend requires a file path.');
    }

    this.#filePath = filePath;
  }

  async record(event: RuntimeObservedEvent): Promise<void> {
    await this.#ensureLoaded();
    this.#events.push(clone(event));
    await mkdir(dirname(this.#filePath), { recursive: true });
    await appendFile(this.#filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async query(filters: RuntimeEventFilter = {}): Promise<RuntimeObservedEvent[]> {
    await this.#ensureLoaded();
    return filterObservedEvents(this.#events, filters);
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) {
      return;
    }

    try {
      const content = await readFile(this.#filePath, 'utf8');
      this.#events = parseJsonLines(content).map((event) => clone(event));
    } catch (error) {
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null;

      if (errorCode === 'ENOENT') {
        this.#events = [];
      } else {
        throw error;
      }
    }

    this.#loaded = true;
  }
}
