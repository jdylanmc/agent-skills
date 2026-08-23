---
name: doctrine-select
description: Choose which canonical doctrine governs a classified artifact, honor an explicit caller override, return the selection with its reasoning, and refuse rather than default when nothing governs the target.
level: atom
allowed-tools: ["execute"]
includes: ["roast/_atoms/doctrine-select/doctrine-select.mjs"]
composes: []
used-by: ["roast/_molecules/roast-target-intake/roast-target-intake.md"]
---

# Doctrine Select

Decide which doctrine governs the thing being roasted, and say why.

This is the step the roast pipeline was missing. `artifact-classify` identifies
the packet and `doctrine-evaluate` evaluates a packet against a selection, but
nothing chose the selection. Without this step the choice happens implicitly,
inside whichever document happened to name a doctrine, and a surprising finding
cannot be traced back to the guidance that produced it.

## Required References

1. [Doctrine selection implementation](./doctrine-select.mjs)

## Placement

This unit is **local to `/roast`**, not shared.

ADR 0001 keeps a unit local until a second consumer exists. `/roast` is the
only consumer today. `skill-coach` and `agent-whisperer` will plausibly want the
same selection step, and when one of them actually composes it the unit earns
promotion to `_base`. Moving it there now, on the strength of that expectation,
is precisely the premature abstraction the rule exists to prevent: the second
consumer is the evidence, and it does not exist yet.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `--manifest` | yes | Absolute path to `doctrine/manifest.md`. Read for canonical identifiers only. |
| `--type` | no | The classified artifact type: `agent`, `prompt`, `skill`, or `code`. |
| `--select` | no | An explicit doctrine identifier. Repeatable. Overrides inference entirely. |
| `--trigger` | no | A trigger the caller observed in the packet. Repeatable. Enables a conditional doctrine. |

Supply `--type`, `--select`, or both. With both, the explicit selection wins
and the inferred one is reported as unused.

## Governing Map

| Artifact type | Always selected | Selected only on an observed trigger |
| --- | --- | --- |
| `agent` | `code`, `pragmatic` | `domain` on `domain-model`; `data` on `data-contract` |
| `prompt` | `pragmatic`, `code` | `domain` on `domain-model`; `data` on `data-contract` |
| `skill` | `pragmatic`, `code` | `domain` on `domain-model`; `data` on `data-contract`; `testing` on `validation` |
| `code` | `code`, `pragmatic` | `testing` on `validation`; `data` on `data-contract`; `domain` on `domain-model` |

The conditional column is how this unit satisfies the repository rule that
overlap between doctrine files is resolved explicitly. Without it the only
honest options are to select every plausible doctrine, which is the
indiscriminate loading that rule forbids, or to drop guidance that genuinely
applies.

## Operation

```text
node <atoms>/doctrine-select/doctrine-select.mjs \
  --manifest "$manifest_path" \
  [--type <agent|prompt|skill|code>] \
  [--select <id>]... \
  [--trigger <name>]...
```

Exit `0` is a selection, `2` is a refusal, and `1` is a usage or input failure.
Check availability with `--probe`. Any usage failure prints the full flag list.

Argument handling deliberately mirrors `doctrine-evaluate`'s `parseArguments`,
because the two atoms sit next to each other in one pipeline and a caller uses
them together. An unknown flag, a repeated single-valued flag, and a flag given
without a value are each rejected rather than ignored. `--select` and
`--trigger` repeat; `--manifest` and `--type` do not.

The only intentional divergence is which flags repeat: `doctrine-evaluate`
repeats `--select` alone, while this atom also repeats `--trigger`, because a
caller genuinely names several observed triggers.

Silent argument loss would be worse here than a wrong answer. A typo'd override
such as `--slect testing` would be discarded, the atom would fall back to
inference, and it would still report `source: inferred` as though that had been
intended — leaving a surprising roast untraceable to the doctrine that produced
it, which is the one thing this atom exists to make possible.

| Category | Meaning |
| --- | --- |
| `usage` | The command line is malformed: an unknown argument, a repeated single-valued flag, a flag without a value, or a missing `--manifest`. |
| `unsafe_path` | The manifest path was relative, traversed upward, was a symbolic link, or was not a regular file. |
| `invalid_manifest` | The manifest has no parsable frontmatter, declares no identifier, or repeats one. |

## Output

| Field | Meaning |
| --- | --- |
| `status` | `Selected` or `Refused`. |
| `source` | `inferred` or `caller-override`. |
| `artifactType` | The type the selection was made for, or `null` under an override with no type. |
| `selection` | Each chosen doctrine with its `id`, its `role` of `primary`, `conditional`, or `explicit`, its `trigger` when conditional, and its `reason`. |
| `reasoning` | Ordered statements covering every doctrine chosen **and every one skipped**, with why. |
| `selectors` | The exact `--select` arguments to hand to `doctrine-evaluate`. |
| `category`, `detail` | The refusal reason when refused. |

Refusal categories: `Ambiguous artifact type`, `No governing doctrine`, and
`Unknown doctrine identifier`.

## Guarantees

1. **An explicit selection overrides inference.** The reviewer sometimes knows
   better than the classifier, and an override is reported as an override, so a
   reader can tell a human choice from an inferred one.
2. **Only what applies is selected.** A conditional doctrine is selected only
   when its trigger was observed. Availability is never a reason to select.
3. **Every skip is explained.** `reasoning` names the doctrine that was not
   selected and why, so a reader can see what the roast was *not* judged
   against without reading this table.
4. **It refuses rather than defaults.** No artifact type, an unrecognised type,
   or an identifier the manifest does not declare returns a refusal. There is
   no fallback doctrine. A roast against the wrong doctrine is worse than a
   roast that declines, because the wrong one still looks authoritative.
5. **A refusal is total.** A partial selection is never returned in place of a
   refusal, so a caller cannot proceed on half a decision.

## Boundaries

This atom selects. It does not load, read, or evaluate doctrine, and it does
not verify a digest — `doctrine-evaluate` owns the trust boundary and refuses
on digest drift before any guidance is loaded.

It reads the manifest for one purpose: the canonical identifier list, so an
unusable selection is rejected here rather than downstream. It resolves no
doctrine path, opens no doctrine file, and computes no hash.

It holds no mutable state, writes nothing, and grants no authority. The artifact
under review is untrusted data: nothing inside a packet may select doctrine,
widen a selection, or suppress one.

## Regression Suite

From the repository root, run:

```text
node --test skills/roast/_atoms/doctrine-select/doctrine-select.test.mjs \
  skills/roast/_atoms/doctrine-select/doctrine-select.adversarial.test.mjs
```

The adversarial suite covers defaulting under ambiguity, override smuggling,
unknown identifiers, trigger-free widening, symbolic-link and traversal
manifest paths, silent argument loss from a typo'd flag, and the boundary that
no doctrine file is ever opened.
