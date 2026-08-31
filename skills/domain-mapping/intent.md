# Intent: domain-mapping

Domain mapping exists as an explicit human action to turn evidence about a problem space into a shared map
of the nouns and relationships people keep relying on: concepts, actors,
systems, boundaries, states, events, terminology, and open seams.

Automatic agent-owned domain modeling happens only inside Discovery, after the
human aligns the documented findings. The standalone action remains available
only when a human explicitly invokes `/domain-mapping`; ordinary prompts must
not select it.

It is useful when the team does not yet agree on what the domain
contains or how its parts relate. It should gather evidence, separate confirmed
terms from guesses, expose competing names and boundaries, and produce a map
that discovery, specification, and ticket breakdown can reuse.

It must not become discovery, interrogation, specification, ticketing, or
implementation. It asks only the questions needed to keep the map honest, and
it leaves unsettled relationships visibly unsettled.

Mapping GitHub issues, tickets, work items, backlog dependencies, critical
paths, delivery sequences, roadmaps, or ready work is not domain modeling.
