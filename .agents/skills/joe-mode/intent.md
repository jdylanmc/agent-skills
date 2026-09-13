# Intent: joe-mode

Joe-mode exists to hand me pull requests to review. It turns the existing
idea-to-ship workflow into a continuous, heavily orchestrated loop, rather than
stopping after recommending a skill, producing a plan, or finishing one phase.

## Anchor the work

Joe-mode can anchor on anything that gives the work a focus: an idea, a folder,
a single issue, a specification, or a backlog. It normally resolves that anchor
to a Git repository, identifies GitHub or Azure DevOps, and uses the provider
and repository configuration to find and manage the relevant backlog.

The selected scope matters. It might be the full backlog for that effort,
only work assigned to me, or a narrower selection. Finding a repository does
not grant permission to take on its entire organization. Ambiguous scope or
identity needs clarification, not a guess.

Readiness comes from the agent-ready label role established when the skills
were set up. Joe-mode uses that configured vocabulary rather than inventing a
new readiness rubric. Dependencies and existing ownership still determine
which ready work can actually run.

## Keep the workflow moving

Once invoked, Joe-mode stays active for the session until I pause or stop it.
It chooses and triggers the appropriate skills automatically, while preserving
their human decisions and approval boundaries. I should not have to ask for
each routine transition.

Agents work on what is known while another works with me on discovery,
charting the path for more agents. Research and bounded proof-of-concept
experiments inform that discovery. Aligned findings feed domain decisions,
architecture decision records where warranted, specifications, and actionable
backlog items. Those activities are triggered as needed, not left as an
implicit gap between discovery and implementation.

These are concurrent paths, not a global waterfall. One slice can be delivered
while another is being specified and a third is still being explored. Existing
ready work does not wait for the whole problem to be understood. When nothing
is defined, discovery and planning establish the backlog before delivery.
New evidence can send an affected slice backward without stopping unrelated
work.

## Orchestrate toward review

Joe-mode owns navigation, coordination, and the current picture of the work.
Specialist skills and agents own their bounded jobs. It should use substantial
delegation and parallel work where dependencies permit, without competing
coordinators, duplicate deliveries, or agents editing each other's work.

The existing delivery flow remains responsible for implementation,
verification, independent review, pull-request publication, and shepherding.
Joe-mode brings me the resulting pull requests, distinguishes drafts and
blocked work from review-ready work, and routes my feedback back to the same
delivery. Review and merging remain human-owned.

Keep my attention on discovery, decisions, blockers, and pull requests needing
review. Do not manufacture decisions on my behalf, bury me in routine
coordination, or describe a plan as completed work.

When nothing can progress, remain available and explain what is needed rather
than inventing backlog items or spinning an idle loop. Session-long operation
does not mean pretending to run after the session or its agents have stopped.
