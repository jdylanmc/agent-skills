---
name: laziness-lens
description: Apply a maintainer-fatigue lens to a proposed implementation or a proposed remediation, preferring deletion, flatness, one source of truth, and the smallest diff that works.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["ship/_molecules/delivery-grounding/delivery-grounding.md"]
---

# Laziness Lens

Borrow the fatigue of whoever maintains this next.

Over-engineering is rarely a mistake in the moment. It is almost always
defensible when written: the abstraction might be needed, the parameter might
vary, the layer might get a second implementation. The cost lands later, on
somebody with less context, and it is paid every time they read the file.

This lens is applied at the two moments when that cost is cheapest to avoid:
before implementation is planned, and while review findings are being resolved.

## Questions

| Question | What a failing answer looks like |
| --- | --- |
| Can this be solved by deleting something? | New code is added beside code that already does the job. |
| Is the call hierarchy flat? | A call passes through layers that only forward it. |
| Is there one source of truth? | Two places must agree, and nothing enforces that they do. |
| Is this the smallest diff that works? | Unrelated refactoring rides along with the change. |
| Is this signal threaded rather than thought about? | A parameter is passed through functions that neither read nor need it. |
| Are leaks this change introduces closed? | The proposal adds a rough edge and leaves it for later. |
| Would a tired maintainer understand this? | Understanding it requires holding several files in mind at once. |

## Leaks, and Whose They Are

The leak question is deliberately narrow, because the obvious wider version of
it contradicts the scope boundary this run is held to.

A leak counts here only when the **planned change introduces it**, or when
closing it is the minimal step proven necessary for a numbered acceptance
criterion. Those are the run's own mess, and leaving them is how a diff becomes
someone else's problem.

A leak that already existed is **adjacent**. It is reported and not fixed, and
it does not count against the laziness verdict. A proposal is not
over-engineered for declining to repair something it did not break, and "close
the small leak" is never a route around the scope boundary.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `lean` | The proposal is about as small as the problem allows. |
| `trim` | Specific reductions are available and named. |
| `over-engineered` | The proposal solves more than the issue asked for. |
| `under-specified` | Too little is proposed to judge. |

A `trim` or `over-engineered` verdict names the exact reduction rather than
gesturing at simplicity. "Simplify this" is not actionable; "this wrapper only
forwards, call the inner function directly" is.

## What This Lens Is Not

It is not an argument against structure. A repository whose whole premise is
composed units is not made better by refusing to compose. The target is
structure that carries no weight: the abstraction with one implementation, the
layer that only forwards, the option nobody sets.

It is also not a licence to widen scope in the name of cleanliness. Deleting
something adjacent is still an adjacent change, and it belongs in the reported
findings rather than in the diff. Where this lens and the scope boundary appear
to disagree, the scope boundary wins.

## Output

Return the verdict, each failing question with the specific evidence that failed
it, the named reductions, and anything deliberately kept with the reason it
earns its place.

## Boundaries

This atom judges a proposal. It writes no code, edits no file, and does not
decide whether the work proceeds.
