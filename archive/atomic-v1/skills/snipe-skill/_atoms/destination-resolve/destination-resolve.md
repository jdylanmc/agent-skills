---
name: destination-resolve
description: Resolve exactly one adoption destination from the operator's explicit choice and the destinations applicable instructions declare, refusing discovery, refusing silence as a selection, and refusing to continue into a different destination when resolution fails.
level: atom
allowed-tools: ["read","execute"]
includes: ["snipe-skill/_atoms/destination-resolve/destination-resolve.mjs"]
composes: []
used-by: ["snipe-skill/_molecules/adoption-intake/adoption-intake.md"]
---

# Destination Resolve

An adoption run writes somewhere. Deciding where is the most dangerous
inference in the workflow, because every plausible guess is also a way to write
private material into a public checkout, or public material into a private one.

So this atom does not guess, and it refuses in three distinct ways rather than
one general one.

## Required Files

1. [Deterministic destination resolution](./destination-resolve.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `explicit` | yes in practice | The destination the operator named. Its absence is an answerable question, not a default. |
| `candidates` | yes | The destinations applicable instructions declare, each as `{ id, boundary, private, origin }`. |

`boundary` is an opaque string the operator's own instructions supply. This atom
encodes **no destination taxonomy** — no personal, work, or team ladder. A
vocabulary of destinations belongs to the instruction hierarchy that owns it,
and a copy kept here would go stale against it and be believed anyway.

## The Three Refusals

1. **Nothing is discovered.** A candidate's `origin` is `operator` or
   `instruction`. A candidate that came from a sweep — `scan`, `discovery`,
   `search`, `glob`, `filesystem` — is refused by shape, so "just look around
   for a skills directory" produces nothing this resolver will accept.

   The skill also holds no `search` grant, which narrows the ordinary path
   without sealing it: a run that holds `execute` could still run a search
   command. The mechanical control is this one — a swept candidate cannot become
   a destination here, whatever produced it.
2. **Silence is not a selection.** With no explicit choice, the result is
   `ambiguous` with one bounded question, however many candidates are declared.
   One declared candidate is not consent; it is one option the operator has not
   chosen yet.
3. **A failed resolution never becomes a different destination.** When the named
   destination is not declared, the result names *no* alternative, and
   `assertNoFallback` refuses the substitution outright. A run that could not
   resolve a private destination has learned nothing about whether the work
   belongs in a public one.

## Operation

1. Validate every candidate. Unknown fields, missing fields, wrong types,
   duplicate identities, and swept origins are refusals rather than
   normalizations.
2. With no explicit choice, return `ambiguous` and the question.
3. With an explicit choice that no candidate declares, return `unresolved`, the
   requested identity, and how many destinations were declared — never which
   ones. Naming the destinations the operator did not ask for is how a failed
   resolution turns into a write on the wrong side of a boundary.
4. With an explicit choice that exactly one candidate declares, return
   `resolved`.
5. Before continuing past any non-`resolved` result, call `assertNoFallback`.
6. Report outside the destination's boundary with `publicSummary`.

## Reporting Outside The Boundary

A private destination resolves to a stable handle — `destination-<8 hex>` derived
from its boundary and identity — plus a coarse status. A parent orchestrating
this run often lives outside the destination's trust boundary; it still needs to
know a destination was resolved and what happened there. Two runs against the
same destination produce the same handle, so reports correlate without quoting.

**The handle is not a confidentiality control**, and describing it as one would
be the more dangerous mistake. The derivation is unkeyed and short: anyone
holding a handle and a list of plausible destinations recomputes the match
immediately, and two destinations can collide. What it buys is that a report
outside the boundary does not *quote* the destination's own words. What it does
not buy is secrecy against somebody who can already guess. Keeping a genuinely
secret identity out of a report means not putting it in the report.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `resolved`, `ambiguous`, or `unresolved`. |
| `destination` | On `resolved`: identity, boundary, privacy, origin, disclosure mode, and public identity. |
| `reason` | Why resolution did not land: `no-explicit-destination`, `no-declared-destination`, or `explicit-destination-not-declared`. |
| `declaredCount` | How many destinations were declared. Never which ones. |
| `question` | The one bounded question that would settle it. |

## Guarantees

- No destination is ever discovered by this atom.
- No number of declared candidates substitutes for the operator naming one.
- A failed resolution proposes no alternative and cannot be continued.
- A private destination is reportable without quoting its own words. That is
  correlation, not confidentiality, and this unit claims no more than that.

## Boundaries

This atom resolves *where*. It does not qualify the destination's conventions,
read its instructions, enumerate its existing skills, decide whether the
adoption should happen, or write anything to it.
