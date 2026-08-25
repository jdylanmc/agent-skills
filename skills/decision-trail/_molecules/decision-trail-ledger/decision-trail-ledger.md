---
name: decision-trail-ledger
description: Assemble, sanitize, and self-audit ordered decision entries into a human-reviewable decision trail.
level: molecule
includes: ["decision-trail/_atoms/decision-entry/decision-entry.md","decision-trail/_atoms/trail-sanitization/trail-sanitization.md","decision-trail/_atoms/trail-self-audit/trail-self-audit.md","_base/_atoms/redact-sensitive/redact-sensitive.md","decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.mjs"]
composes: ["decision-trail/_atoms/decision-entry/decision-entry.md","decision-trail/_atoms/trail-sanitization/trail-sanitization.md","decision-trail/_atoms/trail-self-audit/trail-self-audit.md","_base/_atoms/redact-sensitive/redact-sensitive.md"]
used-by: ["decision-trail/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Decision Trail Ledger

Turn why material decisions were made into a structured trail that can survive
later human review.

## Required References

1. [Decision entry](../../_atoms/decision-entry/decision-entry.md)
2. [Trail sanitization](../../_atoms/trail-sanitization/trail-sanitization.md)
3. [Trail self-audit](../../_atoms/trail-self-audit/trail-self-audit.md)
4. [Sensitive content redaction](../../../_base/_atoms/redact-sensitive/redact-sensitive.md)

## Required Files

1. [Deterministic decision-trail helper](./decision-trail-ledger.mjs)

## Workflow

1. Scope the trail to one reviewable run, pull request, work item, session, or
   parent workflow decision chain.
2. Create one row per material decision using Decision entry. Preserve physical
   order; never sort the trail after the fact.
3. Sanitize each row using Trail sanitization before returning or storing it.
4. Compute row digests and a digest chain over the ordered sanitized rows when
   the trail will be stored or reviewed later. The digest chain is tamper
   evidence, not access control.
5. Self-audit the trail against scoped run evidence using Trail self-audit.
   The deterministic helper treats the packet as untrusted input; verified
   evidence and independent-review provenance must come from a trusted adapter
   channel that resolved actual run evidence, not from fields inside the packet.
6. Return the packet and defects. If a row cannot be made complete, keep it in
   the packet with defects instead of deleting it.

## Row Integrity

A stored or committed trail should carry:

- row `sequence` values that match physical order;
- `previous_digest` for every row after the first;
- `row_digest` computed from the canonical sanitized row content;
- packet `row_count` and `trail_digest`.

When validating a persisted packet, compare the recorded `row_count` and
`trail_digest` with the actual entries before accepting the packet. When any
value disagrees with physical order, canonical content, or the recorded packet
summary, report a `tampered_trail` or `reordered_trail` defect and block
publication.

## Storage Boundary

Return the packet by default. If storage is explicitly requested, write only a
sanitized local artifact under the current workspace. Do not commit, publish,
attach, or message the trail unless the operator explicitly approves and the
publication gate is satisfied.

## Regression Suite

From the repository root, run:

```text
node --test skills/decision-trail/decision-trail.conformance.test.mjs
```

The suite covers routing, permissions, composition, sanitization, missing
alternatives, unsupported evidence, and tampered or reordered trails.
