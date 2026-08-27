---
name: reinforcement-target
description: Resolve the single existing skill a reinforcement edits, prove it is a routable package rather than one to be created, and classify every path the run intends to write so an out-of-target edit is reported rather than slipped in.
level: atom
allowed-tools: ["read","execute"]
includes: ["reinforce-skill/_atoms/reinforcement-target/reinforcement-target.mjs"]
composes: []
used-by: ["reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md"]
---

# Reinforcement Target

Decide *which* skill is being changed, and prove the change stays inside it,
before any file is edited.

A reinforcement holds an `edit` grant, and the runtime cannot scope that grant
to one directory. This atom does not pretend to. Its job is to make the write
scope a decided, testable fact: the one skill being reinforced is resolved and
proven to exist, and every path the run means to write is classified, so a write
outside that skill becomes a reported entry in the change ledger instead of a
detail nobody sees.

## Required Files

1. [Deterministic write-boundary guard](./reinforcement-target.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `repository-root` | yes | The repository the reinforcement runs against. |
| `skill-name` | yes | The one skill to reinforce, as its routable name. |

## Operation

1. Resolve the target with `resolveSkillTarget`. It accepts only a routable
   skill name, which makes `..`, an absolute path, a nested `a/b`, an uppercase
   escape, and the leading-underscore `_base` fail as malformed rather than
   being caught by a later containment check that is easier to get wrong.
2. Require the target to already exist as a routable package: an existing
   directory containing `SKILL.md`. A missing target is refused. **Creating a
   skill is `create-skill`'s job, never this one.**
3. Reject a symbolic link anywhere in the resolved path, not just at the leaf.
4. Report whether the target carries an `intent.md`, so the change-grounding
   step knows whether a standard exists to judge against.
5. Classify every path the run intends to write with `classifyWritePath`. The
   classification is exhaustive — every candidate resolves to exactly one class
   — and it resolves a symlinked component to its real location before judging,
   so a symlinked path lexically inside the target cannot read as `in-target`.
6. Before the pull request opens, audit the **actual** change set with
   `auditDiff`: the real list of changed paths from the version-control diff,
   every one classified, and any path outside `in-target` or `workflow` refused.
   When a `workflow` path is present, supply the file's before/after content so
   the edit is proven a bare test registration; an unproven workflow edit is
   refused. From the command line, `--audit <paths>` (with
   `--workflow-previous <path> --workflow-next <path>` when the workflow is
   touched) **exits 2 when the audit is unclean and 0 when it is clean**, so a
   refusal is never a success-shaped exit that publication could step past.

## Write Classes

| Class | Meaning | Writable |
| --- | --- | --- |
| `in-target` | Inside `skills/<skill-name>/`. | yes |
| `workflow` | The single shared test-registration file, `.github/workflows/validate-skills.yml`. | yes |
| `base` | Inside `skills/_base/`. | no |
| `doctrine` | Inside `doctrine/`. | no |
| `foreign-skill` | Inside another skill's package. | no |
| `outside` | Anywhere else, or outside the repository. | no |

Only `in-target` and `workflow` are writable. `doctrine`, `base`,
`foreign-skill`, and `outside` are refused. `workflow` is a shared file, so the
audit reports it separately and it is writable only as an additive test
registration: the edit removes no existing registration and adds nothing but a
`*.test.mjs` registration line, proven from the before/after content the run
supplies. A workflow edit whose content is not supplied cannot be proven and is
refused. It is never treated as mechanically safe, and always surfaced for a
human to read.

## What This Guard Does and Does Not Do

This guard **classifies and audits**; it does not silently **prevent** an
in-run write, because nothing in one model run can. The completeness comes from
`auditDiff` running over the real diff rather than over the paths the model
happened to disclose: the diff is enumerable, so every changed path is
classified, and the publication gate refuses to open a pull request while any
path is out of class.

That is the honest boundary. The `edit` grant itself is unscoped — the runtime
cannot confine it to one directory — so this guard does not claim to bound the
grant. It bounds **publication**: nothing lands while the diff contains an
out-of-target path, and after the audit a human still reviews the whole diff.
Continuous integration re-runs the validator, the deriver, the doctrine-manifest
digest test, and the full suite over that diff. The classification is never
treated as approval.

## Boundaries

This atom reads and classifies. It edits nothing itself. It refuses a target
that does not already exist and refuses `_base`; it never creates a package,
never resolves a doctrine or foreign-skill path as writable, and never reports a
classification as an approval to write.
