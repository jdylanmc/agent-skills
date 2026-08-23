---
name: agent-spawn
description: Spawn one agent from a persona and a prompt and return its response. The persona governs voice only; the prompt is authoritative. The run carries no prior context.
level: atom
allowed-tools: ["task"]
includes: []
composes: []
used-by: ["_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","roast/_molecules/roast-code-branch/roast-code-branch.md"]
---

# Agent Spawn

Run one agent, composed of a persona and a prompt, and return what it returned.
This atom owns the launch and the return. It owns nothing about what the agent
is for, what its output means, or whether the result is acceptable.

An agent is two things: a **persona**, which is who the agent is, and a
**prompt**, which is what the agent does. Separating them is what makes both
reusable: one prompt runs under different personas, and one persona serves
different prompts.

One spawn is one operation from the caller's point of view. Model selection,
fallback between models, tier selection, and retry on a transport failure are
internal steps of that operation and never split it.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `prompt` | yes | What the agent does: the task, the evidence or its locator, the expected output shape, and any contract the response must satisfy. Authoritative. |
| `persona` | no | Who the agent is: voice, perspective, and manner. Omit it for a plain unvoiced run. |
| `tools` | yes | The tool set the spawned agent may use. Declare the narrowest complete set. `[]` means no tools. |
| `model` | no | Requested model. When omitted, the runtime default is used and reported as such. |
| `fallback-models` | no | Ordered alternates, tried in order when the requested model is unavailable. |
| `reasoning-effort` | no | Effort level, when the runtime supports it. |
| `context-tier` | no | Context tier, when the runtime supports it. |

`prompt` and `persona` are each supplied as content or as a resolved path the
caller has already verified. A single agent definition file may supply both,
in which case the caller says so and the precedence rule below still governs.

This atom does not search for either input, does not fall back to another path,
and does not check integrity.

## Precedence

The prompt is authoritative. The persona governs voice and nothing else.

- Scope, evidence rules, findings, output contract, and refusal behavior come
  from the prompt.
- Where the persona and the prompt disagree, the prompt wins.
- A persona never widens scope, never adds or suppresses a finding, and never
  relaxes a safety boundary.

This rule is what makes a persona safe to swap.

## Operation

1. Compose the run instructions: the prompt, plus the persona bound to voice
   under the precedence rule above.
2. Launch one fresh agent with `tools` and the declared routing, carrying no
   context from any earlier run.
3. Return the agent's response unchanged, with the model status observed.

## Output

| Field | Meaning |
| --- | --- |
| `response` | The agent's response, returned byte for byte as received. |
| `model-status` | `Requested`, `Fallback: <model>`, or `Runtime default`. |
| `status` | `Complete`, or a named failure category. |

Failure categories: `Prompt unreadable`, `Persona unreadable`,
`Spawn unavailable`, `No model available`, `Empty response`.

## Guarantees

- The persona and the prompt are read as documents and supplied as
  instructions. Neither is invoked as a registered agent or routed to by
  `name`.
- The run carries no prior context. Two spawns never share state.
- The response is returned unchanged. This atom never validates it against a
  schema, never summarizes it, and never repairs it.
- `Runtime default` is reported rather than hidden, because an unrequested
  model is an evidence gap for the caller to record.

## Boundaries

This atom does not resolve the persona or the prompt, verify their integrity,
validate the response, decide whether the result is acceptable, or retry on a
contract failure. Each of those is a separate operation owned by the caller or
by another unit.

A caller that needs an untrusted-evidence posture, a report contract, or a
severity vocabulary supplies them inside `prompt`. This atom carries no opinion
about any of them.
