# Agent Skills

Dylan's editable collection of agent skills and engineering doctrine.

The previous atomic framework is preserved in `archive/atomic-v1/`. Active
skills now start from upstream collections installed with the
[skills CLI](https://github.com/vercel-labs/skills), ready for human selection,
renaming, and adaptation. Installation does not run the imported workflows.

## Layout

```text
.agents/skills/       Imported and locally rebuilt skills: real files, not symlinks
doctrine/            Human-owned engineering philosophy and integrity manifest
intent.md            Human-owned purpose of this repository
skills-lock.json     Installer source and content records
licenses/            Upstream license notices for imported collections
archive/atomic-v1/   Previous skills, agents, tooling, hooks, and documentation
```

## Starting collections

| Source | Initial count | Remaining | Initial selection |
| --- | --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 37 | 20 | Complete collection |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 20 | 9 | Complete skill collection; not its engine or gateway |
| [anthropics/skills](https://github.com/anthropics/skills) | 1 | 0 | `skill-creator` only; now removed |
| [obra/superpowers](https://github.com/obra/superpowers) | 14 | 6 | Complete skill collection |

Human keep/drop passes have removed 29 skills outright; three three-to-one and
two two-to-one consolidations leave **35 imported/adapted skills**.
The locally built `shepherd` and `synthesize` bring the active total to **37**. All
`openai.yaml` agent metadata files have also been removed. `wayfinder` is now
[`discovery`](./.agents/skills/discovery/SKILL.md), with updated invocation names,
tracker labels, and cross-skill references.

- Restore the original [`discovery` intent](./.agents/skills/discovery/intent.md)
  unchanged. Discovery now gathers evidence through
  [`research`](./.agents/skills/research/SKILL.md) and bounded experiments,
  aligns with the human, models the domain, and preserves the full foundation
  plus compact handoff. Tracker maintenance is optional and approval-gated.
- Rename `prototype` to [`poc`](./.agents/skills/poc/SKILL.md) and retain the
  original [proof-of-concept intent](./.agents/skills/poc/intent.md) unchanged.
  Broaden UI/logic demos to runnable technology-feasibility experiments:
  isolated code, observed results, edge cases, and findings returned to discovery,
  not automatic product changes or publication. Research also returns findings
  without automatic repository writes.
- Keep `ask-matt` and `using-superpowers` separate; their proposed `joe-mode`
  merger is deferred.
- [`interrogate`](./.agents/skills/interrogate/SKILL.md) combines `grilling`,
  `grill-me`, and `grill-with-docs`: one interview, with optional domain-model
  recording.
- [`debug`](./.agents/skills/debug/SKILL.md) combines `diagnosing-bugs`,
  `systematic-debugging`, and `investigate-first`: evidence-led diagnosis,
  followed by a bounded repair only when authorized.
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
- `skill-creator` is removed; its original license is retained in `licenses/`.
- `safe-refactor` is now [`refactor`](./.agents/skills/refactor/SKILL.md);
  behavior-preservation guidance is unchanged.
- `caveman-compress` and `executing-plans` are removed, including their active
  references.
- [`synthesize`](./.agents/skills/synthesize/SKILL.md) implements its retained
  intent: leave sources untouched, ask for altitude when unspecified, and
  produce a separate candidate. Caveman, full, micro, and nano are flexible
  presets; custom sources, formats, detail levels, and styles remain supported.
  Token savings are claimed only when measured.

Further reworking and integration of doctrine are subsequent work.

Lockfile keys follow local names for imported skills; source paths and hashes
retain upstream provenance, not hashes of locally adapted content. Its 35
records exclude locally authored `shepherd` and `synthesize`, which have no
upstream imports to record. Counts above assign imported skills to their primary source; additional
sources are recorded in [NOTICE.md](./NOTICE.md).

Overlapping concepts and provider-specific assumptions are expected. Some kept
skills still reference removed skills: `ask-matt`, `retro`, and `brainstorming`
contain routes or invocations. Resolve these during the rework pass before using
the affected flows; the selection pass does not silently redesign them.

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

The root intent and doctrine are unchanged. The archived atom/molecule rules,
mandatory Chronicler composition, derived frontmatter, and compaction hooks no
longer govern the active collection.

Active CI runs the existing standalone doctrine integrity tests:

```sh
node --test scripts/doctrine-manifest.test.mjs
```

The previous graph validators, conformance tests, and coupled sensitive-content
scanner are preserved with their old workflow in the archive, not run by active
CI. Passing the doctrine check is not a review of imported skill behavior.

Imported code and text retain their upstream licenses. See [NOTICE.md](./NOTICE.md).
