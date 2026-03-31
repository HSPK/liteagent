# Signal Routing and Task Waits

One of the most important features in this runtime is that apps can direct how signals interact with tasks instead of relying on a one-size-fits-all "every signal spawns work" rule.

## Routing decisions

Apps can optionally implement `routeSignal(context, signal)` and return one of these decisions:

| Decision | Meaning |
| --- | --- |
| `spawn` | Create a new task for this signal. |
| `resume` | Resume an existing task immediately. |
| `queue` | Put the signal into a task inbox without waking it yet. |
| `interrupt` | Queue the signal and deliver a synthetic interrupt so the task can react mid-wait. |
| `ignore` | Do nothing. |

This gives apps control over whether a new signal is a new unit of work, extra context for existing work, or something to discard.

## Waiting for future signals

Tasks can move into a `waiting` state with matchers that describe which future signals should wake them up.

That supports patterns like:

- wait for a specific timer signal
- wait for a specific tool result
- wait for a follow-up event in the same conversation
- wait for a message that matches a target task or signal pattern

The task runtime indexes waiting tasks so resumable matches can be found efficiently.

## Waiting on task dependencies

Tasks can also wait on other tasks through `awaitTasks()`.

The flow is:

1. task A calls `awaitTasks([taskB])`
2. task A records dependency wait metadata
3. task B completes, fails, or is cancelled
4. the task runtime marks dependency progress
5. when all dependencies are resolved, task A receives a dependency-ready event and can resume

This is how the runtime expresses intra-agent task coordination without introducing a separate workflow engine.

## Task inboxes

Queued signals are stored in a task inbox. Apps can later:

- inspect the inbox
- drain the accumulated context
- leave the task waiting if it still is not ready to proceed

This is particularly useful when a task wants to keep gathering context while still waiting on some other condition.

## Interrupts

An interrupt is stronger than plain queueing:

- the extra signal is still preserved in the task inbox
- the kernel also wakes the task with a synthetic interrupt signal

That gives apps a way to implement "continue waiting, but reconsider now because new context arrived."

## Timers and tool calls fit the same model

The design becomes especially powerful because timers and tool results also re-enter the system as signals.

That means:

- timers resume tasks through normal signal matching
- tool results can resume tasks through normal signal matching
- app logic does not need separate continuation machinery for each subsystem

Everything is routed through the same task runtime.

## Why this feature matters

This routing and waiting model is what makes the runtime feel like a true agent runtime rather than a thin RPC wrapper.

It enables:

- concurrent logical work inside one agent
- explicit dependency tracking
- deferred context accumulation
- durable wait states
- clearer task histories for debugging and UI rendering
