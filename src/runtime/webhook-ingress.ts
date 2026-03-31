import { createServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { UnknownRecord } from '../agent/types.js';
import type { WebhookAcceptedResponse, WebhookEventRequest } from './types.js';

interface WebhookRuntimeLike {
  ingestEvent(input: {
    to: string;
    type: string;
    payload?: UnknownRecord | null;
    targetAppId?: string | null;
    targetTaskId?: string | null;
    conversationId?: string | null;
    metadata?: UnknownRecord;
  }): {
    id: string;
    conversationId?: string | null;
    to: string;
    type: string;
  };
}

interface WebhookServerDescription {
  running: boolean;
  host: string;
  port: number;
  path: string;
  url: string | null;
}

class HttpError extends Error {
  statusCode;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readJsonBody(request: IncomingMessage): Promise<UnknownRecord> {
  return new Promise<UnknownRecord>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      try {
        const body = chunks.length === 0 ? '{}' : Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body) as UnknownRecord);
      } catch (error) {
        reject(new HttpError(400, 'Invalid JSON request body.'));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: object): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function assertWebhookObjectField(
  value: unknown,
  fieldName: 'payload' | 'metadata',
): asserts value is UnknownRecord | null | undefined {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `Webhook field "${fieldName}" must be a JSON object or null.`);
  }
}

function matchesToken(request: IncomingMessage, token: string | null): boolean {
  if (!token) {
    return true;
  }

  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const headerToken = Array.isArray(request.headers['x-agents-token'])
    ? request.headers['x-agents-token'][0]
    : request.headers['x-agents-token'];

  return authorization === `Bearer ${token}` || headerToken === token;
}

function validateEventBody(body: unknown): asserts body is WebhookEventRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Webhook request body must be a JSON object.');
  }

  const eventBody = body as Partial<WebhookEventRequest>;

  if (typeof eventBody.to !== 'string' || eventBody.to.length === 0) {
    throw new HttpError(400, 'Webhook event requires a target agent in "to".');
  }

  if (typeof eventBody.type !== 'string' || eventBody.type.length === 0) {
    throw new HttpError(400, 'Webhook event requires a signal type in "type".');
  }

  if (eventBody.targetAppId !== undefined && eventBody.targetAppId !== null && typeof eventBody.targetAppId !== 'string') {
    throw new HttpError(400, 'Webhook field "targetAppId" must be a string or null.');
  }

  if (eventBody.targetTaskId !== undefined && eventBody.targetTaskId !== null && typeof eventBody.targetTaskId !== 'string') {
    throw new HttpError(400, 'Webhook field "targetTaskId" must be a string or null.');
  }

  if (eventBody.conversationId !== undefined && eventBody.conversationId !== null && typeof eventBody.conversationId !== 'string') {
    throw new HttpError(400, 'Webhook field "conversationId" must be a string or null.');
  }

  assertWebhookObjectField(eventBody.payload, 'payload');
  assertWebhookObjectField(eventBody.metadata, 'metadata');
}

function mapHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof Error && error.message.startsWith('Unknown target agent: ')) {
    return new HttpError(404, error.message);
  }

  return new HttpError(500, error instanceof Error ? error.message : String(error));
}

export class WebhookIngressServer {
  #runtime: WebhookRuntimeLike;
  #host: string;
  #port: number;
  #path: string;
  #token: string | null;
  #server: HttpServer | null = null;

  constructor({
    runtime,
    host = '127.0.0.1',
    port = 0,
    path = '/events',
    token = null,
  }: {
    runtime: WebhookRuntimeLike;
    host?: string;
    port?: number;
    path?: string;
    token?: string | null;
  }) {
    if (!runtime) {
      throw new Error('WebhookIngressServer requires a runtime.');
    }

    this.#runtime = runtime;
    this.#host = host;
    this.#port = port;
    this.#path = path;
    this.#token = token;
  }

  async start(): Promise<WebhookServerDescription> {
    if (this.#server) {
      return this.describe();
    }

    this.#server = createServer(async (request, response) => {
      try {
        await this.#handleRequest(request, response);
      } catch (error) {
        const mapped = mapHttpError(error);
        writeJson(response, mapped.statusCode, {
          error: mapped.message,
        });
      }
    });

    const server = this.#server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#port, this.#host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    return this.describe();
  }

  async stop(): Promise<void> {
    if (!this.#server) {
      return;
    }

    const server = this.#server;
    this.#server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  describe(): WebhookServerDescription {
    if (!this.#server) {
      return {
        running: false,
        host: this.#host,
        port: this.#port,
        path: this.#path,
        url: null,
      };
    }

    const address = this.#server.address();
    const port = typeof address === 'object' && address ? address.port : this.#port;

    return {
      running: true,
      host: this.#host,
      port,
      path: this.#path,
      url: `http://${this.#host}:${port}${this.#path}`,
    };
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? this.#host}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== 'POST' || url.pathname !== this.#path) {
      writeJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (!matchesToken(request, this.#token)) {
      writeJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    const body = await readJsonBody(request);
    validateEventBody(body);
    const signal = this.#runtime.ingestEvent({
      to: body.to,
      type: body.type,
      payload: body.payload ?? null,
      targetAppId: body.targetAppId ?? null,
      targetTaskId: body.targetTaskId ?? null,
      conversationId: body.conversationId ?? null,
      metadata: body.metadata ?? {},
    });

    const accepted: WebhookAcceptedResponse = {
      accepted: true,
      signalId: signal.id,
      conversationId: signal.conversationId,
      to: signal.to,
      type: signal.type,
    };
    writeJson(response, 202, accepted);
  }
}
