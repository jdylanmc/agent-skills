# Engineering Doctrine

Doctrine files are canonical collections of software-engineering industry best
practices that skills and agents may reference selectively:

- `code.doctrine.md`
- `domain.doctrine.md`
- `pragmatic.doctrine.md`
- `data.doctrine.md`
- `testing.doctrine.md`

`manifest.md` defines the canonical file identities and integrity hashes.
After editing a doctrine file, run
`shasum -a 256 doctrine/<id>.doctrine.md` from the repository root and replace
the matching digest in `manifest.md`.

When applying doctrine:

- use only rules relevant to the current task and reviewer lens;
- treat repository evidence and requirements as authoritative;
- cite doctrine as decision guidance, never as proof of a code defect;
- arbitrate overlap explicitly rather than loading every rule indiscriminately.
