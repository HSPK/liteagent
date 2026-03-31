import type {
  ModelContentPart,
  ModelProviderInstanceLike,
  ModelRequest,
  ModelStreamEvent,
  ModelToolChoice,
  ModelUsage,
  ToolSpec,
  UnknownRecord,
} from '../agent/types.js';

type ContentPartLike = ModelContentPart;

interface ToolCallLike {
  id?: string | null;
  name?: string | null;
  arguments?: unknown;
}

interface ModelMessageLike {
  role?: string;
  content?: string | ContentPartLike[] | null;
  toolCalls?: ToolCallLike[];
  toolCallId?: string;
  name?: string | null;
}

interface OpenAIRequestLike {
  model: string;
  messages?: ModelMessageLike[];
  tools?: ToolSpec[];
  toolChoice?: ModelToolChoice;
  options?: UnknownRecord;
}

interface BufferedToolCall {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  arguments?: string | null;
  index: number;
}

interface OpenAIStreamChunk extends UnknownRecord {
  id?: string | null;
  model?: string | null;
  usage?: ModelUsage | null;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string | null;
        type?: string | null;
        index?: number | null;
        function?: {
          name?: string | null;
          arguments?: string | null;
        };
      }>;
    };
  }>;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function toBase64(data: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('base64');
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
  }

  throw new Error('Image data must be a base64 string, ArrayBuffer, or typed array.');
}

function toImageUrl(part: ContentPartLike): string {
  if (part.url) {
    return part.url;
  }

  if (!part.data) {
    throw new Error('Image content requires url or data.');
  }

  const mimeType = part.mimeType ?? 'image/png';
  return `data:${mimeType};base64,${toBase64(part.data)}`;
}

function toOpenAIContentPart(part: ContentPartLike): UnknownRecord {
  if (part.type === 'text') {
    return {
      type: 'text',
      text: part.text ?? '',
    };
  }

  if (part.type === 'image') {
    return {
      type: 'image_url',
      image_url: {
        url: toImageUrl(part),
        ...(part.detail ? { detail: part.detail } : {}),
      },
    };
  }

  throw new Error(`Unsupported content part type: ${part.type}`);
}

function normalizeContent(content: string | ContentPartLike[] | null | undefined): string | null | UnknownRecord[] {
  if (content === null) {
    return null;
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return '';
    }

    return content.map((part) => toOpenAIContentPart(part as ContentPartLike));
  }

  return String(content);
}

function normalizeToolCall(toolCall: ToolCallLike): UnknownRecord {
  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: typeof toolCall.arguments === 'string'
        ? toolCall.arguments
        : JSON.stringify(toolCall.arguments ?? {}),
    },
  };
}

function toOpenAIMessage(message: ModelMessageLike): UnknownRecord {
  if (!message?.role) {
    throw new Error('Model messages require a role.');
  }

  if (message.role === 'tool') {
    const content = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content
          .filter((part) => (part as ContentPartLike).type === 'text')
          .map((part) => (part as ContentPartLike).text ?? '')
          .join('\n')
        : JSON.stringify(message.content);

    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content,
    };
  }

  const normalized: {
    role: string;
    content?: string | null | UnknownRecord[];
    tool_calls?: UnknownRecord[];
  } = {
    role: message.role,
  };

  const content = normalizeContent(message.content ?? '');
  if (content !== undefined) {
    normalized.content = content;
  }

  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    normalized.tool_calls = message.toolCalls.map((toolCall) => normalizeToolCall(toolCall));
    if ((message.content === undefined || message.content === null || message.content === '') && normalized.content === '') {
      normalized.content = null;
    }
  }

  return normalized;
}

function toOpenAITool(tool: ToolSpec): UnknownRecord {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    },
  };
}

function normalizeToolChoice(toolChoice: ModelToolChoice | undefined): string | UnknownRecord | undefined {
  if (!toolChoice) {
    return undefined;
  }

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
      return toolChoice;
    }

    return {
      type: 'function',
      function: {
        name: toolChoice,
      },
    };
  }

  if (toolChoice && typeof toolChoice === 'object' && 'name' in toolChoice && toolChoice.name) {
    return {
      type: 'function',
      function: {
        name: (toolChoice as { name: string }).name,
      },
    };
  }

  return toolChoice;
}

function buildRequestBody(request: OpenAIRequestLike): UnknownRecord {
  return {
    model: request.model,
    messages: (request.messages ?? []).map((message) => toOpenAIMessage(message)),
    stream: true,
    ...(Array.isArray(request.tools) && request.tools.length > 0
      ? { tools: request.tools.map((tool) => toOpenAITool(tool)) }
      : {}),
    ...(request.toolChoice ? { tool_choice: normalizeToolChoice(request.toolChoice) } : {}),
    ...(request.options ?? {}),
  };
}

function normalizeRequest(request: ModelRequest): OpenAIRequestLike {
  if (typeof request.model !== 'string' || request.model.length === 0) {
    throw new Error('OpenAI-compatible requests require a model.');
  }

  return {
    model: request.model,
    messages: request.messages,
    tools: Array.isArray(request.tools)
      ? request.tools.map((tool) => typeof tool === 'string' ? { name: tool } : tool)
      : undefined,
    toolChoice: request.toolChoice,
    options: request.options,
  };
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) {
        break;
      }

      const rawEvent = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);

      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (data) {
        yield data;
      }
    }
  }

  buffer += decoder.decode();

  const trailing = buffer.trim();
  if (trailing.startsWith('data:')) {
    yield trailing
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
  }
}

function finalizeToolCalls(toolCalls: Map<string, BufferedToolCall>): Array<{
  id: string | null;
  type: string;
  name: string;
  arguments: string;
  index: number;
}> {
  return Array.from(toolCalls.values())
    .sort((left, right) => left.index - right.index)
    .map((toolCall) => ({
      id: toolCall.id ?? null,
      type: toolCall.type ?? 'function',
      name: toolCall.name ?? '',
      arguments: toolCall.arguments ?? '',
      index: toolCall.index,
    }));
}

export class OpenAICompatibleModelProvider implements ModelProviderInstanceLike {
  id: string;
  description: string;
  baseUrl: string;
  path: string;
  apiKey: string | null;
  headers: Record<string, string>;
  defaultModel: string | null;
  fetchImpl: typeof globalThis.fetch | undefined;
  supportsVision = true;
  supportsTools = true;

  constructor({
    id = 'openai',
    description = 'OpenAI-compatible chat completions provider',
    baseUrl = 'https://api.openai.com/v1',
    path = '/chat/completions',
    apiKey = process.env.OPENAI_API_KEY,
    headers = {},
    defaultModel = null,
    fetchImpl = globalThis.fetch,
  }: {
    id?: string;
    description?: string;
    baseUrl?: string;
    path?: string;
    apiKey?: string | null;
    headers?: Record<string, string>;
    defaultModel?: string | null;
    fetchImpl?: typeof globalThis.fetch;
  } = {}) {
    this.id = id;
    this.description = description;
    this.baseUrl = baseUrl;
    this.path = path;
    this.apiKey = apiKey ?? null;
    this.headers = headers;
    this.defaultModel = defaultModel;
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent, void, unknown> {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(`Model provider ${this.id} requires a fetch implementation.`);
    }

    if (!this.apiKey) {
      throw new Error(`Model provider ${this.id} requires an apiKey.`);
    }

    const normalizedRequest = normalizeRequest(request);
    const body = buildRequestBody(normalizedRequest);
    const response = await this.fetchImpl(joinUrl(this.baseUrl, this.path), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model provider ${this.id} request failed (${response.status}): ${errorText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error(`Model provider ${this.id} did not return a response body.`);
    }

    let responseId: string | null = null;
    let responseModel = normalizedRequest.model;
    let finishReason: string | null = null;
    let usage: ModelUsage | null = null;
    let text = '';
    const toolCalls = new Map<string, BufferedToolCall>();

    yield {
      type: 'response.started',
      providerId: this.id,
      model: normalizedRequest.model,
    };

    for await (const data of parseSseStream(response.body)) {
      if (data === '[DONE]') {
        break;
      }

      const chunk = JSON.parse(data) as OpenAIStreamChunk;
      responseId = chunk.id ?? responseId;
      responseModel = chunk.model ?? responseModel;
      usage = chunk.usage ?? usage;

      for (const choice of chunk.choices ?? []) {
        finishReason = choice.finish_reason ?? finishReason;
        const delta = choice.delta ?? {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          text += delta.content;
          yield {
            type: 'text.delta',
            providerId: this.id,
            model: responseModel,
            text: delta.content,
          };
        }

        for (const toolCallDelta of delta.tool_calls ?? []) {
          const key = typeof toolCallDelta.index === 'number'
            ? `index:${toolCallDelta.index}`
            : toolCallDelta.id ?? `index:${toolCalls.size}`;
          const existing = toolCalls.get(key) ?? {
            id: toolCallDelta.id ?? null,
            type: toolCallDelta.type ?? 'function',
            name: '',
            arguments: '',
            index: toolCallDelta.index ?? toolCalls.size,
          };

          if (toolCallDelta.id) {
            existing.id = toolCallDelta.id;
          }

          if (toolCallDelta.type) {
            existing.type = toolCallDelta.type;
          }

          if (typeof toolCallDelta.index === 'number') {
            existing.index = toolCallDelta.index;
          }

          if (toolCallDelta.function?.name) {
            existing.name = toolCallDelta.function.name;
          }

          if (toolCallDelta.function?.arguments) {
            existing.arguments += toolCallDelta.function.arguments;
          }

          toolCalls.set(key, existing);

          yield {
            type: 'tool.call.delta',
            providerId: this.id,
            model: responseModel,
            index: existing.index,
            callId: existing.id,
            name: toolCallDelta.function?.name,
            argumentsDelta: toolCallDelta.function?.arguments ?? '',
          };
        }
      }
    }

    const finalizedToolCalls = finalizeToolCalls(toolCalls);
    yield {
      type: 'response.completed',
      providerId: this.id,
      model: responseModel,
      responseId,
      text,
      usage,
      finishReason,
      toolCalls: finalizedToolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        name: toolCall.name,
        arguments: toolCall.arguments,
        index: toolCall.index,
      })),
      message: {
        role: 'assistant',
        content: text ? [{ type: 'text', text }] : [],
        ...(finalizedToolCalls.length > 0
          ? {
            toolCalls: finalizedToolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: toolCall.type,
              name: toolCall.name,
              arguments: toolCall.arguments,
            })),
          }
          : {}),
      },
      raw: null,
    };
  }
}

export function createOpenAICompatibleProvider(
  options?: ConstructorParameters<typeof OpenAICompatibleModelProvider>[0],
): OpenAICompatibleModelProvider {
  return new OpenAICompatibleModelProvider(options);
}

export { buildRequestBody as buildOpenAICompatibleRequestBody };
