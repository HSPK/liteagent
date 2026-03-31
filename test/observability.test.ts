import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeController } from '../src/cli/runtime-controller.js';
import type { CliEntryPatch } from '../src/cli/types.js';
import { createRuntime } from '../src/index.js';
import type { AppDefinition } from '../src/apps/types.js';

type RuntimeTaskEvent = {
  event: {
    type?: string;
  };
};

function createStreamingAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.streaming',
    kind: 'domain',
    version: '0.1.0',
    title: 'Streaming',
    priority: 80,
  };

  return {
    manifest,
    provenance: 'test',
    create: () => ({
      manifest,
      canHandle(signal) {
        return signal.type === 'text';
      },
      async onSignal(context, signal) {
        const result = await context.models.generate({
          provider: 'fake-stream',
          model: 'unit-test',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: typeof signal.payload?.text === 'string' ? signal.payload.text : '',
                },
              ],
            },
          ],
        });

        context.complete(result);
      },
    }),
  } satisfies AppDefinition;
}

test('runtime subscribeEvents exposes task lifecycle events', async () => {
  const runtime = createRuntime();
  const observed: RuntimeTaskEvent[] = [];
  const unsubscribe = runtime.subscribeEvents((event) => {
    observed.push(event as unknown as RuntimeTaskEvent);
  }, { type: 'task.event' });

  const agent = await runtime.createAgent({
    id: 'observer-agent',
    apps: ['domain.echo'],
  });

  await agent.text('observe me', {
    app: 'domain.echo',
    conversationId: 'observe-thread',
  }).result();

  unsubscribe();

  assert.ok(observed.some((event) => event.event.type === 'task.created'));
  assert.ok(observed.some((event) => event.event.type === 'signal.received'));
  assert.ok(observed.some((event) => event.event.type === 'task.completed'));

  runtime.dispose();
});

test('runtime controller emits streaming entries from model task events', async () => {
  const runtime = createRuntime({
    builtinApps: false,
    appDefinitions: [createStreamingAppDefinition()],
  });
  runtime.registerModelProvider({
    id: 'fake-stream',
    defaultModel: 'unit-test',
    async *stream() {
      yield {
        type: 'response.started',
      };
      yield {
        type: 'text.delta',
        text: 'hel',
      };
      yield {
        type: 'text.delta',
        text: 'lo',
      };
      yield {
        type: 'response.completed',
        text: 'hello',
        finishReason: 'stop',
      };
    },
  });

  const controller = new RuntimeController({ runtime });
  const emitted: CliEntryPatch[] = [];
  const unsubscribe = controller.subscribeEntries((entries) => {
    emitted.push(...entries);
  });

  await controller.createAgent('alpha', ['domain.streaming']);
  const broadcast = await controller.broadcastText('stream this');

  unsubscribe();

  assert.ok(emitted.some((entry) => entry.replaceKey?.startsWith('stream:alpha:') && entry.text === 'hello'));
  assert.ok(emitted.some((entry) => entry.removeKey?.startsWith('stream:alpha:')));
  const broadcastResult = broadcast.replies[0].result as { text?: string };
  assert.equal(broadcastResult.text, 'hello');

  controller.dispose();
});
