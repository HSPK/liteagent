import type { ExecutionContext, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

export function createWorkflowApp(): AppLike {
  const manifest = {
    id: 'domain.workflow',
    kind: 'domain',
    version: '0.1.0',
    title: 'Workflow',
    priority: 40,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('workflow.');
      },
      async onSignal(context, signal) {
      switch (signal.type) {
        case 'workflow.start': {
          const note = signal.payload?.note ?? null;
          const reminderMs = typeof signal.payload?.reminderMs === 'number'
            ? signal.payload.reminderMs
            : null;

          context.memory.agent.set('workflow:last', {
            status: reminderMs ? 'waiting' : 'completed',
            note,
          });

          if (reminderMs) {
            context.memory.task.set('workflow:note', note);
            context.timers.delay({
              type: 'workflow.reminder',
              payload: { note },
              delayMs: reminderMs,
            });
            context.wait('waiting for workflow reminder');
            return;
          }

          context.complete({ status: 'completed', note });
          return;
        }
        case 'workflow.reminder': {
          const note = context.memory.task.get('workflow:note', signal.payload?.note ?? null);
          context.memory.agent.set('workflow:last', {
            status: 'reminded',
            note,
          });
          context.complete({ status: 'reminded', note });
          return;
        }
        case 'workflow.ping': {
          if (signal.from) {
            context.signals.sendMessage({
              to: signal.from,
              type: 'workflow.pong',
              targetAppId: manifest.id,
              payload: {
                from: context.agentId,
                note: signal.payload?.note ?? null,
              },
            });
          }
          context.complete({ status: 'pong-sent' });
          return;
        }
        case 'workflow.pong': {
          context.memory.agent.set('workflow:lastMessage', signal.payload);
          context.complete({ status: 'pong-received', payload: signal.payload });
          return;
        }
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const workflowAppDefinition = {
  manifest: {
    id: 'domain.workflow',
    kind: 'domain',
    version: '0.1.0',
    title: 'Workflow',
    priority: 40,
  },
  provenance: 'builtin',
  create: () => createWorkflowApp(),
} satisfies AppDefinition;
