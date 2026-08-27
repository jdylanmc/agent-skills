---
name: evidence-anchor-ledger
description: Assign stable non-colliding anchors to every evidence item and finding, classify each material statement as observed, derived, hypothesis, or proposal, and assign a calibrated confidence band.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/evidence-assemble/evidence-assemble.md","post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md"]
---

# Evidence Anchor Ledger

Give every citable thing a stable name, then make every claim say what kind of
claim it is and how well it is supported.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `admitted-evidence` | yes | Redacted evidence items in encounter order. |
| `selected-session-log` | no | The projection returned for an operator-selected Copilot session event log. |
| `selected-log-slots` | no | Skill Run Log slots the operator selected, in selection order. |
| `confidence-cap` | no | A cap imposed by the evidence boundary or by a selected log. |

## Operation

1. **Anchor** session evidence in encounter order:
   - `U1`, `U2`: operator messages;
   - `A1`, `A2`: agent responses;
   - `T1`, `T2`: tool requests or results;
   - `S1`, `S2`: returned subagent results;
   - `R1`, `R2`: generated or inspected artifacts;
   - `M1`, `M2`: runtime metadata, compaction notices, or session-boundary
     notices.
2. **Assign one `T` anchor per tool call**, covering both its request and its
   result.
3. **Anchor a record from a selected Copilot session event log** by its physical
   line, as `E12`, and a range as `E12-18`. These anchors are assigned by the
   session-event reader and never collide with session or Skill Run Log anchors.
4. **Anchor a selected Skill Run Log record** as `<slot>:<line>`, for example
   `L1:12`, and a range as `L1:12-18`, where `L1` is the first selected log.
   These anchors never collide with session anchors.
5. **Anchor findings** separately so identifiers never collide with evidence:
   `F1...` for friction signals, `G1...` for gaps, and `H1...` for root-cause
   hypotheses.
6. **Classify** every material statement:
   - **Observed:** directly present in an anchor.
   - **Derived:** follows from cited observations using an explicit rule.
   - **Hypothesis:** plausible explanation with missing or conflicting evidence.
   - **Proposal:** a possible future improvement, never a fact or adopted rule.
7. **Band** confidence:
   - **High:** direct evidence, or multiple independent anchors, support the
     claim.
   - **Moderate:** direct evidence exists but causality or completeness is
     limited.
   - **Low:** plausible interpretation with material evidence gaps.
   - **Insufficient:** not responsibly supportable.
8. **Apply every cap.** When more than one cap applies, the most restrictive
   wins.

## Output

| Field | Meaning |
| --- | --- |
| `ledger` | Each anchor with its kind and a redacted summary. |
| `statement_type` | `observed`, `derived`, `hypothesis`, or `proposal`, per material statement. |
| `confidence` | `high`, `moderate`, or `low`, per material claim, after caps. |

## Guarantees

- Finding identifiers and evidence anchors never collide.
- A claim shows which source it came from, because each source owns its own
  anchor series.
- Repeated wording about one event is not treated as independent corroboration.
  A session-log record and the visible session moment it describes are one
  event, not two.
- `Insufficient` is never emitted as a confidence value. The claim is omitted
  and the missing evidence is recorded under limitations instead.

## Boundaries

This atom does not decide what is worth citing, form findings, or rank them. It
makes claims citable and calibrated.

**Error recovery.** Downgrade an unsupported causal claim to a hypothesis, or
omit it.
