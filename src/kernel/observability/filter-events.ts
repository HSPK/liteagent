import type { RuntimeEventFilter, RuntimeObservedEvent } from '../../runtime/types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeLimit(limit: number | null | undefined): number | null {
  if (limit === null || limit === undefined) {
    return null;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Observability query limit must be a positive integer or null.');
  }

  return limit;
}

export function filterObservedEvents(
  events: RuntimeObservedEvent[],
  { agentId = null, type = null, taskId = null, eventType = null, since = null, limit = null }: RuntimeEventFilter = {},
): RuntimeObservedEvent[] {
  const normalizedLimit = normalizeLimit(limit);
  const filtered: RuntimeObservedEvent[] = [];

  for (const event of events) {
    if (agentId !== null && event.agentId !== agentId) {
      continue;
    }

    if (type !== null && event.type !== type) {
      continue;
    }

    if (taskId !== null) {
      const candidateTaskId = event.type === 'task.event'
        ? event.taskId
        : null;
      if (candidateTaskId !== taskId) {
        continue;
      }
    }

    if (eventType !== null) {
      const candidateEventType = 'event' in event ? event.event.type : null;
      if (candidateEventType !== eventType) {
        continue;
      }
    }

    if (since !== null && (event.createdAt ?? 0) < since) {
      continue;
    }

    filtered.push(clone(event));
  }

  if (normalizedLimit === null || filtered.length <= normalizedLimit) {
    return filtered;
  }

  return filtered.slice(filtered.length - normalizedLimit);
}
