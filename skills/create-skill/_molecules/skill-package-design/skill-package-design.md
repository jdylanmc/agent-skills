---
name: skill-package-design
description: Design the new skill's scope, routing contract, and local-first unit decomposition before authoring package files.
level: molecule
includes: ["create-skill/_atoms/scope-contract/scope-contract.md","create-skill/_atoms/unit-decomposition/unit-decomposition.md"]
composes: ["create-skill/_atoms/scope-contract/scope-contract.md","create-skill/_atoms/unit-decomposition/unit-decomposition.md"]
used-by: ["create-skill/SKILL.md"]
allowed-tools: ["edit","read","search"]
---

# Skill Package Design

## Required References

1. [Scope contract](../../_atoms/scope-contract/scope-contract.md)
2. [Unit decomposition](../../_atoms/unit-decomposition/unit-decomposition.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | The operator's desired new skill and constraints. |
| `intent` | yes | The stored, operator-confirmed intent this design must satisfy. |
| `repository-conventions` | yes | Current repository instructions, examples, and validator behavior. |

## Operation

1. Establish the single-job routing contract with
   [Scope contract](../../_atoms/scope-contract/scope-contract.md).
2. Decompose that job with
   [Unit decomposition](../../_atoms/unit-decomposition/unit-decomposition.md),
   keeping first-consumer units local and leaving the wrapper thin.
3. Reconcile the two outputs against the stored intent. If a proposed unit
   implies a second job or a broader trigger than the scope contract allows,
   narrow or split it before writing files. If either output asserts something
   the intent does not support, the design is what changes.

## Output

| Field | Meaning |
| --- | --- |
| `skill_contract` | Name, description, flags, and boundaries. |
| `package_plan` | Wrapper, atoms, molecules, and promotion decisions. |
| `open_questions` | Any information required before safe authoring can continue. |

## Guarantees

- Scope is fixed before file creation.
- Decomposition reflects the skill's job instead of a generic generator shape.
- Local-first decisions are recorded.

## Boundaries

This molecule designs the package. It does not write files, run validation,
register tests, or ship changes.
