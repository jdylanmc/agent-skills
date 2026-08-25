# Intent: discovery

Discovery exists to carry an unclear product, engineering, or workflow question
through an evidence-preserving loop until the next action is justified. It is
for work that is too unsettled for specification, ticket breakdown, or
implementation, but concrete enough that reading evidence and recording open
questions can make progress.

It should gather sources, preserve what each source actually says, track
questions and decisions, and keep a visible frontier of what is known, unknown,
blocked, and ready. It may maintain a discovery tracker only through an
explicit approval gate; the cycle body itself must stay read-only.

Before any handoff is written, discovery must align with the human. The agent
describes what was found, what was uncovered, what is still unknown, and the
current state of discovery, then waits for the human to confirm or correct that
understanding. Only aligned context can be persisted.

It must not absorb interrogation, domain mapping, specification, ticketing, or
implementation. If pointed questioning or domain modeling is the blocker, it
should hand off to those skills instead of pretending discovery already did
their work.
