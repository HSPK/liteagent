import type { PolicyDescription, PolicyLike, UnknownRecord } from '../../agent/types.js';

interface PolicyDecisionDetails extends UnknownRecord {
  activeTaskCount?: number;
  maxActiveTasks?: number | null;
  activeScheduleCount?: number;
  maxActiveSchedules?: number | null;
  recurring?: boolean;
  intervalMs?: number | null;
  minScheduleIntervalMs?: number | null;
  system?: boolean;
}

interface PolicyDecision {
  ok: boolean;
  reason: string | null;
  details: PolicyDecisionDetails;
}

function toNullableSet(values: string[] | null | undefined): Set<string> | null {
  return Array.isArray(values) ? new Set(values) : null;
}

function normalizeNullableInteger(value: number | null | undefined, name: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer or null.`);
  }

  return value;
}

function normalizeNullableNumber(value: number | null | undefined, name: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number or null.`);
  }

  return value;
}

function describeSet(values: Set<string> | null): string[] | null {
  return values ? Array.from(values).sort() : null;
}

function createDecision(ok: boolean, reason: string | null = null, details: PolicyDecisionDetails = {}): PolicyDecision {
  return {
    ok,
    reason,
    details: structuredClone(details) as PolicyDecisionDetails,
  };
}

export class AgentPolicy implements PolicyLike {
  allowedTools: Set<string> | null;
  allowedModelProviders: Set<string> | null;
  allowedApps: Set<string> | null;
  installableApps: Set<string> | null;
  allowAppInstallation: boolean;
  maxActiveTasks: number | null;
  maxActiveSchedules: number | null;
  allowRecurringSchedules: boolean;
  minScheduleIntervalMs: number | null;

  constructor({
    allowedTools = null,
    allowedModelProviders = null,
    allowedApps = null,
    installableApps = null,
    allowAppInstallation = true,
    maxActiveTasks = null,
    maxActiveSchedules = null,
    allowRecurringSchedules = true,
    minScheduleIntervalMs = null,
  }: {
    allowedTools?: string[] | null;
    allowedModelProviders?: string[] | null;
    allowedApps?: string[] | null;
    installableApps?: string[] | null;
    allowAppInstallation?: boolean;
    maxActiveTasks?: number | null;
    maxActiveSchedules?: number | null;
    allowRecurringSchedules?: boolean;
    minScheduleIntervalMs?: number | null;
  } = {}) {
    this.allowedTools = toNullableSet(allowedTools);
    this.allowedModelProviders = toNullableSet(allowedModelProviders);
    this.allowedApps = toNullableSet(allowedApps);
    this.installableApps = toNullableSet(installableApps);
    this.allowAppInstallation = allowAppInstallation;
    this.maxActiveTasks = normalizeNullableInteger(maxActiveTasks, 'maxActiveTasks');
    this.maxActiveSchedules = normalizeNullableInteger(maxActiveSchedules, 'maxActiveSchedules');
    this.allowRecurringSchedules = Boolean(allowRecurringSchedules);
    this.minScheduleIntervalMs = normalizeNullableNumber(minScheduleIntervalMs, 'minScheduleIntervalMs');
  }

  canUseTool(toolName: string): boolean {
    return this.allowedTools === null || this.allowedTools.has(toolName);
  }

  assertCanUseTool(toolName: string): void {
    if (!this.canUseTool(toolName)) {
      throw new Error(`Tool is not allowed by policy: ${toolName}`);
    }
  }

  canUseModel(providerId: string): boolean {
    return this.allowedModelProviders === null || this.allowedModelProviders.has(providerId);
  }

  assertCanUseModel(providerId: string): void {
    if (!this.canUseModel(providerId)) {
      throw new Error(`Model provider is not allowed by policy: ${providerId}`);
    }
  }

  canHostApp(appId: string): boolean {
    return this.allowedApps === null || this.allowedApps.has(appId);
  }

  assertCanHostApp(appId: string): void {
    if (!this.canHostApp(appId)) {
      throw new Error(`App is not allowed by policy: ${appId}`);
    }
  }

  canInstallApp(appId: string): boolean {
    if (!this.allowAppInstallation) {
      return false;
    }

    if (this.installableApps !== null) {
      return this.installableApps.has(appId);
    }

    return this.canHostApp(appId);
  }

  assertCanInstallApp(appId: string): void {
    if (!this.allowAppInstallation) {
      throw new Error(`App installation is not allowed by policy: ${appId}`);
    }

    if (!this.canInstallApp(appId)) {
      throw new Error(`App is not installable by policy: ${appId}`);
    }
  }

  evaluateTaskCreation({ activeTaskCount = 0 }: { activeTaskCount?: number } = {}): PolicyDecision {
    if (this.maxActiveTasks !== null && activeTaskCount >= this.maxActiveTasks) {
      return createDecision(false, 'max-active-tasks-exceeded', {
        activeTaskCount,
        maxActiveTasks: this.maxActiveTasks,
      });
    }

    return createDecision(true, null, {
      activeTaskCount,
      maxActiveTasks: this.maxActiveTasks,
    });
  }

  canCreateTask(context: { activeTaskCount?: number } = {}): boolean {
    return this.evaluateTaskCreation(context).ok;
  }

  assertCanCreateTask(context: { activeTaskCount?: number } = {}): void {
    const decision = this.evaluateTaskCreation(context);
    if (!decision.ok) {
      throw new Error(
        `Task creation is not allowed by policy: ${decision.reason} (${decision.details.activeTaskCount}/${decision.details.maxActiveTasks})`,
      );
    }
  }

  evaluateSchedule({
    recurring = false,
    intervalMs = null,
    activeScheduleCount = 0,
    system = false,
  }: {
    recurring?: boolean;
    intervalMs?: number | null;
    activeScheduleCount?: number;
    system?: boolean;
  } = {}): PolicyDecision {
    if (!system && this.maxActiveSchedules !== null && activeScheduleCount >= this.maxActiveSchedules) {
      return createDecision(false, 'max-active-schedules-exceeded', {
        activeScheduleCount,
        maxActiveSchedules: this.maxActiveSchedules,
      });
    }

    if (!system && recurring && !this.allowRecurringSchedules) {
      return createDecision(false, 'recurring-schedules-disabled', {
        recurring,
        system,
      });
    }

    if (
      !system
      && recurring
      && this.minScheduleIntervalMs !== null
      && intervalMs !== null
      && intervalMs < this.minScheduleIntervalMs
    ) {
      return createDecision(false, 'schedule-interval-too-small', {
        intervalMs,
        minScheduleIntervalMs: this.minScheduleIntervalMs,
        system,
      });
    }

    return createDecision(true, null, {
      recurring,
      intervalMs,
      activeScheduleCount,
      maxActiveSchedules: this.maxActiveSchedules,
      system,
    });
  }

  canSchedule(context: {
    recurring?: boolean;
    intervalMs?: number | null;
    activeScheduleCount?: number;
    system?: boolean;
  } = {}): boolean {
    return this.evaluateSchedule(context).ok;
  }

  assertCanSchedule(context: {
    recurring?: boolean;
    intervalMs?: number | null;
    activeScheduleCount?: number;
    system?: boolean;
  } = {}): void {
    const decision = this.evaluateSchedule(context);
    if (!decision.ok) {
      switch (decision.reason) {
        case 'max-active-schedules-exceeded':
          throw new Error(
            `Schedule is not allowed by policy: ${decision.reason} (${decision.details.activeScheduleCount}/${decision.details.maxActiveSchedules})`,
          );
        case 'schedule-interval-too-small':
          throw new Error(
            `Schedule is not allowed by policy: ${decision.reason} (${decision.details.intervalMs}ms < ${decision.details.minScheduleIntervalMs}ms)`,
          );
        default:
          throw new Error(`Schedule is not allowed by policy: ${decision.reason}`);
      }
    }
  }

  describe(): PolicyDescription {
    return {
      allowedTools: describeSet(this.allowedTools),
      allowedModelProviders: describeSet(this.allowedModelProviders),
      allowedApps: describeSet(this.allowedApps),
      installableApps: describeSet(this.installableApps),
      allowAppInstallation: this.allowAppInstallation,
      maxActiveTasks: this.maxActiveTasks,
      maxActiveSchedules: this.maxActiveSchedules,
      allowRecurringSchedules: this.allowRecurringSchedules,
      minScheduleIntervalMs: this.minScheduleIntervalMs,
    };
  }
}
