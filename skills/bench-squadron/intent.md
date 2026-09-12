# Intent: bench-squadron

## Delivery

Bench Squadron turns an operator-directed queue of work into tested, independently reviewed pull requests, while keeping the operator informed without requiring supervision of routine delivery steps.

Work may come from a project backlog, an epic, a set of tasks, or additional items the operator supplies while the bench is running. The orchestrator manages dependencies, order and permitted parallelism. It admits authorized additions without discarding unrelated active work or reopening settled decisions. Ambiguous requirements and consequential scope or risk decisions return to the operator.

The bench has a configurable number of worker slots and a separate orchestrator. Slots are reusable capacity, not permanent agent identities. Workers are regularly replaced with genuinely fresh contexts. Each receives the requirements, current work, verification evidence, relevant findings and applicable doctrine needed for its assignment.

## Review

Work circulates through implementation and review. A fresh reviewer examines the requirements and current candidate, then either signs off or makes a bounded correction. A correction returns the changed candidate to review. Only one worker may change an issue’s candidate at a time; independent work and read-only reviews may proceed in parallel.

Completion requires the configured quorum of distinct slots to sign off on the same current candidate, with the required validation satisfied. For a five-slot bench with quorum three, three distinct slots must contribute eligible fresh-context reviews. Recycling one slot cannot multiply its votes, and a context that authored the current candidate cannot approve its own work. Changes to an issue’s reviewed basis invalidate its affected signoffs; unrelated queue activity does not.

## Ownership

Completed items produce actual pull requests with evidence, not merely promises or publication candidates. The orchestrator continues servicing the queue and provides periodic concise status reports covering queued, active, blocked and completed work, with pull-request links. Material blockers and exhausted limits are reported promptly.

Ownership and progress survive recoverable interruptions without duplicating work or pull requests. Uncertain termination, missing evidence and failed publication remain explicit—not success. Execution stays within authorized resource and lifetime limits. Humans retain strategic scope, accepted risk, approval, merge and tracker-closure authority.

The result is reliable delivery with fresh perspectives and visible progress, not an experiment whose setup and bookkeeping replace the work.

after a PR is generated - the orchestrator monitors and issues a shepherd order into the bench - so an agent that is idle may be tasked with rebasing or fixing broken CI.

e.g., the agents should continuously be monitoring to make sure that the PRs are always 'green and ready for the human'
