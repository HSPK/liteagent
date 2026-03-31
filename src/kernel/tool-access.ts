import type {
  PolicyLike,
  ProtocolValue,
  ToolSpec,
  ToolDefinition,
  ToolExecutionContext,
} from '../agent/types.js';

interface RegisteredTool extends ToolSpec {
  execute: (input: ProtocolValue, context: ToolExecutionContext) => Promise<ProtocolValue> | ProtocolValue;
}

export class ToolAccessService {
  #policy: PolicyLike;
  #tools = new Map<string, RegisteredTool>();

  constructor(policy: PolicyLike) {
    this.#policy = policy;
  }

  registerTool<TInput extends ProtocolValue = ProtocolValue, TOutput extends ProtocolValue = ProtocolValue>(
    tool: ToolDefinition<TInput, TOutput>,
  ): ToolDefinition<TInput, TOutput> {
    if (!tool || !tool.name || typeof tool.execute !== 'function') {
      throw new Error('A tool must expose a name and an execute function.');
    }

    this.#tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null,
      execute: (input, context) => tool.execute(input as TInput, context),
    });
    return tool;
  }

  listTools() {
    return Array.from(this.#tools.values())
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? null,
        outputSchema: tool.outputSchema ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async callTool(name: string, input: ProtocolValue, context: ToolExecutionContext): Promise<ProtocolValue> {
    this.#policy.assertCanUseTool(name);

    const tool = this.#tools.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.execute(input, context);
  }
}
