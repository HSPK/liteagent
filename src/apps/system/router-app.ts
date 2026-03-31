import type {
  ExecutionContext,
  MemoryScopeApi,
  ProtocolRecord,
  ProtocolValue,
  SignalLike,
} from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

interface RouterRule {
  id: string;
  when: ProtocolRecord;
  route: ProtocolValue;
}

function isRouterRule(value: unknown): value is RouterRule {
  return !!value
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && !!(value as { when?: unknown }).when
    && typeof (value as { when?: unknown }).when === 'object';
}

function normalizeRule(rule: ProtocolRecord | null | undefined, index: number): RouterRule {
  return {
    id: typeof rule?.id === 'string' ? rule.id : `rule-${index + 1}`,
    when: rule?.when && typeof rule.when === 'object'
      ? structuredClone(rule.when as ProtocolRecord)
      : {},
    route: rule?.route ?? null,
  };
}

function matchesRule(rule: RouterRule, payload: ProtocolRecord | null | undefined): boolean {
  return Object.entries(rule.when).every(([key, expected]) => payload?.[key] === expected);
}

function clearConversationState(memory: MemoryScopeApi): void {
  memory.delete('router:turnCount');
  memory.delete('router:lastRoute');
  memory.delete('router:lastRuleId');
  memory.delete('router:lastInput');
}

export function createRouterApp(): AppLike {
  const manifest = {
    id: 'system.router',
    kind: 'system',
    version: '0.1.0',
    title: 'Router',
    priority: 60,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('router.');
      },
      async onSignal(context, signal) {
        switch (signal.type) {
          case 'router.configure': {
            const rules = Array.isArray(signal.payload?.rules)
              ? signal.payload.rules.map(
                (rule, index) => normalizeRule(rule as ProtocolRecord, index),
              )
              : [];
          const defaultRoute = signal.payload?.defaultRoute ?? null;

          context.memory.app.set('rules', rules);
          context.memory.app.set('defaultRoute', defaultRoute);

          context.complete({
            status: 'configured',
            ruleCount: rules.length,
            defaultRoute,
          });
          return;
        }
        case 'router.route': {
          const storedRules = context.memory.app.get('rules', []);
          const rules = Array.isArray(storedRules)
            ? storedRules.filter((rule): rule is RouterRule => isRouterRule(rule))
            : [];
          const defaultRoute = context.memory.app.get('defaultRoute', null);
          const matchedRule = rules.find(
            (rule) => matchesRule(rule, signal.payload),
          );
          const route = matchedRule?.route ?? defaultRoute;
          const previousTurnCount = context.memory.conversation.get('router:turnCount', 0);
          const turnCount = typeof previousTurnCount === 'number' ? previousTurnCount + 1 : 1;

          context.memory.conversation.set('router:turnCount', turnCount);
          context.memory.conversation.set('router:lastRoute', route);
          context.memory.conversation.set('router:lastRuleId', matchedRule?.id ?? null);
          context.memory.conversation.set('router:lastInput', signal.payload ?? null);

          context.complete({
            route,
            ruleId: matchedRule?.id ?? null,
            turnCount,
            conversationId: context.conversation.id,
          });
          return;
        }
        case 'router.resetConversation': {
          clearConversationState(context.memory.conversation);
          context.complete({
            conversationId: context.conversation.id,
            cleared: true,
          });
          return;
        }
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const routerAppDefinition = {
  manifest: {
    id: 'system.router',
    kind: 'system',
    version: '0.1.0',
    title: 'Router',
    priority: 60,
  },
  provenance: 'builtin',
  create: () => createRouterApp(),
} satisfies AppDefinition;
