# Intent: ship

## What this is for

Taking one issue to done.

Most delivery is not a fleet working a backlog. It is one person, one ticket,
and the ordinary sequence of understanding it, building it, proving it, and
handing it over. That common case deserves its own workflow rather than being
the degenerate configuration of a larger one.

## The shape of it

Ship is an orchestration around a single deliverable unit. It does not do every
job itself; it coordinates the ones that already exist — implementation,
testing, adversarial review, the repository's real validation, and the handover
that drives a change request to a mergeable state.

That distinction matters. A skill that both writes the code and judges the code
is grading its own work, and the judgement is worth less for it. Keeping the
roles separate is what makes the result trustworthy.

## What done means

The issue's acceptance criteria are the definition of done, and they are
reported one at a time. "It works" and "tests pass" are the two sentences most
likely to be true in spirit and false in detail. A criterion that was not met,
or could not be checked, should be visible as exactly that rather than absorbed
into a summary.

Validation uses whatever the project already declares as its own, rather than a
plausible command invented in the moment.

## Scope discipline

The most likely way this goes wrong is not failure. It is success at the wrong
thing: noticing something adjacent and quietly fixing it too.

Every expensive mistake in this repository so far has been adjacent to an
assigned task — an unregistered test, an invocation flag on an unrelated skill,
an edit to the validator. Adjacent findings are worth reporting and are not
worth acting on. A pull request that contains one deliberate change and three
helpful ones is harder to review, harder to revert, and harder to trust.

## Laziness as a lens

Good engineering here borrows the fatigue of the person who will maintain this
later. That person prefers deletion to addition, a flat call hierarchy to a deep
one, one source of truth to two that agree today, the smallest diff that works,
and a signal that is not threaded through six layers because it was easier than
thinking. Small leaks get closed rather than tolerated.

This lens applies twice: before implementation is planned, and again while
review findings are being resolved. Both are moments when over-engineering is
easy to justify and expensive to remove later.

## Handover, not merge

Ship produces something handed onward rather than landed. Driving a change
request to mergeable belongs to shepherd, and merging belongs to a person.
Whether the handover happens at all is asked at the start rather than assumed at
the end, because it changes what the run is for.

## Boundaries

- One issue per run. A run that grounds on a blocked issue stops and names the
  blocker instead of starting anyway.
- Not a fleet. Working a whole dependency-aware backlog belongs to the squadron
  workflow; the two must name each other so routing is unambiguous.
- Merge authority stays with a person, and no part of this may claim it.
