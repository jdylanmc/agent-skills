# Vale styles

Two styles. `RedHat` is the base, an unmodified pinned release. `ai-slop` is
one merged, deduplicated layer built from five other packages, with everything
RedHat already flags purged. Nothing is
fetched at run time. Licenses and copyright notices live in the repository
[NOTICE](../../setup/NOTICE.md) and `licenses/`; do not add per-package copies.
Enable or disable rules in [`.vale.ini`](../.vale.ini). See [VALE.md](../VALE.md).

| Style | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| `RedHat` | [redhat-documentation/vale-at-red-hat](https://github.com/redhat-documentation/vale-at-red-hat) | v680 | `c8bf6824e7f9f4fbbfc29ae017f0f1553922a5d24a3aafd5e3795bca57008992` | 37 |
| `ai-slop` | merged, see below | | | 191 |

## ai-slop (merged)

Rule IDs are `ai-slop.Name`. Package metadata (`meta.json`, package READMEs) and
`Readability/LICENSE` are dropped; each license is kept once in `licenses/`.
The tbhb `config/templates/ai-tells-agent.tmpl` output template is kept.

| Origin | Source | Release | Release zip sha256 | License | Rules |
| --- | --- | --- | --- | --- | --- |
| tbhb | [tbhb/vale-ai-tells](https://github.com/tbhb/vale-ai-tells) (`ai-tells`) | v1.37.0 | `f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570` | MIT | 137 |
| krishnasunkam | [krishnasunkam/vale-ai-tells](https://github.com/krishnasunkam/vale-ai-tells) (`AiTells`) | v1.0.0 | `eee9417ef656b5e9d1aaa76fd850c003c4a99856bcee787b6436a91a3fc1c03c` | MIT | 13 |
| proselint | [vale-cli/proselint](https://github.com/vale-cli/proselint) | v0.3.4 | `48b1fb481ba44f6505d44346b283f6cdc74efd234f913bbdb09bf34420fab81c`* | BSD-3-Clause | 28 |
| write-good | [vale-cli/write-good](https://github.com/vale-cli/write-good) | v0.4.1 | `2960ef10861ddc7dc76292a4967eb3789bf05ca24f862042f6d15f53332887f0`* | MIT | 6 |
| Readability | [vale-cli/readability](https://github.com/vale-cli/readability) | v0.2.0 | `cf8790677bb2ef86458c1d1dbd6e646fd8063c0e9621f81141e5cd85e5e41f81` | MIT | 7 |

\* The release publishes no digest; recorded from the downloaded asset.

Which rule came from where. Anything not listed below is tbhb.

- **krishnasunkam (13):** `AbstractTriad`, `Adverb`, `CodeToken`,
  `EpigramContrast`, `FilePath`, `HiddenVerb`, `LinkText`, `NegParallel`,
  `NeverTag`, `SectionCode`, `StatusBracket`, `VirtueHonest`, `WeakResume`.
- **proselint, BSD-3-Clause (28):** `Airlinese`, `AnimalLabels`, `Annotations`,
  `Apologizing`, `Archaisms`, `Cliches`, `CorporateSpeak`, `Currency`,
  `Cursing`, `DenizenLabels`, `Diacritical`, `GenderBias`, `GroupTerms`,
  `Hedging`, `Hyperbole`, `Jargon`, `LGBTOffensive`, `LGBTTerms`,
  `Malapropisms`, `Needless`, `Nonwords`, `Oxymorons`, `P-Value`,
  `RASSyndrome`, `Skunked`, `Spelling`, `Typography`, `Uncomparables`.
- **write-good (6):** `E-Prime`, `Passive`, `So`, `ThereIs`, `TooWordy`,
  `Weasel`.
- **Readability (7):** `AutomatedReadability`, `ColemanLiau`,
  `FleschReadingEase`, `GunningFog`, `LIX`, `Polysyllables`, `SMOG`.

### How it was deduplicated

Three passes, each checked with Vale 3.24.0 before and after over thousands of
test sentences in lowercase, sentence-initial and uppercase form. Priority when
two rules flag the same text: `RedHat` first, then `ai-slop` rules, then
proselint, then write-good.

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

**Pass 3, purge everything RedHat already flags** (RedHat is the base, so the
overlap is removed from `ai-slop`, never from RedHat). A pattern was removed
only when a RedHat rule *of the same concern* flagged the complete text in both
mid-sentence and sentence-initial form. 304 patterns went:

- Whole rules removed: `Illusions` (the same `repetition` rule as
  `RedHat.RepeatedWords`), `But` (RedHat's `Conjunctions` has the same `^But`
  at paragraph scope) and `FleschKincaid` (the same metric as
  `RedHat.ReadabilityGrade`, which uses a grade of 9; the old threshold was 8).
- `Passive` keeps only the case RedHat misses: a be-verb, an adverb, then a
  participle ("was quickly fixed"). `RedHat.PassiveVoice` has the same
  participle list for the plain case.
- `EmDashUsage` keeps only the en dash; `RedHat.EmDash` owns `—`. `Typography`
  drops `...`, which `RedHat.Ellipses` already flags.
- Word-choice patterns RedHat flags through `SimpleWords`, `TermsErrors`,
  `TermsWarnings`, `TermsSuggestions` or `ReleaseNotes`: 65 from `TooWordy`, 9
  from `FormalRegister`, 3 from `FormalTransitions`, 2 each from `FillerPhrases`
  and `OverusedVocabulary`, 1 each from `AICompoundPhrases`, `HedgingPhrases`
  and `RestatementMarkers`.
- 12 contraction forms from `E-Prime`, which `RedHat.Contractions` already
  flags. 206 patterns from `Needless` (180) and `Nonwords` (26): all but three
  are misspellings that `RedHat.Spelling` already flags (the three are flagged
  by `RedHat.TermsErrors`). Those two rules lose the suggested replacement for
  those words.

Not purged, though RedHat alerts sometimes contain them: `Definitions`
(undefined acronyms, so it "contains" `TODO` and `FIXME`), `Headings`
(capitalization of a whole heading), the other readability metrics (a different
formula from RedHat's), `Spelling` hits in rules whose point is not misspelling
(`DenizenLabels`, `Archaisms`, `Diacritical`), `Polysyllables`, and
`E-Prime`'s be-verbs inside a passive phrase. `E-Prime`'s `am` also looked
covered, by `RedHat.TermsErrors`, but that rule is about AM/PM, so it stays.

Result over 119 files: 20 alerts are no longer flagged by anything, all of
them ALL-CAPS misspellings, because `RedHat.Spelling` skips all-caps words.
`ai-slop` alerts that sit inside a RedHat alert fell from 5,651 to 2,971, and
from 2,411 to 991 once coincidental RedHat rules are excluded.

**Time formatting, by request:** `AM` and `PM` are capitalized without periods,
and RedHat owns that (`RedHat.TermsErrors` rewrites `am`, `pm` and `Am`). The
proselint rules `DateCase` (which told you to use periods), `DateSpacing`,
`DateMidnight` and `DateRedundancy` were removed. `E-Prime`'s `am` now matches
only after "I", so a correct `9 AM` is no longer flagged. Accepted gap: nothing
flags `a.m.`, `p.m.` or `9am` now, because RedHat does not.

### Overlap kept on purpose

- Regex rules (`AbstractTriad`, `EpigramContrast`, `HiddenVerb`, `NegParallel`,
  `NeverTag`, `VirtueHonest`) and most overlap inside the tbhb rules are
  partial, not duplicate; each flags text nothing else does.
- Severity follows the rule that now owns a pattern. The folded `Cliche` and
  `boasts a/an` patterns moved from `suggestion` to `error`. `clearly`,
  `fairly`, `obviously` and `very` moved from write-good `warning` and
  proselint `error` to `ai-slop.Adverb` `suggestion`.
- `ai-slop` is now purged of what `RedHat` flags (pass 3). The remaining
  overlap is incidental: `Polysyllables` and `E-Prime` flag words that RedHat
  also flags for a different reason, and RedHat's term rules are case-sensitive
  in places, so a few patterns stay for sentence-initial or uppercase use.
  `So` and `ThereIs` partly overlap `RedHat.Conjunctions`, which only checks
  the first word of a paragraph, so they stay.
- Six krishnasunkam rules are document hygiene, not AI tells: `CodeToken`,
  `FilePath`, `LinkText`, `SectionCode`, `StatusBracket` (which also matches
  `[covered]` and `[required]`) and `WeakResume`.
