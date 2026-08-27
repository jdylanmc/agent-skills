---
name: session-evidence-adapter
description: Select the adapter for the agent harness a session ran in, return raw session evidence as one provider-neutral bounded ledger, and answer an unrecognized harness with a stated gap and a PROPOSED adapter recommendation rather than a guessed parser. Read only, applies nothing.
level: atom
allowed-tools: ["execute"]
includes: ["post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.mjs"]
composes: []
used-by: ["post-mortem/_molecules/evidence-assemble/evidence-assemble.md","post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md"]
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
| `harness` | no | An opaque identity for the runtime, matching a registered adapter or one of its aliases. |
| `session-id` | no | The runtime's identifier for the session. |
| `explicit-path` | no | A session log path the operator or runtime named. |
| `transcript-path` | no | An exact transcript path the runtime supplied. |
| `session-root` | no | Where sessions live, when the runtime did not name it. |

## Operation

```text
node <atoms>/session-evidence-adapter.mjs [--harness <id>] [--session-id <id>]
    [--path <log>] [--transcript <path>] [--session-root <path>] [--providers]
    [--correlate <run-log>]
```

The seam selects an adapter, asks it to establish which log belongs to this
session, reads that log through the adapter, and certifies the result against
the ledger contract before returning it. Every outcome is reportable evidence:
`collected`, `unavailable`, or `unsupported`.

`--correlate` additionally replays one selected Skill Run Log read-only and
returns the correlation verdict beside the evidence, which is how a caller gets
a decision rather than two sets of identifiers to compare by hand.

## Provider Selection

A named harness selects its adapter by identity or alias. An unnamed harness may
be detected from the runtime environment, but only when exactly one adapter
recognizes it; two claimants is `provider_ambiguous` and nothing is read.

Registered adapters today:

| Adapter | Harness names |
| --- | --- |
| `copilot` | `copilot`, `copilot-cli`, `github-copilot`, `github-copilot-cli` |

A harness name is a label, so every alias in that table resolves to its
adapter's identity before anything is published or correlated. Two names for one
runtime are one harness, never two sessions, and the identity that reaches the
ledger and every correlation is always the adapter's own.

Registration lives here, in the seam's own implementation. An adapter is a
detail of how this seam does its job rather than a step in the workflow, so no
molecule composes an adapter directly and nothing above the seam names one.

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
`session_ended`, `session_aborted`, `context_compaction_started`,
`context_compaction_completed`, `runtime_error`, `runtime_warning`,
`tool_failure`, `subagent_started`, `subagent_ended`, `skill_invoked`,
`permission_denied`.

A compaction has a distinct beginning and end so one compaction is one pair of
entries rather than the same fact counted twice.

Nothing downstream reads `provider_native`. It exists so a reader can see the
harness's own accounting beside the neutral one, not so a consumer can key on it.

## The Contract Is Checked, Not Assumed

Before a ledger is returned it is certified: the version, the provider, the
completeness and its cap, whole-number counts for every neutral metric, an
anchor and a vocabulary kind on every entry, a stable code on every limitation,
and a source whose identity is opaque rather than a filesystem path. Entry
details are checked to the leaf: a value is a scalar or one level of nested
object, a string is bounded and may not be a path, a list is refused as a
payload in disguise, and a forbidden name - content, prompt, result, output,
stack, transcript, and the rest - is refused wherever it appears, however deeply
it is nested. Skill entries are checked the same way, and `provider_native` may
carry counts and nothing else - under keys that are themselves short, safe
names, so a harness cannot publish a path or a credential by using it as a
label. The published `harness` must be the adapter's own identity rather than
an alias. A ledger that fails is refused as `ledger_contract_violation`,
whichever adapter produced it, including this repository's own.

That check is what makes adapters substitutable. A future adapter is correct
when it passes the same certification, not when it looks similar.

## Correlation With a Skill Run Log

When a Skill Run Log records the harness and session it ran inside, the seam
matches it to session evidence by those recorded identities, and reports
`same-session`, `different-session`, or `unknown`. Adjacent timestamps never
establish correlation. A log with no recorded correlation is `unknown`, which is
a fact about the log rather than a mismatch.

Harness names are canonicalized on both sides first, so an alias never looks
like a different runtime.

A replay that reported a defect about identity - the run changed the session it
claims, a record belongs to another run, the root skill drifted - is `unknown`
whatever the identifiers say. The log's own account of what it belongs to is
the thing in doubt, so it cannot be the evidence that settles the question.

Session evidence whose own identity is contested - the log claimed one session
while another was proved, or the recorded identity could not be published - is
`unknown` for the same reason, from the other side.

A harness label that changed inside one run log is not an identity defect and
never was: resolving two names for one runtime is this seam's job, and Chronicle
reports every label it saw so the resolution happens here, where the adapters
are known.

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
