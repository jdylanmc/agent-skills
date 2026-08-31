---
name: nfr-proposals
description: Write shared non-functional requirement candidates beneath docs/agent/nfr while preserving their proposed, separately-approved authority state.
level: atom
includes: ["technical-design/_atoms/nfr-proposals/nfr-proposals.mjs"]
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Non-Functional Requirement Proposals

Record cross-cutting requirements surfaced by design without granting them
authority.

## Required Files

1. [Proposal validator](./nfr-proposals.mjs)

## Proposal Contract

Write one file per proposal beneath `docs/agent/nfr/`. Each proposal contains:

- stable `id` and `revision`;
- `authority: proposed`;
- `approval.state: pending`;
- the design decision that generated it;
- the doctrine rule or evidence that justifies it;
- the functional requirement or acceptance criterion it serves;
- one measurable threshold, or exactly `threshold-unknown`;
- scope and applicability;
- verification intent;
- the source design identity and revision;
- `downstreamAuthorityWarning: not-authority-until-separately-approved`, the
  stable warning that Quality Assurance design and requirements breakdown must
  not treat the proposal as authority.

Render the proposal through the validator's canonical Markdown form. Final
design resolution rereads that file, reproduces its digest, and rejects any
inventory whose fields differ from the persisted bytes.

Run:

```text
echo '{"proposals":[...]}' |
  node skills/technical-design/_atoms/nfr-proposals/nfr-proposals.mjs
```

The validator returns `valid`, `needs-threshold`, or `invalid`.

## Separate Human Approval

This skill always emits `authority: proposed` and `approval.state: pending`.
Only a separate human-owned approval process may produce an authoritative NFR
record. Design approval is not NFR approval. Co-location in one change request
is not NFR approval. A downstream consumer accepts an NFR only when its
authority is `approved` and separate approval evidence is present.
That evidence binds the proposal identity, revision, and source-design
identity and exact proposal digest. It is a distinct provider-backed receipt
beneath `docs/agent/nfr/approvals/`; the proposed file itself can never serve as
its receipt. Approval of an older or foreign proposal is not approval of the
current one.

Any proposal keeps technical-design at `needs-decision` until that external
approval is observed or the proposal is withdrawn by a human-owned decision.

## Boundary

This atom does not edit functional requirements, invent an unsupported
threshold, approve a proposal, or dispatch downstream work.
