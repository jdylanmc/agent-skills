# Roast

One entry point for adversarial review of an agent definition, a prompt, a
skill package, or a code change set.

```text
identify the packet  ->  select the doctrine  ->  evaluate against it  ->  coordinate the review
```

## Terms

| Term | Meaning |
| --- | --- |
| **Artifact branch** | The coordinate-and-synthesize shape shared by the agent, prompt, and skill types. |
| **Code branch** | The council shape for a change set. It does not share the artifact coordination molecule. |
| **Artifact profile** | The one table holding everything that varies between the three artifact types. |
| **Lens** | A review document read as principles, never invoked as an agent. |
| **Envelope** | The untrusted, schema-checked evidence report a coordinator returns before synthesis. |
| **Roast** | The final severity-ranked list of recommendations. |

## What It Returns

A formalised list of recommendations to fix. Each names its location, what was
observed, the doctrine rule it rests on when doctrine applied, a severity
category, a confidence, and a bounded fix with a way to validate it.

`blocker`, `major`, `minor`, and `advisory` are severity categories. This skill
is not a gate: it returns no verdict, approves nothing, and blocks nothing. A
human reads the list and decides.

## Why One Skill

Four sibling skills carried near-identical routing text and differed only by
artifact type at the tail. Three of them each carried their own copy of the
roast contract, the failure-and-recovery reference, the trusted-lens reference,
and the trusted manifest. Those copies had already drifted apart before they
ever merged; the differences were almost entirely an artifact noun.

That material is authored once now. The variation lives in
`_atoms/artifact-profile/`, and a shared document marks each varying span with
a `{{field}}` placeholder that the profile resolves. A placeholder with no
matching field, or a field one type declares and another does not, fails the
regression suite.

Code review is the exception, and it stays one. It takes a pull request, a
branch diff, working-tree changes, named files, or pasted code, and it does not
use the artifact coordination shape. It is a separate branch behind the same
entry point rather than a fourth row of a table it does not fit.

## Layout

| Path | Purpose |
| --- | --- |
| `SKILL.md` | Routing, workflow, output contract, boundaries. |
| `_molecules/roast-target-intake/` | Classify the target, resolve the profile, select doctrine. |
| `_molecules/roast-artifact-branch/` | The shared agent, prompt, and skill roast. |
| `_molecules/roast-code-branch/` | The code-review council. |
| `_atoms/artifact-profile/` | The per-artifact-type variation, in one table. |
| `_atoms/doctrine-select/` | Which doctrine governs what, with reasoning. Local under ADR 0001. |
| `_atoms/roast-contract/` | The roast contract, authored once. |
| `_atoms/roast-failure-recovery/` | Statuses, recovery actions, degraded states, authored once. |
| `_atoms/roast-trusted-lenses/` | The trust boundary and the bundled lens configurations. |
| `_atoms/code-*/` | The code branch's own scope, panel, contract, synthesis, summary, output, and safeguards. |
| `references/bundled-roasters/` | The bundled roaster prompt packages for the code branch. |

## Maintenance

After editing the bundled lens configuration, regenerate its digest:

```text
shasum -a 256 skills/roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md
```

Update `sha256` in `roast-trusted-lenses.manifest.json`. The regression suite
fails until you do.

After changing composition, regenerate the derived frontmatter:

```text
node scripts/derive-skill-graph.mjs --write
```

Never hand-author `used-by` or a molecule's `allowed-tools`. The skill's own
`allowed-tools` is verified rather than generated, and is pinned by
`roast.conformance.test.mjs`.

## Regression Suite

```text
node --test \
  skills/roast/roast.conformance.test.mjs \
  skills/roast/_atoms/artifact-profile/artifact-profile.test.mjs \
  skills/roast/_atoms/doctrine-select/doctrine-select.test.mjs \
  skills/roast/_atoms/doctrine-select/doctrine-select.adversarial.test.mjs \
  skills/roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.test.mjs
```
