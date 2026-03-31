# Built-in Apps

The runtime ships with a small catalog of built-in apps registered through `src/apps/builtin.ts`. They are intentionally small, but together they demonstrate the architectural direction of the system.

## Built-in catalog

| App ID | Kind | Purpose | Important signals |
| --- | --- | --- | --- |
| `domain.assistant` | domain | Chat assistant that uses model providers, transcript memory, and reply signals. | `text`, `assistant.configure`, `assistant.profile` |
| `domain.echo` | domain | Minimal text echo behavior used for simple agents and tests. | `text` |
| `domain.workflow` | domain | Example workflow app for timers and agent-to-agent messaging. | `workflow.start`, `workflow.reminder`, `workflow.ping`, `workflow.pong` |
| `system.app-manager` | system | Signal-driven app install and uninstall surface. | `app.install`, `app.uninstall`, `app.listAvailable`, `app.listInstalled` |
| `system.planner` | system | Turns step lists into todo signals. | `planner.plan` |
| `system.router` | system | Deterministic rule-based router with conversation state. | `router.configure`, `router.route`, `router.resetConversation` |
| `system.todo` | system | Small todo list store in app memory. | `todo.add`, `todo.complete`, `todo.list` |

## Domain apps

### `domain.assistant`

This is the most important built-in app for day-to-day usage.

- installs a default assistant profile on `onInstall()`
- handles plain `text` signals as user turns
- stores transcript state in conversation memory
- stores assistant configuration in app memory
- calls `context.models.run()` to generate a reply
- publishes `assistant.reply` signals for subscribers such as the CLI

It is the bridge between the generic runtime and the "chat with an agent" experience.

### `domain.echo`

`domain.echo` is deliberately tiny. It:

- accepts `text`
- writes the last echoed text into agent and conversation memory
- completes immediately with a structured result

This app is valuable because it demonstrates the smallest useful app surface and is used by the CLI for generic new agents when no default installed apps are present.

### `domain.workflow`

`domain.workflow` is an example of how a domain app can use multiple kernel services:

- `workflow.start` optionally creates a delayed reminder
- task memory stores the note while the task waits
- `workflow.reminder` resumes the waiting task via a timer signal
- `workflow.ping` and `workflow.pong` demonstrate agent-to-agent messaging

It exists mainly as a reference implementation for timers, waits, and messaging.

## System apps

### `system.app-manager`

This app exposes app management through signals instead of special-case kernel APIs at the app layer.

- install an app by sending `app.install`
- uninstall an app with `app.uninstall`
- inspect available and installed apps through `app.listAvailable` and `app.listInstalled`

The kernel still enforces policy; the app-manager simply provides a conventional control surface.

### `system.planner`

The planner is intentionally narrow:

- it accepts `planner.plan`
- it interprets `payload.steps` or `payload.items`
- it emits `todo.add` signals to `system.todo`

The interesting part is architectural rather than algorithmic: system apps can collaborate through signals just like any other runtime participant.

### `system.router`

The router app stores routing rules in app memory and simple conversation-local routing state in conversation memory.

- rules are configured with `router.configure`
- `router.route` evaluates the first matching rule
- the conversation records the last route, rule ID, input, and turn count
- `router.resetConversation` clears that conversation-local state

This app demonstrates deterministic, non-LLM routing built on top of the shared runtime model.

### `system.todo`

The todo app stores todo items inside app memory. It is small by design:

- `todo.add` creates an item
- `todo.complete` marks an item as done
- `todo.list` returns all current items

It is useful as both a demo and a building block for planner-driven workflows.

## Registration and installation model

Built-in apps are regular app definitions. They are:

1. defined in their own files
2. collected in `builtinAppDefinitions`
3. registered onto a runtime through `registerBuiltinApps()`
4. installed onto an agent only when requested directly or via runtime defaults

That distinction matters:

- **registration** makes an app available in the registry
- **installation** makes an app active on a specific agent

## Design takeaways

The built-in apps show three important design choices:

- the kernel stays generic and reusable
- higher-level behaviors are expressed as apps and signals
- even "system" capabilities use the same runtime mechanics as domain behavior
