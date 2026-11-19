# WoW: Forever reference

Verified 2026-11-19 unless a line says otherwise. Each claim names its source.
Re-check a source before relying on a value that may have moved with a patch.

## Baseline

| Fact | Value | Source |
| --- | --- | --- |
| Game | World of Warcraft: Forever, launched 2026-11-04, a reimagined original Azeroth (levels 1-60) beside modern and Classic WoW | [Blizzard News](https://news.blizzard.com/en-us/article/24315820/world-of-warcraft-forever-goes-live-globally-november-4) |
| Patch / TOC interface | 1.60.1 / `16001` | [Patch 1.60.1/API changes](https://warcraft.wiki.gg/wiki/Patch_1.60.1/API_changes) |
| Game type | `camelot`; `forever` is an accepted alias in TOC suffixes, `[Game]`, and `AllowLoadGameType`. `WOW_PROJECT_CAMELOT` is 18 | same |
| Lua API | Modern retail (Midnight 12.1.5) namespaced APIs, with Forever additions and removals; Classic Era (1.15.x) addons do not just work | same; [wow-ui-source `12.1.5..forever` diff](https://github.com/Gethe/wow-ui-source/compare/12.1.5..forever) |
| AddOns folder | `World of Warcraft/_forever_/Interface/AddOns/<Name>/<Name>.toc`; saved variables under `_forever_/WTF` | [foreverbase](https://foreverbase.org/en/addons/install/), [games.gg](https://games.gg/world-of-warcraft/guides/wow-forever-addons-how-to-install-them-and-which-ones-work/) (secondary) |
| Access | Requires a WoW subscription or Game Time; no Forever free trial or Starter Edition announced | [Blizzard News](https://news.blizzard.com/en-us/article/24302093/carve-a-new-path-with-world-of-warcraft-forever); secondary guides |

## Addons (plugins)

- **Tutorial:** [Create a WoW AddOn in 15 Minutes](https://warcraft.wiki.gg/wiki/Create_a_WoW_AddOn_in_15_Minutes).
- **Manifest:** [TOC format](https://warcraft.wiki.gg/wiki/TOC_format). Folder and TOC names must match. Files load top to bottom. Use backslashes in paths.
- **API:** [World of Warcraft API](https://warcraft.wiki.gg/wiki/World_of_Warcraft_API); Blizzard UI source at [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source) (`forever` branch).
- **Forever changes:** [Patch 1.60.1/API changes](https://warcraft.wiki.gg/wiki/Patch_1.60.1/API_changes), including GUID obfuscation and nameplate changes; official [beta development notes](https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-november-2/2360696).
- **Secret values:** since 12.0 and in Forever, some combat APIs return secret values to addon code in combat, encounters, PvP, and restricted maps. See [Secret Values](https://warcraft.wiki.gg/wiki/Secret_Values).
- **Policy:** addons must be free and unobfuscated. [UI Add-On Development Policy](https://us.forums.blizzard.com/en/wow/t/ui-add-on-development-policy/24534).

### Dev loop

- Writing needs only an editor. Testing needs the game client and an active subscription; there is no official offline client.
- Edit in place, or symlink a repository into `_forever_/Interface/AddOns`.
- `/reload` reloads Lua and XML and detects new files and addons. Deleting or renaming an already loaded TOC needs a client restart ([TOC format](https://warcraft.wiki.gg/wiki/TOC_format)).
- Debug: `/dump <expr>`, `/fstack`, `/etrace`, `/console scriptErrors 1`, or BugSack.
- Editor: [Ketho/vscode-wow-api](https://github.com/Ketho/vscode-wow-api) adds API IntelliSense for LuaLS. It activates on a folder with a `.toc`. Forever-specific coverage is unverified.
- Addons are plain Lua, XML, and media: one artifact runs on Windows and macOS. Keep TOC file names case-exact.

### One package, many game types

From [TOC format](https://warcraft.wiki.gg/wiki/TOC_format); the wiki prefers the first two over per-type TOC files.

```toc
# Multi-client addon
## Interface: 120105, 16001
Shared.lua
ForeverOnly.lua [AllowLoadGameType camelot][ExcludeLoadGameType standard, classic]
[Family]\File.lua

# Forever-only addon instead
## Interface: 16001
## AllowLoadGameType: forever
## ExcludeLoadGameType: standard, classic
```

- Comma-separated `## Interface` values mark one TOC current for several clients.
- Inline `[AllowLoadGameType ...]` gates single files; `[Family]` and `[Game]` expand to the client's family or game type.
- Alternatively ship `Name_Forever.toc` (or `_Camelot`) beside other suffixed TOCs.
- For a Forever-only addon, add the exclude line: Standard and Classic clients may not recognize `forever`, and unrecognized types still load.
- Verify the running client with `/dump GetBuildInfo()`.

## Macros

- Tutorial: [Making a macro](https://warcraft.wiki.gg/wiki/Making_a_macro). Commands: [Macro commands](https://warcraft.wiki.gg/wiki/Macro_commands). Logic: [Macro conditionals](https://warcraft.wiki.gg/wiki/Macro_conditionals).
- 255-character limit. 120 account-wide plus 18 per-character macros ([Macro](https://warcraft.wiki.gg/wiki/Macro)).
- Macros run all lines at once and cannot wait. Most spells trigger the global cooldown, which stops later `/cast` lines.
- `#showtooltip` (lowercase) sets the icon and tooltip and accepts conditionals.
- `/castsequence` advances one entry per press.
- `/run` and `/script` execute Lua.
- Conditionals such as `[combat]`, `[mod:shift]`, and `[@mouseover,help]` give limited logic, not decision-making.

## Release to CurseForge

- **Project:** create one in the [CurseForge author console](https://authors.curseforge.com/#/projects/create/choose-game) ([guide](https://support.curseforge.com/support/solutions/articles/9000197241)). Upload a real `.zip` under 2 GB. Files start "Under Review" for moderators.
- **Visibility:** only approved Release or Beta files sync to the CurseForge App; alpha-only projects appear on the website only ([file types](https://support.curseforge.com/en/support/solutions/articles/9000197242-file-project-types-and-additional-fields)).
- **Automation:** [BigWigsMods/packager](https://github.com/BigWigsMods/packager) zips a Git checkout, builds a changelog from tags, and uploads to CurseForge, WoWInterface, Wago, and GitHub Releases.
  - Add `## X-Curse-Project-ID: <id>` to the TOC (the ID is in the project's "About Project" box).
  - Store a CurseForge API token as the secret `CF_API_TOKEN`; the GitHub token is `GH_API_TOKEN`. `release.sh` still reads `CF_API_KEY` and `GITHUB_OAUTH` but marks them deprecated, though the [workflow wiki](https://github.com/BigWigsMods/packager/wiki/GitHub-Actions-workflow) example still uses them.
  - Trigger on pushed annotated tags. Untagged builds are alpha. The workflow needs `contents: write` and `fetch-depth: 0`.
  - `release.sh` maps `16xxx` interfaces and `camelot` to the `forever` game type and recognizes `_Camelot.toc` files.

## Open questions

- Exact CurseForge API-token page path (the author console is a JavaScript app; unverified).
- When Blizzard renames `camelot`; the wiki says the value may change to `forever`.
- Whether Ketho's VS Code extension annotates Forever-only APIs.
