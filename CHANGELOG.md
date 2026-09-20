# Changelog

Notable library changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This collection does not currently declare a Semantic Versioning policy or
have tagged releases. Current cleanup is tracked in
[#250](https://github.com/jdylanmc/agent-skills/pull/250).

## Unreleased

### Added

- `joe-mode-orca`: opt-in native Orca team coordination through the existing
  Joe workflows, with supervised workers, capacity accounting, one Discovery
  lane and shared Shepherd. Reconcile repository ownership across adapters;
  preserve independent review, human decisions and gated merge delegation.
  Optional recurring automations require verified existing-workspace and
  coordinator binding, including fresh-terminal fallback. A local atomic owner
  helper serializes passes and records pending effects on the shared private
  board without claiming cross-host fencing. Pause and stop
  preserve work and reconcile pending effects; installation activates nothing.
- `joe-mode-cmux`: human-started, session-bound CMUX cockpit for the existing
  Joe controller. Keep Project Manager, Discovery, stacked developer tabs, and
  support visible in one repository workspace; require CMUX Maestro's dedicated
  pinned Copilot account and model before spawning. Preserve direct human
  interaction, exact surface ownership, separate delivery worktrees, and honest
  continuity limits without inventing scheduling, merge authority, or success.
  Same-workspace pane placement requires the CMUX Maestro integration contract
  that permits owner-controlled post-attach moves; older integrations retain
  same-pane workers and report the degraded layout.
- `joe-mode-paseo`: opt-in engineering-team PM for one repository. Use the
  primary chat and role heartbeats, every five minutes by default;
  chart the backlog, intake requirements, assess worker progress and direction,
  and dispatch existing planning/delivery routes. Preserve durable exclusive
  ownership and human merging by default. Legacy fresh schedules keep their
  existing gates. Allow a requested PR coordinator to merge under a repository-defined gate:
  independent Roast, successful CI/lint, then final rubber-duck review and verification.
  Clarify missing policy with the human; workers gain no merge authority.
  Gate activation on verified Paseo placement/access; heartbeat pause/stop deletes
  its owned wakeup, with reconciled human-only recreation. Installation stays inert.
  Verify heartbeat configuration/deletion through their actual tool receipts,
  not schedule-only inspection; later wakeups prove recurring operation separately.
  Reserve approved ticket publication before child IDs exist, then reconcile the
  returned graph before launching delivery so parent and child ownership cannot race.
  Read a bounded current board by default and request full durable history
  explicitly, keeping settled workers in an actionable retirement queue until
  their archival and worktree removal or deliberate retention is actually
  recorded and its accepted receipt kept immutable. Bind a cross-provider permission plan to its planned worktree and to
  the child the runtime actually created, so one approval cannot authorize a
  different developer or later launch. Keep the continuation alarm on the PM
  chat itself, with no default developer timers, and select current frontier
  models by runtime discovery.
- `chart-a-course`: find a critical task path to a named goal, exposing missing
  tasks and research spikes without tracker writes. Joe-mode acts on targeted
  Discovery recommendations within its existing authority and preserves human
  gates. Move its intent into the active package with the agreed expanded scope.
- Post-merge CI verifies remote GitHub installation of the complete pack against
  the checked-out revision, with telemetry disabled and no skills.sh registry
  upload or listing claim.
- Full-pack installation through the standard skills CLI for project-local
  GitHub Copilot use. All 32 skills now carry their shared policies, complete
  Doctrine support, licenses, and import provenance without a source checkout.
  Move historical installer state out of the discovery path; preserve existing
  names, invocation contracts, and human sources. See
  [#251](https://github.com/jdylanmc/agent-skills/issues/251) and the
  [installation and overwrite guidance](README.md#install-the-full-pack).
- Repository-local workflow configuration for GitHub Issues, canonical triage
  labels, single-context domain guidance, and an attributed commit-policy copy.
  Keep Joe-mode scoped to the human's anchor and preserve tracker write gates.
- An editable, repository-local Copilot library of 32 skills, adapted from
  existing collections with preserved licenses and original import records.
- `doctrine`: catalog browsing, scoped worker selections, and verified full
  text loading. Move the 22 existing texts unchanged into the package; add
  the requested worktree doctrine and shared isolation procedure.
- `synthesize`: separate, grounded artifacts at full, Caveman, micro, nano,
  or custom altitude; preserve sources and measure any claimed token savings.
- `eli5`: evidence-grounded explanation at five-year-old, junior-practitioner,
  and expert depths, using its unchanged archived intent.
- Internal `changelog`: shared curation of notable changes, with serialized
  integration and no automatic release/version decisions.
- `status-report`: read-only objective snapshots with elapsed time, the owning
  agent's tool calls, and running nested descendants. Joe-mode also requests
  snapshots at completed-cycle and confirmed major-feature-merge boundaries.

### Changed

- Compress Joe-mode Paseo guidance and supporting contracts while preserving
  activation, permissions, ownership, recovery, merge gates, technical examples
  and acceptance scenarios.
- Joe's default pool is six developers: features use two slots; bugs, hardening
  and refactors use one. One shared Shepherd and optional backlog manager stay
  outside the pool. PM owns all role heartbeats, delegates blocker investigation,
  retries a confirmed work blocker once with context and worktrees that are fresh
  for every prior participant, including retired developers, then sends
  repeated blockers to Discovery. Preserve remote work before local cleanup.
  Existing boards need paused, settled reconciliation before changing capacity units.
- Propagate current human-authorized parent permission mode and features to
  children, then verify readback. Do not undo human-selected Allow All/Auto Accept
  using stale defaults. A cross-provider launch first records a verified
  target-policy mapping and is refused when the observed settings later drift;
  ambiguous or escalating mappings wait for the human. Provider limitations and
  denied grants remain explicit.
- Standalone Ship uses TDD only when selected; Joe prefers it for features.
  Patch and Refactor do not force red/green. Refactor applies laziness/KISS/YAGNI
  and SOLID, with useful behavior proof and independent review from distinct angles.

- Compress lifecycle instructions and acceptance traces; preserve ownership,
  cadence, recovery, retirement, and human approval gates.
- Unify agent lifecycle across Squadron, Ship, Joe-mode, Shepherd, and related
  routes: verify Paseo repository/worktree placement, require observed custody
  acceptance and provider-confirmed non-draft readiness, and retire accepted
  terminal owned agents without deleting workspaces or losing active duties.
  Shepherd uses authorized scheduling with adaptive 1/5/15-minute observation,
  preserving explicit overrides, and routes evidenced recovery through one
  linked issue to the existing Joe controller on the same PR, with acknowledged
  ownership and human decision gates intact.
- Rename internal `resolving-merge-conflicts` to `conflicts`; preserve its
  caller restrictions and original upstream provenance.
- Make invocation explicit across every skill: human-only modes, internal
  helpers, scoped automatic selection, and named-caller exceptions. Treat
  loading metadata as consumer-dependent, not as a permission boundary.
- Make Joe-mode a human-started, one-per-repository controller that continuously
  coordinates backlog management, discovery, planning, and delivery. Use
  Squadron aggressively for independent assignments without duplicate owners.
- Make Ship, bug/regression-only Patch, and behavior-preserving Refactor peer
  delivery routes. Kickoff authorizes routine in-scope repair, review, commits,
  publication, and shepherding; explicit diagnosis-only requests stay read-only.
- Require a reviewed, green PR current with main or its explicit target for
  final delivery handoff. Shepherd rebases on base advancement even without
  conflicts, refreshes evidence, and keeps feedback on the same PR. Human
  final sign-off and merging remain separate.
- Route aligned Discovery artifacts into full Specify requirements, then
  human-approved Breakdown Tickets. Preserve material unknowns rather than
  inventing product decisions or requiring ceremony for already-clear work.
- Apply Scout doctrine to meaningful Discovery alternatives, evidence,
  criteria, human alignment, and explicit stopping reasons. Preserve the
  ten-stage discovery cycle and its full foundation plus compact handoff.
- Broaden `poc` from demos to bounded, runnable feasibility experiments;
  Research returns cited findings and supports link batches without automatic
  repository or tracker publication.
- Make Retro human-directed: inspect actual complained-about session evidence,
  recommend improvements, wait for approval, then deliver selected fixes.
- Limit Setup to GitHub, Azure DevOps, and local Markdown. Restrict Migration
  to actual production migration obligations, not speculative compatibility
  work based only on version numbers.
- Use shared terse Conventional Commit formatting independently of Caveman
  chat mode. Prefer exact concise worker messages without dropping uncertainty,
  constraints, technical identifiers, or required packet fields.
- Consolidate code/general reviews into Roast, diagnostics and regression
  repair into Patch, test-first work into TDD, and completion evidence into
  Verify. Retain independent review, real red/green proof, and relevant-state
  validation instead of self-approval.
- Replace `improve-codebase-architecture` with proposal-first
  `evolve-architecture`. Rename `wayfinder` to `discovery`, `prototype` to
  `poc`, `safe-refactor` to `refactor`, `caveman-explore` to `scout`,
  `dispatching-parallel-agents` to `squadron`, `loop-me` to `automate-this`,
  `setup-matt-pocock-skills` to `setup`, `to-spec` to `specify`, and
  `to-tickets` to `breakdown-tickets`. Original upstream records remain intact.

### Removed

- Retire the atomic framework, agents, coupled tooling, runtime hooks, and
  documentation from active use; preserve them under `archive/atomic-v1/`.
- Retire competing executors and redundant skill packages, including
  `subagent-driven-development`, `brainstorming`, `using-git-worktrees`,
  and standalone `caveman-commit`; retain useful behavior in the shared flows.
- Remove Caveman product/runtime integrations, `cavecrew`, `caveman-help`,
  `caveman-compress`, `executing-plans`, and the imported `skill-creator`.
  Preserve applicable licenses and attribution.
- Remove active `openai.yaml` metadata and unsupported GitLab setup.

### Fixed

- Joe-mode Paseo can reconcile paused legacy returns before team conversion
  without temporarily resuming dispatch to obtain a cleanup lease. Human
  heartbeat startup/resume now includes a bounded first work pass and explicit
  assignment or blocker evidence, rather than stopping at timer creation.
  Give Discovery a reusable named worktree/workspace for inquiry and authorized
  domain-document PRs. On every PM pass, surface each agent's outstanding human
  request in the primary chat with a verified link or exact locator; distinguish
  prepared questions from actual presentation and monitoring from delivery.
- Have human-started Joe-mode attempt local Setup for missing/incomplete
  repository configuration under one controller/Setup owner, instead of only
  asking the human to run it. Reuse complete setup, join active runs, and preserve
  human choices and exact-file approval; blocked setup waits without retry loops.
- Correct stale Patch history references and apply provider delivery guidance
  consistently to Ship, Patch, and Refactor.
- Remove Retro's dependency on the retired writing skill and reconcile
  Interrogate callers with its Discovery/Joe-only contract.
- Keep semantic merge conflicts human-owned rather than forcing a guessed
  resolution, staging unrelated files, or blindly rewriting a shared branch.

Earlier released/history material remains in
[the archived changelog](archive/atomic-v1/CHANGELOG.md).
Intermediate unreleased curation steps remain in Git history.
