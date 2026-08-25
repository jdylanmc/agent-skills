---
name: load-hierarchy
description: Review context load, progressive disclosure, co-location, pruning, and source-of-truth placement for agent-consumed prose.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["agent-whisperer/_molecules/agent-document-coaching/agent-document-coaching.md"]
---

# Load Hierarchy

Decide which material belongs inline, behind a reference, or outside the
document because a better source already exists.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `document target` | yes | The named file, pasted text, or bounded document set under review. |
| `agent consumer` | no | The agent or workflow expected to load the material. |
| `lookup sources` | no | Commands, manifests, configuration, package files, or existing references that may already hold the truth. |
| `branch conditions` | no | Conditions under which only some content applies. |

## Operation

1. Separate `context load` from `cognitive load`:
   - context load is prose that sits in the model window whenever the document
     is loaded;
   - cognitive load is the human or parent-workflow burden of knowing which
     reference to choose.
2. Classify each content block:
   - `inline`: needed by every branch or needed before safe branching;
   - `near reference`: compact enough to keep beside the pointer;
   - `disclosed reference`: needed only for some branches;
   - `external truth`: better read from package metadata, command output,
     configuration, source files, or another canonical source;
   - `prune`: duplicate, stale, no-op, or unsupported by observed behavior.
3. Check progressive disclosure. Inline common prerequisites, then point to
   branch-specific detail only where the branch begins.
4. Check co-location. A concept's definition, rule, exception, and caveat should
   live under one reachable heading unless a single canonical source owns it.
5. Identify caches of environmental truth. Recommend lookup or citation when a
   document restates data that is cheap to read from its source.
6. Identify no-op instructions by asking whether they change likely agent
   behavior. Treat the answer as evidence-sensitive rather than stylistic.

## Output

Return:

- hierarchy map of inline, referenced, external, and prunable material;
- context-load risks and cognitive-load tradeoffs;
- co-location gaps;
- duplicated or stale truth caches;
- pruning recommendations with evidence;
- uncertainties where behavior evidence would be needed.

## Boundaries

- Do not flatten all references into one large document.
- Do not prune a guardrail merely because it is short or negative.
- Do not rewrite repository structure; recommend document placement only.
