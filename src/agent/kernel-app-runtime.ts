import type {
  AppDescription,
  AppLike as InstalledAppLike,
  AppRouteDecision,
} from '../apps/types.js';
import type {
  AppHostLike,
  AppRegistryLike,
  LifecycleContext,
  NormalizedRouteDecision,
  PolicyLike,
  RoutingContext,
  SelfDescription,
  SelfModelLike,
  SignalLike,
  TaskRecord,
  TaskRuntimeLike,
} from './types.js';

export interface InstallAppInstanceOptions {
  source?: string;
  invokeOnInstall?: boolean;
  recordHistory?: boolean;
  installedAt?: number;
}

export class KernelAppRuntime {
  #policy: PolicyLike;
  #appRegistry: AppRegistryLike;
  #appHost: AppHostLike;
  #tasks: TaskRuntimeLike;
  #selfModel: SelfModelLike;
  #describeSelf: () => SelfDescription;
  #createLifecycleContext: (app: InstalledAppLike, source: string) => LifecycleContext;
  #createRoutingContext: (app: InstalledAppLike, signal: SignalLike) => RoutingContext;

  constructor({
    policy,
    appRegistry,
    appHost,
    tasks,
    selfModel,
    describeSelf,
    createLifecycleContext,
    createRoutingContext,
  }: {
    policy: PolicyLike;
    appRegistry: AppRegistryLike;
    appHost: AppHostLike;
    tasks: TaskRuntimeLike;
    selfModel: SelfModelLike;
    describeSelf: () => SelfDescription;
    createLifecycleContext: (app: InstalledAppLike, source: string) => LifecycleContext;
    createRoutingContext: (app: InstalledAppLike, signal: SignalLike) => RoutingContext;
  }) {
    this.#policy = policy;
    this.#appRegistry = appRegistry;
    this.#appHost = appHost;
    this.#tasks = tasks;
    this.#selfModel = selfModel;
    this.#describeSelf = describeSelf;
    this.#createLifecycleContext = createLifecycleContext;
    this.#createRoutingContext = createRoutingContext;
  }

  async installAppById(appId: string, source = 'registry'): Promise<AppDescription | null> {
    this.#policy.assertCanInstallApp(appId);

    const app = this.#appRegistry.create(appId);
    return this.installAppInstance(app, { source });
  }

  async installAppInstance(
    app: InstalledAppLike,
    {
      source = 'manual',
      invokeOnInstall = true,
      recordHistory = true,
      installedAt,
    }: InstallAppInstanceOptions = {},
  ): Promise<AppDescription | null> {
    const existing = this.#appHost.describeInstalled(app.manifest.id);
    if (existing) {
      return existing;
    }

    const description = this.#appHost.install(app, { source, installedAt });

    if (invokeOnInstall && typeof app.onInstall === 'function') {
      await app.onInstall(this.#createLifecycleContext(app, source));
    }

    if (recordHistory) {
      this.#selfModel.recordChange('app.installed', {
        appId: app.manifest.id,
        source,
      });
    }

    return description;
  }

  uninstallApp(appId: string): boolean {
    const removed = this.#appHost.uninstall(appId);

    if (removed) {
      this.#selfModel.recordChange('app.uninstalled', { appId });
    }

    return removed;
  }

  resolveApp(signal: SignalLike, task: TaskRecord | null): InstalledAppLike | null {
    if (signal.targetAppId) {
      return this.#appHost.getApp(signal.targetAppId);
    }

    if (task) {
      return task.appId ? this.#appHost.getApp(task.appId) : null;
    }

    const selfModel = this.#describeSelf();

    for (const app of this.#appHost.getAppsByPriority()) {
      try {
        if (typeof app.canHandle !== 'function' || app.canHandle(signal, selfModel)) {
          return app;
        }
      } catch (error) {
        this.#selfModel.recordChange('app.matchFailed', {
          appId: app.manifest.id,
          signalId: signal.id,
          type: signal.type,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return null;
  }

  async resolveTaskRoute(
    app: InstalledAppLike,
    signal: SignalLike,
    explicitTask: TaskRecord | null = null,
  ): Promise<NormalizedRouteDecision> {
    if (explicitTask) {
      return {
        action: 'resume',
        task: explicitTask,
        title: explicitTask.title ?? null,
        source: 'explicit-task',
      };
    }

    if (typeof app.routeSignal === 'function') {
      const decision = await app.routeSignal(this.#createRoutingContext(app, signal), signal);
      const normalized = this.#normalizeRoutingDecision(app, signal, decision);
      if (normalized) {
        return normalized;
      }
    }

    const resumableTask = this.#tasks.findResumableTask(signal, {
      appId: app.manifest.id,
    });

    if (resumableTask) {
      return {
        action: 'resume',
        task: resumableTask,
        title: resumableTask.title ?? null,
        source: 'kernel-fallback',
      };
    }

    return {
      action: 'spawn',
      task: null,
      title: signal.type,
      source: 'kernel-fallback',
    };
  }

  #normalizeRoutingDecision(
    app: InstalledAppLike,
    signal: SignalLike,
    decision: AppRouteDecision,
  ): NormalizedRouteDecision | null {
    if (decision === null || decision === undefined) {
      return null;
    }

    const normalized = typeof decision === 'string'
      ? { action: decision }
      : decision;

    if (!normalized || typeof normalized !== 'object') {
      throw new Error(`routeSignal() must return an object, string, or null for ${app.manifest.id}.`);
    }

    switch (normalized.action) {
      case 'ignore':
        return {
          action: 'ignore',
          task: null,
          title: null,
          source: 'app-router',
        };
      case 'spawn':
        return {
          action: 'spawn',
          task: null,
          title: normalized.title ?? signal.type,
          source: 'app-router',
        };
      case 'resume': {
        if (!normalized.taskId) {
          throw new Error(`routeSignal() must return taskId for resume decisions in ${app.manifest.id}.`);
        }

        const task = this.#tasks.getTask(normalized.taskId);
        if (!task) {
          throw new Error(`routeSignal() selected an unknown task: ${normalized.taskId}`);
        }

        if (task.appId !== app.manifest.id) {
          throw new Error(`routeSignal() may only route to tasks owned by ${app.manifest.id}.`);
        }

        if (['completed', 'failed', 'cancelled'].includes(task.status ?? '')) {
          throw new Error(`routeSignal() may not resume a terminal task: ${normalized.taskId}`);
        }

        return {
          action: 'resume',
          task,
          title: task.title ?? null,
          source: 'app-router',
        };
      }
      case 'queue': {
        if (!normalized.taskId) {
          throw new Error(`routeSignal() must return taskId for queue decisions in ${app.manifest.id}.`);
        }

        const task = this.#tasks.getTask(normalized.taskId);
        if (!task) {
          throw new Error(`routeSignal() selected an unknown task: ${normalized.taskId}`);
        }

        if (task.appId !== app.manifest.id) {
          throw new Error(`routeSignal() may only queue signals to tasks owned by ${app.manifest.id}.`);
        }

        if (['completed', 'failed', 'cancelled'].includes(task.status ?? '')) {
          throw new Error(`routeSignal() may not queue signals to a terminal task: ${normalized.taskId}`);
        }

        return {
          action: 'queue',
          task,
          title: task.title ?? null,
          source: 'app-router',
        };
      }
      case 'interrupt': {
        if (!normalized.taskId) {
          throw new Error(`routeSignal() must return taskId for interrupt decisions in ${app.manifest.id}.`);
        }

        const task = this.#tasks.getTask(normalized.taskId);
        if (!task) {
          throw new Error(`routeSignal() selected an unknown task: ${normalized.taskId}`);
        }

        if (task.appId !== app.manifest.id) {
          throw new Error(`routeSignal() may only interrupt tasks owned by ${app.manifest.id}.`);
        }

        if (['completed', 'failed', 'cancelled'].includes(task.status ?? '')) {
          throw new Error(`routeSignal() may not interrupt a terminal task: ${normalized.taskId}`);
        }

        return {
          action: 'interrupt',
          task,
          title: task.title ?? null,
          source: 'app-router',
        };
      }
      default:
        throw new Error(`Unsupported routeSignal action: ${normalized.action}`);
    }
  }
}
