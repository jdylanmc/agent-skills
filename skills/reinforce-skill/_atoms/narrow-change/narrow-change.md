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
2. Keep one target behavior. Before writing, classify each path with the
   reinforcement-target guard. A path outside the target is refused unless it
   is a justified companion under that guard's exact-path contract: an existing
   changelog entry, an existing caller integration, or generated graph metadata.
   Record why that particular edit is necessary for this target; another
   behavior or an unrelated cleanup belongs to another run.
   Registering a new test file in the
   validation workflow, and that edit is **additive only** — a test-registration
   line added. It never removes a registration, never changes the workflow's
   triggers, jobs, commands, permissions, existing registrations, or the
   doctrine-digest step, and adds nothing but a `*.test.mjs` registration line.
3. Before handing the change over for a pull request, audit the **actual**
   change set with the guard's `auditRepositoryDiff` against the recorded base
   commit and final committed head (`--base <full-commit> --snapshot <run-state.json>
   --snapshot-digest <pinned-sha256> --companions <ledger.json>`), and
   cross-check it against the recorded intent decision with
   `assertDiffMatchesDecision`, passing the repository root so an absolute path
   to `intent.md` cannot slip past. When the change set touches the validation
   workflow, the repository audit reads immutable before/after Git bytes and
   proves an insertion-only registration without reordering or duplication.
   It also enumerates untracked files and both
   sides of renames, so the companion ledger cannot hide omitted paths.
   A path outside `in-target` or `workflow` needs a checked companion entry;
   every other path stops publication. Staged or unstaged residue and head/tree
   drift also stop publication, even if the path classes would be writable.
   For self-reinforcement, include and reproduce the preserved baseline-guard
   evidence rather than letting the changed guard authorize itself.
   An unclean audit exits non-zero.
   A change scoped as `preserves-intent` whose diff edits
   `intent.md` is refused on the same gate, which is what stops a narrow change
   from widening into a change to what the skill is for. A change scoped as
   `changes-intent` whose diff edits `intent.md` is refused unless that intent
   was stored through the gate and the stored bytes still match the file on disk,
   so a hand-written intent never publishes. Run the intent-decision release
   check, `intent-decision.mjs --state <path> --require-decision`, as the
   publication precondition; a `blocked` result stops the pull request.
4. When the change adds or removes a unit or changes composition on an existing
   skill or unit, re-derive the graph with
   `node scripts/derive-skill-graph.mjs --write`, so `used-by` and molecule
   `allowed-tools` are regenerated and committed rather than hand-edited.
5. Run every locally executable command declared by the repository's CI workflow,
   including graph validation, the deriver check, the sensitive-content scan
   and the full registered test list. Use the existing `run-ci` discovery and
   result envelope; report configured-policy degradation exactly as that gate
   reports it, never omit the scan or silently invent replacement commands.
   Report the exact commands and their output. A change
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

Return every changed file's original write class, its companion justification
and byte digests when applicable, and the complete audit; the exact
validation commands and their verbatim output; any grant this change would
require widened, stated as its own decision; and any gate the change could not
satisfy.

## Boundaries

This atom changes one skill's behavior with only the guard's necessary, bounded
companions and additive test registrations. It never edits doctrine, changes
another skill's purpose, widens another skill's grant, weakens a gate, or
hand-authors a derived field. It makes the change reviewable; it does not merge it.
