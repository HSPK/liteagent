import { createId } from '../../utils/id.js';
import type { ExecutionContext, ProtocolValue, SignalLike } from '../../agent/types.js';
import type { AppDefinition, AppLike } from '../types.js';

interface TodoItem {
  id: string;
  title: string;
  details: ProtocolValue;
  status: string;
  createdAt: number;
  completedAt?: number;
}

function isTodoItem(value: unknown): value is TodoItem {
  return !!value
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { title?: unknown }).title === 'string'
    && typeof (value as { status?: unknown }).status === 'string'
    && typeof (value as { createdAt?: unknown }).createdAt === 'number';
}

export function createTodoApp(): AppLike {
  const manifest = {
    id: 'system.todo',
    kind: 'system',
    version: '0.1.0',
    title: 'Todo',
    priority: 80,
  };

  return {
    manifest,
      canHandle(signal) {
        return signal.targetAppId === manifest.id || signal.type.startsWith('todo.');
      },
      async onSignal(context, signal) {
        const storedItems = context.memory.app.get('items', []);
        const items = Array.isArray(storedItems)
          ? storedItems.filter((item): item is TodoItem => isTodoItem(item))
          : [];

      switch (signal.type) {
        case 'todo.add': {
          const id = typeof signal.payload?.id === 'string' ? signal.payload.id : createId('todo');
          const title = typeof signal.payload?.title === 'string' ? signal.payload.title : 'Untitled';
          const item = {
            id,
            title,
            details: signal.payload?.details ?? null,
            status: 'open',
            createdAt: Date.now(),
          };
          items.push(item);
          context.memory.app.set('items', items);
          context.complete(item);
          return;
        }
        case 'todo.complete': {
          const item = items.find(
            (candidate) => candidate.id === signal.payload?.id,
          );
          if (item) {
            item.status = 'done';
            item.completedAt = Date.now();
            context.memory.app.set('items', items);
          }
          context.complete(item ?? null);
          return;
        }
        case 'todo.list': {
          context.complete(items);
          return;
        }
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const todoAppDefinition = {
  manifest: {
    id: 'system.todo',
    kind: 'system',
    version: '0.1.0',
    title: 'Todo',
    priority: 80,
  },
  provenance: 'builtin',
  create: () => createTodoApp(),
} satisfies AppDefinition;
