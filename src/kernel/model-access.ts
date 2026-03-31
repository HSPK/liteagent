import type {
  ModelMessage,
  ModelProviderContext,
  ModelProviderInstanceLike,
  ModelProviderRegistryLike,
  ModelRequest,
  ModelStreamEvent,
  ModelToolResult,
  ModelUsage,
  ProtocolRecord,
  ProtocolValue,
  ToolCallLike,
  ToolSpec,
  UnknownRecord,
} from '../agent/types.js';
import type { AssistantModelResult, ModelProviderDescription } from '../apps/types.js';

interface NormalizedToolCall {
  id: string;
  type: string;
  name: string | null;
  arguments: string;
}

interface BufferedToolCall {
  id: string | null;
  type: string;
  name: string | null;
  arguments: string;
  index: number;
}

type ToolResult = ModelToolResult;
type KernelModelRequest = ModelRequest;

interface KernelModelResult extends AssistantModelResult, UnknownRecord {
  toolCalls?: NormalizedToolCall[];
  message?: ModelMessage;
  messages?: ModelMessage[];
  toolResults?: ToolResult[];
  toolLoopLimitReached?: boolean;
  finishReason?: string | null;
  usage?: ModelUsage | null;
  responseId?: string | null;
  raw?: UnknownRecord | null;
}

interface ModelPolicyLike {
  canUseModel(providerId: string): boolean;
  assertCanUseModel(providerId: string): void;
}

type ProviderLike = ModelProviderInstanceLike;
type ProviderRegistryLike = ModelProviderRegistryLike;

interface ResolvedKernelRequest extends KernelModelRequest {
  provider: string;
  model: string;
  messages: ModelMessage[];
  tools: boolean | Array<string | ToolSpec> | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createTextContent(text: string | null | undefined): Array<{ type: string; text: string }> {
  if (!text) {
    return [];
  }

  return [{ type: 'text', text }];
}

function parseToolArguments(toolCall: ToolCallLike): ProtocolValue {
  if (toolCall.arguments === undefined || toolCall.arguments === null || toolCall.arguments === '') {
    return {};
  }

  if (typeof toolCall.arguments === 'object') {
    return clone(toolCall.arguments);
  }

  try {
    return JSON.parse(String(toolCall.arguments));
  } catch (error) {
    throw new Error(`Tool call arguments must be valid JSON for ${toolCall.name}.`);
  }
}

function normalizeToolCall(toolCall: ToolCallLike, round: number, index: number): NormalizedToolCall {
  return {
    id: toolCall.id ?? `tool-call-${round}-${index}`,
    type: toolCall.type ?? 'function',
    name: toolCall.name ?? null,
    arguments: typeof toolCall.arguments === 'string'
      ? toolCall.arguments
      : JSON.stringify(toolCall.arguments ?? {}),
  };
}

function createAssistantMessage(
  response: KernelModelResult & { toolCalls?: ToolCallLike[] | null },
  round: number,
): ModelMessage {
  const toolCalls = (response.toolCalls ?? []).map((toolCall, index) =>
    normalizeToolCall(toolCall, round, index));
  const content = createTextContent(response.text ?? '');

  return {
    role: 'assistant',
    ...(content.length > 0 ? { content } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function createToolResultMessage(toolResult: ToolResult): ModelMessage {
  return {
    role: 'tool',
    toolCallId: toolResult.callId,
    name: toolResult.toolName,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          toolResult.ok
            ? { ok: true, output: toolResult.output }
            : { ok: false, error: toolResult.error },
        ),
      },
    ],
  };
}

function mergeToolCallDelta(toolCalls: Map<string, BufferedToolCall>, event: ModelStreamEvent): void {
  if (event.type !== 'tool.call.delta') {
    return;
  }

  const key = typeof event.index === 'number'
    ? `index:${event.index}`
    : event.callId ?? `index:${toolCalls.size}`;
  const existing = toolCalls.get(key) ?? {
    id: event.callId ?? null,
    type: 'function',
    name: '',
    arguments: '',
    index: event.index ?? toolCalls.size,
  };

  if (event.callId) {
    existing.id = event.callId;
  }

  if (event.name) {
    existing.name = event.name;
  }

  if (event.argumentsDelta) {
    existing.arguments += event.argumentsDelta;
  }

  if (typeof event.index === 'number') {
    existing.index = event.index;
  }

  toolCalls.set(key, existing);
}

function finalizeToolCalls(toolCalls: Map<string, BufferedToolCall>, round: number): NormalizedToolCall[] {
  return Array.from(toolCalls.values())
    .sort((left, right) => left.index - right.index)
    .map((toolCall, index) => normalizeToolCall(toolCall, round, index));
}

export class ModelAccessService {
  #policy: ModelPolicyLike;
  #registry: ProviderRegistryLike;

  constructor({ policy, registry }: { policy: ModelPolicyLike; registry: ProviderRegistryLike }) {
    this.#policy = policy;
    this.#registry = registry;
  }

  listProviders(): ModelProviderDescription[] {
    return this.#registry
      .list()
      .filter((provider) => this.#policy.canUseModel(provider.id));
  }

  async *stream(
    request: KernelModelRequest,
    context: ModelProviderContext = {},
  ): AsyncGenerator<ModelStreamEvent, void, unknown> {
    const { provider, request: resolvedRequest } = this.#resolveRequest(request);

    if (typeof provider.stream === 'function') {
      for await (const event of provider.stream(resolvedRequest, context)) {
        yield event;
      }
      return;
    }

    if (typeof provider.generate !== 'function') {
      throw new Error(`Model provider ${provider.id} must expose stream() or generate().`);
    }

    const response = await provider.generate(resolvedRequest, context) as KernelModelResult;
    yield {
      type: 'response.completed',
      providerId: provider.id,
      model: resolvedRequest.model,
      ...clone(response),
    };
  }

  async generate(request: KernelModelRequest, context: ModelProviderContext = {}): Promise<KernelModelResult> {
    const { provider, request: resolvedRequest } = this.#resolveRequest(request);
    const toolCalls = new Map<string, BufferedToolCall>();
    let text = '';
    let finishReason: string | null = null;
    let usage: ModelUsage | null = null;
    let message: ModelMessage | null = null;
    let responseId: string | null = null;
    let raw: UnknownRecord | null = null;

    for await (const event of this.stream(resolvedRequest, context)) {
      request.onEvent?.(clone(event));

      switch (event.type) {
        case 'text.delta':
          text += event.text ?? '';
          break;
        case 'tool.call.delta':
          mergeToolCallDelta(toolCalls, event);
          break;
        case 'response.completed':
          if (typeof event.text === 'string' && text.length === 0) {
            text = event.text;
          }

          for (const toolCall of event.toolCalls ?? []) {
            mergeToolCallDelta(toolCalls, {
              type: 'tool.call.delta',
              index: toolCall.index,
              callId: toolCall.id,
              name: toolCall.name,
              argumentsDelta: typeof toolCall.arguments === 'string'
                ? toolCall.arguments
                : JSON.stringify(toolCall.arguments ?? {}),
            });
          }

          finishReason = event.finishReason ?? finishReason;
          usage = event.usage ?? usage;
          responseId = event.responseId ?? responseId;
          raw = event.raw ?? raw;
          message = event.message ? clone(event.message) : message;
          break;
        default:
          break;
      }
    }

    const finalizedToolCalls = finalizeToolCalls(toolCalls, 0);

    return {
      providerId: provider.id,
      model: resolvedRequest.model,
      text,
      finishReason,
      usage,
      responseId,
      raw,
      toolCalls: finalizedToolCalls,
      message: message ?? {
        role: 'assistant',
        ...(text ? { content: createTextContent(text) } : {}),
        ...(finalizedToolCalls.length > 0 ? { toolCalls: finalizedToolCalls } : {}),
      },
    };
  }

  async run(request: KernelModelRequest, context: ModelProviderContext = {}): Promise<KernelModelResult> {
    const messages = Array.isArray(request.messages) ? clone(request.messages) as ModelMessage[] : [];
    const toolSpecs = this.#resolveTools(request.tools, context);
    const maxToolRounds = request.maxToolRounds ?? 4;
    const toolResults: ToolResult[] = [];
    let latestResponse: KernelModelResult | null = null;

    for (let round = 0; round <= maxToolRounds; round += 1) {
      latestResponse = await this.generate(
        {
          ...request,
          messages,
          tools: toolSpecs,
        },
        context,
      );

      const assistantMessage = createAssistantMessage(latestResponse, round);
      messages.push(assistantMessage);

      if (!latestResponse.toolCalls || latestResponse.toolCalls.length === 0 || request.autoExecuteTools === false) {
        return {
          ...latestResponse,
          message: assistantMessage,
          messages,
          toolResults,
        };
      }

      if (round === maxToolRounds) {
        return {
          ...latestResponse,
          message: assistantMessage,
          messages,
          toolResults,
          toolLoopLimitReached: true,
        };
      }

      for (const toolCall of latestResponse.toolCalls) {
        const toolResult = await this.#executeToolCall(toolCall, context);
        toolResults.push(toolResult);
        request.onEvent?.({
          type: 'tool.result',
          toolResult: clone(toolResult),
        });
        messages.push(createToolResultMessage(toolResult));
      }
    }

    return {
      ...latestResponse,
      messages,
      toolResults,
      toolLoopLimitReached: true,
    };
  }

  async #executeToolCall(toolCall: ToolCallLike, context: ModelProviderContext): Promise<ToolResult> {
    const callId = toolCall.id ?? `tool-call:${toolCall.name}`;
    const toolName = toolCall.name;

    if (!toolName) {
      return {
        callId,
        toolName: null,
        ok: false,
        output: null,
        error: 'Tool call is missing a name.',
      };
    }

    if (typeof context.tools?.call !== 'function') {
      return {
        callId,
        toolName,
        ok: false,
        output: null,
        error: 'Tool execution requires context.tools.call().',
      };
    }

    let input;
    try {
      input = parseToolArguments(toolCall);
    } catch (error) {
      return {
        callId,
        toolName,
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const output = await context.tools.call(toolName, input);
      return {
        callId,
        toolName,
        ok: true,
        output: clone(output),
        error: null,
      };
    } catch (error) {
      return {
        callId,
        toolName,
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #resolveRequest(request: KernelModelRequest): { provider: ProviderLike; request: ResolvedKernelRequest } {
    const listedProviders = this.#registry.list();

    if (listedProviders.length === 0) {
      throw new Error('No model providers are registered.');
    }

    const providerId = request.provider
      ?? (listedProviders.length === 1 ? listedProviders[0].id : null);

    if (!providerId) {
      throw new Error('Model provider is required when multiple providers are registered.');
    }

    this.#policy.assertCanUseModel(providerId);

    const provider = this.#registry.get(providerId);
    if (!provider) {
      throw new Error(`Unknown model provider: ${providerId}`);
    }

    const model = request.model ?? provider.defaultModel ?? null;
    if (!model) {
      throw new Error(`Model is required for provider: ${providerId}`);
    }

    return {
      provider,
      request: {
        ...request,
        provider: providerId,
        model,
        messages: Array.isArray(request.messages) ? clone(request.messages) : [],
        tools: Array.isArray(request.tools) ? clone(request.tools) : request.tools,
        options: request.options ? clone(request.options) : undefined,
      },
    };
  }

  #resolveTools(
    requestTools: boolean | Array<string | ToolSpec> | null | undefined,
    context: ModelProviderContext,
  ): ToolSpec[] {
    if (!requestTools) {
      return [];
    }

    const availableTools = typeof context.tools?.list === 'function'
      ? context.tools.list()
      : [];

    if (requestTools === true) {
      return availableTools;
    }

    if (!Array.isArray(requestTools)) {
      throw new Error('Model request tools must be true, false, or an array.');
    }

    return requestTools.map((tool) => {
      if (typeof tool !== 'string') {
        return clone(tool);
      }

      const match = availableTools.find((availableTool) => availableTool.name === tool);
      if (!match) {
        throw new Error(`Unknown tool in model request: ${tool}`);
      }

      return clone(match);
    });
  }
}
