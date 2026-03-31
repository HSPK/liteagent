# Kernel Services

`AgentKernel` is the architectural center of the repository. It composes the services that turn a raw signal stream into structured, inspectable task execution.

## Service inventory

| Service | Source | Role |
| --- | --- | --- |
| Mailbox | `src/kernel/mailbox.ts` | Serializes signal handling and exposes idle detection. |
| Task runtime | `src/kernel/task-runtime.ts` | Creates tasks, records task events, handles waits, dependency tracking, and inbox queues. |
| Conversation service | `src/kernel/conversation-service.ts` | Records conversation participants, last signal, last task, and related IDs. |
| Memory service | `src/kernel/memory.ts` | Provides scoped state storage and snapshot/restore. |
| Tool access | `src/kernel/tool-access.ts` | Registers tools, lists tool specs, and guards calls through policy. |
| Model access | `src/kernel/model-access.ts` | Lists providers, streams responses, and runs tool loops. |
| Scheduler | `src/kernel/scheduler/scheduler-service.ts` | Handles delay, absolute, and recurring schedules plus restore. |
| App host | `src/apps/app-host.ts` | Stores installed app instances and sorts them by priority. |
| Self model | `src/kernel/self-model.ts` | Builds an inspectable description of the agent and records history. |
| Policy | `src/kernel/policy/agent-policy.ts` | Enforces tool, model, app, task, and schedule boundaries. |

## The mailbox contract

Every signal enters the mailbox first. The mailbox guarantees serialized processing per agent, which gives the rest of the system strong assumptions:

- task state is not mutated concurrently by two signal handlers
- task event ordering is stable
- snapshot and observability logic can reason about one step at a time

This is the main reason tasks can safely wait, resume, queue extra context, and restore from snapshots.

## Signal processing flow

The kernel's main loop can be summarized as:

1. receive a signal from the runtime or scheduler
2. record conversation and self-model updates
3. find the target app or scan installed apps by priority
4. ask the app for an optional routing decision
5. create or resume a task
6. build an execution context for the task
7. call the app's `onSignal()`
8. record task completion, failure, cancellation, or wait state
9. emit task and kernel events for higher layers

## Task runtime details

The task runtime is more than a task list. It manages:

- task creation and resumption
- task state transitions
- wait metadata
- inboxed deferred signals
- dependency tracking
- task event history
- snapshot and restore

### Task states

Tasks move through:

- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`

### Wait strategies

Tasks can wait in multiple ways:

- on one or more future signals matched by `resumeOnSignals`
- on other task IDs through `awaitTasks()`
- on timer-delivered signals
- on tool result signals when tool execution is routed through signals

### Task inboxes

Waiting tasks can accumulate extra signals in an inbox. Apps can later:

- list the inbox
- peek the next queued signal
- drain the inbox
- clear the inbox
- inspect inbox size

This is how the runtime supports "keep waiting, but remember this extra context."

## Memory model

The memory service exposes the following built-in scopes:

- `agent`
- `app`
- `task`
- `conversation`

It also supports arbitrary named scopes. Each scope is map-like and supports:

- `get`
- `set`
- `delete`
- `entries`
- `merge`
- `clear`

Memory is included in agent snapshots, which is why app configuration, conversation transcripts, and task-local workflow state can survive restore.

## Conversation service

Conversations are lightweight records, but they matter for routing and UX. The conversation service tracks:

- conversation ID
- participants
- signal count
- app IDs involved
- task IDs involved
- last signal summary
- last task summary

This is enough for the assistant layer, router state, and dispatch handles to reason about thread-local work without introducing a heavy workflow abstraction.

## Scheduler service

The scheduler is the kernel's time subsystem. It supports:

- one-shot delays
- absolute timestamps
- recurring schedules
- cancellation
- restore from snapshots

When a schedule fires, it creates a new timer signal and feeds it back into the agent's normal signal path. That is an important architectural choice: timer work is not a separate side channel.

## Policy enforcement

`AgentPolicy` is consulted before the kernel allows:

- tool calls
- model provider usage
- app hosting and app installation
- new task creation
- schedule creation, including recurring schedules and minimum interval rules

Policy denial is not just a thrown exception. The kernel also emits policy-related observed events so higher layers can surface those failures.

## Execution context surface

Apps execute against structured syscall-like facades rather than the raw runtime object.

The execution context includes:

- `task`: inspect, update, wait, await tasks, and access the task inbox
- `tasks`: list and get tasks
- `memory`: agent/app/task/conversation scopes plus snapshot access
- `tools`: list specs, call directly, or request signal-based execution
- `models`: list, stream, generate, and run
- `scheduler` and `timers`: delay, at, recurring, cancel, list
- `signals`: emit to self, publish replies, send messages, emit events
- `apps`: list, install, and uninstall apps
- `self`: describe the agent and inspect self-model history

This shape is one of the strongest design decisions in the codebase because it keeps apps powerful without making them depend on private runtime internals.

## App host versus app registry

These two concepts are deliberately separate:

- the **app registry** stores definitions that can create apps
- the **app host** stores installed app instances on a specific agent

The registry answers "what can be installed?"

The host answers "what is currently installed here, and in what priority order?"

## Self model

The self-model provides an inspectable summary of the current agent:

- policy description
- installed apps
- current tasks
- current conversations
- schedules
- tools
- models
- memory summary
- history of important changes

This supports both operator inspection and future app-level reflective behavior.
