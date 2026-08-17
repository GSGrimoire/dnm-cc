# Dreams & Machines character creator: cumulative upgrade notes

This file is the cumulative setup and technical record. New releases go at the top. It is written for a developer reading cold, and it records what was deliberately left out as well as what shipped.

# v1.18 — Nanobarrier, damage buttons, charge logging

Append to `UPGRADE_NOTES.md`. Creator-only release; `dnm-obr` is unchanged and stays
at 0.7.0.

---

## Nanobarrier

Shipped at last. The blocker was never the escalating cost — that was in the rulebook
text carried in `DM_DATA` all along — it was the **reset boundary**, which the source
text does not state. Ruled: **scene**.

Because `startNewSession()` and `startNewAdventure()` both clear scene state, the
counter resets at all three boundaries without special-casing. The reset line was added
next to the existing `oncePerSceneUsed = []` in each, so a future boundary that copies
that pattern picks it up for free.

### Why it is not in LIMITED_USE_FEATURES

That table records **whether** something has been used. Nanobarrier needs **how many
times**, because the cost is derived from the count. Forcing it into a used-flag
structure would have been mechanically wrong, which is why it was excluded for so long
rather than approximated.

State lives in `character.nanobarrierUses`. Cost is simply the count:

| Uses so far | Next activation costs |
|---|---|
| 0 | Free |
| 1 | 1 Threat |
| 2 | 2 Threat |
| n | n Threat |

No ceiling. The rules do not state one.

### Three modes, one counter

Barrier, Shock and Display are separate buttons but share `nanobarrierUses`. The rules
gate the ability, not each option, so using Barrier makes the next Shock cost exactly
what the next Barrier would. All three relabel together after any activation.

### Logging

Paid activations go through `addThreat(cost, 'Nanobarrier — <Mode>')` and are logged by
the Threat bridge with that reason. A **free** activation moves no pool, so it uses
`logAction()` + `logActionNow()` instead. The two paths are mutually exclusive — a paid
use deliberately does **not** also call `logAction()`, which would post the same button
press to the shared log twice. There is a regression test for this.

### isTrackedFeature()

The four render sites gated on `LIMITED_USE_FEATURES[key]` directly, so anything absent
from that table fell through to plain description text with no controls. They now ask
`isTrackedFeature(key)`, because the question those sites actually want to answer is
"does this render controls", not "is this in that one table". Nanobarrier is the first
tracked feature that is not a limited-use feature; it will not be the last.

---

## Damage buttons

One button became six, one per Momentum, capped at 6 because the group pool cannot hold
more.

### Label format

`3 Momentum : 3 Damage`. Both numbers are named because they are not always equal.
**Precision Firepower** makes each Momentum worth +2 damage on a ranged attack with a
breaker weapon, so a flat "3 Damage" label would be wrong for that character — it is 6.

When the talent is present the damage side doubles and a note names the talent, so the
multiplier is visible rather than something the player has to remember to apply.

**Known limitation, accepted deliberately:** the talent only applies to *ranged* attacks
with a *breaker* weapon, and the sheet cannot know which weapon is being swung when the
button is pressed. It therefore reports the talent's ceiling. Overstating is the safer
error — the alternative is a player quietly under-spending because the sheet showed base
numbers for a case where the talent applied.

### Talent lookup

`c.talent` is sometimes a single key and sometimes an array, and growth adds more via
`growthExtraTalents`. Both shapes exist in saved characters. `getCharacterTalentKeys()`
flattens them once so no call site has to know, and `hasTalent()` reads from it.

---

## Charge/discharge logging

Ruled in, and straightforward: `toggleItemDischarged()` moves no shared pool, so it uses
an explicit `logAction()` + `logActionNow()` flush rather than riding along with a pool
write.

### The rest flood

Flagged before building, and real. `rechargePoweredItems()` recharges every eligible
Powered item at once, so a Bed rest on a well-equipped character could have posted six
or more entries from a single button press and buried the rest of the log.

`takeRest()` therefore posts **one** summary line: `Bed — regained 5 Spirit, recharged 2
items`. Individual item names still appear in the local toast, where they cost nobody
else anything. There is a test asserting exactly one entry from a bulk rest.

---

## Correction to the v1.17 notes

The backlog item **"log does not backfill on connect" was wrong** and has been removed.

`load()` in `roller.js` reads room metadata and seeds `state` from it, log included, and
`renderLog` merges that. A client connecting mid-session already receives the full log.

The original claim came from the v1.16 handoff and referred to **Ro's server feed** in
the standalone Shared Roll Room — the feature disabled in v1.17. It was propagated into
the v1.17 notes and into task tracking without being checked against the Owlbear path.
Worth confirming in play, but no code is expected.

This is the same failure the handoff warns about repeatedly: a claim written from a
prior description rather than from the code.

---

## Testing

jsdom, module block stripped. Four harnesses, all passing:

- Cost ladder 0/1/2/3; reset verified independently at `endScene`, `startNewSession` and
  `startNewAdventure`; modes confirmed to share one counter; no-op without the talent.
- Activation paths: free use logs once and adds no Threat; paid use adds the right Threat
  with the mode in the reason and does **not** double-log.
- Damage grid: six buttons, correct labels at base and with the talent, momentum side
  unchanged when damage doubles, affordability disabling at a given pool.
- Discharge logs one line each way; bulk rest logs exactly one summarised line.
- Regression: v1.17 features intact — room still disabled, `postRoll` still inert, five
  item actions, clamp suppression, section order, and the four other Momentum actions.

**Unchanged jsdom limits.** `OBR.isAvailable` is false, so the broadcast path and the
GM's metadata write are still only verifiable live. The harnesses reproduce the bridge's
logic; they do not exercise `OBR.broadcast`.

---

## Next: v1.19 with dnm-obr 0.8.0

The GM control panel. Rest and scene state lives inside each character's DM1 code, and
the extension deliberately never interprets character data. Broadcasting a reset reaches
only sheets that are currently open, which is almost none of them.

Agreed approach: the GM's press increments `epochs.scene` / `epochs.session` /
`epochs.adventure` in room metadata. Each character stores the epoch it last applied and
catches up when its sheet next opens. The reset becomes lazy and idempotent, the
extension stays ignorant of character internals, and a player who was offline still gets
their reset.

This changes the room metadata schema, so it needs `applyEvent` and `trimState` work in
`dnm.js` alongside the creator changes.

# **v1.17**.

## Deployment

The project lives in two GitHub Pages repos under the `gsgrimoire` account.

| Repo | File | Purpose |
|---|---|---|
| `dnm-cc` | `index.html` | The whole application. Character creator in a browser tab, in-play sheet inside Owlbear Rodeo |
| `dnm-cc` | `CHANGELOG.html` | Player-facing release history |
| `dnm-cc` | `UPGRADE_NOTES.md` | This file |
| `dnm-obr` | `dnm.js`, `roller.js`, `index.html`, `style.css`, `background.js`, `manifest.json` | The Owlbear Rodeo extension: roller popover, shared log, background page |

**The deployed filename is always `index.html`.** Earlier releases used versioned names, then `dnm-character-creator.html`. Neither exists in the repo now, and links to them 404. Versioned filenames have caused recurring confusion and should not come back: the release number lives in `APP_VERSION`, in the file's header comment, in `CHANGELOG.html`, and here.

From v1.17 the header comment on line 7 was corrected; earlier builds carried a stale reference to `dnm-character-creator.html`.

### Deploy order

From v1.17 onward, **extension files first, then the creator**. The creator broadcasts event types the extension has to understand. A creator-first deploy drops the new events silently and looks like it worked.

1. `dnm-obr` files to that repo's root
2. `dnm-cc/index.html`
3. `CHANGELOG.html` and `UPGRADE_NOTES.md`
4. Wait for Pages, hard-refresh, confirm the header version link before opening Owlbear
5. Full room reload. The background page is cached per room session

---

## v1.17 — the Rolls and Actions log

The player write test **passed** before this release: a player edited a sheet in an incognito window and the change was visible from the GM window. That clears the blocker recorded at v1.16.

### What this release is for

Rolls have travelled to the shared log since v1.12. Nothing else did. A player spent Momentum on a Counterattack, pushed Threat to send a Communicator message, or burned a once-per-scene ability, and the pools moved with no record of who moved them or why. The GM saw a number change.

v1.17 puts abilities, item uses and every pool change into the same log as rolls.

### Attribution, and why the accessor could not do it alone

The Momentum accessor bound in embedded mode catches all six write paths. That is why it cannot label them: it sits underneath the call sites and observes a number changing, not a reason. The property that made it correct in v1.15 is the property that makes it anonymous.

The design is two-sided:

1. **Call sites announce.** Each handler calls `logAction(label, detail)` immediately before mutating Momentum. This parks a label in `pendingActionLabel`.
2. **The accessor consumes, or invents.** The setter takes the parked label if there is one. If there is not, it still logs, as a bare `"spent 2 Momentum"`.

The second half is the important half. A Momentum path added later that nobody remembers to wire up produces an *unlabelled* entry rather than *no* entry. That is the inverse of the failure mode in the wrapped-`adjustResource()` attempt, where the five unwired paths were silent and the code looked correct while being wrong everywhere else.

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

`normalizeCurrentValues()` clamps `currentMomentum`, and embedded that field is an accessor bound to the room pool. Every clamp is a pool write. Loading a sheet whose Momentum sits above its current maximum would have announced a spend to the whole table that no player made.

`normalizeCurrentValues()` is now a thin wrapper calling `normalizeCurrentValuesInner()` inside `withPoolLogSuppressed()`. The whole function is wrapped rather than the single clamp line, so this stays correct if another resource is bound to the room later.

`withPoolLogSuppressed` saves and restores the previous flag value rather than setting it to `false` on exit, so nesting cannot clear a suppression it did not set.

### Threat already carried its reason

`addThreat(amount, reason)` has taken a reason since v1.15 and every call site passes a real one. The embedded bridge computed it, used it for the local toast, and dropped it from the broadcast. Carrying it through is most of what makes the Threat half of the log readable, and it cost one field.

Manual counter nudges log, by ruling. Their reason string changed from `'manual'` to `'manual adjustment'` so the entry reads properly on its own line.

### `logActionNow()`

For actions that announce but move no pool, a limited-use ability with no cost, nothing downstream is coming to consume the parked label. Without an explicit flush it would sit in `pendingActionLabel` and mislabel the next real spend. `logActionNow()` flushes and clears; standalone it only clears.

### Log entry shape

Action entries share `state.log` with rolls. Same dedupe by `id`, same `MAX_LOG_ENTRIES` cap, same `trimState` byte budget.

```js
{ id, t, kind: "action", who, label, detail, pool, delta }
```

They are not a second list. The log's value is one ordered record of what happened; two lists would need interleaving by timestamp at every consumer instead of once in `applyEvent`.

**A roll entry carries no `kind` at all**, including the entries already sitting in a live room's metadata from before v1.17. Consumers must treat *absent* `kind` as "roll" rather than requiring the field. `renderEntry` branches on `e.kind === "action"` and falls through to `renderRollEntry` otherwise.

This was not cosmetic. `renderEntry` read `e.detail.length`, `e.succ` and `e.diff` unconditionally. An action entry reaching the old renderer would have thrown and taken the whole feed down, rolls included. That is why `roller.js` and `style.css` shipped in this drop and not just `dnm.js`.

`who` prefers the character name and falls back to `OBR.player.getName()`, resolved once at start. A failed name lookup is non-fatal and never blocks an action.

### Item actions became buttons

Five items carry an `itemActions` entry, not four. The v1.16 handoff listed four because it described them as "the Threat items"; **Combat Medkit** spends Momentum rather than adding Threat and fell outside that phrasing.

| Item | Resource | Op | Value |
|---|---|---|---|
| Combat Automed | threat | add | 1 |
| Combat Medkit | momentum | spend | 1 |
| Communicator | threat | add | 1 |
| Emergency Trauma Kit | threat | add | 1 |
| Tactical Lens | threat | add | 1 |

Found by walking `DM_DATA.items` programmatically. All five are `type: "manualResourceChange"`.

`useItemAction()` funnels through `addThreat()` and a plain write to `currentMomentum`, the same two paths abilities use, so item actions reach the pools by the existing route with no parallel plumbing to keep in step. The Threat branch does not call `logAction()`, because `addThreat` announces with its own reason and would otherwise log the press twice.

An unaffordable Momentum action renders disabled rather than hidden: the item still has the ability, the character just cannot pay right now. The rules text stays below the button, because the button says what it costs but not when you may press it.

### Shared Roll Room disabled

`DM_API_BASE` is `''`, so `/api/roll`, `/api/stream` and `/api/tail` resolved against `gsgrimoire.github.io` and 404'd. The endpoint was to be hosted by Ro and is not going to be stood up. The panel offered a Connect button that could only ever fail.

Turned off behind `SHARED_ROOM_ENABLED = false`, **not deleted**. The wire format is a worked design: the POST contract, SSE with a polling tail as fallback, the feed renderer. Rebuilding it from nothing later would cost more than carrying a few hundred dormant lines. Setting the flag true and pointing `DM_API_BASE` at a live host is the whole of the work to restore it.

`postRoll()` gained an early return on the flag. A character saved before v1.17 can still carry a `roomCode` in its share code, and without the guard those characters would fire a failing POST on every roll forever.

This is unrelated to the in-Owlbear log, which needs no server: it rides the broadcast channel and is persisted to room metadata by the GM's background page.

### Start Over

There was no way out of a finished sheet except reloading the tab by hand.

`startOver()` navigates to `location.pathname` rather than resetting state in place. A reload is the only thing that reliably clears every module-level variable the creator accumulates during a build: `diceUI`, `roomState`, the scroll-restore scope map, `pendingThreat`. Resetting `state.character` alone leaves those behind.

Nothing is auto-loaded from `localStorage` at boot, since the local library is explicit with Load buttons, so a reload lands on an empty front page.

The confirm text differs depending on whether the character is already in the local library, because "you will lose this" is false when it is saved and worth saying plainly when it is not.

The button carries `.tab-only`, a new inverse of `.obr-only`: visible by default, hidden under `body.obr-embedded`. Embedded, the character lives on the token and "start over" would mean something destructive and unintended.

### Other changes

- Starting Equipment moved above the Item Catalogue in Inventory & Equipment.
- `CHANGELOG.html` rebuilt in the graphical v1.08 layout. Its back link points at `./` rather than a filename, because the old `./1.10.html` target 404s.

### Rulings settled

**New Adventure clears I Know a Guy, already true.** `startNewAdventure()` clears the `scene`, `session` and `adventure` boundaries, and `iKnowAGuy` is `reset: 'adventure'`. The v1.16 handoff carried this as an open question; the code answered it. No change shipped and the backlog item is closed.

### Still open

**Nanobarrier.** Deliberately still absent from `LIMITED_USE_FEATURES`. The escalating cost is in the rulebook text carried in `DM_DATA`: first use free, second 1 Threat, each subsequent +1. So the counter is straightforward. What does not exist anywhere in the source is a **reset boundary**. Treating it as a binary used flag would be mechanically wrong, and inventing a boundary would be worse. Blocked on a ruling: scene, session, or Bed.

`GLIF-Pattern Clothing` remains excluded for the separate reason that its limit is per machine, not per character.

**Log does not backfill on connect.** A player who joins late or reloads sees an empty feed. This mattered less when the log held only rolls; now that it is the session's record of actions, it matters more. The log is in room metadata, so the data exists. The gap is that a connecting client does not seed from it. Ruled a nice-to-have, not a blocker.

**Discharge is not logged.** `toggleItemDischarged()` moves no shared pool, so it sat outside the "changes Momentum or Threat" scope this release was built to. Ruled afterwards that it should log; not yet built.

### Testing

`applyEvent` was tested directly for action handling, dedupe, ordering and legacy roll entries lacking `kind`.

The creator was booted in jsdom with the module block stripped, and the accessor was reproduced around the real `state.character` to verify: labelled spends carry the ability name, unlabelled writes still log, gains read as gains, the `normalizeCurrentValues()` clamp is silent, and a flushed label does not leak into the next spend.

**Both jsdom limits from v1.16 still apply.** `OBR.isAvailable` is false and the transport cannot handshake, so the real broadcast path, frame detection and the GM's metadata write are **not verified in the harness** and can only be confirmed in a live room. The accessor test reproduces the setter's logic; it does not exercise `OBR.broadcast`.

---

## v1.16 — one file, and the SDK comes in-house

`APP_VERSION` and the header comment moved to `1.16`. Two things happened in this release: the Owlbear sheet and the character creator became one file, and the Owlbear SDK was bundled in.

### One file instead of two

Until v1.15 the extension carried its own character sheet (`sheet.html`, `sheet.js`, `sheet.css`, plus a generated `rules.js`), rebuilt from the code's snapshot. That sheet and the creator's own finished sheet were two implementations of the same thing, and they drifted. The bug that opened this session was exactly that: `sheet.js` wrote to a `#char-sub` element that `sheet.html` no longer had, which threw on the third line of `render()` and silently killed every section below it.

v1.16 embeds the creator itself in the Owlbear modal instead. One file detects its context and renders as either the full creator (browser tab) or the in-play sheet (Owlbear modal).

Mechanism:

- `OBR.isAvailable` decides the context. Not `window.self === window.top`, which was tried at v1.14, could not be tested in jsdom, and shipped broken.
- `body.obr-embedded` is added in embedded mode. `.obr-only` shows an element only when embedded; `.tab-only` (added v1.17) is its inverse.
- The token's metadata holds the DM1 code. Everything on screen derives from it and every edit rewrites it, so the code handed back at end of session is current by construction.
- Embedded, the sheet opens straight to the character rather than the import screen.

The five files supporting the old duplicate-sheet approach (`sheet.js`, `sheet.html`, `sheet.css`, `rules.js`, `build-rules.mjs`) were quarantined pending deletion rather than removed immediately.

### Why the SDK is bundled

Embedded mode was silently dead before this release. The symptom was misleading: the modal opened, the creator rendered, the import screen offered the local library, and edits persisted across a close and reopen, so it looked like a working sheet that had merely forgotten which character it was on. The persistence was `localStorage`, not the token. Nothing in the module block was running at all.

The cause was the SDK import. v1.13 used a static `import` from esm.sh and worked. v1.14 made it a lazy `import()` behind a frame check, to avoid fetching a CDN module for tab users who would never need it. Either way the file depends, at runtime, on a third-party script fetched from inside somebody else's iframe on somebody else's network. A Content Security Policy, a corporate proxy, a CDN outage or being offline each take embedded mode down, and each does it silently.

Bundling removes the dependency rather than working around it. From npm `@owlbear-rodeo/sdk@3.1.0`, bundled with esbuild as minified ESM, with the trailing `export{Zo as default}` replaced by `const OBR = Zo;`. An inline module cannot import from itself, so the default export becomes a plain binding in the block's scope. That substitution is the only edit to published code.

This also restores what the lazy import was for. There is now no request at all, so a tab user pays nothing, and the file works offline and from a downloaded copy, which the static import had broken and the lazy import only partly fixed.

**To update the SDK:** `npm install @owlbear-rodeo/sdk@<version>`, bundle with esbuild `--format=esm --minify`, swap the trailing export for `const OBR = Zo;`, and paste it over the block. Verified there are no identifier collisions between the minified bundle and the embedded block's own names.

Cost: the file grows from about 485 kB to 529 kB. One cached request, against a dependency that could not be relied on.

### Difficulty in roll entries, again

The roll bridge had been sending `diff: 0` with a faked verdict. It was fixed at v1.14, but the fix was applied to the *generated* file, and the next rebuild overwrote it, so `diff: 0` shipped for two versions. The fix now lives in `embed-block.html`, which is the source.

**Rule worth keeping: anything patched into a generated file is temporary.** Fixes go into the source or the build script.

### Verified, and not verified

Confirmed live: rolls reach the shared log, Momentum and Threat sync with the group pools, once-per-scene tracking holds, and the embedded sheet opens directly to the character.

Not verifiable in jsdom, and recorded as such at the time: frame detection, `OBR.isAvailable` behaviour, and whether a player's writes persist to the token in a way the GM can see. That last one was the release's open blocker, and it passed live before v1.17.

### Debugging note

When reading the console, set the context dropdown to the **extension frame** (the `gsgrimoire.github.io` entry), not the top Owlbear page. Two separate debugging rounds were lost to CSP errors that belonged to Owlbear's own page.

---

## v1.15 — Threat reaches the table

`APP_VERSION` and the header comment moved to `1.15`.

### What changed

New function `addThreat(amount, reason)`. Every Threat change in the app goes through it. Standalone it shows a toast, which is all it ever did; embedded, the module block replaces it to broadcast a `pool` event on the extension channel.

Wired to it:

- `useAdrenalineRush()`: 1/3/6 Threat for 1/2/3 Spirit. The amount was previously concatenated into the success toast; it is now a separate call.
- `useLimitedFeature('iKnowAGuy', 'threat')`: 2 Threat, held in `pendingThreat` and flushed only after `markLimitedFeatureUsed()` succeeds, so a feature that bails out partway does not push Threat for something that did not happen.

New `renderThreatCounter()` in the Resources grid, carrying `.obr-only` so it is present in the DOM always and visible only when embedded.

### Why a funnel rather than two call sites

Threat appears in this file about thirty times, and nearly all of it is rules prose in item and ability descriptions rather than a control the app drives: the Communicator's message, the Tactical Lens signal, Combat Automed's self-revive, Nanobarrier's escalating cost, several talents. Only two places are interactive.

Wiring those two and stopping would have left the other twenty-eight to be said out loud, which is the problem this release exists to fix. So there are two mechanisms: the funnel for the sources the app drives, and a manual +/− counter for everything printed in text. The counter is the honest answer to a rules surface that is mostly prose.

The funnel also means a Threat source added later is wired in both contexts by calling one function, rather than being wired standalone and forgotten embedded. That is the mistake the v1.14 Momentum bridge made in the other direction.

Five of those prose sources became buttons at v1.17.

### Momentum as a group pool, via an accessor

`DM_DATA` calls Momentum a group pool in two places: the Momentum resource text says the group can save up to 6, and the Circumspect drive refers to the group pool explicitly. Confirmed with the table: there is no personal pool, except that Momentum generated by a roll may be spent immediately by the roller.

Embedded, `currentMomentum` **is** the room's pool.

The first attempt overrode `adjustResource()`, which is what the counter's + and − buttons call. It caught one of six write paths and therefore looked correct while being wrong everywhere else. The others: `setResource()` from the number input, the direct `-=` in the three Momentum-spending abilities, the direct `=` in Adrenaline Rush, and the clamp in `normalizeCurrentValues()`.

Defining `currentMomentum` as an accessor property on the character object catches all of them, including any added later, because there is no way to write the field that does not go through the setter. `JSON.stringify` reads accessors normally, so `buildCharacterCode()` still serialises a plain number.

### Not applied locally, unlike Momentum

The Momentum accessor applies the change immediately and then broadcasts, because the player is spending their own resource and watching the counter respond. Threat waits for the GM's metadata update. It is announced to the table rather than spent by the player, the round trip is a few hundred milliseconds, and waiting keeps a single writer.

### Verified

Standalone: `addThreat` present, toast reads "Add 3 Threat — Adrenaline Rush", the Threat counter is in the DOM but carries `.obr-only`, and no network call is made on load.

Embedded: the counter reads the room's Threat on open; Adrenaline Rush at 2 Spirit broadcast `delta: 3`; the manual button broadcast `delta: 1`; a GM update setting Threat to 9 flowed back to the counter; and Momentum was untouched by any of it.

---

## v1.14 — rolling from the sheet

`APP_VERSION` and the header comment moved to `1.14`.

### What changed

- Attributes and Skills became pickable. Clicking one selects it for a test and highlights it. An Attribute shut down by Exhaustion cannot be picked.
- The Dice Roller moved up to sit directly beneath Attributes, Skills and Resources instead of near the bottom of the sheet.
- A Difficulty selector (D0–D5) was added beside the Roll button. The result now reports the verdict and the Momentum gained: "4 successes · Passed vs D2 · +2 Momentum".
- The share code block leads with Copy Code and Save Local, with the code itself in a small scrolling box below rather than filling the page.

### Why Difficulty mattered more than it looks

Momentum gained is successes beyond the Difficulty. Without a Difficulty the sheet could not report the one number a player acts on immediately after a test, and the roll bridge had been sending `diff: 0` with a faked verdict (passed on one or more successes, which matches D1, the commonest case). With the selector in place the embedded sheet and the roller popover produce identical log entries.

That fix was applied to the generated beta file and lost on the next rebuild. See v1.16.

### Build structure

From this release the live file is built from the previous live file, and the Owlbear beta is derived from the live file by appending the embed block. The beta is the live creator plus Owlbear support, by construction, so the two cannot drift during testing.

### The SDK import regression

v1.14 changed the SDK import from static to lazy `import()` behind a `window.self === window.top` frame check, to spare tab users a CDN fetch. The frame check could not be tested in jsdom and the lazy import inherited the same silent-failure mode as the static one. Both were replaced at v1.16 by a bundled SDK and `OBR.isAvailable`.

---

## v1.13 — snapshot v3, and the static/computed split

### What changed

`buildOwlbearSnapshot()` extended again. Snapshot payload version raised from `2` to `3`. `APP_VERSION` and the file header comment moved to `1.13`.

New helpers next to the builder: `snapshotTag()`, `snapshotTraitTag()`, `snapshotItemTags()`, `snapshotEffects()`, `snapshotResourceBreakdown()`.

New fields in the `SN` segment:

| Field | Source | Why |
| --- | --- | --- |
| `temperamentDrive`, `temperamentAttitude` | `temperaments[...].drive/.attitude` | The sheet shows all three temperament clauses, not just exhaustion |
| `archetypeGoal` | `archetypes[...].goals` | Shown in the identity band |
| `startingEquipment` | `archetypes[...].equipment` | Heads the inventory block |
| `originSpecialNote` | `origins[...].specialNote` | Sits under starting equipment as a warning |
| `coinMax`, `growthMax`, `momentumMax` | `getResourceMaxes()` | The consumer had been reading two of these off `CP` |
| `resourceBreakdown` | `getResourceModifierSources()` | The "equipped +N" footnote, resolved |
| `items[].powered` | `getPoweredQuality()` | Recharge tier, so a consumer can tell Breather from Bed |

### The decision this release turned on

The obvious way to finish the Owlbear sheet was to put everything it displays into `SN`. That was built, measured, and reversed.

Carrying full item text inline cost about **3.3 kB per owned item**, of which roughly 1.8 kB was tooltip text on the meta tags. A three-item character produced a 22.3 kB code, and the figure scaled with inventory rather than with the character. Every player carrying a spear was paying to repeat the same paragraph about spears.

The split now runs along one line: **does this value depend on the character?**

- **Yes** → `SN`. Attributes, skills, maxima, resolved talents and abilities, item facts, which items are owned.
- **No** → `rules.js` in the `dnm-obr` repo. Tooltip tables, full item descriptions, effect notes, rules and availability notes, and the action, limited-use and rest tables.

`rules.js` was generated by `build-rules.mjs`, which boots the creator in jsdom and reads `DM_DATA` directly. It was never hand-copied.

This is not the `DM_DATA` port rejected at v1.11. That would have moved the data used to *compute* a character, where drift produces wrong numbers. This moved display text with no computation attached, and a stale `rules.js` degrades to an item card without its expanded description, never to a wrong stat.

**Result:** codes came back to about 13.6 kB total, `SN` about 10.5 kB, and length stopped scaling with inventory. The per-item cost in the code is roughly 350 bytes of facts.

Measured before choosing: 26.7 kB `SN` with inline tooltips, 19.2 kB with tag keys, 10.5 kB with the static text published separately.

**Superseded at v1.16.** When the creator itself became the Owlbear sheet, the consumer gained direct access to `DM_DATA` and `rules.js` stopped being needed. It is quarantined with the other duplicate-sheet files. The `SN` segment and the split it produced remain in force, because the code still has to be readable by a consumer that is not the creator.

### Deliberately not resolved statically

`getEquipmentTraitInfo()` composes the Powered trait's text from the item it sits on: a powered weapon, a powered armor and the Illuminator each read differently. No flat table can answer that, so `snapshotTraitTag()` compares the resolved text against the static table entry and inlines it only when they differ. Every other trait travels as a key.

### Verified

Booted the edited file in jsdom, built a Spear/Tech/Stubborn character with three catalogue items chosen for coverage (a Powered weapon, an armor with equip effects, a multi-quality thrown weapon), generated a code, and confirmed snapshot `v: 3`, all new fields populated, and `parseCharacterCode()` reading its own output without error.

Round trip confirmed: edited exhaustion, quantity, equipped and discharged state on the token, re-read the emitted code in the creator, and confirmed every segment except `CP` was byte identical.

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

---

## v1.10
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

## v1.09
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

## v1.08
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

## v1.07
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

## v1.06
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

## v1.05
Released against v.1.04.

### Features and fixes

- Exhaustion now disables Dice Roller options that use the shut-down attribute.
- Exhausted attribute options are visibly struck through.
- The Roll button and roll execution both block tests using an exhausted attribute.
- Item Catalogue sub-filters prioritize Atoma or manufacturing category, with practical fallbacks.
- Character Share Code moved near the bottom and Growth moved to the final section for that release.

---

## v1.04
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

## v1.03
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
