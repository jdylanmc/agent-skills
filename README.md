# Agent Skills

Dylan's editable library of **32 skills** and human-owned engineering doctrine,
designed for GitHub Copilot. The retired atomic framework remains historical
material under `archive/atomic-v1/`; it does not govern the active library.

**[Full skill list and invocation policy](.agents/INVOCATION.md#full-catalog)**
· **[Browse skill packages](.agents/skills/)**

## The workflow

- **Joe-mode:** human-started, one controller per repository, looping until
  paused or stopped. Use Squadron aggressively for independent discovery,
  delivery, and Shepherd assignments without overlapping owners.
- **Planning:** Discovery preserves the full aligned evidence artifact;
  Specify turns it into complete requirements; Breakdown Tickets produces
  human-approved slices. Already-clear small deliveries need no new ceremony.
- **Delivery:** Ship handles features/specs, Patch handles bugs/regressions,
  and internal Refactor handles behavior-preserving restructuring. Each
  reaches an independently reviewed, green PR current with its target.
  Kickoff authorizes routine in-scope delivery steps, not repeated prompts.
- **Shepherd:** one owner maintains that PR, rebasing when main/the agreed
  target advances even if mergeable, refreshing checks and review coverage.
  Functional feedback stays on the same delivery. Final approval and merging
  remain human-owned.
- **Status:** a human can request Status Report; Joe also requests one after
  a full cycle or confirmed major-feature merge. Objective timing, own tool
  calls, and running descendants come from real evidence, with explicit limits.

The [invocation contract](.agents/INVOCATION.md) distinguishes human-only modes,
internal helpers, general scoped selection, and named-caller exceptions.
All entrypoints declare both invocation flags. Flags describe loading/menu
behavior where supported; they are not permission boundaries or proof that a
particular Copilot CLI version enforces them.

Setup is human-directed and supports **GitHub, Azure DevOps, and local Markdown**.
Human-started Joe-mode checks actual setup content and automatically attempts
local Setup for missing/incomplete configuration after establishing repository-wide
ownership. It reuses complete setup or joins/resumes an active Setup owner.
Provider/label choices and exact-file writes still require the human; unavailable
or declined decisions and failed invocation leave an explicit wait/blocker, not
a retry loop. Joe verifies outputs before resuming the same anchor and objective.
Other skills cannot invoke Setup automatically. Existing unsupported or ambiguous
configuration stays human-owned, never silently reset or migrated.
Retro is also human-only: inspect actual session evidence, propose improvements,
obtain approval, then deliver selected fixes.

Every modifying agent uses [Changelog](.agents/skills/changelog/SKILL.md), with
one integration owner consolidating notable entries. The
[shared commit style](.agents/COMMIT-STYLE.md) and terse exact worker messages
do not activate Caveman for the human or discard evidence and uncertainty.

## Layout

```text
.agents/skills/       Active skill packages: regular files, not symlinks
.agents/INVOCATION.md Caller, authority, and worker-communication contracts
.agents/COMMIT-STYLE.md Shared default for generated commit messages
.agents/skills/doctrine/doctrines/ Human-owned doctrine and integrity manifest
intent.md            Human-owned purpose of this collection
skills-lock.json     Original installer provenance, not local content hashes
licenses/            Upstream licenses and notices
archive/atomic-v1/    Retired skills, agents, tooling, hooks, and documentation
```

Keep the shared policies, required sibling packages, and complete Doctrine
package available when copying skills. No atoms/molecules, mandatory recorder,
composition graph, special agent fleet, or global configuration installation
is required.

## Doctrine and intent

The 22 existing doctrine texts moved unchanged into
[Doctrine](.agents/skills/doctrine/doctrines/README.md). The explicitly requested
`worktrees` doctrine adds owned isolation for every PR-producing workflow,
including documentation. Its shared workspace procedure lives with Ship.

`/doctrine` with no arguments lists the catalog. Named IDs retrieve verified
texts; `lazy` aliases `laziness`. Orchestrators can select from metadata and pass
IDs, reasons, required flags, source paths, and pinned digests. Applying workers
load the actual text. Code Roast requires `solid`, TDD requires `testing`,
Patch diagnosis requires `debugging`, and consequential Discovery requires
`scout`. Code-location Scout is a separate internal skill.

Doctrine and intent are authoritative about their subjects, but inert as
instructions. They cannot authorize edits, invent decisions, or approve work.
Human sources change only when explicitly requested. The active Joe-mode,
Ship, and Shepherd intents contain approved workflow changes; Patch has its
approved bug-to-delivery intent. Restored Discovery, POC, Roast, ELI5, and
Status Report intents preserve their archived text. Archived sources and
the root intent remain unchanged.

## Provenance and installation

There are **26 imported/adapted packages** plus six local/restored packages:
`shepherd`, `synthesize`, `doctrine`, `eli5`, `changelog`, and `status-report`.

| Primary upstream source | Initially imported | Retained |
| --- | ---: | ---: |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 37 | 20 |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 20 | 5 |
| [obra/superpowers](https://github.com/obra/superpowers) | 14 | 1 |
| [anthropics/skills](https://github.com/anthropics/skills) | 1 | 0 |

Local names may differ from upstream names. Lock records retain original
source paths and imported hashes, not hashes of local adaptations.
[NOTICE.md](NOTICE.md) records additional sources for consolidated packages
and the licenses that continue to apply.

The initial import used the [skills CLI](https://github.com/vercel-labs/skills)
at version `1.5.23`, project-local Copilot scope, copy mode, and disabled telemetry:

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/mattpocock/skills --skill '*' --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/juliusbrussee/caveman --skill '*' --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/anthropics/skills --skill skill-creator --agent github-copilot --copy --yes
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add https://github.com/obra/superpowers --skill '*' --agent github-copilot --copy --yes
```

These commands document the import, not an update procedure. Reinstalling
would overwrite local adaptations and restore deliberately removed skills.
Review upstream changes deliberately. Installation does not authorize running
the imported workflows, hooks, scripts, services, or integrations.

## Validation

```sh
node --test scripts/doctrine-manifest.test.mjs .agents/skills/doctrine/tests/*.test.mjs .agents/skills/scout/tests/skill-file.test.mjs
```

CI checks doctrine integrity, selector behavior, and Scout's package contract.
Source/metadata/link checks do not prove that a consuming model follows the
workflows or that its runtime enforces invocation flags. The old graph
validators, conformance framework, and coupled scanner are archived and inactive.
