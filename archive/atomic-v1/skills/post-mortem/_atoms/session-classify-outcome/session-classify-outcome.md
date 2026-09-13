---
name: session-classify-outcome
description: Determine the operator's ultimate goal, the desired work product, the produced result, and whether they aligned, citing only the verification or explicit response that supports the conclusion.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/SKILL.md"]
---

# Session Outcome Classification

Say what the session was for and whether it got there, without inventing a
verdict the evidence does not carry.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `ledger` | yes | Anchored evidence for the session. |
| `confidence-cap` | no | A cap imposed by the evidence boundary. |

## Operation

Determine:

- the operator's ultimate goal;
- the desired work product;
- the produced result;
- whether the produced result matched the desired result;
- what verification or explicit operator response supports that conclusion.

## Output

| Field | Meaning |
| --- | --- |
| `ultimate_goal` | The objective the session was serving. |
| `desired_work_product` | What the operator asked to receive. |
| `produced_result` | What was actually produced. |
| `alignment` | `aligned`, `partially_aligned`, `misaligned`, or `not_observable`. |
| `alignment_confidence` | `high`, `moderate`, `low`, or `not_observable`. |
| `outcome_evidence` | Anchors supporting the alignment verdict. |

## Guarantees

- No scalar satisfaction score is produced. Task completion and operator
  satisfaction are independent signals.
- Explicit acceptance or rejection may be observed. Silence, politeness,
  brevity, and conversation termination are never satisfaction evidence.
- Alignment is `not_observable` rather than assumed when nothing verifies it.

## Boundaries

This atom does not diagnose why a mismatch happened, propose a remedy, or infer
operator emotion, intent, or satisfaction.

**Error recovery.** When the post-mortem is invoked before the work is complete,
analyze the session to date and state that outcome alignment remains unverified.
