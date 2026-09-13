# Invocation and ownership

Use the entrypoint's caller contract before running its workflow. A relevant
description is not permission to start a human-only mode, widen a task, or
cross an approval gate. Read the current local skill and required references.
Keep this policy beside the skills when copying the library.

## Metadata is not authorization

Every entrypoint declares both invocation flags. Where supported,
`user-invocable: false` hides an internal helper from the slash menu;
`disable-model-invocation: true` prevents relevance-based automatic loading.
Neither is a tool-permission boundary. These meanings are documented for
[Copilot in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills#_use-skills-as-slash-commands).
[Copilot CLI documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
does not promise the same flag behavior: check the actual consumer's skill
listing/loading behavior, and enforce the caller contract even if it ignores
these fields. Do not claim untested runtime enforcement.

Skills with approved machine sub-flows remain model-loadable; their descriptions
and entry guards restrict *which* callers may proceed. Setting them manual-only
would also block legitimate sub-flows in consumers that honor that flag.
Human-only here means no autonomous workflow activation, not a claim that a
Markdown file cannot be read.

## Full catalog

**Both** means a human request or agent selection within an already authorized
task. **Internal** means a helper, not a direct human command. **Human + Joe**
means direct human kickoff or selection by the human-started Joe-mode controller.
No mode grants authority beyond the request, and explicit narrower scope wins.

| Skill | Entry contract |
| --- | --- |
| [automate-this](skills/automate-this/SKILL.md) | Human only; designs automation, does not run it. |
| [breakdown-tickets](skills/breakdown-tickets/SKILL.md) | Both; after Specify, with human approval before publishing the breakdown. |
| [caveman](skills/caveman/SKILL.md) | Human-only session mode. Shared commit and worker-message styles do not activate it. |
| [changelog](skills/changelog/SKILL.md) | Internal; every modifying agent consults the same curation helper. |
| [discovery](skills/discovery/SKILL.md) | Both; material unknowns, with alignment and experiment/write gates. |
| [doctrine](skills/doctrine/SKILL.md) | Both; catalog, selection, and verified loading, never approval. |
| [domain-modeling](skills/domain-modeling/SKILL.md) | Internal; authorized domain work and separately agreed recording. |
| [eli5](skills/eli5/SKILL.md) | Human only; read-only explanation. |
| [evolve-architecture](skills/evolve-architecture/SKILL.md) | Human + Joe; proposal first, human chooses the direction. |
| [handoff](skills/handoff/SKILL.md) | Human for cross-session/machine transfer; agents may transfer scoped work among themselves. |
| [interrogate](skills/interrogate/SKILL.md) | Internal to Discovery or Joe-mode only. |
| [joe-mode](skills/joe-mode/SKILL.md) | Human-only activation; one controller per repository, never nested. |
| [migration](skills/migration/SKILL.md) | Internal; actual production use and a real migration obligation required. |
| [patch](skills/patch/SKILL.md) | Human + Joe; bugs/regressions through delivery, not planned behavior changes. |
| [poc](skills/poc/SKILL.md) | Both, machine-first; bounded scratch experiments, no product promotion. |
| [refactor](skills/refactor/SKILL.md) | Internal delivery route selected by Joe; scoped structural work may stay under an existing delivery owner. |
| [research](skills/research/SKILL.md) | Both; questions or link batches, evidence-grounded and read-only by default. |
| [resolving-merge-conflicts](skills/resolving-merge-conflicts/SKILL.md) | Internal to Shepherd or an authorized delivery owner; human decisions stay human. |
| [retro](skills/retro/SKILL.md) | Human only; inspect actual session evidence, propose, obtain approval, then deliver selected fixes. |
| [roast](skills/roast/SKILL.md) | Both; independent review, no implicit repair or approval. |
| [scout](skills/scout/SKILL.md) | Internal; read-only code localization, distinct from Scout doctrine. |
| [setup](skills/setup/SKILL.md) | Human only; GitHub, Azure DevOps, or local Markdown. |
| [shepherd](skills/shepherd/SKILL.md) | Both; one owner maintains the existing PR, reviewed, green, and rebased/current. |
| [ship](skills/ship/SKILL.md) | Human + Joe; an issue or scoped graph through delivery. |
| [specify](skills/specify/SKILL.md) | Both; aligned Discovery artifact to full requirements specification. |
| [squadron](skills/squadron/SKILL.md) | Both; parallel independent assignments, aggressively used by Joe-mode. |
| [status-report](skills/status-report/SKILL.md) | Human; Joe may request a snapshot at full-cycle completion or confirmed major-feature merge. |
| [synthesize](skills/synthesize/SKILL.md) | Human; agent sub-flow only with supplied sources, output purpose, and altitude. |
| [tdd](skills/tdd/SKILL.md) | Internal; any authorized task may select test-first work. |
| [triage](skills/triage/SKILL.md) | Human + Joe; selected backlog scope, preserving tracker-change gates. |
| [verify](skills/verify/SKILL.md) | Internal; evidence before completion claims. |
| [wait-what](skills/wait-what/SKILL.md) | Human only; re-explain, no automatic invocation. |

## Carry authority, not another controller

The human's Ship/Patch kickoff, or Joe-mode's selected delivery, authorizes the
ordinary in-scope implementation, review, commit, PR, and Shepherd sequence.
Do not repeatedly ask permission for those transitions. It does not authorize
unresolved product decisions, scope expansion, destructive operations, production
access, human approval, or merging. A read-only or diagnosis-only request stays
that narrow.

Nested work carries its actual human/parent authority, route owner, issue/PR
coverage, workspace, dependencies, stop conditions, evidence, and doctrine
packet. Calling another skill does not launder missing authority. Patch or
Refactor work inside an existing delivery returns to that owner on the same PR;
it does not start a competing publication or monitoring loop. Human-approved
Retro recommendations can initiate a bounded delivery without activating Joe.

Every modifying agent consults [Changelog](skills/changelog/SKILL.md). An isolated
worker can return entry proposals for the integration owner to consolidate;
never race on a shared changelog or manufacture an entry for incidental scratch
files. Read-only skills remain read-only.

Prefer terse agent-to-agent prose without activating Caveman for the human.
Preserve evidence, uncertainty, negation, constraints, identifiers, paths,
commands, doctrine digests, and required structured fields. Compression does
not establish truth. [Commit style](COMMIT-STYLE.md) remains the shared default
independently of either conversation's voice.
