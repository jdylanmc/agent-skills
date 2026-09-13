---
name: the-roastmaster
description: "Legacy model-route metadata retained for already confirmed delivery review policies."
purpose: "Preserve explicit caller route receipts while the invoking Roast agent owns reconciliation."
agent-type: general-purpose
model: claude-opus-5
fallback-capability: high-capability
fallback-models: ["gpt-5.6-sol", "claude-sonnet-5", "gpt-5.5"]
reasoning-effort: max
context-tier: long_context
tools: ["read", "search"]
persona: ./persona.md
directive: ./directive.md
---

# Existing Route Metadata

This entry supports saved caller model-policy resolution. It is not a command
to spawn a coordinator or synthesizer. The current Roast entry workflow owns
reviewer dispatch, evidence checks, reconciliation and presentation.

If a saved policy requires separate invocations, clarify the policy change.
Never claim a model or reviewer ran merely because this route resolved.
