---
name: narrow-change
description: Make the smallest complete implementation change that satisfies the revised intent, re-derive the skill graph, and run the repository's real validation, refusing to widen another skill's permissions or edit doctrine to make a change fit.
level: atom
allowed-tools: ["read","search","edit","execute"]
includes: []
composes: []
used-by: ["reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md"]
---

# Narrow Change

Change the implementation to match the intent, and change nothing more.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `target` | yes | The resolved skill package being reinforced. |
| `intent-decision` | yes | The recorded decision and, when the intent changed, its confirmed new text. |
| `change-request` | yes | The desired change, restated by change-grounding. |

## Operation

1. Make the **smallest complete** change that satisfies the revised intent — or,
   when the intent was preserved, the reviewed change request. Smallest is not
   partial: the change fully addresses what was asked and stops there.
2. Confine every edit to the target skill's own directory. Before writing a
   path, classify it with the reinforcement-target guard; a `doctrine`, `base`,
   `foreign-skill`, or `outside` path is refused and reported, never written.
   The single disclosed exception is registering a new test file in the
   validation workflow, and that edit is **additive only** — a test-registration
   line added or removed. It never changes the workflow's triggers, jobs,
   commands, permissions, existing registrations, or the doctrine-digest step.
3. Before handing the change over for a pull request, audit the **actual**
   change set with the guard's `auditDiff` over the version-control diff. If any
   changed path falls outside `in-target` or `workflow`, stop and report it; no
   pull request opens on an out-of-target diff.
4. When the change adds or removes a unit, re-derive the graph with
   `node scripts/derive-skill-graph.mjs --write`, so `used-by` and molecule
   `allowed-tools` are regenerated and committed rather than hand-edited.
5. Run the repository's real validation:
   `node scripts/validate-skill-graph.mjs`, the deriver check, and the full
   registered test list. Report the exact commands and their output. A change
   that cannot pass them is the thing to fix.

## Widening a Grant Is a Deliberate, Called-Out Change

A skill's `allowed-tools` is a human-authored superset, and the deriver **never
widens it automatically**. If a change composes a unit that needs a tool the
skill does not grant, the build fails until a human widens the grant on purpose.

This atom never widens a grant to make that failure go away as a side effect. A
needed widening is surfaced as its own decision, in words, in the diff a
reviewer reads — never acquired quietly by composing something new. Widening
*another* skill's permissions is refused outright; it is never a side effect of
reinforcing this one.

## Never Weaken a Gate to Fit

Never weaken the validator, the deriver, a conformance test, the validation
workflow, or `AGENTS.md` to make a change pass. The one workflow edit permitted
is an additive test registration; weakening a job, a command, or the
doctrine-digest step to make a change fit is exactly the circular move this
refuses. The pressure to relax a shared standard always arrives attached to
something that looks reasonable in isolation. If the change cannot meet the bar,
the change is what is wrong.

## Never Edit Doctrine

Doctrine is human-authored and is the standard software here is shaped against.
A skill that reinforced itself by editing the standard it is judged against
would be the worst failure mode in this repository. This atom never edits
`doctrine/` or `doctrine/manifest.md`. It may cite doctrine as a reason for a
change, in prose, and stop there.

## Output

Return the files changed, each classified `in-target` or `workflow`; the exact
validation commands and their verbatim output; any grant this change would
require widened, stated as its own decision; and any gate the change could not
satisfy.

## Boundaries

This atom edits only the target skill and, when a test is added, the validation
workflow. It never edits doctrine, never edits another skill, never widens
another skill's grant, never weakens a gate, and never hand-authors a derived
field. It makes the change reviewable; it does not merge it.
