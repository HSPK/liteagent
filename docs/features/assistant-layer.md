# Assistant Layer

The assistant layer is the main "chat with an agent" experience shipped by the runtime. It is implemented by `domain.assistant` plus the transcript/profile helpers in `src/apps/domain/assistant-transcript.ts`.

## What the assistant app does

`domain.assistant` turns generic text signals into conversational turns backed by model providers.

At a high level it:

1. loads the assistant profile from app memory
2. loads the transcript from conversation memory
3. appends the incoming user turn
4. resolves the selected provider and model
5. runs the model request, optionally with tools enabled
6. appends the assistant turn back into transcript memory
7. publishes an `assistant.reply` signal
8. completes the task with a structured reply payload

## Assistant profile

The assistant profile lives in app memory and contains the knobs that shape behavior.

| Field | Purpose |
| --- | --- |
| `name` | Human-friendly assistant label. |
| `systemPrompt` | Base instruction used when building model messages. |
| `provider` | Explicit provider selection. |
| `model` | Explicit model selection. |
| `tools` | Whether model tool calling is enabled. |
| `maxTranscriptMessages` | Rolling transcript window size. |

The app exposes two configuration signals:

- `assistant.configure`
- `assistant.profile`

## Transcript storage

Transcript state is conversation-scoped, not global.

That means:

- different conversations keep isolated assistant history
- the CLI can keep a stable conversation thread across multiple user messages
- transcript state survives snapshot/restore when conversation memory is persisted

The transcript helpers also normalize user turns, assistant turns, and message building for the provider call.

## Reply signals

The assistant does not only complete its task. It also publishes a reply signal with:

- `type: assistant.reply`
- reply text
- conversation ID
- task ID
- provider ID
- model
- transcript length
- optional error message

That published signal is what the CLI subscribes to for live chat rendering.

## Error behavior

The assistant app intentionally returns structured failures instead of silently swallowing them.

If provider resolution or model execution fails:

- the error message becomes reply text
- an `assistant.reply` signal is still published
- the reply payload includes `error`
- the task still completes with a structured failure-shaped result

This keeps the chat surface responsive while preserving the failure information.

## CLI integration

The default CLI runtime bootstraps an `assistant` agent with `domain.assistant` installed.

`RuntimeController.submitText()` checks whether the target agent has `domain.assistant` installed. If it does, text is sent directly to that app and the controller expects live `assistant.reply` events plus model streaming task events.

That is what makes the fullscreen Ink UI feel like an event-driven terminal chat rather than a synchronous request/response shell.

## Why this matters architecturally

The assistant layer is a good example of the repository's broader design:

- the kernel stays generic
- app memory stores configuration
- conversation memory stores thread state
- models and tools flow through shared kernel services
- UI updates are driven by published signals and task events

In other words, "assistant chat" is not special runtime code. It is an app built on the same primitives as everything else.
