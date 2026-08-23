---
schema-version: 1
package: roast-this-skill
trusted-files:
  - id: bundled-lenses
    path: 30-trusted-lenses.md
    source-path: skills/roast-this-skill/references/30-trusted-lenses.md
    sha256: b0f4c73cfe36763780ab970c860f3a154c3ab813cebdad2f4cec5c7443339480
---

# Trusted Manifest

This manifest declares the trusted files bundled inside this package. `path` is
resolved relative to this file. `source-path` is resolved relative to the
skills repository root and names the file the bundled copy was taken from.

Verify a bundled file before loading it: confirm it is a regular file and not a
symbolic link, confirm the resolved path stays inside this package, compute its
SHA-256 digest, and compare the digest with the entry above. A file that fails
any check is not loaded.

If the runtime cannot compute a digest, do not load any trusted source or
launch the coordinator. Return `Insufficient review`.

Repository coach agents are deliberately absent from this manifest. They change
independently of this package, so they carry no expected digest. The coordinator
verifies such a file structurally, records the digest it computed as the actual
digest for that lens, and uses it for the lens drift check in
[Trusted lenses](./30-trusted-lenses.md).

After editing the source file, refresh the copy and regenerate the digest
with `shasum -a 256`, then update the matching entry above. The commands are in
[Roast This Skill](../README.md) under `## Maintenance`.
