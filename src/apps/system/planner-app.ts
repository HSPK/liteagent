import type { ExecutionContext, ProtocolRecord, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

export function createPlannerApp(): AppLike {
  const manifest = {
    id: 'system.planner',
    kind: 'system',
    version: '0.1.0',
    title: 'Planner',
    priority: 50,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('planner.');
      },
      async onSignal(context, signal) {
      switch (signal.type) {
        case 'planner.plan': {
          const steps = Array.isArray(signal.payload?.steps)
            ? signal.payload.steps
            : Array.isArray(signal.payload?.items)
              ? signal.payload.items
              : [];
          for (const step of steps) {
            const normalized: ProtocolRecord = typeof step === 'string'
              ? { title: step }
              : step && typeof step === 'object'
                ? step as ProtocolRecord
                : { title: String(step) };
            context.signals.emitToSelf({
              type: 'todo.add',
              targetAppId: 'system.todo',
              payload: normalized,
            });
          }
          context.complete({ createdTodos: steps.length });
          return;
        }
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const plannerAppDefinition = {
  manifest: {
    id: 'system.planner',
    kind: 'system',
    version: '0.1.0',
    title: 'Planner',
    priority: 50,
  },
  provenance: 'builtin',
  create: () => createPlannerApp(),
} satisfies AppDefinition;
