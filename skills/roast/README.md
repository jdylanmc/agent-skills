# Roast

**Review this and find flaws.** Direct `/roast` and requested model-side
invocation use the same workflow in [SKILL.md](./SKILL.md).

The [human intent](./intent.md) governs the behavior. Inputs are not restricted
to an artifact registry: a repository, branch, function, diagram, document,
email, URL, remote asset, or mixed collection can be reviewed. Missing scope or
access leads to clarification, not an unsupported-type refusal.

## How it works

The invoking agent understands the request, obtains accessible evidence, selects
applicable standards, reviews or directly dispatches independent perspectives,
checks their claims, and returns one ranked report. It does not launch separate
coordination, synthesis, or summary agents. Fresh independent review is required
for the invoking agent's own work; other delegation must earn its cost.

Helpers handle known mechanical tasks, not arbitrary input understanding.
Hashes, Git revisions, verified doctrine and finding checks remain useful.
A mandatory manifest, temporary staging area, closed taxonomy, or fixed council
does not.

## Output

The [finding contract](./_atoms/roast-contract/roast-contract.md) records scope,
standards, coverage, priority, confidence, evidence, consequences, fixes and
verification. `Complete` means sufficient agreed review coverage, not approval
or absence of flaws. `Partial` preserves supported findings while exposing
gaps. `Needs clarification` names what is needed to proceed.

## Execution policy

Source review does not edit source. An application already prepared locally for
agentic verification may be run within its established permitted effects.
This intentionally replaces the old blanket execution ban without changing the
tool-name grant. It does not permit arbitrary reviewed scripts, installation,
production access, deployment, shared-state mutations, or source repairs.

## Existing delivery integrations

Explicit, previously confirmed tiered-review and panel policies retain their
routing helpers and revision checks. They are opt-in caller policy, not the
default shape of every Roast. Callers own their product authority and
publication gates; a partial review cannot satisfy a complete-review gate.

## Maintenance

Keep safety and behavioral regression tests. Do not reintroduce eligibility
checks or a second workflow merely to preserve superseded structure.
Regenerate graph metadata after composition changes:

```text
node scripts/derive-skill-graph.mjs --write
```

The repository workflow owns the complete test list. Live review examples prove
behavior separately from structural checks; neither is human approval.
