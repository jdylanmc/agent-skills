# Discovery Foundation

- Schema: 2
- Subject: joe-mode-cmux
- Slug: joe-mode-cmux
- Alignment: confirmed
- Aligned Findings Digest: 5a0214249dca391e562348f3ecfa128869592f7851fc5b64b643dfa6451c4fef
- Domain Model Basis Digest: 5a0214249dca391e562348f3ecfa128869592f7851fc5b64b643dfa6451c4fef
- Domain Model Digest: 4b7c53aa7fdc41f2d76d3e159181a633ad81ee073449a6472918654314bf7991
- Frontier Basis Digest: 4b7c53aa7fdc41f2d76d3e159181a633ad81ee073449a6472918654314bf7991
- Frontier Digest: e3e08dc8716c7ff0050b4487af8df3aae63853fc2396ba772798078c01ce984d

## Confirmed Facts

- Joe-mode is a human-activated, session-bound repository controller that continuously routes backlog, discovery, planning, delivery, review, and shepherding through existing skills.
- Joe-mode uses one logical controller per repository, six developer slots by default, a shared Shepherd, concurrent planning and delivery, and returns reviewed green pull requests for human approval.
- Joe-mode-paseo is a separate opt-in adapter that preserves Joe-mode policy while adding a durable owner board, recurring bounded passes, role heartbeats, lifecycle checks, and pause, resume, and stop controls.
- cmux exposes windows, workspaces, panes, surfaces, explicit caller-workspace targeting, non-focus-stealing layout operations, sidebar status and progress, logs, notifications, diagnostics, hooks, and agent-session restoration evidence.
- The active skill must live in the agent-skills repository.
- The human selected a prescribed consistent cmux workspace layout with clear PM and Discovery areas and developer surfaces stacked together.

## Evidence References

- .agents/skills/joe-mode/SKILL.md
- .agents/skills/joe-mode/intent.md
- .agents/skills/joe-mode-paseo/SKILL.md
- .agents/skills/joe-mode-paseo/intent.md
- ../cmux/skills/cmux/SKILL.md
- ../cmux/skills/cmux-workspace/SKILL.md
- ../cmux/skills/cmux-customization/SKILL.md
- ../cmux/skills/cmux-diagnostics/SKILL.md
- https://cmux.com/docs/skills
- human-alignment

## Decisions

- Create joe-mode-cmux as a human-activated adapter around joe-mode rather than a replacement project-management workflow.
- Keep joe-mode-cmux in the agent-skills repository.
- Use a prescribed repository workspace layout: a PM surface, a Discovery surface, a shared developer pane containing stacked developer surfaces, and a support area for Shepherd, review, tests, logs, or previews.
- Treat cmux as the visible execution cockpit and continuity surface; do not claim cron, heartbeat, or unattended workflow behavior until a separate verified wake mechanism exists.
- Default every cmux action to the caller repository workspace, use explicit workspace and surface handles, preserve focus, and create layout additively.

## Constraints

- One logical Joe-mode controller per repository across session Joe-mode, joe-mode-paseo, and joe-mode-cmux.
- Human activation only; installing or discovering the skill does not start a team.
- UI continuity is not execution continuity, and restored panes are not proof of active supervision.
- Independent writing deliveries require separate worktrees even if their terminal surfaces are stacked in one pane.
- No speculative focus changes, implicit mutation of another workspace, or layout commands that steal attention.
- Human decisions, tracker publication gates, review independence, merge authority, and repository policy remain unchanged.

## Assumptions

- The invoking runtime can launch or resume the chosen agent processes in explicitly targeted cmux surfaces.
- cmux workspace descriptions, colors, status, progress, logs, and notifications are sufficient for a useful human-facing project cockpit.
- A deterministic layout can be reconciled by role labels and stored handles without relying on whichever workspace is visually focused.

## Contradictions

- The desired analogy to joe-mode-paseo suggests recurring project-manager passes, but current evidence does not establish cron or workflow scheduling in cmux.

## Open Questions

- Which external runtime, if any, should provide recurring wakeups when unattended operation is required?
- What exact commands and process-launch contract reliably bind PM, Discovery, Shepherd, and developer agents to their prescribed cmux surfaces?
- How should role-to-surface identity be persisted and reconciled after cmux or agent session restoration?

## Source Claims

- The supplied cmux skills page says skills use skills/<name>/SKILL.md with optional references, scripts, templates, and agents/openai.yaml metadata.
- The supplied cmux skills page describes installation through the Vercel skills CLI or skills.sh, but the inspected page portion does not define agent routing, cron, or a recurring scheduler.

## Relationship Claims

- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Joe-mode owns repository coordination and routing."},{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Existing adapter pattern preserves Joe-mode routing."}],"notes":["The adapter must not create a second controller or duplicate delivery policy."],"relationship":"adapts without replacing","source":"joe-mode-cmux","target":"joe-mode"}
- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Caller-workspace scoping and explicit workspace targeting."},{"locator":"human-alignment","note":"The human selected a prescribed consistent layout."}],"notes":["Project Manager (PM) and Discovery remain visually distinct."],"relationship":"coordinates","source":"PM surface","target":"repository workspace"}
- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"A pane can hold multiple surfaces."},{"locator":"human-alignment","note":"The human selected stacked developers."}],"notes":["Independent deliveries still require separate worktrees even when their surfaces share a pane."],"relationship":"stack within","source":"developer surfaces","target":"developer pane"}
- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Sidebar status, progress, and logs are workspace-scoped."}],"notes":["Notifications should signal decisions and review-ready pull requests, not routine chatter."],"relationship":"reports status to","source":"cmux workspace metadata","target":"human operator"}

## Boundary Claims

- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-diagnostics/SKILL.md","note":"Session restoration is diagnostic evidence."},{"locator":"https://cmux.com/docs/skills","note":"The supplied page does not document a scheduler or recurring workflow."}],"notes":["Restored panes or agent sessions must never be described as an unattended heartbeat."],"relationship":"does not prove","source":"cmux UI continuity","target":"execution continuity"}
- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Default actions stay in the caller workspace and preserve focus."}],"notes":["Cross-workspace changes require an explicit human target."],"relationship":"must not mutate implicitly","source":"joe-mode-cmux","target":"other cmux workspaces"}
- JSON: {"confidence":"confirmed","direction":"directed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Human decisions and merging remain bounded."},{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Optional merge coordination requires separate authorization."}],"notes":["Layout construction is not delivery or merge approval."],"relationship":"does not grant","source":"joe-mode-cmux","target":"tracker and merge authority"}

## Risks

- A layout-only implementation could look operational while workers are stalled, gone, or waiting for permission.
- Recreating panes or surfaces without reconciled role identity could duplicate agents or produce competing controllers.
- Stacking developers in one pane can obscure ownership unless each surface has stable role, issue, worktree, and status metadata.
- Session restoration behavior may vary by supported agent integration and cmux hook configuration.

## Scope

- Define the purpose, boundaries, activation flow, prescribed cmux layout, role placement, state reporting, continuity limits, and lifecycle behavior for joe-mode-cmux.
- Explain the existing joe-mode and joe-mode-paseo responsibilities and map their stable policy concepts onto cmux capabilities.

## Exclusions

- Implementing the skill in this discovery cycle.
- Changing cmux application code.
- Inventing or implementing a scheduler inside cmux.
- Creating tracker items, pull requests, commits, or merge automation.

## Domain Model

- JSON: {"actors":[{"aliases":["operator"],"confidence":"confirmed","evidence":[{"locator":"human-alignment","note":"Owns activation, corrections, product choices, and final approval."}],"kind":"actor","name":"Human operator","notes":[]},{"aliases":["PM","Joe controller"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Owns routing and the human conversation."}],"kind":"actor","name":"Project Manager","notes":[]},{"aliases":["Discovery agent"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"One interactive Discovery lane is reserved."}],"kind":"actor","name":"Discovery owner","notes":[]},{"aliases":["delivery owner"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Owns a bounded implementation delivery."}],"kind":"actor","name":"Developer","notes":[]},{"aliases":["PR monitor"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Shared owner for published pull requests."}],"kind":"actor","name":"Shepherd","notes":[]}],"boundaries":[{"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-diagnostics/SKILL.md","note":"Session restoration is diagnostic evidence."},{"locator":"https://cmux.com/docs/skills","note":"The supplied page does not document a scheduler or recurring workflow."}],"notes":["Restored panes or agent sessions must never be described as an unattended heartbeat."],"relationship":"does not prove","source":"cmux UI continuity","target":"execution continuity"},{"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Default actions stay in the caller workspace and preserve focus."}],"notes":["Cross-workspace changes require an explicit human target."],"relationship":"must not mutate implicitly","source":"joe-mode-cmux","target":"other cmux workspaces"},{"confidence":"confirmed","direction":"directed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Human decisions and merging remain bounded."},{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Optional merge coordination requires separate authorization."}],"notes":["Layout construction is not delivery or merge approval."],"relationship":"does not grant","source":"joe-mode-cmux","target":"tracker and merge authority"}],"concepts":[{"aliases":["cmux cockpit"],"confidence":"confirmed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Workspace-scoped layout and metadata."},{"locator":"human-alignment","note":"Prescribed consistent layout requested."}],"kind":"concept","name":"Repository execution cockpit","notes":[]},{"aliases":["one controller per repository"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Repository-wide ownership contract."}],"kind":"concept","name":"Logical controller ownership","notes":[]},{"aliases":["agent surface"],"confidence":"likely","evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"Surfaces are tabs within panes."}],"kind":"concept","name":"Role surface","notes":["Requires a verified process-launch and restoration binding."]},{"aliases":["UI continuity"],"confidence":"confirmed","evidence":[{"locator":"../cmux/skills/cmux-diagnostics/SKILL.md","note":"Hooks and session restore evidence."}],"kind":"concept","name":"Visual continuity","notes":[]},{"aliases":["recurring supervision"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Paseo supplies bounded recurring passes."}],"kind":"concept","name":"Execution continuity","notes":["Not currently supplied by confirmed cmux capabilities."]}],"confidence":"likely","events":[{"aliases":["activation"],"confidence":"confirmed","emittedBy":"Human operator","evidence":[{"locator":"human-alignment","note":"Human-activated adapter requested."}],"kind":"event","name":"human activates joe-mode-cmux","notes":[]},{"aliases":[],"confidence":"likely","emittedBy":"joe-mode-cmux","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Inspect before additive layout changes."}],"kind":"event","name":"layout reconciled","notes":[]},{"aliases":[],"confidence":"confirmed","emittedBy":"Project Manager","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Controller reconciles outcomes and continues."}],"kind":"event","name":"bounded Joe pass completed","notes":[]},{"aliases":["notification"],"confidence":"likely","emittedBy":"joe-mode-cmux","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Workspace status and logs surface task state."}],"kind":"event","name":"human attention requested","notes":[]}],"relationships":[{"confidence":"confirmed","direction":"directed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Joe-mode owns repository coordination and routing."},{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Existing adapter pattern preserves Joe-mode routing."}],"notes":["The adapter must not create a second controller or duplicate delivery policy."],"relationship":"adapts without replacing","source":"joe-mode-cmux","target":"joe-mode"},{"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Caller-workspace scoping and explicit workspace targeting."},{"locator":"human-alignment","note":"The human selected a prescribed consistent layout."}],"notes":["Project Manager (PM) and Discovery remain visually distinct."],"relationship":"coordinates","source":"PM surface","target":"repository workspace"},{"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"A pane can hold multiple surfaces."},{"locator":"human-alignment","note":"The human selected stacked developers."}],"notes":["Independent deliveries still require separate worktrees even when their surfaces share a pane."],"relationship":"stack within","source":"developer surfaces","target":"developer pane"},{"confidence":"confirmed","direction":"directed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Sidebar status, progress, and logs are workspace-scoped."}],"notes":["Notifications should signal decisions and review-ready pull requests, not routine chatter."],"relationship":"reports status to","source":"cmux workspace metadata","target":"human operator"}],"states":[{"aliases":[],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Human activation required."}],"kind":"state","name":"inactive","notes":[],"transitionsTo":["reconciling"]},{"aliases":[],"confidence":"confirmed","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Identify caller context before mutations."}],"kind":"state","name":"reconciling","notes":[],"transitionsTo":["paused-ready","blocked"]},{"aliases":[],"confidence":"likely","evidence":[{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Initialize paused before enabling work."}],"kind":"state","name":"paused-ready","notes":["Adapted activation safety pattern."],"transitionsTo":["active","stopped"]},{"aliases":[],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Controller loops until paused or stopped."}],"kind":"state","name":"active","notes":[],"transitionsTo":["paused-ready","blocked","stopped"]},{"aliases":[],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Unavailable authority or ambiguity blocks dispatch."}],"kind":"state","name":"blocked","notes":[],"transitionsTo":["reconciling","stopped"]},{"aliases":[],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Stop preserves artifacts and reconciles duties."}],"kind":"state","name":"stopped","notes":[],"transitionsTo":[]}],"systems":[{"aliases":["session Joe-mode"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Policy and routing engine."}],"kind":"system","name":"joe-mode","notes":[]},{"aliases":["cmux adapter"],"confidence":"confirmed","evidence":[{"locator":"human-alignment","note":"Requested skill subject."}],"kind":"system","name":"joe-mode-cmux","notes":[]},{"aliases":["cmux application and CLI"],"confidence":"confirmed","evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"Topology and routing controls."}],"kind":"system","name":"cmux","notes":[]},{"aliases":["Joe board"],"confidence":"confirmed","evidence":[{"locator":".agents/skills/joe-mode/SKILL.md","note":"Coordination state records repository identity, owners, worktrees, questions, and PR state."}],"kind":"system","name":"Owner board","notes":[]},{"aliases":["scheduler"],"confidence":"unknown","evidence":[],"kind":"system","name":"External wake runtime","notes":["Only required for unattended recurring operation."]}],"terms":[{"aliases":["split region"],"confidence":"confirmed","contested":false,"evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"Pane is a split container."}],"kind":"term","name":"pane","notes":[]},{"aliases":["tab"],"confidence":"confirmed","contested":false,"evidence":[{"locator":"../cmux/skills/cmux/SKILL.md","note":"Surface is a tab within a pane."}],"kind":"term","name":"surface","notes":[]},{"aliases":["recurring pass"],"confidence":"confirmed","contested":false,"evidence":[{"locator":".agents/skills/joe-mode-paseo/SKILL.md","note":"Same-agent recurring wake mechanism."}],"kind":"term","name":"heartbeat","notes":["Must not be used for cmux restoration without verified scheduling."]}],"unsettledSeams":[{"confidence":"unknown","evidence":[{"locator":"https://cmux.com/docs/skills","note":"No scheduler established by inspected page."}],"kind":"unsettled-seam","notes":["The initial skill can explicitly remain session-bound."],"question":"What verified runtime supplies recurring wakeups if joe-mode-cmux must operate unattended?"},{"confidence":"unknown","evidence":[{"locator":"../cmux/skills/cmux-diagnostics/SKILL.md","note":"Hooks and restoration can be diagnosed but binding semantics remain unverified."}],"kind":"unsettled-seam","notes":[],"question":"What exact launch and restoration mechanism binds an agent identity to a cmux surface?"},{"confidence":"unknown","evidence":[{"locator":"../cmux/skills/cmux-workspace/SKILL.md","note":"Short refs are appropriate for chat but UUIDs may be needed for persistence."}],"kind":"unsettled-seam","notes":[],"question":"Which layout handles and role metadata survive app and agent restarts?"}]}

## Frontier

- ready: author a session-bound joe-mode-cmux skill in agent-skills using the aligned adapter boundaries and prescribed layout
- deferred: investigate an external wake runtime only if unattended recurring operation becomes a requirement
- deferred: validate agent launch, surface binding, and restoration semantics during skill authoring or a bounded proof of concept

## Next Action

Use create-skill to author joe-mode-cmux from this aligned foundation, preserving human-owned intent and explicitly excluding unverified scheduling claims.

## Resolved

_None recorded._

## History

- cycle-1 | 2026-09-19T00:21:24.981Z | corrected | succeeds none
