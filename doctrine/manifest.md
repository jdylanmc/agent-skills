---
schema-version: 1
doctrine:
  - id: code
    path: code.doctrine.md
    sha256: 0a5239b9a3c57e8651d40de68bc4a0fee1f7cdbe0029b9c044ee209e3f817832
  - id: domain
    path: domain.doctrine.md
    sha256: 567b44352a54acb9bd6224de03862f8e49a52de33a7de19ce517de7200528caf
  - id: pragmatic
    path: pragmatic.doctrine.md
    sha256: f0ce2d9c9c9f337a69049e6ddb49c08e5e0550615ecc7f525bea6a8799569301
  - id: data
    path: data.doctrine.md
    sha256: bdc287409bc2cf0890e3e641118919f946732bd4319fe57bd99e6f80fb2bd05d
  - id: testing
    path: testing.doctrine.md
    sha256: 02661877aa625b3b2bfd1af1c8733550fabe886e19ae82c2d873a5ce020688aa
---

# Doctrine Manifest

This manifest defines the canonical trusted doctrine set. Resolve doctrine
paths relative to this file, reject symlinks and path escapes, and verify each
SHA-256 digest before loading guidance.
