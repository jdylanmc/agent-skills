---
name: coaching-session
description: Resolve and adopt the Skill Coach persona, conduct the adaptive conversation that shapes one rough skill idea, and return a validated definition packet or a visibly degraded result.
level: molecule
includes: ["_base/_atoms/agent-resolve/agent-resolve.md","skill-coach/_atoms/coach-persona/coach-persona.md","skill-coach/_atoms/coaching-conversation/coaching-conversation.md","skill-coach/_atoms/definition-packet/definition-packet.md"]
composes: ["_base/_atoms/agent-resolve/agent-resolve.md","skill-coach/_atoms/coach-persona/coach-persona.md","skill-coach/_atoms/coaching-conversation/coaching-conversation.md","skill-coach/_atoms/definition-packet/definition-packet.md"]
used-by: ["skill-coach/SKILL.md"]
allowed-tools: ["execute","read","search"]
---

# Coaching Session

One session: find the coach, become the coach, have the conversation, and hand
over what it produced.

```text
resolve the persona -> adopt it -> converse -> assemble the packet -> check it
```

## Required References

1. [Agent resolve](../../../_base/_atoms/agent-resolve/agent-resolve.md)
2. [Coach persona](../../_atoms/coach-persona/coach-persona.md)
3. [Coaching conversation](../../_atoms/coaching-conversation/coaching-conversation.md)
4. [Definition packet](../../_atoms/definition-packet/definition-packet.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | Whatever the person has already said about the skill they want. |
| `repository-root` | yes | The declared root the persona search order resolves against. |

## Operation

1. Resolve the persona with
   [Agent resolve](../../../_base/_atoms/agent-resolve/agent-resolve.md), passing
   the agent name `skill-coach`, the declared repository root, and the required
   headings listed in
   [Coach persona](../../_atoms/coach-persona/coach-persona.md). Supply no
   expected digest: the persona is a human-edited document and changes
   independently of this package.

2. Adopt it with
   [Coach persona](../../_atoms/coach-persona/coach-persona.md). When resolution
   fails for any reason, including a missing required heading, stop here.
   Return `coaching: degraded` with the persona recorded as unavailable, every
   location that was tried, and **no packet**. Never improvise a coach.

3. Conduct the conversation with
   [Coaching conversation](../../_atoms/coaching-conversation/coaching-conversation.md).
   It runs until the idea is ready to hand over or the person leaves something
   unsettled, not until a quota of questions is met.

4. Assemble the result with
   [Definition packet](../../_atoms/definition-packet/definition-packet.md) and
   check it. A refused packet is not returned as a coached result: report every
   defect, return `coaching: degraded`, and let the caller fall back. A packet
   that fails its own contract is exactly the packet a caller would trust
   without noticing.

5. Return the packet and the run status. Nothing is written anywhere.

## Degradation

Two outcomes are degraded, and both are reported rather than smoothed over:

| Cause | Result |
| --- | --- |
| The persona did not resolve or is missing a required heading. | `coaching: degraded`, persona `unavailable` with the reason, no packet. |
| The assembled packet was refused. | `coaching: degraded`, the packet withheld, every defect named. |

A degraded session never certifies that an idea is ready, and it never leaves a
caller believing coaching happened. The caller's own fallback is what keeps the
work moving; hiding the degradation is what would stop it working.

## Output

| Field | Meaning |
| --- | --- |
| `coaching` | `coached`, or `degraded` with the reason. |
| `packet` | The validated definition packet, when the session was coached. |
| `persona` | `adopted` with its path and digest, or `unavailable` with the reason. |
| `defects` | Every defect, when a packet was refused. |
| `attempted` | Every location persona resolution tried, with its outcome. |

## Guarantees

- The persona is resolved from the declared order only, read as a document, and
  never invoked as an agent.
- A session with no adoptable persona returns no packet.
- A returned packet has passed its contract in full.
- Degradation is always reported, never inferred by the caller.
- The session writes nothing.

## Boundaries

This molecule runs one coaching session. It does not create, arrange, edit, run,
review, or approve a skill; does not write an intent or any package file; does
not decide what the caller does with a degraded result; and does not satisfy any
confirmation the caller owes a human.
