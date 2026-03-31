# System Overview

`agents` is a message-driven runtime for building collaborative, long-lived agents. The codebase treats agents less like one-shot function calls and more like durable workers that keep state, accept new input over time, and coordinate through a shared runtime.

## Design goals

The current implementation is optimized for the runtime model first.

- **Long-lived agents**: each agent keeps its own policy, mailbox, memory, tools, scheduler, and installed apps.
- **Unified input model**: messages, external events, timers, and callbacks all enter the system as signals.
- **Composable behavior**: the kernel stays small while apps provide higher-level behavior.
- **Time-aware execution**: waiting, reminders, recurring schedules, and timeout-driven resumes are part of the model, not bolted on.
- **Inspectable state**: the system exposes task events, runtime events, memory summaries, app lists, and self-model history for debugging and UI layers.
- **Local-first durability**: snapshots, state backends, and JSONL observability support restartable local sessions.

## Layered system model

The runtime is organized into a small set of layers:

| Layer | Responsibility |
| --- | --- |
| Runtime | Hosts all agents, routes signals, wires persistence and observability, and exposes high-level send APIs. |
| Agent facade | Provides ergonomic methods such as `text()`, `message()`, `installAppById()`, and inspection helpers. |
| Agent kernel | Implements mailbox processing, task runtime, memory, scheduler, tools, models, policy enforcement, conversations, and self-model state. |
| Apps | Installable system and domain capabilities that decide what work to do when a signal arrives. |
| CLI and SDK | Offer operator-facing and developer-facing entrypoints for interacting with the runtime. |

## Core primitives

### Signal

Signals are the universal input shape. A signal can represent:

- an agent-to-agent message
- an external event
- a timer firing
- a tool result
- a reply published for observers

The advantage of this model is that all external and internal stimuli go through the same routing and task lifecycle.

### Task

A task is the unit of execution inside an agent. Tasks can:

- start from a new signal
- resume from a matching signal
- wait on future signals
- wait on dependency tasks
- accumulate deferred signals in an inbox
- complete, fail, or cancel with recorded task events

### Memory

Memory is scoped rather than global-only. The runtime ships with built-in scopes for:

- `agent`
- `app`
- `task`
- `conversation`

It also supports arbitrary named scopes. This lets apps store state at the narrowest useful boundary.

### App

Apps are installable behavior modules with a manifest and an `onSignal()` handler. They can optionally provide:

- `canHandle()` to declare whether they care about a signal
- `routeSignal()` to direct whether a signal should spawn, resume, queue, interrupt, or ignore task work
- `onInstall()` to seed memory or perform setup

## End-to-end execution model

At a high level, the system works like this:

```text
message / event / timer / reply
              |
              v
           signal
              |
              v
      AgentsRuntime dispatch
              |
              v
        target agent mailbox
              |
              v
        app selection + routing
              |
              v
        task create or resume
              |
              v
 memory / tools / models / scheduler / messages
              |
              v
      more signals or published replies
```

## Current implementation shape

The current codebase is intentionally pragmatic:

- It is **single-process and local-first**.
- Each agent currently processes signals through a **serialized mailbox**, so one task step runs at a time per agent even though multiple tasks can exist.
- Persistence focuses on **snapshots and local session recovery**, not mailbox replay or distributed recovery.
- Conversations are real and useful, but still **lightweight thread records** rather than full workflow objects.
- The main operator interface is a **TTY-first CLI** built with Ink, plus a line-mode fallback.

## What is in scope today

The system already supports the most important runtime loops:

- multiple agents in one runtime
- built-in apps such as assistant, todo, planner, router, and workflow
- task waits on signals and task dependencies
- delayed, absolute, and recurring schedules
- model provider registration with tool-calling support
- local persistence and runtime event observability
- external webhook ingress

## What is intentionally not solved yet

These are outside the current MVP boundary:

- distributed execution or horizontal sharding
- replicated logs or mailbox replay
- remote app registries or signed package distribution
- enterprise-grade auth, quotas, or multi-tenant isolation
- a web UI in this repository

Those omissions are important: the current architecture is designed to make those evolutions possible later without overcomplicating the first working runtime.
