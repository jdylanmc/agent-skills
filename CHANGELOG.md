# Changelog

Notable library changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This collection does not currently declare a Semantic Versioning policy or
have tagged releases. Current cleanup is tracked in
[#250](https://github.com/jdylanmc/agent-skills/pull/250).

## Unreleased

### Added

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
