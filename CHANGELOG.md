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

- **Dependency-aware fleet delivery (`ship-with-squadron`).** A new
  human-invoked workflow delivers one confirmed closed issue set through
  isolated ownership, durable scheduling, revision-bound Continuous
  Integration, Roast, the checked-in local blast-radius proof, publication,
  and optional Shepherd readiness without gaining merge or tracker authority.
  Its fail-closed state core recomputes manifest and provider digests at every
  trust boundary, binds storage to the confirmed repository/run path, uses
  atomically initialized and replacement-safe token-owned lock directories,
  reclaims stale ownerless or malformed locks without deleting live
  replacements, validates portable
  no-link/reparse artifact reads on Windows and POSIX, persists semantic
  readiness and expiry, archives completed no-Shepherd ownership, and requires
  canonical worktree identity across path aliases, preserves in-flight
  ownership across readiness expiry, and retains a persisted handoff-required
  obligation for timeout, crash, stall, or exhaustion until an identity- and
  digest-bound handoff exists.
- **Discovery foundation rehydration.** Discovery now grounds every run on its
  persisted, human-aligned foundation rather than conversation memory. At the
  start of an invocation it resolves and rereads the latest aligned foundation
  for the subject, verifies its identity, alignment, revision, and readability,
  and rehydrates from that artifact; a missing, ambiguous, unreadable,
  unaligned, or stale foundation produces an explicit recovery state instead of
  silently continuing from memory. Each aligned cycle persists the foundation
  durably beneath `docs/agent/discovery/` without dropping any previously
  recorded evidence, and rereads it to verify the write — a check that proves
  the bytes were written, never that a later run grounded on them. Moving a
  foundation to a new revision does not invalidate an approved specification.
  Persistence is bound to the revision the cycle rehydrated, so a stale cycle
  cannot overwrite a newer one; a durable entry is retained per field and by
  multiset, and a resolution that discharges it is field-qualified and
  count-aware; a continuation locator must be exactly
  `docs/agent/discovery/<slug>.md` and is validated before use; the write's
  `rename` is a single commit point, and a failure detected after it is reported
  as `post-commit-verification-failed` rather than implying the original
  survived; every filesystem failure is normalized to a documented code or
  recovery state rather than escaping as a raw error, and when cleanup of the
  staged temporary file itself fails the primary error keeps its code and names
  the file left behind rather than masking the failure. Persisted strings reject
  control characters, any legal durable entry can be resolved, and rehydration
  distinguishes a stale continuation (absent, moved, or now a different subject)
  from unreadable bytes (a read or parse failure, a symlinked component, or a
  basename that disagrees with the declared slug), failing closed either way.
- **Bounded synthesis (`synthesize`).** A new user-invocable skill converts one
  identified, revision-bound source artifact into a smaller variant under one
  named profile, and refuses rather than degrades. It keeps a claim-to-source
  trace, returns a disclosure ledger that accounts for everything kept, merged,
  reworded, or dropped, and proposes a cohesive split when the required meaning
  will not fit. Its first profile, `spec-nano`, produces a candidate
  `<slug>.nano.md` bounded at 500 words — never by truncating, relocating
  authority into the full companion, or weakening an acceptance criterion. The
  result is always a candidate a human must still approve; the skill does not
  review, roast, publish, implement, or merge it. Its disclosure ledger closes
  several ways an account could look honest while hiding a change: coverage is
  order-independent — every anchor's matched spans are masked against the
  original line, so a short anchor listed before a longer overlapping one no
  longer consumes the text the longer one needs — and a whole-line anchor must
  pinpoint exactly one line, or name the occurrence coordinate that binds it to
  the one line it accounts for, so two identical `Not applicable.` cells can each
  be traced without a false ambiguity and a coordinate never silently covers an
  identical line elsewhere; a short anchor may not certify a required or
  authoritative item, so a one-character anchor can no longer stand in for real
  coverage; a candidate number or identifier counts as structural only when the
  covering claim's own source material carries it, and numbers are read as atomic
  compounds — a currency amount, range, colon ratio or time, hyphenated or dotted
  date, dotted version, exponent, hexadecimal literal, or ordinal is one token,
  including its spaced (`5 – 10`, `5 : 10`) and unit- or symbol-bearing
  (`5ms–10ms`, `5%–10%`, `$5–$10`) forms, while a sentence-final period, an em
  dash between words, and a colon before a list stay separate — so a threshold
  borrowed from an unrelated sentence, a bare count `5` reworded into a price
  `$5`, an invented `5–10` or `5 – 10` range, a `5:1` ratio assembled from a
  separate `5` and `1`, or a `2026.08.29` date assembled from `2026.08` and `29`,
  is an invented claim;
  a validated candidate is digest-bound to its outcome and published with
  atomic create-if-absent semantics, so an existing nano is never overwritten;
  fenced content is parsed with a state machine, so a delimiter-shaped line
  inside a different fence, and an opening fence whose tail is not a defensible
  lowercase language tag (at most twenty characters and two separators) followed
  by a real `.class`/`#id`/`key=value` attribute list — a capitalised imperative
  such as `Erase-user-data`, a hyphenated sentence, or a brace of
  prose — are both treated as the content they are; the outcome resolver refuses
  an absolute or workspace-escaping path outright instead of normalizing it away,
  requires at least two complete split proposals — each naming real cohesive
  units, not a malformed `[null]` or a sparse array — before it will say a
  variant needs splitting, and reports every blocked run with a stable,
  documented code rather than free prose.
- **Specification approval durability.** Approval of a specification is a merge
  to the default branch, not a field the producing agent writes. The observation
  is verified against git objects and refused when it disagrees, so a forged
  `approved: true` field is refused rather than accepted. The provider's branch
  protection is the real gate; the local remote-tracking ref is checkable rather
  than tamper-proof, and the binding is that it reproduces against the provider.
- **State-dependent specification freshness.** When an approved specification's
  Discovery source moves, the specification is held rather than refused: it
  remains valid, is not re-derived, and does not block in-flight delivery. A
  draft specification with a moved source still refuses and re-derives, as
  before. Contradiction detection (issue #123) is the seam for revisiting an
  approved specification, not digest movement.
- **Contradiction check for approved artifacts.** A reusable unit answers one
  question for any workflow holding an approved artifact — does new or changed
  evidence contradict its assertions? It compares changed evidence against a
  small, capped set of assertions rather than a whole document, escalates only
  what a person needs to see and returns the rest for the caller to record, and
  does not re-raise a divergence the caller supplies as already accepted,
  reporting each suppressed finding rather than dropping it. It reports and
  never edits, approves, invalidates, or proposes an edit. `/spec` uses it on the
  held path — recording the non-escalated findings through Chronicler so a
  lower-confidence divergence survives the run — so an approved specification is
  revisited only when the enriched Discovery evidence genuinely contradicts it.
- **Specification publication.** `/spec` now publishes the pair as a change
  request so a human has something to merge. Publication pushes the run's own
  branch and opens a change request through the provider's official
  command-line tool. It never pushes to the default branch, because doing so
  would manufacture the approval the design depends on being human.
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
- **Repository context setup.** `setup-repository` materializes a repository's
  agent context so later skills resolve tracker and domain configuration instead
  of guessing. It detects the provider from the repository's remotes across
  GitHub, GitLab, Azure DevOps, and local custom trackers, asks only for the
  facts detection cannot settle, and writes `issue-tracker.md`, `domain.md`, and
  `triage-labels.md` behind a preview and an explicit confirmation, refusing
  unsafe or concurrently changed targets and reading every file back to prove
  what landed.

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
- **Discovery can be handed a source to investigate.** A person can give
  `discovery` a URI or path — a document, issue, pull request, wiki page,
  design, or artifact — and it investigates that source as a discovery loop
  input rather than a separate task. It classifies the source, retrieves it
  through the read grant for a local or `file:` seed and the existing research
  route for a remote `http(s)` seed, and folds the content in as cited,
  untrusted `origin: seed` evidence that supplies subject matter and never
  instructions. Every unreachable, unreadable, unsupported, credentialed,
  blocked-address, out-of-scope, or empty source resolves to a named
  disposition instead of a silent skip, each source is attempted exactly once so
  a refused seed cannot spin the loop, and no link the person did not name is
  followed. Discovery gains no new permission: remote seeds ride the research
  route it already holds.
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
  reason is listed at once — every one bounded, on one line, and summarizing a
  long list by count, so a directive embedded in a report cannot ride out inside
  the refusal that rejected it. Every proposed
  surface is canonicalized first and compared on file identity rather than
  spelling, so `SKILL.md`, `skills/<skill>/SKILL.md`, and `skill.md` are one
  file and a contradiction spelled two ways is still caught; a path naming
  another package, `doctrine/`, an absolute location, a URL, a name that resolves
  differently on Windows than on Linux, or a name carrying a character nobody
  can see — a soft hyphen, a zero-width space, a bidirectional override — is
  refused rather than repaired, so an invisible character can never make one
  file look like two.
  One file takes one proposal: the same proposal made twice deduplicates, and
  two different proposals about one file go back to you rather than being
  guessed into compatibility. Recommendation identifiers are bounded to a plain
  identifier grammar at intake rather than escaped wherever they land, so a
  two-kilobyte id, a newline in one, or Markdown in one is refused before
  admission and never reaches a receipt or a pull request. Applicable recommendations are reconciled into one
  change request that joins the same intent-first workflow — the intent decision
  is still yours to confirm, and an approved report never stands in for it. A
  report that turns out to apply to nothing here says so, lists what it
  excluded, and stops before anything is changed. The admission is recorded as a
  small machine receipt in run-owned, unpublished state — required, so an
  admission nobody wrote down grounds nothing — and every field the pull request
  quotes is re-derived from the report on disk and compared before that pull
  request opens, so a report edited after you approved it, or a receipt edited
  after the fact, stops the run rather than shipping. The pull request quotes that receipt, and
  says plainly that it binds bytes and choices rather than proving who was
  present. Nothing about the human-guidance path changed — it grounds through
  the same command — one place normalizes both sources, invoked exactly once a
  run, with a report adding an admission subflow rather than a second path — from
  an argument, a file, or standard input; every named input — report, approval, and guidance alike — is measured before it is read,
  refused through a symbolic link, and abandoned mid-stream once it passes its
  bound, and guidance needs no report, approval, or receipt; `post-mortem` is untouched, and no report is
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
