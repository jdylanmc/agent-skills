---
name: hypothesis-form-root-cause
description: Form deduplicated, mechanism-focused root-cause hypotheses that carry supporting and counter-evidence, the findings they affect, confidence, and a falsifying or confirming test.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/postmortem-diagnose-session/postmortem-diagnose-session.md"]
---

# Root-Cause Hypotheses

Explain the mechanism behind the findings in a way that can be proven wrong.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `friction-signals` | no | Anchored friction events. |
| `gaps` | no | Classified gaps. |
| `ledger` | yes | Anchored evidence for the session. |

## Operation

Root-cause hypotheses must contain:

- a short mechanism-focused statement;
- supporting and counter-evidence;
- affected friction or gap identifiers;
- confidence;
- a falsifying or confirming test.

Deduplicate hypotheses by mechanism. When one mechanism produced several
symptoms, create one root-cause hypothesis and reference every affected friction
or gap identifier.

## Output

Each hypothesis records `id` from the `H` series, `hypothesis`,
`supporting_evidence`, `counter_evidence`, `affects`, `confidence`, and
`validation_test`.

## Guarantees

- One mechanism produces one hypothesis, not one per symptom.
- Every hypothesis names a test that could reject it.
- Causes are attributed to observable context, workflow, capability,
  instruction, routing, tool, environment, or irreducible ambiguity.

## Boundaries

Do not psychoanalyze the operator or the model.

**Error recovery.** With conflicting evidence, preserve both sides, lower
confidence, and define a future validation test rather than choosing a side.
