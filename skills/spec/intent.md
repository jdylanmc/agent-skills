# Intent: spec

## What this is for

Turn one clear, human-confirmed Discovery artifact into product requirements
that downstream work can trust.

Discovery may have been cycling around a Markdown document or a tracker issue.
Either is a valid source when it is stable, accessible, revision-bound, and
records the shared understanding the human confirmed. Raw conversation is not
a substitute.

## The durable workspace

Agent-authored workflow documents for an application live under
`docs/agent/`. Discovery material belongs under `docs/agent/discovery/` when it
is stored in the repository. Product specifications belong under
`docs/agent/specs/`. Later engineering design, ticket planning, and other
workflow artifacts get their own children beneath the same root.

This directory is the agent's durable workspace. Each compacted session and
each workflow stage grounds itself there rather than relying on conversation
memory, then enriches the shared understanding for the next stage.

## The two product requirements documents

Every specification is split into two sibling documents before review:

- `<spec>.nano.md` is the durable authority. It contains the product intention,
  stable acceptance-criteria identifiers, essential non-goals, source identity,
  and a link to the full document. A human should be able to read it quickly and
  decide whether the work is pointed in the right direction.
- `<spec>.full.md` is supporting context. It contains evidence, users and
  outcomes, detailed scope, requirements, constraints, assumptions,
  alternatives, examples, unresolved decisions, and traceability.

The full document may explain the nano document but may not override it or
quietly introduce product intent. Material full-document requirements and
decisions trace to the nano intention or one of its acceptance criteria. When
the siblings conflict, the nano document wins and the conflict returns to the
human.

## What it must do

- Resolve exactly one persisted Discovery source, whether Markdown or a tracker
  issue, and prove that its aligned content has not changed since confirmation.
- Preserve facts, source claims, decisions, assumptions, contradictions, open
  questions, scope, and exclusions as distinct things.
- Refuse missing product decisions instead of inventing requirements.
- Produce one stable specification identity and stable acceptance-criteria
  identifiers that downstream artifacts can cite.
- Write and reread the nano/full sibling pair beneath `docs/agent/specs/`.
- Present the nano document first and the full document as supporting context.
- Submit the exact candidate pair to the independent Roast workflow before
  human approval. A roast is one read-only review pass; the delivery workflow
  owns any repeated roast, repair, and re-roast loop.
- An unavailable independent specification review leaves the work incomplete.
  Completion remains unreachable until that review exists.
- Treat only an approved nano document as settled product intent.

## What it must not do

- Do not continue Discovery or substitute an interview for a materially
  incomplete source.
- Do not choose architecture or implementation structure.
- Do not author Gherkin, test procedures, fixtures, or automation.
- Do not decompose requirements into tickets or mutate a tracker.
- Do not implement.
- Do not grade its own output, suppress Roast findings, approve a
  specification, shepherd a change, or merge it.

## The judgement worth preserving

The nano document is intentionally smaller than the complete understanding.
That is not information loss. It is a deliberate separation between the small
amount of product intent a human must keep authoritative and the larger body of
context an agent may need to work well. The full document can be regenerated
from better evidence. The nano document changes only when product intent
changes and a human approves it again.
