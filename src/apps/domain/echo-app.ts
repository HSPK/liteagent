import type { ExecutionContext, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

export function createEchoApp(): AppLike {
  const manifest = {
    id: 'domain.echo',
    kind: 'domain',
    version: '0.1.0',
    title: 'Echo',
    priority: 30,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type === 'text';
      },
      async onSignal(context, signal) {
      if (signal.type !== 'text') {
        context.complete({ ignored: signal.type });
        return;
      }

      const result = {
        text: signal.payload?.text ?? '',
        from: signal.from,
        kind: signal.kind,
        conversationId: context.conversation.id,
      };

      context.memory.agent.set('echo:lastText', result);
      context.memory.conversation.set('echo:lastText', result);
      context.complete(result);
    },
  };
}

export const echoAppDefinition = {
  manifest: {
    id: 'domain.echo',
    kind: 'domain',
    version: '0.1.0',
    title: 'Echo',
    priority: 30,
  },
  provenance: 'builtin',
  create: () => createEchoApp(),
} satisfies AppDefinition;
