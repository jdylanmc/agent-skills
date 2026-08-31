---
name: engineering-design
description: Bind approved functional authority, determine whether design is required, compare consequential approaches, render and validate one engineering design with ADR and proposed-NFR outputs, and resolve its downstream status.
level: molecule
includes: ["technical-design/_atoms/design-intake/design-intake.md","technical-design/_atoms/design-impact/design-impact.md","technical-design/_atoms/approach-analysis/approach-analysis.md","technical-design/_atoms/design-document/design-document.md","technical-design/_atoms/nfr-proposals/nfr-proposals.md","technical-design/_atoms/design-outcome/design-outcome.md","technical-design/_molecules/engineering-design/engineering-design.mjs"]
composes: ["technical-design/_atoms/design-intake/design-intake.md","technical-design/_atoms/design-impact/design-impact.md","technical-design/_atoms/approach-analysis/approach-analysis.md","technical-design/_atoms/design-document/design-document.md","technical-design/_atoms/nfr-proposals/nfr-proposals.md","technical-design/_atoms/design-outcome/design-outcome.md"]
used-by: ["technical-design/SKILL.md"]
allowed-tools: ["execute"]
---

# Engineering Design

Build one evidence-bound design from already-approved functional intent.

```text
intake -> impact -> approaches -> document and ADRs -> NFR proposals -> resolve
```

## Required References

1. [Design intake](../../_atoms/design-intake/design-intake.md)
2. [Design impact](../../_atoms/design-impact/design-impact.md)
3. [Approach analysis](../../_atoms/approach-analysis/approach-analysis.md)
4. [Design document](../../_atoms/design-document/design-document.md)
5. [Non-functional requirement proposals](../../_atoms/nfr-proposals/nfr-proposals.md)
6. [Design outcome](../../_atoms/design-outcome/design-outcome.md)

## Required Files

1. [Engineering-design resolver](./engineering-design.mjs)

## Workflow

1. Run Design intake. Bind one approved nano specification, its supporting full
   document, and the exact functional requirement identifiers and text. Record
   a digest or revision so the output can prove which immutable input it used.
2. Run Design impact before drafting architecture. The impact report answers
   each deterministic question and either opens the design path or permits the
   explicit no-design-required path.
3. If design is required, run Approach analysis. Every consequential decision
   gets common decision criteria, at least two distinct viable approaches, evidence for
   each comparison, one selected approach or an unresolved decision, and the
   reason every rejected viable alternative lost.
4. Run Design document. Produce one design document and applicable ADRs. Every
   material claim carries an exact citation. Every functional requirement maps
   to one or more design sections, or to an explicit no-impact statement with
   evidence. Embed the resolver's canonical design-inventory block in that same
   document so the persisted artifact, rather than a detached caller packet, is
   the home of record for decisions, claims, traceability, applicability, NFR
   references, and evidence gaps.
5. Run Non-functional requirement proposals. A design may propose shared
   requirements beneath `docs/agent/nfr/`, but each file is visibly
   non-authoritative and this workflow cannot approve it.
6. Fetch and verify approval against the provider-backed remote default branch,
   a boundary this skill cannot merge into. The invoking verifier supplies the
   canonical repository URL outside the design packet; without that trusted
   identity, approval remains unavailable. The fixed `origin` remote must match
   it before any published evidence is accepted. Engineering approval requires
   the exact design bytes plus their embedded design identity and revision.
   Specification approval requires the local and published nano bytes to match,
   then parses the published identity, revision, and acceptance criteria to bind
   the immutable functional-requirement inventory. Separately approved NFRs
   require a distinct approval receipt beneath `docs/agent/nfr/approvals/`
   whose published bytes bind the proposal identity, revision, source design,
   and digest. Publishing the proposal itself is never approval. Design
   approval never approves an NFR, and the proposal remains unchanged.
7. Reread every written artifact. Run the NFR validator and then the
   engineering-design resolver with the bounded repository root. The resolver
   reproduces design, ADR, and NFR proposal digests from regular, non-symbolic
   repository files, verifies approval observations against the trusted
   repository identity and remote default branch, reads approved artifacts from
   the verified immutable commit, requires the persisted canonical design
   inventory to equal the validated packet, then cross-checks impact,
   approaches, claim citations, traceability, applicability coverage, ADR
   dispositions, unresolved items, engineering approval, and NFR authority.
8. Return the resolved packet. Do not dispatch downstream work.

## Resolution Order

Worst to best:

1. `blocked` for malformed or contradictory authority and invalid output;
2. `needs-decision` for unresolved engineering choices, absent specification
   approval, or proposed NFRs awaiting separate approval;
3. `needs-evidence` for material unsupported claims or evidence gaps;
4. `no-design-required` only through the deterministic impact gate;
5. `complete` when the design is internally reconciled.

## Cross-Checks

The resolver catches defects no individual section can see:

- a functional requirement omitted from design traceability;
- a consequential decision with fewer than two viable approaches;
- a material claim with no citation;
- an applicable concern with no design treatment;
- an ADR-worthy decision buried without an ADR disposition;
- a proposed NFR presented as approved or downstream-authoritative;
- a no-design-required claim while any design-impact signal is true;
- a no-design-required claim without per-requirement no-impact traceability.

## Boundaries

- The molecule writes design outputs; it never edits its specification inputs.
- It records unresolved product gaps but does not fill them with architecture.
- It does not treat a human-readable document as validated until the
  deterministic report reconciles its structured inventory.
- It does not invoke Quality Assurance design, requirements breakdown,
  implementation, provider operations, or tracker operations.
