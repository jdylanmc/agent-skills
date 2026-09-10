---
name: doctrine-lenses
description: Bind every TDD Squadron role packet to assigned full doctrine text, its canonical manifest binding, and an explicit current-runtime model assignment.
level: atom
allowed-tools: ["read","search","execute"]
includes: ["tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.mjs"]
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# Doctrine Lenses

## Required Files

1. [TDD policy adapter over shared model routing](./doctrine-lenses.mjs)

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

Before dispatch, inspect the exact model IDs the current runtime advertises.
The operator confirms and records the latest two supported major generations,
eligible IDs, and role suitability. This experiment's existing policy is GPT-6
and GPT-5.6; its defaults and ordered choices now live in `doctrine-lenses.mjs`.
If those are no longer current, stop for a human-confirmed policy update. Never
infer cross-provider generation order or accept an unproven model.

Run:

```text
node <doctrine-lenses>/doctrine-lenses.mjs --stdin
```

Supply `runtimeAvailableModels` as an observed array of exact IDs. Optional
`roleOverrides` are human-confirmed changes keyed by `red`, `green`,
`roastmaster`, `roaster-1` through `roaster-3`, `publication-agent`, or
`slop-sniper`. Only `model`, `fallbackModels`, `reasoningEffort`, and
`contextTier` are accepted. These are model slots, not agent identities, leases,
or authority to replace persistent workers.

The script uses shared `resolveEligibleModelRoute` for selection and fallbacks.
Within `red-green`, then separately within `roasters`, it first requests a route
using unused model IDs. If none is available for that role, it uses the full
ordered choices and records degraded exact-model variety. All choices remain
inside the caller-confirmed eligible set; it never invents a fallback.

Keep the output in the run comparison record and the relevant role packets:

- `assignments`: exact dispatch `route`, shared `receipt` (preferred model,
  ordered fallbacks, selected model, effort, and context), `diversityGroup`,
  `selectionBasis`, and `fallbackReason`.
- `modelVariety`: intended and actual distinct-ID counts, degradation and its
  reason for each group; shared `familyDiversity` is reported separately.
- Eligible and observed model inventories, plus `unavailableRoles`.
- Red/Green `dispatchMode: background`, required for persistent follow-ups.
  Bootstrap without candidate writes and prove an addressed follow-up for each
  runtime ID before the atomic reservation. Model routing alone is not that proof.

Exit `0` with `status: resolved` proves routing only, not human confirmation,
doctrine integrity, reservations, launch, or running state. Exit `1` with
`status: unavailable` retains the receipts and null routes; stop before dispatch
and return the observed IDs and exact human choice required. Invalid input exits
`1` with a JSON error on standard error. Never hand-write replacement receipts,
use runtime defaults, or silently choose weaker models.

One persistent two-person Red/Green pair and one four-seat Roast remain
unchanged. Repeated model IDs do not merge agent identities; distinct aliases
do not prove independent model families. Use the ordinary context tier by
default, increasing it only when the full bounded packet does not fit and
recording the reason. Never truncate, summarize, or omit a lens or apply blanket
`long_context` or maximum effort. Conserve resources through bounded slices,
the fixed pair, the fixed four-seat Roast, and one-shot audits.
