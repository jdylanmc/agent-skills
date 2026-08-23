---
name: unit-decomposition
description: Convert the scoped skill job into a local-first atom and molecule package structure that follows ADR 0001.
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

1. Keep the wrapper thin. `SKILL.md` holds routing metadata, the required
   references list, the high-level workflow, the output contract, and top-level
   boundaries.
2. Identify atoms as single caller-visible operations that do not compose other
   units. Create each atom at `skills/<skill>/_atoms/<name>/<name>.md`.
3. Identify molecules as ordered compositions of two or more atoms or molecules.
   Create each molecule at `skills/<skill>/_molecules/<name>/<name>.md`.
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
| `atoms` | Each atom, its single operation, and why it is not a molecule. |
| `molecules` | Each molecule and the two or more direct units it composes. |
| `wrapper_responsibilities` | What remains in `SKILL.md`. |
| `promotion_decisions` | Why every new unit remains local or why a reviewed `_base` promotion is justified. |

## Guarantees

- First-consumer units stay local to the new skill.
- Every molecule composes at least two units.
- Unit roots, file names, and support-file names match the validator's shape.
- Strict source rules survive extraction.

## Boundaries

This atom does not write generated fields, register tests, run validation, or
promote units to `_base` without an explicit reviewed two-consumer rationale.
