import { createSignal } from '../../core/signal.js';
import { createId } from '../../utils/id.js';
import type { ProtocolRecord, ScheduleRecord, SchedulerEvent, SignalLike } from '../../agent/types.js';

interface SchedulerListener {
  callback: (event: SchedulerEvent) => void;
  type: string | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSignalTemplate(signalTemplate: SignalLike, agentId: string): SignalLike {
  const normalized = clone(signalTemplate);
  return createSignal({
    ...normalized,
    id: undefined,
    createdAt: undefined,
    to: signalTemplate.to ?? agentId,
    metadata: normalized.metadata ?? undefined,
  });
}

function normalizeMaxRuns(maxRuns: number | null | undefined): number | null {
  if (maxRuns === null || maxRuns === undefined) {
    return null;
  }

  if (!Number.isInteger(maxRuns) || maxRuns <= 0) {
    throw new Error('maxRuns must be a positive integer or null.');
  }

  return maxRuns;
}

function normalizeRecord(record: Partial<ScheduleRecord> & {
  id: string;
  kind: string;
  label: string;
  signalTemplate: SignalLike;
}): ScheduleRecord {
  const normalized = {
    ...record,
    createdAt: record.createdAt ?? Date.now(),
    dueAt: record.dueAt ?? record.nextRunAt ?? Date.now(),
    intervalMs: record.intervalMs ?? null,
    fireCount: record.fireCount ?? 0,
    active: record.active !== false,
    metadata: clone(record.metadata ?? {}),
    maxRuns: normalizeMaxRuns(record.maxRuns),
  } as ScheduleRecord;
  return clone(normalized);
}

export class SchedulerService {
  #agentId: string;
  #deliverSignal: (signal: SignalLike) => Promise<SignalLike> | SignalLike;
  #records = new Map<string, ScheduleRecord>();
  #handles = new Map<string, ReturnType<typeof setTimeout>>();
  #listeners = new Set<SchedulerListener>();

  constructor({ agentId, deliverSignal }: {
    agentId: string;
    deliverSignal: (signal: SignalLike) => Promise<SignalLike> | SignalLike;
  }) {
    this.#agentId = agentId;
    this.#deliverSignal = deliverSignal;
  }

  scheduleDelay({
    signal,
    delayMs,
    label = signal.type,
    metadata = {},
    maxRuns = 1,
  }: {
    signal: SignalLike;
    delayMs: number;
    label?: string;
    metadata?: ProtocolRecord;
    maxRuns?: number | null;
  }): ScheduleRecord {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error('delayMs must be a non-negative number.');
    }

    return this.#createSchedule({
      kind: 'delay',
      label,
      signal,
      dueAt: Date.now() + delayMs,
      intervalMs: null,
      metadata,
      maxRuns,
    });
  }

  scheduleAt({
    signal,
    at,
    label = signal.type,
    metadata = {},
    maxRuns = 1,
  }: {
    signal: SignalLike;
    at: number;
    label?: string;
    metadata?: ProtocolRecord;
    maxRuns?: number | null;
  }): ScheduleRecord {
    if (!Number.isFinite(at) || at < 0) {
      throw new Error('at must be a non-negative timestamp.');
    }

    return this.#createSchedule({
      kind: 'at',
      label,
      signal,
      dueAt: at,
      intervalMs: null,
      metadata,
      maxRuns,
    });
  }

  scheduleRecurring({
    signal,
    intervalMs,
    label = signal.type,
    startAt = null,
    metadata = {},
    maxRuns = null,
  }: {
    signal: SignalLike;
    intervalMs: number;
    label?: string;
    startAt?: number | null;
    metadata?: ProtocolRecord;
    maxRuns?: number | null;
  }): ScheduleRecord {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('intervalMs must be a positive number.');
    }

    if (startAt !== null && (!Number.isFinite(startAt) || startAt < 0)) {
      throw new Error('startAt must be a non-negative timestamp or null.');
    }

    return this.#createSchedule({
      kind: 'recurring',
      label,
      signal,
      dueAt: startAt ?? (Date.now() + intervalMs),
      intervalMs,
      metadata,
      maxRuns,
    });
  }

  cancel(scheduleId: string): boolean {
    const record = this.#records.get(scheduleId);
    if (!record) {
      return false;
    }

    this.#clearHandle(scheduleId);

    if (!record.active) {
      return false;
    }

    record.active = false;
    record.cancelledAt = Date.now();
    this.#emitEvent('schedule.cancelled', record, {
      reason: 'cancelled',
    });
    return true;
  }

  getSchedule(scheduleId: string): ScheduleRecord | null {
    const record = this.#records.get(scheduleId);
    return record ? clone(record) : null;
  }

  listSchedules(): ScheduleRecord[] {
    return Array.from(this.#records.values())
      .map((record) => clone(record))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  listTimers(): ScheduleRecord[] {
    return this.listSchedules();
  }

  countActiveSchedules({ includeSystem = true }: { includeSystem?: boolean } = {}): number {
    let count = 0;
    for (const record of this.#records.values()) {
      if (!record.active) {
        continue;
      }

      if (!includeSystem && record.metadata?.system === true) {
        continue;
      }

      if (record.active) {
        count += 1;
      }
    }
    return count;
  }

  subscribe(callback: (event: SchedulerEvent) => void, { type = null }: { type?: string | null } = {}): () => void {
    const listener = { callback, type };
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  snapshot(): ScheduleRecord[] {
    return this.listSchedules();
  }

  restore(records: ScheduleRecord[] = []): void {
    this.dispose();
    this.#records = new Map();

    for (const entry of records) {
      const record = normalizeRecord(entry);
      this.#records.set(record.id, record);
      this.#emitEvent('schedule.restored', record, {
        restored: true,
      });

      if (record.active) {
        this.#activate(record.id);
      }
    }
  }

  dispose(): void {
    for (const scheduleId of this.#handles.keys()) {
      this.#clearHandle(scheduleId);
    }
  }

  #createSchedule({
    kind,
    label,
    signal,
    dueAt,
    intervalMs,
    metadata,
    maxRuns,
  }: {
    kind: string;
    label: string;
    signal: SignalLike;
    dueAt: number;
    intervalMs: number | null;
    metadata: ProtocolRecord;
    maxRuns: number | null;
  }): ScheduleRecord {
    const now = Date.now();
    const record = normalizeRecord({
      id: createId('sch'),
      kind,
      label,
      createdAt: now,
      dueAt,
      intervalMs,
      fireCount: 0,
      active: true,
      signalTemplate: normalizeSignalTemplate(signal, this.#agentId),
      metadata: clone(metadata ?? {}),
      maxRuns,
    });

    this.#records.set(record.id, record);
    this.#activate(record.id);
    this.#emitEvent('schedule.created', record, {
      dueAt: record.dueAt,
    });
    return clone(record);
  }

  #activate(scheduleId: string): void {
    this.#clearHandle(scheduleId);
    const record = this.#records.get(scheduleId);
    if (!record || !record.active) {
      return;
    }

    const delayMs = Math.max(0, record.dueAt - Date.now());
    const handle = setTimeout(() => {
      void this.#fire(scheduleId);
    }, delayMs);
    this.#handles.set(scheduleId, handle);
  }

  async #fire(scheduleId: string): Promise<void> {
    const record = this.#records.get(scheduleId);
    if (!record || !record.active) {
      return;
    }

    this.#clearHandle(scheduleId);
    record.fireCount += 1;
    record.lastFiredAt = Date.now();
    this.#emitEvent('schedule.triggered', record, {
      fireCount: record.fireCount,
    });

    await this.#deliver(record.signalTemplate, scheduleId);

    if (record.kind === 'recurring' && record.active && (record.maxRuns === null || record.fireCount < record.maxRuns)) {
      record.dueAt = record.lastFiredAt + (record.intervalMs ?? 0);
      this.#activate(scheduleId);
      return;
    }

    record.active = false;
    record.completedAt = Date.now();
    record.dueAt = record.lastFiredAt;
    this.#emitEvent('schedule.completed', record, {
      fireCount: record.fireCount,
    });
  }

  async #deliver(signalTemplate: SignalLike, scheduleId: string): Promise<void> {
    const signal = createSignal({
      ...clone(signalTemplate),
      id: undefined,
      createdAt: undefined,
      kind: 'timer',
      to: signalTemplate.to ?? this.#agentId,
      metadata: {
        ...(signalTemplate.metadata ?? {}),
        scheduleId,
        timerId: scheduleId,
      },
    });

    await this.#deliverSignal(signal);
  }

  #clearHandle(scheduleId: string): void {
    const handle = this.#handles.get(scheduleId);
    if (!handle) {
      return;
    }

    clearTimeout(handle);
    this.#handles.delete(scheduleId);
  }

  #emitEvent(type: string, record: ScheduleRecord, data: ProtocolRecord = {}): void {
    const event: SchedulerEvent = {
      type,
      scheduleId: record.id,
      schedule: clone(record),
      data: clone(data),
      createdAt: Date.now(),
    };

    for (const listener of this.#listeners) {
      if (listener.type !== null && listener.type !== type) {
        continue;
      }

      listener.callback(clone(event));
    }
  }
}
