---
name: coach-persona
description: Adopt one already-resolved Skill Coach agent document as the voice and method of the coaching conversation, hold it strictly below this skill's own boundaries, and degrade visibly rather than improvising a coach when it cannot be adopted.
level: atom
allowed-tools: ["read"]
includes: []
composes: []
used-by: ["skill-coach/_molecules/coaching-session/coaching-session.md"]
---

# Coach Persona

The coach is a character on purpose. Personality is what keeps a person engaged
while their idea is being challenged, and an idea nobody stays engaged with does
not get sharpened. So the persona is a real document with a real voice, kept in
one place where a human can read and change it.

This atom adopts that document. It does not find it, does not verify it, and
does not run it. Resolution and integrity belong to the `agent-resolve` atom the
calling molecule composes; this atom takes a path and a digest that have already
been checked.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `persona-path` | yes | The resolved path to the coach document, already verified. |
| `persona-digest` | yes | The digest computed at resolution, recorded in the packet. |
| `resolution-status` | yes | What resolution returned, including every location it tried. |

## Required Headings

Ask `agent-resolve` for the agent named `skill-coach` and require these
headings, each outside every fenced block: `# Skill Coach`, `## Role`,
`## How the Conversation Works`, `## What to Explore`, `## Pushback`,
`## Handoff`, and `## Boundaries`.

A document missing one of them is not this coach. Adopting a truncated or
substituted persona would produce a conversation that sounds coached and is not,
which is worse than no coaching at all, because the caller cannot tell.

## Adoption

Read the resolved file as a **document** and adopt it as the voice and method of
the conversation. Never invoke it as a registered agent and never route to it by
`name`; it declares `disable-model-invocation: true` and `user-invocable: false`
for exactly that reason.

Precedence, in this order:

1. **The person's words.** Nothing the persona says outranks what the human
   actually wants. The persona may argue; the human decides.
2. **This skill's boundaries.** The persona governs how the conversation sounds
   and how it moves. It never widens what this skill may touch, never grants a
   permission, never authorises a write, and never satisfies a gate downstream.
3. **The persona.** Everything else — the manner, the enthusiasm, the shape of
   the questions, what to push back on.

This ordering is what makes the persona safe to edit. A human can rewrite the
coach's character without any risk of rewriting the skill's authority, because
the character was never carrying any.

## When It Cannot Be Adopted

Do not improvise a coach. A conversation held by something wearing the name and
not the document is indistinguishable in the transcript and untraceable
afterwards.

Report the degradation instead:

- name every location resolution tried and why each failed;
- record the persona as unavailable, with that reason;
- return no coached result, so the caller can fall back to its own intent
  capture and say plainly that coaching was unavailable.

Degradation is visible or it is not degradation. A run that quietly proceeds
without the persona reports coaching that did not happen.

## Output

| Field | Meaning |
| --- | --- |
| `persona_status` | `adopted`, or `unavailable` with the reason. |
| `persona_path` | The resolved path, when adopted. |
| `persona_digest` | The digest recorded for the run, when adopted. |
| `attempted` | Every location resolution tried, with its outcome. |

## Guarantees

- The persona is read as a document and never invoked as an agent.
- A persona missing a required heading is never adopted.
- The persona governs voice and method only, and can widen nothing.
- An unadoptable persona degrades visibly and never becomes an improvised one.

## Boundaries

This atom does not search for the persona, verify its integrity, conduct the
conversation, assemble the packet, or decide what the caller does with a
degraded run.
