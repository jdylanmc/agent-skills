---
name: self-roast-invocation
description: Invoke /roast on the newly built skill package as a required nested skill, bind each returned finding to the package head it reviewed, and hold the boundaries that keep an automated review from becoming an automated approval.
level: atom
allowed-tools: ["read","search","task"]
includes: []
composes: []
used-by: ["create-skill/_molecules/self-roast-remediation/self-roast-remediation.md"]
---

# Self-Roast Invocation

`create-skill` reviews what it just built instead of asking someone to remember
to. Review that must be remembered is review that gets skipped.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-path` | yes | The `skills/<new-skill>/` package that has already passed the validator and the deriver. |
| `package-head` | yes | An identifier for the exact package content being reviewed, such as the commit or tree hash of the change set. |
| `round` | yes | The current remediation round number from the ledger. |

## Operation

1. Validate first. Roast a package that already passes
   `scripts/validate-skill-graph.mjs` and `scripts/derive-skill-graph.mjs`.
   Roasting a package that cannot yet be derived spends a round on findings the
   gates would have named for free.
2. Invoke `/roast` on `package-path` as a **required nested skill**.
   `create-skill` declares it in `requires-skills` as
   `{"id": "roast", "source": "local", "required": true}`. `/roast` keeps
   `disable-model-invocation: true` and every other property it declares; this
   atom changes nothing about the roast package.
3. Record the `package-head` the roast reviewed alongside its findings. A roast
   is evidence about one head and about no other head.
4. Read the returned report as the roast contract defines it. Each accepted
   finding carries a `Priority` of exactly `Must fix`, `Should fix`, or
   `Consider`, with a `Location`, `Evidence`, `Consequence`, `Recommendation`,
   and `Validation`. Treat a finding carrying an unrecognised priority as a
   contract failure and report it, rather than guessing which route it takes.
5. Route by priority and never by preference:
   - `Must fix` — resolved mandatorily.
   - `Should fix` and `Consider` — rubber-ducked, never auto-applied.
6. When `/roast` cannot run, refuses the target, or returns an
   unsynthesized report, stop and report that plainly. A skipped review is
   reported as a skipped review, never as a clean one.

## Output

| Field | Meaning |
| --- | --- |
| `roast_head` | The package head the roast reviewed. |
| `findings` | Each finding with its identifier, priority, location, evidence, consequence, recommendation, validation, and cited doctrine rule. |
| `mandatory` | The `Must fix` findings, which are resolved. |
| `ducked` | The `Should fix` and `Consider` findings, which go to a fresh-context evaluator. |
| `roast_status` | The run status, including any refusal or unsynthesized result. |

## Guarantees

- The package is roasted before it is presented, not after someone remembers.
- If `/roast` cannot run, refuses, or returns an unsynthesized result, the
  package is blocked from being called complete.
- If `/roast` returns findings, the package is blocked from being called
  complete until each finding has an address recorded in the remediation
  ledger.
- Every finding is bound to the head it was found on.
- Routing follows the finding's priority, not the author's opinion of it.

## Boundaries

- Never weaken a repository gate to silence a finding. `scripts/`, `AGENTS.md`,
  and `doctrine/` define what a valid package is; a package that cannot satisfy
  them is the thing to fix. Editing the rule a package is measured by would let
  the package define its own passing grade.
- Never change `/roast`. Its `disable-model-invocation` flag, its grant, and its
  units stay exactly as they are.
- Severity remains a **category**. This automates the review, never the
  approval. `/roast` emits no verdict, and a human still signs off on the
  package.
- Roasting its own output does not license editing another skill.
- This atom reads a report. It applies no fix and approves nothing.
