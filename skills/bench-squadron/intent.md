# Intent: bench-squadron

Bench-squadron lets a person explicitly run a small, bounded delivery
experiment without giving the experiment authority over its own scope, risk,
approval, merge, promotion, or retirement decisions.

It uses a separate orchestrator, a capped pool of delivery agents, and an
independent asynchronous Slop Sniper audit. Every proposal is tied to the
current fleet state and must collect a current-epoch quorum before it can
advance. A mutation makes prior signatures and downstream claims obsolete, so
review readiness always rests on evidence for the exact state being published.

The output is a review-ready publication candidate, not a merged, approved,
promoted, or retired delivery.
