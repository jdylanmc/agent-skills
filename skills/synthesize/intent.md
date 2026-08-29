# Intent: synthesize

## What this is for

Turn one artifact into a smaller one on purpose, without lying about what got
smaller.

Sometimes a document is correct and complete and still too large for the place
it has to live. A full specification is the right size for the people who build
against it and the wrong size for the one line of settled product intent a human
must keep authoritative. Bounded synthesis is the act of producing that smaller
variant deliberately: read one identified source, write one profile-defined
variant, and account for every difference between them.

This is not summarization. Summarization is allowed to be lossy and is judged by
whether it reads well. Bounded synthesis is judged by whether meaning survived,
and it is allowed to refuse.

## Why one source and one named profile, both explicit

A synthesis run takes exactly one source and exactly one named profile, and it
infers neither. The source is one identified, revision-bound artifact, so a
later run can prove it read the same bytes and not a newer draft that quietly
changed underneath it. The profile is named out loud, because a profile is a
contract about what the smaller variant must contain, how large it may be, and
what may never be dropped. Letting the run guess "the obvious profile" is how a
specification gets condensed under someone else's rules without anyone choosing
them. A caller who will not name the profile has not selected one.

## Why a disclosure ledger exists

A shorter artifact that hides what it dropped is worse than a longer one,
because the longer one is at least honest about its own size. The danger of
condensing is not that meaning is lost — meaning is sometimes rightly left out —
it is that meaning is lost silently, and the reader of the smaller artifact
never learns there was more.

So every synthesis run carries a disclosure ledger: an account of each
meaningful thing in the source and what happened to it — kept, merged, reworded,
or dropped — traced back to the exact source material and forward to the exact
variant text. The ledger is what makes a smaller artifact trustworthy. It does
not prove meaning was preserved; it proves nothing was changed off the record.

## Why refusing beats degrading

When the required meaning genuinely will not fit the profile's limit, the honest
answer is to stop and say so, and to propose how the material could be split
into cohesive pieces. The dishonest answers are all the ways of pretending it
fit: truncating the tail, moving the authoritative part into the companion
document so the smaller one looks complete, or folding an acceptance criterion
into a vaguer sentence until it stops being checkable. A refusal that names the
problem and proposes a real boundary is a better outcome than a variant that
silently no longer means what the source meant.

## Why a generated variant is only a candidate

Nothing this skill produces is approved. A machine can check that the words fit,
that every claim traces to the source, and that no defect of a named kind is
present, and all of that is worth doing — but none of it is a human deciding the
smaller artifact says the right thing. The variant is a candidate. It stays a
candidate until a person reviews it and approves it. This skill never signs its
own work.

## Why nano authority is never weakened to fit

The first profile produces a candidate nano specification from a full one. The
nano document is the small, settled statement of product intent a human keeps
authoritative. Its whole value is that it is exact. Weakening one of its
acceptance criteria to save words would trade away the one property that makes
it worth keeping. If the intent does not fit, that is a signal to split it, not
to blur it.

## Why the limit is a real constraint

The nano profile is bounded at five hundred words, and that number is a product
constraint, not a formatting preference. A nano specification exists to be read
quickly and held in mind; past a certain size it stops doing that job and
becomes a second full document. The limit is counted over the whole document —
every heading, marker, and link — because a limit that ignored part of the text
could always be met by moving text into the ignored part.

## What this is not

Authoring the source specification is somebody else's job. So are reviewing the
candidate, roasting it, granting it approval, publishing it to a tracker,
implementing it, shepherding it, and merging it. This skill converts one
identified artifact into one candidate variant and accounts for the difference.
Everything that decides whether the candidate is good, and everything that acts
on it, happens somewhere else and by someone else.
