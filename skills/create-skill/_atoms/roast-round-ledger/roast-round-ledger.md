---
name: roast-round-ledger
description: Hold the self-roast remediation state so a roast is invalidated when a correction moves the package head, a Must fix finding cannot be ducked away, a Should fix or Consider finding cannot be applied without a verdict, and the loop stops for operator reconfirmation every three rounds.
level: atom
allowed-tools: ["read","execute"]
includes: ["create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs"]
composes: []
used-by: ["create-skill/_molecules/self-roast-remediation/self-roast-remediation.md"]
---

# Roast Round Ledger

A remediation loop that reviews its own output needs a damper, and prose is not
one. This atom holds the loop's state in a file, and the rules that matter are
enforced by the state machine that reads it rather than by a paragraph asking
the caller to remember them.

## Required References

1. [Ledger state machine](./roast-round-ledger.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `package-path` | yes | The package under remediation. |
| `package-head` | yes | An identifier for the exact current package content, such as a commit or tree hash. |
| `findings` | yes | The accepted findings from the roast of that head. |
| `verdicts` | no | Rubber-duck verdicts and reasoning for `Should fix` and `Consider` findings. |
| `changed-paths` | no | The paths a correction touched, checked against the repository gates. |

## The Four Rules It Enforces

1. **A roast is bound to the head it reviewed.** Once a correction moves the
   head, that roast is stale evidence, and every operation that would act on it
   is refused until a fresh roast is recorded. A finding never carries over a
   head change.
2. **`Must fix` is resolved.** It cannot be routed to the rubber duck, and no
   verdict closes it. There is no path that ducks a `Must fix` finding away.
3. **`Should fix` and `Consider` need a verdict.** Applying one requires a
   recorded verdict of `apply`; dismissing one requires `decline`; deferring one
   requires `needs-human`. Each requires non-empty reasoning.
4. **The loop stops.** After three closed rounds the ledger enters
   `awaiting-operator` and **refuses every other event** until an explicit
   operator reconfirmation arrives. The stop is a state the machine is in, not a
   request to stop.

## Operation

1. Create the ledger once for the package, then apply one event per step:

   ```text
   node <atoms>/roast-round-ledger/roast-round-ledger.mjs \
     --state "$absolute_state_path" --event "$absolute_event_path" --report
   ```

   Exit `0` applies the event, `2` refuses it and names the rule, and `1` is a
   usage or path failure. An unknown argument, an unknown event type, an
   unknown state field, an unknown finding field, and an unrecognised priority
   are each a refusal, never a silent fallback.

2. Apply events in the order the workflow produces them.

   | Event | Meaning |
   | --- | --- |
   | `create` | Open the ledger for a package at a head. |
   | `roast-recorded` | Record the findings of a roast of the current head. |
   | `duck-verdict` | Record a verdict and reasoning for a ducked finding. |
   | `finding-resolved` | A correction resolved a finding and moved the head. |
   | `finding-declined` | A ducked finding was declined on a `decline` verdict. |
   | `finding-deferred` | A ducked finding awaits a human on `needs-human`. |
   | `correction` | Any other head-changing edit. |
   | `round-closed` | Close a round after its roast and corrections. |
   | `operator-reconfirmation` | The operator's answer at the stop. |

3. Re-roast after every head-changing correction. `finding-resolved` and
   `correction` both move the head, which marks the recorded roast stale; the
   next `roast-recorded` must name the new head, and a roast naming a superseded
   head is refused.

4. At the stop, read the report and present it. The report names the round, the
   unresolved findings, and the ways forward. Record the operator's answer:
   `confirmed: true` reopens the loop and resets the round counter;
   `confirmed: false` halts the ledger permanently.

5. Pass `changedPaths` with any correction. A path under `scripts/`,
   `doctrine/`, or `AGENTS.md` is refused as `gate_weakened`. A correction that
   omits `changedPaths` is recorded as `not-supplied` and counted under
   `gateChecks.unverified` in the report, because a check that never ran is
   reported as one that never ran and never as one that passed.

## Non-Convergence Is Never a Bare Failure

Every stop carries at least one bounded way forward, and the ledger throws
rather than returning an empty list, so no caller can report "this did not
converge" with nothing attached. The routes are:

- `further-review-rounds` — confirm another bounded set of rounds.
- `simplify-feature` — remove or narrow the capability the finding names, so the
  finding no longer applies, then re-roast the reduced package.
- `operator-decision` — put a `needs-human` finding to the operator with the
  duck's reasoning attached.
- `re-roast-current-head` — the recorded roast is stale.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `clean` when the roast is fresh, the gate is open, and nothing is unresolved; otherwise `unresolved`. |
| `found` | Every finding of the current roast with its priority. |
| `fixed` | Findings resolved by a correction. |
| `declined` | Findings declined, each with the duck's verdict and reasoning. |
| `deferred` | Findings the duck sent to a human. |
| `gateChecks` | Corrections whose change set was verified against the repository gates, and corrections that supplied none. |
| `acrossRun` | Every finding resolved, declined, or deferred in any round, with the round it happened in. |
| `unresolved` | What remains, with the roast's recommendation for each. |
| `waysForward` | Bounded routes out, empty only when the status is `clean`. |

## Guarantees

- A superseded roast cannot be acted on.
- A `Must fix` finding cannot be declined, deferred, or ducked.
- A ducked finding cannot be applied or dismissed without a recorded verdict and
  reasoning.
- The loop cannot silently continue past three rounds.
- A remediation cannot edit a repository gate.

## Boundaries

- The ledger records dispositions. It never decides whether a finding is right,
  never edits the package, and never approves it.
- It emits no pass or fail verdict. Severity stays a category and a human signs
  off.
- It stores no secret and no personal data; it stores finding identifiers,
  priorities, recommendations, verdicts, and reasoning.
