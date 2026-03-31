# Persistence and Observability

The runtime has a clear split between **state persistence** and **event observability**.

## Snapshot-based persistence

Persistence currently revolves around snapshots.

`AgentsRuntime.snapshot()` collects:

- agent policy
- installed apps
- memory
- tasks
- conversations
- schedules
- self-model history

That snapshot becomes the unit written to state backends and later restored.

## RuntimeStateManager

`RuntimeStateManager` orchestrates autosave and manual save behavior.

Key behaviors:

- optional backend
- debounced `queueSave()` calls
- serialized in-flight saves
- `flush()` for explicit persistence
- `load()` for backend reads plus `state.loaded` event emission

When runtime autosave is enabled, observed runtime events queue saves automatically.

## Session directory backend

`SessionDirectoryStateBackend` is the main local durability backend.

When configured with `sessionDir`, the runtime writes:

```text
<sessionDir>/
  runtime/
    state.json
    config.json
    events.jsonl
  agents/
    <agentId>.json
```

### File roles

| File | Purpose |
| --- | --- |
| `runtime/state.json` | Full runtime snapshot. |
| `runtime/config.json` | Lightweight session metadata, agent list, and runtime config. |
| `runtime/events.jsonl` | Append-only observed runtime events via the JSONL observability backend. |
| `agents/<agentId>.json` | Per-agent snapshots, useful for inspection and tooling. |

The backend also removes stale per-agent JSON files when agents disappear from the latest snapshot.

## JSON and compatibility backends

The codebase still exposes compatibility-oriented names:

- `JsonFileStateBackend`
- `JsonFileRuntimeStore`

These are useful when you want file-backed snapshot persistence without the richer session directory layout.

## Observability backends

Observability is handled independently from snapshot state.

### In-memory backend

The default runtime backend keeps observed events in memory.

### JSONL backend

`JsonlFileObservabilityBackend` appends each observed event as a JSON line and can later query those events by filter.

This gives the runtime an append-only event history without coupling it to the snapshot file format.

## Runtime event taxonomy

The runtime currently records these major event types:

- `agent.created`
- `agent.disposed`
- `signal.dispatched`
- `signal.published`
- `task.event`
- `scheduler.event`
- `policy.event`
- `kernel.event`
- `state.saved`
- `state.loaded`
- `state.restored`

Consumers can:

- subscribe live via `runtime.subscribeEvents(...)`
- query stored events via `runtime.queryEvents(...)`

## Why the split matters

State snapshots answer:

> "What is the current durable state of the runtime?"

Observed events answer:

> "What happened over time while the runtime was running?"

Keeping those separate makes both mechanisms simpler.

## Current limits

The durability story is intentionally modest today:

- no mailbox replay
- no replicated log
- no distributed recovery
- no exactly-once delivery guarantees across crashes

What you do get is practical local session recovery and a durable event history that is good enough for local development, debugging, and operator tooling.
