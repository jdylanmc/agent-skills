---
name: bounded-synthesis
description: Coordinate a bounded synthesis run from one bound source through profile resolution, candidate rendering, disclosure-ledger validation, split evaluation, and deterministic outcome resolution, so a smaller variant is produced only when meaning is accounted for.
level: molecule
includes: ["synthesize/_atoms/candidate-persistence/candidate-persistence.md","synthesize/_atoms/disclosure-ledger/disclosure-ledger.md","synthesize/_atoms/source-binding/source-binding.md","synthesize/_atoms/split-proposal/split-proposal.md","synthesize/_atoms/synthesis-outcome/synthesis-outcome.md","synthesize/_atoms/synthesis-profile/synthesis-profile.md","synthesize/_molecules/bounded-synthesis/bounded-synthesis.mjs"]
composes: ["synthesize/_atoms/candidate-persistence/candidate-persistence.md","synthesize/_atoms/disclosure-ledger/disclosure-ledger.md","synthesize/_atoms/source-binding/source-binding.md","synthesize/_atoms/split-proposal/split-proposal.md","synthesize/_atoms/synthesis-outcome/synthesis-outcome.md","synthesize/_atoms/synthesis-profile/synthesis-profile.md"]
used-by: ["synthesize/SKILL.md"]
allowed-tools: ["execute"]
---

# Bounded Synthesis

Convert one bound source into one profile-defined candidate variant, and account
for every difference.

```text
bind the source -> resolve the named profile -> render the candidate variant
                -> validate the disclosure ledger against the rendered candidate
                -> evaluate a split when over budget
                -> resolve the outcome -> atomically persist complete output
```

## Required References

1. [Source binding](../../_atoms/source-binding/source-binding.md)
2. [Synthesis profile](../../_atoms/synthesis-profile/synthesis-profile.md)
3. [Disclosure ledger](../../_atoms/disclosure-ledger/disclosure-ledger.md)
4. [Split proposal](../../_atoms/split-proposal/split-proposal.md)
5. [Synthesis outcome](../../_atoms/synthesis-outcome/synthesis-outcome.md)
6. [Candidate persistence](../../_atoms/candidate-persistence/candidate-persistence.md)
7. [Bounded synthesis finalizer](./bounded-synthesis.mjs)

## Operation

1. Run [Source binding](../../_atoms/source-binding/source-binding.md) against
   exactly one identified, revision-bound source beneath `docs/agent/`. Refuse
   an unbound, out-of-workspace, symlinked, unreadable, or stale source. Retain
   the returned digest as proof of the exact bytes read.
2. Run [Synthesis profile](../../_atoms/synthesis-profile/synthesis-profile.md)
   with the one profile id the caller named. There is no default; an unknown or
   absent id refuses. The resolved profile fixes the output pattern, the word
   budget, the required content, and the kinds that may never be dropped.
3. Render the candidate variant from the bound source under the resolved
   profile, then measure it with the profile's deterministic word count. The
   candidate is a real artifact at this point, not a promise.
4. Run [Disclosure ledger](../../_atoms/disclosure-ledger/disclosure-ledger.md)
   against the source text, the **rendered** candidate text, the source and
   candidate paths, and the resolved profile. The ledger is validated against the
   candidate that was actually produced, never against an intention to produce
   one, because a claim about a document is only checkable once the document
   exists — an anchor into a variant that was never rendered proves nothing, and
   content the ledger did not account for can only be found in text that is
   really there. The source and candidate paths let the ledger confirm the
   artifacts are the shape the profile names.
5. Run [Split proposal](../../_atoms/split-proposal/split-proposal.md) with the
   budget status, the validated ledger entries, the profile id, and the ledger
   digest. Below budget it reports that no split is required; over budget it
   derives the non-omittable inventory from those ledger entries and requires a
   partitioning proposal set rather than truncation, relocation of authority, or
   a weakened criterion. The inventory is derived from the ledger, not supplied,
   so an incomplete split cannot partition a hand-written list perfectly.
6. Run [Synthesis outcome](../../_atoms/synthesis-outcome/synthesis-outcome.md)
   over the binding, budget, ledger, and split evidence. The outcome resolver is
   deliberately separate from the synthesis it judges: the step that decides
   whether the run passed is not the step that rendered the candidate, so a run
   cannot grade its own output by narrating success.
7. Only when the resolved outcome is `complete`, run
   [Candidate persistence](../../_atoms/candidate-persistence/candidate-persistence.md).
   Render to its unique sibling staging path first; do not write the canonical
   path during rendering or validation. The persistence atom verifies the staged
   bytes against the digest returned by outcome resolution, refuses every
   existing destination, checks path components and staging identifiers, and
   publishes with atomic create-if-absent semantics. Every other outcome removes
   or abandons staging and leaves the canonical destination untouched. Any
   persistence refusal changes the final run status to `blocked`; an outcome
   resolver result of `complete` is not the final status until persistence
   succeeds.

Invoke the final transition with:

```text
node <molecules>/bounded-synthesis/bounded-synthesis.mjs \
  --finalize <absolute-json-path>
```

## Output

Return the source binding with its digest, the resolved profile id, the staged
candidate evidence when rendering occurred, the word count and disclosure
ledger when those stages occurred, any proposed secondary boundaries, the
resolved status, and the persistence receipt only for `complete`.

## Determinism

The deterministic layer is binding, budget, ledger, split, and outcome: given
the same source bytes, profile, candidate text, and ledger, each stage produces
an identical result and identical digests, run after run. **Rendering the
candidate is a model act and is not byte-deterministic** — that is precisely why
the ledger is validated against the rendered candidate rather than trusted, and
why nothing here claims a deterministic renderer. The revision that pins the
source and the ledger digest that pins the account are computed from bytes, so a
later run can prove it looked at the same artifact and validated the same ledger.

## Boundaries

This molecule binds one source, renders one candidate under one profile,
validates the ledger, evaluates a split, and resolves a status. It does not
author the source, review or roast the candidate, approve it, publish it,
implement it, or merge it. A `complete` status is a statement about mechanical
checks; the variant remains a candidate until a human approves it.
