# v1.17 — The Rolls and Actions Log

Append to `UPGRADE_NOTES.md`. Ships alongside `CHANGELOG.html` v1.17 and a rebuilt
`dnm-obr` (`dnm.js`, `roller.js`, `style.css`, `index.html`).

The player write test **passed** before this release: a player edited a sheet in an
incognito window and the change was visible from the GM window. That was the decisive
step, and it clears the blocker recorded in the v1.16 handoff. The quarantined files in
`_pending-deletion/` are held only until v1.17 is confirmed working in play.

---

## What this release is for

Rolls have travelled to the shared log since v1.12. Nothing else did. A player spent
Momentum on a Counterattack, pushed Threat to send a Communicator message, or burned a
once-per-scene ability, and the pools moved with no record of who moved them or why.
The GM saw a number change.

v1.17 puts abilities, item uses and every pool change into the same log as rolls.

---

## Attribution, and why the accessor could not do it alone

The Momentum accessor bound in embedded mode catches all six write paths. That is
precisely why it cannot label them: it sits *underneath* the call sites and observes a
number changing, not a reason. The property that made it correct in v1.15 is the same
property that makes it anonymous.

The design is therefore two-sided:

1. **Call sites announce.** Each handler calls `logAction(label, detail)` immediately
   before mutating Momentum. This parks a label in `pendingActionLabel`.
2. **The accessor consumes, or invents.** The setter takes the parked label if there is
   one. If there is not, it still logs — as a bare `"spent 2 Momentum"`.

The second half is the important half. It means a Momentum path added later that nobody
remembers to wire up produces an *unlabelled* entry rather than *no* entry. That is
deliberately the inverse of the failure mode that shipped in the wrapped-`adjustResource()`
attempt, where the five paths nobody wired were silent and the code looked correct while
being wrong everywhere else.

Wired call sites, verified against source rather than from memory:

| Handler | Label |
|---|---|
| `useSecondWind` | Second Wind |
| `spendMomentumForAction` | Counterattack, Ask a Question, Damage +1, Reduce Time, Follow-Up |
| `createTruthWithMomentum` | Create Truth |
| `useLimitedFeature` (`iKnowAGuy`, momentum option) | I Know a Guy |
| `useAdrenalineRush` | Adrenaline Rush |
| `useItemAction` (new) | *item name* — *action label* |

### The clamp had to be silenced

`normalizeCurrentValues()` clamps `currentMomentum`, and embedded that field is an
accessor bound to the room pool. Every clamp is a pool write. Loading a sheet whose
Momentum sits above its current maximum would have announced a spend to the whole table
that no player made.

`normalizeCurrentValues()` is now a thin wrapper calling `normalizeCurrentValuesInner()`
inside `withPoolLogSuppressed()`. The whole function is wrapped rather than the single
clamp line, so this stays correct if another resource is bound to the room later.

`withPoolLogSuppressed` saves and restores the previous flag value rather than setting it
to `false` on exit, so nesting cannot clear a suppression it did not set.

### Threat already carried its reason

`addThreat(amount, reason)` has taken a reason since v1.15 and every call site passes a
real one. The embedded bridge computed it, used it for the local toast, and dropped it
from the broadcast. Carrying it through is most of what makes the Threat half of the log
readable, and it cost one field.

Manual counter nudges log, by ruling. Their reason string changed from `'manual'` to
`'manual adjustment'` so the entry reads properly on its own line.

### `logActionNow()`

For actions that announce but move no pool — a limited-use ability with no cost — nothing
downstream is coming to consume the parked label. Without an explicit flush it would sit
in `pendingActionLabel` and mislabel the *next* real spend. `logActionNow()` flushes and
clears; standalone it only clears.

---

## Log entry shape

Action entries share `state.log` with rolls. Same dedupe by `id`, same `MAX_LOG_ENTRIES`
cap, same `trimState` byte budget.

```js
{ id, t, kind: "action", who, label, detail, pool, delta }
```

They are not a second list. The log's value is one ordered record of what happened; two
lists would need interleaving by timestamp at every consumer instead of once in
`applyEvent`.

**A roll entry carries no `kind` at all** — including the entries already sitting in a
live room's metadata from before v1.17. Consumers must therefore treat *absent* `kind` as
"roll" rather than requiring the field. `renderEntry` branches on `e.kind === "action"`
and falls through to `renderRollEntry` otherwise.

This was not cosmetic. `renderEntry` read `e.detail.length`, `e.succ` and `e.diff`
unconditionally. An action entry reaching the old renderer would have thrown and taken
the whole feed down.

`who` prefers the character name and falls back to `OBR.player.getName()`, resolved once
at start. A failed name lookup is non-fatal and never blocks an action.

---

## Item actions became buttons

Five items carry an `itemActions` entry, not four. The v1.16 handoff listed four because
it described them as "the Threat items"; **Combat Medkit** spends Momentum rather than
adding Threat and fell outside that phrasing.

| Item | Resource | Op | Value |
|---|---|---|---|
| Combat Automed | threat | add | 1 |
| Combat Medkit | momentum | spend | 1 |
| Communicator | threat | add | 1 |
| Emergency Trauma Kit | threat | add | 1 |
| Tactical Lens | threat | add | 1 |

Found by walking `DM_DATA.items` programmatically. All five are
`type: "manualResourceChange"`.

`useItemAction()` funnels through `addThreat()` and a plain write to `currentMomentum` —
the same two paths abilities use — so item actions reach the pools by the existing route
with no parallel plumbing to keep in step. The Threat branch does not call `logAction()`,
because `addThreat` announces with its own reason and would otherwise log the press twice.

An unaffordable Momentum action renders disabled rather than hidden: the item still has
the ability, the character just cannot pay right now. The rules text stays below the
button, because the button says what it costs but not when you may press it.

---

## Shared Roll Room disabled

`DM_API_BASE` is `''`, so `/api/roll`, `/api/stream` and `/api/tail` resolved against
`gsgrimoire.github.io` and 404'd. The endpoint was to be hosted by Ro and is not going to
be stood up. The panel offered a Connect button that could only ever fail.

Turned off behind `SHARED_ROOM_ENABLED = false`, **not deleted**. The wire format is a
worked design — the POST contract, SSE with a polling tail as fallback, the feed renderer
— and rebuilding it from nothing later would cost more than carrying a few hundred dormant
lines. Setting the flag true and pointing `DM_API_BASE` at a live host is the whole of the
work to restore it.

`postRoll()` gained an early return on the flag. A character saved before v1.17 can still
carry a `roomCode` in its share code, and without the guard those characters would fire a
failing POST on every roll forever.

This is unrelated to the in-Owlbear log, which needs no server: it rides the broadcast
channel and is persisted to room metadata by the GM's background page.

---

## Start Over

There was no way out of a finished sheet except reloading the tab by hand.

`startOver()` navigates to `location.pathname` rather than resetting state in place. A
reload is the only thing that reliably clears every module-level variable the creator
accumulates during a build — `diceUI`, `roomState`, the scroll-restore scope map,
`pendingThreat`. Resetting `state.character` alone leaves those behind.

Nothing is auto-loaded from `localStorage` at boot (the local library is explicit, with
Load buttons), so a reload genuinely lands on an empty front page.

The confirm text differs depending on whether the character is already in the local
library, because "you will lose this" is false when it is saved and worth saying plainly
when it is not.

The button carries `.tab-only`, a new inverse of `.obr-only`: visible by default, hidden
under `body.obr-embedded`. Embedded, the character lives on the token and "start over"
would mean something destructive and unintended.

---

## Rulings settled

**New Adventure clears I Know a Guy — already true.** `startNewAdventure()` clears the
`scene`, `session` and `adventure` boundaries, and `iKnowAGuy` is `reset: 'adventure'`.
The v1.16 handoff carried this as an open question; it was answered by the code. No change
shipped, and the backlog item is closed.

---

## Still open

**Nanobarrier.** Deliberately still absent from `LIMITED_USE_FEATURES`. The escalating
cost *is* in the rulebook text carried in `DM_DATA` — first use free, second 1 Threat,
each subsequent +1 — so the counter is straightforward. What does not exist anywhere in
the source is a **reset boundary**. Treating it as a binary used flag would be
mechanically wrong, and inventing a boundary would be worse. Blocked on a ruling: scene,
session, or Bed.

`GLIF-Pattern Clothing` remains excluded for the separate reason that its limit is per
machine, not per character.

**Log does not backfill on connect.** A player who joins late or reloads sees an empty
feed. This mattered less when the log held only rolls; now that it is the session's record
of actions, it matters more. The log is in room metadata, so the data exists — the gap is
that a connecting client does not seed from it.

**Discharge is not logged.** `toggleItemDischarged()` moves no shared pool, so it sits
outside the "changes Momentum or Threat" scope this release was built to. Worth revisiting
if the table wants it.

---

## Testing

`applyEvent` was tested directly for action handling, dedupe, ordering and legacy roll
entries lacking `kind`.

The creator was booted in jsdom with the module block stripped, and the accessor was
reproduced around the real `state.character` to verify: labelled spends carry the ability
name, unlabelled writes still log, gains read as gains, the `normalizeCurrentValues()`
clamp is silent, and a flushed label does not leak into the next spend.

**Both jsdom limits from v1.16 still apply.** `OBR.isAvailable` is false and the transport
cannot handshake, so the real broadcast path, frame detection and the GM's metadata write
are **not verified here** and can only be confirmed in a live room. The accessor test
reproduces the setter's logic; it does not exercise `OBR.broadcast`.


# Upgrade notes — v1.16

Append this section to `UPGRADE_NOTES.md`.

---

## v1.16 — The SDK comes in-house

### What changed

`APP_VERSION` and the header comment moved to `1.16`. The Owlbear SDK is bundled into
the file. There is no longer any network request on load, in either context.

### Why

Embedded mode was silently dead. The symptom was misleading: the modal opened, the
creator rendered, the import screen offered the local library, and edits persisted across
a close and reopen — so it looked like a working sheet that had merely forgotten which
character it was on. The persistence was `localStorage`, not the token. Nothing in the
module block was running at all.

The cause was the SDK import. v1.13 used a static `import` from esm.sh and worked. v1.14
made it a lazy `import()` behind a frame check to avoid fetching a CDN module for tab
users who would never need it. Either way the file depends, at runtime, on a third-party
script fetched from inside somebody else's iframe on somebody else's network. A Content
Security Policy, a corporate proxy, a CDN outage or being offline each take embedded mode
down, and each does it silently.

Bundling removes the dependency rather than working around it. From npm
`@owlbear-rodeo/sdk@3.1.0`, bundled with esbuild as minified ESM, with the trailing
`export{Zo as default}` replaced by `const OBR = Zo;` — an inline module cannot import
from itself, so the default export becomes a plain binding in the block's scope. That one
substitution is the only edit to published code.

This also restores what the lazy import was for. There is now no request at all, so a tab
user pays nothing, and the file works offline and from a downloaded copy — which the
static import had broken and the lazy import only partly fixed.

**To update the SDK:** `npm install @owlbear-rodeo/sdk@<version>`, bundle with esbuild
`--format=esm --minify`, swap the trailing export for `const OBR = Zo;`, and paste it over
the block. Verified there are no identifier collisions between the minified bundle and the
embedded block's own names.

Cost: the file grows from about 485 kB to 529 kB. One cached request, against a dependency
that could not be relied on.

### Also fixed: rolls were losing their Difficulty

The roll bridge was sending `diff: 0`, `pass: successes > 0` and `gain: 0` on every roll,
so a shared log entry from the sheet never matched one made in the roller popover.

This was a regression I introduced. The fix existed at v1.14, applied directly to the
derived file. When the build changed so that the beta is generated from a shared embed
block, the edit was not in the block and was overwritten on the next rebuild. The fix is
now in `embed-block.html`, which is the only place it can survive a rebuild.

Worth generalising: **anything patched into a generated file is lost.** Every edit belongs
in the source the generator reads.

### Verified

Tab, offline, with the real bundled SDK rather than a stub: zero network calls,
`OBR.isAvailable` false, no `obr-embedded` class, no header bar, import screen up, sheet
renders 15 sections, Difficulty control and click-to-roll present, Threat toasts without a
pool, Momentum still a plain field.

Embedded: character loaded from the token, header rendered, import screen hidden, Momentum
read from the room, Threat counter showing the room's value, a Momentum spend and an
Adrenaline Rush broadcast as `-2` and `+3`, a roll broadcast carrying its real Difficulty,
and the token written. The emitted code reparses with only `CP` changed.

### Still open

The two-player test is still not done. Everything so far has been one browser. Whether a
non-GM can write item metadata to their own token is the question that gates deleting
`sheet.js`, `sheet.css`, `sheet.html`, `rules.js` and `build-rules.mjs`.


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


## v1.14 — One file, two contexts
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
