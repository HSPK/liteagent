import type { ExecutionContext, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

export function createAppManagerApp(): AppLike {
  const manifest = {
    id: 'system.app-manager',
    kind: 'system',
    version: '0.1.0',
    title: 'App Manager',
    priority: 90,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('app.');
      },
      async onSignal(context, signal) {
      switch (signal.type) {
        case 'app.install': {
          const appId = typeof signal.payload?.appId === 'string' ? signal.payload.appId : null;
          if (!appId) {
            throw new Error('app.install requires payload.appId.');
          }
          const installed = await context.apps.install(appId);
          context.complete(installed);
          return;
        }
        case 'app.uninstall': {
          const appId = typeof signal.payload?.appId === 'string' ? signal.payload.appId : null;
          if (!appId) {
            throw new Error('app.uninstall requires payload.appId.');
          }
          const removed = context.apps.uninstall(appId);
          context.complete({ appId, removed });
          return;
        }
        case 'app.listAvailable': {
          context.complete(context.apps.listAvailable());
          return;
        }
        case 'app.listInstalled': {
          context.complete(context.apps.listInstalled());
          return;
        }
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const appManagerAppDefinition = {
  manifest: {
    id: 'system.app-manager',
    kind: 'system',
    version: '0.1.0',
    title: 'App Manager',
    priority: 90,
  },
  provenance: 'builtin',
  create: () => createAppManagerApp(),
} satisfies AppDefinition;
