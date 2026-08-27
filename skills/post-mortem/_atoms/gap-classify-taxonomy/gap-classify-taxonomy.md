---
name: gap-classify-taxonomy
description: Classify an execution gap into the fixed eighteen-value taxonomy and record the moment it mattered, its impact, the available alternative, and the evidence that the alternative was feasible.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/postmortem-diagnose-session/postmortem-diagnose-session.md"]
---

# Gap Taxonomy

Turn an observed shortfall into a named, bounded gap, or admit that it is not
one yet.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `friction-signals` | no | Anchored friction events the gap may trace to. |
| `ledger` | yes | Anchored evidence for the session. |

## Operation

Use the closest category:

- `INTENT_MISS`
- `ABSTRACTION_MISMATCH`
- `TOO_THEORETICAL`
- `TOO_VERBOSE`
- `TOO_BRIEF`
- `MISSING_IMPLEMENTATION`
- `MISSING_DETERMINISM`
- `MISSED_CONTEXT`
- `MISSED_PATTERN`
- `MISSED_REUSE`
- `MISSED_SKILL_EXTRACTION`
- `PREMATURE_SOLUTION`
- `INSUFFICIENT_DEPTH`
- `INSUFFICIENT_STRUCTURE`
- `INSUFFICIENT_VALIDATION`
- `INSUFFICIENT_REINFORCEMENT`
- `TOOL_OR_RUNTIME_GAP`
- `INSTRUCTION_OR_ROUTING_GAP`

For each gap, name the moment it mattered, its impact, the available
alternative, and the evidence that the alternative was feasible.

## Output

Each gap records `id` from the `G` series, `category`, `statement_type`,
`impact`, `explanation`, `moment`, `evidence`, `available_alternative`,
`alternative_feasibility_evidence`, and `confidence`.

## Guarantees

- The category comes from the fixed list. No new category is invented.
- A gap without a nameable alternative is not asserted as a gap.

## Boundaries

If no specific alternative or validation test can be named, express a
mechanism-focused uncertainty as a root-cause hypothesis instead, or record the
evidence gap under limitations.
