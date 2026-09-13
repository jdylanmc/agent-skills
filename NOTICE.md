# Third-Party Notices

Original repository material is MIT-licensed; see [LICENSE](./LICENSE).
Imported collections retain their own licenses and attribution. The repository
license does not replace those terms.

## Imported collections

| Source | Copyright | License |
| --- | --- | --- |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 2026 Matt Pocock | [MIT](./licenses/mattpocock-skills.LICENSE) |
| [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | 2026 Julius Brussee | [MIT for skills](./licenses/caveman.LICENSE) |
| [anthropics/skills](https://github.com/anthropics/skills), `skill-creator` only | 2026 Anthropic, PBC. | [Apache-2.0](./.agents/skills/skill-creator/LICENSE.txt) |
| [obra/superpowers](https://github.com/obra/superpowers) | 2025 Jesse Vincent | [MIT](./licenses/superpowers.LICENSE) |

`skills-lock.json` maps local skill names to their primary upstream sources and
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
- `debug` combines Matt Pocock's `diagnosing-bugs`, Jesse Vincent's
  `systematic-debugging` from Superpowers, and Julius Brussee's `investigate-first`.
  Its primary lock record retains `skills/engineering/diagnosing-bugs/SKILL.md`.
  The supporting tracing, waiting, validation, test-pollution, and evaluation
  material comes from Superpowers; the human-assisted loop template comes from
  Matt Pocock's collection. All three MIT notices above apply.
- `tdd` combines Matt Pocock's `tdd` with Jesse Vincent's
  `test-driven-development` from Superpowers, including the adapted
  `writing-good-tests.md` reference. Its primary lock record retains
  `skills/engineering/tdd/SKILL.md`. Both MIT notices apply.
- `verify` combines Julius Brussee's `verify-and-stop` with Jesse Vincent's
  `verification-before-completion` from Superpowers. Its primary lock record
  retains `skills/verify-and-stop/SKILL.md`. Both MIT notices apply.

These workflows and their callers have been adapted locally. Original import
records and contents remain recoverable from Git history.

## Archived collection

Earlier third-party adaptations and their notices remain in
[`archive/atomic-v1/NOTICE.md`](./archive/atomic-v1/NOTICE.md) and the archived
files themselves. Paths in those historical documents describe the old layout.
