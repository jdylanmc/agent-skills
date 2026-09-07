---
name: doctrine-lenses
description: Bind every TDD Squadron role packet to assigned full doctrine text, its canonical manifest binding, and an explicit current-runtime model assignment.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# Doctrine Lenses

For every Red, Green, Roastmaster, roaster, publication agent, and Slop Sniper
dispatch, read the canonical doctrine manifest and record its revision and
digest. Resolve each role's assigned doctrine entries only through that
manifest, then include the complete, unabridged text of each assigned doctrine
in the role packet alongside its manifest binding.

Reject a packet when any assigned text is unavailable, its digest does not
match, or its manifest revision differs from the recorded dispatch binding.
Never replace full text with excerpts, links, summaries, or inferred rules.
The lenses prime role-specific reasoning; they neither act as a compliance
checklist nor grant approval, scope, risk, merge, promotion, or retirement
authority.

## Model Assignment

Before dispatch, inspect the exact model IDs the current runtime advertises and
select from the latest two major generations that the operator has confirmed
for that model family and runtime. Record the eligible IDs, each role's selected
ID, reasoning effort, and context tier in the role packet. The
operator-selected generations for this experiment are GPT-6 and GPT-5.6. For
the current runtime, the proven eligible IDs are:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

Treat model IDs and generation labels as opaque runtime facts. Do not infer
that another provider's version numbers are comparable, call these generations
permanently "latest", or count aliases as independent model families.

Use this assignment when those exact IDs remain available:

| Role | Selected model | Reasoning effort | Context tier |
| --- | --- | --- | --- |
| Red | `gpt-5.6-sol` | `high` | `default` |
| Green | `gpt-6-astra` | `high` | `default` |
| Roastmaster | `gpt-6-astra` | `xhigh` | `default` |
| Roaster seats 1 through 3 | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `xhigh` | `default` |
| Publication agent | `gpt-6-astra` | `high` | `default` |
| Slop Sniper | `gpt-6-astra` | `xhigh` | `default` |

This assignment preserves one persistent two-person Red/Green pair and one
four-seat Roast. Reusing `gpt-6-astra` for several distinct roles does not make
those roles one agent, while three GPT-5.6 aliases do not prove three
independent model families. Prefer exact-model diversity where the choreography
allows it, but choose each model for its role rather than maximizing alias
count.

An unavailable selected model may fall back only to another runtime-advertised
ID that the operator has confirmed belongs to one of these two generations and
is suitable for that role. Never silently use a mini, flash, older-generation,
runtime-default, or otherwise unproven model to save cost. If availability,
generation membership, or an eligible fallback cannot be proven, stop before
dispatch and return the observed IDs and the exact human choice required.

Use the runtime's ordinary context tier by default. Increase it only when the
bounded role packet, including every complete assigned doctrine lens, does not
fit; record that reason for the affected role. Never truncate, summarize, or
omit a lens to reduce context, and do not apply blanket `long_context` or
maximum reasoning effort. Conserve resources through bounded slices, the fixed
pair, the fixed four-seat Roast, and one-shot audits, never through weaker
implementers or reviewers.

Keep this policy package-local until the shared agent-spawn resolver is
available. Its future integration seam is the recorded runtime inventory and
per-role selection; do not copy or anticipate the resolver's fallback or model
catalog implementation here.
