---
name: unit-decomposition
description: Choose the smallest cohesive skill structure, extracting justified units locally and following ADR 0001 for shared promotion.
level: atom
allowed-tools: ["read","search","edit"]
includes: []
composes: []
used-by: ["create-skill/_molecules/skill-package-design/skill-package-design.md"]
---

# Unit Decomposition

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `scope-contract` | yes | The approved one-job skill boundary and routing contract. |
| `candidate-workflow` | yes | The operations the new skill must perform. |
| `known-consumers` | no | Other current or explicitly approved skill designs that would compose a proposed unit. |

## Operation

1. Keep a short, cohesive workflow in `SKILL.md` with its routing metadata,
   required references, output contract, and boundaries. Extract only for actual
   reuse, a meaningful enforcement boundary, or substantial independently useful
   detail. Do not create forwarding layers to satisfy a unit quota.
2. For each justified atom, keep one caller-visible operation that does not
   compose other units, at `skills/<skill>/_atoms/<name>/<name>.md`.
3. For each justified molecule, compose two or more atoms or molecules at
   `skills/<skill>/_molecules/<name>/<name>.md`.
4. Apply ADR 0001 local-first. A new unit starts local to this first consumer.
   Promote to `skills/_base/` only when at least two current skills or
   explicitly approved skill designs compose it and the promotion is reviewed.
5. Use same-named unit roots. A unit is exactly one Markdown file named after
   the root directory; support files sit beside it and share the unit basename,
   such as `<name>.mjs` or `<name>.test.mjs`.
6. Do not compose another skill's local units. A local molecule may compose its
   own skill's units and shared `_base` units only.
7. When extracting behavior from existing text, perform a union audit: diff each
   removed line against its new home and preserve the strictest rule rather than
   the most common wording.

## Output

| Field | Meaning |
| --- | --- |
| `package_tree` | The proposed `skills/<skill>/` file tree. |
| `atoms` | Each justified atom and its operation, or an empty list. |
| `molecules` | Each justified molecule and its direct units, or an empty list. |
| `wrapper_responsibilities` | What remains in `SKILL.md`. |
| `promotion_decisions` | Why every new unit remains local or why a reviewed `_base` promotion is justified. |

## Guarantees

- No local atoms or molecules are required for a short, cohesive workflow.
- First-consumer units stay local to the new skill.
- Every molecule composes at least two units.
- Unit roots, file names, and support-file names match the validator's shape.
- Strict source rules survive extraction.

## Boundaries

This atom does not write generated fields, register tests, run validation, or
promote units to `_base` without an explicit reviewed two-consumer rationale.
