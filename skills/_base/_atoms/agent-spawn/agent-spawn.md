---
name: agent-spawn
description: Spawn one agent from a persona and a prompt and return its response. The persona governs voice only; the prompt is authoritative. The run carries no prior context.
level: atom
allowed-tools: ["task"]
includes: ["_base/_atoms/agent-spawn/agent-spawn.mjs"]
composes: []
used-by: ["_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","optimize-prompt/_molecules/prompt-optimization/prompt-optimization.md","prompt-coach/_molecules/prompt-review/prompt-review.md","roast/_molecules/roast-code-branch/roast-code-branch.md","slop-sniper/_molecules/orchestration-audit/orchestration-audit.md"]
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

## Required Files

1. [Model-route resolver and dispatch adapter](./agent-spawn.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `prompt` | yes | What the agent does: the task, the evidence or its locator, the expected output shape, and any contract the response must satisfy. Authoritative. |
| `persona` | no | Who the agent is: voice, perspective, and manner. Omit it for a plain unvoiced run. |
| `tools` | yes | The tool set the spawned agent may use. Declare the narrowest complete set. `[]` means no tools. |
| `model-role` | no | Stable routing role when the caller wants deterministic role-aware resolution. Supported keys: `implementer`, `cleanup`, `architecture-candidate`, `architecture-judge`, `qa-reviewer`, `qa-judge`, `decision-trail-reviewer`. |
| `user-model-roles` | no | Optional per-user role overrides. These are caller-supplied data, not a path the atom discovers. |
| `repository-model-roles` | no | Optional per-repository role overrides. These are caller-supplied data, not a path the atom discovers. |
| `parent-model-route` | no | A previously resolved route, required only when a selected override uses `inherit-parent`. |
| `panel-length` | no | Requested fanout for a repeatable reviewer role when one route should be repeated. When a role mapping itself is a list, that list length is the requested fanout instead. |
| `runtime-available-models` | no | Optional exact runtime availability snapshot. When supplied, the resolver validates requested and fallback slugs before launch. |
| `model` | no | Requested model. Without `model-role`, this is the direct spawn route. With `model-role`, this is the inline default for that role. When omitted outside role-aware routing, the runtime default is used and reported as such. |
| `fallback-models` | no | Ordered alternates, tried in order when the requested model is unavailable. With `model-role`, these belong to the inline default. |
| `reasoning-effort` | no | Effort level, when the runtime supports it. With `model-role`, this belongs to the inline default. |
| `context-tier` | no | Context tier, when the runtime supports it. With `model-role`, this belongs to the inline default. |

`prompt` and `persona` are each supplied as content or as a resolved path the
caller has already verified. A single agent definition file may supply both,
in which case the caller says so and the precedence rule below still governs.

This atom does not search for either input, does not fall back to another path,
and does not check integrity.

When `model-role` is present, the caller resolves the route with
[Model-route resolver](./agent-spawn.mjs) before launch. Override precedence is
`user-model-roles`, then `repository-model-roles`, then the caller's inline
default. `auto` means "use the inline default exactly as declared for this
role." `inherit-parent` means "copy the already-resolved parent route exactly";
without `parent-model-route`, that alias is invalid rather than empty.

Role-aware routing does not invent storage, read machine-local files, or change
authority. The mapping objects are explicit inputs. A plain call that omits
`model-role` keeps the existing direct-routing behavior.

Every supplied mapping entry is validated before any role resolves, including
entries for roles a caller has not reached yet. This prevents a malformed
configuration from failing only after a partial orchestration run.

The seven role keys are a shared dispatch vocabulary, not a claim that seven
workflows already exist. `dispatchModelRoleAgent` makes every key callable
through one caller-supplied transport seam. Current repository consumers opt in
only where they own the role: Roast currently uses `architecture-candidate`
and `qa-reviewer`. No current cleanup, architecture-judge, QA-judge, or
decision-trail workflow is invented by this atom, and an override for one of
those roles has no effect until such a caller explicitly dispatches through the
shared seam.

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
2. When `model-role` is present, resolve the route deterministically from the
   caller's inline default plus any supplied role overrides. For a repeatable
   reviewer role, `panel-length` repeats one resolved route up to the caller's
   confirmed cap; a role-mapping list controls its own fanout and is capped the
   same way.
3. If `runtime-available-models` is present, validate the requested model and
   ordered fallbacks before launch. Use only the requested model or a listed
   fallback. If none are available, stop as `No model available`; do not
   quietly substitute another slug.
4. Convert the resolution into a dispatch route. An observed fallback becomes
   the actual model argument and has no remaining fallback list. An unavailable
   route is `null` and cannot reach transport. When availability was not
   observed, preserve the requested route and report that uncertainty.
5. Call `dispatchResolvedAgent`, or the convenience
   `dispatchModelRoleAgent`, with a caller-supplied transport function. The
   adapter passes the prompt, persona, tools, selected model, remaining fallback
   list, effort, and context tier as one immutable launch request.
6. Launch one fresh agent with `tools` and the resolved routing, carrying no
   context from any earlier run.
7. Return the agent's response unchanged, with the model status observed and,
   when role-aware routing was used, the routing receipt that explains what was
   requested and what degraded.

## Output

| Field | Meaning |
| --- | --- |
| `response` | The agent's response, returned byte for byte as received. |
| `model-status` | `Requested`, `Fallback: <model>`, `Runtime default`, or `Unavailable`. |
| `actual-model` | Provider-observed model identity when the transport reports it; otherwise `null`. |
| `actual-model-status` | `matched-selection`, `mismatched-selection`, `observed-runtime-default`, `unobserved`, or `not-launched`. |
| `routing-receipt` | When role-aware routing was used, the resolved role, precedence source, alias use, requested route, availability status, selected model, panel fanout, and diversity status. |
| `status` | `Complete`, or a named failure category. |

Failure categories: `Prompt unreadable`, `Persona unreadable`,
`Spawn unavailable`, `No model available`, `Unexpected model`, `Empty response`.

## Guarantees

- The persona and the prompt are read as documents and supplied as
  instructions. Neither is invoked as a registered agent or routed to by
  `name`.
- The run carries no prior context. Two spawns never share state.
- The response is returned unchanged. This atom never validates it against a
  schema, never summarizes it, and never repairs it.
- `Runtime default` is reported rather than hidden, because an unrequested
  model is an evidence gap for the caller to record.
- Role-aware routing is deterministic: the same inputs resolve to the same
  request order, the same fallback order, and the same cap behavior.
- Resolved routes, receipts, panel summaries, dropped-seat records, launch
  requests, and dispatch results are deeply immutable snapshots.
- `inherit-parent` copies only an already resolved route. It never re-resolves
  from a parent mapping and never widens authority.
- Same-family panels, fallback convergence, capped fanout, unavailable seats,
  and unobserved availability are reported explicitly rather than flattened
  into "requested."
- A selected available model is the model supplied to transport. An unavailable
  seat never calls transport.
- Provider-observed model identity is recorded separately when available. A
  mismatch is explicit and never rewrites the requested or selected receipt;
  absent provider metadata remains `unobserved`.

## Boundaries

This atom does not resolve the persona or the prompt, verify their integrity,
validate the response, decide whether the result is acceptable, or retry on a
contract failure. Each of those is a separate operation owned by the caller or
by another unit.

A caller that needs an untrusted-evidence posture, a report contract, or a
severity vocabulary supplies them inside `prompt`. This atom carries no opinion
about any of them.
