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
- **Which skills the next agent should reach for**, named exactly. This is the
  one thing better left out than guessed at: an absent suggestion costs nothing,
  and a vague one sends the next agent somewhere pointless. Say nothing rather
  than something plausible.

These sections are recommended rather than required. Keeping one that is empty
is usually right, because "nothing is broken" and a missing section look
identical to a reader and mean opposite things. But a section that has nothing
to say and no reader who needs the reassurance can go. The judgement is whether
its absence would be read as an answer.

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
- **Treat invocation arguments, when there are any, as the next session's
  focus** and shape the document accordingly. With none, cover the session as it
  stands and do not go asking what happens next - the usual way this is invoked
  is with nothing after the name.
- Say where it ended up, so nobody hunts for the thing just written for them.
  The path, not the document - it was written to a file precisely so it did not
  have to be read here.

## What it must refuse

- **Triggering on its own.** A request for a summary, a note, or a plan is not a
  request for this. Reaching for it uninvited produces files nobody asked for
  and teaches people to ignore it.
- **Inventing anything.** No progress that did not happen, no validation that
  was not run, no decision nobody made. The next agent believes it precisely
  because they cannot check it, which makes a confident fabrication here more
  damaging than almost anywhere else. A recommendation is not an invention, as
  long as it is labelled as one.

  A short session makes a short handoff, and that is a correct outcome rather
  than an embarrassing one. Filling a thin section out until the document looks
  substantial is inventing - it just does not feel like it at the time.
- **Interviewing the operator about filenames or placement.** Those are the
  skill's problem. Somebody invoking this is at the end of a session and out of
  patience. It does have to name it well enough that a week of these sitting
  side by side can be told apart at a glance, and that today's does not land on
  top of yesterday's.
- **Resuming a handoff.** Writing one and picking one up are separate jobs.

## What must be true about how it behaves

- **What happened outranks what I asked for.** Arguments set the focus. Where
  they agree with what happened, they shape the document. Where they conflict,
  the record of what happened stands and the disagreement is written down rather
  than quietly resolved in favour of whoever spoke last.
- Catching the obvious things is the floor, not the job. A key looks like a key
  and will be caught. A customer's name in a stack trace, an internal hostname,
  a path with somebody's username in it - none of those look like anything, and
  they come out too.
- Nothing is reported as saved until it is known to be saved. A handoff
  announced but absent is worse than an obvious failure, because the loss is
  found by the next agent instead of this one.

## The judgement worth preserving

**Write it before it is needed.** Once a session has frozen it is too late;
whatever was in the agent's head is gone, and rebuilding it from a repository is
slow and confidently wrong. A small deliberate cost paid against a much larger
and far less predictable one.
