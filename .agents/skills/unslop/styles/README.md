# Vale styles

Four styles are copied unmodified from pinned releases and one, `AiTells`, is
merged from two packages. Nothing is fetched at run time. Licenses and
copyright notices live in the repository [NOTICE](../../setup/NOTICE.md) and
`licenses/`; do not add per-package copies. Enable or disable rules in
[`.vale.ini`](../.vale.ini), never by editing the unmodified styles.
See [VALE.md](../VALE.md).

| Style | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| `RedHat` | [redhat-documentation/vale-at-red-hat](https://github.com/redhat-documentation/vale-at-red-hat) | v680 | `c8bf6824e7f9f4fbbfc29ae017f0f1553922a5d24a3aafd5e3795bca57008992` | 37 |
| `proselint` | [vale-cli/proselint](https://github.com/vale-cli/proselint) | v0.3.4 | `48b1fb481ba44f6505d44346b283f6cdc74efd234f913bbdb09bf34420fab81c`* | 34 |
| `Readability` | [vale-cli/readability](https://github.com/vale-cli/readability) | v0.2.0 | `cf8790677bb2ef86458c1d1dbd6e646fd8063c0e9621f81141e5cd85e5e41f81` | 8 |
| `write-good` | [vale-cli/write-good](https://github.com/vale-cli/write-good) | v0.4.1 | `2960ef10861ddc7dc76292a4967eb3789bf05ca24f862042f6d15f53332887f0`* | 8 |
| `AiTells` | merged, see below | | | 153 |

\* The release publishes no digest; recorded from the downloaded asset.

Local differences from the release zips:

- `Readability/LICENSE` is dropped in favor of the single canonical license
  entry in `licenses/`.

## AiTells (merged)

One style built from two packages that flag the same kind of problem:

| Origin | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| tbhb | [tbhb/vale-ai-tells](https://github.com/tbhb/vale-ai-tells) (`ai-tells`) | v1.37.0 | `f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570` | 137 |
| krishnasunkam | [krishnasunkam/vale-ai-tells](https://github.com/krishnasunkam/vale-ai-tells) (`AiTells`) | v1.0.0 | `eee9417ef656b5e9d1aaa76fd850c003c4a99856bcee787b6436a91a3fc1c03c` | 17 |

All 137 tbhb rules and 16 of the 17 krishnasunkam rules survive: 153 rules.
The tbhb `config/templates/ai-tells-agent.tmpl` output template is kept. Rule
IDs from the tbhb package change from `ai-tells.Name` to `AiTells.Name`.

A fleet of ten analysts compared all 154 rules, and a before/after run over
every plain token, 114 test files, and sentence-initial and uppercase
variants confirmed that no span flagged before is unflagged now. Exact
same-span duplicate alerts on that corpus fell from 307 to 92.

Removed or trimmed, each only where Vale showed another rule already flags the
same text in both lowercase and sentence-initial form:

- `Dash` removed. Its tokens were identical to `EmDashUsage`, which now carries
  `Dash`'s clearer message.
- `Cliche` loses 9 of 17 patterns, `CopulaInflation` 6 of 7, `Adverb` 4 of 40
  (`notably`, `importantly`, `honestly`, `frankly`).
- `SycophancyMarkers` loses 2 "happy to help" phrases that `ClosingPleasantries`
  also has. `OverusedVocabulary` loses `notably` and `crucially`, which
  `FormalTransitions` flags in any case.

Kept on purpose:

- `seamlessly`, `genuinely`, `best-in-class` and `state-of-the-art` stay in both
  `Adverb`/`Cliche` and `OverusedVocabulary`. The first two ignore case; the
  last is case-sensitive and misses sentence-initial use. The
  `in today's fast-paced world` pattern stays in `Cliche` for its "todays" and
  curly-apostrophe forms.
- The regex rules `AbstractTriad`, `EpigramContrast`, `HiddenVerb`,
  `NegParallel`, `NeverTag`, `Passive` and `VirtueHonest` partly overlap
  other rules but each flags text nothing else does. Most overlap inside the
  tbhb rules is deliberate sibling splitting, not duplication.
- Six unique krishnasunkam rules are spec or document hygiene, not AI tells:
  `CodeToken`, `FilePath`, `LinkText`, `SectionCode`, `StatusBracket`,
  `WeakResume`. `StatusBracket` also matches `[covered]` and `[required]`.
- Levels are unchanged: every tbhb rule is `error`; the krishnasunkam rules
  keep their own `suggestion` or `error`.
