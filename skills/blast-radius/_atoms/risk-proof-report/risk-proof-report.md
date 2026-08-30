---
name: risk-proof-report
description: Classify blast-radius assertions by acquired evidence and fill one cheapest pre-merge regression-proof recommendation slot, including an explicit unavailable state, without adjudicating the change.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["blast-radius/_molecules/blast-radius-proof/blast-radius-proof.md"]
---

# Risk Proof Report

Resolve evidence states without turning them into an approval decision.

## Classification

Classify each assertion exactly once:

| State | Meaning |
| --- | --- |
| `confirmed-risk` | The named bad case occurred under recorded inputs and scope, or acquired evidence establishes premises that necessarily produce that named bad case under the recorded inputs and scope. Consumer or path reachability alone never qualifies. |
| `cleared-risk` | The named bad case was ruled out by the completed evidence, limited to its recorded scope, revision, inputs, and environment. |
| `unproven-assertion` | The ladder stopped before the bad case could be confirmed or cleared, or evidence conflicts. |

Never use `cleared-risk` to mean “no concern found.” It requires a named bad
case and evidence that actually tried to falsify it. Never infer a portfolio
verdict from counts: one unproven assertion can matter more than ten cleared
ones, and arithmetic cannot validate semantic proof quality.

Use the ladder fields coherently:

- `supports-bad-case` permits `confirmed-risk` only when the evidence meets the
  occurrence-or-necessary-production prerequisite above;
- `supports-assertion` permits `cleared-risk` only when completed evidence
  actually falsified the named bad case within its recorded scope;
- `inconclusive`, `conflicting`, or a stopping `unavailable` rung produces
  `unproven-assertion` unless earlier completed evidence already satisfies one
  of the two prerequisites;
- `not-attempted` later rungs do not weaken or strengthen the strongest
  completed evidence.

## Cheapest Pre-Merge Regression Proof Slot

Return exactly one recommendation slot. Set `regression-proof-status` to
`selected` when the evidence supports a responsible proof selection, otherwise
set it to `unavailable`. When selected, choose the least expensive check that
covers the highest-value remaining or confirmed change risk at the necessary
boundary.

For `regression-proof-status: selected`, the slot states:

- the assertion and bad case it addresses;
- the verification level and environment;
- exact setup, action, and observable result at recommendation level;
- prerequisites and authorization, if any;
- why a cheaper proof would not cross the required boundary;
- what remains outside its coverage.

This is a recommendation only. Do not write the test, procedure, fixture,
automation, or candidate change.

For `regression-proof-status: unavailable`, do not disguise evidence
acquisition as a regression proof. Leave proof details empty and place one
separate `next-evidence-action` and `next-evidence-reason` beside the slot. The
action must be bounded, read-only, and specific enough to enable later proof
selection.

## Output

- confirmed risks, each with assertion, bad case, and exact evidence;
- cleared risks, each with the scope in which it was cleared;
- unproven assertions, each with stopping rung, reason, and next evidence;
- analysis boundaries and cross-boundary gaps;
- exactly one regression-proof recommendation slot with status `selected` or
  `unavailable`;
- when unavailable, one separate bounded next-evidence action and reason.

Do not invent a test or relabel evidence acquisition to make the recommendation
slot look complete.

## Boundaries

- No pass/fail, approval, merge, or risk-acceptance verdict.
- No speculative risks without an evidence-backed impact path.
- No candidate code or test changes.
- No claim broader than the cited evidence and recorded analysis boundary.
