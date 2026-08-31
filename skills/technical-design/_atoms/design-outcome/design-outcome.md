---
name: design-outcome
description: Deterministically reconcile technical-design inputs and outputs into complete, no-design-required, needs-decision, needs-evidence, or blocked.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Design Outcome

Resolve the design from its structured evidence rather than from an author's
claim that it is done.

## Required File

The resolver is owned by the composing engineering-design molecule:
`skills/technical-design/_molecules/engineering-design/engineering-design.mjs`.

It verifies:

- approved functional authority and exact requirement traceability;
- the Boolean design-impact result;
- the no-design-required gate;
- two viable, cited approaches per consequential decision;
- valid selections and ADR dispositions;
- citations for material claims and applicability decisions;
- proposed-only NFR authority;
- unresolved decisions and evidence gaps.

## Status

Resolve worst to best: `blocked`, `needs-decision`, `needs-evidence`,
`no-design-required`, `complete`.

The helper's exit code reports findings, not design status: `0` for accepted
input without findings, `2` for accepted input with findings, and `1` for
refused malformed input.

## Boundary

The resolver validates a packet. It does not approve architecture, approve
NFRs, edit artifacts, implement, or dispatch downstream work.
