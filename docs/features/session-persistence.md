# Session Persistence

The runtime supports local session persistence so agent state, tasks, conversations, schedules, and runtime metadata can survive process restarts.

## How persistence is enabled

The most common path is `createRuntime({ sessionDir })` or the CLI's `createCliRuntime()`, which sets a default session directory under `~/.agents`.

When `sessionDir` is configured, the SDK wires:

- `SessionDirectoryStateBackend` for snapshot persistence
- `JsonlFileObservabilityBackend` for runtime event history

`AgentsRuntime` also defaults `autoSave` to `true`. When a state backend exists, observed runtime events queue a debounced save through `RuntimeStateManager`.

## What gets persisted

The runtime snapshot includes each agent's:

- policy
- installed apps
- memory
- tasks and task event history
- conversations
- schedules
- self-model history

This is enough to recover local sessions in a practical way.

## Session directory layout

The session directory contains:

```text
runtime/
  state.json
  config.json
  events.jsonl
agents/
  <agentId>.json
```

`config.json` also stores lightweight runtime metadata such as CLI mode, workspace path, default assistant ID, and the default app/tool names configured by the CLI runtime.

## Save and restore flow

### Saving

Saving can happen:

- automatically, because runtime events queue autosave
- explicitly, through `runtime.saveState()` or `runtime.flushState()`
- on CLI shutdown, because the console persists state before exit

The current autosave path is debounced, so a dispatched signal is not guaranteed to be on disk immediately. For the strongest local durability point after a burst of work, wait for `runtime.whenIdle()` and then call `runtime.saveState()` or `runtime.flushState()`.

### Restoring

Restoring happens through:

- `runtime.loadState()` when a state backend is configured
- `runtime.restore(snapshot)` for in-memory snapshot usage

The default CLI controller loads state on startup before ensuring the default assistant exists.

## What this is good for

Session persistence is a good fit for:

- local development
- interactive CLI sessions
- debugging task flows across restarts
- preserving assistant transcript and router/task state between runs

## Current limits

Persistence is snapshot-based, so it does not currently provide:

- mailbox replay
- distributed coordination
- crash-consistent replay of every in-flight signal
- replicated durability guarantees

You should think of it as a strong local-session feature, not yet a distributed workflow engine.
