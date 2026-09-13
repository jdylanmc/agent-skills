# Intent: orchestration-handoff

Orchestration-handoff exists for an orchestrating agent that needs to preserve a worker assignment for another agent during a run. It is the agent-invoked mirror of the human-invoked handoff skill: the shared persistence guarantees are the same, but the context is a structured orchestration brief rather than a human continuation packet.

The skill should capture run identity, source and target agents, the task contract, inputs, constraints, assumptions, artifact references, acceptance criteria, and open questions in a stable versioned schema. That structure makes orchestration handoffs measurable over time and lets the schema evolve deliberately.

The persistence path should add the least risk to the existing human handoff core. The existing core already protects redaction, linked artifacts, temporary-path placement, guarded writes, and verified path reporting for schema version 1. A sibling orchestration persistence molecule can validate orchestration schema version 1, adapt it into the already-supported bounded handoff payload, and call the same core without weakening the strict validation that the human handoff depends on.

The skill must not be a user-facing command, conduct an interview about filename, destination, visibility, or placement, copy artifacts into the document, trust agent-authored content more than human-authored content, or write into the workspace. Its output is the exact created path and bounded persistence metadata, not the full handoff body.
