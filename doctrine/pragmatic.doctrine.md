---
name: pragmatic
description: "Outcome-focused discipline for adaptability, ownership, feedback, and reversible decisions."
scope: shared-engineering-doctrine
---

# Pragmatic Doctrine

## When to use

Apply this as the default engineering working style whenever someone must answer for the delivered result, conditions keep shifting, signal needs to arrive early, and the code has to stay cheap to change.

## Primary bias to correct

The recurring failure is a frame that is too narrow: finishing the line in front of you, building exactly the feature as worded, or repeating a familiar procedure because it is familiar. Correct it by taking responsibility for the end result — collapse repeated knowledge into one place, keep separate things separable, test assumptions while testing them is still cheap, hand repeated work to machines, and leave intent legible.

## Decision rules

- **Calibrate instead of ritualizing.** Pick the technique, the amount of process, the quality bar, and the point at which work stops according to what genuinely improves outcomes for these users, these risks, and this codebase; no practice is obligatory everywhere.
- **Answer for the result.** Say out loud what the tradeoffs, risks, remaining unknowns, and avoidable design costs are. Tooling, framework defaults, schedule pressure, and inherited style explain a situation; none of them is the responsible party.
- **Price the future, not only the edit.** A fast patch that raises the cost of every later change is normally a losing trade, and when improving the surroundings you are already editing is cheap, improve them.
- **One home of record per fact.** Each piece of knowledge the system depends on belongs in exactly one authoritative place, with every other copy generated from it, checked against it, or traceable to it — business rules, validation, the meaning of status values, mappings, calculations, schemas, what a configuration setting means, generated output, and manual procedure steps included.
- **Keep the parts orthogonal.** Components stay independent, responsibilities do not overlap, interfaces stay narrow, collaborators know as little about each other as possible, and policy stays out of mechanism, data out of presentation, and orchestration out of computation.
- **Do not commit before the evidence does.** A vendor, a platform, a database engine, a deployment environment, a policy, or a stated requirement should not be welded into the design while it is still likely to change; keep unstable choices swappable wherever that is practical.
- **Charge shared state for the cost it imposes.** Mutable state visible to many callers, ambient context, globals, order-dependent call sequences, and asynchronous machinery each have to earn their place and be made visible rather than left implicit.
- **Prefer representations that survive inspection.** Readable text, open formats, scripts, serialization you wrote on purpose, and configuration that declares its own version are the right default when an artifact must last, be compared as a diff, be driven by automation, be migrated, or be consumed by other systems.
- **Borrow the domain's words only when they pay.** Domain vocabulary and small purpose-built notations are worth introducing when they make a rule easier to grasp for whoever must approve or change it, and not otherwise.
- **Prove the whole path before perfecting any part of it.** One narrow slice that runs from end to end is worth more than a pile of finished pieces that have never been connected; keep that first slice minimal but genuinely real, so it exercises the architecture, the integration points, and the assumptions.
- **Prototype for knowledge, not for credit.** Record what the prototype established, what it left unanswered, and which of its shortcuts must be thrown away or hardened before anything depends on them.
- **Excavate the requirement behind the request.** Separate needs and constraints that will outlast this release from today's implementation detail, from a proposed solution presented as a need, from specification prose that keeps expanding, and from disagreement the team has not yet voiced.
- **Buy signal early and cheaply.** Relevant tests, automated checks, failures that are loud rather than silent, and small early indicators all cost less than the late, expensive surprise they prevent.
- **Deliver in small increments.** State the unknowns honestly, keep the risk visible, and treat estimates as provisional numbers that incoming feedback is expected to correct.
- **Put the contract where it is enforced.** Assumptions, invariants, responsibilities, and what the caller and the callee each owe the other should be written down explicitly and kept beside the abstraction they guard.
- **Classify a failure before handling it.** Defects in the program, violated contracts, states that should be unreachable, failures the domain expects and defines, failures worth retrying, failures the system can recover from, and failures that are permanent are different things with different handling; keep the diagnostic context intact and contain each failure inside a boundary so it cannot pull down more than it must.
- **Acquisition creates an obligation to release.** Ownership of memory, handles, locks, and other resources is a contract: release everything you took on the success path and on every failure path, ideally in the reverse of the order in which you took it.
- **Give repetition to machines.** Work that recurs, invites mistakes, is simple to overlook, or is performed from memory — compiling, testing, linting, formatting, packaging, deploying, preparing environments, validating, and releasing — should run reproducibly through the shared automation rather than through a private variant.
- **Take the leverage of tools without outsourcing understanding.** Code generators, specification tooling, formal methods, and analyzer output accelerate correctness only when you can explain what they produce before you rely on it.
- **Debug from reproduction, never from suspicion.** Reproduce the failure, observe it, narrow it down, explain it, correct it, and then confirm the correction. Compilers, operating systems, libraries, and vendors are the last suspects, not the first.
- **Treat every artifact as a message.** Names, code structure, documentation, comments, commit messages, scripts, and tests all communicate. Reserve comments for reasoning, for obligations, and for behavior that is not obvious from the code itself; a comment is not a place to keep a rule that belongs in the code.
- **Hold the team to the same discipline as the code.** Shared accountability, expectations stated openly, automation, short feedback, quality that everyone can see, and work the group is willing to put its name on.
- **Stop decay while it is still small.** Repair minor erosion in quality, or contain it visibly, before weak code, unclear ownership, degraded design, or a broken process becomes the accepted normal.

## Trigger rules

- **One fact turns up in more than one artifact** — nominate the copy that owns it and make the rest generated, derived, validated against it, or at minimum traceable to it.
- **One conceptual change forces edits in places that should be unrelated** — restore the boundary that is missing, or expose the coupling that is hidden, before the pattern spreads further.
- **A detail likely to change is baked into the code** — relocate it into metadata, into configuration, or behind an abstraction that names it, and keep that home validated, controlled, and version-tracked.
- **Confidence is low or the decision is expensive to undo** — buy information first with an end-to-end slice, a prototype, a smaller step that can be reversed, or a commitment deliberately deferred.
- **Draft material starts behaving like production truth** — when generated scaffolding, prototype code, diagrams, formal models, specification documents, or tool output drift into authority, deliberately inspect and understand it, harden it, replace it, or reject it.
- **Specification prose keeps growing while the unknowns stay the same** — swap more writing for a running slice, a worked example, or a prototype that forces real feedback.
- **Assumptions survive only in a comment, in what one person remembers to mention, or in setup steps passed along by word of mouth** — promote them into contracts, tests, executable code, scripts, or configuration the build verifies.
- **A resource or an error crosses a boundary** — settle explicitly who is able to recover, what diagnostic context must survive the crossing, and who owns the cleanup.
- **Shared state, asynchronous behavior, locks, required sequencing, or order-dependent calls enter the design** — spell out who owns the state, how access is synchronized, what ordering the code depends on, and who performs cleanup.
- **Hand-run steps, manual verification passes, release procedures, or environment rituals repeat** — automate them and keep the automation under version control.
- **Checks are slow, intermittent, tied to one environment, or need large amounts of unrelated setup** — fix the feedback path instead of letting skipped verification become routine.
- **A person found the defect before the machines did** — add or strengthen an automated regression test on the contract that should have caught it.
- **The code works and nobody can explain why** — stop and establish the real behavior with evidence before anything else depends on it.
- **Decay shows up in code you are already touching** — repair it when repair is cheap, and otherwise mark it explicitly with the containment or follow-up cleanup route.

## Final checklist

- Does every fact the system relies on have exactly one place that owns it?
- Are unrelated concerns still independent, and are the choices most likely to change still reversible?
- Does each risky assumption have real, working feedback behind it?
- Was anything inherited from prototypes, generators, or tool output accepted on purpose rather than by default?
- Are contracts, failure modes, diagnostics, resource ownership, and cleanup explicit?
- Are concurrency, execution order, coupling, and shared state visible rather than left to inference?
- Is recurring work scripted, version-tracked, and consistent with the shared checks?
- Do tests run automatically, cover what matters here, and get run before the change is called done?
- Do names, comments, documentation, scripts, tests, and commit messages carry the intent?
- Is the area you touched left in better shape, or is the decay that remains explicitly contained?
