---
name: self-roast-remediation
description: Roast the newly built skill package, resolve every Must fix finding, rubber-duck every Should fix and Consider finding with a fresh-context evaluator, re-roast after each head-changing correction, and stop for operator reconfirmation every three rounds.
level: molecule
includes: ["create-skill/_atoms/self-roast-invocation/self-roast-invocation.md","create-skill/_atoms/rubber-duck-brief/rubber-duck-brief.md","create-skill/_atoms/roast-round-ledger/roast-round-ledger.md"]
composes: ["create-skill/_atoms/self-roast-invocation/self-roast-invocation.md","create-skill/_atoms/rubber-duck-brief/rubber-duck-brief.md","create-skill/_atoms/roast-round-ledger/roast-round-ledger.md"]
used-by: ["create-skill/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Self-Roast Remediation

The package arrives already reviewed. `create-skill` roasts what it just built,
resolves what must be resolved, has everything else judged by an evaluator that
did not build it, and reports the whole account.

```text
roast the head -> route by priority -> resolve or duck -> re-roast the new head
```

## Required References

1. [Self-roast invocation](../../_atoms/self-roast-invocation/self-roast-invocation.md)
2. [Rubber duck brief](../../_atoms/rubber-duck-brief/rubber-duck-brief.md)
3. [Roast round ledger](../../_atoms/roast-round-ledger/roast-round-ledger.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-path` | yes | The new `skills/<skill>/` package, already passing the validator and the deriver. |
| `package-head` | yes | An identifier for the exact package content, such as the commit or tree hash. |
| `ledger-state` | yes | The absolute path to this package's ledger state file. |

## Operation

1. Open the ledger for `package-path` at `package-head` with
   [Roast round ledger](../../_atoms/roast-round-ledger/roast-round-ledger.md).

2. Run
   [Self-roast invocation](../../_atoms/self-roast-invocation/self-roast-invocation.md)
   on the current head and record the findings against that head. Stop and
   report when `/roast` refuses or returns an unsynthesized result; a review
   that did not happen is reported as one that did not happen.

3. Resolve every `Must fix` finding. There is no route that discusses one away:
   the ledger refuses a duck verdict, a decline, and a deferral on a `Must fix`
   finding, and closes it only on a correction that moves the head.

4. For every `Should fix` and `Consider` finding, run
   [Rubber duck brief](../../_atoms/rubber-duck-brief/rubber-duck-brief.md).
   Build the neutral brief, screen it, dispatch it to a fresh-context sub-agent,
   and record the returned `apply`, `decline`, or `needs-human` verdict with its
   reasoning. Never auto-apply one of these findings, and never dismiss one
   without a verdict.

   - `apply` — correct the package and record the resolution.
   - `decline` — record the decline and the duck's reasoning verbatim.
   - `needs-human` — defer it and carry it into the report.

5. Re-roast after **every** head-changing correction. A roast of a superseded
   head is stale evidence, so the ledger invalidates it the moment the head
   moves and refuses every finding operation until a roast of the new head is
   recorded.

6. Close each round. On the third closed round without reconfirmation the ledger
   enters `awaiting-operator` and refuses every event but the operator's answer.
   Present the unresolved findings **with a recommendation on how to move
   forward** — further review rounds, or simplifying the feature so the finding
   no longer applies — and continue only on explicit confirmation.

7. Report the full account from the ledger: what was found, what was fixed, what
   was declined and why the duck declined it, what awaits a human, and what
   remains unresolved with its ways forward.

## Output

| Field | Meaning |
| --- | --- |
| `remediation_status` | `clean`, `unresolved`, `awaiting-operator`, or `halted`. |
| `rounds` | Rounds closed and every reconfirmation recorded. |
| `found` | Every finding across the run with its priority. |
| `fixed` | Findings resolved, and the correction that resolved each. |
| `declined` | Findings declined, each with the duck's verdict and reasoning. |
| `unresolved` | What remains, with bounded ways forward. |

## Guarantees

- The package is roasted before it is presented.
- A `Must fix` finding is resolved and is never rubber-ducked away.
- A `Should fix` or `Consider` finding is never applied or dismissed without a
  fresh-context verdict and its reasoning.
- Every correction invalidates the prior roast and forces a re-roast.
- The loop cannot run past three rounds without the operator.
- Non-convergence arrives with at least one bounded route out.

## Boundaries

- Never weaken a repository gate, the validator, the deriver, or `AGENTS.md` to
  silence a finding. A package that cannot satisfy them is the thing to fix.
- Never change `/roast`, including its `disable-model-invocation` flag.
- Severity remains a category. This automates the review, not the approval, and
  a human still signs off.
- Roasting its own output does not license editing another skill; the change set
  stays the new package and its test registration.
- The rubber duck advises. It does not edit the package, and its verdict is not
  an approval.
