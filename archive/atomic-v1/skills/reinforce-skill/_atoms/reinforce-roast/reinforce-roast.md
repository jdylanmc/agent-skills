---
name: reinforce-roast
description: Roast the reinforced skill and resolve findings under the same rules create-skill uses — Must fix resolved mandatorily, everything arguable judged by a fresh-context rubber duck, re-roast after every head-changing correction, stop every three rounds for the operator — treating the roast as review and never as approval.
level: atom
allowed-tools: ["read","search","execute","task"]
includes: ["reinforce-skill/_atoms/reinforce-roast/reinforce-roast.mjs"]
composes: []
used-by: ["reinforce-skill/SKILL.md"]
---

# Reinforce Roast

The reinforced skill arrives already reviewed. This atom roasts what the change
produced and resolves the findings under the same rules `create-skill` applies
to a new package, so a change is held to the same bar as a creation.

```text
roast the head -> route by priority -> resolve or duck -> re-roast the new head
```

## Required Files

1. [Deterministic remediation gate](./reinforce-roast.mjs)

Drive events and reports through this local adapter, not the shared CLI:

```text
node skills/reinforce-skill/_atoms/reinforce-roast/reinforce-roast.mjs \
  --state <absolute-run-ledger.json> --event <absolute-event.json> --report
```

It delegates every transition to the shared ledger and persists that actual
state before reporting. One presentation defect is handled locally: after a
third-round clean closure, the shared ledger enters `awaiting-operator` and
then throws `LedgerError: no_ways_forward` while formatting its stop. The adapter
checks the exact error and completed transition, preserves the checkpoint,
and reports zero unresolved findings under `needs-confirmation`, never `clean`.
The real human answer remains mandatory, including after convergence. A refusal
reports `halted`; unrelated errors propagate. No transition or review rule is
reimplemented, and the protected shared ledger is unchanged.

The rules below are mechanical, not aspirational. The gate **reuses**
`create-skill`'s validated remediation ledger rather than restating it, so
"under the same rules `create-skill` uses" is a fact rather than a claim: the
same machine binds a roast to the head it reviewed, keeps a `Must fix` finding
out of the rubber duck's reach, refuses a `Should fix` or `Consider` finding
that has no recorded verdict, and enters `awaiting-operator` after three closed
rounds, refusing every event but the operator's answer.

One rule is genuinely different here and is layered on top. `create-skill`
writes a new package into empty space, so its change-set check asks only whether
a correction edited a repository gate. A reinforcement mutates a working package
that sits beside every other skill, so a correction made to silence a finding
could reach for a *neighbour* — another skill's `SKILL.md`, a shared `_base`
unit, the intent of a skill nobody asked about. The shared gate permits all
three. `assertReinforcementChangeSet` refuses unaccounted edits by layering the
reinforcement write boundary over the gate check, so a remediation change set
must answer both questions: did it weaken a gate, and did it stay inside the one target behavior and its justified companions.

Reusing another unit's script is a code dependency, not unit composition; the
two are separate graphs. The price is that a change to the shared ledger changes
what a reinforcement is held to, so the pinned guarantees are asserted beside
this atom and a drift fails the build for a human to read.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `target` | yes | The reinforced skill package, already passing the validator and the deriver. |
| `package-head` | yes | The committed candidate hash, including derivation and changelog, after validation. |

## Operation

1. Invoke `/roast` as a **required** nested skill on the current head. Supply
   the changed package, its intent when present, and actual repository
   authority; request inspection-only review with one fresh independent
   reviewer of the author's work, not artifact execution, installation, or
   repair. Consume the `# Roast` report and require its `Revision` to match
   `package-head`. Record findings against that head only when `Status` is
   `Complete` and `Coverage` accounts for the agreed scope and independent
   review. Preserve each finding's priority, confidence, standard, and evidence.
   If invocation fails, coverage is incomplete, the revision is stale, or
   status is `Partial` or `Needs clarification`, retain supported findings and
   missing coverage but stop without recording a completed roast: the run is
   not complete. `Complete` is coverage, never approval or absence of findings.
2. Resolve every `Must fix` finding. There is no route that discusses one away;
   it closes only on a correction that moves the head.
3. For every `Should fix` and `Consider` finding, dispatch a neutral brief to a
   **fresh-context** rubber duck that did not make the change and is not told
   which answer is wanted. Record its `apply`, `decline`, or `needs-human`
   verdict with its reasoning. Never auto-apply and never dismiss one without a
   verdict.
4. After **every** correction, return to the root's implement/derive/changelog,
   commit and validate steps, then re-roast that new committed head. A roast of
   a superseded head is stale evidence and is not counted.
5. Stop every three rounds and reconfirm with the operator, presenting the
   unresolved findings with a recommendation on how to move forward — further
   rounds, or simplifying the change so the finding no longer applies — and
   continue only on explicit confirmation.

## The Roast Is Review, Not Approval

Roasting the change automates the *review*, never the *approval*. This atom does
not treat its own roast, or the rubber duck's verdict, as a sign-off. A human
signs off, and that separation does not erode because the automation improved.

## Never Weaken the Reviewer

Never change `/roast`, including its `disable-model-invocation` flag, to make a
finding easier to pass. A skill that could edit the reviewer it is judged by is
not being reviewed. `/roast` is reached by invocation and is never composed.

## Output

Return the full account: every finding with its priority, what was fixed and the
correction that resolved it, what the duck declined and its reasoning, what
awaits a human, the rounds closed, and anything unresolved with a bounded way
forward. A `clean` result means every finding from the current-head roast is
addressed — fixed, duck-declined, human-deferred, or recorded as unresolved
under a non-complete status. `assertRoastComplete` decides that from the
ledger's own record rather than from anyone's recollection, and it fails closed
on a missing roast, a stale one, an open finding, an outstanding operator pause,
and a halted loop.

## Boundaries

Remediation uses the same companion contract as the final publication audit.
Use `reinforce-roast.mjs --root <root> --skill <target> --base <commit>
--snapshot <run-state.json> --snapshot-digest <pinned-sha256>
--companions <ledger.json>` for immutable Git enumeration and residue detection; low-level callers pass
the same `companions` and actual `contents` through to the shared audit.
Companions never bypass `assertGateIntegrity` or authorize a reviewer edit.
The publication audit requires preserved baseline evidence for self-reinforcement.
An uncommitted candidate or a head/tree that differs from the pinned snapshot
cannot complete that audit.

This atom invokes review and coordinates resolution. It never weakens a gate,
the validator, the deriver, or `AGENTS.md` to silence a finding; never edits
`/roast`; never changes another skill's behavior; and never treats a roast as approval. The
rubber duck advises and its verdict is not a sign-off.
