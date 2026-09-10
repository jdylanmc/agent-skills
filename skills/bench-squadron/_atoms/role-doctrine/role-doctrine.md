---
name: role-doctrine
description: Require complete role doctrine lenses and an explicit current-runtime model assignment for the Bench Squadron orchestrator, delivery pool, and Slop Sniper before an experiment proceeds.
level: atom
allowed-tools: ["read","execute"]
includes: ["bench-squadron/_atoms/role-doctrine/role-doctrine.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Role Doctrine

## Required Files

1. [Bench policy adapter over shared model routing](./role-doctrine.mjs)

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

## Model Assignment

Before dispatch, inspect the exact model IDs the current runtime advertises.
The human confirms generation eligibility and role suitability; the resolver
cannot establish either. This experiment's existing policy is GPT-6 and GPT-5.6.
Its four eligible IDs and role defaults now live in `role-doctrine.mjs`, not a
second selection table here. If those are no longer the latest two major
generations that the operator has confirmed, stop for a policy update rather
than infer new IDs or comparable version numbers across providers.

Run the existing role atom's support script:

```text
node <role-doctrine>/role-doctrine.mjs --stdin
```

Supply one JSON object:

| Field | Meaning |
| --- | --- |
| `deliveryPoolSize` | The confirmed pool size, 1 through 5. These are model slots, not agent identities or reservations. |
| `runtimeAvailableModels` | Required array of exact advertised IDs. An empty array means none are available, not a runtime default. |
| `roleOverrides` | Optional human-confirmed route changes keyed by `orchestrator`, `delivery-1` through the configured pool size, or `slop-sniper`. Only `model`, `fallbackModels`, `reasoningEffort`, and `contextTier` are accepted. |

Fallback lists are empty by default. Supply an ordered list only after the
operator confirms those eligible models suit that role. Never silently use a
mini, flash, older-generation, runtime-default, or otherwise unproven model.
Use the ordinary context tier by default; increase it only when the bounded
packet and complete lenses do not fit, recording the reason for that role.
Do not truncate, summarize, or omit a lens, apply blanket `long_context`, or
weaken roles to save cost. Preserve the existing pool cap, quorum, and bounded
task packets.

The adapter calls shared `resolveEligibleModelRoute` over `resolveInlineModelRoute`
for each slot and `summarizeModelDiversity` for the delivery pool. It does not
duplicate eligibility checks, fallback selection, or family classification.
Keep the returned `assignments` and shared
`receipt` fields in the role packets; pass each exact `route` to the existing
runtime dispatch. The repeated fifth-seat model remains a separate slot, not a
claim of another independent family.

Exit `0` returns `status: resolved`, the eligible and observed model inventories,
assignments, and delivery diversity. This proves route resolution only, not
doctrine completeness, human approval, reservations, launch, or running state.
Exit `1` with `status: unavailable` retains every receipt and names
`unavailableRoles`; stop before dispatch and return the observed IDs and the
exact human choice required. Invalid input exits `1` with a JSON error on
standard error. Do not hand-write replacement receipts or bypass an unavailable
slot by letting the runtime choose a default.
