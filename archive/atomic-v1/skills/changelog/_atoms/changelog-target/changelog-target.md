---
name: changelog-target
description: Resolve which changelog file one update applies to, what scope it covers, and which formatting convention that file already follows.
level: atom
allowed-tools: ["read","search","execute"]
includes: ["changelog/_atoms/changelog-target/changelog-target.mjs"]
composes: []
used-by: ["changelog/_molecules/changelog-curation/changelog-curation.md"]
---

# Changelog Target

Decide *which* changelog is being updated before deciding what it should say.

A changelog is not always the file at the root of a repository. It may cover one
component in a monorepo, one published package, or one skill package inside a
library. Assuming the root file is the target is how an entry about a single
component ends up in the history of everything around it.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `working-root` | yes | The directory the run was invoked against. |
| `changelog-path` | no | An explicit target supplied by the operator or a calling skill. |
| `scope` | no | What the changelog covers: a repository, a component or subtree, or a single package. |
| `scope-root` | no | The directory that scope corresponds to. |

## Required Files

1. [Resolution and write-safety implementation](./changelog-target.mjs)

## Path Safety

The changelog being written is a **computed** path, sometimes derived from input
supplied by a calling skill or read out of issue text. A lexical path shown in
an approval packet is not proof of where bytes land, so resolution is performed
by the implementation above rather than by inspection.

Every resolved target must satisfy all of these, and a failure is a refusal
rather than a warning:

| Rule | Rejected condition |
| --- | --- |
| Repository containment | The path resolves outside the repository root, by traversal or by an absolute path. |
| No symbolic components | Any existing component of the path is a symbolic link, including a parent directory. |
| Regular file | An existing target is not a regular file. |
| Post-resolution containment | The fully resolved leaf lands outside the repository root. |

A symbolic parent directory is the case most easily missed: the leaf name looks
ordinary and the redirect happens a level up.

## Resolution Order

Resolve the target by the first rule that applies, and report which rule was
used:

1. **Explicit path.** `changelog-path` wins outright. A caller that names a file
   has already made this decision.
2. **Scoped file.** When `scope-root` is given, use an existing changelog inside
   that directory. A component that keeps its own history owns its own entries.
3. **Repository file.** Otherwise use an existing changelog at the repository
   root.
4. **None found.** When no changelog exists, do not create one silently. Report
   the candidate locations, say which scope each would serve, and let the
   operator choose.

Ambiguity is reported, never resolved by preference. Two candidate changelogs
that could both plausibly serve the scope is a question for a person, because
picking wrong writes real history into the wrong file.

## Scope Statement

Record what the resolved changelog covers, because it decides which evidence is
even eligible:

| Scope | Eligible evidence |
| --- | --- |
| `repository` | Change anywhere in the repository. |
| `component` | Change within the component subtree, plus change elsewhere that alters the component's observable behaviour. |
| `package` | Change to the published package's interface, behaviour, or contract. |

Evidence outside the scope is excluded and the exclusion is reported, so a
reader can tell the difference between "nothing changed" and "changes were
filtered".

## Convention Detection

An existing changelog already has a convention, and that convention is a fact
about the target rather than a preference to be corrected. Detect and record:

- document title and heading style;
- whether an unreleased section exists, and what it is called;
- ordering, newest-first or oldest-first;
- version labelling and whether it follows Semantic Versioning;
- date format actually in use;
- the category vocabulary actually in use;
- link style, including comparison links and reference definitions;
- whether empty categories are kept as placeholders.

## Convention Selection

| Situation | Convention applied |
| --- | --- |
| No changelog exists yet | Keep a Changelog 1.1.0, as the default for a new file. |
| Existing file follows Keep a Changelog | Keep a Changelog 1.1.0. |
| Existing file follows a different but internally consistent convention | That file's own convention. |
| Existing file is internally inconsistent | The dominant convention, with the inconsistencies reported as a separate repair proposal. |

Following the target's existing convention is the point of this atom. Adding one
entry must not reformat a file's entire history as a side effect, and a
repository that deliberately keeps a different format is not defective for
having done so. A proposed migration to Keep a Changelog is offered as its own
decision, never bundled into an unrelated entry.

## Approval Binding

Resolution also produces the material an approval is bound to: the canonical
path and a hash of the target's current content. Approval covers a specific
path holding specific bytes, and both are re-verified immediately before any
write.

Without that binding, an approval covers what was true when it was displayed. A
file edited, or a path replaced by a symbolic link, between approval and write
would receive an approved patch nobody had read against its current state.

## Output

Return the resolved changelog path in canonical form, its content hash, the
rule that resolved it, the scope and its
eligible-evidence boundary, whether the file already exists, the detected
convention with the evidence for each element, the convention selected for this
update, any ambiguity requiring a decision, and any inconsistency worth a
separate repair proposal.

## Boundaries

This atom does not gather release evidence, draft entries, edit files, or create
a changelog that does not exist. It decides which file is being written and
which rules that file plays by.
