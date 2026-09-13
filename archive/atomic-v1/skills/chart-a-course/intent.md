# Intent: chart-a-course

Chart-a-course exists to make the dependency shape of a bounded body of work
visible around one named goal.

It accepts mixed work records, such as requirements and tickets, when they have
stable identities, lifecycle state, and explicit dependency relationships. It
normalizes that evidence deterministically, identifies the goal's transitive
prerequisites, and shows which work gates the goal, which work is ready, which
work is blocked by named prerequisites, which work is complete, and which work
is outside the goal's dependency chain.

When every remaining gating record has a reliable estimate in one unit, the
skill may calculate the longest weighted gating path. Otherwise it reports only
the longest structural dependency chain and says plainly that this is not a
calendar or time critical path. Equal longest paths must remain equal rather
than being collapsed into a preferred route. Completed records remain in path
topology but contribute zero remaining weight. Weighted values use exact
integer smallest units; fractional estimates are not used for weighted
comparison.

The skill must not manufacture dependency edges or silently repair malformed
work data. Missing or duplicate identities, absent edge endpoints, unclear edge
direction, cycles, stale or unavailable lifecycle state, and a goal outside the
bounded graph remain visible. Conclusions that those defects make unsafe are
refused or clearly qualified. Defects clearly outside the named goal's possible
closure remain visible and lower confidence without suppressing otherwise
supported goal conclusions.

This is a read-only planning view. It does not prioritize the backlog, dispatch
workers, create or close work, mutate trackers, or select the next tactical
action. It does not invoke or reproduce next-step-selection. It returns exactly
one planning action for improving or using the map, while authority remains
with the person or parent workflow.
