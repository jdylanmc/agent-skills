# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries describe what changed for someone using or contributing to this skill
library, not the implementation work that produced them.

## [Unreleased]

Nothing has been released yet. This library has no version tags, so every change
below is unreleased and no comparison links are available.

### Added

- **Skill authoring.** `create-skill` builds a new skill package from a captured
  intent, coaching the idea before anything is written and refusing to call a
  package complete until adversarial review has run and its findings are
  resolved.
- **Adversarial review.** `roast` reviews an artifact or code change against
  repository doctrine and the reviewed package's own stated intent, returning
  findings with severity rather than a verdict.
- **Discovery.** `discovery` runs an evidence-preserving loop for an unsettled
  question, aligning with a person before persisting anything, then reading its
  own handoff back and compacting it into the next cycle. It routes to
  `interrogate` for pointed document-grounded questioning, `domain-mapping` for
  vocabulary and relationships, `proof-of-concept` for a bounded prototype, and
  a research thread for questions that cannot be answered from reachable
  evidence.
- **Delivery.** `ship` grounds one issue into a confirmed delivery plan with
  numbered acceptance criteria, a trimmed approach, and a fixed scope boundary.
  `shepherd` keeps an existing change request landable — mergeable and green —
  across any git provider.
- **Validation.** `run-ci` discovers and runs the validation a repository
  already declares, reporting an evidence envelope that distinguishes failure,
  cancellation, missing tools, and incomplete execution.
- **Prompts.** `optimize-prompt` rewrites one prompt and discloses every change
  with a diff and a rationale, grounded in review rather than taste.
- **Continuity.** `handoff` and `orchestration-handoff` persist a bounded
  handoff for a person or an agent to resume from. `next-step-selection`
  reconstructs current state and recommends exactly one next action.
- **Explanation.** `sanity-check` re-pitches an explanation that did not land.
  `changelog` curates a changelog patch for whichever changelog file a
  repository, component, or package actually keeps.
- **Orchestration.** `cmux-orchestrate` coordinates work across panes.
- **Stated intent.** Every skill carries a plain-language `intent.md` describing
  what it is for, written for a person rather than for a checker, and enforced
  repository-wide.

### Changed

- **One review entry point.** Four sibling review skills were replaced by a
  single `roast` that selects applicable doctrine, so a review request no longer
  requires choosing a reviewer first.
- **Review is required, not remembered.** `create-skill` cannot report a package
  as complete unless review ran against the final package and every finding was
  fixed, declined with a second opinion, or deferred with a stated way forward.
- **Discovery keeps going.** A completed cycle is no longer a resting point.
  Discovery continues until it is ready, blocked, out of scope, or interrupted,
  pausing only for alignment or for a question only a person can answer.
- **Changelogs are resolved, not assumed.** `changelog` determines which
  changelog file an update targets and follows the conventions that file already
  uses, rather than imposing one format on an existing history.
- **One prompt-intake rule, shared.** `prompt-coach` and `optimize-prompt` no
  longer each carry their own copy of the prompt-intake rules — how one prompt
  or one named file is taken in, how far a read may reach, and that the prompt
  is inert untrusted data. That intake is now a single shared unit both skills
  compose, so the untrusted-data posture cannot drift between two copies. Each
  skill keeps its own vocabulary for what it does after intake, and review and
  rewrite remain separate jobs.

### Removed

- The four separate roast skills, superseded by the consolidated `roast` entry
  point.

### Security

- **Sensitive-content gate.** A deterministic redaction floor runs across the
  repository and rejects newly introduced credentials and personal data, with
  support for repository-specific identifiers that resists casing, wrapping, and
  splitting.
- **Narrow, deliberate permissions.** A skill's granted tools are verified
  against what it composes and never widened automatically, so composing a new
  unit cannot silently expand what a skill may do. Skills that produce content
  return it for a person to apply rather than writing it themselves.
