# Operator's addons

Addons the operator uses in WoW: Forever. Support verified 2026-11-19 from each
CurseForge page; licenses verified 2026-11-19 from repository license files and
CurseForge project pages. Add, drop, or correct entries only through an
approved reinforcement. Licensing rules are in [REFERENCE.md](REFERENCE.md#licensing).

## Reusable source

Code may be copied or adapted under the stated license.

| Addon | Source | License | Forever evidence | Purpose |
| --- | --- | --- | --- | --- |
| OpenMap | [GitHub](https://github.com/openmap-world/openmap), [CurseForge](https://www.curseforge.com/wow/addons/openmap) | MIT; map art is Blizzard's and excluded | `OpenMap.toc` Interface 16001 plus `OpenMap_Mainline.toc` | Seamless zoom-and-pan world map in the original art style |
| What's Training? | [GitHub](https://github.com/fusionpit/WhatsTraining), [CurseForge](https://www.curseforge.com/wow/addons/whats-training) | MIT | One TOC: `Interface: 20506, 16001, 11509` with inline `[AllowLoadGameType camelot]`; `Classes/Camelot/` data | Abilities and items available from class and profession trainers |
| Forever Loot Sparkles | [GitHub](https://github.com/svengabr/ForeverLootSparkles), [CurseForge](https://www.curseforge.com/wow/addons/forever-loot-sparkles) | GPL-3.0: derivatives must be GPL-3.0 with notices and source | Interface 16001; Forever only | Keeps quest-item loot sparkles when graphics presets hide them |
| Questie | [GitHub](https://github.com/Questie/Questie), [CurseForge](https://www.curseforge.com/wow/addons/questie) | GPL-3.0 by maintainer statement; `LICENSE.md` warns older contributions may be "all rights reserved"; name and logo excluded | `Questie_Forever.toc` Interface 16001; `FOREVER_WORK_LEFT_TO_DO.md` | Quest givers, objectives, and turn-ins on the map |

## Reference only

Read, link, and learn; do not copy code.

| Addon | Source | License | Purpose |
| --- | --- | --- | --- |
| Forever Unit Frames | [GitHub](https://github.com/StephanRosin/forever-unit-frames), [CurseForge](https://www.curseforge.com/wow/addons/forever-unit-frames) | No license file; CurseForge All Rights Reserved | Configurable player, target, focus, pet, party, and raid frames |
| MinimapButtonButton | [GitHub](https://github.com/syndenbock/MinimapButtonButton), [CurseForge](https://www.curseforge.com/wow/addons/minimapbuttonbutton) | All rights reserved, personal use only (`MinimapButtonButton/LICENSE.md`) | Collects minimap buttons into one button |
| Naowh Forever (Dungeon Journal) | [CurseForge](https://www.curseforge.com/wow/addons/naowhforever); linked GitHub repo returns 404 | All Rights Reserved | Forever dungeon journal, BiS lists, training planner. Assumed match for "Dungeon Journal"; confirm |
| Auctionator | [CurseForge](https://www.curseforge.com/wow/addons/auctionator); no public repo | All Rights Reserved | Auction House search, shopping lists, price tracking |
| Baganator | [CurseForge](https://www.curseforge.com/wow/addons/baganator); no public repo | All Rights Reserved; requires Syndicator | Category or single-view bags |
| Syndicator | [CurseForge](https://www.curseforge.com/wow/addons/syndicator); no public repo | All Rights Reserved | Item tracking and search across characters' bags, banks, mail, auctions, and guilds |
| Leatrix Plus | [CurseForge](https://www.curseforge.com/wow/addons/leatrix-plus); no public repo | All Rights Reserved | Modular quality-of-life options; separate `-forever` file |
| TomTom | [CurseForge](https://www.curseforge.com/wow/addons/tomtom); source hosted on CurseForge git, not inspected | All Rights Reserved | Waypoint arrow and coordinates |
| Forever Ultimate Graphics (FUG) | [CurseForge](https://www.curseforge.com/wow/addons/forever-ultimate-graphics); no public repo | All Rights Reserved | Unlocks maximum graphics through hidden CVars |

Public GitHub copies of Leatrix Plus, MinimapButtonButton, and Naowh Forever
from other accounts are unofficial and grant no rights.

## Worth studying

- **Forever Unit Frames** (reference only): `Core/Secrets.lua` wraps
  `issecretvalue` with pass-through helpers; `tests/` runs about 400 headless
  Lua tests against a mocked API.
- **Questie** (GPL-3.0): one TOC per game type, Lua tests, luacheck, and
  CurseForge/Wago upload scripts.
- **OpenMap** (MIT): Forever plus Mainline TOCs, `@project-version@` packager
  token, GitHub Actions release and test workflows.
- **What's Training?** (MIT): single multi-client TOC using inline game-type
  directives.
- **Forever Loot Sparkles** (GPL-3.0): small CVar example that re-applies a
  setting after graphics presets and defers changes until combat ends.
- **plusmouse** (Auctionator/Baganator/Syndicator author) publishes MIT repos
  under [TheMouseNest](https://github.com/TheMouseNest): Journalator,
  Collectionator, LibAHTab, Baganator-Example-Skin.
