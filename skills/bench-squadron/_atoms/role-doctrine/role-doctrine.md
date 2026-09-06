---
name: role-doctrine
description: Require complete role doctrine lenses for the Bench Squadron orchestrator, delivery pool, and Slop Sniper before an experiment proceeds.
level: atom
allowed-tools: ["read"]
includes: []
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Role Doctrine

Provide the full text of the applicable doctrine lens to each role:

| Role | Required full-text lens | Authority |
| --- | --- | --- |
| Orchestrator | Coordination, state-binding, and human-boundary doctrine | Coordinates only; does not sign delivery proposals. |
| Delivery-pool agent | Confirmed-scope delivery and evidence doctrine | May provide one proposal signature; does not decide human boundaries. |
| Slop Sniper | Its full audit doctrine and sealed checkpoint | Asynchronous, read-only audit; never signs, mutates, or publishes. |

An identifier, title, digest, excerpt, summary, or hyperlink is not a
full-text lens. Missing or partial doctrine is a publication gate failure.
Doctrine informs evidence evaluation; it cannot grant scope, risk, approval,
merge, promotion, or retirement authority.
