# Domain documentation

Layout: single-context repository.

Before exploring an area, read root `CONTEXT.md` when present and relevant
Architecture Decision Records (ADRs) under `docs/adr/`.
These records are optional and created lazily; their absence is not failed setup
or a reason to scaffold documents. Continue without missing-file warnings.

Use glossary terms from `CONTEXT.md` consistently. Note genuinely missing terms
for the authorized domain-modeling owner rather than inventing competing names.
Surface contradictions with an existing ADR explicitly; do not silently replace
an agreed decision.

Domain recording requires separate authorization and an owned delivery workspace.
Setup creates neither `CONTEXT.md` nor ADRs. Root `intent.md`, skill intents, and
doctrine sources remain human-owned and are not rewritten as domain guidance.
