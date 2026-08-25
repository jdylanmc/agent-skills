# Intent: next-step-selection

Next-step-selection exists for the moment when a person returns to an ongoing
body of work and no longer has the active state in their head.

The skill reconstructs enough current context to say where the work stands and
which one tactical action should happen next. It is useful on its own after a
break or crash, and it is also a small decision primitive that larger workflows
can reuse when they need to move through a software delivery loop without
stuffing every detail into the main agent's context.

The output is not a plan for everything. It is one next step, why that step is
the right frontier, what evidence supports it, what alternatives were rejected,
which gates or budgets apply, and a short worker brief that a human or parent
workflow can dispatch.

The skill must stay read-only. It may inspect available state, but it must not
spawn agents, edit files, merge pull requests, send messages, or mutate
trackers. A parent workflow or human owns dispatch and records what happened.
