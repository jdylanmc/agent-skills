# Ownership-first continuation scenarios

Acceptance scenarios for Joe-mode, its adapters, Handoff and delivery routes.
They clarify existing authority; they do not grant new mutation, publication,
approval or merge permission.

## Already-owned issue

Given the human names issue `#114`
and the repository owner board already covers `#114`
and one live or recoverable delivery owner has accepted custody
and the packet records the current stage, evidence and next action,
when a controller or adapter receives the request,
then it inspects and reconciles that owner and packet before backlog discovery,
reuses the existing route,
and continues the recorded next action when current authority covers it.

It must not create another controller, reserve or dispatch a duplicate delivery,
restart Discovery, or ask whether to proceed with the already-authorized action.

## Explicit next action in a handoff

Given an accessible handoff identifies the repository, owner, worktree or PR,
completed evidence, unresolved blockers and an explicit next action,
and the receiver verifies those facts against current state,
when the next action is routine work inside the carried authority,
then the receiver acknowledges custody and performs that action.

It must not summarize the handoff and stop for a redundant permission prompt.

## Human decision remains human

Given the recorded next action requires a product or architecture decision,
scope expansion, destructive operation, production access, approval, merge, or
authority not carried by the handoff,
when the receiver reaches that boundary,
then it asks the smallest material question and continues independent authorized
work where possible.

The no-reprompt rule never converts a human gate into routine continuation.

## Ownership cannot be verified

Given a handoff or issue reference claims prior ownership
but the receiver cannot inspect the board, live owner, worktree, PR or packet,
when duplicate work could race or overwrite the claimed owner,
then the receiver reports the exact visibility gap and blocks competing writes.

It may perform bounded read-only reconciliation. It must not infer abandonment
from age, silence, an idle session, a missing tab, or an unverified summary.
