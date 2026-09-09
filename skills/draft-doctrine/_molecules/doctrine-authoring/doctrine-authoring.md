---
name: doctrine-authoring
description: Coordinate raw human position capture, required Prompt Coach review, selective verified-doctrine comparison, contradiction reporting, exact candidate approval, and failure-honest persistence for one doctrine target.
level: molecule
includes: ["_base/_atoms/contradiction-check/contradiction-check.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md"]
composes: ["_base/_atoms/contradiction-check/contradiction-check.md","_base/_atoms/doctrine-evaluate/doctrine-evaluate.md","draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md"]
used-by: ["draft-doctrine/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Doctrine Authoring

Coordinate one human-governed doctrine candidate without acquiring doctrine
authority.

```text
receive raw position, provenance, and root-validated Prompt Coach evidence
-> verify manifest and doctrine
-> select relevant doctrine -> draft one target -> report overlap/contradiction
-> display exact bytes/diff -> exact human approval -> transaction -> reread
```

## Required References

1. [Contradiction check](../../../_base/_atoms/contradiction-check/contradiction-check.md)
2. [Doctrine evaluation](../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.md)
3. [Doctrine transaction](../../_atoms/doctrine-transaction/doctrine-transaction.md)

## Workflow

1. Capture one operation and one target. `create` takes a proposed canonical
   identifier; `update` takes an existing canonical identifier. Record the
   problem, human position, consumers, precedence, exceptions, provenance,
   positive/negative/boundary examples, and expected evidence and review.
   Missing human authority is `needs-input`; do not fill it with model policy.
2. Preserve that intake as the raw doctrine prompt. Receive the Prompt Coach
   report and human disposition from the root skill, which owns dispatch
   permission. Verify that the evidence binds exactly those bytes. Its report
   is coaching, never approval. Deterministic absence, invalid output, or a
   digest mismatch stops before candidate finalization.
3. Verify the strict manifest and every declared digest. Search identifiers,
   headings, and relevant terms to choose a bounded comparison set. Load only
   the selected doctrine text into drafting context: the update target plus
   directly relevant overlap candidates. Never load all doctrine as ambient
   guidance.
4. Draft only the requested human position using the completeness lens:
   position and reason, applicability and consumers, rules or heuristics,
   precedence, evidence, exceptions, non-goals, unsafe interpretations, and
   compliant/non-compliant/ambiguous examples. This is not a mandatory prose
   schema. Prompt Coach clarifications must be listed separately as accepted
   effects.
5. Apply the contradiction-check discipline to the candidate and verified
   relevant doctrine. Report `overlap` and `contradiction` with doctrine
   identifier, exact cited evidence, candidate position, and confidence. Do
   not add a winner or resolution. A human decision is required where authority
   remains ambiguous.
6. For imported material, require a closed, fresh human verification record:
   source locator, pinned source revision or digest, author, license identifier
   or text basis, verifier identity and role, verified-at timestamp, explicit
   compatibility decision, and attribution requirement. The workflow never
   judges compatibility. When attribution is required, prepare the complete
   non-whitespace `NOTICE.md` result as a separate candidate surface and
   mechanically require its author, license identifier, and source locator.
7. Run doctrine-transaction prepare. Display the exact UTF-8 candidate bytes,
   SHA-256 digest, target, complete result, and, for update, exact diff and
   prior doctrine and manifest revisions. Display NOTICE independently.
   Every create or update doctrine candidate must contain fewer than 500 words
   across the complete file.
8. Request exact human approval. Any correction discards approval and returns
   to drafting. Rejection or cancellation writes nothing. Unrelated replies and
   silence remain `needs-approval`, never implicit consent.
9. Persist only through doctrine-transaction in this approval-bound order:
   optional NOTICE, doctrine, unchanged relevant-doctrine guards, manifest
   last. Report caught-error rollback residue honestly. Hard termination is not
   rolled back: before manifest it may leave early NOTICE attribution and/or
   doctrine that the old manifest no longer authenticates, never authenticated
   doctrine missing required attribution. The next preparation blocks on
   doctrine digest drift; NOTICE-only residue requires ordinary human review
   and re-approval. A stop after manifest still cannot report success before
   full reread verification. Never write doctrine before approval.
10. Return the complete output contract and leave publication to the normal
    reviewed change-request path. Do not approve, publish, merge, or implement
    a doctrine backlog.

## Output

Return operation; target identifier and path; provenance and attribution;
Prompt Coach report, human decision, and accepted effects; overlap and
contradiction evidence; candidate and prior doctrine/manifest/NOTICE digests
and revisions; exact approval records; changed paths; reread verification;
unresolved decisions; publication or next-review action; and Chronicler status.

Statuses are `needs-input`, `needs-source`, `needs-decision`,
`needs-approval`, `approved-and-written`, `blocked`, and `cancelled`.
