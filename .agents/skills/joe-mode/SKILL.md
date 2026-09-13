---
name: joe-mode
description: Keep an anchored idea-to-PR workflow running for the session. Orchestrate concurrent discovery, research, proof-of-concept experiments, domain decisions, specs, backlog shaping, and delivery using the configured GitHub or Azure DevOps backlog and agent-ready labels. Use when the user asks for Joe-mode or ongoing coordinated delivery of an anchored scope.
disable-model-invocation: true
user-invocable: true
---

# Joe-mode

Hand the human pull requests to review. Loop the existing skills; do not replace their workflows with a second implementation process. The human-authored [intent](intent.md) defines the purpose.

Joe-mode starts only when requested and stays active in this session until paused or stopped. Apply its routing to subsequent turns within the anchor. A side question does not silently stop the work; an explicit redirection does. A worker dispatched for a bounded task must not activate another Joe-mode controller.

## 1. Resolve the anchor

Accept an idea, folder, repository, issue, specification, backlog, or another concrete reference. Identify the goal and exclusions. Resolve a containing or explicitly linked Git repository when one exists; do not require an idea to arrive as a ticket.

Read repository guidance and existing `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and domain configuration when present. Inspect Git remotes read-only. GitHub remotes normally identify an owner/repository; Azure DevOps remotes identify an organization/project/repository. Code hosting does not prove where planning lives: honor configured separate planning projects or trackers.

Establish the backlog selection from the request and configuration:

- A named issue or specification anchors that deliverable and its relevant relationships, not the whole repository backlog.
- A full-backlog request means the selected repository/project/area/query, never the entire organization by inference.
- An assigned-to-me request adds the authenticated provider user's assignee filter; Git commit identity is not proof of that identity.
- A folder or idea may need a repository and backlog scope clarified. Ask the smallest material question rather than silently choosing full backlog.

Resolve ambiguous remotes, planning scopes, and identities before dispatch. Use [setup](../setup-matt-pocock-skills/SKILL.md) when configuration is missing, preserving its confirmation gates. Its [GitHub](../setup-matt-pocock-skills/issue-tracker-github.md) and [Azure DevOps](../setup-matt-pocock-skills/issue-tracker-azure-devops.md) references describe provider operations. Existing GitLab or local configurations remain usable; do not replace them merely because GitHub and Azure DevOps are the common case.

If the anchor has no repository yet, discovery can start without one. Report backlog/provider discovery as unresolved and defer tracker publication and delivery until their destinations are agreed. An unavailable tracker is not an empty backlog.

## 2. Establish one controller and a work board

Use harness session storage or a uniquely named session/OS-temporary artifact, not a new repository planning file. Record the anchor, provider and planning scope, assignee filter, mapped readiness role, permissions, active owners, worktree/branch locations, covered item IDs, dependencies, evidence pointers, human questions, and PR status.

Reconcile any prior board with live agents and provider state before reusing it. Do not duplicate another active Joe-mode owner for this scope. If ownership is uncertain, resolve it rather than racing another session. A local board is coordination state, not a cross-session lock.

Read [runtime guidance](RUNTIME.md) before dispatch. Confirm the harness supports the requested agents and background work. Use a bounded capacity appropriate to available tools and resources; retain capacity for the human-facing discovery path and for completion/review work rather than filling every slot with new implementation.

Joe-mode owns routing and the human conversation. Delegate substantive investigations, planning, implementation, and review to bounded workers. Ship retains ownership of its implementation workers and integration; Shepherd retains ownership of its PR monitor and repairs. Do not launch competing workers underneath either coordinator.

## 3. Refresh the relevant backlog

Query only the anchored selection, with the configured `ready-for-agent` role mapping. It may be a GitHub label, an Azure DevOps tag, or a configured local equivalent. Do not invent a second readiness checklist, hardcode a replacement label, or silently mark existing issues ready.

Use narrow queries, pagination, and batch detail retrieval. Load full requirements, dependencies, existing PR associations, and ownership only for candidates or related items needed for scheduling. Distinguish a complete empty result from a failed or truncated query. A failed query cannot justify generating a replacement backlog.

Readiness is eligibility, not a bypass of dependencies or ownership. Exclude closed/completed items, work reserved by an active delivery, and items blocked by prerequisites absent from their intended base. Do not steal assignments or treat "assigned to me" as proof no other agent is working on the item.

Recheck candidates and known PRs immediately before reserving and dispatching. Use the configured shared claim mechanism if available and authorized; preserve existing ownership. If reliable exclusive ownership cannot be established, report that limit and resolve it before overlapping work. Never claim a session-only reservation protects against every external actor.

### Choose non-overlapping deliveries

Use provider-qualified item identities and record the full coverage of each delivery group, not just its parent ID.

- **One specification, one PR:** reserve the specification and its child graph for one Ship owner. Ship schedules its internal frontier; Joe-mode does not also launch child Ship jobs.
- **Intentionally separate deliveries:** reserve non-overlapping ticket groups, suppress the spec parent as an implementation candidate, and observe cross-delivery dependencies. Choose this only when the slices are intentionally separate PRs.

Reserve a spec's group before starting ticket breakdown: `to-spec` may already have applied the readiness label. Newly published children must not race a parent delivery or be dispatched before the approved graph and grouping are recorded. If grouping is materially ambiguous, ask.

A dependency across separate PRs is satisfied only when the required changes are available on the consumer's agreed base, normally after the prerequisite merges. A green but unmerged PR or a closed tracker item alone is insufficient. Inside one Ship graph, Ship's integrated-commit and validation rules govern.

## 4. Run concurrent paths through the existing flow

Fill available capacity with independent work. Do not stop all delivery while the next slice is being discovered. Do not wait for the whole backlog to be specified before dispatching known work.

| Situation | Route and return contract |
| --- | --- |
| Unsettled question; no defined backlog yet | [discovery](../discovery/SKILL.md): aligned findings, domain understanding, frontier, full foundation and compact handoff. It can request [research](../research/SKILL.md) or [poc](../poc/SKILL.md); those return evidence, not product changes. |
| A focused human question | [interrogate](../interrogate/SKILL.md): actual human answers. During discovery, use its conversation-only intake and let discovery own the alignment gate. |
| Aligned terminology or a consequential architectural choice needs a record | [domain-modeling](../domain-modeling/SKILL.md): glossary and Architecture Decision Records (ADRs) when its criteria warrant one. Distinguish proposals from human decisions; do not generate ceremonial ADRs for every ticket. |
| Enough is known to specify an outcome | [to-spec](../to-spec/SKILL.md): publish the scoped spec through its existing test-seam/human checks and configured tracker. Supply the aligned foundation and agreed decisions; do not invent missing requirements. |
| An approved spec needs actionable slices | [to-tickets](../to-tickets/SKILL.md): human-approved vertical slices, blocking edges, and configured readiness labels. Reserve the delivery group before publication and reconcile the resulting IDs afterward. |
| External requests need classification | [triage](../triage/SKILL.md): apply the configured workflow to incoming external work. Do not retriage generated, already-ready tickets. |
| Ready, unowned delivery work can run | [ship](../ship/SKILL.md): isolated implementation, [tdd](../tdd/SKILL.md), independent [roast](../roast/SKILL.md), [verify](../verify/SKILL.md), one PR, and mandatory [shepherd](../shepherd/SKILL.md). |
| A published PR needs attention | Its existing Shepherd: observe checks/reviews/policies and route functional feedback to Ship on that same PR. Join the current owner rather than starting another monitor. |
| A failure or new evidence invalidates a slice | [patch](../patch/SKILL.md) or discovery, according to whether the gap is a defect or an unsettled requirement. Pass diagnosis-only scope when no repair is authorized; a read-only investigation does not become permission to fix. Return authorized repairs to the delivery owner. |

These are paths through the decision tree, not a mandatory global sequence. A small, understood issue need not create another spec, ADR, or discovery run. Research can lead to a POC; a failed POC can return to discovery; review feedback can return to Ship. Once a route yields its required output, automatically reevaluate and dispatch the next appropriate route within existing permissions.

Keep one human-facing discovery/planning conversation moving while delivery agents work. A discovery worker returns its real questions and waits; Joe-mode presents them to the human and sends the actual answers back. Do not let an agent simulate the human's side or let several workers ask competing questions simultaneously.

ADRs and domain documents are repository changes, not incidental scratch notes. Give their worker an agreed isolated documentation/delivery workspace, serialize shared-file edits, and carry approved records into the corresponding reviewed PR or an explicitly scoped documentation PR. Do not let planning workers edit a live delivery worktree concurrently. Where a downstream skill needs repository files before publication, arrange that workspace explicitly rather than copying unapproved documents into the product checkout.

An anchor spanning ready and uncertain work should have both paths active when capacity and human availability allow. When no work is defined, discovery feeds specification and ticketing first. When the human is unavailable, pause only the paths needing their decisions; independently authorized delivery continues.

## 5. Reconcile outcomes and keep looping

Each worker receives the anchor subset, concrete inputs and evidence paths, selected skill, owner and workspace, permitted mutations, dependencies, stop conditions, and return contract. Returns must identify produced artifacts/provider IDs, observed checks, unresolved decisions, blockers, and any active child or monitor ownership.

On a completion, human answer, PR event, or meaningful backlog change:

1. Read the result and verify its decisive artifacts or provider state. A worker's "done" is not proof of a published PR, human approval, or completed prerequisite.
2. Reconcile owned item coverage, dependencies, permissions, and pending questions. Record partial writes before retrying; inspect the provider after uncertain publication to avoid duplicate specs, tickets, or PRs.
3. Route newly ready work and release capacity only when ownership is actually transferred or the work ends. Reuse existing workers for follow-up where the harness supports it.
4. Surface review-ready PRs and material human questions; keep unrelated work moving.

If new findings contradict an active delivery, notify its owner and pause affected work at a safe boundary. Reconcile scope with the human; do not mutate the worker's requirements under it or restart the entire backlog. Preserve unrelated progress.

Auto-transition is not blanket approval. Preserve each skill's alignment, ticket-breakdown, publication, and repository-write gates. Coordinate the approval request with its proposed change; do not ask the human to choose a skill at every routine step. Never accept product risk, supply a human decision, merge, approve, or enable auto-merge on their behalf.

Use completion notifications or the runtime's documented wait mechanism. Refresh the scoped backlog after relevant events and at an appropriate bounded interval only while a real observer is running. Do not busy-poll, spawn idle agents, or imply a final response leaves an unscheduled loop executing.

## 6. Hand over PRs, not just progress

For each delivery, surface the actual PR URL, covered issue/spec references, concise change summary, acceptance/check evidence, outstanding decisions, and confirmed Shepherd owner/status. Distinguish **draft/in progress**, **blocked**, and **ready for human review** using Ship's evidence and current provider state. "PR created" does not by itself mean review-ready.

Every PR handed to the human must have a Roast covering its current candidate, whether produced by this run or supplied by a coworker. Reuse a still-applicable review; otherwise route to Roast without taking over the PR's delivery owner or silently authorizing edits. Review a draft's available candidate with its incomplete scope explicit. Missing review capability requires reporting the gap and seeking direction, not a clean-review or review-ready claim.

Bring human feedback to the same owner and PR. A review-ready PR does not end Joe-mode or stop discovery. After merging/closure, reconcile the backlog and dependencies before dispatching more work; do not manufacture follow-up work or close unrelated tracker items.

When no path can progress, explain what is awaited and remain active for the next event or user turn. Do not invent tickets to keep agents busy. When paused or stopped, stop new dispatch, coordinate an explicit pause/transfer for active owners, preserve their work and monitoring state, and report any owner still running. Never silently abandon a Shepherd or pretend it persists after runtime shutdown.

On re-anchoring, settle active ownership first. Do not silently expand the old scope or cancel its workers. On context pressure, use [phase-boundary guidance](PHASE-BOUNDARIES.md) and preserve the board, decisions, evidence pointers, pending questions, and monitor ownership. Resume by reconciling real state, not replaying stale instructions.

## Other requests inside Joe-mode

For commit-message drafting, apply the [shared commit-message policy](../../COMMIT-STYLE.md) directly. No separate formatter skill or Caveman chat mode is needed. Drafting grants no Git mutation authority; if the human separately requests synthesis, preserve that workflow's own input/altitude rules.

Select an existing relevant skill rather than forcing every turn through delivery: for example [roast](../roast/SKILL.md) for any supplied material, [patch](../patch/SKILL.md) for bounded repair or explicitly scoped diagnosis, [refactor](../refactor/SKILL.md), [migration](../migration/SKILL.md), [synthesize](../synthesize/SKILL.md), [wait-what](../wait-what/SKILL.md), or [handoff](../handoff/SKILL.md). Codebase-health findings can feed discovery only when within the anchor; ask before expanding scope. Communication preferences do not grant additional work authority.

Read and use the current local skill for the route, not a remembered or upstream workflow. Prefer process guidance appropriate to the actual problem, but do not force Discovery for already-ready work or call every loosely related skill. Missing skills or capabilities are explicit blockers for their route, not permission to invent tools or silently remove required review.
