# Vale styles

Four styles are copied unmodified from pinned releases and one, `ai-slop`, is
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
| `ai-slop` | merged, see below | | | 151 |

\* The release publishes no digest; recorded from the downloaded asset.

Local differences from the release zips:

- `Readability/LICENSE` is dropped in favor of the single canonical license
  entry in `licenses/`.

## ai-slop (merged)

One style built from two packages that flag the same kind of problem:

| Origin | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| tbhb | [tbhb/vale-ai-tells](https://github.com/tbhb/vale-ai-tells) (`ai-tells`) | v1.37.0 | `f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570` | 137 |
| krishnasunkam | [krishnasunkam/vale-ai-tells](https://github.com/krishnasunkam/vale-ai-tells) (`AiTells`) | v1.0.0 | `eee9417ef656b5e9d1aaa76fd850c003c4a99856bcee787b6436a91a3fc1c03c` | 17 |

All 137 tbhb rules and 14 of the 17 krishnasunkam rules survive: 151 rules.
The tbhb `config/templates/ai-tells-agent.tmpl` output template is kept. Rule
IDs change from `ai-tells.Name` and `AiTells.Name` to `ai-slop.Name`.

A fleet of ten analysts compared all 154 rules, and a before/after run over
every plain token, 114 test files, and sentence-initial and uppercase
variants confirmed that no span flagged before is unflagged now. Exact
same-span duplicate alerts on that corpus fell from 307 to 55, and no two
rules share a pattern.

Removed, folded or trimmed, each only where Vale showed the same text is still
flagged in lowercase, sentence-initial and uppercase form:

- `Dash` removed. Its tokens were identical to `EmDashUsage`, which now carries
  `Dash`'s clearer message.
- `Cliche` folded into `AICompoundPhrases` (its message already says
  "clichéd phrase"), and `CopulaInflation`'s one unique pattern (`boasts a/an`)
  into `PromotionalPuffery`. `best-in-class` and `state-of-the-art` were
  dropped from `OverusedVocabulary` as a result.
- `seamlessly` and `genuinely` moved from `Adverb` into `OverusedVocabulary`,
  which is case-sensitive, so their capitalized and uppercase forms were
  added there. `Adverb` also loses `notably`, `importantly`, `honestly` and
  `frankly`.
- `SycophancyMarkers` loses 2 "happy to help" phrases that `ClosingPleasantries`
  also has. `OverusedVocabulary` loses `notably` and `crucially`, which
  `FormalTransitions` flags in any case.

Severity effects of folding: the `Cliche` and `boasts a/an` patterns were
`suggestion` and are now `error`, as every tbhb rule is; `seamlessly` and
`genuinely` keep `error` for all case forms.

Kept on purpose:

- The regex rules `AbstractTriad`, `EpigramContrast`, `HiddenVerb`,
  `NegParallel`, `NeverTag`, `Passive` and `VirtueHonest` partly overlap
  other rules but each flags text nothing else does. Most overlap inside the
  tbhb rules is deliberate sibling splitting, not duplication.
- Six unique krishnasunkam rules are spec or document hygiene, not AI tells:
  `CodeToken`, `FilePath`, `LinkText`, `SectionCode`, `StatusBracket`,
  `WeakResume`. `StatusBracket` also matches `[covered]` and `[required]`.
- Other levels are unchanged: every tbhb rule is `error`; the krishnasunkam
  rules keep their own `suggestion` or `error`.
