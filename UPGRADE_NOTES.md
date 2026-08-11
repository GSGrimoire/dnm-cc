## v1.15 — Threat reaches the table
 
### What changed
 
`APP_VERSION` and the header comment moved to `1.15`.
 
New function `addThreat(amount, reason)`. Every Threat change in the app now goes
through it. Standalone it shows a toast, which is all it ever did; embedded, the module
block replaces it to broadcast a `pool` event on the extension channel.
 
Wired to it:
 
- `useAdrenalineRush()` — 1/3/6 Threat for 1/2/3 Spirit. The amount was previously
  concatenated into the success toast; it is now a separate call.
- `useLimitedFeature('iKnowAGuy', 'threat')` — 2 Threat, held in `pendingThreat` and
  flushed only after `markLimitedFeatureUsed()` succeeds, so a feature that bails out
  partway does not push Threat for something that did not happen.
New `renderThreatCounter()` in the Resources grid, carrying `.obr-only` so it is present
in the DOM always and visible only when embedded.
 
### Why a funnel rather than two call sites
 
Threat appears in this file about thirty times, and nearly all of it is rules prose in
item and ability descriptions rather than a control the app drives: the Communicator's
message, the Tactical Lens signal, Combat Automed's self-revive, Nanobarrier's escalating
cost, several talents. Only two places are interactive.
 
Wiring those two and stopping would have left the other twenty-eight to be said out loud,
which is the problem this release exists to fix. So there are two mechanisms: the funnel
for the sources the app drives, and a manual +/− counter for everything printed in text.
The counter is the honest answer to a rules surface that is mostly prose.
 
The funnel also means a Threat source added later is wired in both contexts by calling
one function, rather than being wired standalone and forgotten embedded. That is the
mistake the v1.14 Momentum bridge made in the other direction.
 
### Not applied locally, unlike Momentum
 
The Momentum accessor applies the change immediately and then broadcasts, because the
player is spending their own resource and watching the counter respond. Threat waits for
the GM's metadata update. It is announced to the table rather than spent by the player,
the round trip is a few hundred milliseconds, and waiting keeps a single writer.
 
### Verified
 
Standalone: `addThreat` present, toast reads "Add 3 Threat — Adrenaline Rush", the Threat
counter is in the DOM but carries `.obr-only`, and no network call is made on load.
 
Embedded: the counter reads the room's Threat on open; Adrenaline Rush at 2 Spirit
broadcast `delta: 3`; the manual button broadcast `delta: 1`; a GM update setting Threat
to 9 flowed back to the counter; and Momentum was untouched by any of it.
 
### Still open
 
- Item `itemActions` carrying `resource: "threat"` are rendered as descriptive notes, not
  controls, so the Communicator and Tactical Lens still need the manual counter. Making
  them buttons is the natural follow-up.
- Nanobarrier's escalating Threat cost is still an unresolved ruling and is not wired.


v1.14 — One file, two contexts
What changed
`APP_VERSION` and the header comment moved to `1.14`. Four sheet changes that apply
everywhere, one new mode that only activates inside a frame.
Sheet changes (both contexts):
`pickRollStat()` added. Attributes and Skills render with `.pickable` and an onclick
that selects them into `diceUI`. An exhausted Attribute refuses the click, because a
test against it auto-fails and the panel already blocks the roll.
`renderDicePanel()` moved in `renderSummaryStep()` from below Inventory to directly
after Resources, and given `id="dicePanelAnchor"` so `pickRollStat()` can scroll to it.
`diceUI.difficulty` added, with a D0–D5 selector beside the Roll button. `computeRoll()`
now returns `difficulty`, `passed` and `momentumGained`; `renderDiceResult()` shows the
verdict and the Momentum figure. This was load-bearing, not cosmetic: Momentum
gained is successes beyond the Difficulty, so without it the sheet could not report the
one number a player acts on immediately after a test.
`renderShareCodeSection()` puts Copy Code and Save Local above the code, and the code
in a fixed-height scroller.
Embedded mode (module block at the end of the file):
Detects that it is framed, loads the Owlbear SDK, and if `OBR.isAvailable`:
reads the DM1 code off the token named in `?item=`, loads it, and jumps to the
finalized play view
writes the rebuilt code back to token metadata after every edit, debounced 400 ms
replaces `postRoll()` so rolls broadcast on the extension's channel instead of
POSTing to Ro's server
binds `currentMomentum` to the room's shared pool
adds a header bar with save state, Copy Code, Detach and Close
Why one file rather than two
The alternative was a second sheet implementation in the extension repo, which is what
existed at v1.13. It duplicated the Actions table, the item catalogue, the rest tiers and
the roll engine, and every one of those was a drift risk. Embedding the creator deletes
the duplicate: the sheet a player sees at the table is the same code that built the
character, so it cannot fall behind.
The cost is that a load-bearing page now runs inside someone else's iframe. Three things
protect against that:
The mode is opt-in by context, not by build. `window.self === window.top` is
checked first, and in a normal tab the block returns before doing anything.
The SDK is imported dynamically, not statically. A static import would fetch from
esm.sh on every page load, including for someone who opened the creator offline or
from a downloaded copy — a round trip to load code that would then do nothing.
A failed import is caught. Framed by something that is not Owlbear, or a CDN
outage, logs a warning and leaves a working creator.
The Momentum fix, and why the first attempt was wrong
Momentum is a group pool: `DM_DATA`'s own resource text says the group can save up to 6,
and the Circumspect drive refers to the group pool explicitly. This file tracks it per
character anyway.
The first embedded implementation wrapped `adjustResource()`. That is what the counter's
`+` and `−` buttons call, so it appeared to work while being wrong everywhere else. There
are six write paths: `setResource()` from the number input, the direct `-=` in the three
Momentum-spending abilities, the direct `=` in Adrenaline Rush, and the clamp in
`normalizeCurrentValues()`.
Wrapping six functions would have failed the next time a seventh was added. Instead
`currentMomentum` is defined as an accessor property on the character object, so there is
no way to write the field that does not go through the setter. `JSON.stringify` reads
accessors normally, so `buildCharacterCode()` still serialises a plain number.
The setter applies locally before broadcasting. That is safe here and not in the roller:
this page never applies pool events from the broadcast channel, and the GM's metadata
update sets the value absolutely rather than as a delta, so there is nothing to double
count. `__setMomentumFromRoom` is non-enumerable and lets the GM's value in without the
setter treating it as a local spend.
Also fixed
`writeLocalLibrary()` had an unguarded `localStorage.setItem`. The read was wrapped, the
write was not, and it is called from `toggleExhaustion()` among others. Browsers partition
or refuse storage for embedded contexts, so inside a frame this threw and took the whole
handler down. Now guarded. This mattered regardless of Owlbear.
Open
`DM_API_BASE` is still `''`. The roll bridge bypasses it, but `joinRoom()` does not,
so the Shared Roll Room panel would resolve to a 404 relative to whatever origin serves
the page. Embedded mode hides that panel (`.dm-room-block`); standalone it is unchanged
and still depends on Ro's server.
Storage partitioning. An embedded creator will not see characters saved from a
normal tab, same origin or not. Codes remain the way a character crosses over.
The creator's standalone Momentum counter is still private. Correct for a solo
browser tab, wrong at a table; the embedded path is the one that is right. Worth
relabelling the counter as the group pool.
`sheet.js` / `sheet.css` / `sheet.html` in `dnm-obr` are now redundant if the
embedded creator proves out, along with `rules.js` and `build-rules.mjs`. They are kept
until it does.
Verified
Ran the file in both contexts under jsdom. Unframed and offline: zero network calls, no
`obr-embedded` class, no header bar, `currentMomentum` a plain field, click-to-roll and
the Difficulty selector working, D2 roll reporting the correct verdict and Momentum.
Framed with a stub SDK: character loaded from the token, header rendered, an ability spend
of 2 Momentum broadcast as `delta: -2` without touching a private counter, the GM's
absolute update accepted without echoing, a roll broadcast with real `diff`, `pass` and
`gain`, and the token rewritten. Momentum confirmed across all six write paths.

# Upgrade notes — v1.13

Append this section to `UPGRADE_NOTES.md`.

---

## v1.13 — Snapshot v3, and the static/computed split

### What changed

`buildOwlbearSnapshot()` extended again. Snapshot payload version raised from `2` to `3`.
`APP_VERSION` and the file header comment moved to `1.13`.

New helpers next to the builder: `snapshotTag()`, `snapshotTraitTag()`,
`snapshotItemTags()`, `snapshotEffects()`, `snapshotResourceBreakdown()`.

New fields in the `SN` segment:

| Field | Source | Why |
| --- | --- | --- |
| `temperamentDrive`, `temperamentAttitude` | `temperaments[...].drive/.attitude` | The sheet shows all three temperament clauses, not just exhaustion |
| `archetypeGoal` | `archetypes[...].goals` | Shown in the identity band |
| `startingEquipment` | `archetypes[...].equipment` | Heads the inventory block |
| `originSpecialNote` | `origins[...].specialNote` | Sits under starting equipment as a warning |
| `coinMax`, `growthMax`, `momentumMax` | `getResourceMaxes()` | The sheet had been reading two of these off `CP` |
| `resourceBreakdown` | `getResourceModifierSources()` | The "equipped +N" footnote, resolved |
| `items[].powered` | `getPoweredQuality()` | Recharge tier, so a consumer can tell Breather from Bed |

### The decision this release turned on

The obvious way to finish the Owlbear sheet was to put everything it displays into
`SN`. That was built, measured, and reversed.

Carrying full item text inline cost about **3.3 kB per owned item**, of which roughly
1.8 kB was tooltip text on the meta tags. A three-item character produced a 22.3 kB
code, and the figure scaled with inventory rather than with the character. Every player
carrying a spear was paying to repeat the same paragraph about spears.

The split now runs along one line: **does this value depend on the character?**

- **Yes** → `SN`. Attributes, skills, maxima, resolved talents and abilities, item
  facts, which items are owned.
- **No** → `rules.js` in the `dnm-obr` repo. Tooltip tables, full item descriptions,
  effect notes, rules and availability notes, and the action, limited-use and rest
  tables the next phase needs.

`rules.js` is generated by `build-rules.mjs`, which boots this file in jsdom and reads
`DM_DATA` directly. It is not hand-copied. **Regenerate it after any change to the item
catalogue or the rules text.**

This is not the `DM_DATA` port rejected at v1.11. That would have moved the data used to
*compute* a character, where drift produces wrong numbers. This moves display text with
no computation attached, and a stale `rules.js` degrades to an item card without its
expanded description — never to a wrong stat.

**Result:** codes are back to about 13.6 kB total, `SN` about 10.5 kB, and length no
longer scales with inventory. The per-item cost in the code is now roughly 350 bytes of
facts.

### Deliberately not resolved statically

`getEquipmentTraitInfo()` composes the Powered trait's text from the item it sits on: a
powered weapon, a powered armor and the Illuminator each read differently. No flat table
can answer that, so `snapshotTraitTag()` compares the resolved text against the static
table entry and inlines it only when they differ. Every other trait travels as a key.

### Open: Momentum is modelled twice

`DM_DATA` calls Momentum a group pool in two places — the Momentum resource text says
the group can save up to 6, and the Circumspect drive refers to the group pool
explicitly. This file nonetheless tracks `currentMomentum` and `momentumMax` per
character, and the sheet renders a private counter.

Confirmed with the table: there is no personal pool. Momentum is shared, except that
Momentum generated by a roll may be spent immediately by the roller.

The Owlbear sheet now reads and writes the shared room pool and mirrors the value back
into `currentMomentum` so a returning code is not stale. **This file has not been changed
to match**, and should be, either by relabelling the counter as the group pool or by
removing it. Left out of v1.13 because it is a creator UI change, not a code-format one.

### Verified

Booted the edited file in jsdom, built a Spear/Tech/Stubborn character with three
catalogue items chosen for coverage (a Powered weapon, an armor with equip effects, a
multi-quality thrown weapon), generated a code, and confirmed snapshot `v: 3`, all new
fields populated, and `parseCharacterCode()` reading its own output without error.

Measured every variant before choosing: 26.7 kB `SN` with inline tooltips, 19.2 kB with
tag keys, 10.5 kB with the static text published separately.

Round trip confirmed against the rebuilt extension: edited exhaustion, quantity,
equipped and discharged state on the token, re-read the emitted code in this file, and
confirmed every segment except `CP` was byte identical.

# Upgrade notes — v1.11 and v1.12

Append these two sections to `UPGRADE_NOTES.md`.

---

## v1.12 — Snapshot v2: abilities, descriptions, exhaustion

### What changed

`buildOwlbearSnapshot()` extended. Snapshot payload version raised from `1` to `2`.
`APP_VERSION` and the file header comment moved to `1.12`.

New fields in the `SN` segment:

| Field | Source | Why |
| --- | --- | --- |
| `originDesc`, `archetypeDesc`, `temperamentDesc` | `DM_DATA.origins/archetypes/temperaments[...].description` | The sheet's identity band shows these as tooltips |
| `temperamentExhaustion` | `temperamentData.exhaustion` | Shown in the temperament block |
| `abilities[]` | `getAbilities()` | Origin abilities, forced and chosen, with rules text |
| `exhaustionTypes[]` | `DM_DATA.exhaustionTypes` + `attributeInfo` | Four fixed types with the attribute each shuts down |
| `bonds[]` | now resolved through `DM_DATA.bondInfo` | Was raw `{name, type}`; now carries `typeName` and `desc` |

### Why this way

Exhaustion editing was deliberately withheld in v1.11. `activeExhaustion` holds keys
into `DM_DATA.exhaustionTypes`, and a consumer that cannot read that table has no safe
way to write the field. Rather than let the extension guess at key names and risk
writing a value the creator cannot read back, the table now travels with the code.

The alternative was porting `DM_DATA` to the consumer. Rejected for the same reason as
in v1.11: it duplicates rules data and guarantees drift.

`getAbilities()` is called defensively via `typeof getAbilities === 'function'`, so
reordering the script block cannot break code generation.

### Consequences

- Codes grow to roughly 9.4 kB, up from about 5.6 kB at v1.11. Still copy-paste safe.
- Snapshot `v` is now `2`. Consumers should treat a missing `exhaustionTypes` as
  "exhaustion unsupported" rather than an error, so v1 codes keep working.
- No change to `CP`, so the round trip is unaffected.

### Verified

Generated a code from a built character and confirmed `v: 2`, four exhaustion types
mapped to their attributes, abilities resolved with descriptions, and origin and
archetype description text present. Confirmed a v1 snapshot with `exhaustionTypes`
stripped degrades to "no exhaustion" without throwing.

---

## v1.11 — Owlbear Rodeo snapshot (`SN` segment)

### What changed

Added `buildOwlbearSnapshot()` and appended an `SN` segment to every character code.
`APP_VERSION` moved to `1.11`.

The segment carries computed, read-only values: `attrs`, `skills`, `techLevel`,
`spiritMax`, `supplyMax`, resolved `talents`, resolved catalogue `items`, plus name,
pronouns, portrait, truths, bonds and goals.

### Why this exists

A consumer outside this file cannot compute a character's stats. Deriving Might from
origin + archetype + temperament + growth needs `DM_DATA`, which is roughly 214 kB of a
445 kB file. Shipping a copy to the consumer would mean maintaining the same rules data
in two places, and the two would diverge the first time either was edited.

The creator already computes all of this in `computeStats()`. Writing the finished
numbers into the code lets a consumer read values without knowing the rules that
produced them, and keeps this file the single source of truth.

### Design constraints

**Derived only.** Live session values (`currentSpirit`, `injuries`, equipped and
discharged flags) are *not* duplicated into `SN`. They already ride in `CP`. Keeping
mutable state in exactly one place is what makes a round trip lossless: a consumer can
edit `CP` and re-emit the code without `SN` going stale.

**Appended last.** `parseCharacterCode()` reads segments by prefix from index 5 onward
and ignores unrecognised prefixes, so a code carrying `SN` still loads in v1.10 and
earlier. Forwards and backwards compatible.

**`fullDescription` dropped** from items. It is the largest field per item and a play
aid does not need the full rules text.

### Consequences

- Codes roughly doubled in length, from about 2.8 kB to 5.6 kB.
- Base64-of-URI-encoded inflates the payload about 2.1x. Kept anyway for consistency
  with the existing `CP` convention.

### Verified

Built a character in a stubbed browser, generated a code, decoded `SN` and confirmed
attributes, skills, spirit and supply maxima, tech level, talents by name and items
with quantity and equipped state. Confirmed the edited creator reparses its own code
with no error. Separately confirmed that editing `CP` and rebuilding leaves every other
segment byte-identical.
