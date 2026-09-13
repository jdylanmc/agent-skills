---
name: coaching-conversation
description: Run the adaptive conversation that turns a rough skill idea into a shared understanding, following the idea instead of a questionnaire, never re-asking what was already answered, and stopping when the idea is ready to hand over rather than after a quota of questions.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["skill-coach/_molecules/coaching-session/coaching-session.md"]
---

# Coaching Conversation

An intake question records what somebody already knows. Coaching uncovers what
they have not considered, while the idea is still cheap to change. Those are
different activities, and only one of them is worth a conversation.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `request` | yes | Whatever the person has already said about the skill they want. |
| `persona` | yes | The adopted coach persona, governing voice and method. |
| `transcript` | yes | Everything the person has said, verbatim, growing as the conversation runs. |

## How It Runs

Adaptively. The conversation follows the idea; there is no fixed order and no
list the person has to get through.

1. Open with **one real question**. Not a template, not a questionnaire, not a
   numbered intake. The answer arrives however it arrives — a sentence, a
   contradiction, or several minutes of unsorted enthusiasm — and all of those
   are accepted as given.
2. Say back what was heard, in cleaner words, and let the person correct it. Be
   specific about what is good in the idea and **why** it is good, so they can
   do more of it deliberately.
3. Ask about whatever matters next, given what they just said. One question at
   a time.
4. Fold every answer into the transcript verbatim, and reassess from there.

## Subjects That Usually Matter

These emerge from the idea. They are not a checklist, and an idea that never
raises one of them is allowed to skip it.

| Subject | What the conversation is trying to reach |
| --- | --- |
| Interaction | What the person does, and what happens back. |
| Expected outcome | What is different afterwards. |
| Nearby capabilities | What already exists that overlaps this. |
| Permissions and boundaries | What it may touch, what it must not, and where it stops and asks. |
| Failure behaviour | What it does when what it depends on is missing, wrong, or refuses. |
| Observable success | How anybody would see that it worked. |

**Never re-ask what was already answered.** Asking again spends the person's
patience proving nobody listened, and every answer after that is shorter for it.
Before asking, check the transcript for words that already cover it.

## Pushing Back

Push back on vagueness, accidental scope, unsafe authority, duplication, and an
outcome nobody could verify. Make the argument rather than filing an objection.

When there is a better direction, an existing capability that already does this,
a useful split, or a reason not to build at all, say so and argue it.

**The person chooses.** Record the choice and the reasoning, including — and
especially — when they choose against the recommendation. A rejected
recommendation with the reason attached is one of the most valuable things the
conversation produces, because it is exactly what a later rebuild would
otherwise re-derive.

## Stopping

Stop when the idea is ready to hand over: the interaction and the expected
outcome are settled, the consequential details in the middle have been explored,
and what is still open is known to be open.

Stop early and hand over an unsettled result when the person cannot or will not
settle something. Never fill the gap with a plausible guess: a guess is
indistinguishable downstream from something they said, and it is trusted exactly
as much.

## Output

| Field | Meaning |
| --- | --- |
| `transcript` | The person's own words, verbatim. |
| `explored` | What the conversation surfaced, each item marked as theirs or the coach's. |
| `decisions` | What they decided, and why. |
| `recommendations` | What the coach recommended, and what they accepted or rejected. |
| `examples` | Concrete situations and the behaviour expected in them. |
| `open_questions` | What is still unsettled, and whether it blocks. |

## Guarantees

- The opening is one question, and unstructured answers are accepted as given.
- Nothing already answered is asked again.
- The person's words and choices stay authoritative; the coach may argue and
  never decides.
- A recommendation is recorded with its disposition and their reasoning.
- An unanswered question is carried forward as unanswered.

## Boundaries

This atom conducts a conversation. It does not build, arrange, edit, run,
review, or approve the skill; does not decide what the skill is for; does not
choose a structure or grant a permission; and does not confirm anything on the
person's behalf. Agreement reached here is conversational agreement, and every
later gate still asks the human itself.
