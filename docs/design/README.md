# Design Guide

The pages in this section explain why the system is shaped the way it is. They focus on concepts, module boundaries, and the mental model you should carry before diving into implementation details.

## Pages

- [System overview](system-overview.md): the core ideas, goals, and end-to-end mental model.
- [Module map](module-map.md): the codebase layout and what each top-level area is responsible for.
- [Agent kernel and apps](agent-kernel-and-apps.md): how agents are composed, how signals become tasks, and how apps plug into the kernel.
- [Built-in apps](built-in-apps.md): the built-in system and domain apps that ship with the runtime today.

## Design vocabulary

| Term | Meaning in this codebase |
| --- | --- |
| Agent | A long-lived worker container with its own policy, mailbox, memory, tools, scheduler, and installed apps. |
| Signal | The unified input primitive for messages, external events, timer firings, tool results, and replies. |
| Task | The unit of work created or resumed by a signal. |
| App | An installable capability module that handles routed signals on top of the kernel. |
| Conversation | A lightweight thread record that groups related signals and tasks. |
| Schedule | A persisted timer record for delayed, absolute, or recurring work. |
| Reply signal | An observer-facing signal published for subscribers such as the CLI. |

## How this section relates to the rest of the docs

The design docs tell you what the system is trying to achieve and how the major pieces relate.

The [architecture docs](../architecture/README.md) pick up from there and describe how those ideas are implemented in the current TypeScript codebase.
