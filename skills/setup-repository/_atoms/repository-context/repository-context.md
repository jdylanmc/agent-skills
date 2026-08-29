---
name: repository-context
description: Detect a repository's root, remotes, and provider, elicit only the facts detection cannot settle, and normalize everything into one context model for GitHub, GitLab, Azure DevOps, or a local custom tracker, with a bounded provider matrix and a named disposition for an unsupported provider.
level: atom
allowed-tools: ["execute","read","search"]
includes: ["setup-repository/_atoms/repository-context/repository-context.mjs"]
composes: []
used-by: ["setup-repository/_molecules/repository-configuration/repository-configuration.md"]
---

# Repository Context

Turn what a repository reveals about itself, plus the facts only an operator
knows, into one normalized context model.

```text
detect root and remotes -> classify provider -> elicit the rest -> normalize
```

This atom settles what can be settled by inspection and asks for the rest. It
never guesses a value it could not observe, because a configuration built on a
guessed organization or invented label reads as complete and sends every later
skill to the wrong place.

## Required Files

1. [Detection and normalization helper](./repository-context.mjs)

## Detection

Detection reads the repository root and its configured remotes. A remote URL is
the only evidence classification needs, so the helper takes the URL as input and
performs no network call: the same parsing runs against every URL form the
regression suite supplies.

`classifyRemote(remoteUrl)` recognizes the URL shapes each provider uses:

| Provider | Forms |
| --- | --- |
| `github` | `https://github.com/{org}/{repo}`, `{ssh-user}@github.com:{org}/{repo}`, `ssh://{ssh-user}@github.com/{org}/{repo}`, with or without a trailing `.git` |
| `gitlab` | the same shapes on `gitlab.com`, and subgroup namespaces `{group}/{subgroup}/{repo}` |
| `azure-devops` | `https://dev.azure.com/{org}/{project}/_git/{repo}`, `https://{org}@dev.azure.com/...`, `{ssh-user}@ssh.dev.azure.com:v3/{org}/{project}/{repo}`, and legacy `https://{org}.visualstudio.com/{project}/_git/{repo}` |

A self-hosted GitHub Enterprise or GitLab host is recognized only when the
operator declares it through `declaredHosts`. An unknown host is `unsupported`
until it is declared, because inferring a provider from an unfamiliar domain is
the first step of an unbounded provider matrix.

## Bounded Provider Matrix

`PROVIDER_TABLE` is frozen and holds exactly four supported classes plus a
single `unsupported` disposition.

| Class | Project layer | Note |
| --- | --- | --- |
| `github` | no | organization and repository |
| `gitlab` | no | namespace (with subgroups) and repository |
| `azure-devops` | yes | organization, project, and repository |
| `local` | no | a bounded custom tracker described in prose |
| `unsupported` | no | names the custom fields the operator must supply |

The matrix does not grow one row per provider anyone might use. A provider the
table does not recognize returns the `unsupported-provider` disposition together
with the custom configuration required to describe it as a `local` tracker
instead. The boundary is the point: an unbounded matrix is never finished, and a
`local` escape hatch keeps the supported set small without refusing anyone.

## Normalization

`normalizeContext(input)` folds detection output and operator answers into one
model and reports what remains.

| Status | When |
| --- | --- |
| `complete` | every required field for the provider is settled |
| `needs-input` | a required field is still unsettled; `missing` names each one and the question to ask |
| `unsupported-provider` | the provider is not supported and no custom configuration was supplied |

The normalized model carries `provider`, `host`, `organization`, `project`
(null when the provider has no project layer), `repository`, `defaultBranch`,
`targetDirectory`, `trackerOperations`, `relationshipKinds`,
`mutationVocabulary`, `itemTypes`, `labels` (each with a `name` and a
`meaning`), `states` (each with a `name` and a `meaning`), `domain` (`name`,
`summary`, `vocabularySources`), and, for a `local` provider, a bounded
`customTrackerInstructions` string.

Labels and states are the same shape: a named vocabulary term whose meaning
must be stated. An entry that names a label or state but leaves its meaning
blank does not settle the field, so an unexplained state yields `needs-input`
rather than a term nobody defined. A mixed array — some entries settled, some
incomplete — does not silently keep the settled ones and drop the rest. The
malformed entries are carried through into the normalized context as `{ name,
meaning: null }` records, so re-normalizing that context still reports the
same unresolved evidence rather than the surviving subset becoming
`complete`. `missing` names each malformed entry by its zero-based `index`
and any partial name the operator supplied, so nothing the operator wrote is
discarded without being reported.

The custom-instruction string has an enforced ceiling. Instructions longer
than the ceiling do not throw; the field is reported unresolved with `reason:
'custom-instructions-too-long'`, the `limit`, and the `suppliedLength`, so
the operator can shorten the instruction. Silently truncating would be a
configuration that looks accepted and means something the operator did not
write.

## Normalization Is Idempotent

`normalizeContext(normalizeContext(x).context)` returns an equal context. The
model is rebuilt from a fixed field set with deterministic defaults on every
pass rather than accumulated across passes, so feeding a normalized context back
through settles nothing new and drops nothing. A skill that re-runs against
unchanged inputs therefore converges on the same model instead of drifting.

## Boundaries

- Detection reads; it does not write, and it does not mutate a tracker.
- A value that could not be observed is asked for, never invented. Provider,
  host, organization, project, repository, branch, label, state, and domain
  values come from evidence or from the operator.
- The provider matrix stays bounded. An unsupported provider is named, and its
  required custom configuration is returned, rather than adding a row.
- The atom produces a context model. Rendering files and writing them belong to
  the other atoms in this package.
