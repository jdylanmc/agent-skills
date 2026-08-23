---
name: create-skill
description: Guide an author through creating one new valid skill package in this repository. Use when the operator asks to create, author, scaffold, or design a new routable skill for this library. Do not use for editing existing skills, running the created skill, generic prompt writing, non-skill documentation, external skill formats, or widening another skill's permissions.
allowed-tools: ["read","search","edit","execute","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","create-skill/_molecules/skill-package-design/skill-package-design.md","create-skill/_molecules/skill-package-conformance/skill-package-conformance.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","create-skill/_molecules/skill-package-design/skill-package-design.md","create-skill/_molecules/skill-package-conformance/skill-package-conformance.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: []
---

# Create Skill

Create one new routable skill package that conforms to this repository's local
unit composition model, validator, derived graph, and continuous-integration
registration rules. The workflow is local-first: new atoms and molecules are
created under the new skill unless a reviewed design names at least two current
or explicitly approved consumers.

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Skill package design](./_molecules/skill-package-design/skill-package-design.md)
3. [Skill package conformance](./_molecules/skill-package-conformance/skill-package-conformance.md)

## Core Workflow

1. Start or reuse the Chronicler run context. Record the requested skill name,
   purpose, constraints, and final outcome. Continue when recording is
   unavailable.
2. Use [Skill package design](./_molecules/skill-package-design/skill-package-design.md)
   to establish the one reusable job, routing triggers, refusals, boundaries,
   invocation flags, and the local atom/molecule decomposition.
3. Create only the new package under `skills/<new-skill>/`. If that package
   already exists, stop rather than overwriting or converting it. Do not edit an
   existing skill as a side effect, do not create units in `skills/_base/`, and
   do not copy or adapt external skill packages.
4. Use [Skill package conformance](./_molecules/skill-package-conformance/skill-package-conformance.md)
   while writing every file so frontmatter, required-reference mirrors,
   generated fields, permission grants, validation commands, test registration,
   and self-review stay aligned with the repository gates.
5. Direct the operator to `agents/skill-coach.agent.md` for review, or invoke
   that review when the runtime supports the configured review agent. Treat any
   finding that shows the package fails these rules as blocking and fix it
   before shipping.
6. Report the created package, the chosen decomposition seams, validation output
   including `cancelled`, the Skill Coach result, and any requirement that could
   not be satisfied.

## Output Contract

Return:

- the package path and the created local units;
- why each atom or molecule boundary exists;
- the exact validation commands run and their verbatim summary output;
- the Skill Coach review result or the exact reason review could not run;
- any explicit limitation, refusal, or unsatisfied requirement.

## Boundaries

- Creates new skill packages only.
- Does not edit existing skills except for deliberate cross-references such as a
  reviewed test registration when the new package adds a test.
- Does not run the skill it creates.
- Does not widen any existing skill's `allowed-tools`.
- Does not hand-author generated `used-by` fields or molecule `allowed-tools`.
- Does not promote units to `_base` for a first consumer.
- Does not add a signature footer.
