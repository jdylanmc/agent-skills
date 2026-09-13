---
name: destination-authoring
description: Decide per confirmed job whether the destination should gain a skill or be routed to one it already has, build each creatable job in a fresh authoring context under the destination's own creation workflow, relay its questions through the source and then the operator, and resolve the run's outcome only on validation, a clean review, and an opened change request.
level: molecule
includes: ["_base/_atoms/agent-spawn/agent-spawn.md","snipe-skill/_atoms/duplicate-capability/duplicate-capability.md","snipe-skill/_atoms/authoring-relay/authoring-relay.md","snipe-skill/_atoms/adoption-gate/adoption-gate.md","snipe-skill/_atoms/adoption-outcome/adoption-outcome.md"]
composes: ["_base/_atoms/agent-spawn/agent-spawn.md","snipe-skill/_atoms/duplicate-capability/duplicate-capability.md","snipe-skill/_atoms/authoring-relay/authoring-relay.md","snipe-skill/_atoms/adoption-gate/adoption-gate.md","snipe-skill/_atoms/adoption-outcome/adoption-outcome.md"]
used-by: ["snipe-skill/SKILL.md"]
allowed-tools: ["execute","read","task"]
---

# Destination Authoring

Decide what each confirmed job should actually become, build the ones that
should be built where they belong under the destination's own rules, and end the
run on evidence rather than on effort.

```text
route or create, per confirmed job -> fresh context -> destination's creation workflow
  -> relay questions -> validate, review, remediate -> open a change request -> stop
```

## Required References

1. [Agent spawn](../../../_base/_atoms/agent-spawn/agent-spawn.md)
2. [Duplicate capability](../../_atoms/duplicate-capability/duplicate-capability.md)
3. [Authoring relay](../../_atoms/authoring-relay/authoring-relay.md)
4. [Adoption gate](../../_atoms/adoption-gate/adoption-gate.md)
5. [Adoption outcome](../../_atoms/adoption-outcome/adoption-outcome.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `confirmed-jobs` | yes | The jobs the confirmed intent carries, in the operator's confirmed words. |
| `capabilities` | yes | The destination's existing skills from intake, and whether that inventory was enumerated. |
| `destination` | yes | The resolved destination and its own conventions. |
| `binding` | yes | The bound source evidence and its bytes, `{ binding, bytes }`, for answering authoring questions only. |
| `gate-workspace` | yes | The directory this run's gate episodes are written to. |

## Operation

1. Decide per confirmed job with
   [Duplicate capability](../../_atoms/duplicate-capability/duplicate-capability.md).
   This runs **here**, not at intake, because the jobs come from the confirmed
   synthesis and there is no synthesis at intake. Report `route-existing`
   truthfully, carry every `stop` to the operator with its ways forward, and
   pass only `create` jobs to step 2.

   Carry each decision forward with the skill it named, because step 7
   reconciles the reported routes against exactly those selections.

2. For each `create` job, spawn one fresh context with
   [Agent spawn](../../../_base/_atoms/agent-spawn/agent-spawn.md), carrying the
   confirmed intent and the destination — and **not** the source text. What is
   carried and what is withheld is owned by
   [Authoring relay](../../_atoms/authoring-relay/authoring-relay.md), which is
   the single authority for that contract; nothing here restates it.

3. Inside that context, invoke the destination's own creation workflow. In this
   repository that is `create-skill`, which captures intent, designs the package,
   validates it, roasts it, resolves every finding, and records a changelog
   entry. Do not re-implement, shorten, or substitute any of it.

4. When it asks a question, run the relay: consult the bound source for a
   candidate answer with its citation and remaining uncertainty, then present
   that candidate through a **new** `authoring-answer` episode of
   [Adoption gate](../../_atoms/adoption-gate/adoption-gate.md). Only the
   operator's confirmation releases an answer.

   Each question gets its own gate episode. A gate episode is bound to one
   subject and is terminal once released, so an answer can never ride on an
   earlier confirmation.

5. Let creation, validation, review, and remediation run to their own
   conclusion, in small reviewable corrections. A finding is fixed, declined with
   the destination workflow's own fresh-context verdict, or carried to the
   operator — never summarized away.

6. Open a change request in the destination **for each created skill**. A run in
   which every job routed to an existing skill creates nothing and opens
   nothing; there is no package to review, and an empty change request would be
   ceremony standing in for a result.

7. Resolve the run with
   [Adoption outcome](../../_atoms/adoption-outcome/adoption-outcome.md),
   supplying the decision ledger from step 1 alongside the evidence each created
   skill actually produced. It reconciles every confirmed job against that
   ledger, and reports `adopted` only when every created skill carries passing
   validation, a review that reached `clean`, an opened change request, and all
   three describing the same final head.

   The outcome atom checks the **shape and internal consistency** of that
   evidence, not its truth. Supplying evidence that matches what the destination
   workflow actually reported is this molecule's obligation, and the change
   request is what lets a human check it.

## Several Jobs, Several Contexts

Each `create` job gets its own fresh context and its own change request, because
each is its own package with its own intent and its own review. One weak
destination does not ride along on a strong one: the outcome atom blocks the run
and names the shortfall per skill.

## Where The Run Ends

Whenever this run creates a skill, it ends at an opened change request and
nothing further.

A run that reviewed its own work thoroughly, resolved every finding, and is
therefore confident is exactly the run that should not merge it. Automating the
review is not automating the approval, and the outcome atom refuses a merged or
approved claim wherever it appears rather than downgrading it to a warning.

The change request is opened before the outcome is resolved, on purpose. A
change request is a review surface, not an approval, and opening one for a run
that then resolves to `blocked` is how the shortfall becomes visible to a person
instead of disappearing with the run.

A run that creates nothing ends differently and correctly: every job already had
a home, so it reports `routed-existing` and opens nothing. Manufacturing a change
request there would be ceremony in the shape of a result.

## Output

| Field | Meaning |
| --- | --- |
| `status` | From the outcome atom's closed set. |
| `decisions` | Per confirmed job: `create`, `route-existing`, or `stop`, with evidence. This is the ledger step 7 reconciles against. |
| `created` | Each destination skill, its validation output including anything cancelled, its review account, and its change request. |
| `questions` | Every authoring question, its candidate answer with citation, and the operator's confirmed answer. |
| `unresolved` | Anything left open, with bounded ways forward. |

## Guarantees

- A job an existing destination skill already does is routed, never rebuilt.
- The authoring context receives the confirmed intent and no raw source text.
- Every authoring question reaches the operator, in its own gate episode.
- The destination's own gates decide acceptability, and are never lowered.
- A created skill ends at an opened change request; a run that creates nothing
  opens none.
- Every confirmed job is accounted for in the outcome, or the outcome is refused.
- The run claims no merge and no approval.

## Boundaries

This molecule coordinates. It does not author files itself, choose a package's
decomposition, select its tools, weaken a destination check to get a package
through, merge, approve, or report a package complete on anything less than the
evidence the outcome atom requires.
