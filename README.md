# agents

`agents` is a message-driven framework for building collaborative, long-lived agents. Each agent has its own mailbox, loop, memory, tools, and policy, and should feel like it is running in its own thread.

## Core ideas

- **Thread-like agents**: each agent is long-lived, stateful, and continuously receives new input.
- **Unified signal model**: messages, external events, timers, and callbacks all enter the system as signals.
- **Kernel + apps**: an agent is a runtime container with a small kernel and installable apps.
- **External world as input**: webhook pushes, email notifications, monitoring alerts, and similar sources are standard inputs.
- **Time as a first-class concept**: delay, recurring jobs, and timeout checks belong in the model from the start.
- **Transparent agents**: an agent should be able to understand its own structure, state, and installed capabilities.

## Core primitives

- **Runtime**: hosts agents and shared services.
- **Agent**: a long-lived worker with its own mailbox, loop, memory, tools, and policy.
- **Signal**: the unified input primitive. Signals include messages, events, and timers.
- **Task**: the unit of execution created or resumed by a signal.
- **Memory**: the state an agent carries across tasks and conversations.
- **App**: an installable capability module that runs on top of the agent kernel.
- **Policy**: the boundary that governs what an agent may do, including tool/model/app access and task/scheduler quotas.

## Mental model

1. A signal enters an agent's mailbox.
2. The app may route that signal to a waiting task, queue it for later, interrupt a task, or ask the kernel to spawn a new task.
3. The kernel enforces lifecycle, policy, and scheduling invariants around that routing decision.
4. The task reads memory, calls tools, updates state, waits on signals or other tasks, or schedules timers.
5. The agent may message other agents, react to external input, or use installed apps to continue work.

## Current implementation

The current MVP is a structured Node.js implementation focused on getting the runtime model right first:

- `src/runtime`: multi-agent runtime, message delivery, model provider registry, webhook ingress, and runtime-level persistence wiring.
- `src/agent`: agent container, kernel orchestration, and task-event observation hooks.
- `src/kernel`: mailbox, task runtime, conversation service, scoped memory, tools, model access, scheduler, policy, state, and observability services.
- `src/apps`: app host, app registry, and built-in system/domain apps, including `domain.assistant`, `domain.echo`, `domain.workflow`, `system.app-manager`, `system.todo`, `system.planner`, and a deterministic `system.router`.
- `test`: framework-level tests for the main execution paths.

## SDK quick start

The library now has a higher-level SDK entrypoint for the common path:

```js
import { createRuntime } from 'agents';

const runtime = createRuntime();

const { alice, bob } = await runtime.createAgents([
  { id: 'alice', apps: ['domain.echo'] },
  { id: 'bob', apps: ['domain.echo'] },
]);

const handle = alice.tell('bob', 'hello bob', {
  app: 'domain.echo',
  conversationId: 'chat-1',
});

const result = await handle.result();
console.log(result);
```

The SDK currently adds:

- `createRuntime()` for a built-in-ready runtime
- `runtime.createAgent()` and `runtime.createAgents()`
- `runtime.event()`, `runtime.message()`, `runtime.text()`, `runtime.tell()`
- `runtime.reply()` / `runtime.publishSignal()` for reply-style or observer-only signals
- `agent.event()`, `agent.message()`, `agent.text()`, `agent.tell()`
- `DispatchHandle` with `whenIdle()`, `conversation()`, `lastTask()`, and `result()`

`createRuntime()` also accepts a few higher-level assistant/runtime defaults:

- `sessionDir` to persist runtime state, events, and per-agent snapshots under a local folder
- `defaultTools` to register runtime-provided tools on every created agent
- `defaultInstalledApps` to install a default app set on every created agent
- `registerOpenAIProvider: true` to auto-register an OpenAI-compatible provider when `OPENAI_API_KEY` is available

## Model providers, streaming, and tool calling

The runtime can now host model providers for LLM or VLM workloads. Register providers once at the runtime layer and use them from app execution contexts through `context.models`.

```js
import {
  createOpenAICompatibleProvider,
  createRuntime,
} from 'agents';

const runtime = createRuntime();

runtime.registerModelProvider(
  createOpenAICompatibleProvider({
    id: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    defaultModel: 'gpt-4.1-mini',
  }),
);
```

Inside an app, the kernel now exposes:

- `context.models.list()`
- `context.models.stream(request)`
- `context.models.generate(request)`
- `context.models.run(request)`

`run()` can automatically bridge model tool calls to registered kernel tools when you pass `tools: true` or an explicit tool list.

```js
const app = {
  manifest: {
    id: 'domain.assistant',
    kind: 'domain',
    version: '0.1.0',
    title: 'Assistant',
    priority: 50,
  },
  canHandle(signal) {
    return signal.type === 'text';
  },
  async onSignal(context, signal) {
    const result = await context.models.run({
      provider: 'openai',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: signal.payload.text },
            // VLM input is supported through image parts:
            // { type: 'image', url: 'https://example.com/image.png' },
          ],
        },
      ],
      tools: true,
    });

    context.complete(result);
  },
};
```

Tools can now publish schemas for model-facing function calling:

```js
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
  async execute(input) {
    return { city: input.city, forecast: 'sunny' };
  },
});
```

## Assistant layer

The framework now ships a built-in `domain.assistant` app for the common "chat with an agent" path.

- `text` signals are treated as user turns
- the assistant stores a per-conversation transcript in memory
- per-agent assistant config lives in app memory (`systemPrompt`, provider, model, transcript window, tools on/off)
- replies are published as **reply signals** (`kind: 'reply'`, usually `type: 'assistant.reply'`) so higher layers such as the CLI can subscribe to them

You can configure the assistant through normal signals:

```js
runtime.event({
  to: 'assistant',
  app: 'domain.assistant',
  type: 'assistant.configure',
  payload: {
    systemPrompt: 'You are a concise coding assistant.',
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
});
```

## Kernel OS helpers

Apps now get a richer kernel-facing execution context for coordinating tasks, memory, scheduling, signals, and tool work:

- the execution context is exposed as syscall-like facades instead of leaking a raw runtime object
- `context.task.get()`, `context.task.update()`, `context.task.events()`, `context.task.record()`
- `context.task.wait()` / `context.task.awaitSignal()` with `resumeOnSignals` and `timeoutMs`
- `context.task.awaitTasks()` / `context.waitForTasks()` for dependency waits on other task IDs
- `context.task.inbox.list()` / `peek()` / `drain()` / `clear()` / `size()` for deferred signal context
- `context.memory.scope(kind, id)` for custom named memory scopes beyond the built-in agent/app/task/conversation scopes
- `context.scheduler.delay()`, `context.scheduler.at()`, `context.scheduler.recurring()`, `context.scheduler.cancel()`, `context.scheduler.list()`
- `context.tools.request()` for signal-based tool execution
- `context.signals.publish()` / `context.signals.reply()` for observer-facing reply signals

`context.timers.*` is still available as a compatibility alias for `context.scheduler.*`.

Apps can also expose an optional `routeSignal(context, signal)` hook. This runs before the kernel creates or resumes a task and lets the app decide whether a signal should:

- `resume` a specific existing task
- `spawn` a new task
- `queue` onto a task inbox without waking it immediately
- `interrupt` a task by queueing the signal and delivering a synthetic `task.interrupt`
- `ignore` the signal

The kernel still enforces task state transitions and policy, but apps now decide more of the routing semantics by inspecting task lists and memory scopes. This supports a more agent-directed model where a task can keep waiting, absorb extra context through its inbox, or block on another task before resuming.

Dependency waits are also part of the kernel model now:

1. a task calls `context.task.awaitTasks([...taskIds])`
2. the kernel records the dependency wait and optional timeout
3. when a dependency task completes, fails, or is cancelled, the kernel emits a targeted `task.dependency.ready`
4. the waiting task resumes and can inspect the dependency status from the signal payload

Signal-based tool execution keeps tool work inside the same kernel model:

1. the app enqueues a `tool.call` signal
2. the kernel executes the tool
3. the kernel emits a `tool.result` signal
4. the original task resumes on that signal or on an optional timeout

This means timers, tool calls, and external events can all coordinate through the same task/signal runtime rather than through ad-hoc callbacks.

## Observability hooks

The runtime now exposes a more durable observability surface:

- `runtime.subscribeEvents()` for live runtime events such as `agent.created`, `signal.dispatched`, `task.event`, `scheduler.event`, and `policy.event`
- `signal.published` events when apps or higher layers publish observer-facing reply signals
- `runtime.queryEvents()` for querying the configured observability backend
- `agent.observeTaskEvents()` for per-agent task lifecycle/event observation
- `agent.observeKernelEvents()` for kernel-level scheduler/policy observation
- `DispatchHandle.events()` for inspecting the recorded event history of the task that handled a dispatch

Model streaming is also wired into task events, so model deltas, wait states, tool activity, scheduler activity, and policy denials can be consumed by higher layers such as the CLI UI or external telemetry pipelines.

You can plug in a file-backed event backend when you want runtime events to survive process restarts:

```js
import {
  JsonlFileObservabilityBackend,
  createRuntime,
} from 'agents';

const runtime = createRuntime({
  observabilityBackend: new JsonlFileObservabilityBackend('./var/runtime-events.jsonl'),
});
```

## Durability

The runtime now supports both snapshot/restore and a first continuous persistence layer:

- `runtime.snapshot()` captures agent policy, installed apps, memory, tasks, conversations, timers, and self-model history.
- `runtime.restore(snapshot)` rebuilds a runtime from that snapshot.
- `runtime.saveState()` / `runtime.flushState()` write the current runtime snapshot through the configured state backend.
- `runtime.loadState()` restores a runtime from the configured state backend.
- `JsonFileRuntimeStore` remains as the compatibility name for the JSON snapshot store.
- `JsonFileStateBackend` is the underlying file-backed state backend used for continuous persistence workflows.
- `SessionDirectoryStateBackend` is a higher-level local-session backend that writes:
  - `runtime/state.json`
  - `runtime/config.json`
  - `runtime/events.jsonl`
  - `agents/<agentId>.json`

```js
import {
  createDefaultRuntimeTools,
  createRuntime,
} from 'agents';

const runtime = createRuntime({
  sessionDir: './var/session',
  defaultInstalledApps: ['domain.assistant', 'system.app-manager', 'system.todo', 'system.planner'],
  defaultTools: createDefaultRuntimeTools(),
  registerOpenAIProvider: true,
});

await runtime.createAgent({
  id: 'assistant',
});

await runtime.flushState();
```

This is still an MVP durability model. It is designed for local persistence and recovery, not yet for mailbox replay, distributed recovery, or replicated state logs.

## Testing

Run the test suite with:

```bash
npm test
```

## CLI UI

Start the runtime console with:

```bash
npm run ui
```

The current CLI is a runtime console for managing agents in a live session.

- In a TTY, it now runs on an Ink-based terminal UI route with a structured status area, content area, and fixed input line.
- In non-interactive environments, it falls back to a line-based console.
- By default, the CLI creates a local-session runtime under `~/.agents`, boots a default `assistant` agent, and routes plain text directly to it.
- Slash commands such as `/create`, `/inspect`, and `/wait` are used for runtime operations.
- Task/model observability events and `assistant.reply` signals can surface into the content area as live streaming entries.
- The fullscreen Ink UI now follows an event-driven chat path: user input dispatches immediately, while transcript updates stream in through runtime events instead of waiting for a full request/response round-trip.

The default CLI runtime also injects common tools such as `web.search`, `web.fetch`, `file.read`, `file.write`, `file.list`, `file.stat`, and `command.exec` into newly created agents.

The generic `RuntimeController` API still exposes `broadcastText()` for multi-agent broadcast flows; the default console experience now prefers a single assistant conversation.

## Documents

- `docs/README.md`: documentation landing page and reading guide.
- `docs/design/system-overview.md`: whole-system goals, layered model, and execution mental model.
- `docs/design/module-map.md`: repository and submodule map.
- `docs/architecture/runtime-lifecycle.md`: runtime construction, dispatch, snapshots, and event flow.
- `docs/architecture/kernel-services.md`: mailbox, tasks, memory, scheduler, policy, and self-model internals.
- `docs/features/assistant-layer.md`: built-in assistant behavior and CLI chat integration.
