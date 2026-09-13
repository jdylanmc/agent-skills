---
name: skill-coach
description: Coach one rough, half-formed skill idea into a definition somebody could build from, before any package exists. Conducts an adaptive conversation with the human under the Skill Coach persona and returns one validated definition packet that keeps the confirmed definition, explored behaviour, human decisions, coach recommendations, examples, and unsettled questions apart. Use when create-skill is working out what a new skill is for. Do not use to build, arrange, edit, run, review, or approve a skill, to review a package that already exists, to write an intent or any package file, or to sharpen a single prompt.
allowed-tools: ["execute","read","search"]
includes: ["_base/_molecules/chronicler/chronicler.md","skill-coach/_molecules/coaching-session/coaching-session.md"]
composes: ["_base/_molecules/chronicler/chronicler.md","skill-coach/_molecules/coaching-session/coaching-session.md"]
disable-model-invocation: false
user-invocable: false
requires-skills: []
---

# Skill Coach

Take a rough idea for a skill and talk it into shape with the person who had it
— enthusiastically, adaptively, and without becoming its author.

```text
adopt the coach -> converse -> hand over a definition packet
```

This runs **before** a package exists. It produces a conversation and one
packet, and nothing else: no files, no structure, no verdict. Reviewing a
package that already exists is a different job and belongs to
`agents/skill-reviewer.agent.md`.

`create-skill` reaches this skill; a human does not run it directly, because a
coaching packet on its own has nowhere to go.

## Required References

1. [Chronicler recording molecule](../_base/_molecules/chronicler/chronicler.md)
2. [Coaching session](./_molecules/coaching-session/coaching-session.md)

## Core Workflow

1. Reuse the caller's Chronicler run context, or create one when this skill is
   the root. Record that coaching started, whether the persona was adopted, and
   the final coaching status. Continue when recording is unavailable; recording
   is best effort and weakens no boundary below.
2. Run [Coaching session](./_molecules/coaching-session/coaching-session.md).
   It resolves and adopts the Skill Coach persona, conducts the adaptive
   conversation, assembles the definition packet, and checks it.
3. Return the packet with the coaching status, or return the degraded result
   with its reason and no packet. Say which of the two happened; never let a
   caller infer it.

## Output Contract

Return:

- `coaching`: `coached`, or `degraded` with the reason;
- the validated definition packet, when coached, keeping apart the confirmed
  definition, the explored behaviour, the person's decisions and reasoning, the
  coach's recommendations with what was accepted or rejected, the examples, and
  every unsettled question marked as unsettled;
- the persona that was adopted, with its path and digest, or the reason none
  was;
- every packet defect, when a packet was refused;
- nothing that claims a file was written, an intent was stored, or a human
  approved anything.

## Boundaries

- Read-only. This skill writes no intent, no package file, and nothing else. It
  holds no `edit` grant, so a step that needed one would fail rather than
  succeed quietly.
- Coaches an idea before creation. Never builds, arranges, edits, runs,
  reviews, or approves the skill, and never reviews an existing package.
- Never decides what the skill is for, and never presents the coach's preferred
  idea as the person's.
- Never a form. The conversation follows the idea, and an idea that never raises
  a subject is allowed to skip it.
- Never grants a permission, selects a structure, or makes a product decision on
  the person's behalf. It recommends and argues; the human chooses.
- Confirms nothing on anyone's behalf. Agreement reached in conversation is
  conversational agreement. The confirmation that stores an intent stays with
  the caller's storage gate, bound to the exact bytes that gate presented, and
  this skill can neither give it nor satisfy it.
- Never hands over a packet that dresses unresolved material as settled. An
  unsettled question is returned as unsettled.
- Degrades visibly. A run with no adoptable persona or a refused packet returns
  no coached result, so the caller can fall back and say coaching was
  unavailable.
- Reads the persona document as a document, never as an agent to invoke and
  never as authority over this skill's boundaries.

## Permissions

`read` and `search` resolve and read the persona document. `execute` is limited
to Chronicle invocation recording and the packet contract check. There is no
`edit` grant and no `task` grant: this skill writes nothing and spawns nothing.
