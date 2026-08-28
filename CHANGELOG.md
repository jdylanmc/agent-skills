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

- **Explain like I'm five.** `/eli5 <subject>` explains one subject at three
  increasing depths — for a five-year-old, a junior in the subject's own field,
  and an expert — after grounding in the subject's own evidence when it is a
  local repository, file, or document. The three levels are concise and
  bullet-heavy, each one deeper than the last, and it never edits or implements
  the thing it explains.
- **Skill authoring.** `create-skill` builds a new skill package from a captured
  intent, coaching the idea before anything is written and refusing to call a
  package complete until adversarial review has run and its findings are
  resolved.
- **Skill reinforcement.** `reinforce-skill` is the sanctioned way an existing
  skill changes after it is created — the counterpart to `create-skill`. It
  works on one skill at a time, reads that skill's plain-language intent as the
  standard, and decides out loud whether the change alters what the skill is
  for: when it does, the revised intent is confirmed with you and stored before
  the implementation moves; when it does not, that review is recorded rather
  than skipped. It then makes the smallest complete change, re-runs the
  repository's real validation, roasts the result, records the change in the
  changelog, and opens a pull request for you to review — it never merges,
  never edits doctrine, and never widens a skill's permissions to make a change
  fit.
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
- **Delivery.** `ship` takes one issue to review-ready. It grounds the issue
  into a confirmed delivery plan with numbered acceptance criteria, a trimmed
  approach, and a fixed scope boundary, then works that plan in an isolated
  worktree: a dispatched worker writes the change, every hunk is reconciled
  against the confirmed plan before anything is validated, `run-ci` validates,
  `roast` reviews, and the run reports a verdict for each criterion rather than
  declaring success. Whether the result may merge is withheld until a person
  grants it. When the operator asked for it, the published change request is
  handed to `shepherd` as a real invocation the run waits on, naming the branch,
  the commits it was landable against, and when that was observed; a run that
  could not hand it over reports blocked with the target rather than reporting
  it as delivered. `shepherd` keeps an existing change request landable —
  mergeable and green — across any git provider, and treats a base that
  advanced as a rebase trigger when that base requires a change request to
  contain it.
- **Quality assurance design.** `qa-design` turns a specification into the
  contract that says how its behavior will be proven: behavior rules with
  acceptance criteria, the smallest verification level that gives meaningful
  evidence for each, Gherkin scenarios in domain language, system-test
  procedures written for a person and precise enough for an agent, the
  deterministic checks the repository has already adopted, the execution and
  concurrency constraints every planned proof must honor, and a reconciled
  traceability map that states its own gaps. It designs proof and never produces
  it: nothing is implemented, executed, scheduled, or judged.
- **Product specification.** `spec` turns one persisted, human-confirmed
  Discovery artifact into an authoritative nano Product Requirements Document
  and a linked full companion beneath `docs/agent/specs/`. The nano document
  carries stable acceptance-criteria identities for downstream work; the full
  document preserves supporting evidence, assumptions, decisions, and
  traceability without acquiring authority of its own.
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
- **Session retrospectives.** `post-mortem` analyzes a session and returns one
  fixed-schema record: what the session was for, whether it got there, where it
  met friction, which execution gaps explain it, and a small number of testable
  improvements worth proposing. Evidence is the session in front of it, the
  runtime's own session log when the right one can be identified, and a Skill
  Run Log you name. Identity is proved rather than guessed: a named path, a
  runtime-named transcript or session, or exactly one session the machine still
  shows running — never the newest file, and never a choice between two
  candidates. When identity is uncertain the run says so and works from what is
  visible, because a post-mortem of the wrong session is confident and
  worthless. A runtime log is read through a bounded projection that publishes
  counts, identities, and outcomes and never a prompt, a tool result, or the
  body of a skill, and a damaged or unfinished log is reported as a limit on
  what can be concluded rather than repaired. It is not tied to one agent
  harness: reading a harness is a single adapter behind a seam, everything after
  that seam speaks one neutral vocabulary, and a harness with no adapter yields
  a stated gap plus a proposal for the adapter that would close it rather than a
  parser guessed from an unfamiliar format. It diagnoses and recommends only:
  nothing is edited, remembered, promoted, or handed to another skill to apply —
  including the adapter it just proposed, which a person approves and a separate
  `reinforce-skill` run builds.
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
- **A Skill Run Log can say which session it belongs to.** Chronicle run context
  now carries two optional opaque identifiers — the harness a run executed in
  and that harness's session identifier — and records them on each event. They
  let a run log be matched to the runtime's own record of the same session
  deterministically, instead of by lining up timestamps. Both are opaque, so an
  absolute machine path is refused rather than written into a log that gets
  published. Existing logs are unaffected: correlation is optional, a run with
  nothing to correlate is still written at the previous schema version, logs
  written before it stay readable unchanged, a log without it is uncorrelated
  rather than defective, and nothing else about recording, replay, or operation
  pairing changed.
- **A post-mortem can now hand its findings to a reinforcement — with your
  approval, never on its own.** `reinforce-skill` takes the change either from
  your own words, exactly as before, or from one post-mortem recommendation
  report. The report is inert until you approve it for this run: approval is a
  receipt naming that report's SHA-256 and the one skill it authorizes, and a
  report that was proposed, observed, or confident about itself is not approved.
  Only the recommendations that explicitly name the skill being reinforced are
  applied; the rest are reported and left for their own run. A missing,
  ambiguous, malformed, unapproved, edited-since-approval, wrong-skill, or
  self-contradicting report stops the run before anything is edited, and every
  reason is listed at once, bounded and on one line so a directive embedded in a
  report cannot ride out inside the refusal that rejected it. Every proposed
  surface is canonicalized first and compared on file identity rather than
  spelling, so `SKILL.md`, `skills/<skill>/SKILL.md`, and `skill.md` are one
  file and a contradiction spelled two ways is still caught; a path naming
  another package, `doctrine/`, an absolute location, a URL, or a name that
  resolves differently on Windows than on Linux is refused rather than repaired.
  One file takes one proposal: the same proposal made twice deduplicates, and
  two different proposals about one file go back to you rather than being
  guessed into compatibility. Applicable recommendations are reconciled into one
  change request that joins the same intent-first workflow — the intent decision
  is still yours to confirm, and an approved report never stands in for it. A
  report that turns out to apply to nothing here says so, lists what it
  excluded, and stops before anything is changed. The admission is recorded as a
  small machine receipt in run-owned, unpublished state — required, so an
  admission nobody wrote down grounds nothing — and re-derived from the report
  on disk before a pull request opens, so a report edited after you approved it
  stops the run rather than shipping. The pull request quotes that receipt, and
  says plainly that it binds bytes and choices rather than proving who was
  present. Nothing about the human-guidance path changed — it grounds through
  the same command, from an argument, a file, or standard input, and needs no
  report, approval, or receipt — `post-mortem` is untouched, and no report is
  ever manufactured to satisfy a shape.

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
