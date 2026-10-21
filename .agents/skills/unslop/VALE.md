# Vale configuration

The package owns one [configuration](.vale.ini) and a [styles
directory](styles/README.md) of six vendored packages pinned to exact releases:
RedHat, proselint, Readability, ai-tells, AiTells, and write-good. They are
copied in, so there is no `vale sync` and no download at run time. The built-in
`Vale` style is not enabled. File sections cover Markdown and plain text.

## Run

Use an installed [Vale CLI](https://vale.sh/). Verified with Vale 3.24.0; check
`vale --version`. The commands below require `--no-global` so unrelated
user-level styles cannot leak into the check. If unsupported, report the
limitation rather than dropping the flag or changing global configuration.

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

If the resolved configuration enables no rules for the target, Vale skips the
file. Report **"No Vale rules configured; editorial review only."** Do not
describe an empty result as lint coverage, even when the command succeeds.

Expect noisy first results. Packages overlap (several flag em dashes and
"not X, but Y"), some contradict each other, and Readability reports every
long word. Report, do not suppress, what is found.

## Curate

Pruning is a separate human-authorized change, not part of rewriting a
document to satisfy existing checks.

1. Agree on the rule, scope, severity, and exceptions with the human.
2. Disable a rule in `.vale.ini` under the file section, for example
   `RedHat.Contractions = NO`, or turn a whole package off by removing it from
   `BasedOnStyles`. Do not edit vendored files in place; they must stay
   byte-identical to the pinned release.
3. For a new rule of our own, add a YAML file under `styles/Unslop/` with
   examples that should trigger and counterexamples that must remain valid, and
   enable it explicitly.
4. Re-run Vale on both kinds of example and review the alerts before adopting.

Do not edit the human-owned intent to accommodate a rule.

References: [configuration](https://docs.vale.sh/topics/.vale.ini),
[style selection](https://docs.vale.sh/keys/basedonstyles),
[custom rules](https://docs.vale.sh/topics/styles),
[CLI and output](https://docs.vale.sh/topics/cli).
