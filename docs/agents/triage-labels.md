# Triage labels

Provider representation: GitHub labels in `jdylanmc/agent-skills`.

| Canonical role | Label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation needed |
| `needs-info` | `needs-info` | Waiting for missing information |
| `ready-for-agent` | `ready-for-agent` | Specified work eligible for agent delivery |
| `ready-for-human` | `ready-for-human` | Human implementation needed |
| `wontfix` | `wontfix` | Will not be actioned |

Use these values when a skill names a canonical role. Preserve unrelated labels.
Apply `ready-for-agent` only through the calling workflow's authorization, with
no unresolved human-owned scope decisions. Dependencies and ownership still
govern dispatch.

The human approved this vocabulary. `wontfix` already exists; the other four
labels were absent when inspected. This mapping does not create remote labels
or authorize labeling #251. Handle missing labels explicitly in an authorized
tracker operation; never substitute another label silently.
