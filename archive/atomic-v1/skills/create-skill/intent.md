# Intent: create-skill

## What this is for

Walk an author through building one new skill, and make sure the result is
actually good before it is handed over.

## Why it exists

A library of skills only stays coherent if every skill is built the same way.
Left to itself, each new one drifts a little further from the last, and the rules
that hold the collection together become folklore that only the earliest authors
know.

This skill is those rules, written down and applied. It is the one place where
"how we build things here" lives as something executable rather than remembered.

## What it must do

- **Capture what the author actually wants first**, in plain words, before any
  structure exists. A skill built before its purpose is settled is a skill that
  gets rebuilt.
- **Establish the one job it does**, when it should trigger, when it must not,
  and what it refuses. A skill that does two jobs will do the wrong one at the
  wrong moment.
- **Build the package to the library's rules**, including how it is broken into
  parts and why each seam exists.
- **Ask for the narrowest permissions that work**, and make the author justify
  them. Permission granted casually is permission nobody reviews later.
- **Review its own output adversarially, and fix what it finds**, before showing
  the author anything. Review that has to be remembered is review that gets
  skipped.
- **Say plainly what it could not satisfy.** An honest gap is more useful than a
  clean-looking package that quietly fails a rule.

## What it must refuse

- **Changing skills that already exist.** Creating and modifying are different
  jobs with different risks; something that does both will edit when asked to
  create.
- **Widening another skill's permissions** as a side effect of building a new
  one.
- **Weakening a shared rule so a new package passes.** If a package cannot
  satisfy the rules, the package is what is wrong. This is the single most
  important refusal here, because the rules protect every skill and the pressure
  to bend them always arrives attached to something that seems reasonable.
- **Running the thing it just built.**
- **Sharing a new part with the whole library because it might be useful later.**
  Something becomes shared when a second thing actually needs it, not in
  anticipation.

## What must be true about how it behaves

- **Serious problems get fixed, not explained away.**
- **Judgement calls get a second opinion from someone who did not write the
  thing.** An author is the worst judge of criticism of their own work. Advice
  worth arguing with must be evaluated by someone with no stake in the outcome
  and no memory of having written it - and that evaluator must not be told which
  answer is wanted, or the second opinion is worthless.
- **A review of an older version is not evidence about the current one.** After a
  correction, the review is stale and must be redone.
- **It must not loop forever trying to satisfy criticism.** Stop after a few
  rounds, say what is still unresolved, and recommend a way forward - including
  the possibility that the skill is trying to do too much and should be made
  simpler. Then let the operator decide whether to continue.

## The judgement worth preserving

**The rules are the product.** Every other skill inherits whatever this one
enforces. A shortcut taken here to make one package ship becomes the standard
that every later package is built to.

**Automating the review is not the same as automating the approval.** This finds
problems and fixes them so an author is not handed obvious work. It does not
decide the skill is good. A human still signs off, and that separation must not
erode as the automation gets better at its job.
