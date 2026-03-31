# Architecture Guide

These pages describe the current implementation details of the runtime.

## Pages

- [Runtime lifecycle](runtime-lifecycle.md): runtime construction, agent creation, dispatch APIs, snapshots, and runtime events.
- [Kernel services](kernel-services.md): mailbox, tasks, memory, scheduler, conversations, policy, self-model, and app execution surfaces.
- [Models, tools, and providers](models-tools-and-providers.md): provider registry, OpenAI-compatible provider, tool execution, and default runtime tools.
- [CLI and SDK](cli-and-sdk.md): terminal console architecture, controller behavior, slash commands, and public ergonomic APIs.
- [Persistence and observability](persistence-and-observability.md): local session durability, autosave behavior, and runtime event recording.

## Reading order

If you are trying to understand the implementation from the inside out, the best order is:

1. [Runtime lifecycle](runtime-lifecycle.md)
2. [Kernel services](kernel-services.md)
3. [Models, tools, and providers](models-tools-and-providers.md)
4. [Persistence and observability](persistence-and-observability.md)
5. [CLI and SDK](cli-and-sdk.md)
