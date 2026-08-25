# Intent: qa-design

Quality assurance design begins after discovery and before implementation. A
specification is not implementation-ready merely because its prose sounds
complete; it should also define how the required behavior will be proven.

This exists so that a specification designs its verification contract alongside
its behavioral requirements, rather than leaving proof to be improvised after
the code exists. It should state behavior rules and acceptance criteria in words
that outlive any test framework, work those rules into concrete examples for
success, failure, boundaries, permission, recovery, and state transitions where
each applies, express the examples as Gherkin where executable specification is
the right fit, and write system-test procedures for the behavior that can only
be proven by driving the running application the way a person would.

It should record the deterministic quality requirements that already apply -
complexity, performance, accessibility, compatibility, or whatever else the
repository has actually adopted - without inventing thresholds nobody agreed to.
It should map every requirement to what proves it, and be explicit about the
requirements nothing yet proves. A known gap stated plainly is worth more than a
map that looks complete.

Examples belong in domain language. Selectors, queries, private interfaces, and
step-definition code are not specification, and a scenario that parses is not a
scenario that runs; the difference between valid syntax and executed coverage
must never be blurred. Ambiguous, duplicated, contradictory, overly broad, and
missing examples are worth catching here, while catching them is still cheap.

Procedures are written from a human operator's perspective and made precise
enough for an agent to execute later. They name the surface, the prerequisites,
the data, the ordered actions, the checkpoints, the observable results, the
cleanup, and what makes them pass or fail. They prove behavior through the
public human interface rather than through internal shortcuts, and they mark
every destructive, externally visible, production, purchase, notification, or
account-changing action as needing authorization. Writing a procedure and
running one are separate jobs.

Because proof is later run in parallel and continuously, every planned procedure
and check should declare what it needs and what it disturbs: its environment,
accounts, data, mutable resources, isolation, expected duration, and whether it
can run beside anything else. Whatever needs exclusive access or a fixed order
must say so here, so that later orchestration never parallelizes conflicting
tests merely because the capacity existed. Every planned evidence producer
should also fix the requirement and traceability identities its eventual report
must carry.

It must not implement production code, step definitions, fixtures, or interface
automation, and it must not execute the scenarios and procedures it designs. It
must not insist that every requirement use Gherkin or a system test; the
smallest verification level that gives meaningful evidence is the right one. It
must not claim a traceability row as proof; a row is linkage, and linkage is not
evidence that the thing it points at exists or passes. Nor is it the arbiter of
whether a delivered system is good enough. That judgement belongs after the
evidence exists, to whoever weighs it.
