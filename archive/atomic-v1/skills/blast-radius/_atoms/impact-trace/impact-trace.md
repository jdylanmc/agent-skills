---
name: impact-trace
description: Bound a proposed change and trace evidence-backed consumers across direct-call and hidden repository, package, process, data, configuration, and runtime boundaries.
level: atom
allowed-tools: ["read","search"]
includes: []
composes: []
used-by: ["blast-radius/_molecules/blast-radius-proof/blast-radius-proof.md"]
---

# Impact Trace

Find where the change can actually reach before deciding what must be proven.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `change subject` | yes | Diff, revision range, patch, proposed design, or named files and symbols. |
| `baseline` | no | The comparison revision or known prior behavior. |
| `scope` | no | Included repositories, packages, environments, revisions, and explicit exclusions. |

## Operation

1. State the subject and boundary before searching. Record unresolved ambiguity
   instead of silently widening scope.
2. Identify changed public behavior, interfaces, data shapes, configuration,
   defaults, side effects, lifecycle behavior, and observable failure modes.
3. Trace direct callers and imports.
4. Trace hidden consumers where evidence indicates a path:
   - re-exports, facades, dependency injection, plugin and command registries;
   - configuration keys, feature flags, environment variables, and defaults;
   - serialized data, schemas, protocols, database or cache contracts;
   - generated code, templates, build or packaging inputs, deployment wiring;
   - events, queues, callbacks, reflection, dynamic loading, and runtime lookup;
   - command-line, application programming interface, user-interface, process,
     repository, service, permission, and ownership boundaries;
   - tests, examples, documentation, or prior incidents only when they reveal a
     real consumer or contract.
5. For every consumer, cite an exact path and line, symbol, revision, query
   result, or other reproducible location. Distinguish observed reachability
   from an unresolved lead.
6. A no-match search is evidence only when its query or command, root, file
   filters, revision, and relevant exclusions are recorded. Describe it as
   “not found in this search scope,” never “does not exist.”
7. Stop a trace when the next boundary is inaccessible or cannot be searched
   safely. Name that boundary and what evidence would advance it.

## Output

- subject, baseline, inclusions, exclusions, and evidence-access limits;
- changed contracts and observable behavior;
- direct consumers with exact citations;
- cross-boundary consumers with boundary type and exact citations;
- unresolved leads, each with the stopping boundary and required next evidence;
- recorded no-match searches with their exact scope.

## Boundaries

- No generic dependency inventory. Include a consumer only when evidence links
  it to the change.
- No candidate edits, test authorship, runtime mutation, or ownership guesses.
- Reachability is not failure. This atom maps impact paths; later proof decides
  whether a path carries a risk.
