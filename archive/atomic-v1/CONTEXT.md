# Engineering Skills

This context defines shared language for the reusable engineering skills in this repository.

## Language

### Skill orchestration

**Skill extraction**

The bounded, interactive process that turns one user-approved
conversation-derived capability into a repository-conforming skill package and
a validated merge-ready pull request. It composes reusable definition,
optional Discovery, linting, coaching, and adversarial-review units; merge
requires separate guarded authorization.

Discouraged alias: `conversation-to-skill`

**Chronicler**

The reusable deterministic recorder used by Chronicle-consuming skills. It
appends bounded operational events to the Skill Run Log but owns no scheduling,
implementation, review judgment, or merge authority.

Discouraged alias: `Journal Keeper`

**Skill Run Log**

The append-only, bounded operational event history for one root skill
invocation, including events attributed to nested skills. It records intended
operations, observed outcomes, continuity gaps, and evidence references without
storing raw reasoning or unbounded logs.

Discouraged aliases: `Squadron Run Journal`, `Skill Run Package`, `run ledger`

**Skill Run State**

The current state reconstructed on demand from a Skill Run Log. It is never
persisted as a separate authority, and incomplete or malformed evidence remains
visible rather than being inferred away.

**Operational Observation**

A structured fact established by an actor or external system with authority to
observe the event. An actor cannot authoritatively observe its own
disappearance.

**Reinforcement Evidence**

Bounded Skill Run Log evidence that Post-Mortem can use to identify reusable
capability, evaluator, or workflow improvements. It excludes internal reasoning
and unbounded transcripts.

### Skill composition

**Atom**

The smallest unit of skill composition: one single operation as judged from the
caller's point of view, expressed as a single Markdown file whose frontmatter is
consistent across all atoms. An atom references no other unit of composition;
anything that references another unit is not an atom.

Discouraged aliases: `primitive`, `ingredient`

**Molecule**

A unit of skill composition that composes two or more atoms or molecules by
reference to produce one bounded outcome, expressed as a single Markdown file.
A molecule declares what it composes; what it may use and what consumes it are
derived from that declaration rather than authored.

**Skill**

The only unit of skill composition that may be invoked directly, by a router or
by a person: the contract the agent understands. A skill composes molecules and
atoms rather than restating what a shared unit already defines.

Discouraged aliases: `organism`

**Shared unit**

An atom or molecule stored under `skills/_base/` because at least two named
consumers are either current skills or explicitly approved skill designs. A
unit with fewer qualifying consumers remains a skill-local unit under its
owning skill.

Discouraged alias: `global unit`
