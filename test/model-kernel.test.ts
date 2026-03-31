import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenAICompatibleProvider,
  createRuntime,
} from '../src/index.js';
import type { AppDefinition } from '../src/apps/types.js';

type ProviderSummary = {
  id?: string;
};

type RequestCapture = {
  headers: Record<string, string>;
  body: {
    stream?: boolean;
    tools?: Array<{ function: { name?: string } }>;
    messages?: Array<{
      content?: Array<{
        type?: string;
        image_url?: { url?: string };
      }>;
    }>;
  };
};

type StreamEvent = {
  type?: string;
  text?: string;
  toolCalls?: Array<{ id?: string | null; name?: string; arguments?: string }>;
  finishReason?: string;
};

function createModelInspectorAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.model-inspector',
    kind: 'domain',
    version: '0.1.0',
    title: 'Model Inspector',
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
      async onSignal(context) {
        const selfModel = context.self.describe() as { models?: unknown[] };
        context.complete({
          providers: context.models.list(),
          selfModels: selfModel.models ?? [],
        });
      },
    }),
  } satisfies AppDefinition;
}

function createToolCallingAppDefinition(): AppDefinition {
  const manifest = {
    id: 'domain.tool-caller',
    kind: 'domain',
    version: '0.1.0',
    title: 'Tool Caller',
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
        const result = await context.models.run({
          provider: 'fake-tools',
          model: 'unit-test',
          tools: true,
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

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
      },
    },
  );
}

test('kernel model access respects provider policy and surfaces providers in self model', async () => {
  const runtime = createRuntime({
    appDefinitions: [createModelInspectorAppDefinition()],
  });

  runtime.registerModelProvider({
    id: 'allowed-provider',
    defaultModel: 'allowed-model',
    async *stream() {
      yield {
        type: 'response.completed',
        text: 'ok',
      };
    },
  });
  runtime.registerModelProvider({
    id: 'blocked-provider',
    defaultModel: 'blocked-model',
    async *stream() {
      yield {
        type: 'response.completed',
        text: 'blocked',
      };
    },
  });

  const agent = await runtime.createAgent({
    id: 'inspector',
    policy: {
      allowedModelProviders: ['allowed-provider'],
    },
    apps: ['domain.model-inspector'],
  });

  const result = await agent.text('list providers', {
    app: 'domain.model-inspector',
    conversationId: 'model-inspector',
  }).result();
  assert.ok(result);
  const providerResult = result as {
    providers?: ProviderSummary[];
    selfModels?: ProviderSummary[];
  };

  assert.deepEqual(
    (providerResult.providers ?? []).map((provider) => provider.id),
    ['allowed-provider'],
  );
  assert.deepEqual(
    (providerResult.selfModels ?? []).map((provider) => provider.id),
    ['allowed-provider'],
  );

  runtime.dispose();
});

test('models.run executes tool calls against kernel tools and returns a final assistant answer', async () => {
  const runtime = createRuntime({
    appDefinitions: [createToolCallingAppDefinition()],
  });

  runtime.registerModelProvider({
    id: 'fake-tools',
    defaultModel: 'unit-test',
    supportsTools: true,
    async *stream(request) {
      const normalizedRequest = request as { messages?: Array<{ role?: string }> };
      const hasToolResult = (normalizedRequest.messages ?? []).some((message) => message.role === 'tool');

      if (!hasToolResult) {
        yield {
          type: 'response.completed',
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'call_weather',
              name: 'lookupWeather',
              arguments: JSON.stringify({ city: 'Paris' }),
            },
          ],
        };
        return;
      }

      yield {
        type: 'text.delta',
        text: 'Forecast: sunny',
      };
      yield {
        type: 'response.completed',
        text: 'Forecast: sunny',
        finishReason: 'stop',
      };
    },
  });

  const agent = await runtime.createAgent({
    id: 'tool-runner',
    policy: {
      allowedModelProviders: ['fake-tools'],
    },
    apps: ['domain.tool-caller'],
  });

  let receivedToolInput: { city?: string } | null = null;
  agent.registerTool({
    name: 'lookupWeather',
    description: 'Lookup the weather for a city.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
      additionalProperties: false,
    },
    async execute(input: { city: string }) {
      receivedToolInput = input;
      return {
        city: input.city,
        forecast: 'sunny',
      };
    },
  });

  const result = await agent.text('What is the weather in Paris?', {
    app: 'domain.tool-caller',
    conversationId: 'tool-calling',
  }).result();
  assert.ok(result);
  const toolResult = result as {
    text?: string;
    toolResults?: Array<{ ok?: boolean; output?: { forecast?: string } }>;
    messages?: Array<{ role?: string }>;
  };

  assert.deepEqual(receivedToolInput, { city: 'Paris' });
  assert.equal(toolResult.text, 'Forecast: sunny');
  assert.equal(toolResult.toolResults?.length, 1);
  assert.equal(toolResult.toolResults?.[0]?.ok, true);
  assert.equal(toolResult.toolResults?.[0]?.output?.forecast, 'sunny');
  assert.equal(toolResult.messages?.at(-1)?.role, 'assistant');

  runtime.dispose();
});

test('openai-compatible provider streams text, tool-call deltas, and multimodal request bodies', async () => {
  let capturedRequest: RequestCapture | null = null;

  const provider = createOpenAICompatibleProvider({
    id: 'openai-test',
    apiKey: 'test-key',
    defaultModel: 'gpt-test',
    baseUrl: 'https://example.test/v1',
    fetchImpl: async (_url, options = {}) => {
      const requestOptions = options as RequestInit & {
        headers?: Headers | Record<string, string>;
        body?: BodyInit | null;
      };
      const headers = requestOptions.headers instanceof Headers
        ? Object.fromEntries(requestOptions.headers.entries())
        : (requestOptions.headers ?? {});
      const body = typeof requestOptions.body === 'string' ? requestOptions.body : '{}';
      capturedRequest = {
        headers,
        body: JSON.parse(body) as RequestCapture['body'],
      };

      return createSseResponse([
        `data: ${JSON.stringify({
          id: 'resp_1',
          model: 'gpt-test',
          choices: [
            {
              index: 0,
              delta: {
                content: 'Hello ',
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'resp_1',
          model: 'gpt-test',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'lookupWeather',
                      arguments: '{"city":"Pa',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'resp_1',
          model: 'gpt-test',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: 'ris"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`,
        'data: [DONE]\n\n',
      ]);
    },
  });

  const events: StreamEvent[] = [];
  for await (const event of provider.stream({
    model: 'gpt-test',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image and decide if a weather lookup is needed.' },
          {
            type: 'image',
            data: new Uint8Array([1, 2, 3, 4]),
            mimeType: 'image/png',
          },
        ],
      },
    ],
    tools: [
      {
        name: 'lookupWeather',
        description: 'Lookup weather information.',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
          required: ['city'],
          additionalProperties: false,
        },
      },
    ],
  })) {
    events.push(event as StreamEvent);
  }

  assert.ok(capturedRequest);
  const request = capturedRequest as RequestCapture;
  assert.equal(request.headers.authorization, 'Bearer test-key');
  assert.equal(request.body.stream, true);
  assert.equal(request.body.tools?.[0]?.function.name, 'lookupWeather');
  assert.equal(request.body.messages?.[0]?.content?.[0]?.type, 'text');
  assert.equal(request.body.messages?.[0]?.content?.[1]?.type, 'image_url');
  assert.match(
    request.body.messages?.[0]?.content?.[1]?.image_url?.url ?? '',
    /^data:image\/png;base64,/,
  );

  assert.equal(events[0].type, 'response.started');
  assert.equal(events[1].type, 'text.delta');
  assert.equal(events[1].text, 'Hello ');
  assert.equal(events[2].type, 'tool.call.delta');

  const completed = events.at(-1);
  assert.ok(completed);
  assert.equal(completed.type, 'response.completed');
  assert.equal(completed.text, 'Hello ');
  assert.equal(completed.toolCalls?.[0]?.id, 'call_1');
  assert.equal(completed.toolCalls?.[0]?.name, 'lookupWeather');
  assert.equal(completed.toolCalls?.[0]?.arguments, '{"city":"Paris"}');
  assert.equal(completed.finishReason, 'tool_calls');
});
