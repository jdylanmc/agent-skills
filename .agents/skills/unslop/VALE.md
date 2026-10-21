# Vale configuration

The package owns one curated [configuration](.vale.ini) and a local
[styles directory](styles/README.md). It ships with **zero active rules**,
no built-in `Vale` style, no third-party styles, and no packages to download.
The initial file sections cover Markdown and plain text.

## Run

Use an installed [Vale CLI](https://vale.sh/). Empty `BasedOnStyles` support
requires Vale 3.22.0 or later; check `vale --version` and `vale --help`.
The commands below also require `--no-global` so unrelated user-level styles
cannot leak into the curated check. If unsupported, report the limitation
rather than dropping the flag or changing global configuration.

Replace the placeholders with resolved absolute paths. Confirm each input
file exists: Vale can interpret a nonexistent path as prose instead.

```sh
vale --version
vale --no-global --config="/absolute/installed/unslop/.vale.ini" ls-config
vale --no-global --config="/absolute/installed/unslop/.vale.ini" --minAlertLevel=suggestion --output=JSON "/absolute/target/draft.md"
```

Use the same working directory for the baseline and final checks, especially
when a separately selected project configuration contains path-specific globs.
Inspect matching sections and active rules in the resolved configuration.
Verify the target is covered instead of treating an unrecognized format,
excluded file, or zero-rule configuration as checked.

For pasted text, write the exact original and final prose to session-owned
temporary `.md` or `.txt` files and lint those files. Do not interpolate prose
into shell commands. Keep the format and bytes faithful to the text returned.
Delete only the temporary files created for this run.

Capture both diagnostics and exit status. Vale's exit code follows errors;
warnings and suggestions can remain when it exits zero. Parse the JSON alerts
and report execution or configuration errors separately. Do not use `--no-exit`
or severity filtering to manufacture a passing result.

**Initially:** Vale may skip files because there are no enabled rules.
Report **"No Vale rules configured; editorial review only."** Do not describe
the empty result as lint coverage, even when the command succeeds.

## Curate later

Rule curation is a separate human-authorized change, not part of rewriting
a document to satisfy existing checks.

1. Agree on the pattern, scope, severity, and exceptions with the human.
2. Add a custom YAML rule under `styles/Unslop/`, with examples that should
   trigger and counterexamples that must remain valid.
3. Enable the approved rule explicitly, such as `Unslop.RuleName = YES`,
   under the relevant file section. Do not enable an entire external style
   as an incidental dependency.
4. Exercise both examples and counterexamples with Vale, including markup
   exclusions, and review the alerts before adopting the rule.

No example rule is shipped or enabled yet. The intent names possible future
checks, not a decision about their thresholds or implementation.
Do not edit the human-owned intent to accommodate a rule.

References: [configuration](https://docs.vale.sh/topics/.vale.ini),
[style selection](https://docs.vale.sh/keys/basedonstyles),
[custom rules](https://docs.vale.sh/topics/styles),
[CLI and output](https://docs.vale.sh/topics/cli).
