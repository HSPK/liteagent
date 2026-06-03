import type { ExecutionContext, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

export const ORCHESTRATOR_APP_ID = 'system.orchestrator';

/**
 * A lightweight app used by the `.liteagents/` loader so that orchestrated
 * agents can receive runtime-driven signals such as heartbeat alarms.
 *
 * It keeps the MVP intentionally small: it records the latest heartbeat (and a
 * running count) plus the last non-heartbeat signal in agent memory, which makes
 * the orchestration observable and testable without an LLM in the loop.
 */
export function createOrchestratorApp(): AppLike {
  const manifest = {
    id: ORCHESTRATOR_APP_ID,
    kind: 'system',
    version: '0.1.0',
    title: 'Orchestrator',
    priority: 20,
  };

  return {
    manifest,
    canHandle(signal: SignalLike) {
      return signal.targetAppId === manifest.id
        || signal.type === 'heartbeat'
        || signal.type === 'orchestrator.notify';
    },
    async onSignal(context: ExecutionContext, signal: SignalLike) {
      if (signal.type === 'heartbeat') {
        const previous = Number(context.memory.agent.get('orchestrator:heartbeatCount') ?? 0);
        const count = previous + 1;
        const beat = {
          count,
          at: signal.createdAt ?? Date.now(),
          source: signal.from ?? 'runtime',
        };

        context.memory.agent.set('orchestrator:heartbeatCount', count);
        context.memory.agent.set('orchestrator:lastHeartbeat', beat);
        context.complete(beat);
        return;
      }

      const record = {
        type: signal.type,
        from: signal.from,
        payload: signal.payload ?? null,
      };
      context.memory.agent.set('orchestrator:lastSignal', record);
      context.complete(record);
    },
  };
}

export const orchestratorAppDefinition = {
  manifest: {
    id: ORCHESTRATOR_APP_ID,
    kind: 'system',
    version: '0.1.0',
    title: 'Orchestrator',
    priority: 20,
  },
  provenance: 'builtin',
  create: () => createOrchestratorApp(),
} satisfies AppDefinition;
