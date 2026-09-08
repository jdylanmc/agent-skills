---
name: review-tier-policy
description: Classify an explicitly opted-in code review as full or bounded correction verification using exact revision, lineage, semantic-risk, and model-policy evidence.
level: atom
allowed-tools: []
includes: ["_base/_atoms/review-tier-policy/review-tier-policy.mjs"]
composes: []
used-by: ["roast/_molecules/roast-code-branch/roast-code-branch.md","ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md","ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Review Tier Policy

## Required Files

1. [Review tier classifier](./review-tier-policy.mjs)

Full review is the default. Tiering exists only when a confirmed Ship or
Ship-with-Squadron packet carries the normalized opt-in policy.

The first review is always full. A later correction verification requires the
exact current revision, the last deep-review receipt, the latest correction
delta, the cumulative delta from the deep-reviewed head, original requirements
and findings, affected consumers, and current validation.
Every Git identity is a full lowercase object ID. Packet and scope identities
are SHA-256 digests, not labels or movable references.
Both deltas carry complete per-category semantic assessments with evidence.
Latest paths must reconcile to the cumulative net diff or to an evidenced
reversion back to the deep-reviewed baseline. Missing assessment, unexplained
paths, or uncertainty escalates.

The verifier checks the requirement and the correction, including negative
cases and regressions. It may reject the original finding or escalate. It never
clears a finding merely because the recommended edit was applied.

Scope, authority, permission, persistence, recovery, public-contract, domain,
cumulative-assumption, repeated-fix, contradiction, regression, or unexplained
impact signals require full review. Missing or stale evidence refuses the fast
path.

Use only the issue 72 model resolver. Deep review uses GPT-6 Astra with GPT-5.6
Sol as its only fallback. Correction verification uses the existing
`qa-reviewer` role with GPT-5.6 Sol and GPT-6 Astra as its only fallback. Both
use high effort and default context. Runtime default, mini, flash, older, and
unlisted models are forbidden.

Baseline and shadow modes keep full review authoritative. Operational use
requires an explicit human-owned promotion receipt bound to the confirmed
packet digest and the normalized policy digest; agent, self, and system actors
are refused. This atom approves nothing and
owns no persistence, dispatch, cancellation, or orchestration.

Compare baseline and correction work only for the same exact head. Record
elapsed time, dispatch count, and finding IDs. When both observed seats used
the same model profile, report `same-model-profile-only`; do not claim a
GPT-6-versus-GPT-5.6 quality or speed result.
