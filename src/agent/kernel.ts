import { AppHost } from '../apps/app-host.js';
import { KernelAppRuntime, type InstallAppInstanceOptions } from './kernel-app-runtime.js';
import { KernelContextFactory } from './kernel-context-factory.js';
import { KernelTaskController } from './kernel-task-controller.js';
import { ConversationService } from '../kernel/conversation-service.js';
import { Mailbox } from '../kernel/mailbox.js';
import { MemoryService } from '../kernel/memory.js';
import { ModelAccessService } from '../kernel/model-access.js';
import { SelfModelService } from '../kernel/self-model.js';
import { TaskRuntime } from '../kernel/task-runtime.js';
import { TimerService } from '../kernel/timer-service.js';
import { ToolAccessService } from '../kernel/tool-access.js';
import type {
  AppDescription,
  AppLike as InstalledAppLike,
} from '../apps/types.js';
import type {
  AgentStateSnapshot,
  AppHostLike,
  AppRegistryLike,
  ConversationRecord,
  ConversationServiceLike,
  KernelAgentLike,
  KernelObservedEvent,
  KernelEventListener,
  MailboxLike,
  MemorySnapshot,
  MemoryServiceLike,
  ModelAccessLike,
  NormalizedRouteDecision,
  PolicyDecision,
  PolicyLike as KernelPolicyLike,
  ProtocolRecord,
  ProtocolValue,
  RuntimeLike,
  ScheduleRecord,
  SchedulerLike,
  SelfDescription,
  SelfModelHistoryEntry,
  SelfModelLike,
  SignalLike,
  TaskEventListener,
  TaskEventEntry,
  TaskRecord,
  TaskRuntimeLike,
  ToolAccessLike,
  ToolDefinition,
  UnknownRecord,
} from './types.js';

interface KernelListener {
  callback: KernelEventListener;
  category: string | null;
  type: string | null;
}

export class AgentKernel {
  #kernelListeners: Set<KernelListener> = new Set();
  #schedulerUnsubscribe: (() => void) | null = null;

  agent: KernelAgentLike;
  runtime: RuntimeLike;
  policy: KernelPolicyLike;
  appRegistry: AppRegistryLike;
  tasks: TaskRuntimeLike;
  conversations: ConversationServiceLike;
  memory: MemoryServiceLike;
  tools: ToolAccessLike;
  models: ModelAccessLike;
  appHost: AppHostLike;
  scheduler: SchedulerLike;
  timers: SchedulerLike;
  selfModel: SelfModelLike;
  mailbox: MailboxLike;
  contextFactory: KernelContextFactory;
  appRuntime: KernelAppRuntime;
  taskController: KernelTaskController;

  constructor({
    agent,
    runtime,
    policy,
    appRegistry,
  }: {
    agent: KernelAgentLike;
    runtime: RuntimeLike;
    policy: KernelPolicyLike;
    appRegistry: AppRegistryLike;
  }) {
    this.agent = agent;
    this.runtime = runtime;
    this.policy = policy;
    this.appRegistry = appRegistry;
    this.tasks = new TaskRuntime();
    this.conversations = new ConversationService();
    this.memory = new MemoryService();
    this.tools = new ToolAccessService(policy);
    this.models = new ModelAccessService({
      policy,
      registry: runtime.modelProviders,
    });
    this.appHost = new AppHost(policy);
    this.scheduler = new TimerService({
      agentId: agent.id,
      deliverSignal: (signal: SignalLike): SignalLike => this.receiveSignal(signal),
    }) as SchedulerLike;
    this.timers = this.scheduler;
    this.selfModel = new SelfModelService({
      agentId: agent.id,
      policy,
      appHost: this.appHost,
      tasks: this.tasks,
      conversations: this.conversations,
      scheduler: this.scheduler,
      tools: this.tools,
      models: this.models,
      memory: this.memory,
    });
    this.#schedulerUnsubscribe = this.scheduler.subscribe((event) => {
      this.selfModel.recordChange(event.type, {
        scheduleId: event.scheduleId,
        data: event.data,
      });
      this.#emitKernelEvent({
        category: 'scheduler',
        ...event,
      });
    });
    this.taskController = new KernelTaskController({
      agentId: agent.id,
      policy,
      tasks: this.tasks,
      scheduler: this.scheduler,
      memory: this.memory,
      conversations: this.conversations,
      selfModel: this.selfModel,
      tools: this.tools,
      receiveSignal: (signal) => this.receiveSignal(signal),
      emitKernelEvent: (event) => this.#emitKernelEvent(event),
    });
    this.contextFactory = new KernelContextFactory({
      agentId: agent.id,
      policy,
      tasks: this.tasks,
      memory: this.memory,
      tools: this.tools,
      models: this.models,
      appHost: this.appHost,
      appRegistry: this.appRegistry,
      scheduler: this.scheduler,
      runtime,
      selfModel: this.selfModel,
      taskController: this.taskController,
      describeSelf: () => this.describeSelf(),
      describeConversation: (conversationId) => this.describeConversation(conversationId),
      installAppById: (appId, source) => this.installAppById(appId, source),
      uninstallApp: (appId) => this.uninstallApp(appId),
      receiveSignal: (signal) => this.receiveSignal(signal),
    });
    this.appRuntime = new KernelAppRuntime({
      policy,
      appRegistry: this.appRegistry,
      appHost: this.appHost,
      tasks: this.tasks,
      selfModel: this.selfModel,
      describeSelf: () => this.describeSelf(),
      createLifecycleContext: (app, source) => this.contextFactory.createLifecycleContext(app, source),
      createRoutingContext: (app, signal) => this.contextFactory.createRoutingContext(app, signal),
    });
    this.mailbox = new Mailbox(
      async (signal: SignalLike): Promise<void> => {
        await this.#processSignal(signal);
      },
      async (error: unknown, signal?: SignalLike): Promise<void> => {
        this.memory.setAgent('kernel:lastSignalCrash', {
          signalId: signal?.id ?? null,
          type: signal?.type ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
        this.selfModel.recordChange('signal.crashed', {
          signalId: signal?.id ?? null,
          type: signal?.type ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );

    this.selfModel.recordChange('agent.created', { agentId: agent.id });
  }

  receiveSignal(signal: SignalLike): SignalLike {
    return this.mailbox.enqueue(signal);
  }

  whenIdle(): Promise<void> {
    return this.mailbox.whenIdle();
  }

  isIdle(): boolean {
    return this.mailbox.isIdle();
  }

  observeTaskEvents(callback: TaskEventListener, options?: { taskId?: string | null }): () => void {
    return this.tasks.subscribe(callback, options);
  }

  observeKernelEvents(
    callback: KernelEventListener,
    {
      category = null,
      type = null,
    }: {
      category?: KernelObservedEvent['category'] | null;
      type?: string | null;
    } = {},
  ): () => void {
    const listener: KernelListener = { callback, category, type };
    this.#kernelListeners.add(listener);
    return () => {
      this.#kernelListeners.delete(listener);
    };
  }

  registerTool<TInput extends ProtocolValue = ProtocolValue, TOutput extends ProtocolValue = ProtocolValue>(
    tool: ToolDefinition<TInput, TOutput>,
  ): ToolDefinition<TInput, TOutput> {
    return this.tools.registerTool(tool);
  }

  async installAppById(appId: string, source = 'registry'): Promise<AppDescription | null> {
    return this.appRuntime.installAppById(appId, source);
  }

  async installAppInstance(
    app: InstalledAppLike,
    options: InstallAppInstanceOptions = {},
  ): Promise<AppDescription | null> {
    return this.appRuntime.installAppInstance(app, options);
  }

  uninstallApp(appId: string): boolean {
    return this.appRuntime.uninstallApp(appId);
  }

  describeSelf(): SelfDescription {
    return this.selfModel.describe();
  }

  snapshotMemory(): MemorySnapshot {
    return this.memory.snapshot();
  }

  findTaskBySignalId(signalId: string): TaskRecord | null {
    return this.tasks.findTaskBySignalId(signalId);
  }

  getTask(taskId: string): TaskRecord | null {
    return this.tasks.getTask(taskId);
  }

  listTaskEvents(taskId: string): TaskEventEntry[] {
    return this.tasks.listEvents(taskId);
  }

  snapshotState(): AgentStateSnapshot {
    return {
      agentId: this.agent.id,
      policy: this.policy.describe(),
      apps: this.appHost.listApps(),
      conversations: this.conversations.snapshot(),
      tasks: this.tasks.snapshot(),
      schedules: this.scheduler.snapshot(),
      timers: this.scheduler.snapshot(),
      memory: this.memory.snapshot(),
      history: this.selfModel.snapshot(),
    };
  }

  async restoreState(snapshot: AgentStateSnapshot): Promise<void> {
    for (const appRecord of snapshot.apps ?? []) {
      const app = this.appRegistry.create(appRecord.appId);
      await this.installAppInstance(app, {
        source: appRecord.source,
        installedAt: appRecord.installedAt,
        invokeOnInstall: false,
        recordHistory: false,
      });
    }

    this.memory.restore(snapshot.memory ?? {});
    this.tasks.restore(snapshot.tasks);
    this.conversations.restore(snapshot.conversations ?? []);
    this.scheduler.restore(snapshot.schedules ?? snapshot.timers ?? []);
    this.selfModel.restore(snapshot.history ?? []);
  }

  listConversations(): ConversationRecord[] {
    return this.conversations.listConversations();
  }

  describeConversation(conversationId: string | null): ConversationRecord | null {
    return this.conversations.getConversation(conversationId);
  }

  dispose(): void {
    this.#schedulerUnsubscribe?.();
    this.scheduler.dispose();
  }

  async #processSignal(signal: SignalLike): Promise<void> {
    this.conversations.recordSignal(signal);
    this.selfModel.recordChange('signal.received', {
      signalId: signal.id,
      type: signal.type,
      kind: signal.kind,
    });

    const explicitTask = signal.targetTaskId
      ? this.tasks.getTask(signal.targetTaskId)
      : null;

    if (signal.kind === 'tool' && signal.type === 'tool.call') {
      await this.taskController.handleToolCallSignal(signal, explicitTask);
      return;
    }

    const app = this.appRuntime.resolveApp(signal, explicitTask);

    if (!app) {
      this.memory.setAgent('kernel:lastUnhandledSignal', {
        id: signal.id,
        kind: signal.kind,
        type: signal.type,
      });
      this.selfModel.recordChange('signal.unhandled', {
        signalId: signal.id,
        type: signal.type,
      });
      return;
    }

    const route = await this.appRuntime.resolveTaskRoute(app, signal, explicitTask);
    if (route.action === 'ignore') {
      this.selfModel.recordChange('signal.ignored', {
        signalId: signal.id,
        appId: app.manifest.id,
      });
      return;
    }

    if (route.action === 'queue') {
      this.taskController.queueSignal(route.task, signal, route.source);
      this.selfModel.recordChange('signal.queued', {
        signalId: signal.id,
        appId: app.manifest.id,
        taskId: route.task.id,
      });
      return;
    }

    if (route.action === 'interrupt') {
      this.taskController.interruptTask(route.task, signal, route.source);
      this.selfModel.recordChange('signal.interrupted', {
        signalId: signal.id,
        appId: app.manifest.id,
        taskId: route.task.id,
      });
      return;
    }

    const existingTask = route.task;

    if (existingTask) {
      this.taskController.clearTaskTimeout(existingTask);
    }

    if (!existingTask) {
      const decision = this.policy.evaluateTaskCreation({
        activeTaskCount: this.tasks.countActiveTasks(),
      });

      if (!decision.ok) {
        this.taskController.recordPolicyDenial('task.create', decision, {
          signalId: signal.id,
          signalType: signal.type,
          appId: app.manifest.id,
        });
        return;
      }
    }

    const task = existingTask
      ? this.tasks.resumeTask(existingTask.id, signal)
      : this.tasks.createTask({ appId: app.manifest.id, signal, title: route.title ?? signal.type });
    this.tasks.recordEvent(task.id, {
      type: 'signal.received',
      signalId: signal.id,
      data: {
        signalType: signal.type,
        signalKind: signal.kind,
        from: signal.from,
        routeAction: route.action,
        routeSource: route.source,
      },
    });
    this.conversations.recordTask(task, { appId: app.manifest.id });

    try {
      const context = this.contextFactory.createExecutionContext(app, task, signal);
      await app.onSignal(context, signal);

      const latestTask = this.tasks.getTask(task.id);
      if (latestTask) {
        this.conversations.recordTask(latestTask, { appId: app.manifest.id });
      }
      if (latestTask?.status === 'running') {
        const completedTask = this.taskController.completeTask(task.id);
        this.conversations.recordTask(completedTask, { appId: app.manifest.id });
      }

      this.selfModel.recordChange('signal.handled', {
        signalId: signal.id,
        appId: app.manifest.id,
        taskId: task.id,
      });
    } catch (error) {
      const failedTask = this.taskController.failTask(task.id, error);
      this.conversations.recordTask(failedTask, { appId: app.manifest.id });
      this.selfModel.recordChange('task.failed', {
        taskId: task.id,
        appId: app.manifest.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #emitKernelEvent(event: KernelObservedEvent): void {
    for (const listener of this.#kernelListeners) {
      if (listener.category !== null && listener.category !== event.category) {
        continue;
      }

      if (listener.type !== null && listener.type !== event.type) {
        continue;
      }

      listener.callback(structuredClone(event));
    }
  }
}
