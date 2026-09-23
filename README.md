# Agent Skills

Dylan's editable library of **36 skills** and human-owned engineering doctrine,
designed for GitHub Copilot. The retired atomic framework remains historical
material under `archive/atomic-v1/`; it does not govern the active library.

**[Full skill list and invocation policy](.agents/skills/setup/INVOCATION.md#full-catalog)**
· **[Browse skill packages](.agents/skills/)**

## Install the full pack

From the repository where you want to use the skills, run:

```sh
npx skills add jdylanmc/agent-skills --skill '*' --agent github-copilot --copy -y
```

Requires Git, npm, and a Node version supported by the skills CLI. The tested
release is **skills 1.5.23**, requiring **Node 22.20.0 or newer**. To use that
release and disable install telemetry:

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add jdylanmc/agent-skills --skill '*' --agent github-copilot --copy -y
```

The environment prefix above is POSIX shell syntax; in PowerShell, set
`$env:DISABLE_TELEMETRY='1'` before running the `npx` command.

Install **all 36** together for a new consumer. Isolated installs without
prerequisites are unsupported: workflows
reference sibling skills, and Setup carries the shared policies, attribution,
licenses, and historical provenance. The quoted `'*'` selects every active
skill without shell expansion. The default route does not install the archive;
do not point the installer at `archive/` or use full-depth discovery.

This is a **project-local GitHub Copilot copy install**, not a global install
or a symlink to this checkout. Packages land in `.agents/skills/<name>/`;
the CLI manages its own consumer `skills-lock.json`. No source checkout is
needed afterward. Do not confuse that consumer lock with this library's
historical import records in `provenance/skills-lock.json`.

**Back up or commit local skill customizations before reinstalling.** The same
command refreshes matching package directories from the selected source and
can overwrite edits or remove extra files inside them. It is not a merge or
a safe unattended upstream-update procedure. Unrelated consumer files and
other skill directories are left alone. Review the resulting diff.

Installation copies files only: it does not run Setup, write `AGENTS.md` or
global configuration, configure a tracker, start services/hooks, or authorize
any workflow. Invoke `/setup` separately when you want repository configuration;
its existing human-choice and exact-file approval gates still apply, including
the named Joe-mode bootstrap.

**Optional CMUX cockpit:** invoke `/joe-mode-cmux` explicitly from a
Maestro-enabled, managed coordinator in the current CMUX workspace. It keeps
that conversation as Project Manager and launches all roles as visible native
sessions. Managed workers inherit the invoking Copilot account through
`maestro_spawn`, with explicit model selection. Missing native tools block
activation; SDK helpers and human relay are not operational fallbacks.
Maestro supplies the generic runtime; Joe policy stays independent of its
internals. CMUX supplies visible interactive sessions, not cron,
heartbeats, unattended execution, merge authority, or proof of task success.
Maestro's separately installed `/maestro` guide handles native fire-and-forget
peer messaging; registering the existing PM does not give it a messaging
address, and missing tools never permit terminal-input injection. Use Maestro's
new managed-coordinator entry rather than adopting an arbitrary conversation.
Optional
four-area placement requires a compatible lifecycle contract; the current
same-pane contract is a valid degraded layout.

Session Joe and its CMUX cockpit keep the orchestrator on `main`, refresh it
with guarded fast-forward updates when remote main advances, place Discovery
in `discovery/<feat>` worktrees, and use a separate `pr-sniper` worktree for an
explicitly authorized merge coordinator. See the
[role worktree contract](.agents/skills/joe-mode/WORKTREES.md); placement does
not grant merge authority or permit overwriting dirty work.

**Optional Orca team:** invoke `/joe-mode-orca` explicitly for the same Joe
team policy on Orca's native Runs, Tasks, supervised Dispatches and worker
messages. Use installed `orca-cli` and `orchestration` guides from the running
CLI; no Paseo runtime is required. Session coordination and explicitly enabled
recurring automations have separate gates. Recurrence uses an exact existing
workspace, never a new worktree per tick. Orca's `--reuse-session` reuses the
automation's session, not necessarily this human chat, and can fall back to a
fresh terminal: verified coordinator transfer and ownership are required before
that terminal acts. Installation never starts a team or timer. Human merging
is the default; a separately requested PR coordinator needs an explicit
repository merge gate.
The bundled owner helper serializes local passes on one control host and one
shared private board. It does not fence another clone, remote control host or
external API; those boundaries require reconciliation, not a copied token.

**Optional Paseo PM:** invoke `/joe-mode-paseo` explicitly to set up or manage
one repository's engineering team, with six developer slots by default
and human merging by default. A requested PR coordinator can merge under a human-granted
[repository merge gate](.agents/skills/joe-mode-paseo/MERGE.md): at least independent
Roast, successful CI and linting, then its own rubber-duck review and verification.
Missing policy is clarified with the human, not invented.
Each pass checks progress and direction, charts the backlog,
intakes new requirements and dispatches existing planning/delivery routes.
Setup uses the primary chat as PM, with its own and persistent-role heartbeats
**every five minutes by default**, and records the approved cadence. Legacy fresh
conversations require proven stable workspace placement/lifetime. Its
[capability gates](.agents/skills/joe-mode-paseo/RUNTIME.md) block fresh mode
on the inspected upstream scheduler because each run creates a new workspace.
Explicit fresh-only requests never silently fall back. A human may delegate
runner mechanics, but activation still requires narrow access and verified
binding. Heartbeat setup verifies the creation receipt and actual PM placement;
schedule-only inspection APIs cannot inspect heartbeats. Later wakeup receipts
prove recurring operation separately. Installation does not activate monitoring
or repair Paseo.

The adapter is separately discoverable/selectable. A consumer that already has
the prerequisite full pack can install/update only this new package:

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.5.23 add jdylanmc/agent-skills --skill joe-mode-paseo --agent github-copilot --copy -y
```

That selection copies its support files but does not fetch missing sibling
workflows. Use the full-pack command for a new consumer.

The [catalog and caller contracts](.agents/skills/setup/INVOCATION.md#full-catalog)
remain binding: internal helpers are not direct human commands; human-only
modes do not start themselves. Invocation flags, model hints, and tool metadata
are consumer-dependent descriptions, **not enforced permissions** or proof of
agent behavior. Real GitHub/Azure DevOps access, execution tools, parallel-agent
support, and long-lived Shepherd custody depend on the receiving harness.
Report missing capabilities rather than promising them through installation.

[skills.sh](https://skills.sh) discovers public GitHub source through its CLI;
its directory/leaderboard is populated by install telemetry. Source availability
does not guarantee an immediate listing. There is no separate publish command,
npm library release, custom installer, or telemetry opt-in step required here.
Validation keeps telemetry disabled and does not claim directory registration.

## The workflow

- **Joe-mode:** human-started, one controller per repository, looping until
  paused or stopped. Use Squadron aggressively for independent discovery,
  delivery, and Shepherd assignments without overlapping owners.
- **Joe-mode CMUX:** human-started session cockpit for the same controller.
  Project Manager, Discovery, stacked developer tabs, and support remain visible
  in one repository workspace. Pinned Maestro settings are mandatory; worker
  conversations stay directly interactive and no scheduler is implied.
- **Joe-mode Orca:** native supervised team adapter, sharing the same owner
  board and existing delivery routes. Preserve six developer slots, one
  Discovery lane, shared Shepherd, independent review and human waits.
  Optional automations require explicit activation, verified Run ownership and
  existing-workspace placement; session reuse is not a same-chat guarantee.
- **Joe-mode Paseo:** separately human-enabled recurring team PM, sharing the
  same repository ownership registry. Primary chat is PM; one shared Shepherd
  and optional backlog manager have their own PM-managed heartbeats.
  Six developer slots by default: feature two, bug/hardening/refactor one.
  Support roles and disposable roasters are separate. A requested PR coordinator
  may merge under the repository gate; implementers never approve themselves.
  See [TEAM](.agents/skills/joe-mode-paseo/TEAM.md) for permission inheritance,
  blocker recovery, names and safe cleanup.
- **Planning:** Discovery preserves the full aligned evidence artifact;
  Specify turns it into complete requirements; Breakdown Tickets produces
  human-approved slices. Already-clear small deliveries need no new ceremony.
- **Chart a Course:** find the critical task path to a goal, including missing
  tasks and research spikes. Recommend Discovery for a particular issue or
  epic; Joe-mode invokes it within its existing authority and feeds findings
  back into the path. Chart-a-course itself stays read-only.
- **Delivery:** Ship handles features/specs, Patch handles bugs/regressions,
  and internal Refactor handles behavior-preserving restructuring. Each
  reaches an independently reviewed, green PR current with its target.
  Kickoff authorizes routine in-scope delivery steps, not repeated prompts.
  Standalone Ship is TDD opt-in; Joe prefers it for features. Patch/Refactor do
  not force red/green. Tests and useful acceptance proof still matter.
- **Shepherd:** one owner maintains that PR, rebasing when main/the agreed
  target advances even if mergeable, refreshing checks and review coverage.
  Functional feedback stays on the same delivery. Final approval and merging
  remain human-owned.
- **Status:** a human can request Status Report; Joe also requests one after
  a full cycle or confirmed major-feature merge. Objective timing, own tool
  calls, and running descendants come from real evidence, with explicit limits.

The [invocation contract](.agents/skills/setup/INVOCATION.md) distinguishes human-only modes,
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
[shared commit style](.agents/skills/setup/COMMIT-STYLE.md) and terse exact worker messages
do not activate Caveman for the human or discard evidence and uncertainty.

## Layout

```text
.agents/skills/       Active skill packages: regular files, not symlinks
.agents/skills/setup/INVOCATION.md Caller, authority, and communication contracts
.agents/skills/setup/COMMIT-STYLE.md Shared default for generated commit messages
.agents/skills/setup/{NOTICE.md,LICENSE,licenses/,provenance/} Bundled resources
.agents/skills/doctrine/doctrines/ Human-owned doctrine and integrity manifest
intent.md            Human-owned purpose of this collection
provenance/skills-lock.json Original import provenance, not an active installer lock
licenses/            Upstream licenses and notices
archive/atomic-v1/    Retired skills, agents, tooling, hooks, and documentation
```

Keep the full pack, including Setup's shared resources and the complete Doctrine
package. No atoms/molecules, mandatory recorder,
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
Status Report intents preserve their archived text. Chart-a-course's intent
moved from the archive into its active package and includes the human-confirmed
missing-task, research-spike, and caller-owned Discovery scope. Other archived
sources and the root intent remain unchanged.

## Provenance and licenses

There are **26 imported/adapted packages**, three locally authored Joe adapters
(`joe-mode-cmux`, `joe-mode-orca`, `joe-mode-paseo`), and seven local/restored packages:
`shepherd`, `synthesize`, `doctrine`, `eli5`, `changelog`, `status-report`, and
`chart-a-course`.

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

The initial import used [skills CLI](https://github.com/vercel-labs/skills)
`1.5.23`, project-local Copilot scope, copy mode, and disabled telemetry.
Its unchanged lock is retained at
[provenance/skills-lock.json](provenance/skills-lock.json), outside active
installer state so authored/adapted packages remain discoverable. Do not
reimport the upstream collections to update this curated pack.

Setup bundles the complete notices, licenses, and an identical provenance copy
so they travel with the pack. Root `NOTICE.md`, `LICENSE`, `licenses/`, and
`provenance/` remain the canonical attribution sources; the bundled notice
adjusts only source-checkout link destinations. After authorized attribution
changes, run `node scripts/sync-pack-resources.mjs --write` and review the diff.
CI checks these copies for drift. The shared invocation and commit policies
live only in Setup; repository-specific, human-owned policy copies remain
explicit overrides, not automatically synchronized authorities.

Source-only documentation and validation tooling are not install dependencies.
Doctrine resolves its manifest and texts relative to its installed helper, not
the consumer's root. Patch's shell/template and TypeScript examples are support
material for separately authorized debugging, not install-time hooks.

## Validation

```sh
node --test scripts/doctrine-manifest.test.mjs .agents/skills/doctrine/tests/*.test.mjs .agents/skills/scout/tests/skill-file.test.mjs
node --test .agents/skills/joe-mode-cmux/tests/*.test.mjs
node --test .agents/skills/joe-mode-orca/tests/*.test.mjs
node --test .agents/skills/joe-mode-paseo/tests/*.test.mjs
npm ci --ignore-scripts
npm run test:pack
```

CI retains the 80 doctrine/selector/Scout checks and adds an actual released
CLI copy install from the local candidate into an owned `.test-sandbox/`
consumer. PM tests cover local atomic claims, persistent capacity/Discovery
reservations, control gates and accepted-result preservation; they do not prove
Paseo scheduling or agent compliance. Orca tests cover package contracts and
single-host owner-helper behavior, not live automation, permission propagation
or cross-host fencing. Pack tests check exact membership,
separate adapter selection with prerequisites, complete copied support, portable
Markdown links, bundled resources, installed Doctrine loading, protected
source bytes/metadata, repeat installation, and unrelated-file preservation.
After successful validation on a push to `main` (or a manual run on `main`),
CI repeats those checks against a remote GitHub install, comparing the installed
pack byte-for-byte with the checked-out revision. Pull requests only test the
local candidate. Both routes disable telemetry and install into disposable
consumers, never globally. This verifies GitHub distribution, not skills.sh
listing or ranking; there is no registry upload step. If `main` advances during
the remote check, a content mismatch fails rather than validating the wrong
revision; use the newer run.

To run the remote check locally against a clean checkout matching published
`main`:

```sh
SKILLS_PACK_SOURCE=https://github.com/jdylanmc/agent-skills/tree/main npm run test:pack
```

In PowerShell, set `$env:SKILLS_PACK_SOURCE` before running the npm command.
Omit that variable for local-candidate validation.
Scratch consumers are removed afterward. The dev-only CLI pin and lock are
validation tooling, not a production dependency or custom npm installer.
Source/metadata/link checks do not prove that a consuming model follows the
workflows or that its runtime enforces invocation flags. The old graph
validators, conformance framework, and coupled scanner are archived and inactive.
