---
name: create-skill
description: Guide an author through creating one new valid skill package in this repository. Use when the operator asks to create, author, scaffold, or design a new routable skill for this library. Do not use for editing existing skills, running the created skill, generic prompt writing, non-skill documentation, external skill formats, or widening another skill's permissions.
allowed-tools: ["read","search","edit","execute","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","create-skill/_molecules/intent-capture/intent-capture.md","create-skill/_molecules/skill-package-design/skill-package-design.md","create-skill/_molecules/skill-package-conformance/skill-package-conformance.md","create-skill/_molecules/self-roast-remediation/self-roast-remediation.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","create-skill/_molecules/intent-capture/intent-capture.md","create-skill/_molecules/skill-package-design/skill-package-design.md","create-skill/_molecules/skill-package-conformance/skill-package-conformance.md","create-skill/_molecules/self-roast-remediation/self-roast-remediation.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: [{"id": "roast", "source": "local", "required": true}]
---

# Create Skill

Create one new routable skill package that conforms to this repository's local
unit composition model, validator, derived graph, and continuous-integration
registration rules. The workflow is local-first: new atoms and molecules are
created under the new skill unless a reviewed design names at least two current
or explicitly approved consumers.

```text
elicit intent -> build -> validate -> roast -> resolve -> present
```

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Intent capture](./_molecules/intent-capture/intent-capture.md)
3. [Skill package design](./_molecules/skill-package-design/skill-package-design.md)
4. [Skill package conformance](./_molecules/skill-package-conformance/skill-package-conformance.md)
5. [Self-roast remediation](./_molecules/self-roast-remediation/self-roast-remediation.md)

## Core Workflow

1. Start or reuse the Chronicler run context. Record the requested skill name,
   purpose, constraints, and final outcome. Continue when recording is
   unavailable.
2. Capture what the skill is for with
   [Intent capture](./_molecules/intent-capture/intent-capture.md), **before any
   package structure is designed**. Ask the operator, take his answer in
   whatever shape it arrives, synthesize it into plain requirements, have him
   confirm those exact words, and store them at `skills/<new-skill>/intent.md`.
   If he has not said what the skill is for, ask; never infer it and proceed.
3. Use [Skill package design](./_molecules/skill-package-design/skill-package-design.md)
   to establish the one reusable job, routing triggers, refusals, boundaries,
   invocation flags, and the local atom/molecule decomposition. Derive all of it
   from the stored intent rather than inventing it separately.
4. Create only the new package under `skills/<new-skill>/`. If that package
   already exists, stop rather than overwriting or converting it. Do not edit an
   existing skill as a side effect, do not create units in `skills/_base/`, and
   do not copy or adapt external skill packages.
5. Use [Skill package conformance](./_molecules/skill-package-conformance/skill-package-conformance.md)
   while writing every file so frontmatter, required-reference mirrors,
   generated fields, permission grants, validation commands, test registration,
   and self-review stay aligned with the repository gates.
6. Run [Self-roast remediation](./_molecules/self-roast-remediation/self-roast-remediation.md)
   on the validated package. It invokes `/roast` as a required nested skill,
   resolves every `Must fix` finding, has every `Should fix` and `Consider`
   finding judged by a fresh-context rubber duck rather than auto-applied,
   re-roasts after every head-changing correction, and stops for operator
   reconfirmation every three rounds. The package arrives already reviewed
   instead of carrying a reminder to review it.
7. Report the created package, the stored intent, the chosen decomposition
   seams, validation output including `cancelled`, the full remediation account
   — what was found, what was fixed, what was declined with the duck's
   reasoning, and what remains unresolved with its ways forward — and any
   requirement that could not be satisfied.

## Output Contract

Return:

- the package path and the created local units;
- the stored intent, and any question about it the operator left unsettled;
- why each atom or molecule boundary exists;
- the exact validation commands run and their verbatim summary output;
- the roast findings, the `Must fix` fixes, every rubber-duck verdict with its
  reasoning, and every unresolved finding with a bounded way forward;
- the exact reason the roast could not run, when it could not;
- any explicit limitation, refusal, or unsatisfied requirement.

## Boundaries

- Creates new skill packages only.
- Asks for the new skill's intent before designing its structure, and never
  infers it in order to keep moving.
- Never stores an intent the operator has not confirmed.
- Writes an intent only for the package this run creates; rewriting the intent
  of an existing skill is a different job.
- Does not edit existing skills except for deliberate cross-references such as a
  reviewed test registration when the new package adds a test.
- Does not run the skill it creates.
- Does not widen any existing skill's `allowed-tools`.
- Does not hand-author generated `used-by` fields or molecule `allowed-tools`.
- Does not promote units to `_base` for a first consumer.
- Does not add a signature footer.
- Does not weaken a repository gate, the validator, the deriver, or `AGENTS.md`
  to silence a roast finding. A package that cannot satisfy them is the thing to
  fix.
- Does not change `/roast`, including its `disable-model-invocation` flag.
- Treats roast severity as a category. Roasting its own output automates the
  review, never the approval; a human still signs off.
- Does not let the rubber duck edit the package. It advises, and its verdict is
  not an approval.
