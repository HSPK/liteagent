# Agent Kernel and Apps

This document explains the core composition pattern used throughout the repository: an agent is a thin facade over a kernel, and most meaningful behavior lives in installable apps.

## The agent is a facade

`src/agent/agent.ts` intentionally stays small. It exposes ergonomic methods such as:

- `event()`
- `text()`
- `message()`
- `tell()`
- `installAppById()`
- `registerTool()`
- `describeSelf()`
- `snapshotState()` / `restoreState()`

The heavy lifting happens in `AgentKernel`.

## Kernel composition

The kernel is assembled from focused services rather than one monolith.

| Kernel service | Purpose |
| --- | --- |
| Mailbox | Serializes signal handling for a single agent. |
| Task runtime | Tracks tasks, waits, dependency state, task events, and task inboxes. |
| Conversation service | Records lightweight thread state such as participants, last signal, and last task. |
| Memory service | Exposes scoped state for agent, app, task, conversation, and named spaces. |
| Tool access | Registers tools and enforces policy at call time. |
| Model access | Exposes provider-backed `stream()`, `generate()`, and `run()` APIs. |
| Scheduler | Creates and restores delayed, absolute, and recurring schedules. |
| App host | Owns installed app instances and their priority ordering. |
| Self model | Builds introspection views and records important changes over time. |

## Signal handling model

Signals are received by the runtime, delivered to the target agent, and queued in that agent's mailbox. The mailbox guarantees serialized processing per agent, which means:

- the system never runs two signal-processing steps at the same time inside one agent
- multiple tasks can exist at once, but task progress is advanced through one mailbox-driven step at a time
- waiting tasks are resumed by future signals instead of by ad hoc callbacks

That design keeps task state and event history coherent.

## App selection and routing

Apps are consulted in priority order. The kernel can target a specific app through `signal.targetAppId`, or it can ask installed apps whether they can handle the signal.

Apps have two important decision surfaces:

- `canHandle(signal)`: a fast eligibility check
- `routeSignal(context, signal)`: an optional routing decision that can override default task behavior

Routing decisions can:

- `spawn` a new task
- `resume` an existing task
- `queue` a signal into a waiting task's inbox
- `interrupt` a waiting task by queueing the signal and sending a synthetic interrupt signal
- `ignore` the signal

This is the key idea behind the runtime's app-directed control flow: the kernel owns invariants, but apps can influence how work is resumed.

## Execution contexts

Apps do not get raw access to the runtime internals. Instead, the kernel builds three focused context shapes:

| Context | When used | What it exposes |
| --- | --- | --- |
| Lifecycle context | During `onInstall()` | self description, installed/available apps, model list, and memory scopes |
| Routing context | During `routeSignal()` | task listings, resumable task lookup, task inbox helpers, and memory scopes |
| Execution context | During `onSignal()` | task control, memory, tools, models, scheduler, signals, apps, and self-model APIs |

The execution context is intentionally syscall-like. It gives apps the ability to do real work without leaking the entire runtime object.

## Task lifecycle

Tasks are first-class records, not implicit closures. A task can move through these states:

- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`

Each task also carries:

- its `conversationId`
- the list of signal IDs that touched it
- wait metadata and resume matchers
- queued inbox signals
- task event history
- result or error payloads

This is why waiting, dependencies, interrupts, and restores all work through the same data model.

## Memory scopes

Apps are expected to choose the narrowest memory scope that matches their behavior:

- use **agent memory** for broad agent-level facts and last-known summaries
- use **app memory** for installed-app configuration
- use **task memory** for state that exists only while a task is alive
- use **conversation memory** for thread-local state such as assistant transcripts or router turn counts
- use **named scopes** for shared structures that do not fit the built-in categories

This keeps state durable and inspectable without forcing everything into one map.

## Policy and boundaries

`AgentPolicy` constrains what an agent may do:

- which tools it may call
- which model providers it may use
- which apps it may host or install
- how many active tasks it may have
- how many schedules it may create and whether recurring schedules are allowed

The kernel checks policy before performing sensitive actions. Apps can request work, but the kernel is the final enforcement point.

## Self-model and transparency

The self-model is a practical introspection service, not a vague conceptual layer. It exposes:

- installed apps
- task list
- conversation list
- schedules
- tools
- model providers
- memory summary
- a history of significant changes

This gives both humans and higher-level apps a way to understand how an agent is currently assembled and what it has been doing.

## Why the app model matters

The runtime deliberately keeps things like todo management, planning, routing rules, and assistant behavior out of the kernel. That makes the kernel stable and reusable while still allowing sophisticated behavior to emerge from apps.

In short:

- the **kernel** answers how the agent executes work safely over time
- the **apps** answer what the agent is trying to do
