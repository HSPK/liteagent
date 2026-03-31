import { createSignal, createToolSignal } from '../core/signal.js';
import { createExecutionContext, createLifecycleContext, createRoutingContext } from './execution-context.js';
import {
  createMemoryScope,
  describeError,
  observeModelStream,
} from './kernel-helpers.js';
import type { AppDescription, AppLike as InstalledAppLike } from '../apps/types.js';
import { createId } from '../utils/id.js';
import type {
  AppHostLike,
  AppRegistryLike,
  ConversationRecord,
  CreateMemoryScope,
  MemoryScopeInput,
  MemoryServiceLike,
  ModelAccessLike,
  ModelProviderContext,
  ModelRequest,
  ModelStreamEvent,
  PolicyLike,
  ProtocolValue,
  ReplySignalRequest,
  RuntimeLike,
  SchedulerLike,
  SelfDescription,
  SelfModelLike,
  SendMessageRequest,
  SignalEmitRequest,
  SignalLike,
  TaskEventRecorder,
  TaskRecord,
  TaskRuntimeLike,
  ToolRequestOptions,
  ToolAccessLike,
  WaitInput,
} from './types.js';
import type { KernelTaskController } from './kernel-task-controller.js';

export class KernelContextFactory {
  #agentId: string;
  #policy: PolicyLike;
  #tasks: TaskRuntimeLike;
  #memory: MemoryServiceLike;
  #tools: ToolAccessLike;
  #models: ModelAccessLike;
  #appHost: AppHostLike;
  #appRegistry: AppRegistryLike;
  #scheduler: SchedulerLike;
  #runtime: RuntimeLike;
  #selfModel: SelfModelLike;
  #taskController: KernelTaskController;
  #describeSelf: () => SelfDescription;
  #describeConversation: (conversationId: string | null) => ConversationRecord | null;
  #installAppById: (appId: string, source?: string) => Promise<AppDescription | null>;
  #uninstallApp: (appId: string) => boolean;
  #receiveSignal: (signal: SignalLike) => SignalLike;

  constructor({
    agentId,
    policy,
    tasks,
    memory,
    tools,
    models,
    appHost,
    appRegistry,
    scheduler,
    runtime,
    selfModel,
    taskController,
    describeSelf,
    describeConversation,
    installAppById,
    uninstallApp,
    receiveSignal,
  }: {
    agentId: string;
    policy: PolicyLike;
    tasks: TaskRuntimeLike;
    memory: MemoryServiceLike;
    tools: ToolAccessLike;
    models: ModelAccessLike;
    appHost: AppHostLike;
    appRegistry: AppRegistryLike;
    scheduler: SchedulerLike;
    runtime: RuntimeLike;
    selfModel: SelfModelLike;
    taskController: KernelTaskController;
    describeSelf: () => SelfDescription;
    describeConversation: (conversationId: string | null) => ConversationRecord | null;
    installAppById: (appId: string, source?: string) => Promise<AppDescription | null>;
    uninstallApp: (appId: string) => boolean;
    receiveSignal: (signal: SignalLike) => SignalLike;
  }) {
    this.#agentId = agentId;
    this.#policy = policy;
    this.#tasks = tasks;
    this.#memory = memory;
    this.#tools = tools;
    this.#models = models;
    this.#appHost = appHost;
    this.#appRegistry = appRegistry;
    this.#scheduler = scheduler;
    this.#runtime = runtime;
    this.#selfModel = selfModel;
    this.#taskController = taskController;
    this.#describeSelf = describeSelf;
    this.#describeConversation = describeConversation;
    this.#installAppById = installAppById;
    this.#uninstallApp = uninstallApp;
    this.#receiveSignal = receiveSignal;
  }

  createLifecycleContext(app: InstalledAppLike, source: string) {
    return createLifecycleContext({
      agentId: this.#agentId,
      appId: app.manifest.id,
      source,
      describeSelf: () => this.#describeSelf(),
      listInstalledApps: () => this.#appHost.listApps(),
      listAvailableApps: () => this.#appRegistry.list(),
      listModelProviders: () => this.#models.listProviders(),
      createMemoryScope: (scope) => this.#createBoundMemoryScope(scope),
    });
  }

  createRoutingContext(app: InstalledAppLike, signal: SignalLike) {
    const appId = app.manifest.id;

    return createRoutingContext({
      agentId: this.#agentId,
      appId,
      signal,
      policy: this.#policy.describe(),
      describeSelf: () => this.#describeSelf(),
      listInstalledApps: () => this.#appHost.listApps(),
      listAvailableApps: () => this.#appRegistry.list(),
      listTasks: (filters = {}) => this.#tasks.listTasks(filters),
      getTask: (taskId) => this.#tasks.getTask(taskId),
      findResumableTask: (candidateSignal, filters = {}) => this.#tasks.findResumableTask(candidateSignal, filters),
      taskInbox: (taskId: string) => ({
        list: () => this.#tasks.listInbox(taskId),
        peek: () => this.#tasks.peekInbox(taskId),
        size: () => this.#tasks.inboxSize(taskId),
      }),
      createMemoryScope: (scope) => this.#createBoundMemoryScope(scope),
    });
  }

  createExecutionContext(app: InstalledAppLike, task: TaskRecord, signal: SignalLike) {
    const appId = app.manifest.id;
    const listAvailableTools = () => this.#tools.listTools();
    const completeTask = (result?: ProtocolValue): TaskRecord => this.#taskController.completeTask(task.id, result);
    const waitForTask = (input: string | WaitInput = 'waiting'): TaskRecord =>
      this.#taskController.waitForSignal(task, appId, input);
    const waitForTasks = (taskIds: string | string[], options: WaitInput = {}): TaskRecord =>
      this.#taskController.waitForDependencies(task, appId, taskIds, options);
    const failTask = (error: unknown): TaskRecord => this.#taskController.failTask(task.id, error);
    const cancelTask = (reason = 'cancelled'): TaskRecord => this.#taskController.cancelTask(task.id, reason);
    const recordTaskEvent: TaskEventRecorder = (type, data = {}) =>
      this.#tasks.recordEvent(task.id, {
        type,
        signalId: signal.id,
        data,
      });
    const callTool = async (toolName: string, input: ProtocolValue = null): Promise<ProtocolValue> => {
      recordTaskEvent('tool.call.direct', {
        toolName,
        input,
      });

      try {
        const output = await this.#tools.callTool(toolName, input, {
          agentId: this.#agentId,
          appId,
          taskId: task.id,
          signal,
        });
        recordTaskEvent('tool.result.direct', {
          toolName,
          ok: true,
          output,
        });
        return output;
      } catch (error) {
        recordTaskEvent('tool.result.direct', {
          toolName,
          ok: false,
          error: this.#describeError(error),
        });
        throw error;
      }
    };
    const requestTool = (
      toolName: string,
      input: ProtocolValue = null,
      { targetAppId = appId, targetTaskId = task.id, metadata = {} }: ToolRequestOptions = {},
    ) => {
      const callId = createId('tool');
      const toolSignal = createToolSignal({
        type: 'tool.call',
        to: this.#agentId,
        from: this.#agentId,
        payload: {
          callId,
          toolName,
          input,
        },
        conversationId: task.conversationId,
        targetAppId,
        targetTaskId,
        metadata: {
          ...metadata,
          toolCallId: callId,
          toolName,
        },
      });

      recordTaskEvent('tool.call.enqueued', {
        callId,
        toolName,
        input,
      });
      this.#receiveSignal(toolSignal);

      return {
        callId,
        signal: toolSignal,
      };
    };
    const bindMemoryScope: CreateMemoryScope = (scope) => this.#createBoundMemoryScope(scope);
    const observeModelEvent = (event: ModelStreamEvent): void => {
      recordTaskEvent(`model.${String(event.type)}`, event);
    };
    const withModelObserver = (request: ModelRequest = {}): ModelRequest => ({
      ...request,
      onEvent: (event: ModelStreamEvent) => {
        observeModelEvent(event);
        request.onEvent?.(event);
      },
    });
    const modelContext: ModelProviderContext = {
      agentId: this.#agentId,
      appId,
      taskId: task.id,
      conversationId: task.conversationId,
      signal,
      tools: {
        list: listAvailableTools,
        call: callTool,
      },
    };

    return createExecutionContext({
      agentId: this.#agentId,
      appId,
      task,
      signal,
      policy: this.#policy.describe(),
      describeConversation: () => this.#describeConversation(task.conversationId),
      completeTask: (result) => completeTask(result),
      waitForTask: (input) => waitForTask(input),
      waitForTasks: (taskIds, options = {}) => waitForTasks(taskIds, options),
      failTask: (error) => failTask(error),
      cancelTask: (reason) => cancelTask(reason),
      listTasks: (filters = {}) => this.#tasks.listTasks({
        ...filters,
        appId: filters.appId ?? appId,
      }),
      getTask: (taskId = task.id) => this.#tasks.getTask(taskId),
      updateTask: (patch) => this.#tasks.updateTask(task.id, patch),
      listTaskEvents: () => this.#tasks.listEvents(task.id),
      recordTaskEvent: (type, data = {}) => recordTaskEvent(type, data),
      listTaskInbox: () => this.#tasks.listInbox(task.id),
      peekTaskInbox: () => this.#tasks.peekInbox(task.id),
      drainTaskInbox: () => {
        const entries = this.#tasks.drainInbox(task.id);
        if (entries.length > 0) {
          recordTaskEvent('task.inbox.drained', {
            count: entries.length,
            signalTypes: entries.map((entry) => entry.signal.type),
          });
        }
        return entries;
      },
      clearTaskInbox: () => {
        const cleared = this.#tasks.clearInbox(task.id);
        if (cleared > 0) {
          recordTaskEvent('task.inbox.cleared', {
            count: cleared,
          });
        }
        return cleared;
      },
      taskInboxSize: () => this.#tasks.inboxSize(task.id),
      createMemoryScope: (scope) => bindMemoryScope(scope),
      snapshotMemory: () => this.#memory.snapshot(),
      listTools: listAvailableTools,
      callTool,
      requestTool,
      listModelProviders: () => this.#models.listProviders(),
      streamModel: (request = {}) => this.#observeModelStream(request, modelContext, observeModelEvent),
      generateModel: (request = {}) => this.#models.generate(withModelObserver(request), modelContext),
      runModel: (request = {}) => this.#models.run(withModelObserver(request), modelContext),
      scheduleDelay: (request) => this.#taskController.scheduleDelayForTask(task, appId, request, recordTaskEvent),
      scheduleAt: (request) => this.#taskController.scheduleAtForTask(task, appId, request, recordTaskEvent),
      scheduleRecurring: (request) => this.#taskController.scheduleRecurringForTask(task, appId, request, recordTaskEvent),
      cancelSchedule: (scheduleId) => this.#taskController.cancelScheduleForTask(task, scheduleId, recordTaskEvent),
      listSchedules: () => this.#scheduler.listSchedules(),
      emitToSelf: ({
        kind = 'system',
        type,
        payload = null,
        targetAppId = null,
        targetTaskId = null,
        metadata = {},
      }: SignalEmitRequest) =>
        this.#receiveSignal(
          createSignal({
            kind,
            type,
            to: this.#agentId,
            from: this.#agentId,
            payload,
            conversationId: task.conversationId,
            targetAppId,
            targetTaskId,
            metadata,
          }),
        ),
      publishSignal: ({
        kind,
        type,
        to = this.#agentId,
        from = this.#agentId,
        payload = null,
        metadata = {},
      }) =>
        this.#runtime.publishSignal(
          createSignal({
            kind,
            type,
            to,
            from,
            payload,
            conversationId: task.conversationId,
            targetAppId: appId,
            targetTaskId: task.id,
            metadata,
          }),
        ),
      publishReply: ({
        type = 'assistant.reply',
        to = signal.from ?? this.#agentId,
        from = this.#agentId,
        payload = null,
        metadata = {},
      }: ReplySignalRequest) =>
        this.#runtime.reply({
          from,
          to,
          type,
          payload,
          conversationId: task.conversationId,
          metadata: {
            appId,
            taskId: task.id,
            ...metadata,
          },
        }),
      sendMessage: ({
        to,
        type,
        payload = null,
        targetAppId = null,
        targetTaskId = null,
        metadata = {},
      }: SendMessageRequest) =>
        this.#runtime.sendMessage({
          from: this.#agentId,
          to,
          type,
          payload,
          conversationId: task.conversationId,
          targetAppId,
          targetTaskId,
          metadata,
        }),
      emitEvent: ({
        type,
        payload = null,
        targetAppId = null,
        targetTaskId = null,
        metadata = {},
      }) =>
        this.#runtime.ingestEvent({
          to: this.#agentId,
          type,
          payload,
          conversationId: task.conversationId,
          targetAppId,
          targetTaskId,
          metadata,
        }),
      listInstalledApps: () => this.#appHost.listApps(),
      listAvailableApps: () => this.#appRegistry.list(),
      installApp: (installAppId) => this.#installAppById(installAppId, `app:${appId}`),
      uninstallApp: (uninstallAppId) => this.#uninstallApp(uninstallAppId),
      describeSelf: () => this.#describeSelf(),
      listSelfHistory: () => this.#selfModel.listHistory(),
    });
  }

  #createBoundMemoryScope(scope: MemoryScopeInput): ReturnType<CreateMemoryScope> {
    return createMemoryScope(this.#memory, scope);
  }

  async *#observeModelStream(
    request: ModelRequest,
    modelContext: ModelProviderContext,
    observeEvent: (event: ModelStreamEvent) => void,
  ): AsyncGenerator<ModelStreamEvent, void, unknown> {
    yield* observeModelStream(this.#models, request, modelContext, observeEvent);
  }

  #describeError(error: unknown): { name?: string; message: string } {
    return describeError(error);
  }
}
