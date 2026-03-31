import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntime,
  createTextEvent,
  createTextMessage,
} from '../src/index.js';

test('createRuntime exposes an ergonomic SDK for text events and batch agent creation', async () => {
  const runtime = createRuntime();
  const { alpha, beta } = await runtime.createAgents([
    { id: 'alpha', apps: ['domain.echo'] },
    { id: 'beta', apps: ['domain.echo'] },
  ]);

  const textHandle = alpha.text<{ text?: string; kind?: string }>('hello from sdk', {
    app: 'domain.echo',
    conversationId: 'sdk-text',
  });
  const tellHandle = alpha.tell<{ text?: string; from?: string; kind?: string }>('beta', 'hello beta', {
    app: 'domain.echo',
    conversationId: 'sdk-chat',
  });

  const textResult = await textHandle.result();
  const tellResult = await tellHandle.result();
  assert.ok(textResult);
  assert.ok(tellResult);
  const betaAgent = runtime.agent('beta');
  assert.ok(betaAgent);

  assert.equal(textResult.text, 'hello from sdk');
  assert.equal(textResult.kind, 'event');
  assert.equal(tellResult.text, 'hello beta');
  assert.equal(tellResult.from, 'alpha');
  assert.equal(tellResult.kind, 'message');
  assert.equal(runtime.agent('beta'), beta);
  assert.equal((betaAgent.snapshotMemory().agent['echo:lastText'] as { text?: string }).text, 'hello beta');
  assert.equal(tellHandle.conversation()?.conversationId, 'sdk-chat');

  runtime.dispose();
});

test('text signal helpers standardize canonical text payloads', () => {
  const event = createTextEvent({
    to: 'writer',
    text: 'draft summary',
    targetAppId: 'domain.echo',
  });
  const message = createTextMessage({
    from: 'alice',
    to: 'bob',
    text: 'ping',
    targetAppId: 'domain.echo',
  });

  assert.equal(event.type, 'text');
  assert.equal(event.kind, 'event');
  assert.equal(event.payload?.text, 'draft summary');
  assert.equal(message.type, 'text');
  assert.equal(message.kind, 'message');
  assert.equal(message.payload?.text, 'ping');
});
