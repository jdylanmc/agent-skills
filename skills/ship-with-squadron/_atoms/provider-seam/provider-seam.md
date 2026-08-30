---
name: provider-seam
description: Constrain provider adapters to allow-listed issue reads, change-request publication, and human-merge observation while preserving degradation and preventing duplicate publication.
level: atom
allowed-tools: ["execute","read"]
includes: ["ship-with-squadron/_atoms/provider-seam/provider-seam.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
---

# Provider Seam

## Required Files

1. [Provider seam helper](./provider-seam.mjs)

Keep provider-specific behavior behind an adapter configured by the confirmed
manifest. Use the provider seam helper to allow only:

- `read-issue`;
- `publish-change-request`;
- `observe-merge`.

Every adapter condition is preserved. Unsupported, missing, unauthenticated,
degraded, and unobserved provider state is not empty, clean, published, or
merged state.

Publication is serialized per issue/provider/repository/head/base identity.
Refuse a duplicate key. `published` requires the provider-returned identifier;
a pushed branch or predicted identifier is not publication.

Only an observed provider snapshot with `merged: true`, merge commit, change
request, base, and observation time proves a human merge. Merge grants and
worker reports are evidence, not authority.

The seam has no operation for merge, approve, enable auto-merge, accept risk,
force-push, close issue, or close change request. All are explicitly refused.
