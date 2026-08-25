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
| `gaps` | no | Requirements with no practical proof, each with a reason. |

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
| `gaps` | The map is internally consistent, and at least one requirement has no proof. |
| `invalid` | The map cannot be trusted: duplicate identities, references to things that were never declared, empty or duplicated rows, evidence traced to nothing, or a gap that contradicts a link. |

Findings are `duplicate-requirement-id`, `duplicate-evidence-id`,
`unknown-requirement`, `unknown-evidence`, `unknown-evidence-kind`,
`unknown-gap-requirement`, `duplicate-row`, `empty-row`, `orphan-evidence`,
`contradictory-gap`, `gap-without-reason`, and `undeclared-gap`.

## Known Verification Gaps

A requirement with no practical proof is declared as a gap with a reason. An
uncovered requirement with no declared gap raises `undeclared-gap`, because the
difference between "we decided not to prove this and here is why" and "nobody
noticed" is the whole value of the map.

A gap is a statement of the current design, not a permanent one. Say what would
have to change for the requirement to become provable.

## A Row Is Not Proof

Every report carries `proof.linkageOnly`. A row records that somebody intended a
requirement to be proven by a named check. It is not evidence that the check was
written, that it runs, that it binds to anything, or that it passes.

This matters because a full map is the most convincing-looking artifact this
workflow produces, and it is convincing before a single line of the system
exists. Treating a complete map as coverage is the specific mistake this field
exists to prevent.

## Output

Return the reconciled map, coverage totals, uncovered requirements, declared
gaps with reasons, orphaned proofs, every finding, and the statement that
linkage is not evidence.

## Boundaries

This atom does not execute, collect, or interpret evidence, and it does not
decide whether a requirement is satisfied. It does not close a gap by relaxing
a requirement or by pointing it at a check that proves something else.
