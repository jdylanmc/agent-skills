---
name: artifact-verification-verdict
description: Combine artifact identity, closed outcome vocabulary, and fail-closed binding validation into one auditable verification verdict.
level: molecule
includes: ["verification-verdict/_atoms/artifact-identity/artifact-identity.md","verification-verdict/_atoms/verdict-vocabulary/verdict-vocabulary.md","verification-verdict/_atoms/verdict-binding/verdict-binding.md"]
composes: ["verification-verdict/_atoms/artifact-identity/artifact-identity.md","verification-verdict/_atoms/verdict-vocabulary/verdict-vocabulary.md","verification-verdict/_atoms/verdict-binding/verdict-binding.md"]
used-by: ["verification-verdict/SKILL.md"]
allowed-tools: ["execute"]
---

# Artifact Verification Verdict

Produce or evaluate one verdict for one artifact and one claim.

## Required References

1. [Artifact identity](../../_atoms/artifact-identity/artifact-identity.md)
2. [Verdict vocabulary](../../_atoms/verdict-vocabulary/verdict-vocabulary.md)
3. [Verdict binding](../../_atoms/verdict-binding/verdict-binding.md)

## Workflow

1. Run [Artifact identity](../../_atoms/artifact-identity/artifact-identity.md)
   to capture the exact current artifact identity and verification scope.
2. Run [Verdict vocabulary](../../_atoms/verdict-vocabulary/verdict-vocabulary.md)
   to choose one of `VERIFIED`, `NOT_VERIFIED`, `INCONCLUSIVE`, or `BLOCKED`
   and attach evidence-strength metadata plus evidence pointers.
3. Run [Verdict binding](../../_atoms/verdict-binding/verdict-binding.md) before
   returning or accepting a verdict. A verdict with missing, stale, mutated, or
   tampered identity fails closed.

## Verdict Record

Return a record with:

- `claim`;
- `outcome`;
- `artifact_identity`;
- `artifact_identity_fingerprint`;
- `verdict_binding_fingerprint`, computed over the exact claim and artifact identity;
- `evidence_strength`;
- `evidence_pointers`;
- `checked_at`;
- `verifier`;
- `pass`, true only for valid `VERIFIED`;
- `approval`, always false;
- `defects`, empty only when the verdict is well-formed and bound to the current
  artifact identity.

## Interpretation

`pass` is not approval. It means only that the verdict is well-formed, bound to
the current artifact identity, and has outcome `VERIFIED`. `NOT_VERIFIED`,
`INCONCLUSIVE`, and `BLOCKED` are valid outcomes when well formed, but they are
not passing outcomes.

## Boundaries

- Do not create a shared `_base` unit until more than one skill actually
  composes this primitive.
- Do not duplicate Continuous Integration (CI) result classification. Use CI
  receipts as evidence pointers and preserve their original status vocabulary.
- Do not use review report contract validation as correctness validation. A
  well-formed report can support only the fact that its declared structure held.
- Do not grant human approval, sign-off, risk acceptance, merge authority, or
  deployment authority.
