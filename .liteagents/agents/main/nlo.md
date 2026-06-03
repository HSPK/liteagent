---
{
  "spawn": [
    { "name": "review", "role": "review" },
    { "name": "tool-call-check", "role": "tool-call-check" }
  ],
  "heartbeat": { "intervalMs": 10000 }
}
---

# Main agent (NLO)

High-level guidance for the main orchestrator.

On startup this agent asks the runtime to:

1. create a `review` agent that reviews the output of other agents, and
2. create a `tool-call-check` agent that validates tool calls before they run.

It then relies on a runtime heartbeat alarm delivered every 10 seconds to stay
alive and coordinate the spawned agents.

The `nlo.md` frontmatter is the executable orchestration plan; this body is the
natural-language guidance that describes intent.
