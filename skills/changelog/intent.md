# Intent: changelog

## What this is for

Keeping a changelog that is useful to a person deciding what changed, whether to
upgrade, and what to watch for.

Commits, pull requests, and closed issues are evidence. They are not prose to
paste. The valuable result is a curated set of entries that explain externally
meaningful change in the reader's terms, which is a different artifact from a
list of what happened to the source.

## Whose changelog

Not always the file at the root of a repository.

A changelog may cover one component in a larger repository, one published
package, or one skill in a library. The same job applies at each scale, so the
workflow resolves *which* changelog is being written before deciding what it
should say. Assuming the root file is how an entry about one component ends up
in the history of everything around it.

Which changelog is being updated can be stated outright by whoever invokes the
work, inferred from the part of the tree in question, or fall back to the
repository's own. When more than one file could plausibly serve, that is a
question for a person, because guessing writes real history into the wrong
place.

## Whose conventions

The changelog being written already has conventions, and those are facts about
it rather than preferences to correct.

Keep a Changelog is the right default for a file that does not exist yet. For
one that does, the format it already uses governs. A repository that
deliberately keeps a different shape is not defective for having done so, and
adding one entry should never reformat a history that was fine before. A
proposed migration between conventions is its own decision, made on purpose,
never a side effect of an unrelated entry.

## Evidence and honesty

Entries stay unpublished until a person approves the exact wording and the exact
target. An entry with no source trail is withheld rather than published, and
deprecations appear as deprecations instead of dissolving into removals or
generic changes.

Where a project also generates release notes automatically, the two accounts of
the same release must not drift apart. This workflow either feeds that system or
reconciles with it, and says which.

Evidence that falls outside the resolved scope is excluded and reported as
excluded, because a filtered result that reads as an empty one is a lie about
what changed.

## Who applies it

A person does. This work produces a patch, not an edit.

Another skill may reasonably drive the curation — choosing the target, supplying
evidence it already gathered, and consuming the proposal. None of them should be
able to put words into a release history unattended, and the reliable way to
ensure that is for this work to hold no ability to write at all.

The alternative was a write permission defended by an approval check. That does
not survive contact with how these workflows actually run: the check and the
write are separate moments, and a claim that a person already approved something
is supplied by whoever is asking. A permission guarded only by a promise is not
guarded.

Applying the patch by hand is also the moment someone reads it, which is the
point of a changelog nobody generated blindly.

## What this is not

Not a release-note generator, not a replacement for release automation, and not
a formatter that turns a commit log into bullet points.
