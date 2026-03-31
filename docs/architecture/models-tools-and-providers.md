# Models, Tools, and Providers

The runtime can host model providers and expose them to apps through the execution context. It also supports model-driven tool calling that bridges back into kernel tools.

## Provider registry

`ModelProviderRegistry` is the central registry for model providers.

Each provider must expose:

- an `id`
- either `stream()` or `generate()`

The registry publishes normalized provider descriptions with:

- `id`
- `description`
- `defaultModel`
- `supportsStreaming`
- `supportsVision`
- `supportsTools`

Policy is applied on top of the registry, so an agent may see only the providers it is allowed to use.

## OpenAI-compatible provider

`src/models/openai-compatible-provider.ts` adapts OpenAI-compatible chat completions APIs to the runtime's provider interface.

Notable behavior:

- sends requests to `/chat/completions`
- supports streaming SSE responses
- emits `text.delta` events for text chunks
- emits `tool.call.delta` events for tool-call chunks
- finalizes into a `response.completed` event
- supports image inputs by translating image content into OpenAI `image_url` parts
- supports tool definitions and tool choice selection

The provider is transport-focused. It does not know anything about agent tasks or app memory.

## Model access surface

Apps use providers through `context.models`.

| Method | Purpose |
| --- | --- |
| `list()` | List policy-approved provider descriptions. |
| `stream(request)` | Get raw model stream events. |
| `generate(request)` | Aggregate a stream into a final model result. |
| `run(request)` | Run generation plus optional automatic tool-call execution rounds. |

`run()` is the most opinionated entrypoint. It:

1. generates a model response
2. collects tool calls
3. executes those tools through kernel tool access
4. appends tool result messages
5. repeats until the model stops calling tools or the tool round limit is reached

## Tool-call loop

The tool loop in `ModelAccessService` is important because it keeps model work inside the kernel's control plane.

- tool arguments are parsed as JSON
- tool execution goes through `context.tools.call`
- each tool result becomes a `tool` message fed back to the model
- the service records whether the tool loop limit was reached

This means apps can ask for `tools: true` and still retain policy enforcement and structured tool outputs.

## Tool definitions

Kernel tools are registered with:

- `name`
- `description`
- `inputSchema`
- `execute(input)`

Those schemas are reused both for direct tool access and for model-facing function calling.

## Default runtime tools

`createDefaultRuntimeTools()` provides the default local operator toolset:

| Tool | Purpose |
| --- | --- |
| `command.exec` | Execute a shell command inside the configured workspace. |
| `file.read` | Read a workspace-scoped file. |
| `file.write` | Write a workspace-scoped file, creating parent directories as needed. |
| `file.list` | List files in a workspace-scoped directory. |
| `file.stat` | Inspect a workspace-scoped path. |
| `web.fetch` | Fetch a URL with the runtime's fetch implementation. |
| `web.search` | Run a lightweight DuckDuckGo-backed search query. |

Workspace path resolution prevents `file.*` and `command.exec` from escaping the configured workspace directory accidentally.

## Policy interaction

Policy is enforced in two places:

- `AgentPolicy` restricts which providers and tools are available
- `ModelAccessService` lists only provider descriptions allowed by policy

If a provider or tool is not allowed, the kernel rejects it rather than silently falling back.

## Where this shows up in real flows

The most important in-repo consumer is `domain.assistant`:

- it loads the assistant profile
- resolves the selected provider and model
- calls `context.models.run(...)`
- optionally enables tool calling based on assistant profile settings
- publishes the final reply as an `assistant.reply` signal

That path is the best reference for how application logic should sit on top of providers and tools.
