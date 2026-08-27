---
name: friction-detect-signals
description: Detect friction events from a fixed list of valid signals, exclude normal iteration, and record each with severity, anchors, an observable consequence, and confidence.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/postmortem-diagnose-session/postmortem-diagnose-session.md"]
---

# Friction Signal Detection

Find where the session cost more than it should have, using observable signals
rather than tone.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `ledger` | yes | Anchored evidence for the session. |
| `confidence-cap` | no | A cap imposed by the evidence boundary or a selected log. |

## Operation

Valid friction signals include:

- explicit correction or rejection;
- restated or narrowed requirements;
- redirect to a different approach or artifact;
- repeated request after an inadequate result;
- abandoned direction;
- conflicting requirements discovered late;
- retry or rework caused by a failed approach;
- blocked or denied tool operation;
- omitted validation or unmet acceptance criterion;
- escalating specificity after a miss.

Do not count normal clarification, necessary verification, useful iteration, or
task complexity as friction by themselves.

## Output

Each event records:

- `id`, from the `F` series;
- `description`;
- `statement_type`: `observed` or `derived`;
- `severity`: `low`, `moderate`, or `high`;
- `evidence`: anchors;
- `consequence`: what observably followed;
- `confidence`.

## Guarantees

- Every friction event cites at least one anchor and one observable
  consequence.
- Proportionate, successfully resolved iteration is not reported as friction.
- No friction event is manufactured to populate the record.

## Boundaries

This atom does not explain why the friction happened, classify it as a gap, or
propose a remedy. It reports what was observed.
