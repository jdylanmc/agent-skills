# Common Copilot Skills

This repository is a personal library of reusable GitHub Copilot skills and agents for day-to-day work.

## Layout

```text
agents/
  artifact-roastmaster.agent.md
  prompt-coach.agent.md
  skill-coach.agent.md
  skill-reviewer.agent.md
  ste-coach.agent.md
doctrine/
  <id>.doctrine.md
skills/
  _base/
    _atoms/
      <atom-name>/
        <atom-name>.md
        <atom-name>.mjs
        <atom-name>.test.mjs
    _molecules/
      <molecule-name>/
        <molecule-name>.md
        <molecule-name>.mjs
        <molecule-name>.test.mjs
  <skill-name>/
    SKILL.md
    _atoms/
      <atom-name>/
        <atom-name>.md
    _molecules/
      <molecule-name>/
        <molecule-name>.md
```

`SKILL.md` is the canonical routable entry point for every skill. It keeps the
router-facing summary and composes skill-local or shared units for execution.

Non-routable units live in level namespaces. Skill-local units belong under the
owning skill; units reused by multiple skills belong under `skills/_base/`. A
unit is exactly one Markdown file inside a same-named unit root, and its
composition level is derived from its path: `_atoms/` holds atoms and
`_molecules/` holds molecules.

An **atom** is one single operation judged from the caller's point of view. It
references no other unit and declares `includes: []`. A **molecule** composes
two or more atoms or molecules by reference to produce one bounded outcome. A
**skill** is the only unit that may be invoked directly: the contract the agent
understands.

Every unit and atomic skill declares `composes`: the exact direct atom or
molecule dependencies it uses. `includes` remains the complete mirror of links
in required sections. Local unit names are scoped to their skill; `_base` names
identify repository-wide shared units.

Skills also declare standard invocation flags. Automatically discoverable
skills use `disable-model-invocation: false`; long-running or high-ceremony
skills reserved for explicit human invocation use `true`. `user-invocable`
states whether the skill appears as a direct user action.

Every routable skill directly composes the `chronicler` molecule. A root
invocation creates one bounded Skill Run Log, nested skills reuse that run
context, and meaningful lifecycle operations are recorded on a best-effort
basis. A recording failure is reported as incomplete diagnostics and never
changes the skill's delivery, approval, mutation, or read-only behavior.

A level namespace contains one same-named root directory per unit. Each unit
root is flat, contains only regular files, and never contains symbolic links. A
support file beside a unit is named after that unit, so `chronicler.mjs` and
`chronicler.adversarial.test.mjs` both belong beside `chronicler.md` in
`_molecules/chronicler/`, and a unit may include only its own local support
files. Unit composition and code dependency are separate graphs: the unit graph
runs strictly downward and is enforced, while a unit's local script may import
another unit's script so that shared implementation is written once.

Nothing under `_base` uses `SKILL.md`. These units are read by the skills that
compose them and are never routed to, listed as a skill, or invoked directly.

## Dependency Mirror

A Markdown file opts in to dependency validation by declaring `includes` in its
frontmatter. `includes` is a JSON array of skills-root-relative paths that
mirrors exactly the local links in that file's `## Required References` or
`## Required Files` section. `requires-skills` is a JSON array of routable
skill dependencies, each `{"id": "<skill-name>", "source": "local" | "external",
"required": true | false}`.

```yaml
---
includes: ["_base/common/BASE.md", "example/references/a.md", "example/scripts/run.mjs"]
requires-skills: [{"id": "handoff", "source": "local", "required": true}]
---
```

Rules the validator enforces:

- Both fields are single-line JSON. Block-style YAML lists are not accepted.
- The mirror covers every local link in a required section, including links to
  non-Markdown support files. Links elsewhere in the file are ignored.
- Use inline links. Reference-style links in a required section are rejected
  because the mirror cannot see them.
- Opt-in is transitive. Every Markdown file reachable through `includes` must
  itself declare `includes`, so an opted-in entry point has a complete closure.
- Paths are normalized, forward-slash, case-exact, inside the skills root, and
  free of cycles and duplicates.
- When Chronicler is installed, every routable `SKILL.md` must opt into the
  graph and directly compose it. This keeps invocation diagnostics mandatory
  for current and future skills.

Markdown remains the runtime authority. The frontmatter is a machine-readable
mirror, not a directive to load every listed file into context. A file with no
`includes` field is ignored entirely, so skills adopt the convention one
closure at a time. Run `node scripts/validate-skill-graph.mjs` to check every
opted-in file.

Agents are standalone `.agent.md` files. Prompt Coach reviews single-prompt
quality; Skill Coach shapes a skill idea before the package exists; Skill
Reviewer reviews skill package and workflow quality once it does; Simplified
Technical English Coach reviews documentation-production guardrails. Artifact
Roastmaster is a shared non-user-invocable coordinator that roast skills load
as a document rather than invoke directly.

Doctrine files are shared software-engineering industry best practices. Skills
and agents reference only the doctrine relevant to their job; doctrine does
not replace code evidence or repository-specific requirements.

## Using a Skill

Copy a skill package to one of Copilot's recognized locations:

- Personal: `~/.agents/skills/<skill-name>/`
- Repository: `.github/skills/<skill-name>/`

When a copied skill composes a shared unit, copy the `_base/` directory once
beside the installed skills:

- Personal: `~/.agents/skills/_base/`
- Repository: `.github/skills/_base/`

Do not expose `_base` entries as routable skills. If a required unit is missing
at runtime, the consuming skill's own documented degradation behavior applies.

Copy an agent file to `.github/agents/` when it should be available in a repository.

Doctrine-consuming skills require the sibling `doctrine/` directory in the
canonical repository layout. Copying only one roast skill is supported, but it
degrades to `Doctrine status: unavailable`.

For a repository installation, copy doctrine to `.github/doctrine/` beside
`.github/skills/`. For a personal installation, copy it to
`~/.agents/doctrine/` beside `~/.agents/skills/`.

`ship-with-squadron` requires local `run-ci`, `roast`, `blast-radius`, and
`orchestration-handoff`, with optional local `shepherd`. It consumes the
checked-in blast-radius report and canonical Shepherd landability receipt
unchanged, while binding fleet-specific identity in its own persisted state.
Install the local dependencies together with the shared `_base/` directory
required by their composition graphs.

## Sensitive-content safeguard

Pull requests and pushes run `node scripts/scan-sensitive.mjs`. This is a
repository leak gate, not the handoff redaction floor: it reports only
high-precision credential, token, private-key, connection-string, email, and
phone evidence, plus configured identifiers. The handoff floor remains
intentionally broader and may visibly redact ordinary prose that names a
secret-shaped assignment. This split lets ordinary source such as
`const key = value` pass the repository gate without weakening handoff
redaction.

The gate scans the net current tree change, filenames, pull-request title and
body, and metadata for commits whose patch is not already represented by the
base. That remains correct when a stacked base is integrated with either a
merge commit or a squash merge. Findings contain only a source anchor, evidence
type, and count; a matching path is replaced by a stable `sha256:<digest>`
locator, so reports and errors never echo its matched value. Added, copied,
modified, and renamed binary files fail closed for explicit human review;
deleted binaries do not.

Employer, product, customer, and internal-system names are deployment-specific.
Supply them as a version 1 JSON document through the
`REDACT_SENSITIVE_CONFIG_JSON` Actions secret:

```json
{
  "version": 1,
  "identifiers": [
    {
      "value": "<repository-specific identifier>",
      "evidenceType": "internal-system"
    }
  ]
}
```

To require repository-specific identifiers, add the Actions variable
`REDACT_SENSITIVE_CONFIG_REQUIRED` with the exact value `true` alongside the
secret. A same-repository pull request or push then exits non-zero when the
configuration is absent and returns a machine-checkable configuration object
with `"state": "degraded"` and `"blocking": true`. Without that explicit
variable, a repository remains non-blocking degraded until its owner installs
the private identifier set. A fork pull request cannot receive Actions secrets,
so it remains safe under `pull_request` (never `pull_request_target`): it runs
the high-precision gate, reports `"state": "degraded"`, the static
`"fork-pull-request-identifier-configuration-unavailable"` reason, and
`"blocking": false` even when the requirement variable is enabled. An active configuration reports
`"state": "active"` and its identifier count only. Neither state includes
configured values.

The workflow registers `opened`, `synchronize`, `reopened`, and `edited`
pull-request events so a changed title or body is rescanned.

Use `node scripts/scan-sensitive.mjs --all --config <path>` for a full audit of
the tracked tree. A full audit reports binary files it cannot classify instead
of silently treating them as clean.

## Adding Skills

1. Add `skills/<skill-name>/SKILL.md`.
2. Split substantial instructions into focused files under `references/`.
3. Keep the entry point concise and link every required reference.
4. Run Skill Reviewer against the complete package; use Prompt Coach for any embedded prompt wording.
5. Preserve applicable licenses and attribution when adapting material from another source.
6. Run `node scripts/validate-skill-graph.mjs` and `node --test scripts/validate-skill-graph.test.mjs`.

Do not use JSON manifests or generated mirrors as the canonical skill format.
