# Intent: changelog

Changelog exists because release history in this repository should be useful to a person deciding what changed, whether to upgrade, and what to watch for.

The skill maintains a root `CHANGELOG.md` that follows Keep a Changelog 1.1.0 without turning the standard into a commit-log formatter. Git commits, pull requests, and closed issues are evidence, not prose to dump. The valuable result is a curated set of reader-facing entries that explain externally meaningful change in the terms of someone using the skill library.

The workflow balances automation with curation. Evidence can suggest entries, groups, versions, dates, and comparison links, but each proposed entry carries its source trail and stays unpublished until a human approves the exact wording and target write. Unsupported claims stay out of the changelog.

The changelog format remains predictable: latest version first, `Unreleased` at the top, Semantic Versioning, ISO 8601 release dates, linkable sections, release comparison links, and the Keep a Changelog categories Added, Changed, Deprecated, Removed, Fixed, and Security. Deprecations are surfaced as deprecations instead of disappearing into removals or generic changes.

The skill is not a release-note generator for Cacophony or a replacement for any automated release system. Its role is to curate a human changelog that can feed or reconcile with generated release notes so two descriptions of the same release do not drift apart.