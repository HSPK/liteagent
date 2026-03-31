# CLI and SDK

This repository provides both a developer-facing SDK and an operator-facing terminal console.

## CLI architecture

The CLI entrypoint is `bin/agents.ts`, which boots `RuntimeConsole`.

`RuntimeConsole` chooses between two modes:

- **Ink fullscreen mode** when both stdin and stdout are TTYs
- **line mode** when the process is running non-interactively

Both modes share the same `RuntimeController`.

## Default CLI runtime

`createCliRuntime()` builds a local-first runtime with:

- `sessionDir` defaulting to `~/.agents`
- runtime config that records CLI mode and workspace details
- default installed apps:
  - `domain.assistant`
  - `system.app-manager`
  - `system.planner`
  - `system.todo`
- default runtime tools from `createDefaultRuntimeTools()`
- automatic OpenAI-compatible provider registration when environment variables allow it

This is why the CLI feels like a ready-to-use assistant console instead of a blank runtime shell.

By default, the CLI does not pass a restrictive policy override when creating the default assistant. That means the agent starts with the runtime's normal permissive policy surface and is mainly constrained by which apps, tools, providers, and backends the runtime has actually registered.

## RuntimeController responsibilities

`RuntimeController` sits between the UI and the runtime. It is responsible for:

- creating and inspecting agents
- listing registry entries and installed apps
- installing apps
- ingesting events and sending messages
- submitting plain text chat
- waiting for idle and persisting state
- subscribing to runtime events and translating them into UI entries

### Chat behavior

The controller has two related text flows:

- `submitText()`: targets the default assistant agent if it exists; otherwise it falls back to fan-out text dispatch across all agents
- `broadcastText()`: explicitly sends text to every agent

In the fullscreen Ink UI, plain text input goes through `submitText()`, so normal chat targets the assistant experience by default.

The shipped terminal UI does not currently expose a dedicated slash command for switching the active chat target. If you need a different target, you currently do that through controller/API usage or by working with explicit slash commands instead of plain-text chat.

## Ink UI behavior

`src/cli/ink-app.ts` implements the fullscreen experience:

- fixed header, suggestion, transcript, and composer regions
- slash command completion and command history
- mouse wheel and page navigation for scrollback
- live streaming model text updates
- live entries for tool calls, tool results, and task waiting states

The UI keeps a stable conversation ID across plain-text chat submissions, which is why assistant transcript state feels continuous inside a session.

## Line mode behavior

The line-mode console:

- prints help text on startup
- reads input line by line
- routes slash commands through shared helpers
- persists state on shutdown

It is intentionally simpler than the Ink path but uses the same runtime/controller model.

## Slash commands

The current command catalog includes:

- `/help`
- `/list` and `/agents`
- `/create`
- `/inspect`
- `/memory`
- `/registry`
- `/apps`
- `/install`
- `/event`
- `/message`
- `/wait`
- `/exit` and `/quit`

Command parsing lives in `src/cli/command-parser.ts`, while user-facing descriptions live in `src/cli/command-catalog.ts`.

## SDK surface

The SDK gives a cleaner library entrypoint than constructing everything manually.

### `createRuntime()`

The main ergonomic runtime constructor can:

- register built-in apps
- register extra app definitions
- enable session persistence
- enable OpenAI provider registration
- preserve all low-level `AgentsRuntime` options

### `DispatchHandle`

The SDK returns `DispatchHandle` from high-level send methods so callers can inspect:

- idle completion
- conversation IDs
- the task that handled the signal
- the final task result

### Agent convenience methods

Agents expose:

- `event()`
- `text()`
- `message()`
- `tell()`
- inspection helpers such as `describeSelf()` and `snapshotMemory()`

This makes the runtime pleasant to use from tests and small applications without hiding the underlying model.

## How the CLI and SDK connect

The CLI is not a special-case runtime. It is a client of the same runtime and SDK surfaces:

- the controller talks to `createRuntime()` / `createCliRuntime()`
- chat uses the same `text()` dispatch path as library consumers
- assistant replies surface through the same `signal.published` and `assistant.reply` events available to any subscriber

That reuse is a strong sign that the core runtime abstractions are carrying their weight.
