# Dreams & Machines Character Creator: cumulative upgrade notes

This file is the cumulative setup and technical record for the character creator. New releases are added at the top. Beginning with version v.1.09, the application and documentation use stable filenames. From version 1.10 the release number is dropped from the `v.` prefix and written as `1.10`.

## Current deployment files

| File | Purpose |
|---|---|
| `dnm-character-creator.html` | Character creator and finished character sheet |
| `CHANGELOG.html` | Short player-facing release history |
| `UPGRADE_NOTES.md` | Cumulative setup, migration, and implementation notes |

Keep all three files in the same web directory. The creator links to `./CHANGELOG.html`, and the changelog links back to `./dnm-character-creator.html` and to `./UPGRADE_NOTES.md`.

From v.1.09 onward, do not add the release number to these filenames. Record the release number in the creator's header comment, `APP_VERSION`, `CHANGELOG.html`, and this file instead. This prevents existing links from breaking with each deployment.

---

## Version 1.10

Released against v.1.09.

### Setup and deployment

1. Replace `dnm-character-creator.html` in place. Filenames do not change.
2. `CHANGELOG.html` and `UPGRADE_NOTES.md` are updated in the same release and belong in the same directory.
3. No storage migration is required. The browser library key remains `dm_character_creator_library_v1`.
4. `DM1` share codes from v.1.09 import without loss. Characters saved in v.1.10 carry one new field, `limitedUseAbilities`, which older builds ignore.
5. From this release the version number is written once, in `APP_VERSION`, and stamped into the header link at load. Earlier releases carried it as literal markup in two places, which had already drifted: the link read `Version v.1.09` while the constant read `v.1.10`. Do not hard-code it again.

### Limited-use abilities

Five abilities and talents have an explicit use limit in the rules and are now tracked rather than described. Each has a Use control, a used state, and a boundary that clears it.

| Key | Feature | Source | Boundary that clears it |
|---|---|---|---|
| `haggler` | Haggler | River Origin | Bed rest |
| `justWhatTheyNeed` | Just What They Need | River Origin | New Session |
| `iKnowAGuy` | I Know a Guy | Fixer talent | New Adventure |
| `ambush` | Ambush | General talent | End Scene |
| `tough` | Tough | General talent | End Scene |

State is stored as `limitedUseAbilities`, an object keyed by boundary rather than a single flat array of used keys. A flat array cannot answer "which of these does a Bed rest clear", which is the only question the reset code ever asks.

```
limitedUseAbilities: {
  scene: [], breather: [], break: [], bed: [], session: [], adventure: []
}
```

Two features take an argument rather than a plain Use:

- Just What They Need offers 1, 2, or 3 Supply Points, and a Mark Used Only control for tables that recorded the cost by hand. The Supply Point buttons disable when the character cannot afford them.
- I Know a Guy offers Spend 2 Momentum or Add 2 Threat. Threat is not tracked here, so that control marks the ability used and states the cost.

All of these use the existing three-second, two-click confirmation pattern.

### Boundary controls

`Boundaries & Rest` in the sheet header now holds six controls. The three rest controls behave as in v.1.09.

| Control | Clears |
|---|---|
| End Scene | once-per-scene actions, scene-length effects, scene-limited abilities |
| New Session | everything End Scene clears, plus session-limited abilities |
| New Adventure | everything New Session clears, plus adventure-limited abilities |

New Session and New Adventure exist because those boundaries have no automatic trigger. A rest does not imply either one, and neither substitutes for a rest: New Adventure does not restore Spirit or recharge Powered items.

### Identity header layout

Tech Level moved from the right-hand play-controls column into the name row, right-aligned opposite the character name. It is a single number that does not change during play, so it reads as identity rather than as a play control, and moving it lets the Rest buttons sit directly under the portrait instead of being pushed down by a 3rem numeral.

Its tooltip opens downward. On the top line of the panel an upward tooltip is clipped by the panel edge.

Origin, Archetype, and Temperament tags now stack vertically, each hugging its own text, matching the Rest button column. The identity column is sized to its content instead of holding a 150px minimum, so the three Goals boxes absorb the freed width.

### Identity tag tooltips

These tooltips previously printed the type label in both the title and the body, so hovering the Archetype tag produced "Archetype / Archetype". The body now carries the description from `DM_DATA`, which exists for every Origin, Archetype, and Temperament. Where no description exists the body is omitted rather than rendered empty, so the tooltip degrades to a bare title.

Two supporting changes were required. The tooltip box widened from 180px to 300px, because a 300-character description at 180px renders as a tall thin column; and it anchors to the tag's left edge instead of its midpoint, because a centred 300px box on a short tag such as `RIVER` hangs off the left of the sheet.

### Re-render continuity

`renderStep()` rebuilds the active view by assigning `innerHTML`. That keeps rendering a pure function of state and is worth keeping, but it cost continuity: every `<details>` reverted to its markup default and the document got shorter, so any button that triggered a re-render collapsed the panels the player had open and jumped the viewport. Equip and Discharge were the most visible cases, but the behaviour affected every re-render, including rests and confirmations.

The open and closed set, and the scroll offset, are now captured immediately before the swap and reapplied immediately after, synchronously, so nothing paints in between. The alternative was targeted DOM updates per handler, which means tracking exactly which fragments each of roughly thirty handlers can touch and getting it wrong on the next change.

Implementation points worth knowing before editing this code:

- Keys are derived from content, not position: summary text, the nearest labelled ancestor, and an occurrence counter for repeats. Position-based keys shift the moment a list gains or loses a row, which is precisely the case this has to survive.
- Both directions are restored. A `<details open>` in the markup that the player deliberately closed stays closed through a re-render.
- Scroll is restored only when the view is unchanged. Moving between steps, or finalizing, legitimately changes what the player is looking at, and those paths scroll to top themselves.
- An element's class list is part of its key, because a card's classes encode its state. Two cards with the same name but different state are different rows and must not inherit each other's open flag.

### Exhaustible feature coverage

`EXHAUSTIBLE_FEATURE_INVENTORY.md` audited version 1.09 and split its findings into features that need a binary used flag and features that need a richer state shape. Version 1.10 implements the binary set in full. The rest remain deliberately untracked, and are recorded here so that a later release does not rediscover them.

A re-scan of all 92 named Origin abilities, Archetype talents, advanced Archetype talents, and general talents in the current `DM_DATA` returns eleven with limiting language. Five are tracked as limited-use, one is tracked by a different mechanism, and five are excluded for the reasons below. There are no untracked limits remaining and no tracked keys without a matching feature.

| Feature | Why it is not in `limitedUseAbilities` |
|---|---|
| `spearsBlend` | Tracked, but as a scene-length effect in `activeSceneEffects`, not a spent use. It is administered, not exhausted. |
| `glifPatternClothing` | The once-per-scene limit applies separately to each affected machine, not to the character. A global Use control would disable it after one machine and apply the rule incorrectly. Reminder-only is correct until per-target tracking exists. |
| `juryRig` | "Functions for the rest of the adventure" is the duration of the repair, not a limit on the talent. A false positive on keyword scanning. |
| `iHeardARumor` | A scene-opening opportunity rather than a cooldown. Its cost is Threat, which is not tracked here, so a used flag would add bookkeeping without preventing anything. |
| `nanobarrier` | Needs a use counter, not a flag: first use free, second costs 1 Threat, each subsequent use +1. The reset boundary is not stated in the shortened `DM_DATA` description and must be confirmed from the rule source before this can be built. This is the one open ruling carried forward from the v1.09 inventory. |

The following remain reminder-only for the same reason as in v.1.09: each needs metadata that owned items, Injuries, Truths, or bonds do not currently carry, and clearing them automatically from plain-text fields would silently destroy player data.

| Area | Blocked on |
|---|---|
| Fast Friends temporary bond | Bond entries store only name and type, with no temporary marker or Bed lifecycle |
| Make Do and Mend refund | Owned items do not record which were created with Supply Points, or at what cost |
| Treated and Non-Lethal Injuries | Injuries are plain strings and cannot distinguish treated from untreated |
| Never Unarmed, Mech Breaker | No one-use item instance and no consumed-Truth state |
| Ammo consumption | Fourteen items carry the `Ammo` quality; stacks have a quantity stepper but no Use control that spends one |
| First Aid Kit (Tech Level 2) | `DM_DATA.uses` is 3, but owned entries store stack quantity only and cannot hold partial charges |
| Supply-Point-created Powered items | No provenance flag, so the rest cascade can recharge an item that should not recharge |
| Rapid Charge, Inductive Chargers, Wireless Computer Hub | All need target selection and a pending-recharge state |
| Combat Automed, Combat Medkit, Communicator, Emergency Trauma Kit, Tactical Lens | `DM_DATA.itemActions` already describes the resource change for five items, but no handler executes it |

The Powered equipment tier counts are unchanged from the v1.09 audit and were re-verified against this build: 5 Breather, 20 Break, 13 Bed, 5 Special or manual, 2 continuous and not dischargeable.

---

## Version v.1.09

Released against v.1.08.

### Setup and deployment

1. Upload `dnm-character-creator.html`, `CHANGELOG.html`, and `UPGRADE_NOTES.md` to the same directory.
2. Replace links to `1.08.html` or earlier versioned creator filenames with `dnm-character-creator.html`.
3. Existing versioned files may remain as historical copies, but the public link should point to the stable filename.
4. Browser local saves continue to use the existing `dm_character_creator_library_v1` storage key.
5. Existing `DM1` share codes remain the import format. The full payload now carries the new v.1.09 fields.

### Actions, Talents & Abilities

The finished sheet now includes a default-open `Actions, Talents & Abilities` section. The left column contains expandable action cards. The right column retains Origin Abilities and Talents.

The thirteen core action cards are:

1. Attack
2. Counterattack
3. Avoid Danger
4. Confront Problem
5. Define Truth
6. Adrenaline Rush
7. Complications
8. Second Wind
9. Create Truth
10. Ask a Question
11. Damage
12. Reduce Time
13. Follow-Up

Attack, Avoid Danger, Confront Problem, and Complications are reference cards because they do not directly change a tracked sheet value. Define Truth can add a Truth field without spending Momentum because its Skill Test is resolved at the table.

The following controls use the three-second, two-click confirmation pattern because they alter a shared or limited resource:

- Counterattack: spends 2 Momentum.
- Adrenaline Rush: restores 1, 2, or 3 Spirit and displays the required Threat increase.
- Second Wind: spends 1, 3, or 6 Momentum and targets either the character or an ally.
- Create Truth: spends 2 Momentum and adds a blank Truth field.
- Ask a Question: spends 1 Momentum.
- Damage: spends 1 Momentum for each +1 damage purchase.
- Reduce Time: spends 2 Momentum to represent halving the duration.
- Follow-Up: spends 2 Momentum.

Second Wind's Ally controls spend Momentum without changing the owning character's Spirit. The ally's sheet is not connected to this sheet.

Threat remains a gamemaster-held pool and is not tracked by this creator. Adrenaline Rush and Complications therefore display Threat changes without modifying a Threat counter.

### Once-per-scene state

Adrenaline Rush becomes unavailable after use. `End Scene` clears:

- `oncePerSceneUsed`
- `activeSceneEffects`

End Scene does not change Spirit, Supply Points, Momentum, Coin, Growth, Truths, Injuries, or item state.

The once-per-scene and active scene-effect arrays are included in local saves and share codes. This prevents reloading the page from refreshing an action unintentionally.

### Spear's Blend and automatic Spirit bonuses

Characters with the `spearsBlend` Origin Ability receive an additional expandable action card.

- Activating Spear's Blend spends 1 Supply Point.
- The effect remains active until End Scene.
- While active, Adrenaline Rush restores +1 additional Spirit, subject to the normal Spirit maximum.

This activation step is required because Spear's Blend is administered at the start of a conflict scene. Possessing the ability alone does not make the benefit permanently active.

The `Bold` talent is also applied automatically when Adrenaline Rush is used. A momentary notification explains any bonus from Bold or Spear's Blend. If the character has a Rivalry Bond, the notification also reminds the player that the bonded ally gains 1 Spirit.

### Rest and recovery

The finished sheet header contains confirmed controls for:

| Control | Base Spirit recovery |
|---|---:|
| Breather | 2 |
| Break | 4 |
| Bed | 6 |

Recovery is clamped to maximum Spirit. The `Wanderer` talent is applied automatically, changing the values to 3, 6, and 9 respectively.

Rest controls also recharge owned Powered item stacks according to this cascade:

| Rest taken | Recharge tags cleared |
|---|---|
| Breather | Powered (Breather) |
| Break | Powered (Breather), Powered (Break) |
| Bed | Powered (Breather), Powered (Break), Powered (Bed) |

Powered (Special) is never cleared by a rest. It must be toggled manually when its special recharge condition has been met.

### Powered item state

Catalogue item stacks now store a `discharged` Boolean value. The value applies to the whole stack, as agreed for v.1.09.

- Powered (Breather), Powered (Break), Powered (Bed), and Powered (Special) items show a Charged or Discharged toggle.
- Plain `Powered` items, such as the Stylus and Weaver Lens, do not show a toggle because they cannot normally be discharged.
- The Illuminator does show a toggle. It cannot normally be discharged deliberately, but may be discharged by complications, environmental effects, sabotage, or similar events.
- Powered (Special) items can be marked charged or discharged manually, but rest buttons ignore them.
- Discharge state is included in local saves, share codes, and printed character state.

Powered tooltips now depend on item category:

- Powered weapons explain the additional Injury effect.
- Other Powered items explain the fixed die and 2 bonus Momentum effect.
- Recharge timing is appended from the item's Powered tag.

There is no `made with Supply Points` flag in v.1.09. A Powered item that was created with Supply Points will therefore follow its displayed recharge tag unless the players handle that exception manually.

### Spirit and Supply Point initialization fix

Version v.1.08 could set current Spirit and Supply Points to zero during the first render. At that point no Origin or Archetype existed, so the computed maximum was zero. Once zero was written, later renders treated it as a real value.

Version v.1.09 changes this behavior:

- Spirit and Supply Points remain `null` during character creation.
- The Summary preview displays the calculated maximum without writing it into state.
- Finalizing seeds Spirit and Supply Points only when their current values are still `null`.
- Returning to character editing does not overwrite values earned or spent during play.

The Supply reset control restores:

```text
Operate + Origin modifier + Archetype modifier
```

It intentionally excludes direct Growth purchases that increase Supply Points and equipped item bonuses such as Handy armor. A Growth increase to the Operate skill is part of the current Operate value and therefore affects the reset target.

Existing v.1.08 saves containing zero cannot be migrated safely because zero may represent either the old initialization fault or a legitimate in-play value. The application does not guess. Use Bed to restore Spirit and the Supply reset control to restore Supply Points when repairing an affected save.

### Custom Items

Custom Items is a separate subsection under Owned Items. It stores plain single-line text for story objects and module-specific possessions that are not catalogue items.

- Typing into the final blank line creates another blank line.
- Empty entries are removed when the field loses focus.
- Entries are included in local saves and share codes.
- Custom Items have no quantity, equipped state, or automated rules.

### Knowledge Fragments

Knowledge Fragments are tracked as an auto-growing free-text list inside Resources.

- The list uses a fixed-height scroll area to prevent it from making the Resources section disproportionately tall.
- Fields use the same text styling as Truths and Injuries.
- There is no Remove button. Clearing a field removes the empty entry.
- Entries are included in local saves and share codes.

### Truths

`Character Truths` is relabeled `Truths` because location, situation, personal, and equipment Truths may all be relevant on the sheet.

- The manual add control is labeled `Create Truth`.
- The Truth tooltip explains the four Truth types.
- Define Truth can add a field without a Momentum cost.
- Create Truth spends 2 Momentum and adds a field.

### Finished sheet layout

The finished sheet reading order is now:

1. Full-width character name, followed by identity tags, Goals and Archetype, portrait, Tech Level, and play controls
2. Bonds and Temperament
3. Exhaustion States
4. Truths and Injuries
5. Attributes
6. Skills
7. Resources, including Knowledge Fragments
8. Actions, Talents & Abilities
9. Inventory & Equipment, including Custom Items
10. Dice Roller and Shared Roll Room
11. Growth
12. Character Share Code

Temperament expands to full width when the character has no Bonds. The redundant finished-sheet version label and duplicate `TL` value were removed. End Scene, Breather, Break, and Bed are vertically stacked. The Supply reset control and Knowledge Fragment inputs were widened.

### Persistence fields added or extended

```javascript
customItems: []
knowledgeFragments: []
oncePerSceneUsed: []
activeSceneEffects: []
items: [{ id, qty, equipped, discharged }]
```

Older saves and share codes default missing arrays to empty arrays and missing discharge state to `false`.

### Verification performed

- JavaScript syntax validation of the complete inline script
- Fifty-eight automated state and rendered-markup assertions
- Finalization and played-down resource preservation
- Supply reset target with Growth Supply purchases present
- All thirteen core actions and Counterattack presence
- Momentum costs and self versus ally Second Wind behavior
- Adrenaline Rush lock and End Scene reset
- Spear's Blend activation and Bold bonus application
- Breather, Break, and Bed recharge cascade
- Powered (Special) manual-only behavior
- Plain Powered exclusion and Illuminator inclusion
- Powered weapon and Powered item tooltip split
- Local rendering of the revised identity and play-control markup
- Share-code round trips for every new state field

---

## Version v.1.08

Released against v.1.07.

### Features and fixes

- Added equipped state to owned catalogue items.
- Added structured equipped resource modifiers, situational reminders, and manual item actions.
- Applied equipped item effects to derived values, including maximum Supply Points where relevant.
- Added fuller item descriptions, rules notes, availability notes, and effect notes to expandable owned items.
- Expanded equipment category, property, quality, Tech Level, rarity, and manufacturing tooltips.
- Added editable current values for Spirit, Supply Points, Coin, Growth, and Momentum.
- Added editable Truth and Injury fields on the finished sheet.
- Improved catalogue scrolling, floating tooltip placement, clear-search behavior, and section layout.
- Improved dark and light printable sheet output.

### Compatibility note

The v.1.08 Spirit and Supply Point initialization fault is repaired in v.1.09 but is not retroactively guessed for existing zero values. See the v.1.09 migration note above.

---

## Version v.1.07

Released against v.1.06.

### Features and fixes

- Added a Character Portrait Web Address field in Character Info.
- Added live portrait preview and a fixed portrait frame on the finished sheet.
- Persisted `portraitUrl` through full payloads, imports, share codes, and local saves.
- Restricted portrait addresses to `http://` and `https://` and added Clear Portrait behavior.
- Expanded Supportive and Rivalry Bond tooltips with their mechanical effects.
- Added disclosure indicators and improved spacing to owned item rows.
- Removed repeated metadata from expanded owned item content.
- Fixed Item Catalogue search focus loss by updating only the item grid while typing.

### Implementation notes

- Portrait image bytes are not embedded in character data.
- Browser-side `object-fit: cover` handles the visible crop.
- Image hosts may block external display. Failed loads do not corrupt character data.
- Characters without `portraitUrl` default to an empty value.

---

## Version v.1.06

Released against v.1.05.

### Features and fixes

- Added the standalone player-facing changelog.
- Linked the header version label to the changelog.
- Added Back to Character Creator links.
- Moved Growth to the second-to-last finished-sheet section.
- Moved Character Share Code to the bottom.
- Fixed Item Catalogue sub-filter refresh when the main category changes.

### Implementation notes

- The changelog is static and works when kept beside the creator.
- Catalogue refresh replaces the full catalogue block when category controls must change.

---

## Version v.1.05

Released against v.1.04.

### Features and fixes

- Exhaustion now disables Dice Roller options that use the shut-down attribute.
- Exhausted attribute options are visibly struck through.
- The Roll button and roll execution both block tests using an exhausted attribute.
- Item Catalogue sub-filters prioritize Atoma or manufacturing category, with practical fallbacks.
- Character Share Code moved near the bottom and Growth moved to the final section for that release.

---

## Version v.1.04

Released against v.1.03.

### Features and fixes

- Added multiple local character saves using browser local storage.
- Added finalized character mode with an Edit Character return path.
- Moved Character Share Code into a collapsible finished-sheet section.
- Limited character-code import controls to the opening screen.
- Added mutable Spirit, Supply Points, Coin, Growth, and Momentum session values.
- Expanded equipment trait and property tooltips.
- Made Item Catalogue and Starting Equipment collapsible.
- Added clickable Exhaustion States and visible affected-attribute styling.
- Made owned inventory entries expandable.

### Save behavior

Browser local storage is convenient but tied to the browser and site origin. Share codes remain the portable backup. Clearing site data removes local saves.

---

## Version v.1.03

Released against the earlier creator build.

### Features and fixes

- Added full skill names and attribute and skill tooltips.
- Added the inlined item catalogue with search, filters, and quantity tracking.
- Added Exhaustion States and their affected attributes.
- Added the client-side Dice Roller.
- Added shared roll room support through `/api/roll`, Server-Sent Events, and a polling fallback.
- Added the standalone `/room/<code>` view contract.
- Added collapsible Character Share Code output.
- Fixed character-code base64 padding so names, goals, items, and full-state payloads import reliably.

### Server note

The character creator itself works client-side. Shared roll rooms require the companion server endpoints. With `DM_API_BASE` set to an empty string, the creator expects those endpoints on the same origin.
