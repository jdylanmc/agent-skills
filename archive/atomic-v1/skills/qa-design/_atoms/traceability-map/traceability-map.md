---
name: traceability-map
description: Map every requirement and business rule to the scenarios, procedures, and deterministic checks designed to prove it, reconcile the map, and record the requirements left with no practical proof.
level: atom
allowed-tools: ["execute"]
includes: ["qa-design/_atoms/traceability-map/traceability-map.mjs"]
composes: []
used-by: ["qa-design/_molecules/qa-contract/qa-contract.md"]
---

# Traceability Map

Link each requirement to what will prove it, and be explicit about what nothing
proves.

## Required Files

1. [Traceability reconciler](./traceability-map.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `requirements` | yes | Every requirement and business rule, by stable identity. |
| `evidence` | yes | Every designed proof, by stable identity and kind. |
| `rows` | yes | The requirement-to-evidence links. |
| `gaps` | no | Aspects with no practical proof, each with the requirement, the aspect, and a reason. |

Evidence kinds are `deterministic-check`, `example-rule`, `gherkin-scenario`,
and `system-procedure`.

## Reconciliation

```text
echo '{"requirements": [ ... ], "evidence": [ ... ], "rows": [ ... ], "gaps": [ ... ]}' \
  | node skills/qa-design/_atoms/traceability-map/traceability-map.mjs
```

The helper returns `complete`, `gaps`, or `invalid`.

| Status | Meaning |
| --- | --- |
| `complete` | Every requirement is linked to at least one proof, every proof is linked to a requirement, and no gap is declared. |
| `gaps` | The map is internally consistent, and something is left unproven: a whole requirement, or an aspect of one. |
| `invalid` | The map cannot be trusted: duplicate identities, references to things that were never declared, empty or duplicated rows, evidence traced to nothing, or a gap that contradicts a link. |

Findings are `duplicate-requirement-id`, `duplicate-evidence-id`,
`unknown-requirement`, `unknown-evidence`, `unknown-evidence-kind`,
`unknown-gap-requirement`, `duplicate-row`, `empty-row`, `orphan-evidence`,
`contradictory-gap`, `gap-without-reason`, `gap-without-aspect`,
`duplicate-gap`, and `undeclared-gap`.

## Coverage Is Three-Valued

A requirement is rarely all proven or all unproven. The ordinary case is a rule
whose success path has a scenario and whose recovery path has nothing, and a
two-valued map has to lie about it in one direction or the other: call the
requirement covered and the residual gap disappears, or call it uncovered and
the scenario that does exist stops counting.

| Coverage | Meaning |
| --- | --- |
| `covered` | Traced to evidence, with no gap declared against it. |
| `partiallyCovered` | Traced to evidence, and carrying at least one scoped gap. |
| `uncovered` | Traced to no evidence at all. |

## Known Verification Gaps

Every gap names three things: the requirement, the **aspect** it leaves
unproven, and the reason.

| Aspect | Use when |
| --- | --- |
| `whole-requirement` | Nothing about the requirement is proven. Contradicts any evidence traced to it. |
| An example class such as `recovery` or `boundary` | One class of behavior is unproven while the rest is covered. Preferred. |
| Another named aspect of the requirement | The unproven part is real but does not fall on a class boundary. Name the behavior, not the difficulty. |

Prefer the scoped forms. `whole-requirement` is the blunt instrument, and a gap
recorded at that granularity when only the recovery path is missing throws away
the coverage that exists. The report marks whether each gap used the preferred
vocabulary; it does not reject a named aspect, because real gaps do not always
land on a class boundary.

An uncovered requirement with no `whole-requirement` gap raises
`undeclared-gap`, because the difference between "we decided not to prove this
and here is why" and "nobody noticed" is the whole value of the map. Scoped gaps
do not account for a requirement that nothing proves at all; they describe what
is missing from coverage that exists.

A gap is a statement of the current design, not a permanent one. Say what would
have to change for the aspect to become provable.

## Exit Codes

Every helper in this package uses the same three codes.

| Code | Meaning |
| --- | --- |
| `0` | The input was accepted and raised no finding. |
| `2` | The input was accepted and raised findings. |
| `1` | The input was refused and nothing was reconciled. |

The code reports findings, not disposition. A map that is honest about a
declared gap exits `0` and says `gaps` in `status`, so read `status` for
coverage and the exit code for whether the map itself needs fixing.

## A Row Is Not Proof

Every report carries `proof.linkageOnly`. A row records that somebody intended a
requirement to be proven by a named check. It is not evidence that the check was
written, that it runs, that it binds to anything, or that it passes.

This matters because a full map is the most convincing-looking artifact this
workflow produces, and it is convincing before a single line of the system
exists. Treating a complete map as coverage is the specific mistake this field
exists to prevent.

## Output

Return the reconciled map, coverage totals, partially covered and uncovered
requirements, declared gaps with their aspects and reasons, orphaned proofs,
every finding, and the statement that linkage is not evidence.

## Boundaries

This atom does not execute, collect, or interpret evidence, and it does not
decide whether a requirement is satisfied. It does not close a gap by relaxing
a requirement or by pointing it at a check that proves something else.
