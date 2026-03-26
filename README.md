# LiteAgent

LiteAgent is an agent framework that put developer experience first. It creates agents that act independently, having their own loop, memory, tools, and more. It is designed to be simple to use, flexible, and powerful.

## Core Concepts

- **Runtime**: The runtime is where agents live, it provides lifecycle management for agents, shared memory, tools, and more.
- **Agent**: An agent is an independent entity that accept instruction all the time, even when it is executing a task. It has its own memory, tools, and more. It can also create sub-agents to help it with tasks.
- **NameSpace**: A namespace is the name of an agent, it is used to identify an agent and its groups, e.g. `/developer/architect` is the namespace of an agent named `architect` under the `developer` group.
- **Task**: A task is a unit of work that an agent can execute. It can be anything from a simple function call to a complex workflow.

```
Runtime
 ├── Agent (has: Identity, Memory, Tools, Policy)
 │    ├── receives: Signal
 │    ├── creates: Plan → Task(s) → Artifact(s)
 │    ├── communicates via: Channel
 │    └── carries: Context (per execution chain)
 ├── NameSpace (organizes Agents)
 └── Policy (governs behavior boundaries)
```

