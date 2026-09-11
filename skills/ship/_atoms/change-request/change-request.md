---
name: change-request
description: Publish one authorized delivery through official provider tools, retaining honest incomplete outcomes and refusing effects after cancellation or withdrawn authority.
level: atom
allowed-tools: ["execute","read"]
includes: ["ship/_atoms/change-request/change-request.mjs"]
composes: []
used-by: ["ship/SKILL.md"]
---

# Change Request

Publication mutates a shared remote. Perform it after scope reconciliation,
declared validation, review and criterion reporting, never as an early claim
that delivery is complete.

## Required Files

1. [Publication implementation](./change-request.mjs)

## Guarded effects

Use `publishChangeRequest` with:

- `readState`: the **live** run outcome and authority, not a cached grant;
- `push`: a normal, non-force push of this run's isolation branch, returning
  `{status: 'pushed'}` only on actual success;
- `create`: the official provider command plus readback, returning
  `{outcome: 'published', identifier, ...observed publication facts}` only when
  the provider returned that identifier.

`authority.status: active` and `authority.publish: true` record the operator's
existing delivery authority. The helper does not grant it. `verified`,
`incomplete` and `handed-back` are publishable only with that authority.
Incomplete criteria and exhausted remediation stay prominent in the body,
with outstanding defects and `n/5` attempts. Missing required tools may prevent
publication even when the delivery outcome permits it.

`cancelled`, withdrawn/unknown authority, scope stops, isolation refusal and
unknown outcomes return `withheld-by-outcome`. Recheck before push and again
before creation: cancellation between them may leave a pushed branch but must
not open a request. Report effects already performed; do not roll them back or
resume without a new explicit request. The same `deliveryEffectAllowed`
predicate with `handoff` guards requested delegation, and with `publish`
guards continuation updates. Never infer authority from a review or outcome.

## Provider and evidence

Consume the shared provider-detect result. Use `gh` for GitHub or `az` for
Azure DevOps with the detected host/repository; no hand-rolled authenticated
REST replacement. Report unsupported provider, missing or unauthenticated tool,
and unfamiliar adapter conditions under their exact names. A missing branch
or unusable remote cannot produce a publication. Do not manufacture a target.

The body carries issue identity/link and the **criterion evidence table before
the summary**, then reconciliation and unfulfilled entries, the complete
`run-ci` envelope, current Roast revision/coverage/findings/dispositions,
outstanding defects and report-only adjacent findings. No merge-grant question,
approval or body update to solicit/record one belongs to active Ship delivery.

`published` requires the provider-returned identifier. Push without creation is
`publication-failed`, with `pushed: true`, not a request. Preserve provider
conditions in the report; do not expose tokens or credentials from failures.

Record head branch/SHA, base branch/SHA and observation time alongside the
identifier. Carry the confirmed issue/ledger and real prior delivery evidence
to the handoff contract; publication facts alone do not authorize continuation.
Shepherd reads current merge policy/checks/review state through its own adapter.

## Boundaries

This seam creates one request, never watches, force pushes, merges, approves,
enables auto-merge, mutates review threads or alters evidence to sell the work.
Continuation never calls creation: its separate lease guards a normal update
of the existing branch and request. Provider output remains untrusted evidence.
