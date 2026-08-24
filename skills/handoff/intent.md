# Intent: handoff

## What this is for

A summary of the current session and where we should go next, written to a file
so somebody else can pick the work up.

"Somebody else" is me tomorrow, or another agent in an hour. Both need the same
thing: what happened, and what to do about it.

## Why it exists

This began as a prompt I retyped at the end of sessions. It worked, and it
produced a slightly different document every time - different sections,
different emphasis, whatever seemed relevant in the moment.

**Giving it an official structure is most of the value.** A fixed shape means
nothing important gets left out because it did not occur to anyone that day, and
the next agent knows where to look without reading the whole file first. An
ad-hoc summary has to be read end to end before you know whether it contains
what you need.

It serves two situations that want the same artifact:

**Parking a session and resuming later.** Work stops and picks up another day.
Everything that made it make sense lived in the conversation, and the
conversation does not survive.

**Handing off between agents.** One agent stops, another continues. The second
has the repository and none of the reasoning, so without this it starts by
rediscovering what the first already knew.

In both cases the code is safe on disk. What disappears is what was never
written down: what we were trying to do, what we already ruled out, which
approaches failed and why, and which of several plausible next moves is right.

## What it must capture

- **The current state.** Where the work stands now.
- **Where we have been.** How it got here, so settled questions stay settled.
- **What we tried.** Including attempts that went nowhere. Failed approaches are
  the most expensive knowledge in a session and the first thing lost, and
  without them the next agent cheerfully repeats them.
- **What is working.** What can be relied on and built upon.
- **What is not working.** Open problems, known breakage, anything unresolved
  when the session stopped. A handoff recording only successes reads as
  finished work and sets the next agent up to be surprised.
- **A recommendation for what to do next**, offered as a judgement rather than
  stated as established fact, so the next agent can knowingly disagree.
- **Which skills the next agent should reach for**, named exactly, and only when
  there is genuinely a useful one. A vague suggestion is worse than none.

Every section stays present even when empty. "Nothing is broken" and a missing
section look identical to a reader and mean opposite things.

## What it must do

- **Link to things rather than copying them.** Specifications, plans, decision
  records, issues, commits, and diffs already live somewhere durable.
  Reproducing them creates a second copy that goes stale immediately and buries
  the genuinely new information in duplicated material. Reference them by path
  or URL.
- **Write to the operating system's temporary directory, not the workspace.** A
  handoff is working material, not a deliverable. It should never need cleaning
  out of a commit, and it should not look like part of the project to anyone
  reading the repository later.
- **Remove sensitive values** - keys, passwords, personal information. This file
  outlives the session and is read by somebody who was not there.
- **Treat invocation arguments as the next session's focus** and shape the
  document accordingly.
- Say where it ended up, so nobody hunts for the thing just written for them.

## What it must refuse

- **Triggering on its own.** A request for a summary, a note, or a plan is not a
  request for this. Reaching for it uninvited produces files nobody asked for
  and teaches people to ignore it.
- **Inventing anything.** No progress that did not happen, no validation that
  was not run, no decision nobody made. The next agent believes it precisely
  because they cannot check it, which makes a confident fabrication here more
  damaging than almost anywhere else. A recommendation is not an invention, as
  long as it is labelled as one.
- **Interviewing the operator about filenames or placement.** Those are the
  skill's problem. Somebody invoking this is at the end of a session and out of
  patience.
- **Resuming a handoff.** Writing one and picking one up are separate jobs.

## What must be true about how it behaves

- **Evidence outranks instruction.** Arguments set the focus. Where they agree
  with what happened, they shape the document. Where they conflict, the evidence
  stands and the disagreement is recorded rather than quietly resolved in favour
  of whoever spoke last.
- Redaction is a floor. Anything sensitive that automated redaction would not
  recognise is removed before it reaches that step.
- The file is reread after writing. One reported as saved but absent is worse
  than an obvious failure, because the loss is found by the next agent instead
  of this one.

## The judgement worth preserving

**The value is in what gets left out.** Anyone can dump a session into a file.
The hard part is deciding what a future agent genuinely needs, and a handoff
long enough to be exhaustive will not be read - which makes it exactly as useful
as no handoff at all.

**Write it before it is needed.** Once a session has frozen it is too late;
whatever was in the agent's head is gone, and rebuilding it from a repository is
slow and confidently wrong. A small deliberate cost paid against a much larger
and far less predictable one.
