---
name: review-tier-policy
description: Classify an explicitly opted-in code review as full or bounded correction verification using exact revision, lineage, semantic-risk, and model-policy evidence.
level: atom
allowed-tools: ["execute"]
includes: ["_base/_atoms/review-tier-policy/review-tier-policy.mjs"]
composes: []
used-by: ["roast/_molecules/roast-code-branch/roast-code-branch.md","ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md","ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Review Tier Policy

## Required Files

1. [Review tier classifier](./review-tier-policy.mjs)

For **new code-review intake**, the explicit version 2 default is
`deep-then-verify`: one full deep review followed by bounded correction
verification. Repeating the full council after every revision is the explicit
`repeated-full` choice. A manual `deep now` request always invokes the full
council for the current head.

Saved manifests with no policy remain historical full-review runs. Explicit
version 1 `baseline`, `shadow`, and `operational` policies retain their original
validation and behavior. Neither legacy shape is silently rewritten as the new
default.

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

The cumulative churn trigger is `(added lines + deleted lines)` from the last
deep-reviewed head to the current head, divided by the line churn in the
base-to-last-deep diff that the deep review examined. The default threshold is
strictly greater than 20 percent and may be configured in the version 2 policy.
Exactly 20 percent remains eligible. Zero baselines, unavailable measurement,
binary-file numstat, or malformed metrics require deep review.

Callers acquire churn with the bounded Git helper. It uses immutable full
object IDs and `git diff --numstat --no-ext-diff --no-textconv --no-renames`
with a timeout and output limit. It never uses repository size as the
denominator.

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

Version 1 baseline and shadow modes keep full review authoritative. Version 1 operational use
requires an explicit human-owned promotion receipt bound to the confirmed
packet digest and the normalized policy digest; agent, self, and system actors
are refused. This atom approves nothing and
owns no persistence, dispatch, cancellation, or orchestration.

A completed deep review establishes the next anchor. A retry, correction
attempt, or budget event does not. File-scope changes and semantic escalation
remain independent of churn.

Compare baseline and correction work only for the same exact head. Record
elapsed time, dispatch count, and finding IDs. When both observed seats used
the same model profile, report `same-model-profile-only`; do not claim a
GPT-6-versus-GPT-5.6 quality or speed result.
