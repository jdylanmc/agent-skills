---
name: decision-entry
description: Define the structured row for one material decision, including selected option, rejected alternatives, evidence, decision maker, confidence, and visible defects.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md"]
---

# Decision Entry

Represent one consequential choice as one reviewable row.

## Materiality Standard

Record a row when the choice changes or constrains:

- scope, delivery route, architecture, data model, permissions, safety, privacy,
  security, review posture, publication, or validation;
- interpretation of ambiguous evidence;
- acceptance of uncertainty, missing information, or risk;
- a handoff, terminal disposition, or human gate.

Do not record routine file reads, formatting choices, command retries, ordinary
progress updates, or mechanical implementation details unless they materially
change the decision path.

## Required Row Fields

| Field | Meaning |
| --- | --- |
| `sequence` | Monotonic integer assigned by physical row order. |
| `decision_id` | Stable short identifier unique inside the trail. |
| `timestamp` | ISO-8601 UTC time the row was recorded or reconstructed. |
| `decision_maker` | Human, agent, parent workflow, or reviewer that made the choice. |
| `decision` | The choice being made, phrased so a reviewer can agree or disagree. |
| `selected_option` | The option chosen. |
| `route_rationale` | Why this option won now, using scoped evidence rather than memory. |
| `rejected_alternatives` | Non-empty list of plausible alternatives and the reason each lost. |
| `evidence` | Non-empty references to evidence relied on, each with a locator and summary. |
| `confidence` | `high`, `medium`, `low`, or `unreconstructable`. |
| `authority_check` | Why the maker was allowed to choose, or which human gate remains. |
| `outcome_state` | `proposed`, `accepted`, `rejected`, `superseded`, or `unreconstructable`. |
| `human_gate` | Review, approval, or decision still owed before action or publication. |
| `redaction_state` | `raw`, `sanitized`, `redacted`, or `publishable`. |
| `defects` | Visible audit defects; empty only when the row passed self-audit. |

## Rejected Alternatives

Every entry must name at least one alternative unless the row is explicitly
`unreconstructable`. An alternative includes:

- `option`;
- `reason_lost`;
- `evidence` supporting that rejection, or a defect when no support exists.

A dropped alternative is an audit defect because it prevents a human from seeing
what the decision maker did not choose.

## Evidence References

Evidence references identify where the support can be checked without embedding
raw sensitive material. Prefer compact locators such as issue URLs, file paths
with line ranges, test names, commit hashes, build IDs, Chronicler anchors, or
conversation artifact anchors.

An evidence item includes:

- `locator`;
- `summary`;
- optional `quote`, only when safe and short;
- `trust_boundary`, such as `repository`, `tracker`, `session-log`,
  `conversation`, `external`, or `untrusted-input`.

Unsupported evidence claims remain visible as defects rather than being
silently removed.

## Unreconstructable Reasoning

If the decision is known but its rationale or alternatives cannot be recovered,
record a row with:

- `confidence: unreconstructable`;
- `outcome_state: unreconstructable`;
- `defects` containing `unreconstructable_reasoning` and the missing fields;
- whatever evidence proves the decision happened.

Never invent rationale to make the row look complete.
