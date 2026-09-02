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
    sha256: c9c7ebbbbe22b408ded5ef77d630a7ba09c7051040646e3d1c78528d3c1e88d0
  - id: data
    path: data.doctrine.md
    sha256: bdc287409bc2cf0890e3e641118919f946732bd4319fe57bd99e6f80fb2bd05d
  - id: testing
    path: testing.doctrine.md
    sha256: 02661877aa625b3b2bfd1af1c8733550fabe886e19ae82c2d873a5ce020688aa
  - id: laziness
    path: laziness.doctrine.md
    sha256: b1344f70fb34e840665ba02587e7a1ebff4d734ffd146badecace53b5492135f
  - id: documentation
    path: documentation.doctrine.md
    sha256: 54a88537818b03546edc460fc29988141e500a37a2c604f718ea15051af11040
  - id: machine
    path: machine.doctrine.md
    sha256: 05454474f4ad2fbfbd7193abf2a1f9684805addecc51e58a17153687bcf1f90d
  - id: scout
    path: scout.doctrine.md
    sha256: ae5c1c3da548a1a6b4970560aa4f5ed1dc4d344ed615db5e801ccbd33160c057
  - id: debugging
    path: debugging.doctrine.md
    sha256: 578d434e712bde7a8dfd69396024f2e89d8df647dc1174273fb37f9bfd6ed46c
  - id: context
    path: context.doctrine.md
    sha256: 0017ce9b4aa3a7654a09d3fe4d79a990642020b72987ebc5dbcedc6c9882f88b
---

# Doctrine Manifest

This manifest defines the canonical trusted doctrine set. Resolve doctrine
paths relative to this file, reject symlinks and path escapes, and verify each
SHA-256 digest before loading guidance.
