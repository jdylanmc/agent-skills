# Vale styles

Two styles. `RedHat` is the base, an unmodified pinned release. `ai-slop` is
one merged, deduplicated layer built from five other packages. Nothing is
fetched at run time. Licenses and copyright notices live in the repository
[NOTICE](../../setup/NOTICE.md) and `licenses/`; do not add per-package copies.
Enable or disable rules in [`.vale.ini`](../.vale.ini). See [VALE.md](../VALE.md).

| Style | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| `RedHat` | [redhat-documentation/vale-at-red-hat](https://github.com/redhat-documentation/vale-at-red-hat) | v680 | `c8bf6824e7f9f4fbbfc29ae017f0f1553922a5d24a3aafd5e3795bca57008992` | 37 |
| `ai-slop` | merged, see below | | | 198 |

## ai-slop (merged)

Rule IDs are `ai-slop.Name`. Package metadata (`meta.json`, package READMEs) and
`Readability/LICENSE` are dropped; each license is kept once in `licenses/`.
The tbhb `config/templates/ai-tells-agent.tmpl` output template is kept.

| Origin | Source | Release | Release zip sha256 | License | Rules |
| --- | --- | --- | --- | --- | --- |
| tbhb | [tbhb/vale-ai-tells](https://github.com/tbhb/vale-ai-tells) (`ai-tells`) | v1.37.0 | `f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570` | MIT | 137 |
| krishnasunkam | [krishnasunkam/vale-ai-tells](https://github.com/krishnasunkam/vale-ai-tells) (`AiTells`) | v1.0.0 | `eee9417ef656b5e9d1aaa76fd850c003c4a99856bcee787b6436a91a3fc1c03c` | MIT | 13 |
| proselint | [vale-cli/proselint](https://github.com/vale-cli/proselint) | v0.3.4 | `48b1fb481ba44f6505d44346b283f6cdc74efd234f913bbdb09bf34420fab81c`* | BSD-3-Clause | 33 |
| write-good | [vale-cli/write-good](https://github.com/vale-cli/write-good) | v0.4.1 | `2960ef10861ddc7dc76292a4967eb3789bf05ca24f862042f6d15f53332887f0`* | MIT | 7 |
| Readability | [vale-cli/readability](https://github.com/vale-cli/readability) | v0.2.0 | `cf8790677bb2ef86458c1d1dbd6e646fd8063c0e9621f81141e5cd85e5e41f81` | MIT | 8 |

\* The release publishes no digest; recorded from the downloaded asset.

Which rule came from where. Anything not listed below is tbhb.

- **krishnasunkam (13):** `AbstractTriad`, `Adverb`, `CodeToken`,
  `EpigramContrast`, `FilePath`, `HiddenVerb`, `LinkText`, `NegParallel`,
  `NeverTag`, `SectionCode`, `StatusBracket`, `VirtueHonest`, `WeakResume`.
- **proselint, BSD-3-Clause (33):** `Airlinese`, `AnimalLabels`, `Annotations`,
  `Apologizing`, `Archaisms`, `But`, `Cliches`, `CorporateSpeak`, `Currency`,
  `Cursing`, `DateCase`, `DateMidnight`, `DateRedundancy`, `DateSpacing`,
  `DenizenLabels`, `Diacritical`, `GenderBias`, `GroupTerms`, `Hedging`,
  `Hyperbole`, `Jargon`, `LGBTOffensive`, `LGBTTerms`, `Malapropisms`,
  `Needless`, `Nonwords`, `Oxymorons`, `P-Value`, `RASSyndrome`, `Skunked`,
  `Spelling`, `Typography`, `Uncomparables`.
- **write-good (7):** `E-Prime`, `Illusions`, `Passive`, `So`, `ThereIs`,
  `TooWordy`, `Weasel`.
- **Readability (8):** `AutomatedReadability`, `ColemanLiau`, `FleschKincaid`,
  `FleschReadingEase`, `GunningFog`, `LIX`, `Polysyllables`, `SMOG`.

### How it was deduplicated

Two passes, each checked with Vale 3.24.0 before and after over thousands of
test sentences in lowercase, sentence-initial and uppercase form. Priority when
two rules flag the same text: `ai-slop` rules, then proselint, then write-good.

**Pass 1, tbhb + krishnasunkam (154 rules, ten analysts):** removed `Dash`
(identical to `EmDashUsage`); folded `Cliche` into `AICompoundPhrases` and
`CopulaInflation`'s one unique pattern into `PromotionalPuffery`; moved
`seamlessly` and `genuinely` from `Adverb` into `OverusedVocabulary`; trimmed
a few phrases from `Adverb`, `SycophancyMarkers` and `OverusedVocabulary`.

**Pass 2, adding proselint, write-good and Readability:**

- `write-good.Cliches` removed. All 697 of its patterns are also in
  `proselint.Cliches`.
- `proselint.Very` removed; `ai-slop.Adverb` flags `very` the same way.
- Trimmed only where another rule flags the complete phrase: `Cliches` 17 of
  777, `TooWordy` 29 of 216, `CorporateSpeak` 4 of 25, `Weasel` 4 of 24.
- `Passive` is one rule: write-good's participle list plus the optional adverb
  ("was quickly fixed") the krishnasunkam rule added. Its message and
  `warning` level are write-good's.
- A first pass of this check counted any rule firing on the same line as
  coverage. That wrongly marked 22 `Cliches`, 5 `TooWordy`, 1 `Oxymorons` and
  all of `Apologizing` as covered, because another rule flagged only a few of
  their words. They were restored; coverage now requires the other rule's
  span to contain the original.

Result of the final check over 116 files: no previously flagged span is lost
or narrowed; same-span duplicate alerts fell from 7,046 to 2,316. One earlier
case differs: `CopulaInflation`'s `is/are a testament to` is now flagged by
`AICompoundPhrases` as `a testament to`, without the verb.

### Overlap kept on purpose

- Regex rules (`AbstractTriad`, `EpigramContrast`, `HiddenVerb`, `NegParallel`,
  `NeverTag`, `VirtueHonest`) and most overlap inside the tbhb rules are
  partial, not duplicate; each flags text nothing else does.
- Severity follows the rule that now owns a pattern. The folded `Cliche` and
  `boasts a/an` patterns moved from `suggestion` to `error`. `clearly`,
  `fairly`, `obviously` and `very` moved from write-good `warning` and
  proselint `error` to `ai-slop.Adverb` `suggestion`.
- `ai-slop` was not deduplicated against `RedHat`. Known overlaps:
  `RedHat.EmDash` and `ai-slop.EmDashUsage`; passive voice in
  `RedHat.PassiveVoice` and `ai-slop.Passive`; `RedHat.ReadabilityGrade` and the
  Readability metrics.
- Six krishnasunkam rules are document hygiene, not AI tells: `CodeToken`,
  `FilePath`, `LinkText`, `SectionCode`, `StatusBracket` (which also matches
  `[covered]` and `[required]`) and `WeakResume`.
