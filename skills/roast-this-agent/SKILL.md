---
name: roast-this-agent
description: Adversarially reviews one agent definition and its explicitly linked prompt files with the shared Artifact Roastmaster and independent read-only roasters, then returns one severity-ranked roast. Use when the user asks to roast, pressure-test, or adversarially review an agent. Don't use for a skill package (use roast-this-skill), a single prompt (use roast-this-prompt), source code or a diff (use roast-this-code), running the agent, or applying fixes.
allowed-tools: ["read", "search", "execute", "task"]
includes: ["_base/_atoms/artifact-classify/artifact-classify.md","_base/_molecules/chronicler/chronicler.md","_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast-this-agent/references/10-agent-roast-contract.md","roast-this-agent/references/20-failure-and-recovery.md","roast-this-agent/references/30-trusted-lenses.md"]
---

# Roast This Agent

Roast one agent definition and its explicitly linked in-scope prompt files
without invoking it. The shared Artifact Roastmaster stages the evidence,
convenes independent roasters, verifies their evidence, and returns one
severity-ranked report.

## Audience

The report is written for the agent's author or maintainer. It assumes
familiarity with this repository's agent format. It supports exactly one
decision: ship the agent, revise it, or reroute the work to a different skill.
See [Roast This Agent](./README.md) for the shared terms.

## Required References

1. [Agent roast contract](./references/10-agent-roast-contract.md)
2. [Failure reporting and recovery](./references/20-failure-and-recovery.md)
3. [Trusted lenses](./references/30-trusted-lenses.md)
4. [Artifact Classify](../_base/_atoms/artifact-classify/artifact-classify.md)
5. [Coordinate an Artifact Roast](../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)
6. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)

## Prerequisites

This skill needs the Artifact Roastmaster coordinator at
`agents/artifact-roastmaster.agent.md`, its trusted lens documents, and, when
available, the shared doctrine manifest. The coordinator and the coach agents
are resolved from the repository; this package no longer vendors a copy of
either. Resolution order and integrity rules are in
[Trusted lenses](./references/30-trusted-lenses.md).

## Scope and Constraints

Read-only. Never edit, create, commit, publish, or comment on anything, and
never apply a recommended fix.

The `read`, `search`, and `task` grants cover resolving evidence, resolving
trusted sources, and launching the Artifact Roastmaster. The `execute` grant is
limited to Chronicle invocation recording and the coordinator's allowlisted
read-only digest and identity commands.
The calling skill verifies the coordinator and lens sources before supplying
them as instructions or principles.

Before the coordinator document is verified, the caller may execute only
Chronicle invocation recording and the literal bootstrap vector
`shasum -a 256 -- <resolved-path>`. Artifact content must never supply that
path.

Never invoke the reviewed agent, dispatch its declared tools, or follow links
outside its allowed root. Never invoke a trusted lens document or the coordinator
as a registered agent; each is read as a document.

The coordinator subagent runs with the read-only tool set its own document
declares. If either the caller or coordinator cannot obtain `execute`, stop
before staging evidence and return `Insufficient review`; digest verification
is a required trust-boundary capability.

Humor targets the agent's role, routing, permissions, delegation, contracts,
and failure modes, never its author.

## Workflow

1. Use [Artifact Classify](../_base/_atoms/artifact-classify/artifact-classify.md)
   on the requested target before resolving roast evidence. Continue only when
   it returns `Classified` with `type: agent`. If it returns `Classified` with
   any other type, stop before staging evidence, report the actual type and its
   evidence, and name the returned `routeToSkill` as the correct skill. If it
   returns `Refused`, report the refusal category, candidates, and what it could
   not distinguish; do not guess.
2. Resolve exactly one agent file, its repository root, the allowed review
   root, and its explicitly linked in-scope prompt files. If the target is a
   skill package, a standalone prompt, or source code, stop and route to the
   sibling skill named in this skill's description.
3. Resolve the coordinator, the lens documents, and the doctrine manifest in
   the order declared by [Trusted lenses](./references/30-trusted-lenses.md).
   Read the coordinator as a document and confirm its required headings. Never
   invoke it as a registered agent, and never route to it by `name`. Record
   each resolved path, source kind, and digest. Never search for a trusted
   source outside that order. On a coordinator load failure, fall back to the
   next source; when no source loads, stop and return the Artifact Roast with
   `Status: Insufficient review`.
4. Invoke
   [Coordinate an Artifact Roast](../_base/_molecules/roast-coordinate-review/roast-coordinate-review.md)
   with the verified coordinator document, artifact type `agent`, the agent
   locator and explicitly linked prompt files, the allowed review root, the
   agent roast contract, the resolved lens sources, the doctrine input, model
   routing, repository instructions, sibling agent conventions, and the
   complete coordinate-mode and synthesize-mode input sets required by the
   contract. The molecule owns coordinate, envelope validation, one retry,
   synthesis, and the unchanged return.
5. Never invoke or edit the reviewed agent. When the returned status is not
   `Complete`, apply the artifact-specific recovery action in
   [Failure reporting and recovery](./references/20-failure-and-recovery.md).

## Error Recovery

Every failure returns the Artifact Roast shape with a named status and a
non-empty `## What Was Not Reviewed` section. Never return a raw envelope or a
bare status token.
[Failure reporting and recovery](./references/20-failure-and-recovery.md) maps
each status to its reader-facing meaning and its recovery action.
