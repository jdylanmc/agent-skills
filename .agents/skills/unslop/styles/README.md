# Vendored Vale styles

Copied unmodified from pinned releases, so nothing is fetched at run time.
Licenses and copyright notices live in the repository
[NOTICE](../../setup/NOTICE.md) and `licenses/`; do not add per-package copies.
Enable or disable rules in [`.vale.ini`](../.vale.ini), never by editing these
files. See [VALE.md](../VALE.md).

| Style | Source | Release | Release zip sha256 | Rules |
| --- | --- | --- | --- | --- |
| `RedHat` | [redhat-documentation/vale-at-red-hat](https://github.com/redhat-documentation/vale-at-red-hat) | v680 | `c8bf6824e7f9f4fbbfc29ae017f0f1553922a5d24a3aafd5e3795bca57008992` | 37 |
| `proselint` | [vale-cli/proselint](https://github.com/vale-cli/proselint) | v0.3.4 | `48b1fb481ba44f6505d44346b283f6cdc74efd234f913bbdb09bf34420fab81c`* | 34 |
| `Readability` | [vale-cli/readability](https://github.com/vale-cli/readability) | v0.2.0 | `cf8790677bb2ef86458c1d1dbd6e646fd8063c0e9621f81141e5cd85e5e41f81` | 8 |
| `ai-tells` | [tbhb/vale-ai-tells](https://github.com/tbhb/vale-ai-tells) | v1.37.0 | `f8d1e981abbfbac1aa092d1623a1ac9bc935f0b15e8071e7a072915abddf0570` | 137 |
| `AiTells` | [krishnasunkam/vale-ai-tells](https://github.com/krishnasunkam/vale-ai-tells) | v1.0.0 | `eee9417ef656b5e9d1aaa76fd850c003c4a99856bcee787b6436a91a3fc1c03c` | 17 |
| `write-good` | [vale-cli/write-good](https://github.com/vale-cli/write-good) | v0.4.1 | `2960ef10861ddc7dc76292a4967eb3789bf05ca24f862042f6d15f53332887f0`* | 8 |

\* The release publishes no digest; recorded from the downloaded asset.

Local differences from the release zips:

- `ai-tells` ships its files under `ai-tells/styles/`; they are placed directly
  in this directory, which includes `config/templates/ai-tells-agent.tmpl`.
- `Readability/LICENSE` is dropped in favor of the single canonical license
  entry in `licenses/`.
