---
name: design-impact
description: Determine mechanically whether approved functional intent requires an engineering design, and produce the only valid no-design-required gate.
level: atom
includes: []
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Design Impact

Make `no-design-required` explicit and reproducible.

## Impact Questions

Answer each with `true` or `false`, plus exact evidence, using these stable
identifiers:

- `boundaries`: introduces or changes a component, ownership boundary, trust boundary, data
  boundary, or process boundary;
- `interfaces`: introduces or changes an interface, schema, protocol, command, event, or
  externally observed contract;
- `state`: introduces or changes persisted state, state transitions, invariants,
  concurrency, ordering, or consistency;
- `failure-behavior`: introduces or changes failure, retry, recovery, degradation, or idempotency
  behavior;
- `compatibility-migration`: introduces or changes compatibility, migration, dependency, or versioning;
- `implementation-choice`: requires an engineering choice among multiple implementations;
- `cross-cutting-behavior`: changes security, privacy, observability, operations, rollout, rollback, or
  verification behavior.

`designRequired` is the Boolean OR of all answers. The resolver computes the
same value and refuses disagreement.

## No-Design-Required Gate

The disposition is available only when:

1. every impact answer is `false`;
2. every answer cites repository or Discovery evidence;
3. every functional requirement has one traceability row with no design
   section and with cited no-impact evidence;
4. there are no design decisions, material design claims, ADRs, proposed
   non-functional requirements, or unresolved engineering questions; and
5. the output explicitly says `no-design-required`.

Omission is never a disposition. A small implementation is not automatically a
no-design change.

## Boundary

This atom decides only whether a design artifact is required. It does not select
architecture or declare a requirement unnecessary.
