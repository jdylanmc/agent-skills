---
name: ship-with-squadron
description: "Deliver one human-approved, dependency-aware issue fleet to review-ready change requests: confirm one closed manifest, schedule locally from the ready frontier, isolate fresh workers, recover through validated orchestration handoffs, require revision-bound Continuous Integration, Roast, blast-radius proof, publication, and real Shepherd ownership, and re-Shepherd stale siblings. Use when the operator explicitly asks to ship a bounded issue fleet or squadron. Do not use for one issue, backlog planning, a daemon, merge, approval, auto-merge, risk acceptance, tracker closure, or unconfirmed adjacent work."
allowed-tools: ["execute","read","search","task"]
includes: ["_base/_molecules/chronicler/chronicler.md","ship-with-squadron/_molecules/fleet-control/fleet-control.md","ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","ship-with-squadron/_molecules/fleet-control/fleet-control.md","ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
disable-model-invocation: true
user-invocable: true
requires-skills: [{"id":"run-ci","source":"local","required":true},{"id":"roast","source":"local","required":true},{"id":"blast-radius","source":"external","required":true},{"id":"orchestration-handoff","source":"local","required":true},{"id":"shepherd","source":"local","required":false}]
---

# Ship With Squadron

Own delivery of one explicitly approved issue set through review readiness.

```text
record -> confirm one closed fleet manifest -> persist state
  -> schedule ready frontier -> isolate and dispatch fresh workers
  -> implementation -> diff reconciliation -> run-ci -> Roast
  -> blast-radius proof -> bounded remediation -> criterion verdict
  -> publication -> real nested Shepherd
  -> observe human merges -> expire sibling readiness -> re-Shepherd
  -> complete dispositions
```

## Required References

1. [Chronicler](../_base/_molecules/chronicler/chronicler.md)
2. [Fleet control](./_molecules/fleet-control/fleet-control.md)
3. [Candidate delivery](./_molecules/candidate-delivery/candidate-delivery.md)

## Workflow

1. Reuse the caller's Chronicler context or create one root context. Recording
   is best effort. Fleet control state is authoritative and separately
   persisted.
2. Present one numbered manifest with the goal, explicit accepted scope,
   complete issue set and provider-observed source-revision receipts,
   dependencies, criteria, current states, ordering, explicit exclusions and
   human decisions (including explicit empty declarations), concurrency,
   cost/time/retry budgets, stop conditions, Shepherd intent, and human
   boundaries. Require one explicit confirmation of the whole manifest.
3. Normalize the manifest and reject malformed graphs. Create the versioned
   run-specific fleet record. Reread after every write.
4. Reobserve every provider-bound source revision and, for query-backed sets,
   exact query identity/revision/membership against the confirmed issue set,
   then compute the local ready frontier. Drift or an extra issue
   requires renewed human confirmation. Dispatch only enough pending, unowned
   issues to fill the top-level concurrency ceiling. Every assignment consumes
   a serialized state-revision/frontier lease for current `capacity.dispatch`.
   Each issue receives a
   unique branch, worktree, fresh worker context, manifest-bound bounded packet,
   and assignment generation.
5. Replace stalled or exhausted workers only after invoking
   `orchestration-handoff`, consuming its actual returned persistence shape and
   submitted payload, then reading and hashing bytes through one verified
   descriptor beneath the runtime-trusted handoff directory. Use
   `O_NOFOLLOW` where available and the same pre-open/path/descriptor identity
   plus real-path containment checks where it is not. Reject symlinks, reparse
   escapes, component escapes, swaps, and metadata changes; validate every
   run/issue/worker/generation/branch/worktree/revision binding, and producing a
   fresh consolidated brief. Never revive hidden context.
6. Drive every candidate through the quality sequence exactly as shown above.
   Accept only complete terminal invocation receipts from `run-ci`, Roast, and
   blast-radius, bound to the current run, issue, base, and head. Roast blockers
   are exactly unresolved `Priority: Must fix` findings. Any head mutation
   invalidates downstream evidence and restarts at reconciliation.
7. Invoke the external `blast-radius` seam and adapt its Pull Request 157
   contract without copying or composing its local units. Require the exact
   review-stable head `4a946e4500479e028112b77bdf268c5b7a8aae1f` and fail
   closed when its sequential ladder evidence cannot semantically support the
   reported classification.
8. Persist one stable logical publication identity and a revision-specific
   base/head observation before calling the allow-listed provider adapter.
   Reconcile by its stable provider key after degraded responses, revision
   mutation, or crashes; never create a second change request. A provider-returned
   identifier is required. Never infer publication or merge from a branch,
   worker report, merge grant, or degraded provider response.
9. When manifest Shepherd intent is `yes`, invoke `shepherd` in a real fresh
   nested worker for every published change request and wait for a terminal
   disposition. Record the exact receipt and set obligation. When intent is
   `no`, persist an explicit `not-required` decision and revision-bound set
   obligation; do not fabricate or dispatch Shepherd.
10. Observe human merges through the provider seam only when provider,
    repository, issue, change request, base/head, merge commit, observation
    time, and stable publication key reconcile exactly. Recompute dependencies.
    Expire affected still-open sibling readiness claims and fleet disposition
    immediately. Require provider-bound
    Record the merge and invalidate all open siblings, including in-flight
    first Shepherd work, before processing per-sibling revision evidence.
    Missing or malformed evidence remains a durable blocker without rolling
    back other invalidations. Require provider-bound revision observations
    after the triggering merge, clear stale quality and
    publication evidence, and queue merge/revision-generation-specific
    revalidation plus re-Shepherd work when Shepherd is required or fresh
    quality/provider revalidation when it is not,
    and never present it as ready until the exact fresh evidence is consumed.
11. Replenish capacity after every worker terminal transition. Stop all new
    assignment and continuation dispatch on cancellation or exhausted cost,
    time, or retry budget; reaching a ceiling is exhaustion. Preserve active
    handoff obligations, validated handoffs, and explicit `not-reached` records.
12. Return concise current status and one terminal disposition for every issue,
    plus the fleet disposition and next human actions.

## Authority Boundaries

- Fleet owner has no `edit` grant. Workers author inside their owned isolation;
  reconciliation, not the missing grant, bounds those writes.
- No worker or fleet owner may merge, approve, enable auto-merge, accept risk,
  force-push, close tracker work, expand the set, or mutate another assignment.
- Provider adapters may read issues, publish change requests, observe merges,
  and read one recorded change request's exact revision only when allow-listed.
- Local scheduling never depends on issue 25 and never composes
  `chart-a-course`.
- This package never composes blast-radius skill-local units from Pull Request
  157. The required external seam is pinned to its human-provided review-stable
  public contract.
- No wildcard permissions. No sticky mode, watcher, daemon, or background
  authority.

## Permissions

- `read` and `search`: repository, issue, provider, diff, and evidence
  inspection.
- `execute`: deterministic helpers, git isolation, state persistence,
  Chronicler, provider adapters, and required validation invocations.
- `task`: fresh implementation, remediation, continuation, review, and
  Shepherd workers.

There is no `edit` grant and no merge authority.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
