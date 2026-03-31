import type { AppDescription, AppInstallRecord, AppLike, PolicyLike } from './types.js';

export class AppHost {
  #policy: PolicyLike;
  #installed = new Map<string, AppInstallRecord>();
  #priorityCache: AppLike[] | null = null;

  constructor(policy: PolicyLike) {
    this.#policy = policy;
  }

  install(app: AppLike, { source = 'manual', installedAt = Date.now() }: { source?: string; installedAt?: number } = {}): AppDescription | null {
    const manifest = app?.manifest;

    if (!manifest?.id || typeof app.onSignal !== 'function') {
      throw new Error('Apps must expose manifest.id and onSignal().');
    }

    this.#policy.assertCanHostApp(manifest.id);

    if (!this.#installed.has(manifest.id)) {
      this.#installed.set(manifest.id, {
        app,
        source,
        installedAt,
      });
      this.#priorityCache = null;
    }

    return this.describeInstalled(manifest.id);
  }

  uninstall(appId: string): boolean {
    const removed = this.#installed.delete(appId);
    if (removed) {
      this.#priorityCache = null;
    }

    return removed;
  }

  getApp(appId: string): AppLike | null {
    return this.#installed.get(appId)?.app ?? null;
  }

  listApps(): AppDescription[] {
    return Array.from(this.#installed.entries())
      .map(([appId, record]) => ({
        appId,
        source: record.source,
        installedAt: record.installedAt,
        manifest: structuredClone(record.app.manifest),
      }))
      .sort((left, right) => left.appId.localeCompare(right.appId));
  }

  getAppsByPriority(): AppLike[] {
    if (this.#priorityCache === null) {
      this.#priorityCache = Array.from(this.#installed.values())
        .map((record) => record.app)
        .sort(
          (left, right) =>
            (right.manifest.priority ?? 0) - (left.manifest.priority ?? 0),
        );
    }

    return [...this.#priorityCache];
  }

  describeInstalled(appId: string): AppDescription | null {
    const record = this.#installed.get(appId);

    if (!record) {
      return null;
    }

    return {
      appId,
      source: record.source,
      installedAt: record.installedAt,
      manifest: structuredClone(record.app.manifest),
    };
  }
}
