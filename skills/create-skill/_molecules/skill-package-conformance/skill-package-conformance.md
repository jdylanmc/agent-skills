---
name: skill-package-conformance
description: Keep authored skill files aligned with frontmatter, required-reference, derived-field, validation, CI, and review gates.
level: molecule
includes: ["create-skill/_atoms/frontmatter-reference-mirror/frontmatter-reference-mirror.md","create-skill/_atoms/validation-release-gate/validation-release-gate.md"]
composes: ["create-skill/_atoms/frontmatter-reference-mirror/frontmatter-reference-mirror.md","create-skill/_atoms/validation-release-gate/validation-release-gate.md"]
used-by: ["create-skill/SKILL.md"]
allowed-tools: ["edit","execute","read","search","task"]
---

# Skill Package Conformance

## Required References

1. [Frontmatter and reference mirror](../../_atoms/frontmatter-reference-mirror/frontmatter-reference-mirror.md)
2. [Validation and release gate](../../_atoms/validation-release-gate/validation-release-gate.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-plan` | yes | The approved wrapper, atom, and molecule plan. |
| `authored-files` | yes | Current package files and any new tests. |
| `changed-files` | yes | The complete diff before shipping. |

## Operation

1. Apply
   [Frontmatter and reference mirror](../../_atoms/frontmatter-reference-mirror/frontmatter-reference-mirror.md)
   while authoring every `SKILL.md`, atom, molecule, support file, and optional
   test file.
2. Run
   [Validation and release gate](../../_atoms/validation-release-gate/validation-release-gate.md)
   after writing files and after every conformance fix.
3. Treat a missing stored intent, derived-field drift, missing test
   registration, stale tool grants, hidden cancellations, and Skill Coach
   convention failures as blockers.

## Output

| Field | Meaning |
| --- | --- |
| `conformance_status` | `ready`, `blocked`, or `needs-fix`. `ready` is impossible without a stored intent. |
| `files_to_fix` | Files and rules that still fail. |
| `validation_output` | Command summaries and review result. |

## Guarantees

- Authored files can pass the repository validator and deriver.
- A package with no stored intent never reaches `ready`.
- Continuous Integration (CI) runs the same explicitly listed test set used
  locally.
- The final package has been reviewed against Skill Coach rules.

## Boundaries

This molecule does not choose the skill's job, promote first-consumer units,
run the newly created skill, or mutate existing skills for convenience.
