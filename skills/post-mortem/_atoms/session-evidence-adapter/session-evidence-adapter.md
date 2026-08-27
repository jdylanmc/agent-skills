---
name: session-evidence-adapter
description: Select the adapter for the agent harness a session ran in, return raw session evidence as one provider-neutral bounded ledger, and answer an unrecognized harness with a stated gap and a PROPOSED adapter recommendation rather than a guessed parser. Read only, applies nothing.
level: atom
allowed-tools: ["execute"]
includes: ["post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.mjs"]
composes: []
used-by: ["post-mortem/_molecules/evidence-assemble/evidence-assemble.md"]
---

# Session Evidence Adapter Seam

A post-mortem is about a session, not about a product. Every agent harness
records a session differently, so the harness-specific part lives in one adapter
behind this seam, and everything downstream reads the common ledger this unit
defines.

That separation is the point. Diagnosis, proposals, and the rendered record
never learn a harness's event names, so adding a second harness later changes
one adapter rather than the whole package.

## Required Files

1. [Adapter seam](./session-evidence-adapter.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `harness` | no | An opaque identity for the runtime, such as `copilot-cli`. |
| `session-id` | no | The runtime's identifier for the session. |
| `explicit-path` | no | A session log path the operator or runtime named. |
| `transcript-path` | no | An exact transcript path the runtime supplied. |
| `session-root` | no | Where sessions live, when the runtime did not name it. |

## Operation

```text
node <atoms>/session-evidence-adapter.mjs [--harness <id>] [--session-id <id>]
    [--path <log>] [--transcript <path>] [--session-root <path>] [--providers]
```

The seam selects an adapter, asks it to establish which log belongs to this
session, reads that log through the adapter, and certifies the result against
the ledger contract before returning it. Every outcome is reportable evidence:
`collected`, `unavailable`, or `unsupported`.

## Provider Selection

A named harness selects its adapter by identity or alias. An unnamed harness may
be detected from the runtime environment, but only when exactly one adapter
recognizes it; two claimants is `provider_ambiguous` and nothing is read.

Registered adapters today:

| Adapter | Harness names |
| --- | --- |
| `copilot` | `copilot`, `copilot-cli`, `github-copilot`, `github-copilot-cli` |

There is no generic fallback parser, deliberately. A parser guessed from an
unfamiliar format would publish confident evidence nobody validated, which is
the failure this seam exists to prevent.

## The Common Evidence Ledger

Every adapter returns the same shape:

| Field | Meaning |
| --- | --- |
| `ledger_version` | The contract version this ledger satisfies. |
| `provider`, `harness` | Which adapter produced it, and which runtime it read. |
| `source` | Evidence kind, opaque log identity, session identity, and how identity was established. |
| `completeness`, `confidence_cap` | The declared boundary and the cap it imposes. |
| `counts` | Neutral metrics: operator and agent messages, turns started and completed, tool calls and failures, subagent calls and failures, skill invocations, runtime errors. |
| `entries` | Anchored events in the neutral vocabulary. |
| `skills` | Skill invocations with their anchors, sources, triggers, and enclosing subagent. |
| `limitations` | Every stated limit on what can be concluded. |
| `provider_native` | The harness's own counts, namespaced, for transparency only. |

The neutral vocabulary is fixed: `session_started`, `session_resumed`,
`session_ended`, `session_aborted`, `context_compacted`, `runtime_error`,
`runtime_warning`, `tool_failure`, `subagent_started`, `subagent_ended`,
`skill_invoked`, `permission_denied`.

Nothing downstream reads `provider_native`. It exists so a reader can see the
harness's own accounting beside the neutral one, not so a consumer can key on it.

## The Contract Is Checked, Not Assumed

Before a ledger is returned it is certified: the version, the provider, the
completeness and its cap, whole-number counts for every neutral metric, an
anchor and a vocabulary kind on every entry, a stable code on every limitation,
and no raw content field on any entry detail. A ledger that fails is refused as
`ledger_contract_violation`, whichever adapter produced it, including this
repository's own.

That check is what makes adapters substitutable. A future adapter is correct
when it passes the same certification, not when it looks similar.

## Correlation With a Skill Run Log

When a Skill Run Log records the harness and session it ran inside, the seam
matches it to session evidence by those recorded identities, and reports
`same-session`, `different-session`, or `unknown`. Adjacent timestamps never
establish correlation. A log with no recorded correlation is `unknown`, which is
a fact about the log rather than a mismatch.

## An Unknown Harness Is a Stated Gap

An unrecognized harness returns:

- the limitation `unsupported_provider`, so the post-mortem records that raw
  session evidence was unavailable and why; and
- one `PROPOSED` reinforcement recommendation naming the missing adapter, what
  it would have to read, its evaluator, its disconfirming observation, and its
  validation requirements with `human_approval_required: true`.

The recommendation is data. This unit writes nothing, spawns nothing, and
invokes nothing. A person approves the proposal, a separate `reinforce-skill`
run adds the adapter, and only then can a later post-mortem read that harness.
Self-modification is not a shortcut this seam is permitted to take, and an
unread harness never becomes a reason to lower a boundary instead.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `collected`, `unavailable`, or `unsupported`. |
| `provider`, `harness` | The adapter used, and the harness it was chosen for. |
| `ledger` | The common evidence ledger, or `null`. |
| `limitations` | Why evidence is missing or limited, each with a stable code. |
| `recommendation` | The `PROPOSED` adapter proposal, when the harness is unsupported. |

## Guarantees

- One vocabulary downstream, whatever the harness.
- No adapter's output is trusted until it passes the ledger contract.
- An unknown harness produces a gap and a proposal, never a guessed parser.
- Nothing is written, invoked, or applied here.

## Boundaries

This unit routes and certifies. It parses nothing itself, forms no finding,
judges no severity, and holds no authority to add an adapter to itself.

**Error recovery.** Every failure path returns a limitation with a stable code
and no ledger, and the post-mortem continues on the evidence it can already see.
