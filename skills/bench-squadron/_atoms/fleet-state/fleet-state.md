---
name: fleet-state
description: Validate a Bench Squadron proposal against the current Ship With Squadron Fleet State without composing another skill's local unit.
level: atom
allowed-tools: ["execute"]
includes: ["bench-squadron/_atoms/fleet-state/fleet-state.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Fleet State

## Required Files

1. [Fleet State adapter](./fleet-state.mjs)

Use the current `ship-with-squadron` Fleet State validator as a code dependency
to validate the supplied persisted control record and manifest before a bench
proposal is accepted. The adapter does not compose a unit owned by another
skill, create a second control record, or write Fleet State. The owner of the
current Fleet State transition performs any durable write after it receives the
validated proposal binding.

The proposal carries the exact `fleetStateRevision`; a different revision is
stale even when its other contents are valid.
