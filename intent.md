# Intent: this repository

## What this is

A formalization of the software engineering practice I have used across the
first decade of my career, working at small businesses and at large technology
companies alike.

These are not aspirations or collected industry advice. They are the practices I
actually follow. They have been stable for years. What is new is not the
practice - it is writing it down so agents can follow it and assist with it.

## Why it exists

An agent that does not know how I work will do the work its own way, competently
and wrongly. Every correction I give it is a rule I already hold but never
articulated, spent one interaction at a time and forgotten immediately after.

This repository is that articulation, done once and kept.

## The shape of it

Three kinds of thing, and only two of them are written by hand.

**Doctrine** is how software should be shaped. It holds the engineering
positions I have arrived at and continue to hold - the opinions I would defend
in a review. It is deliberately opinionated, because a standard that offends
nobody decides nothing.

**Intent** is what each individual skill is for, in plain words. One per skill,
written for a person and for a future model, never to satisfy a checker.

**Skills** are the workflows themselves, built to follow doctrine and satisfy
intent. These are output. They can be rebuilt.

Doctrine and intent are the source. Everything else is derived from them by
whatever tooling exists at the time.

## What must be true

- **Doctrine and intent are written by humans.** They are the only two inputs.
  An agent may argue that either is wrong, and should; it may not quietly edit
  them. A single line changed in one doctrine can change the outcome of
  everything built afterwards, which is exactly why that edit is mine to make.
- **Nothing here approves its own work.** Tooling finds problems, fixes what is
  clearly broken, and gets a disinterested second opinion on what is arguable.
  Then a person signs off. Automating the review is not automating the approval,
  and that line must not erode as the automation improves.
- **A rule that cannot be satisfied is a signal about the work, not about the
  rule.** The pressure to relax a shared standard always arrives attached to
  something that seems reasonable in isolation. If a package cannot meet the
  bar, the package is what is wrong.
- **Every skill is one job.** A skill that does two will do the wrong one at the
  wrong moment.
- **Capability is granted narrowly and deliberately.** Permissions are a human
  decision, justified in words, never widened as a side effect of building
  something new.

## What this is not

- Not a general-purpose library of everything an agent might do. It is one
  person's practice, and its coherence comes from that.
- Not a place for practices I do not actually use.
- Not a demonstration of a framework. If a rule here exists only to make the
  structure look consistent, it is the wrong rule.

## The bet

Given doctrine, the intent of each skill, and the ability to author and
adversarially review a skill, this library can be rebuilt by spending tokens on
whatever model exists at the time.

That is not the plan for today. It is the reason the source is kept separate
from the output, and the reason both sources are written in plain words rather
than in a structure that only today's tooling understands.
