---
name: trail-self-audit
description: Compare a decision trail against run evidence and expose missing reasoning, unsupported evidence, dropped alternatives, and ordering or tamper defects.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md"]
---

# Trail Self-Audit

Check whether the trail is reviewable before a human relies on it.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `trail` | yes | Ordered decision entries to audit. |
| `run evidence` | yes | Scoped source material: Chronicler replay, issue or pull request text, files, test output, reviewer notes, or parent workflow state. |
| `verification results` | yes | Verifier-produced references that bind each supported claim to scoped run evidence by locator and a digest computed from the scoped evidence content. Caller-declared evidence alone is not verification. |
| `publication target` | no | Whether the trail will stay local, be committed, or be published. |

## Audit Checks

Report defects instead of repairing the trail silently:

- `missing_entry`: a material decision visible in evidence has no row;
- `dropped_alternative`: a row lacks plausible rejected alternatives;
- `unsupported_evidence`: an evidence reference is missing from actual run
  evidence, lacks verifier provenance, has a mismatched source digest, or does
  not support the claim attached to it;
- `unreconstructable_reasoning`: the decision is known but rationale,
  alternatives, or maker cannot be recovered;
- `sequence_gap`: sequence numbers are missing or duplicated;
- `reordered_trail`: sequence numbers do not match physical row order;
- `tampered_trail`: row digest chain, prior sequence, or recorded row count does
  not match the actual row order;
- `unsafe_content`: unsanitized formula prefixes, control characters, or likely
  sensitive content remain;
- `publication_gate_unmet`: redaction, explicit operator approval, stated
  reviewer need, or independent review provenance is missing for the requested
  publication target.

## Publication Gate

Use these packet-level states:

| State | Meaning |
| --- | --- |
| `local-only` | Safe to return or keep locally; not approved for commit or publication. |
| `needs-redaction` | Sensitive or raw material remains. |
| `needs-independent-review` | The trail is high-stakes or intended for commit/publication and needs a different-model-family review with provenance. |
| `ready-for-review` | The trail is defect-free, sanitized, redacted as needed, approved for review publication, and ready for human review. |
| `blocked` | Required evidence, reviewer need, operator approval, review provenance, or integrity is missing. |

## Boundaries

- Self-audit is not approval. It reports defects and gates for a human.
- Do not discard defective rows; mark them.
- Do not treat the absence of evidence as evidence that a decision was safe.
- Do not broaden the evidence search beyond the operator's scoped work unless
  the operator or parent workflow explicitly asks for a broader audit.
