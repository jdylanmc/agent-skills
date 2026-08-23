---
name: scope-contract
description: Define the new skill's single job, routing description, invocation flags, boundaries, and refusals before any files are written.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["create-skill/_molecules/skill-package-design/skill-package-design.md"]
---

# Scope Contract

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | The operator's desired new skill and any stated scope, constraints, or examples. |
| `repository-conventions` | yes | Current repository instructions, sibling skill shapes, and validation rules. |
| `candidate-name` | no | Proposed skill directory and frontmatter name. |

## Operation

1. Identify exactly one reusable job for the new skill. If the request contains
   multiple unrelated jobs, split the design or ask the operator to choose one
   before writing files.
2. Write a router-quality description in third person. Include positive
   triggers with `Use when ...` and negative triggers with `Do not use ...` so a
   router can distinguish similar requests that should not invoke the skill.
3. Choose invocation flags deliberately. Set `user-invocable: true` when a human
   may run the skill directly. Set `disable-model-invocation: true` only for
   long-running or high-ceremony workflows that must be explicitly invoked by a
   human.
4. Define hard boundaries before implementation: what the skill creates, what it
   refuses, which side effects require approval, and which existing packages are
   out of scope.
5. Preserve existing skills' invocation flags and permissions. Never change them
   as collateral work while creating the new skill.
6. Never change the repository's shared enforcement to accommodate the new
   package. `scripts/validate-skill-graph.mjs`, `scripts/derive-skill-graph.mjs`,
   and the rules in `AGENTS.md` define what a valid package is; a package that
   cannot satisfy them is the thing to fix. If the model genuinely cannot
   express the design, raise it as a proposal against ADR 0001 and stop, rather
   than relaxing a rule inside the work that needs it relaxed.

## Output

| Field | Meaning |
| --- | --- |
| `skill_name` | The canonical kebab-case skill name and directory. |
| `single_job` | One sentence describing the reusable job. |
| `description` | Router-ready frontmatter description with positive and negative triggers. |
| `invocation_flags` | Selected `disable-model-invocation` and `user-invocable` values with reason. |
| `boundaries` | Explicit in-scope, out-of-scope, and refusal statements. |

## Guarantees

- The package has one coherent reason to exist before any file is created.
- Similar-but-wrong prompts are excluded by the description.
- Existing skill flags and permissions are not modified by accident.
- The validator, the deriver, and `AGENTS.md` are never edited to make a new
  package pass. A test that asserts a rule the author just relaxed is not
  evidence that the package is valid.

## Boundaries

This atom does not decompose the package, author Markdown files, select tools,
run validation, or review the finished package. It only fixes the new skill's
scope and routing contract.
