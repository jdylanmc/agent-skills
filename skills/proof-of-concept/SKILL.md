---
name: proof-of-concept
description: Stress-test one spitballed idea, library, framework, engine, concept, loose phrase, or directive with real code so the team can learn whether it works, what fails, what edge cases and gaps exist, and whether it fits what they are building. Use when the operator asks to run a proof of concept, run a POC, prototype this, prove out a framework, spike a library, or when discovery routes here because a cheap bounded prototype would answer a discovery question. Do not use to ship or harden production implementation, create specs or tickets, deploy, commit prototype code, or persist repository artifacts without explicit approval.
allowed-tools: ["execute","read","search"]
includes: ["_base/_molecules/chronicler/chronicler.md","proof-of-concept/_molecules/prototype-learning/prototype-learning.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","proof-of-concept/_molecules/prototype-learning/prototype-learning.md"]
disable-model-invocation: false
user-invocable: true
requires-skills: []
---

# Proof of Concept

Stress-test an idea with real code and preserve the learning.

```text
record -> frame question -> isolate prototype -> run experiment -> gather feedback -> return findings
```

Proof-of-concept work is a learning tool. It is allowed to write and run
throwaway code when that code is the cheapest way to answer the question. The
prototype itself is not the product; the durable output is the evidence,
findings, tradeoffs, and human feedback it uncovers.

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Prototype learning](./_molecules/prototype-learning/prototype-learning.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record the POC question, prototype scope, artifact location,
   commands run, final recommendation, cleanup status, and any approval-gated
   persistence. Continue when recording is unavailable; recording is best
   effort and weakens no boundary below.
2. Run [Prototype learning](./_molecules/prototype-learning/prototype-learning.md).
   It frames the learning question, chooses the smallest isolated experiment,
   builds and runs the prototype, captures observations, requests human
   feedback when the result needs interpretation, and assembles the findings
   packet.
3. Return the findings packet. If discovery invoked this skill, return findings
   in a shape discovery can incorporate into its alignment check, handoff,
   frontier, and next-cycle selection.

## Output Contract

Return:

- the question tested and why code was the cheapest way to answer it;
- success criteria or learning goal;
- prototype scope, workspace, and artifact paths;
- libraries, frameworks, engines, or directives exercised;
- commands run, with relevant output summarized and logs referenced;
- observed behavior, edge cases, failures, gaps, and fixes needed;
- human feedback and interpretation when requested;
- cleanup status and any artifacts deliberately preserved with approval;
- recommendation: `adopt`, `reject`, `continue-poc`, `return-to-discovery`,
  `specify`, or `implement`;
- any Chronicler log path or recording defect.

## Boundaries

- Prototype code is evidence, not product code. Do not harden, ship, or
  promote it into implementation inside this skill.
- Default to a temporary/session POC workspace or isolated git worktree.
  Repository persistence requires explicit approval for the exact files.
- Do not commit, push, deploy, use paid/cloud resources, or touch production
  data without explicit approval.
- Use synthetic data. Do not place secrets, credentials, or personal data in
  prototype code, logs, fixtures, screenshots, or findings.
- Keep the experiment scoped to the named question. If the question changes
  materially, stop and ask before continuing.
- Clean up throwaway artifacts unless the human approves keeping them.
- Do not create tickets, specifications, acceptance criteria, or production
  implementation tasks. Recommend the next skill instead.

## Permissions

`read` and `search` inspect relevant repository context, documentation, and
existing conventions. `execute` is for Chronicler recording, creating isolated
prototype workspaces, installing prototype dependencies inside those isolated
workspaces, running local experiments, and cleaning up approved throwaway
artifacts. There is no `edit` grant, no `task` grant, and no wildcard grant.
