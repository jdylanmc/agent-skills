---
name: design-document
description: Render one readable engineering design document, applicable ADRs, evidence-cited claims, and complete functional-requirement traceability.
level: atom
includes: []
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Design Document

Write one design that a reviewer can decide from and an implementer can follow.

## Audience and Purpose

Write for engineers and reviewers who know the repository but were not present
for Discovery. The document supports one decision: whether the proposed
engineering design is sufficiently explicit and evidenced to approve.

Use stable domain terms. Define unfamiliar abbreviations on first use. Preserve
exact identifiers, commands, interface names, and requirement text. Put
prerequisites and cautions before any consequential rollout or migration step.

## Required Sections

1. Identity, source revision, approval evidence, audience, and purpose.
2. Immutable functional-requirement inventory.
3. Context, evidence, constraints, and explicit assumptions.
4. Design-impact assessment.
5. Selected architecture and rejected viable alternatives.
6. Component, ownership, trust, data, and process boundaries.
7. Interfaces and schemas.
8. State, transitions, invariants, ordering, and concurrency.
9. Failure, retry, degradation, recovery, and idempotency behavior.
10. Compatibility, migration, and versioning.
11. Verification strategy.
12. Security, privacy, observability, and operational treatment.
13. Rollout, observation, rollback, and recovery.
14. Functional-requirement-to-design traceability.
15. ADR inventory.
16. Proposed non-functional requirement inventory and authority warning.
17. Unresolved engineering decisions and evidence gaps.

For an inapplicable section, write `Not applicable`, the reason, and a citation.
Do not omit the section. Every material claim about the existing system,
constraint, compatibility, risk, or operation cites an exact repository path
and revision, Discovery evidence locator, approved requirement, or experiment
result.

## Output Shape

Write exactly one design document. Do not produce nano and full versions.
Create separate ADRs only for decisions that pass the ADR test; link them from
the design instead of duplicating their full rationale.

Bind the persisted document by design identity, revision, path, and content
digest. Reread the persisted bytes and record successful integrity verification;
an in-memory draft or stale approval cannot satisfy completion.

Embed one canonical `technical-design-manifest` block in the document. It
contains the exact functional-requirement inventory, impact assessment,
disposition, traceability, decisions, material claims, applicability
dispositions, proposed-NFR inventory, and evidence gaps validated by the
resolver, plus the design identity and the complete source-specification
identity, revision, source, nano/full paths, nano/full digests, and functional
requirement digest. Missing, duplicate, malformed, or mismatched manifests
block completion; a detached caller packet cannot substitute for persisted
design content.

Before persistence, check accuracy against the evidence ledger, terminology,
identifiers, qualifiers, prerequisites, recovery behavior, applicability
dispositions, and unsupported claims. Reread persisted bytes before reporting a
path as verified.

## Boundary

The document describes architecture, not implementation tickets. Avoid
decay-prone file-by-file work plans and code snippets except a bounded
proof-of-concept fragment that expresses a decision more precisely than prose.
