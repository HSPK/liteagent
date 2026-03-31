import type { ProtocolRecord, SignalLike, SignalMatcherInput, TaskRecord, WaitInput } from '../agent/types.js';

interface NormalizedSignalMatcher extends ProtocolRecord {
  kind: string[] | null;
  type: string[] | null;
  from: string[] | null;
  targetAppId: string[] | null;
  targetTaskId: string[] | null;
  metadata: ProtocolRecord | null;
}

export interface NormalizedWait extends WaitInput {
  reason: string;
  resumeOnSignals: NormalizedSignalMatcher[];
  dependencyTaskIds: string[];
  pendingDependencyTaskIds: string[];
  timeoutTimerId?: string | null;
  timeoutAt?: number | null;
  timeoutSignalType?: string | null;
}

export interface NormalizedTaskRecord extends TaskRecord {
  appId: string | null;
  title: string;
  status: string;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
  lastSignalId: string | null;
  wait: NormalizedWait | null;
  waitingReason: string | null;
  metadata: ProtocolRecord;
  signalIds: string[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeError(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function toMatchList(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry) => typeof entry === 'string');
}

function toIdList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.filter((entry) => typeof entry === 'string' && entry.length > 0)));
}

function normalizeSignalMatcher(matcher: string | SignalMatcherInput): NormalizedSignalMatcher {
  if (typeof matcher === 'string') {
    return {
      type: [matcher],
      kind: null,
      from: null,
      targetAppId: null,
      targetTaskId: null,
      metadata: null,
    };
  }

  const normalizedMatcher = matcher;
  return {
    kind: toMatchList(normalizedMatcher.kind ?? normalizedMatcher.kinds),
    type: toMatchList(normalizedMatcher.type ?? normalizedMatcher.types),
    from: toMatchList(normalizedMatcher.from),
    targetAppId: toMatchList(normalizedMatcher.targetAppId),
    targetTaskId: toMatchList(normalizedMatcher.targetTaskId),
    metadata: normalizedMatcher.metadata ? clone(normalizedMatcher.metadata) : null,
  };
}

export function normalizeWait(reasonOrOptions: string | WaitInput = 'waiting', options: WaitInput = {}): NormalizedWait {
  const normalized: WaitInput = typeof reasonOrOptions === 'object' && reasonOrOptions !== null
    ? reasonOrOptions
    : {
      ...options,
      reason: reasonOrOptions ?? options.reason ?? 'waiting',
    };

  const resumeOnSignals = Array.isArray(normalized.resumeOnSignals)
    ? normalized.resumeOnSignals
    : normalized.resumeOnSignals
      ? [normalized.resumeOnSignals]
      : [];

  if (resumeOnSignals.length === 0 && (
    normalized.kind !== undefined
    || normalized.kinds !== undefined
    || normalized.type !== undefined
    || normalized.types !== undefined
    || normalized.from !== undefined
    || normalized.targetAppId !== undefined
    || normalized.targetTaskId !== undefined
    || normalized.metadata !== undefined
  )) {
    resumeOnSignals.push({
      kind: normalized.kind ?? normalized.kinds,
      type: normalized.type ?? normalized.types,
      from: normalized.from,
      targetAppId: normalized.targetAppId,
      targetTaskId: normalized.targetTaskId,
      metadata: normalized.metadata,
    });
  }

  return {
    reason: normalized.reason ?? 'waiting',
    resumeOnSignals: resumeOnSignals.map((matcher) => normalizeSignalMatcher(matcher as string | SignalMatcherInput)),
    dependencyTaskIds: toIdList(normalized.dependencyTaskIds),
    pendingDependencyTaskIds: toIdList(
      normalized.pendingDependencyTaskIds ?? normalized.dependencyTaskIds,
    ),
    timeoutTimerId: normalized.timeoutTimerId ?? null,
    timeoutAt: normalized.timeoutAt ?? null,
    timeoutSignalType: normalized.timeoutSignalType ?? null,
  };
}

function matchesValue(value: string | null | undefined, matchers: string[] | null): boolean {
  if (matchers === null) {
    return true;
  }

  return typeof value === 'string' && matchers.includes(value);
}

function matchesMetadata(
  signalMetadata: ProtocolRecord | null | undefined = {},
  expectedMetadata: ProtocolRecord | null = null,
): boolean {
  if (!expectedMetadata) {
    return true;
  }

  return Object.entries(expectedMetadata).every(
    ([key, value]) => signalMetadata?.[key] === value,
  );
}

export function matchesSignal(signal: SignalLike, matcher: NormalizedSignalMatcher): boolean {
  return (
    matchesValue(signal.kind, matcher.kind)
    && matchesValue(signal.type, matcher.type)
    && matchesValue(signal.from, matcher.from)
    && matchesValue(signal.targetAppId, matcher.targetAppId)
    && matchesValue(signal.targetTaskId, matcher.targetTaskId)
    && matchesMetadata(signal.metadata, matcher.metadata)
  );
}

export function normalizeTask(task: TaskRecord | null | undefined): NormalizedTaskRecord {
  const rest: Partial<TaskRecord> = task ? clone(task) : {};
  const { inboxSize: _inboxSize, ...taskData } = rest as Partial<TaskRecord> & { inboxSize?: number };
  const normalized = clone({
    appId: taskData.appId ?? null,
    title: taskData.title ?? 'task',
    status: taskData.status ?? 'running',
    conversationId: taskData.conversationId ?? null,
    createdAt: taskData.createdAt ?? Date.now(),
    updatedAt: taskData.updatedAt ?? taskData.createdAt ?? Date.now(),
    lastSignalId: taskData.lastSignalId ?? null,
    result: undefined,
    error: null,
    waitingReason: null,
    wait: null,
    metadata: {},
    signalIds: taskData.lastSignalId ? [taskData.lastSignalId] : [],
    ...taskData,
  }) as NormalizedTaskRecord;

  if (!normalized.wait && normalized.waitingReason) {
    normalized.wait = normalizeWait({
      reason: normalized.waitingReason,
    });
  }

  return normalized;
}
