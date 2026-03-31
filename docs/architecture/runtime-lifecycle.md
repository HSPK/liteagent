# Runtime Lifecycle

The `AgentsRuntime` class in `src/runtime/runtime.ts` is the system-wide host for all agents. It owns the app registry, model provider registry, observability backend, default tools, default installed apps, and persistence coordination.

## Construction paths

There are two common ways to create a runtime.

### `new AgentsRuntime(...)`

Use this when you want low-level control over:

- state backend
- observability backend
- app registry
- model provider registry
- default tools
- default installed apps
- autosave behavior

### `createRuntime(...)`

Use `src/sdk/create-runtime.ts` when you want sensible defaults.

It can additionally:

- register built-in apps automatically
- accept extra app definitions
- wire `sessionDir` persistence and JSONL observability
- auto-register an OpenAI-compatible provider when `OPENAI_API_KEY` is present and `registerOpenAIProvider` is enabled

## Agent creation

`createAgent()` does more than allocate an object:

1. normalize the requested agent ID, policy, and installed app list
2. create an `Agent`, which internally creates an `AgentKernel`
3. register runtime default tools on the agent
4. install runtime default apps plus requested apps
5. attach task and kernel event subscriptions
6. emit an `agent.created` runtime event

`createAgents()` is a small batch wrapper over `createAgent()`.

## Dispatch surfaces

The runtime exposes multiple ways to inject work.

| Method | Purpose |
| --- | --- |
| `sendMessage()` | Send an agent-to-agent message signal immediately. |
| `ingestEvent()` | Inject an external event signal immediately. |
| `message()` | High-level message API that returns a `DispatchHandle`. |
| `event()` | High-level event API that returns a `DispatchHandle`. |
| `text()` | Send a canonical text event to an agent. |
| `tell()` | Send a canonical text message from one agent to another. |
| `reply()` | Publish an observer-facing reply signal such as `assistant.reply`. |
| `publishSignal()` | Publish an already-created observer signal without dispatching it into an agent mailbox. |

All dispatched work ultimately flows through `dispatchSignal()`, which finds the target agent, records a `signal.dispatched` event, and hands the signal to the agent mailbox.

## Dispatch handles

The high-level send APIs return `DispatchHandle`, which gives callers a way to inspect what happened later.

A handle can be used to:

- wait for runtime idleness
- inspect the conversation ID
- inspect the last task that handled the signal
- get the task result
- inspect associated event history

This is the ergonomic bridge between immediate signal dispatch and later task completion.

## Conversation IDs and targeting fields

The high-level send APIs accept an optional `conversationId`. The runtime does not invent conversation IDs for you at this layer; it preserves the value the caller supplies.

That leads to two common patterns:

- **threaded usage**: callers such as the CLI keep a stable `conversationId` so transcript and conversation-scoped memory stay connected across turns
- **stateless usage**: callers omit `conversationId`, and the resulting work is not grouped into a conversation record

There are also two naming layers for app and task targeting:

- high-level SDK methods such as `runtime.text()` and `runtime.message()` use `app` and `taskId`
- raw signal shapes and webhook payloads use `targetAppId` and `targetTaskId`

They refer to the same underlying routing fields; the difference exists because the SDK presents a friendlier calling surface than the raw signal record.

## Snapshot and restore

The runtime can serialize itself through `snapshot()`:

- optionally waits for all agents to become idle first
- asks each agent for an `AgentStateSnapshot`
- returns a versioned `RuntimeSnapshot`

Restore works in the opposite direction:

- validate the snapshot format and version
- create an empty runtime
- recreate each agent
- restore each agent's state

`loadState()` and `saveState()` are higher-level wrappers that go through the configured state backend.

## Idle semantics

`whenIdle()` is a real lifecycle boundary in this codebase. It:

- waits for every agent mailbox to drain
- loops until all agents report idle, because new work may have been scheduled while earlier mailboxes drained
- flushes pending observability writes before resolving

This is why the CLI, tests, and persistence flows often wait on runtime idleness before reading results.

## Runtime events

The runtime emits observed events for higher layers and for persistence backends.

Important event categories include:

- `agent.created` / `agent.disposed`
- `signal.dispatched`
- `signal.published`
- `task.event`
- `scheduler.event`
- `policy.event`
- `state.saved`
- `state.loaded`
- `state.restored`

These events are delivered to:

- in-process subscribers via `subscribeEvents()`
- the configured observability backend via `record()`

## Runtime-to-agent boundary

The runtime intentionally avoids implementing per-app or per-task business logic. Its job is to:

- host agents
- route signals
- expose event hooks
- coordinate state persistence
- coordinate provider and app registries

Once a signal reaches an agent, the runtime steps back and the kernel takes over.

## Practical mental model

Think of the runtime as a local operating environment for multiple agents:

- the runtime is the host
- each agent is an isolated worker container
- signals are the system bus
- apps are installed programs
- tasks are the active processes being advanced by the mailbox
