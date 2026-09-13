# Third-Party Notices

Original repository material is MIT-licensed; see [LICENSE](./LICENSE).
Imported collections retain their own licenses and attribution. The repository
license does not replace those terms.

## Imported collections

| Source | Copyright | License |
| --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 2026 Matt Pocock | [MIT](./licenses/mattpocock-skills.LICENSE) |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 2026 Julius Brussee | [MIT for skills](./licenses/caveman.LICENSE) |
| [anthropics/skills](https://github.com/anthropics/skills), historical `skill-creator` import (removed) | 2026 Anthropic, PBC. | [Apache-2.0](./licenses/anthropic-skills.LICENSE) |
| [obra/superpowers](https://github.com/obra/superpowers) | 2025 Jesse Vincent | [MIT](./licenses/superpowers.LICENSE) |

`skills-lock.json` maps imported skills' local names to their primary upstream sources and
imported content hashes, not hashes of local adaptations. Additional sources
for consolidated skills are recorded below. Imported material is not relicensed
as original work.

Caveman uses split licensing. Its `skills/` directory is MIT-licensed; its
engine-linked runtime has separate terms. This import contains skills, not
that runtime. The upstream [licensing scope](./licenses/caveman.LICENSING.md)
is retained alongside its license.

Preserve applicable notices when copying, renaming, or adapting a skill.
Modifications to Apache-licensed files must carry prominent change notices.

## Consolidated skills

- `interrogate` combines `grilling`, `grill-me`, and `grill-with-docs` from
  Matt Pocock's collection. Its primary lock record retains the imported
  `skills/productivity/grilling/SKILL.md` source.
- `patch` combines the previously consolidated `debug` with Julius Brussee's
  `surgical-patch`: Matt Pocock's `diagnosing-bugs`, Jesse Vincent's
  `systematic-debugging` from Superpowers, and Julius Brussee's `investigate-first`
  remain part of its foundations.
  Its primary lock record retains `skills/engineering/diagnosing-bugs/SKILL.md`.
  The supporting tracing, waiting, validation, test-pollution, and evaluation
  material comes from Superpowers; the human-assisted loop template comes from
  Matt Pocock's collection. All three MIT notices above apply.
- `roast` combines Matt Pocock's `code-review`, Jesse Vincent's
  `requesting-code-review` and reviewer template, and Julius Brussee's
  `caveman-review`. Its primary lock record retains
  `skills/engineering/code-review/SKILL.md`. The new any-material workflow,
  code heuristics, reviewer contract, and optional terse output implement this
  repository's original Roast intent, copied unchanged from the archive.
  All three MIT notices above apply alongside the repository license for new
  material. The old atomic review machinery is not restored.
- `tdd` combines Matt Pocock's `tdd` with Jesse Vincent's
  `test-driven-development` from Superpowers, including the adapted
  `writing-good-tests.md` reference. Its primary lock record retains
  `skills/engineering/tdd/SKILL.md`. Both MIT notices apply.
- `verify` combines Julius Brussee's `verify-and-stop` with Jesse Vincent's
  `verification-before-completion` from Superpowers. Its primary lock record
  retains `skills/verify-and-stop/SKILL.md`. Both MIT notices apply.
- `ship` combines Matt Pocock's `implement` and `implement-spec` with Julius
  Brussee's `lean-build`, adapted into a delivery coordinator.
  Its primary lock record retains `skills/engineering/implement/SKILL.md`.
  It also retains adapted worker/report guidance from Jesse Vincent's
  `subagent-driven-development`; Roast retains that package's scoped
  re-review guidance. The alternate executor and its runtime scripts are
  retired. All three MIT notices apply.
- `joe-mode` combines Matt Pocock's `ask-matt` routing and phase-boundary
  guidance with Jesse Vincent's `using-superpowers` skill-selection discipline.
  Its primary lock record retains `skills/engineering/ask-matt/SKILL.md`.
  Both MIT notices apply. The agreed local intent drives a new concurrent,
  anchored orchestration workflow; Copilot runtime guidance replaces the
  upstream router's other-harness tool mappings. Setup, readiness publishing,
  and delivery references are adapted for GitHub/Azure DevOps coordination.

These workflows and their callers have been adapted locally. Original import
records and contents remain recoverable from Git history.

The shared [commit-message policy](./.agents/COMMIT-STYLE.md) adapts Julius
Brussee's `caveman-commit`. The standalone skill is retired; its policy is a
library default rather than a routable import. The Caveman MIT notice above
continues to apply alongside the repository license for new material.
Preserve applicable attribution and license when distributing a policy copy.

`poc` adapts Matt Pocock's `prototype`, including its logic and UI references,
and retains the original `skills/engineering/prototype/SKILL.md` import record.
Its broader experiment workflow uses this repository's unchanged archived
proof-of-concept intent. `discovery` retains the `wayfinder` import provenance
while its workflow is rebuilt around this repository's unchanged discovery
intent. The research workflow and affected routing/tracker references are
adapted to return evidence without automatic repository or tracker writes.
Matt Pocock's MIT notice applies alongside the repository MIT license for new
material. No archived runtime or atomic composition is restored.

`shepherd` is locally authored from this repository's retained human intent,
not an upstream import. It uses the repository MIT license and has no installer
lock record. The active Ship and Shepherd intents contain human-approved
updates; their historical originals remain in the archive.

The locally authored `synthesize` workflow and its intent also draw on Julius Brussee's
`caveman-compress` for token-focused prose compression and exact technical
content preservation. The Caveman MIT notice above applies alongside the
repository MIT license for new material. This is a new implementation of the
retained intent, not an installer import; it has no lock record and does not
restore Caveman's compression runtime.

## Archived collection

Earlier third-party adaptations and their notices remain in
[`archive/atomic-v1/NOTICE.md`](./archive/atomic-v1/NOTICE.md) and the archived
files themselves. Paths in those historical documents describe the old layout.
