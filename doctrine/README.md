# Engineering Doctrine

Doctrine files are this repository's source of truth for how software should be
shaped. They state reasoned engineering positions - for example, that a unit
test asserts behavior rather than implementation - which skills apply
systematically so that review is consistent rather than a matter of whoever is
looking.

- `code.doctrine.md`
- `domain.doctrine.md`
- `pragmatic.doctrine.md`
- `data.doctrine.md`
- `testing.doctrine.md`

## Authorship

Doctrine is written by humans. An agent must not create, edit, reword, or delete
a doctrine file, or change a `manifest.md` entry, unless the operator explicitly
asks for that specific change. An agent may always argue in prose that a rule is
wrong, missing, or ambiguous; it may not act on that opinion by editing the file.

Because doctrine is applied systematically, editing a rule changes the outcome
of every review that rule touches, including work already reviewed under the
previous wording. Treat a doctrine edit as the highest-consequence change in the
repository and make it deliberately.

Git history is the changelog. There are no version fields, changelog files, or
per-rule revision metadata, and none should be added.

## Integrity

`manifest.md` defines the canonical file identities and integrity hashes. After
editing a doctrine file, run `shasum -a 256 doctrine/<id>.doctrine.md` from the
repository root and replace the matching digest in `manifest.md`.

The digest is a tamper boundary, not a review. It proves a file is the one the
manifest names, so a consumer refuses to load doctrine it cannot verify. It says
nothing about whether the change was a good idea. Re-hashing an edit is not
approval of it.

## Applying doctrine

- use only rules relevant to the current task and reviewer lens;
- treat repository evidence and requirements as authoritative;
- cite the exact rule a recommendation came from, never doctrine in general;
- report only what the supplied evidence grounds, and carry a confidence,
  because these positions are opinionated and not always decidable by
  inspection;
- produce recommendations for a human to weigh. Applying doctrine does not
  automatically pass or block anything;
- arbitrate overlap explicitly rather than loading every rule indiscriminately.
