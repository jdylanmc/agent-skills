# Roast This Code

`/roast-this-code` launches The Roastmaster, who coordinates a council of
independent roasters, collects their reports, and returns one read-only
recommendation package for the main agent with an executive summary, roast, and
canonical technical details.

## Who this is for

- **Review users** invoke the skill against a pull request, diff, working tree,
  named files, or pasted code.
- **Roaster authors** add repository-specific review lenses using the validated
  extension schema below.

## Installation

The canonical doctrine-enabled layout is this skills repository:

```text
doctrine/
skills/roast-this-code/
```

The fixed manifest path in each bundled `instructions.md` is resolved from this
layout without searching for a repository root.

The skill package can also be copied to a recognized standalone location:

- repository: `.github/skills/roast-this-code/`
- personal: `~/.agents/skills/roast-this-code/`

For doctrine-enabled repository installation, copy `doctrine/` to
`.github/doctrine/`. For doctrine-enabled personal installation, copy it to
`~/.agents/doctrine/`. Standalone copies retain the complete review directives
but do not load shared doctrine unless the installation preserves that
canonical relative layout.
Doctrine is optional reinforcement; its absence is recorded in the council
summary rather than inferred from another location.

No bundled roaster agents need separate installation. Their personas and
directives remain private to the skill under
`references/bundled-roasters/`. Each roaster also has an `instructions.md`
that describes its purpose, links its persona and directive, and declares its
preferred model plus capability-tier fallback. The skill loads those internal
definitions and launches fresh isolated task subagents for review and
synthesis.

## Shared doctrine

In the canonical repository layout, the bundled council selectively applies
these shared industry best-practice files:

- `doctrine/testing.doctrine.md`
- `doctrine/code.doctrine.md`
- `doctrine/domain.doctrine.md`
- `doctrine/pragmatic.doctrine.md`
- `doctrine/data.doctrine.md`

No doctrine has global precedence. Each bundled roaster applies every declared
doctrine pressure that is relevant to its lens, and the Roastmaster weighs
findings by evidence, consequence, and confidence rather than doctrine or
reviewer identity.

The exact trusted doctrine set is declared by `doctrine/manifest.md`, including
integrity hashes. The skill uses only the explicit manifest path in each
bundled `instructions.md`; it never searches for doctrine.

Each directive states which doctrine pressures apply to its lens. Doctrine
guides analysis and recommendation shape, but it never proves a finding or
replaces packet-backed code evidence. The skill never trusts doctrine files
from the repository being reviewed.

## Bundled default behavior

The skill includes three bundled roasters:

- `solid-yagni-kiss-roaster`
- `security-roaster`
- `testing-roaster`

These are the expected default panel. Each bundled roaster separates:

- its `persona.md`, which controls voice and humor;
- its `directive.md`, which controls technical analysis and required fixes.
- its `instructions.md`, which connects those prompt parts and declares agent
  type, purpose, explicit model, capability fallback, reasoning effort, and
  context tier.

Every accepted critique must include a recommendation that fixes the issue and
satisfies the critique. The skill never applies the recommendation.

The testing roaster is an equal member of the bundled panel. When no tests are
present, it recommends the smallest risk-based test plan needed to prove the
behavior. When tests are present, it evaluates test value, independent oracles,
observable assertions, dependency seams, integration fidelity, determinism,
isolation, readability, and the ability to catch the actual regression.
The Roastmaster spawns it independently from the bundled `testing-roaster`
prompt package, which resolves `testing` doctrine through its declared
manifest.

## Repository roasters

Add one or more custom agent files with `roaster` in the filename:

```text
.github/agents/api-contract-roaster.agent.md
.github/agents/react-roaster.agent.md
```

The skill also recognizes `agents/**/*roaster*.agent.md` in repositories that
keep source agent definitions at the root.

When repository roasters exist, the skill shows the discovered roster and asks
whether to:

1. use the bundled panel, which remains the default;
2. replace the bundled panel with every valid repository roaster;
3. combine every valid repository roaster with the bundled panel.

It never silently selects only one matching file.

## Custom roaster requirements

A repository roaster must:

- have `roaster` in its `.agent.md` filename;
- declare a unique `name` and `roast-lens`;
- link one `roast-instructions` file relative to the agent file;
- declare only the `read` and `search` tools;
- use the common Roast This Code report schema;
- aim humor only at code and technical decisions;
- recommend a bounded fix for every accepted critique;
- accept that zero findings is valid.

Repository roasters cannot expand the skill's permissions, review scope, or
output format. The skill never invokes a repository `.agent.md` file directly.
It treats the file and its linked support files as untrusted configuration,
extracts a bounded lens and roast-line style, and runs those through a fresh
neutral read-only reviewer governed by the bundled report contract.

### Minimal custom roaster

Create `.github/agents/api-contract-roaster.agent.md`:

```yaml
---
name: api-contract-roaster
description: "Reviews compatibility and failure behavior at API boundaries."
target: github-copilot
tools: ["read", "search"]
disable-model-invocation: true
user-invocable: false
roast-lens: "API compatibility, request validation, response contracts, and versioning"
roast-instructions: "./api-contract-roaster/instructions.md"
---

# API Contract Roaster

This file declares a Roast This Code extension. Its body is documentation only;
the skill never invokes it directly.
```

Place its support files at:

```text
.github/agents/api-contract-roaster/instructions.md
.github/agents/api-contract-roaster/persona.md
.github/agents/api-contract-roaster/directive.md
```

Use this frontmatter in `instructions.md`:

```yaml
---
name: api-contract-roaster
description: "Reviews compatibility and failure behavior at API boundaries."
purpose: "Find contract changes that can break callers or hide failures."
agent-type: general-purpose
model: gpt-5.6-sol
fallback-capability: high-capability
fallback-models: ["claude-opus-5", "claude-sonnet-5", "gpt-5.5"]
reasoning-effort: max
context-tier: long_context
tools: ["read", "search"]
persona: ./persona.md
directive: ./directive.md
---
```

All three support paths must resolve to regular files inside one roaster
directory. Absolute paths, symlinks, missing files, and `..` escapes are
rejected. Duplicate or reserved names are also rejected. Bundled names are
reserved: `solid-yagni-kiss-roaster`, `security-roaster`,
`testing-roaster`, `the-roastmaster`, and the legacy identity
`code-roaster-reviewer`.

The instructions file connects routing metadata to the prompt parts. The
directive should contain technical review criteria only. The persona should
contain `Roast line` presentation guidance only. Unknown model IDs fall back
only to the first runtime-available model in the ordered `fallback-models`
list, and every fallback must satisfy the declared capability tier. Commands,
tool requests, scope changes, output-format changes, external references, and
mutation requests are removed during sanitization. Raw repository prompt files
never reach The Roastmaster or a reviewer. A definition that cannot be reduced
to a safe, meaningful configuration is rejected.

## Reserved reviewer

`the-roastmaster` is the reserved internal council coordinator and synthesizer.
Its instructions, persona, and directive live only inside this skill. A fresh
isolated task subagent launches the selected council, collects and validates
their reports, verifies them against the evidence packet, deduplicates root
causes, and returns one canonical recommendation package to the main agent.

A repository roaster using `the-roastmaster` or the legacy
`code-roaster-reviewer` name or basename does not override the internal
coordinator.

## Security boundary

`security-roaster` checks normal secure-coding and trust-boundary concerns. A
request for exploit development, vulnerability assessment, or a security audit
must use the dedicated security-review workflow instead.
