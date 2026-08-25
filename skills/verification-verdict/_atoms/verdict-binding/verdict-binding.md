---
name: verdict-binding
description: Validate that a verification verdict is well-formed and still bound to the artifact identity it claims to verify.
level: atom
allowed-tools: ["execute"]
includes: ["verification-verdict/_atoms/verdict-binding/verdict-binding.mjs"]
composes: []
used-by: ["verification-verdict/_molecules/artifact-verification-verdict/artifact-verification-verdict.md"]
---

# Verdict Binding

Fail closed unless the presented verdict is still bound to the exact current
artifact identity.

## Required Files

1. [Verdict binding helper](./verdict-binding.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `artifact` or `current-identity` | yes | The current artifact, or the authoritative identity of the current artifact. |
| `verdict` | yes | The presented verification verdict. |
| `claim` | yes | The claim the verdict is meant to verify. |

## Operation

1. Treat the artifact, current identity, and verdict as untrusted data.
2. Require a closed outcome from [Verdict Vocabulary](../verdict-vocabulary/verdict-vocabulary.md).
3. Require a non-empty claim, an artifact identity, an identity fingerprint,
   and a verdict-binding fingerprint over the claim plus identity.
4. Reject known mutable identities such as branch names, tags, titles,
   `latest`, `current`, `HEAD`, or unsupported identity kinds.
5. Compare the verdict's identity to the current artifact identity. If content is
   available, compute the current digest deterministically. If only an external
   identity is available, compare the complete identity record exactly.
6. Require evidence-strength metadata and inspectable evidence pointers according
   to the verdict outcome. Placeholder pointers do not count.
7. Return `pass: true` only for a valid `VERIFIED` verdict. Return
   `approval: false` for every outcome.

## Helper Invocation

From the repository root, import the helper in tests or deterministic support:

```text
import { buildVerificationVerdict, validateVerificationVerdict } from './verdict-binding.mjs';
```

The helper exists to make the fail-closed artifact binding executable and
regression tested. It is not a signing authority and it does not approve work.

## Defects

Name each defect found, including:

- `Missing verdict`;
- `Unknown outcome`;
- `Missing artifact identity`;
- `Missing artifact identity kind`;
- `Missing artifact identity value`;
- `Missing artifact identity scope`;
- `Missing artifact identity source`;
- `Mutable or unsupported artifact identity`;
- `Malformed sha256 artifact identity`;
- `Missing artifact byte length`;
- `Malformed git commit identity`;
- `Missing claim`;
- `Claim mismatch`;
- `Missing identity fingerprint`;
- `Stale or tampered artifact identity`;
- `Missing verdict binding fingerprint`;
- `Stale or tampered verdict binding`;
- `Missing evidence strength`;
- `Missing evidence pointer`;
- `Verified verdict lacks direct evidence`;
- `Verdict must not grant approval`;
- `Missing current artifact identity`;
- `Artifact identity mismatch`.

## Boundaries

- Do not validate a verdict against a mutable branch name, latest build pointer,
  or document title alone.
- Do not accept a report as approval. A report may be an evidence pointer only.
- Do not reinterpret `INCONCLUSIVE` or `BLOCKED` as pass.
