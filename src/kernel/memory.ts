import type {
  MemorySnapshot,
  MemorySummary,
  MemoryScopeApi,
  MemoryScopeInput,
  MemoryScopeRef,
  MemoryServiceLike,
  ProtocolRecord,
  ProtocolValue,
} from '../agent/types.js';

type ScopeMap = Map<string, ProtocolValue>;
type ScopeContainer = Map<string, ScopeMap>;
type NamedScopeContainer = Map<string, ScopeContainer>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mapToObject(map: ScopeMap): ProtocolRecord {
  return Object.fromEntries(
    Array.from(map.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, clone(value)]),
  );
}

function objectToMap(object: ProtocolRecord = {}): ScopeMap {
  return new Map(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, clone(value)]),
  );
}

function nestedMapToObject(map: ScopeContainer): Record<string, ProtocolRecord> {
  return Object.fromEntries(
    Array.from(map.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, scope]) => [key, mapToObject(scope)]),
  );
}

function objectToNestedMap(object: Record<string, ProtocolRecord> = {}): ScopeContainer {
  return new Map(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, scope]) => [key, objectToMap(scope)]),
  );
}

function normalizeScope(scope: MemoryScopeInput, id: string | null = null): MemoryScopeRef {
  if (typeof scope === 'string') {
    return {
      kind: scope,
      id,
    };
  }

  if (scope?.kind) {
    return {
      kind: scope.kind,
      id: scope.id ?? id ?? null,
    };
  }

  throw new Error('Memory scope must be a kind string or { kind, id }.');
}

export class MemoryService {
  #agent: ScopeMap = new Map();
  #apps: ScopeContainer = new Map();
  #tasks: ScopeContainer = new Map();
  #conversations: ScopeContainer = new Map();
  #named: NamedScopeContainer = new Map();

  scope(scope: string | MemoryScopeInput, id: string | null = null): MemoryScopeApi {
    const normalized = normalizeScope(scope, id);

    return {
      get: (key, fallback = null) => this.get(normalized, key, fallback),
      set: (key, value) => this.set(normalized, key, value),
      delete: (key) => this.delete(normalized, key),
      entries: () => this.entries(normalized),
      merge: (values) => this.merge(normalized, values),
      clear: () => this.clear(normalized),
    };
  }

  get(scope: MemoryScopeInput, key: string, fallback: ProtocolValue | null = null): ProtocolValue | null {
    const resolved = this.#resolveScopeMap(scope, false);
    return resolved && resolved.has(key)
      ? clone(resolved.get(key) as ProtocolValue)
      : fallback;
  }

  set(scope: MemoryScopeInput, key: string, value: ProtocolValue): ProtocolValue {
    const resolved = this.#resolveScopeMap(scope, true) as ScopeMap;
    resolved.set(key, clone(value));
    return value;
  }

  delete(scope: MemoryScopeInput, key: string): boolean {
    const resolved = this.#resolveScopeMap(scope, false);
    return resolved ? resolved.delete(key) : false;
  }

  entries(scope: MemoryScopeInput): ProtocolRecord {
    const resolved = this.#resolveScopeMap(scope, false) ?? new Map<string, ProtocolValue>();
    return mapToObject(resolved);
  }

  merge(scope: MemoryScopeInput, values: ProtocolRecord = {}): ProtocolRecord {
    const resolved = this.#resolveScopeMap(scope, true) as ScopeMap;

    for (const [key, value] of Object.entries(values)) {
      resolved.set(key, clone(value));
    }

    return this.entries(scope);
  }

  clear(scope: MemoryScopeInput): boolean {
    const resolved = this.#resolveScopeMap(scope, false);
    if (!resolved) {
      return false;
    }

    resolved.clear();
    return true;
  }

  getAgent(key: string, fallback: ProtocolValue | null = null): ProtocolValue | null {
    return this.get('agent', key, fallback);
  }

  setAgent(key: string, value: ProtocolValue): ProtocolValue {
    return this.set('agent', key, value);
  }

  deleteAgent(key: string): boolean {
    return this.delete('agent', key);
  }

  entriesAgent(): ProtocolRecord {
    return this.entries('agent');
  }

  getApp(appId: string, key: string, fallback: ProtocolValue | null = null): ProtocolValue | null {
    return this.get({ kind: 'app', id: appId }, key, fallback);
  }

  setApp(appId: string, key: string, value: ProtocolValue): ProtocolValue {
    return this.set({ kind: 'app', id: appId }, key, value);
  }

  deleteApp(appId: string, key: string): boolean {
    return this.delete({ kind: 'app', id: appId }, key);
  }

  entriesApp(appId: string): ProtocolRecord {
    return this.entries({ kind: 'app', id: appId });
  }

  getTask(taskId: string, key: string, fallback: ProtocolValue | null = null): ProtocolValue | null {
    return this.get({ kind: 'task', id: taskId }, key, fallback);
  }

  setTask(taskId: string, key: string, value: ProtocolValue): ProtocolValue {
    return this.set({ kind: 'task', id: taskId }, key, value);
  }

  deleteTask(taskId: string, key: string): boolean {
    return this.delete({ kind: 'task', id: taskId }, key);
  }

  entriesTask(taskId: string): ProtocolRecord {
    return this.entries({ kind: 'task', id: taskId });
  }

  getConversation(conversationId: string, key: string, fallback: ProtocolValue | null = null): ProtocolValue | null {
    return this.get({ kind: 'conversation', id: conversationId }, key, fallback);
  }

  setConversation(conversationId: string, key: string, value: ProtocolValue): ProtocolValue {
    return this.set({ kind: 'conversation', id: conversationId }, key, value);
  }

  deleteConversation(conversationId: string, key: string): boolean {
    return this.delete({ kind: 'conversation', id: conversationId }, key);
  }

  entriesConversation(conversationId: string): ProtocolRecord {
    return this.entries({ kind: 'conversation', id: conversationId });
  }

  summary(): MemorySummary {
    return {
      agentKeys: Array.from(this.#agent.keys()).sort(),
      appScopes: Array.from(this.#apps.keys()).sort(),
      taskScopes: Array.from(this.#tasks.keys()).sort(),
      conversationScopes: Array.from(this.#conversations.keys()).sort(),
      namedScopes: Object.fromEntries(
        Array.from(this.#named.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([scopeName, scopes]) => [scopeName, Array.from(scopes.keys()).sort()]),
      ),
    };
  }

  snapshot(): MemorySnapshot {
    return {
      agent: mapToObject(this.#agent),
      apps: nestedMapToObject(this.#apps),
      tasks: nestedMapToObject(this.#tasks),
      conversations: nestedMapToObject(this.#conversations),
      named: Object.fromEntries(
        Array.from(this.#named.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([scopeName, scopes]) => [scopeName, nestedMapToObject(scopes)]),
      ),
    };
  }

  restore(snapshot: Partial<MemorySnapshot> = {}): void {
    this.#agent = objectToMap(snapshot.agent ?? {});
    this.#apps = objectToNestedMap(snapshot.apps ?? {});
    this.#tasks = objectToNestedMap(snapshot.tasks ?? {});
    this.#conversations = objectToNestedMap(snapshot.conversations ?? {});
    this.#named = new Map(
      Object.entries(snapshot.named ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([scopeName, scopes]) => [scopeName, objectToNestedMap(scopes)]),
    );
  }

  #resolveScopeMap(scope: MemoryScopeInput, createIfMissing: boolean): ScopeMap | null {
    const normalized = normalizeScope(scope);

    switch (normalized.kind) {
      case 'agent':
        return this.#agent;
      case 'app':
        return this.#resolveLeafScope(this.#apps, normalized.id, createIfMissing, 'app');
      case 'task':
        return this.#resolveLeafScope(this.#tasks, normalized.id, createIfMissing, 'task');
      case 'conversation':
        return this.#resolveLeafScope(this.#conversations, normalized.id, createIfMissing, 'conversation');
      default: {
        const namedContainer = this.#resolveNamedContainer(
          this.#named,
          normalized.kind,
          createIfMissing,
          'named memory namespace',
        );
        if (!namedContainer) {
          return null;
        }

        return this.#resolveLeafScope(namedContainer, normalized.id, createIfMissing, `${normalized.kind} memory scope`);
      }
    }
  }

  #resolveLeafScope(container: ScopeContainer, id: string | null, createIfMissing: boolean, label: string): ScopeMap | null {
    if (!id) {
      throw new Error(`${label} id is required.`);
    }

    if (!container.has(id)) {
      if (!createIfMissing) {
        return null;
      }

      container.set(id, new Map());
    }

    return container.get(id) ?? null;
  }

  #resolveNamedContainer(
    container: NamedScopeContainer,
    id: string | null,
    createIfMissing: boolean,
    label: string,
  ): ScopeContainer | null {
    if (!id) {
      throw new Error(`${label} id is required.`);
    }

    if (!container.has(id)) {
      if (!createIfMissing) {
        return null;
      }

      container.set(id, new Map());
    }

    return container.get(id) ?? null;
  }
}
