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
2. Present one numbered manifest with the goal, complete issue set and source
   revisions, dependencies, criteria, current states, ordering, exclusions,
   concurrency, cost/time/retry budgets, stop conditions, Shepherd intent, and
   human boundaries. Require one explicit confirmation of the whole manifest.
3. Normalize the manifest and reject malformed graphs. Create the versioned
   run-specific fleet record. Reread after every write.
4. Compute the local ready frontier. Dispatch only enough issues to fill the
   top-level concurrency ceiling. Each issue receives a unique branch,
   worktree, fresh worker context, bounded packet, and assignment generation.
5. Replace stalled or exhausted workers only after invoking
   `orchestration-handoff`, rereading and validating the artifact, and producing
   a fresh consolidated brief. Never revive hidden context.
6. Drive every candidate through the quality sequence exactly as shown above.
   Bind every receipt to the current base and head. Any head mutation
   invalidates downstream evidence and restarts at reconciliation.
7. Invoke the external `blast-radius` seam and adapt its Pull Request 157
   contract without copying or composing its local units. Until that pull
   request is merged and this branch is rebased, report baseline integration as
   pending and refuse review readiness when the capability or proof is
   unavailable.
8. Publish once through an allow-listed provider adapter. A provider-returned
   identifier is required. Never infer publication or merge from a branch,
   worker report, merge grant, or degraded provider response.
9. When manifest Shepherd intent is `yes`, invoke `shepherd` in a real fresh
   nested worker for every published change request and wait for a terminal
   disposition. Record the exact receipt and set obligation.
10. Observe human merges through the provider seam. Recompute dependencies.
    Expire affected still-open sibling readiness claims, queue fresh Shepherd
    invocations, and never present them as ready until new exact-revision
    receipts are complete.
11. Replenish capacity after every worker terminal transition. Stop new
    dispatch on cancellation or exhausted cost, time, or retry budget. Preserve
    validated handoffs and explicit `not-reached` records.
12. Return concise current status and one terminal disposition for every issue,
    plus the fleet disposition and next human actions.

## Authority Boundaries

- Fleet owner has no `edit` grant. Workers author inside their owned isolation;
  reconciliation, not the missing grant, bounds those writes.
- No worker or fleet owner may merge, approve, enable auto-merge, accept risk,
  force-push, close tracker work, expand the set, or mutate another assignment.
- Provider adapters may read issues, publish change requests, and observe
  merges only when allow-listed.
- Local scheduling never depends on issue 25 and never composes
  `chart-a-course`.
- This package never composes blast-radius skill-local units from Pull Request
  157. The required external seam is intentionally honest about the unmerged
  baseline.
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
