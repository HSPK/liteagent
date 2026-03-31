import { Agent } from '../agent/agent.js';
import { AppRegistry } from '../apps/app-registry.js';
import { createEvent, createMessage, createReplySignal, createTextEvent, createTextMessage } from '../core/signal.js';
import { InMemoryObservabilityBackend } from '../kernel/observability/in-memory-observability-backend.js';
import { RuntimeStateManager } from '../kernel/state/runtime-state-manager.js';
import { ModelProviderRegistry } from '../models/provider-registry.js';
import { DispatchHandle } from '../sdk/dispatch-handle.js';
import type {
  AppRegistryLike,
  ModelProviderInstanceLike,
  ModelProviderRegistryLike,
  PolicyDescription,
  ProtocolRecord,
  ProtocolValue,
  SignalLike,
  ToolDefinition,
  UnknownRecord,
} from '../agent/types.js';
import type { AppDefinition, ModelProviderDescription } from '../apps/types.js';
import type {
  RuntimeEventFilter,
  RuntimeObservedEvent,
  RuntimeObservedEventType,
  RuntimeSnapshot,
  RuntimeStateEvent,
} from './types.js';

interface StateBackendLike {
  save(snapshot: RuntimeSnapshot): Promise<void>;
  load(): Promise<RuntimeSnapshot>;
}

interface ObservabilityBackendLike {
  record(event: RuntimeObservedEvent): Promise<void> | void;
  query(filters?: RuntimeEventFilter): Promise<RuntimeObservedEvent[]> | RuntimeObservedEvent[];
}

interface AgentsRuntimeOptions {
  stateBackend?: StateBackendLike | null;
  appRegistry?: AppRegistryLike;
  modelProviders?: ModelProviderRegistryLike;
  observabilityBackend?: ObservabilityBackendLike | null;
  defaultTools?: ToolDefinition[];
  defaultInstalledApps?: string[];
  autoSave?: boolean;
  autoSaveDebounceMs?: number;
}

interface RuntimeEventListenerRecord {
  callback: (event: RuntimeObservedEvent) => void;
  agentId: string | null;
  type: RuntimeObservedEventType | null;
}

interface AgentDefinitionInput {
  id: string;
  policy?: PolicyDescription | UnknownRecord;
  installedApps?: string[];
  apps?: string[];
}

interface CreateAgentOptions {
  includeRuntimeDefaults?: boolean;
  apps?: string[];
  installedApps?: string[];
  policy?: PolicyDescription | UnknownRecord;
}

interface NormalizedAgentInput {
  id: string;
  policy?: PolicyDescription | UnknownRecord;
  installedApps: string[];
}

interface SubscribeEventOptions {
  agentId?: string | null;
  type?: RuntimeObservedEventType | null;
}

interface SaveStateOptions {
  reason?: string;
  waitForIdle?: boolean;
}

interface SnapshotOptions {
  waitForIdle?: boolean;
}

interface PersistOptions {
  persist?: boolean;
}

interface SendMessageInput {
  from: string;
  to: string;
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
}

interface IngestEventInput {
  to: string;
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
}

interface MessageInput extends UnknownRecord {
  from: string;
  to: string;
  type: string;
  payload?: ProtocolRecord | null;
  app?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
}

interface EventInput extends UnknownRecord {
  to: string;
  type: string;
  payload?: ProtocolRecord | null;
  app?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
}

interface TextInput extends UnknownRecord {
  to: string;
  text: string;
  app?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
  payload?: ProtocolRecord;
}

interface TellInput extends UnknownRecord {
  from: string;
  to: string;
  text: string;
  app?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
  payload?: ProtocolRecord;
}

interface ReplyInput {
  from: string;
  to: string;
  type?: string;
  payload?: ProtocolRecord | null;
  conversationId?: string | null;
  metadata?: ProtocolRecord;
}

function normalizeSignalPayload(payload: unknown, fieldName: string): ProtocolRecord | null {
  if (payload === undefined || payload === null) {
    return null;
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${fieldName} must be an object or null.`);
  }

  return payload as ProtocolRecord;
}

export class AgentsRuntime {
  appRegistry: AppRegistryLike;
  modelProviders: ModelProviderRegistryLike;
  observability: ObservabilityBackendLike;
  autoSave: boolean;
  defaultTools: ToolDefinition[];
  defaultInstalledApps: string[];
  agents: Map<string, Agent>;
  state: RuntimeStateManager;

  #eventListeners = new Set<RuntimeEventListenerRecord>();
  #agentEventUnsubscribers = new Map<string, Array<() => void>>();
  #observabilityWrite: Promise<void> = Promise.resolve();
  #observabilityError: unknown = null;

  constructor({
    appRegistry,
    modelProviders,
    observabilityBackend,
    stateBackend = null,
    defaultTools = [],
    defaultInstalledApps = [],
    autoSave = true,
    autoSaveDebounceMs = 25,
  }: AgentsRuntimeOptions = {}) {
    this.appRegistry = appRegistry ?? new AppRegistry();
    this.modelProviders = modelProviders ?? new ModelProviderRegistry();
    this.observability = observabilityBackend ?? new InMemoryObservabilityBackend();
    this.autoSave = autoSave;
    this.defaultTools = Array.from(defaultTools);
    this.defaultInstalledApps = Array.from(new Set(defaultInstalledApps));
    this.agents = new Map();
    this.state = new RuntimeStateManager({
      runtime: this,
      backend: stateBackend,
      debounceMs: autoSaveDebounceMs,
      emitEvent: (event) => {
        this.#emitEvent(event, { persist: false });
      },
    });
  }

  registerApp(definition: AppDefinition) {
    return this.appRegistry.register(definition);
  }

  registerModelProvider(provider: ModelProviderInstanceLike): ModelProviderInstanceLike {
    return this.modelProviders.register(provider);
  }

  getModelProvider(providerId: string): ModelProviderInstanceLike | null {
    return this.modelProviders.get(providerId);
  }

  listModelProviders(): ModelProviderDescription[] {
    return this.modelProviders.list();
  }

  async createAgent(input: string | AgentDefinitionInput, options: CreateAgentOptions = {}): Promise<Agent> {
    const { id, policy, installedApps } = this.#normalizeAgentInput(input, options);
    if (!id) {
      throw new Error('Agent id is required.');
    }

    if (this.agents.has(id)) {
      throw new Error(`Agent already exists: ${id}`);
    }

    const agent = new Agent({
      id,
      runtime: this,
      policy,
      appRegistry: this.appRegistry,
    });

    this.agents.set(agent.id, agent);

    try {
      for (const tool of this.defaultTools) {
        agent.registerTool(tool);
      }

      for (const appId of installedApps) {
        await agent.installAppById(appId, 'bootstrap');
      }
    } catch (error) {
      this.#detachAgentEvents(agent.id);
      this.agents.delete(agent.id);
      agent.dispose();
      throw error;
    }

    this.#attachAgentEvents(agent);
    this.#emitEvent({
      type: 'agent.created',
      agentId: agent.id,
      createdAt: Date.now(),
    });

    return agent;
  }

  async createAgents(definitions: Array<string | AgentDefinitionInput> = []): Promise<Record<string, Agent>> {
    const entries = await Promise.all(
      definitions.map(async (definition) => {
        const agent = await this.createAgent(definition);
        return [agent.id, agent] as const;
      }),
    );

    return Object.fromEntries(entries) as Record<string, Agent>;
  }

  getAgent(agentId: string): Agent | null {
    return this.agents.get(agentId) ?? null;
  }

  agent(agentId: string): Agent | null {
    return this.getAgent(agentId);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys()).sort();
  }

  subscribeEvents(
    callback: (event: RuntimeObservedEvent) => void,
    { agentId = null, type = null }: SubscribeEventOptions = {},
  ): () => void {
    const listener = {
      callback,
      agentId,
      type,
    };

    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  async queryEvents(filters: RuntimeEventFilter = {}): Promise<RuntimeObservedEvent[]> {
    await this.#flushObservability();
    return this.observability.query(filters);
  }

  async saveState(options: SaveStateOptions = {}): Promise<RuntimeSnapshot | null> {
    const snapshot = await this.state.flush({
      reason: options.reason ?? 'manual',
      waitForIdle: options.waitForIdle ?? true,
    });
    await this.#flushObservability();
    return snapshot;
  }

  async flushState(options: SaveStateOptions = {}): Promise<RuntimeSnapshot | null> {
    return this.saveState(options);
  }

  async loadState(): Promise<RuntimeSnapshot> {
    const runtimeSnapshot = await this.state.load();
    await this.restore(runtimeSnapshot);
    this.#emitEvent({
      type: 'state.restored',
      createdAt: Date.now(),
      reason: 'backend',
      agentCount: runtimeSnapshot.agents?.length ?? 0,
    }, { persist: false });
    await this.#flushObservability();
    return runtimeSnapshot;
  }

  async snapshot({ waitForIdle = true }: SnapshotOptions = {}): Promise<RuntimeSnapshot> {
    if (waitForIdle) {
      await this.whenIdle();
    }

    const agentSnapshots = Array.from(this.agents.values())
      .map((agent) => agent.snapshotState())
      .sort((left, right) => left.agentId.localeCompare(right.agentId));

    return {
      version: 1,
      createdAt: Date.now(),
      agents: agentSnapshots,
    };
  }

  async restore(snapshot: RuntimeSnapshot): Promise<this> {
    if (this.agents.size > 0) {
      throw new Error('Runtime restore requires an empty runtime.');
    }

    this.#validateSnapshot(snapshot);

    for (const agentSnapshot of snapshot.agents ?? []) {
      const agent = await this.createAgent({
        id: agentSnapshot.agentId,
        policy: agentSnapshot.policy,
        installedApps: [],
      }, { includeRuntimeDefaults: false });
      await agent.restoreState(agentSnapshot);
    }

    return this;
  }

  dispatchSignal(signal: SignalLike): SignalLike {
    const agent = this.getAgent(signal.to);

    if (!agent) {
      throw new Error(`Unknown target agent: ${signal.to}`);
    }

    this.#emitEvent({
      type: 'signal.dispatched',
      agentId: signal.to,
      signal: structuredClone(signal),
      createdAt: Date.now(),
    });
    agent.receive(signal);
    return signal;
  }

  publishSignal(signal: SignalLike, { persist = true }: PersistOptions = {}): SignalLike {
    this.#emitEvent({
      type: 'signal.published',
      agentId: signal.from ?? signal.to,
      signal: structuredClone(signal),
      createdAt: Date.now(),
    }, { persist });
    return signal;
  }

  sendMessage({
    from,
    to,
    type,
    payload = null,
    targetAppId = null,
    targetTaskId = null,
    conversationId,
    metadata = {},
  }: SendMessageInput): SignalLike {
    const signal = createMessage({
      from,
      to,
      type,
      payload,
      conversationId,
      targetAppId,
      targetTaskId,
      metadata,
    });

    return this.dispatchSignal(signal);
  }

  ingestEvent({
    to,
    type,
    payload = null,
    targetAppId = null,
    targetTaskId = null,
    conversationId,
    metadata = {},
  }: IngestEventInput): SignalLike {
    const signal = createEvent({
      to,
      type,
      payload,
      conversationId,
      targetAppId,
      targetTaskId,
      metadata,
    });

    return this.dispatchSignal(signal);
  }

  message<TResult = ProtocolValue | null>({
    from,
    to,
    type,
    payload = null,
    app = null,
    taskId = null,
    conversationId,
    metadata = {},
  }: MessageInput): DispatchHandle<TResult> {
    const signal = this.sendMessage({
      from,
      to,
      type,
      payload: normalizeSignalPayload(payload, 'message payload'),
      targetAppId: app,
      targetTaskId: taskId,
      conversationId,
      metadata,
    });

    return this.#createDispatchHandle(signal);
  }

  event<TResult = ProtocolValue | null>({
    to,
    type,
    payload = null,
    app = null,
    taskId = null,
    conversationId,
    metadata = {},
  }: EventInput): DispatchHandle<TResult> {
    const signal = this.ingestEvent({
      to,
      type,
      payload: normalizeSignalPayload(payload, 'event payload'),
      targetAppId: app,
      targetTaskId: taskId,
      conversationId,
      metadata,
    });

    return this.#createDispatchHandle(signal);
  }

  text<TResult = ProtocolValue | null>({
    to,
    text,
    app = null,
    taskId = null,
    conversationId,
    metadata = {},
    payload = {},
  }: TextInput): DispatchHandle<TResult> {
    const signal = createTextEvent({
      to,
      text,
      payload,
      targetAppId: app,
      targetTaskId: taskId,
      conversationId,
      metadata,
    });

    this.dispatchSignal(signal);
    return this.#createDispatchHandle(signal);
  }

  tell<TResult = ProtocolValue | null>({
    from,
    to,
    text,
    app = null,
    taskId = null,
    conversationId,
    metadata = {},
    payload = {},
  }: TellInput): DispatchHandle<TResult> {
    const signal = createTextMessage({
      from,
      to,
      text,
      payload,
      targetAppId: app,
      targetTaskId: taskId,
      conversationId,
      metadata,
    });

    this.dispatchSignal(signal);
    return this.#createDispatchHandle(signal);
  }

  reply({
    from,
    to,
    type = 'assistant.reply',
    payload = null,
    conversationId,
    metadata = {},
  }: ReplyInput): SignalLike {
    const signal = createReplySignal({
      from,
      to,
      type,
      payload,
      conversationId,
      metadata,
    });

    this.publishSignal(signal);
    return signal;
  }

  async whenIdle(): Promise<void> {
    do {
      await Promise.all(Array.from(this.agents.values()).map((agent) => agent.whenIdle()));
    } while (Array.from(this.agents.values()).some((agent) => !agent.isIdle()));
    await this.#flushObservability();
  }

  dispose(): void {
    this.state.dispose();
    for (const agentId of this.agents.keys()) {
      this.#emitEvent({
        type: 'agent.disposed',
        agentId,
        createdAt: Date.now(),
      }, { persist: false });
      this.#detachAgentEvents(agentId);
    }

    for (const agent of this.agents.values()) {
      agent.dispose();
    }
  }

  static async fromSnapshot(snapshot: RuntimeSnapshot, options: AgentsRuntimeOptions = {}): Promise<AgentsRuntime> {
    const runtime = new AgentsRuntime(options);
    await runtime.restore(snapshot);
    return runtime;
  }

  idle(): Promise<void> {
    return this.whenIdle();
  }

  #createDispatchHandle<TResult = ProtocolValue | null>(signal: SignalLike): DispatchHandle<TResult> {
    return new DispatchHandle<TResult>({
      runtime: this,
      signal,
    });
  }

  #normalizeAgentInput(input: string | AgentDefinitionInput, options: CreateAgentOptions): NormalizedAgentInput {
    const includeRuntimeDefaults = options.includeRuntimeDefaults ?? true;
    const installedApps = typeof input === 'string'
      ? options.apps ?? options.installedApps ?? []
      : input.installedApps ?? input.apps ?? [];
    const mergedInstalledApps = Array.from(new Set([
      ...(includeRuntimeDefaults ? this.defaultInstalledApps : []),
      ...installedApps,
    ]));

    if (typeof input === 'string') {
      return {
        id: input,
        policy: options.policy,
        installedApps: mergedInstalledApps,
      };
    }

    return {
      id: input.id,
      policy: input.policy,
      installedApps: mergedInstalledApps,
    };
  }

  #validateSnapshot(snapshot: RuntimeSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('Runtime snapshot must be an object.');
    }

    if (snapshot.version !== 1) {
      throw new Error(`Unsupported runtime snapshot version: ${snapshot.version}`);
    }

    if (!Array.isArray(snapshot.agents)) {
      throw new Error('Runtime snapshot must include an agents array.');
    }
  }

  #attachAgentEvents(agent: Agent): void {
    this.#detachAgentEvents(agent.id);

    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(agent.observeTaskEvents((event) => {
      this.#emitEvent({
        type: 'task.event',
        agentId: agent.id,
        taskId: event.taskId,
        event,
        createdAt: typeof event.createdAt === 'number' ? event.createdAt : Date.now(),
      });
    }));

    if (typeof agent.observeKernelEvents === 'function') {
      unsubscribers.push(agent.observeKernelEvents((event) => {
        if (event.category === 'scheduler') {
          this.#emitEvent({
            type: 'scheduler.event',
            agentId: agent.id,
            event,
            createdAt: event.createdAt,
          });
          return;
        }

        this.#emitEvent({
          type: 'policy.event',
          agentId: agent.id,
          event,
          createdAt: event.createdAt,
        });
      }));
    }

    this.#agentEventUnsubscribers.set(agent.id, unsubscribers);
  }

  #detachAgentEvents(agentId: string): void {
    const unsubscribers = this.#agentEventUnsubscribers.get(agentId);
    if (!unsubscribers) {
      return;
    }

    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    this.#agentEventUnsubscribers.delete(agentId);
  }

  #emitEvent(event: RuntimeObservedEvent, { persist = true }: PersistOptions = {}): void {
    for (const listener of this.#eventListeners) {
      if (listener.agentId !== null && listener.agentId !== event.agentId) {
        continue;
      }

      if (listener.type !== null && listener.type !== event.type) {
        continue;
      }

      listener.callback(structuredClone(event));
    }

    this.#recordObservedEvent(event);

    if (persist && this.autoSave) {
      this.state.queueSave(event.type);
    }
  }

  #recordObservedEvent(event: RuntimeObservedEvent): void {
    this.#observabilityWrite = this.#observabilityWrite
      .then(() => this.observability.record(structuredClone(event)))
      .catch((error) => {
        this.#observabilityError = error;
      });
  }

  async #flushObservability(): Promise<void> {
    await this.#observabilityWrite;

    if (this.#observabilityError) {
      const error = this.#observabilityError;
      this.#observabilityError = null;
      throw error;
    }
  }
}
