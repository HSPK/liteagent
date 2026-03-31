# Module Map

This document maps the repository into the submodules you are most likely to touch.

## Top-level layout

| Path | Responsibility |
| --- | --- |
| `bin/` | Executable entrypoints, including the `agents` CLI binary. |
| `src/index.ts` | Public library export surface. |
| `src/core/` | Low-level shared primitives such as signal creation and the policy export shim. |
| `src/runtime/` | Multi-agent runtime host, runtime tools, webhook ingress, and session-oriented state backends. |
| `src/agent/` | The agent facade, kernel orchestration, execution contexts, and agent-facing types. |
| `src/kernel/` | Mailbox, task runtime, memory, conversations, scheduler, tools, models, policy, state management, and observability services. |
| `src/apps/` | App registry, app host, built-in apps, and app type definitions. |
| `src/models/` | Model provider registry and the OpenAI-compatible provider implementation. |
| `src/sdk/` | High-level ergonomics such as `createRuntime()` and `DispatchHandle`. |
| `src/cli/` | Runtime controller, Ink UI, slash commands, layout helpers, and console bootstrapping. |
| `src/utils/` | Small shared utilities such as ID generation. |
| `test/` | Runtime, CLI, persistence, routing, observability, and model integration tests. |

## Runtime submodules

| File or folder | Responsibility |
| --- | --- |
| `src/runtime/runtime.ts` | `AgentsRuntime`, the central multi-agent host. |
| `src/runtime/default-runtime-tools.ts` | Built-in workspace and web tools available to runtime-created agents. |
| `src/runtime/session-directory-state-backend.ts` | Local session persistence layout under a directory. |
| `src/runtime/webhook-ingress.ts` | HTTP server that turns POST bodies into runtime events. |
| `src/runtime/types.ts` | Runtime snapshots, event taxonomy, and webhook request/response types. |
| `src/runtime/json-file-store.ts` | Compatibility export for the JSON file runtime store name. |

## Agent submodules

| File | Responsibility |
| --- | --- |
| `src/agent/agent.ts` | Ergonomic agent wrapper around the kernel. |
| `src/agent/kernel.ts` | Kernel composition and the main signal-processing loop. |
| `src/agent/execution-context.ts` | Lifecycle, routing, and execution syscall facades exposed to apps. |
| `src/agent/kernel-helpers.ts` | Helper logic for waits, tool calls, stream observation, and dependency resumes. |
| `src/agent/types.ts` | The central type surface used across runtime, kernel, apps, and CLI. |

## Kernel submodules

### Core services

| File | Responsibility |
| --- | --- |
| `src/kernel/mailbox.ts` | Serialized per-agent signal queue with idle detection. |
| `src/kernel/task-runtime.ts` | Task creation, waiting, resumption, inboxes, dependencies, and task event history. |
| `src/kernel/conversation-service.ts` | Lightweight conversation/thread tracking. |
| `src/kernel/memory.ts` | Scoped memory service for agent, app, task, conversation, and named scopes. |
| `src/kernel/tool-access.ts` | Tool registration and guarded execution. |
| `src/kernel/model-access.ts` | Model provider access plus automatic tool-call execution loops. |
| `src/kernel/self-model.ts` | Agent introspection snapshots and history. |
| `src/kernel/timer-service.ts` | Compatibility entrypoint for scheduler functionality. |

### Kernel service folders

| Folder | Responsibility |
| --- | --- |
| `src/kernel/policy/` | Agent policy implementation and enforcement decisions. |
| `src/kernel/scheduler/` | Scheduler service for delay, absolute, and recurring schedules. |
| `src/kernel/state/` | Runtime autosave orchestration and JSON state backend support. |
| `src/kernel/observability/` | In-memory and JSONL event backends plus runtime event filtering. |

## App submodules

### App infrastructure

| File | Responsibility |
| --- | --- |
| `src/apps/app-registry.ts` | Registry of app definitions by ID. |
| `src/apps/app-host.ts` | Installed app set, installation metadata, and priority ordering. |
| `src/apps/builtin.ts` | The built-in app catalog and helper for registration. |
| `src/apps/types.ts` | App manifests, app definitions, assistant types, and routing decisions. |

### Built-in apps

| Path | Responsibility |
| --- | --- |
| `src/apps/domain/assistant-app.ts` | Chat assistant behavior over model providers and conversation memory. |
| `src/apps/domain/assistant-transcript.ts` | Assistant transcript storage and profile helpers. |
| `src/apps/domain/echo-app.ts` | Minimal text echo domain app. |
| `src/apps/domain/workflow-app.ts` | Example workflow app demonstrating timers and agent messaging. |
| `src/apps/system/app-manager-app.ts` | App install, uninstall, and listing operations as signals. |
| `src/apps/system/planner-app.ts` | Planner app that turns plan steps into todo signals. |
| `src/apps/system/router-app.ts` | Deterministic rule-based routing app with conversation state. |
| `src/apps/system/todo-app.ts` | Small in-memory todo tracker app. |

## Model and SDK submodules

| File | Responsibility |
| --- | --- |
| `src/models/provider-registry.ts` | Provider registration and provider description surface. |
| `src/models/openai-compatible-provider.ts` | Streaming OpenAI-compatible chat completions adapter with tool and vision support. |
| `src/sdk/create-runtime.ts` | Opinionated runtime constructor that wires built-ins, persistence, and providers. |
| `src/sdk/dispatch-handle.ts` | Result and event handle returned by runtime send APIs. |

## CLI submodules

| File or folder | Responsibility |
| --- | --- |
| `src/cli/runtime-ui.ts` | Chooses Ink fullscreen mode or line mode and owns console startup/shutdown. |
| `src/cli/runtime-controller.ts` | High-level controller for commands, chat submission, persistence, and live entry generation. |
| `src/cli/ink-app.ts` | Ink application with history viewport, composer, and live transcript rendering. |
| `src/cli/default-runtime.ts` | Default local runtime wiring for the CLI, including apps and tools. |
| `src/cli/command-catalog.ts` | Slash command registry and help text. |
| `src/cli/command-parser.ts` | Slash command parsing and JSON payload parsing. |
| `src/cli/slash-commands.ts` | Slash command helpers and completion behavior. |
| `src/cli/transcript-layout.ts` | Transcript wrapping and viewport layout. |
| `src/cli/stream-manager.ts` | Streaming text aggregation for model deltas. |
| `src/cli/hooks/` | Ink-specific command input, history, and scroll helpers. |

## Tests as architecture references

The tests are useful documentation for expected behavior:

- `test/assistant-layer.test.ts`: transcript persistence and reply signals.
- `test/signal-routing.test.ts`: app-directed routing, inboxing, interrupts, and task dependencies.
- `test/runtime-persistence.test.ts`: session directory persistence and restore.
- `test/model-kernel.test.ts`: provider and tool-calling integration.
- `test/webhook-ingress.test.ts`: webhook API behavior and auth rules.
- `test/cli-controller.test.ts` and `test/cli-*.test.ts`: runtime controller and UI behavior.

## What to open first for common tasks

| Task | Start here |
| --- | --- |
| Understand runtime dispatch | `src/runtime/runtime.ts` |
| Understand how an app handles work | `src/agent/kernel.ts` and `src/agent/execution-context.ts` |
| Add a built-in app | `src/apps/types.ts`, `src/apps/builtin.ts`, and an app under `src/apps/system` or `src/apps/domain` |
| Debug task waits or dependencies | `src/kernel/task-runtime.ts` and `test/signal-routing.test.ts` |
| Debug CLI behavior | `src/cli/runtime-controller.ts` and `src/cli/ink-app.ts` |
