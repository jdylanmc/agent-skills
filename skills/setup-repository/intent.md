# Intent: setup-repository

Many skills need to know things about the repository they are running in that
the repository does not state in one settled place: which tracker hosts its
work items, how that tracker is organized, what its labels and states mean, and
what the repository's product and domain actually are. Left to each skill, those
facts get guessed, and a guessed organization or an invented label quietly sends
work to the wrong place.

This skill exists to settle those facts once, for any repository, and write them
down where later skills can read them. It is named for that job, not for a
single repository or account, and it must stay reusable: it configures whatever
repository it is run in rather than reproducing one repository's answers.

It should learn what it can by looking. The repository root and its remotes
reveal the provider and the coordinates for the common hosts, and it should
classify GitHub, GitLab, Azure DevOps, or a local custom tracker from that
evidence. Where inspection cannot settle a fact, it should ask the operator
rather than assume, and it should never fill in a provider, project, repository,
label, state, or domain value nobody supplied. A self-hosted host is recognized
only when the operator declares it, because inferring a provider from an
unfamiliar domain is how a bounded capability turns into an endless list of
special cases. A provider it does not support should be named plainly, together
with the configuration required to describe it as a local tracker instead.

The result should be three files: one describing the issue tracker in enough
detail that a later skill can resolve its tracker adapter without guessing, one
describing the repository's domain identity and where its authoritative
vocabulary lives, and one listing the available labels and states and what each
means. These are configuration for this repository, derived only from this
repository's own context. Nothing from another repository, and nothing private
or employer-specific, belongs in them, because the skill lives in an open-source
library.

Writing those files is the one place this skill changes anything, so the write
must be deliberate. It should show a complete preview that names every file and
every value before writing, and it should write only after an explicit
confirmation of that exact preview. It should refuse a target that escapes the
repository, that is reached through a symbolic link, or that is not an ordinary
file, and it should refuse to write over a target that changed after the preview
was shown. After writing, it should read the files back and report what is
actually on disk, so the outcome is proven rather than asserted. Re-running with
the same inputs should change nothing.

It must not touch the tracker itself. It does not open, close, label, assign, or
relate work items, and it does not implement or install the skills that will
later consume its files. It does not widen another skill's permissions. Setting
up the context and acting on the tracker are different jobs, and this skill only
does the first.
