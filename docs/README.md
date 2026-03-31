# Project Documentation

This directory documents the `agents` runtime implemented in this repository. The project is a message-driven framework for building long-lived, collaborative agents, plus a terminal UI and SDK for operating those agents locally.

## What lives here

- `design/`: conceptual documentation for the whole system, its layers, and its major submodules.
- `architecture/`: implementation-oriented documentation for runtime mechanics, kernel services, CLI/SDK surfaces, model/tool integration, and persistence.
- `features/`: focused guides for important user-facing or developer-facing capabilities.

## Recommended reading paths

### New to the project

1. [System overview](design/system-overview.md)
2. [Module map](design/module-map.md)
3. [Agent kernel and apps](design/agent-kernel-and-apps.md)
4. [Runtime lifecycle](architecture/runtime-lifecycle.md)

### Extending the runtime

1. [Module map](design/module-map.md)
2. [Built-in apps](design/built-in-apps.md)
3. [Kernel services](architecture/kernel-services.md)
4. [Models, tools, and providers](architecture/models-tools-and-providers.md)

### Operating the local console

1. [CLI and SDK](architecture/cli-and-sdk.md)
2. [Assistant layer](features/assistant-layer.md)
3. [Session persistence](features/session-persistence.md)

## Documentation index

### Design

- [Design guide](design/README.md)
- [System overview](design/system-overview.md)
- [Module map](design/module-map.md)
- [Agent kernel and apps](design/agent-kernel-and-apps.md)
- [Built-in apps](design/built-in-apps.md)

### Architecture

- [Architecture guide](architecture/README.md)
- [Runtime lifecycle](architecture/runtime-lifecycle.md)
- [Kernel services](architecture/kernel-services.md)
- [Models, tools, and providers](architecture/models-tools-and-providers.md)
- [CLI and SDK](architecture/cli-and-sdk.md)
- [Persistence and observability](architecture/persistence-and-observability.md)

### Features

- [Assistant layer](features/assistant-layer.md)
- [Signal routing and task waits](features/signal-routing-and-task-waits.md)
- [Session persistence](features/session-persistence.md)
- [Webhook ingress](features/webhook-ingress.md)

## Repository entrypoints

- `README.md`: quick start and high-level package overview.
- `src/index.ts`: public export surface for the library.
- `bin/agents.ts`: CLI entrypoint.
- `src/sdk/create-runtime.ts`: ergonomic runtime constructor.
- `src/runtime/runtime.ts`: the multi-agent host.

## Common local checks

These are the main validation commands for the repository:

- `npm run typecheck`
- `npm test`
