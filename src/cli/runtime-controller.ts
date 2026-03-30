import { createRuntime } from '../sdk/create-runtime.js';
import { createId } from '../utils/id.js';
import { DEFAULT_ASSISTANT_AGENT_ID, DEFAULT_ASSISTANT_APPS } from './default-runtime.js';
import type { CliCommandName } from './command-catalog.js';
import { formatCliCommandUsage, resolveCliCommand } from './command-catalog.js';
import { StreamManager } from './stream-manager.js';
import type {
  MemorySnapshot,
  ModelTextDeltaEvent,
  ProtocolRecord,
  ProtocolValue,
  SelfDescription,
  SignalLike,
  TaskToolCallEventData,
  TaskToolResultEventData,
  TaskWaitingEventData,
} from '../agent/types.js';
import type { AppDefinitionSummary, AppDescription } from '../apps/types.js';
import type {
  CliEntryPatch,
  ConsoleChatResult,
  EntryListener,
  ParsedCommand,
  RuntimeControllerAgentLike,
  RuntimeControllerCommandResult,
  RuntimeControllerOptions,
  RuntimeControllerRuntimeLike,
  RuntimeEventLike,
  RuntimeSubmissionResult,
  SubmitTextOptions,
} from './types.js';

function parseJsonValue(raw: string | undefined): ProtocolValue {
  if (raw === undefined) {
    return null;
  }

  return JSON.parse(raw);
}

function asRecord(value: unknown): ProtocolRecord | null {
  return value && typeof value === 'object'
    ? value as ProtocolRecord
    : null;
}

function readString(value: unknown, key: string): string | null {
  const record = asRecord(value);
  return typeof record?.[key] === 'string' ? record[key] as string : null;
}

function readBoolean(value: unknown, key: string): boolean {
  const record = asRecord(value);
  return record?.[key] === true;
}

function normalizePayload(payload: ProtocolValue): ProtocolRecord | null {
  if (payload === undefined || payload === null) {
    return null;
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('CLI payload must be an object or null.');
  }

  return payload as ProtocolRecord;
}

const DEFAULT_CLI_APPS = ['domain.echo'];

function requireArgs(args: string[], count: number, commandName: CliCommandName): void {
  if (args.length < count || args.slice(0, count).some((value) => !value)) {
    throw new Error(`Usage: ${formatCliCommandUsage(commandName)}`);
  }
}

type CommandHandler = (
  controller: RuntimeController,
  args: string[],
  options: ParsedCommand['options'],
) => Promise<RuntimeControllerCommandResult> | RuntimeControllerCommandResult;

const COMMAND_HANDLERS: Record<CliCommandName, CommandHandler> = {
  help: () => ({ type: 'help' }),
  list: (controller) => controller.listAgents(),
  create: async (controller, args) => {
    requireArgs(args, 1, 'create');
    return controller.createAgent(args[0], args.slice(1));
  },
  inspect: (controller, args) => {
    requireArgs(args, 1, 'inspect');
    return controller.inspectAgent(args[0]);
  },
  memory: (controller, args) => {
    requireArgs(args, 1, 'memory');
    return controller.inspectMemory(args[0]);
  },
  registry: (controller) => controller.listRegistry(),
  apps: (controller, args) => {
    requireArgs(args, 1, 'apps');
    return controller.listApps(args[0]);
  },
  install: (controller, args) => {
    requireArgs(args, 2, 'install');
    return controller.installApp(args[0], args[1]);
  },
  event: (controller, args, options) => {
    requireArgs(args, 2, 'event');
    return controller.ingestEvent({
      to: args[0],
      type: args[1],
      payload: parseJsonValue(args[2]),
      appId: options.appId ?? null,
    });
  },
  message: (controller, args, options) => {
    requireArgs(args, 3, 'message');
    return controller.sendMessage({
      from: args[0],
      to: args[1],
      type: args[2],
      payload: parseJsonValue(args[3]),
      appId: options.appId ?? null,
    });
  },
  wait: (controller) => controller.waitForIdle(),
  exit: () => null,
};

export class RuntimeController {
  runtime: RuntimeControllerRuntimeLike;
  defaultAssistantId: string;
  defaultAssistantApps: string[];
  #entryListeners = new Set<EntryListener>();
  #runtimeUnsubscribe?: () => void;
  #stream: StreamManager;
  #ready: Promise<void>;

  constructor(options: RuntimeControllerOptions = {}) {
    const {
      runtime,
      bootstrapAssistant = false,
      defaultAssistantId = DEFAULT_ASSISTANT_AGENT_ID,
      defaultAssistantApps = DEFAULT_ASSISTANT_APPS,
    } = options;
    this.runtime = runtime ?? createRuntime();
    this.defaultAssistantId = defaultAssistantId;
    this.defaultAssistantApps = Array.from(new Set(defaultAssistantApps));
    this.#stream = new StreamManager((entries) => this.#emitEntries(entries));
    this.#runtimeUnsubscribe = this.runtime.subscribeEvents((event) => {
      this.#handleRuntimeEvent(event);
    });
    this.#ready = bootstrapAssistant
      ? this.#initializeDefaultAssistant()
      : Promise.resolve();
  }

  async initialize(): Promise<RuntimeController> {
    await this.#ready;
    return this;
  }

  async createAgent(agentId: string, appIds: string[] = []): Promise<{
    agentId: string;
    installedApps: Array<string | null>;
  }> {
    await this.initialize();

    const installedApps = appIds.length > 0
      ? appIds
      : this.runtime.defaultInstalledApps.length > 0
        ? []
        : DEFAULT_CLI_APPS;
    const agent = await this.runtime.createAgent({
      id: agentId,
      installedApps,
    });

    return {
      agentId: agent.id,
      installedApps: agent.describeSelf().apps.map((entry) => entry.appId),
    };
  }

  listAgents(): Array<{
    agentId: string;
    appCount: number;
    taskCount: number;
    timerCount: number;
    scheduleCount: number;
  }> {
    return this.runtime.listAgents().map((agentId) => {
      const agent = this.#requireAgent(agentId);
      const self = agent.describeSelf();
      const schedules = self.schedules ?? self.timers ?? [];
      return {
        agentId,
        appCount: self.apps.length,
        taskCount: self.tasks.length,
        timerCount: schedules.length,
        scheduleCount: schedules.length,
      };
    });
  }

  inspectAgent(agentId: string): SelfDescription {
    return this.#requireAgent(agentId).describeSelf();
  }

  inspectMemory(agentId: string): MemorySnapshot {
    return this.#requireAgent(agentId).snapshotMemory();
  }

  listRegistry(): AppDefinitionSummary[] {
    return this.runtime.appRegistry.list();
  }

  listApps(agentId: string): SelfDescription['apps'] {
    return this.#requireAgent(agentId).describeSelf().apps;
  }

  async installApp(agentId: string, appId: string): Promise<AppDescription | null> {
    const agent = this.#requireAgent(agentId);
    return agent.installAppById(appId, 'cli');
  }

  sendMessage({
    from,
    to,
    type,
    appId = null,
    payload = null,
  }: {
    from: string;
    to: string;
    type: string;
    appId?: string | null;
    payload?: ProtocolValue;
  }): SignalLike {
    return this.runtime.sendMessage({
      from,
      to,
      type,
      targetAppId: appId,
      payload: normalizePayload(payload),
    });
  }

  ingestEvent({
    to,
    type,
    appId = null,
    payload = null,
  }: {
    to: string;
    type: string;
    appId?: string | null;
    payload?: ProtocolValue;
  }): SignalLike {
    return this.runtime.ingestEvent({
      to,
      type,
      targetAppId: appId,
      payload: normalizePayload(payload),
    });
  }

  async broadcastText(text: string, options: { conversationId?: string } = {}): Promise<ConsoleChatResult> {
    const { conversationId = createId('cli') } = options;
    await this.initialize();

    const submission = await this.submitText(text, {
      conversationId,
      agentId: null,
    });
    const handles = submission.handles ?? [];

    await this.runtime.whenIdle();

    return {
      conversationId,
      replies: handles.map(({ agentId, handle }) => {
        const task = handle.task();
        return {
          agentId,
          conversationId: handle.conversationId,
          status: task?.status ?? 'unhandled',
          result: task?.result ?? null,
        };
      }),
    };
  }

  async chatText(text: string, options: SubmitTextOptions = {}): Promise<ConsoleChatResult> {
    const {
      conversationId = createId('cli'),
      agentId = this.defaultAssistantId,
    } = options;
    const submission = await this.submitText(text, {
      conversationId,
      agentId,
    });

    if ((submission.handles ?? []).length === 0) {
      return {
        conversationId: submission.conversationId,
        replies: [],
      };
    }

    await this.runtime.whenIdle();

    return {
      conversationId: submission.conversationId,
      replies: submission.handles.map(({ agentId: currentAgentId, handle, renderedBySubscription = false }) => {
        const task = handle.task();
        return {
          agentId: currentAgentId,
          conversationId: handle.conversationId,
          status: task?.status ?? 'unhandled',
          result: task?.result ?? null,
          renderedBySubscription,
        };
      }),
    };
  }

  async submitText(text: string, options: SubmitTextOptions = {}): Promise<RuntimeSubmissionResult> {
    const {
      conversationId = createId('cli'),
      agentId = this.defaultAssistantId,
    } = options;
    await this.initialize();

    const assistant = agentId ? this.runtime.getAgent(agentId) : null;
    if (!assistant) {
      const handles = this.runtime.listAgents().map((currentAgentId) => ({
        agentId: currentAgentId,
        handle: this.runtime.text({
          to: currentAgentId,
          text,
          conversationId,
        }),
        renderedBySubscription: false,
      }));
      return {
        conversationId,
        handles,
      };
    }

    const targetAgentId = agentId ?? assistant.id;
    const targetsAssistantApp = assistant
      && assistant.describeSelf()
        .apps
        .some((entry) => entry.appId === 'domain.assistant');
    const handle = this.runtime.text({
      to: targetAgentId,
      text,
      app: targetsAssistantApp ? 'domain.assistant' : null,
      conversationId,
    });

    return {
      conversationId,
      handles: [{
        agentId: targetAgentId,
        handle,
        renderedBySubscription: this.hasLiveEntries() && targetsAssistantApp,
      }],
    };
  }

  async waitForIdle(): Promise<{ status: 'idle'; agents: ReturnType<RuntimeController['listAgents']> }> {
    await this.initialize();
    await this.runtime.whenIdle();
    await this.runtime.saveState({
      reason: 'controller.wait',
      waitForIdle: false,
    });
    return {
      status: 'idle',
      agents: this.listAgents(),
    };
  }

  subscribeEntries(callback: EntryListener): () => void {
    this.#entryListeners.add(callback);
    return () => {
      this.#entryListeners.delete(callback);
    };
  }

  hasLiveEntries(): boolean {
    return this.#entryListeners.size > 0;
  }

  async persistState(reason = 'controller.persist'): Promise<void> {
    await this.initialize();
    await this.runtime.saveState({
      reason,
      waitForIdle: true,
    });
  }

  dispose(): void {
    this.#runtimeUnsubscribe?.();
    this.#stream.dispose();
    this.runtime.dispose();
  }

  async execute(parsedCommand: ParsedCommand): Promise<RuntimeControllerCommandResult> {
    await this.initialize();
    const { command, args, options } = parsedCommand;
    const resolvedCommand = resolveCliCommand(command);

    if (!resolvedCommand) {
      throw new Error(`Unknown command: ${command}`);
    }

    return COMMAND_HANDLERS[resolvedCommand.name as CliCommandName](this, args, options);
  }

  #requireAgent(agentId: string): RuntimeControllerAgentLike {
    if (!agentId) {
      throw new Error('Agent id is required.');
    }

    const agent = this.runtime.getAgent(agentId);

    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    return agent;
  }

  #handleRuntimeEvent(runtimeEvent: RuntimeEventLike): void {
    if (runtimeEvent.type === 'signal.published') {
      this.#handlePublishedSignal(runtimeEvent);
      return;
    }

    if (runtimeEvent.type !== 'task.event') {
      return;
    }

    const { agentId, taskId, event } = runtimeEvent;
    if (!agentId || !taskId || !event) {
      return;
    }
    const streamKey = `stream:${agentId}:${taskId}`;

    switch (event.type) {
      case 'model.text.delta': {
        const modelEvent = event.data as ModelTextDeltaEvent;
        this.#stream.append(streamKey, agentId, modelEvent.text ?? '');
        return;
      }
      case 'task.completed':
      case 'task.failed':
      case 'task.cancelled':
        this.#stream.flush(streamKey, agentId);
        if (this.#stream.has(streamKey)) {
          this.#stream.remove(streamKey);
          this.#emitEntries([{ removeKey: streamKey }]);
        }
        return;
      case 'task.waiting': {
        const waitingEvent = event.data as TaskWaitingEventData;
        this.#emitEntries([{
          kind: 'system',
          text: `${agentId}:${taskId} waiting — ${waitingEvent.wait.reason ?? 'waiting'}`,
        }]);
        return;
      }
      case 'tool.call.signal':
      case 'tool.call.direct': {
        const toolCallEvent = event.data as TaskToolCallEventData;
        this.#emitEntries([{
          kind: 'system',
          text: `${agentId}:${taskId} tool.call ${toolCallEvent.toolName ?? 'unknown'}`,
        }]);
        return;
      }
      case 'tool.result.signal':
      case 'tool.result.direct': {
        const toolResultEvent = event.data as TaskToolResultEventData;
        this.#emitEntries([{
          kind: 'system',
          text: `${agentId}:${taskId} tool.result ${toolResultEvent.toolName ?? 'unknown'} ${toolResultEvent.ok ? 'ok' : 'error'}`,
        }]);
        return;
      }
      default:
        return;
    }
  }

  #handlePublishedSignal(runtimeEvent: RuntimeEventLike): void {
    if (runtimeEvent.type !== 'signal.published') {
      return;
    }

    const { signal } = runtimeEvent;
    if (signal?.kind !== 'reply' || signal.type !== 'assistant.reply') {
      return;
    }

    const author = signal.from ?? runtimeEvent.agentId ?? this.defaultAssistantId;
    const payload = asRecord(signal.payload);
    const metadata = asRecord(signal.metadata);
    const text = readString(payload, 'text');
    if (!text) {
      return;
    }

    const taskId = readString(metadata, 'taskId') ?? readString(payload, 'taskId');
    if (taskId) {
      const streamKey = `stream:${author}:${taskId}`;
      this.#stream.flush(streamKey, author);
      if (this.#stream.has(streamKey)) {
        this.#stream.remove(streamKey);
        this.#emitEntries([{ removeKey: streamKey }]);
      }
    }

    this.#emitEntries([{
      kind: 'agent',
      author,
      text,
    }]);
  }

  async #initializeDefaultAssistant(): Promise<void> {
    if (this.runtime.state?.hasBackend?.()) {
      await this.runtime.loadState();
    }

    if (!this.runtime.getAgent(this.defaultAssistantId)) {
      const installedApps = this.runtime.defaultInstalledApps.length > 0
        ? []
        : this.defaultAssistantApps;
      await this.runtime.createAgent({
        id: this.defaultAssistantId,
        installedApps,
      });
    }
  }

  #emitEntries(entries: CliEntryPatch[]): void {
    if (!entries || entries.length === 0) {
      return;
    }

    const payload = entries.map((entry) => structuredClone(entry));
    for (const listener of this.#entryListeners) {
      listener(payload);
    }
  }
}
