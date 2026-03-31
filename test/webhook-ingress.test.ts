import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentsRuntime, WebhookIngressServer, registerBuiltinApps } from '../src/index.js';

test('webhook ingress accepts POST events and injects them into the runtime', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  const agent = await runtime.createAgent({
    id: 'webhook-worker',
    installedApps: ['domain.workflow'],
  });
  const ingress = new WebhookIngressServer({
    runtime,
    path: '/webhooks/runtime',
  });

  const server = await ingress.start();
  assert.ok(server.url);
  const response = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: 'webhook-worker',
      type: 'workflow.start',
      targetAppId: 'domain.workflow',
      payload: { note: 'from webhook' },
    }),
  });
  const payload = await response.json();

  await runtime.whenIdle();

  assert.equal(response.status, 202);
  assert.equal(payload.accepted, true);
  assert.equal(payload.to, 'webhook-worker');
  assert.equal((agent.snapshotMemory().agent['workflow:last'] as { note?: string }).note, 'from webhook');

  await ingress.stop();
  runtime.dispose();
});

test('webhook ingress can require a shared token', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  await runtime.createAgent({
    id: 'webhook-protected-worker',
    installedApps: ['domain.workflow'],
  });
  const ingress = new WebhookIngressServer({
    runtime,
    token: 'secret-token',
  });

  const server = await ingress.start();
  assert.ok(server.url);
  const unauthorized = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: 'webhook-protected-worker',
      type: 'workflow.start',
      targetAppId: 'domain.workflow',
    }),
  });
  const authorized = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer secret-token',
    },
    body: JSON.stringify({
      to: 'webhook-protected-worker',
      type: 'workflow.start',
      targetAppId: 'domain.workflow',
      payload: { note: 'authorized' },
    }),
  });

  await runtime.whenIdle();

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 202);

  await ingress.stop();
  runtime.dispose();
});

test('webhook ingress rejects non-object payload and metadata fields', async () => {
  const runtime = registerBuiltinApps(new AgentsRuntime());
  await runtime.createAgent({
    id: 'webhook-validated-worker',
    installedApps: ['domain.workflow'],
  });
  const ingress = new WebhookIngressServer({
    runtime,
  });

  const server = await ingress.start();
  assert.ok(server.url);

  const invalidPayload = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: 'webhook-validated-worker',
      type: 'workflow.start',
      payload: 'not-an-object',
    }),
  });
  const invalidMetadata = await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: 'webhook-validated-worker',
      type: 'workflow.start',
      metadata: ['bad'],
    }),
  });

  assert.equal(invalidPayload.status, 400);
  assert.equal(invalidMetadata.status, 400);

  await ingress.stop();
  runtime.dispose();
});
