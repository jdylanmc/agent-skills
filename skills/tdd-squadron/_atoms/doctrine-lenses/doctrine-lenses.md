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
resolve the latest two supported major generations that the operator has
confirmed for that model family and runtime. Record the resolved generations
and eligible IDs. The operator-selected generations for this experiment are
currently GPT-6 and GPT-5.6. For the current runtime, the proven eligible IDs
are:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

Treat model IDs and generation labels as opaque runtime facts. Do not infer
that another provider's version numbers are comparable, preserve today's IDs
after they stop belonging to the resolved latest two supported generations, or
count aliases as independent model families.

Use this current illustrative default assignment only while those exact IDs
remain advertised, eligible, and suitable:

| Role | Selected model | Reasoning effort | Context tier |
| --- | --- | --- | --- |
| Red | `gpt-5.6-sol` | `high` | `default` |
| Green | `gpt-6-astra` | `high` | `default` |
| Roastmaster | `gpt-6-astra` | `xhigh` | `default` |
| Roaster 1 | `gpt-5.6-sol` | `xhigh` | `default` |
| Roaster 2 | `gpt-5.6-terra` | `xhigh` | `default` |
| Roaster 3 | `gpt-5.6-luna` | `xhigh` | `default` |
| Publication agent | `gpt-6-astra` | `high` | `default` |
| Slop Sniper | `gpt-6-astra` | `xhigh` | `default` |

For the current eligible set, apply these ordered choices per role:

| Role | Ordered eligible choices |
| --- | --- |
| Red | `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-6-astra` |
| Green | `gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` |
| Roastmaster | `gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` |
| Roaster 1 | `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-6-astra` |
| Roaster 2 | `gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-5.6-sol` -> `gpt-6-astra` |
| Roaster 3 | `gpt-5.6-luna` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-6-astra` |
| Publication agent | `gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` |
| Slop Sniper | `gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` |

For Red and Green, then separately for the three roasters, choose the first
runtime-advertised, generation-eligible, role-suitable ID in each row that is
not already selected in that group. When no unused suitable choice remains,
choose the first suitable choice in the row and mark the group's model variety
as degraded. This ordering is the package-local policy for the current
illustrative IDs, not a runtime resolver or a permanent model catalog. When the
resolved generations or eligible IDs change, require a human-confirmed updated
table rather than deriving cross-provider order from version strings.

This assignment preserves one persistent two-person Red/Green pair and one
four-seat Roast. Reusing `gpt-6-astra` for several distinct roles does not make
those roles one agent, while three GPT-5.6 aliases do not prove three
independent model families. Prefer exact-model diversity where the choreography
allows it, but choose each model for its role rather than maximizing alias
count.

Every dispatched role packet records:

- resolved generation labels and the complete eligible-ID inventory;
- role and seat;
- preferred ID and ordered eligible choices;
- actual chosen ID, or `none`;
- fallback reason, or `none`;
- reasoning effort and context tier;
- diversity group (`red-green`, `roasters`, or `not-applicable`);
- intended and actual distinct-ID counts for that group; and
- `degraded_model_variety: true|false` with a non-empty reason when true.

The run-level comparison record retains those role receipts, so a fallback or
collapsed variety cannot disappear after dispatch. An unavailable selected
model may fall back only through the role's ordered choices. Never silently use
a mini, flash, older-generation, runtime-default, or otherwise unproven model
to save cost. If availability, generation membership, role suitability, or an
eligible ordered fallback cannot be proven, record `actual chosen ID: none`,
stop before dispatch, and return the observed IDs and the exact human choice
required.

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
