---
name: role-doctrine
description: Require complete role doctrine lenses and an explicit current-runtime model assignment for the Bench Squadron orchestrator, delivery pool, and Slop Sniper before an experiment proceeds.
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

## Model Assignment

Before dispatch, inspect the exact model IDs the current runtime advertises and
select from the latest two major generations that the operator has confirmed
for that model family and runtime. Record the eligible IDs, the selected ID for
every role, the reasoning effort, and the context tier in the role packet. The
operator-selected generations for this experiment are GPT-6 and GPT-5.6. For
the current runtime, the proven eligible IDs are:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

Treat model IDs and generation labels as opaque runtime facts. Do not infer
that another provider's version numbers are comparable, call these generations
permanently "latest", or count aliases as independent model families.

Use this role assignment when those exact IDs remain available:

| Role | Selected model | Reasoning effort | Context tier |
| --- | --- | --- | --- |
| Orchestrator | `gpt-6-astra` | `high` | `default` |
| Delivery-pool seats 1 through 5 | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-5.6-sol` | `high` | `default` |
| Slop Sniper | `gpt-6-astra` | `xhigh` | `default` |

The repeated fifth-seat model is intentional: four eligible aliases do not
become five independent families. Prefer exact-model diversity until the
eligible set is exhausted, but choose each role for the work it performs rather
than maximizing alias count.

An unavailable selected model may fall back only to another runtime-advertised
ID that the operator has confirmed belongs to one of these two generations and
is suitable for that role. Never silently use a mini, flash, older-generation,
runtime-default, or otherwise unproven model to save cost. If availability,
generation membership, or an eligible fallback cannot be proven, stop before
dispatch and return the observed IDs and the exact human choice required.

Use the runtime's ordinary context tier by default. Increase it only when the
bounded packet, including every complete assigned doctrine lens, does not fit;
record that reason for the affected role. Do not truncate, summarize, or omit a
lens to reduce context, and do not apply blanket `long_context` or maximum
reasoning effort. Conserve resources through the existing pool cap, quorum, and
bounded task packets, never by weakening delivery or audit roles.

Keep this policy package-local until the shared agent-spawn resolver is
available. Its future integration seam is the recorded runtime inventory and
per-role selection; do not copy or anticipate the resolver's fallback or model
catalog implementation here.
