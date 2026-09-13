# Agent Skills

Dylan's editable collection of agent skills and engineering doctrine.

The previous atomic framework is preserved in `archive/atomic-v1/`. Active
skills now start from upstream collections installed with the
[skills CLI](https://github.com/vercel-labs/skills), ready for human selection,
renaming, and adaptation. Installation does not run the imported workflows.

## Layout

```text
.agents/skills/       Imported and locally rebuilt skills: real files, not symlinks
.agents/COMMIT-STYLE.md Shared default for library-generated commit messages
.agents/skills/doctrine/doctrines/ Human-owned philosophy and integrity manifest
intent.md            Human-owned purpose of this repository
skills-lock.json     Installer source and content records
licenses/            Upstream license notices for imported collections
archive/atomic-v1/   Previous skills, agents, tooling, hooks, and documentation
```

## Starting collections

| Source | Initial count | Remaining | Initial selection |
| --- | --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 37 | 20 | Complete collection |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 20 | 5 | Complete skill collection; not its engine or gateway |
| [anthropics/skills](https://github.com/anthropics/skills) | 1 | 0 | `skill-creator` only; now removed |
| [obra/superpowers](https://github.com/obra/superpowers) | 14 | 1 | Complete skill collection |

Human keep/drop passes have removed 30 skills outright; four three-to-one and
six two-to-one consolidations plus two policy demotions leave
**26 imported/adapted skills**.
The locally built `shepherd`, `synthesize`, `doctrine`, and restored `eli5` bring
the active total to **30**. All
`openai.yaml` agent metadata files have also been removed. `wayfinder` is now
[`discovery`](./.agents/skills/discovery/SKILL.md), with updated invocation names,
tracker labels, and cross-skill references.

- Restore the original [`discovery` intent](./.agents/skills/discovery/intent.md)
  unchanged. Discovery now gathers evidence through
  [`research`](./.agents/skills/research/SKILL.md) and bounded experiments,
  aligns with the human, models the domain, and preserves the full foundation
  plus compact handoff. Tracker maintenance is optional and approval-gated.
- Fold `brainstorming` into Discovery: retain scaled inquiry, meaningful
  alternatives, just-in-time visual comparisons, and artifact fidelity checks.
  Apply the verified [Scout doctrine](./.agents/skills/doctrine/doctrines/scout.doctrine.md) to
  consequential uncertainty: criteria before favorites, evidence across
  meaningful routes, and explicit stopping reasons rather than an option quota.
  Preserve the original Discovery intent and ten-stage cycle. Interactive
  visuals use POC; remove the standalone browser runtime, spec-review template,
  and obsolete planning route. Specification and delivery remain separate.
- Rename `prototype` to [`poc`](./.agents/skills/poc/SKILL.md) and retain the
  original [proof-of-concept intent](./.agents/skills/poc/intent.md) unchanged.
  Broaden UI/logic demos to runnable technology-feasibility experiments:
  isolated code, observed results, edge cases, and findings returned to discovery,
  not automatic product changes or publication. Research also returns findings
  without automatic repository writes.
- [`joe-mode`](./.agents/skills/joe-mode/SKILL.md) merges `ask-matt` and
  `using-superpowers` around the [agreed intent](./.agents/skills/joe-mode/intent.md):
  stay active for the session, anchor on an idea/repo/issue/backlog, and
  orchestrate toward pull requests for human review. Discovery and planning run
  alongside delivery, using configured readiness labels and non-overlapping
  delivery groups. GitHub and Azure DevOps setup support full selected backlogs
  or assigned-to-me scopes. Automatic transitions preserve human decisions,
  existing write gates, and Ship/Shepherd ownership. Copilot runtime guidance
  replaces the retired router's other-harness assumptions.
- [`interrogate`](./.agents/skills/interrogate/SKILL.md) combines `grilling`,
  `grill-me`, and `grill-with-docs`: one interview, with optional domain-model
  recording.
- [`patch`](./.agents/skills/patch/SKILL.md) combines `debug` and `surgical-patch`,
  retaining the earlier `diagnosing-bugs`, `systematic-debugging`, and
  `investigate-first` foundations. `/patch` authorizes bounded repair after
  diagnosis; explicit investigate/explain-only requests remain non-mutating.
  Small requested behavior changes use agreed acceptance examples rather than
  invented defects. Supporting tools and evidence discipline are preserved.
- [`roast`](./.agents/skills/roast/SKILL.md) combines `code-review`,
  `requesting-code-review`, and `caveman-review` around the
  [original intent](./.agents/skills/roast/intent.md), preserved unchanged.
  Review any supplied material against relevant requirements, intent, and
  doctrine; return one prioritized findings list with evidence, confidence,
  a fix recommendation, and verification. Preserve requirements/standards
  coverage and optional terse output without implicit repairs or approval.
  Ship and Joe-mode route PR reviews through Roast.
- [`tdd`](./.agents/skills/tdd/SKILL.md) combines both test-driven development
  skills: observed red and green, with small behavior-preserving refactoring
  allowed after green and followed by another test run.
- [`verify`](./.agents/skills/verify/SKILL.md) combines `verify-and-stop` and
  `verification-before-completion`: reuse evidence only while relevant state
  and inputs remain unchanged; otherwise rerun.
- [`ship`](./.agents/skills/ship/SKILL.md) combines `implement`, `lean-build`,
  and `implement-spec`. It coordinates one issue or a spec's ticket graph,
  integrates isolated workers into one PR, reviews and verifies the result,
  and always hands off to `shepherd`. Feedback continues on the same PR.
- Retire `subagent-driven-development`: retain its useful
  [worker/report contract](./.agents/skills/ship/WORKER.md) in Ship and
  [scoped fix-review guidance](./.agents/skills/roast/FIX-REVIEW.md) in Roast.
  No separate executor, task-approval protocol, automatic accepted-risk rulings,
  model-tier mandate, ledger scripts, or alternate finishing workflow remains.
- Retire the standalone `caveman-commit` skill. Its terse Conventional Commits
  style is now the [shared library default](./.agents/COMMIT-STYLE.md), independent
  of chat mode. Consequential changes keep explanatory bodies; repository
  conventions and required trailers take precedence. Keep the shared policy
  with copied skill packages. Setup proposes a reviewed repository-local copy;
  global Copilot configuration is not changed.
- [`shepherd`](./.agents/skills/shepherd/SKILL.md) is rebuilt locally from its
  retained intent: ongoing observation, necessary branch maintenance, and
  functional repairs routed through Ship. A green snapshot does not end
  monitoring. Neither workflow merges or approves the PR.
- The active Ship and Shepherd intents retain their archived foundations with
  explicitly approved changes: no intake readiness-label gate, no detailed
  remote-continuation restrictions, and one-PR specification delivery. The
  archived copies remain unchanged.
- `codebase-design` is removed; its callers use the project's own interfaces
  and terminology.
- Caveman's `setup`, `discover`, `evidence-review`, `manage`, `optimize`, `learn`,
  and hook-dependent `stats` skills are removed. Generic communication and
  engineering skills remain.
- `caveman-help` is removed.
- `cavecrew` is removed, including its unavailable agent-preset routing and
  Claude-specific setup guidance.
- `skill-creator` is removed; its original license is retained in `licenses/`.
- `safe-refactor` is now [`refactor`](./.agents/skills/refactor/SKILL.md);
  behavior-preservation guidance is unchanged.
- `caveman-explore` is now [`scout`](./.agents/skills/scout/SKILL.md);
  read-only repository localization and citation-only output are unchanged.
  This skill locates code; the Scout doctrine guides Discovery's design-space
  exploration and remains a separate source.
- `dispatching-parallel-agents` is now
  [`squadron`](./.agents/skills/squadron/SKILL.md), preserving bounded parallel
  assignments and doctrine packets without restoring the archived fleet runtime.
- `loop-me` is now [`automate-this`](./.agents/skills/automate-this/SKILL.md).
  It still turns recurring activities into workflow specifications; the rename
  does not authorize building or running the automation.
- Restore [`eli5`](./.agents/skills/eli5/SKILL.md) from its unchanged archived
  [intent](./.agents/skills/eli5/intent.md): read the subject's actual evidence,
  then explain it briefly for a five-year-old, a junior in its field, and an
  expert. Each level adds depth. No source edits, atomic composition, recording
  hooks, or archived checker machinery.
- [`evolve-architecture`](./.agents/skills/evolve-architecture/SKILL.md) replaces
  `improve-codebase-architecture` with an explicitly requested
  [intent](./.agents/skills/evolve-architecture/intent.md): diagnose evidenced
  friction, challenge it through Roast, explore consequential alternatives
  through Discovery, and return a bounded evolution proposal. Visuals are
  optional; Refactor and Ship retain execution and delivery ownership.
- Rename `setup-matt-pocock-skills` to [`setup`](./.agents/skills/setup/SKILL.md),
  `to-spec` to [`specify`](./.agents/skills/specify/SKILL.md), and `to-tickets`
  to [`breakdown-tickets`](./.agents/skills/breakdown-tickets/SKILL.md), preserving
  their behavior and original import records while updating active callers.
- `caveman-compress` and `executing-plans` are removed, including their active
  references.
- [`synthesize`](./.agents/skills/synthesize/SKILL.md) implements its retained
  intent: leave sources untouched, ask for altitude when unspecified, and
  produce a separate candidate. Caveman, full, micro, and nano are flexible
  presets; custom sources, formats, detail levels, and styles remain supported.
  Token savings are claimed only when measured.

Further workflow curation remains human-directed.

Lockfile keys follow local names for imported skills; source paths and hashes
retain upstream provenance, not hashes of locally adapted content. Its 26
records exclude locally authored `shepherd`, `synthesize`, `doctrine`, and `eli5`, which have no
upstream imports to record. Counts above assign imported skills to their primary source; additional
sources are recorded in [NOTICE.md](./NOTICE.md).

Overlapping concepts and provider-specific assumptions are expected. `retro`
still invokes a removed writing skill. Resolve that dependency during the
rework pass before using the affected flow; the selection pass does not
silently redesign it.

The initial import uses CLI version `1.5.23`, project scope, Copilot's
`.agents/skills/` directory, copy mode, and disabled telemetry:

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/mattpocock/skills --skill '*' --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/juliusbrussee/caveman --skill '*' --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/anthropics/skills --skill skill-creator --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/obra/superpowers --skill '*' --agent github-copilot --copy --yes
```

These commands document the import, not an automatic update procedure. Upstream
contents can change; reinstalling or updating may overwrite local adaptations.
Reinstalling complete collections also restores deliberately removed skills.
Review upstream changes deliberately after customization begins.

## What remains authoritative

All 22 existing human-curated doctrine texts move unchanged into
[`doctrine/doctrines`](./.agents/skills/doctrine/doctrines/README.md). The new,
explicitly requested `worktrees` doctrine replaces the standalone
`using-git-worktrees` skill; its practical workspace procedure lives with Ship.
The root intent and existing skill intents remain unchanged. The archived atom/molecule rules,
mandatory Chronicler composition, derived frontmatter, and compaction hooks no
longer govern the active collection.

[`/doctrine`](./.agents/skills/doctrine/SKILL.md) is the common access point:

- No arguments: list IDs and descriptions, without doctrine bodies.
- Named selection, such as `/doctrine lazy and machine`: retrieve verified
  `laziness` and `machine` texts for the named task.
- Orchestration: choose per-worker standards from metadata and send work plus
  IDs, reasons, required flags, source paths, and digests. Applying workers load
  the full text. Operator choices survive the same delivery's handoffs.
- Required selections: code Roast loads `solid`; PR-producing workflows load
  `worktrees`, including documentation deliveries. Doctrine informs judgment
  without granting mutation or approval authority.

Keep the complete Doctrine package available when distributing the library.
Its helper is read-only and dependency-free; it lists/selects/loads, never
dispatches work or installs a global policy.

Active CI runs doctrine integrity and selector behavior tests:

```sh
node --test scripts/doctrine-manifest.test.mjs .agents/skills/doctrine/tests/*.test.mjs
```

The previous graph validators, conformance tests, and coupled sensitive-content
scanner are preserved with their old workflow in the archive, not run by active
CI. These checks do not prove a consuming model follows a skill's instructions.

Imported code and text retain their upstream licenses. See [NOTICE.md](./NOTICE.md).
