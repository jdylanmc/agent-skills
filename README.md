# Agent Skills

Dylan's editable collection of agent skills and engineering doctrine.

The previous atomic framework is preserved in `archive/atomic-v1/`. Active
skills now start from upstream collections installed with the
[skills CLI](https://github.com/vercel-labs/skills), ready for human selection,
renaming, and adaptation. Installation does not run the imported workflows.

## Layout

```text
.agents/skills/       Installed skills: real files, not symlinks
doctrine/            Human-owned engineering philosophy and integrity manifest
intent.md            Human-owned purpose of this repository
skills-lock.json     Installer source and content records
licenses/            Upstream license notices for imported collections
archive/atomic-v1/   Previous skills, agents, tooling, hooks, and documentation
```

## Starting collections

| Source | Initial count | Remaining | Initial selection |
| --- | --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 37 | 21 | Complete collection |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 20 | 12 | Complete skill collection; not its engine or gateway |
| [anthropics/skills](https://github.com/anthropics/skills) | 1 | 1 | `skill-creator` only |
| [obra/superpowers](https://github.com/obra/superpowers) | 14 | 7 | Complete skill collection |

Human keep/drop passes have removed 25 skills outright; two three-to-one and
two two-to-one consolidations reduce the remaining entry points to **41**. All
`openai.yaml` agent metadata files have also been removed. `wayfinder` is now
[`discovery`](./.agents/skills/discovery/SKILL.md), with updated invocation names,
tracker labels, and cross-skill references.

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
- `codebase-design` is removed; its callers use the project's own interfaces
  and terminology.
- Caveman's `setup`, `discover`, `evidence-review`, `manage`, `optimize`, `learn`,
  and hook-dependent `stats` skills are removed. Generic communication and
  engineering skills remain.

Further reworking and integration of doctrine are subsequent work.

Lockfile keys follow local skill names; source paths and hashes retain the
original upstream provenance, not hashes of locally adapted content. Counts
above assign each skill to its primary source; additional sources used in
consolidated skills are recorded in [NOTICE.md](./NOTICE.md).

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
