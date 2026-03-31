# Webhook Ingress

`WebhookIngressServer` exposes a small HTTP surface that turns external HTTP requests into runtime events.

## Purpose

The webhook server is the repository's current external ingress mechanism. It lets outside systems push events into an agent without needing direct access to the runtime object.

## Endpoints

### `GET /health`

Returns:

```json
{ "ok": true }
```

This is a simple liveness probe.

### `POST <configured-path>`

Default path: `/events`

The request body must be a JSON object with:

```json
{
  "to": "assistant",
  "type": "workflow.start",
  "payload": { "note": "hello" },
  "targetAppId": "domain.workflow",
  "targetTaskId": null,
  "conversationId": "conv-123",
  "metadata": { "source": "webhook" }
}
```

Only `to` and `type` are required. `payload` and `metadata` must be objects or `null` when present.

## Authentication

If a token is configured, the server accepts either:

- `Authorization: Bearer <token>`
- `X-Agents-Token: <token>`

Without a configured token, requests are accepted without auth.

## Starting the server

Webhook ingress is an explicit runtime attachment. It is not started automatically by `createRuntime()`, `createCliRuntime()`, or session restore.

Typical setup looks like:

```js
import { WebhookIngressServer, createRuntime } from 'agents';

const runtime = createRuntime({
  sessionDir: './var/session',
});

const ingress = new WebhookIngressServer({
  runtime,
  host: '127.0.0.1',
  port: 3000,
  path: '/events',
  token: process.env.AGENTS_WEBHOOK_TOKEN ?? null,
});

await ingress.start();
```

That means ingress ownership belongs to the host application. If you want it in a local service, daemon, or test harness, you start it there and stop it there.

## Response behavior

Successful event ingestion returns HTTP `202` with:

```json
{
  "accepted": true,
  "signalId": "sig_...",
  "conversationId": "conv-123",
  "to": "assistant",
  "type": "workflow.start"
}
```

Common failure cases:

- `400` for invalid JSON or invalid field types
- `401` for missing or wrong token
- `404` for unknown routes or unknown target agents
- `500` for unexpected server-side errors

## Internal flow

The ingress server does very little business logic. It:

1. validates the HTTP request
2. validates the JSON payload shape
3. calls `runtime.ingestEvent(...)`
4. returns the accepted signal metadata

That keeps the boundary small and lets the normal runtime and kernel logic handle the event afterward.

## Example `curl`

```bash
curl -X POST http://127.0.0.1:3000/events \
  -H 'content-type: application/json' \
  -d '{
    "to": "assistant",
    "type": "workflow.start",
    "targetAppId": "domain.workflow",
    "payload": { "note": "follow up later", "reminderMs": 5000 }
  }'
```

## Best fit

Webhook ingress is a good fit for:

- local automation
- external notifications
- monitoring hooks
- test harnesses that want to drive the runtime over HTTP

It is intentionally small, but it proves the broader design point that external systems can plug into the same signal model as internal agent communication.
