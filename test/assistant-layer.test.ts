import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  RuntimeController,
  createDefaultRuntimeTools,
  createRuntime,
} from '../src/index.js';
import type {
  AssistantReplyPayload,
  AssistantTranscriptTurn,
} from '../src/apps/types.js';
import type { CliEntryPatch } from '../src/cli/types.js';

type RuntimeLike = ReturnType<typeof createRuntime>;
type PublishedSignalEvent = {
  signal?: {
    type?: string;
    kind?: string;
    payload?: { text?: string };
  };
};
type AssistantConversationMemory = Record<string, unknown> & {
  'assistant:lastReply'?: AssistantReplyPayload;
  'assistant:transcript'?: AssistantTranscriptTurn[];
};

function registerFakeAssistantProvider(runtime: RuntimeLike, {
  providerId = 'fake-assistant',
  model = 'unit-test',
  text = 'Hello from assistant',
}: {
  providerId?: string;
  model?: string;
  text?: string;
} = {}) {
  runtime.registerModelProvider({
    id: providerId,
    defaultModel: model,
    supportsTools: true,
    async *stream() {
      yield {
        type: 'text.delta',
        text,
      };
      yield {
        type: 'response.completed',
        text,
        finishReason: 'stop',
        message: {
          role: 'assistant',
          content: text,
        },
      };
    },
  });
}

test('builtin assistant app publishes reply signals and persists transcript in conversation memory', async () => {
  const runtime = createRuntime();
  registerFakeAssistantProvider(runtime);

  const publishedSignals: PublishedSignalEvent[] = [];
  runtime.subscribeEvents((event) => {
    publishedSignals.push(event as PublishedSignalEvent);
  }, { type: 'signal.published' });

  const agent = await runtime.createAgent({
    id: 'assistant-worker',
    installedApps: ['domain.assistant'],
  });

  const result = await agent.text<{ text?: string } | null>('hello assistant', {
    app: 'domain.assistant',
    conversationId: 'assistant-thread',
  }).result();

  assert.ok(result);
  assert.equal(result.text, 'Hello from assistant');
  const replyEvent = publishedSignals.find((event) => event.signal?.type === 'assistant.reply');
  assert.ok(replyEvent?.signal);
  assert.equal(replyEvent.signal.kind, 'reply');
  assert.equal(replyEvent.signal.payload?.text, 'Hello from assistant');

  const memory = agent.snapshotMemory();
  assert.ok(memory.conversations);
  const assistantMemory = memory.conversations['assistant-thread'] as AssistantConversationMemory;
  const lastReply = assistantMemory['assistant:lastReply'];
  const transcript = assistantMemory['assistant:transcript'];
  assert.equal(lastReply?.text, 'Hello from assistant');
  assert.ok(transcript);
  assert.deepEqual(
    transcript.map((entry) => entry.role),
    ['user', 'assistant'],
  );

  runtime.dispose();
});

test('session-backed runtime writes runtime config, agent snapshots, and default tools into the session directory', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'agents-session-'));
  const runtime = createRuntime({
    sessionDir,
    runtimeConfig: {
      label: 'assistant-session-test',
    },
    defaultInstalledApps: ['domain.assistant'],
    defaultTools: createDefaultRuntimeTools({
      workspaceDir: sessionDir,
    }),
  });
  registerFakeAssistantProvider(runtime, {
    text: 'Persisted assistant reply',
  });

  const agent = await runtime.createAgent({
    id: 'persisted-assistant',
  });

  const self = agent.describeSelf();
  assert.ok((self.tools ?? []).some((tool) => tool.name === 'file.read'));
  assert.ok((self.apps ?? []).some((entry) => entry.appId === 'domain.assistant'));

  await agent.text('persist me', {
    app: 'domain.assistant',
    conversationId: 'persist-thread',
  }).result();
  await runtime.saveState();

  const runtimeConfig = JSON.parse(await readFile(join(sessionDir, 'runtime', 'config.json'), 'utf8'));
  const runtimeState = JSON.parse(await readFile(join(sessionDir, 'runtime', 'state.json'), 'utf8'));
  const agentSnapshot = JSON.parse(await readFile(join(sessionDir, 'agents', 'persisted-assistant.json'), 'utf8'));

  assert.equal(runtimeConfig.label, 'assistant-session-test');
  assert.equal(runtimeState.agents.length, 1);
  assert.equal(agentSnapshot.agentId, 'persisted-assistant');
  assert.equal(
    agentSnapshot.memory.conversations['persist-thread']['assistant:lastReply'].text,
    'Persisted assistant reply',
  );

  runtime.dispose();
  await sleep(25);
  await rm(sessionDir, { recursive: true, force: true });
});

test('runtime controller can bootstrap a default assistant agent and surface reply entries for the CLI', async () => {
  const runtime = createRuntime({
    defaultInstalledApps: ['domain.assistant'],
  });
  registerFakeAssistantProvider(runtime, {
    text: 'Hi from the default assistant',
  });

  const controller = new RuntimeController({
    runtime,
    bootstrapAssistant: true,
  });
  const entries: CliEntryPatch[] = [];
  controller.subscribeEntries((nextEntries) => {
    entries.push(...nextEntries);
  });

  await controller.initialize();

  assert.ok(controller.listAgents().some((entry) => entry.agentId === 'assistant'));

  const chat = await controller.chatText('hello from cli', {
    conversationId: 'cli-thread',
  });

  assert.equal(chat.replies.length, 1);
  assert.equal(chat.replies[0].agentId, 'assistant');
  const chatReply = chat.replies[0].result as { text?: string };
  assert.equal(chatReply.text, 'Hi from the default assistant');
  assert.equal(chat.replies[0].renderedBySubscription, true);
  assert.ok(entries.some((entry) => entry.kind === 'agent' && entry.author === 'assistant' && entry.text === 'Hi from the default assistant'));

  runtime.dispose();
});

test('runtime controller submitText dispatches assistant chat without waiting for the final result', async () => {
  const runtime = createRuntime({
    defaultInstalledApps: ['domain.assistant'],
  });
  registerFakeAssistantProvider(runtime, {
    text: 'submitted reply',
  });

  const controller = new RuntimeController({
    runtime,
    bootstrapAssistant: true,
  });

  await controller.initialize();

  const submission = await controller.submitText('hello submit', {
    conversationId: 'submit-thread',
  });

  assert.equal(submission.conversationId, 'submit-thread');
  assert.equal(submission.handles.length, 1);
  assert.equal(submission.handles[0].agentId, 'assistant');

  await controller.waitForIdle();
  const task = submission.handles[0].handle.task();
  const taskResult = (task?.result ?? null) as { text?: string } | null;

  assert.equal(taskResult?.text, 'submitted reply');

  runtime.dispose();
});
