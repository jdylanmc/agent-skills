---
name: definition-packet
description: Assemble what a coaching conversation produced into one definition packet that keeps confirmed definition, explored behaviour, human decisions, coach recommendations, examples, and unsettled questions apart, and refuse a packet that forges the human's confirmation, claims a write, or dresses an open question as settled.
level: atom
allowed-tools: ["execute"]
includes: ["skill-coach/_atoms/definition-packet/definition-packet.mjs"]
composes: []
used-by: ["skill-coach/_molecules/coaching-session/coaching-session.md"]
---

# Definition Packet

The packet is the only thing that leaves a coaching session. Everything the
conversation was worth is either in it or lost, and everything that can go
wrong with it goes wrong quietly, so the shape is checked mechanically rather
than described and hoped for.

Six kinds of material go in, and they are never blended:

| Kind | What it is |
| --- | --- |
| `definition` | What the person said the interaction and the outcome are, and whether they agreed to that wording. |
| `explored` | Consequential behaviour the conversation surfaced, each item marked as the person's or the coach's. |
| `decisions` | What the person decided, and why. |
| `recommendations` | What the coach recommended, and whether the person accepted or rejected it. |
| `examples` | Concrete situations and the behaviour expected in them. |
| `unsettled` | What is still open, each marked blocking or not. |

Blending them is the whole failure. A caller that cannot tell the coach's
preference from the person's decision will build the coach's skill and believe
it built the person's.

## Required References

1. [Packet contract](./definition-packet.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `conversation` | yes | Everything the person said, verbatim, and everything the coach recommended. |
| `persona` | yes | How the coach persona resolved: adopted with its path and digest, or unavailable with the reason. |
| `skill-name` | no | The candidate name, when the conversation settled one. |

A packet exists only when a conversation happened. A run whose persona never
resolved and whose conversation never started returns a degraded result and no
packet, so every packet that exists carries the person's own words.

## Operation

Assemble the packet as JSON and check it:

```text
printf '%s' "$packet_json" | node <atoms>/definition-packet/definition-packet.mjs --stdin
```

A caller that already holds the bytes on disk may check the same file instead:

```text
node <atoms>/definition-packet/definition-packet.mjs --packet "$absolute_packet_path"
```

Standard input is the mode this skill uses, because this skill has no write
authority and must never need any. Exit `0` accepts the packet, `2` refuses it
and names **every** defect at once, and `1` is a usage, path, or JSON failure.
A caller that has to fix a packet needs the whole list, not the first item.

## What It Refuses

| Refusal | What it stops |
| --- | --- |
| `forged_confirmation` | A field claiming the operator's confirmation, an approval, or a stored intent. That custody belongs to the intent storage gate downstream, which binds a confirmation to the exact bytes it presented. Coaching never holds it. |
| `write_claim` | A field reporting files. Coaching writes nothing, so a packet describing a write is describing something that did not happen. |
| `disguised_unsettled` | `ready` while a blocking question is still open. |
| `unsupported_ready` | `ready` without the person's agreement, out of a degraded run, or with nothing explored. |
| `unsupported_quote` | A claim attributed to the person with no words of theirs behind it, or too few to be about anything. |
| `unattributed_disposition` | A recommendation recorded as accepted or rejected with no reason from the person. |
| `degraded_mismatch` | A run reported as coached when the persona never resolved. |
| `unknown_field` | Anything the packet has no place for, at any level. |
| `missing_field`, `invalid_value` | An absent required value, or one outside its allowed set. |

The quote floor is not fussiness. A one-character quote appears in every
conversation, so without a floor "the person said so" would mean whatever the
coach asserted.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `valid`, or `refused`. |
| `defects` | Empty when valid. Otherwise every defect, each naming its code and the exact field. |

## Guarantees

- A packet is valid only when every check passes. There is no partial pass.
- Every claim attributed to the person carries the person's own words.
- A packet never carries the operator's confirmation, an approval, or a stored
  intent, whatever it is asked to carry.
- A packet never reports a file, because nothing here writes one.
- `ready` and "still open" cannot both be true.
- Every defect names the exact field, so a caller can say precisely what to fix.

## Boundaries

This atom checks the shape of a packet. It does not conduct the conversation,
judge whether the idea is any good, decide what the caller does with a refusal,
write the packet anywhere, or approve anything.
