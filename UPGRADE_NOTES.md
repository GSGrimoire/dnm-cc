# Dreams & Machines character creator: cumulative upgrade notes

This file is the cumulative setup and technical record. New releases go at the top. It is written for a developer reading cold, and it records what was deliberately left out as well as what shipped.

# v2.1 / 1.1 — Put the sheet where you want it

Creator **v2.1**, extension **1.1**. Both change; deploy the extension first. No room
metadata schema change, and no change to the character code format.

A number on both halves: several deliberate changes, one of which the table could not do
before. All of it comes from Gus's QA of 2.0.

## What Owlbear actually allows, settled

Asked whether we could build Roll20's fully movable sheet. The answer is no, and it is
structural rather than a matter of effort, so it is written down here to stop it being
re-litigated.

Roll20 IS the page. Its sheet is a div it owns, so it can be absolutely positioned and
dragged like any other element. Ours is a separate site in an iframe Owlbear creates and
places. We control everything inside the frame and nothing about where it sits.

Checked against all twelve APIs in SDK 3.1.0, which npm confirms is the current release:

| API | geometry it exposes |
|---|---|
| Popover | open, close, getWidth, setWidth, getHeight, setHeight |
| Modal | open, close. Nothing else, not even size |
| Action | the right-hand drawer: size only, Owlbear owns the position |

**There is no setPosition anywhere**, and `anchorPosition` is read once at open. So size
is live and free; position costs a close and a reopen, which reloads the sheet.

The workaround that looks promising and is not: a full-screen modal with no backdrop, our
own floating sheet drawn inside it. It fails on the map. Our frame would cover everything,
and `disablePointerEvents` makes the frame transparent to hit-testing entirely — content
in a different document cannot re-enable itself from the inside. You get a draggable sheet
over a dead map, or a live map under a dead sheet. That last step is reasoning about
pointer events rather than a room test, and is the one part of this worth proving before
anyone acts on it.

## Nine anchors instead of three sides

`DOCK_SIDES` becomes `DOCK_ANCHORS`, a 3x3 grid. Placing the sheet was always "reopen at
these coordinates", so the anchor is only which coordinates, and six more of them cost
almost nothing.

`anchorParts()` splits an anchor into its horizontal and vertical halves, and each half
picks both the anchor point and the `transformOrigin` corner. That corner is what pins a
panel to its edge: one held by its RIGHT corner grows leftwards under `setWidth`, one held
by its left corner walks off the screen.

**A 1.0 dock still opens where it used to, and that needed care.** Each old side implied a
size the stored object did not hold: a side dock was full height whatever its stored
height, and the bottom dock was full width whatever its stored width. Carrying the anchor
across without that fill would have silently shrunk a bottom dock from the whole width to
560px. `LEGACY_SIDES` restores the axis each side used to fill. A dock carrying both
`side` and `anchor` is a 1.1 dock and its own size wins.

**The one invariant: the panel may fill either axis but never both.** That is what lets a
full-height panel sit beside the map and a full-width one sit below it, and guarantees
some map is always reachable. Width is decided first and height gives way, so the result
does not depend on which edge was dragged last — a geometry that answered differently for
the same stored dock would be impossible to test.

## Resize by dragging, zoom by pressing

The `−` and `+` buttons resized the panel. They were the wrong control and they crowded a
header that was already collapsing, so they now zoom instead, and resizing is a drag.

- **Resize** uses `setWidth`/`setHeight`, which do not reload. `resizeEdges()` returns
  only the edges facing into the screen, because the others are against the window;
  corners appear where two of them meet. `setWidth` is called once per animation frame,
  not once per `pointermove` — a move event fires far faster than a frame can be drawn and
  each call is a real message across the SDK bus.
- **Zoom** is CSS `zoom` on `#app`, which reflows the layout at the new scale. A transform
  would keep the original 1280px layout and add horizontal scrolling, which is the
  opposite of what is wanted. It never touches the popover.

The drag measures from the panel's REAL width, not the stored one: a stored height of 4000
means "fill", and dragging from 4000 would throw the edge off the screen on the first
pixel.

## Rolls from the roller reach the sheet

Recent Rolls was written in exactly one place, by a roll made on this sheet, so the same
character's rolls lived in two places depending on where they were made.

`reconcileRolls()` reads the ROOM LOG rather than listening for broadcasts, on purpose:
the log is already the shared record, already sanitised by the extension's
`sanitizeEntry()` before anything is written, and reading it catches up rolls made while
the sheet was closed. A broadcast listener would only ever see rolls made while it
happened to be open.

Matching is by character NAME through `bondNameKey()`, because that is what the roller
knows — it has a token's character name, not a character id — and reusing the bond
normaliser keeps one rule for "is this me" rather than two.

Three rules that are not obvious:

- **Every roll now carries an id**, stamped once in `doRoll()` and used by both the local
  record and the entry broadcast to the room. Without that a sheet's own roll would come
  back from the log as a stranger and be listed beside itself.
- **A concealed roll is skipped.** The roller decides who may draw one, and quietly
  copying it onto a sheet would be a way around that decision.
- **An unnamed character picks up nothing**, or it would match every unnamed roll at the
  table.

Everything here crossed a broadcast channel open to the whole room, so every field is
clamped on the way in as well as on the way out.

## Smaller things from the same QA

- **The header is two rows.** At 380px the single row put the character name under Copy
  code and clipped BOTTOM to BOTTO. The identity row gives way first, because the sheet
  below it already says whose it is.
- **`.btn` is smaller in the embedded sheet below 700px.** It is sized for the standalone
  page — 0.95rem, 28px of side padding, uppercase tracking — which turned every action
  into a full-width block. Scoped to `.obr-embedded` and to narrow widths, so the
  standalone creator at its designed width is untouched. The iframe is its own viewport,
  so that media query reads the PANEL width, which is the right thing to decide it.
- **The roller lost its Attribute and Skill dropdowns.** They duplicated a choice already
  made by tapping the boxes on the sheet, and a duplicate control that can disagree with
  the thing it duplicates is worse than no control. What is left is a readout.
- **`pickRollStat()` no longer scrolls on every pick.** It scrolled the roller into view
  each time, which was a kindness in the 1280px modal and yanks you to the middle of a
  docked panel. It now measures after the re-render and scrolls only when the roller is
  genuinely off screen.

## Deliberately left out

- **The drag-ghost.** Gus wants it, and it is the natural next step now that snap points
  exist: both are the same operation, so a drag only has to produce coordinates the snap
  quantises. The route is to inflate the panel to the full viewport with `setWidth` and
  `setHeight` — which QA confirmed is reload-free — draw the ghost inside it, and reopen
  at the target on release. Three things need a live check first: whether a popover with
  its paper hidden is genuinely transparent so the map shows through, whether inflating
  to the full viewport is reload-free at that size and not just at small increments, and
  whether the pointer keeps reporting for the whole gesture. Snap points ship first
  because they need none of that.
- **The full responsive pass over the sheet.** Gus chose targeted fixes plus zoom, on the
  theory that zoom does most of the work and a session at the table says what is left.
- **The equipment catalogue**, still 89% of the rendered sheet and still rebuilt on every
  render inside a collapsed section. Unchanged and still the biggest performance win
  available.

## Live checks — none of this is covered by a suite

1. The sheet opens where you left it, at the size and zoom you left it.
2. Press each of the nine squares. It lands on that corner, edge or centre, flush.
3. A 1.0 right dock is still full height after the update; a 1.0 bottom dock is still full
   width.
4. Drag each available edge and the corner. It resizes live, with no reload.
5. The edges against the window offer no handle.
6. Widen until it stops. Some map is still visible.
7. Zoom in and out. The sheet scales, the panel does not move.
8. Roll in the Rolls and Actions roller. It appears in the sheet's Recent Rolls.
9. Roll on the sheet. It appears once, not twice.
10. A GM's hidden roll does not appear on the sheet.
11. Tap a Skill and an Attribute. The readout changes and the sheet does not jump.
12. The header survives the narrowest panel you can drag to.

## Testing

```sh
cd dnm-cc
npm install jsdom playwright --no-save
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator embedded party dock security; do node tests/$t.test.mjs; done
```

Current: creator 167, embedded 80, party 102, dock 90, security 92. All passing.

Nine mutations were run against the staged copies to prove the new assertions fail without
the fix: pinning an anchor by the wrong corner, dropping the never-cover-everything rule,
losing the legacy fill axis, unfiltering `resizeEdges()`, inverting the drag direction,
zooming nothing, and removing each of the roll merge's three guards.

**The creator's dock helpers are now GENERATED from `dnm.js`** rather than hand-copied,
which is the only reason a 3x3 rewrite of duplicated code was safe to attempt. Regenerate
rather than edit the copy; `dock.test.mjs` compares them over 6336 inputs.

One harness lesson, and it is the same one as last release wearing a different hat: the
drag test compared the resized width against the STORED width and passed with the drag
direction inverted, because the drag measures from the panel's real width and any drag at
all cleared the stored number. An assertion has to compare against the thing the code
actually starts from.

# v2.0B / 1.0 — A character code is untrusted input, and the parser now says so

Creator **v2.0B**. The extension is unchanged and stays at **1.0**, so there is nothing to
deploy on that side. No room metadata schema change.

A letter, not a number: this fixes what earlier releases got wrong and adds no capability.
Both findings came out of a deliberate sweep rather than from play.

## The one that mattered: a character code could run script

`buildCharacterCode()` embeds the whole character object as a base64 JSON payload, so
every field in it is attacker-controlled. `growthPurchases[].label` and `.detail` were
interpolated into the Growth section with `innerHTML` and **no escaping**, in BOTH places
that list is rendered — `renderFinalizedCharacterView()` and `renderGrowthStep()`.

Confirmed end to end against the shipped 2.0, not reasoned about: a code built by the
app's own encoder carrying `<img src=x onerror=...>` in a growth label produced a live
`<img>` element in the victim's sheet with a compiled event handler. `src=x` fails to
load immediately, so it fires with no interaction.

**Why it is worse than defacing a sheet.** The sheet is framed by Owlbear with a working
SDK. Script running there holds the reader's seat at the table: it can broadcast forged
events, and if the reader is the GM it reaches `persist()` and the room metadata. The
trust boundary is built on `background.js` verifying connection ids — and XSS in the GM's
own sheet passes that check trivially, because it **is** the GM's connection. Delivery
needs no special access: a code is pasted out of chat, and token metadata is writable by
any player in the room.

Fixed by escaping both fields at both render sites and routing them through
`normalizeGrowthPurchases()`, which clamps them the way `normalizeRecentRolls()` already
clamped its own list. Clamp on the way OUT of storage, the rule this file has stated for
several releases and which this list was simply missing.

**How it was found, and what nearly hid it.** Reading found the first sink. A fuzz harness
that poisons every character field with a marker and checks which ones come back as live
DOM found that it was rendered in two places, not one — the first fix left the wizard's
copy live. Reading would not have caught that.

## The other one: an unknown key opened a blank sheet

`parseCharacterCode()` validates the origin, archetype and temperament SEGMENT codes and
returns a readable error for each. Then the CP payload is applied with `Object.assign`
**after** those checks and re-validates nothing, so the payload could set any key it
liked. `computeStats()` guards with `if (!c.origin || !c.archetype) return null`, which
checks the keys are SET, not that they RESOLVE — and dereferenced `originData.attributes`
one line later.

Result: a complete, valid character naming an origin, archetype or temperament this build
does not have parsed with **no error** and then threw on render, taking `renderAll()` with
it. The player got an empty sheet and no message.

The likely cause is not malice. It is a character built in a newer creator opened in a
room still serving the cached older one, or any key that gets renamed — which these notes
have warned orphans characters since the move to GSGrimoire.

Two layers, on purpose:

- **The parser** re-validates after the payload and refuses with a message naming the key
  and telling the reader to reload. That is the fix a player sees.
- **`computeStats()`** returns null rather than throwing. It has a dozen callers and only
  one is behind the parser, and `normalizeCurrentValuesInner()` already gates on
  `statsReady`, so null was always the supported answer.

**The narrowing that mattered.** The first version of the parser check refused any key
that did not resolve, including an EMPTY one — and `security.test.mjs` caught it
immediately, because an unfinished character has no origin yet and has always imported.
Only a key that is set and unresolvable is refused now. That test earned its place.

## A third one, found by the test written for the second

`getGrowthSpent()` reduced over the RAW `growthPurchases` array with `sum + p.cost`. A
code carrying `growthPurchases: [null]` — trivially expressible in the JSON payload —
threw there, and `getGrowthRemaining()` and `renderGrowthStep()` went with it. Another
blank sheet, from a different direction.

It surfaced because the regression test for the index-stability point above put a `null`
in the middle of the list, which nothing had ever done before. `getGrowthSpent()` and the
second-archetype check now both read through `normalizeGrowthPurchases()`, and
`removeGrowthPurchase()` splices a junk entry out rather than trying to reverse it.

**And the reason the normaliser carries `at`.** It drops entries that are not objects, so
numbering the survivors 0,1,2 would have made the wizard's ✕ button delete the wrong
purchase — a security fix quietly introducing data loss. Each entry carries its index in
the real array, and the button uses that.

## Not a vulnerability, kept anyway

`items[].qty` was also interpolated unescaped. It was **never exploitable**:
`normalizeCurrentValues()` coerces it to a number before any render and
`loadIntoCreator()` always calls it. Verified against the shipped 2.0 on the full victim
path — the growth payload fired, the quantity payload did not. It is clamped now because a
renderer should not depend on an upstream caller having tidied up first, and the fix is
one function call. **Do not report this one as a live vulnerability.**

## What the sweep found and did NOT change

- **89% of the rendered sheet is the equipment catalogue.** The finalized view is 441,568
  characters, of which `renderInventorySection()` is 395,108 — all 118 catalogue items with
  full descriptions, rebuilt and re-parsed into the DOM on *every* render, including every
  Momentum press and every keystroke, while sitting inside a collapsed `<details>` almost
  nobody has open. Rendering the catalogue lazily when that section is opened is the single
  biggest performance win available and is left for its own release. Generating the string
  is only ~1.7ms; the cost is the browser parsing and laying out 440KB.
- **940 tooltip bodies** account for another 48% of the markup, inlined on every render.
- **Dead code.** `compactInjuryList`, `renderKnowledgeFragmentsCounter`, `snapshotEffects`,
  `snapshotItemTags` and `updateDiceLabels` are defined and never referenced. In `dnm.js`,
  `rebuildCode` is unused everywhere, and `bondNamesMatch` is used only by `party.test.mjs`.
- **A naming split worth knowing about.** The creator calls it `bondNamesEqual`, the
  extension `bondNamesMatch`. The implementations agree today, and someone changing one
  will not find the other by searching for its name.

## What the sweep checked and found sound

Worth recording so it is not re-derived: `sanitizeEntry()` and `cleanText()` clamp every
log field and whitelist die kinds; the roller builds its DOM with `textContent` and its
only `innerHTML` uses are `= ""`; `relay()` verifies connection ids against `gmConnections`
and `isGmOnlyEvent()` covers epochs, clearing, Threat downward and the Maverick drive;
`stripUnsafeKeys()` and `sanitizeImageUrl()` are both correct; `trimState()` bounds the
room metadata; `normalizeRecentRolls()` clamps every field it loops over; the ally picker,
bond names, goals, truths, injuries, fragments and custom items are all escaped. The
creator makes **no network requests of its own** — no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` anywhere — and its only external resources are Google Fonts.

A Content-Security-Policy `<meta>` was considered and NOT added. The app is built on
inline `onclick` handlers, so `script-src` would need `unsafe-inline`, under which an
injected `onerror` still runs. It would restrict exfiltration over `fetch`, but the SDK
talks by `postMessage`, which CSP does not govern — so against this specific threat it
buys much less than it appears to. Escaping is the fix.

## Testing

```sh
cd dnm-cc
npm install jsdom playwright --no-save
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator embedded party dock security; do node tests/$t.test.mjs; done
```

Current: creator 167, embedded 69, party 102, dock 62, security 92. All passing.

Eight mutations were run against the staged copies to prove the new assertions fail
without the fix: un-escaping each of the two growth lists, un-clamping the quantity,
removing the parser's post-payload validation, removing each half of the `computeStats()`
guard, renumbering the surviving growth purchases, and putting `getGrowthSpent()` back on
the raw array.

Three harness lessons, every one of which produced a passing test that proved nothing
before it was caught:

- **A regex over rendered HTML is a guess about how the markup was written.** The quantity
  assertion used one and did not fail under mutation. Parsing the output and querying for
  the element is what the browser actually does, and it fails correctly.
- **A fixture the previous assertions already mutated is not a fixture.** The quantity
  block ran after the play view had rendered, which normalises the inventory — so it was
  asserting against tidied data. It rebuilds its own character now. The same trap caught
  the index test from the other side: it inherited `finalized: true`, and
  `renderGrowthStep()` renders no purchase list for a finalized character, so it matched
  an empty string and passed.
- **A regex written inside the template literal that carries code into the page loses its
  backslashes twice** — once to the template literal, once to the string or literal
  itself. `/removeGrowthPurchase\((\d+)\)/` arrived as `/removeGrowthPurchase((d+))/`
  and matched nothing; rewriting it as `new RegExp("...")` collapsed the same way. It
  splits on a plain substring now, which cannot be got wrong.

# v2.0 / 1.0 — The sheet beside the map

Creator **v2.0**, extension **1.0**. Both change; deploy the extension first. No room
metadata schema change. Rollback point is still `dnm-cc c21e8ac` / `dnm-obr bd3586c`.

A whole number on both halves, and the extension leaves 0.9.x, because this is the thing
the table could not do before: roll without hiding the map. The two versions move
together because they are one product and a headline release should read that way.

## The problem

The sheet opened as `OBR.modal.open` — centred, fixed, backdropped. To see the map or the
log you closed it; to roll again you reopened it. Every evening was that loop.

## What was tried in 1.29 and does not work

A **Pop out** button opening the sheet in a separate browser window, talking back to
`background.js` over a `BroadcastChannel`. **It never once connected**, including in a
brand new room where the extension was certainly current.

The likeliest cause is **Chrome's third-party storage partitioning**: the extension is a
third-party frame under `owlbear.rodeo` and a `window.open`ed sheet is first-party on
`gsgrimoire.github.io`, so their channels sit in different partitions. An earlier session
"ruled this out" with a Chromium test **that was invalid** — it ran on `localhost` and
`127.0.0.1`, and Chrome exempts loopback from partitioning, so it could never have shown
the effect. Re-testing it properly needs two real cross-site hostnames.

**All of it is deleted in this release**: the button, `makeRelayBridge()`, `bootPopout()`,
`showPopoutLost()`, the relay host in `background.js`, `POPOUT_CHANNEL`,
`POPOUT_PROTOCOL`, and `popout.test.mjs`. Do not rebuild it. `dock.test.mjs` asserts that
neither half opens a `BroadcastChannel`, so bringing it back has to be a decision rather
than an accident.

## What replaced it

`OBR.popover.open` with `anchorReference: "POSITION"`. The important part is not the
positioning: **a popover is still framed by Owlbear**, so the sheet keeps a working SDK
and needs no courier at all. That is why this route works where a detached window could
not, and it is why the bridge now has only its `direct` implementation.

Gus chose an edge dock with snap sides over a free drag, and the SDK settles why that was
right. `PopoverApi` is `open` / `close` / `getWidth` / `setWidth` / `getHeight` /
`setHeight`. **There is no `setPosition`**, and `anchorPosition` is read once at open. So:

- **Size is live and free.** `− / +` call `setWidth` (or `setHeight` on the bottom dock)
  and nothing reloads.
- **Position costs a close and a reopen**, which reloads the sheet. Three snap sides make
  that a deliberate press. A drag would have paid it on every frame.

`redock()` flushes the save before moving for the reason `popOutSheet()` did: the
reopened sheet reads the character back off the token, so an edit still in the 400ms
debounce would be undone by a move meant to be cosmetic.

`transformOrigin` is what pins a dock to its edge. A right dock pinned by its **right**
corner grows leftwards under `setWidth`; pinned by its left corner it would walk off the
screen. `marginThreshold` is MUI's minimum gap to the window edge and defaults to 16, so
it is set to 0 or the dock stops just short of the edge and looks like a bug.
`disableClickAway` is the release: without it the first click on the map dismisses the
sheet.

A dock never takes more than three quarters of the viewport, and a viewport that reads
zero or throws before the scene is up falls back to 1600x900 rather than positioning the
sheet at 0,0.

## The dock helpers exist twice

`sheetPopover()`, `clampDock()`, `readDock()` and `writeDock()` are in `dnm.js` for the
extension and copied into the creator's module block, for the same reason
`createPoolBatcher()` is: the creator cannot import from the extension without becoming a
page that needs the network. **Change one, change both.** `dock.test.mjs` runs both copies
over 2310 inputs and fails if they disagree.

The dock preference lives in `localStorage` under `${ID}/dock`, which both halves can
read because `/dnm-cc/` and `/dnm-obr/` are the same origin. It is **untrusted** — any
page on the origin can write it and a user can edit it by hand — so it is clamped on the
way OUT of storage, the same rule the character code follows.

## Both openers go through one function

`roller.js` and `background.js` each held their own modal id and URL. They now both call
`openSheetPopover()` in `dnm.js`. The old comment warning that a second id would let one
token's sheet be open twice, both saving over each other, is now enforced by there being
one call site rather than by two comments agreeing.

The popover id is `${ID}/sheet-panel`, **not** `${ID}/sheet` — that string is already the
token context menu item.

`closeSheet()` closes the popover and both legacy modal ids. A room that was already open
when the extension updated still has the old modal on screen, because Owlbear caches the
background page for the whole room session. Closing an id that is not open is a no-op.

## Deliberately left out

- **Free dragging.** Possible only as drag-a-ghost-then-reopen, one reload per move. Put
  to Gus with the reload cost stated; he chose snap sides.
- **The sheet as a tab in the roller drawer.** Zero API risk, but the drawer is 420px and
  the sheet is a 1280px document. It would have been a rewrite of the sheet's layout
  rather than a change to where it sits.
- **`roomHasGM()` in `background.js`.** It had no caller left once the relay host went.
  The roller and the creator's direct bridge keep their own copies, which is where the
  warning is actually rendered.

## Fixed on the way

`copyCodeToClipboard()` was deleted along with `popOutSheet()`, which sat immediately
above it. Nothing caught it for several minutes because no suite had ever built the
embedded header bar. `dock.test.mjs` now boots a sheet onto a real token, which runs
`insertBar()`, which is what surfaced it. That guard is the point of that test, not a
side effect.

## Live checks — none of this is covered by a suite

The suites run against a stub SDK, so everything about how Owlbear actually renders a
popover has to be checked in a room:

1. Open a sheet from a token. It docks to the right edge, full height.
2. **Click the map behind it.** The map responds and the sheet stays open.
3. Drag a token behind it. The sheet stays open and the map stays interactive.
4. Open the Rolls and Actions drawer with the sheet open. Both are usable at once.
5. Press Left, then Bottom, then Right. It lands on each edge, flush, with no gap.
6. Type a name change and press a dock button before it saves. The change survives.
7. Press + four times, then − four times. It resizes without reloading.
8. Close and reopen the sheet. It comes back on the side and at the size you left it.
9. On a small window, check the dock leaves at least a quarter of the map visible.
10. Roll, and confirm the roll reaches the log with the sheet still open.

## Testing

`popout.test.mjs` is retired; `dock.test.mjs` replaces it and inherits its job of keeping
two copies of a helper honest.

```sh
cd dnm-cc
npm install jsdom playwright --no-save
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator embedded party dock security; do node tests/$t.test.mjs; done
```

Current: creator 167, embedded 69, party 102, dock 62, security 68. All passing.

Five mutations were run against the staged copies to prove the new suite fails without
the fix: drifting the creator's copy of `DOCK_DEFAULT`, pinning the right dock by the
wrong corner, re-enabling click-away, removing the clamp from `readDock()`, and
reintroducing a `BroadcastChannel` in `background.js`. All five were caught.

One note for whoever writes the next suite: the first run of `dock.test.mjs` reported the
two copies disagreeing, and **they did not**. The grid was handed to the creator's copy
through `JSON.stringify`, which turns `NaN` into `null` — and `Number(null)` is 0, which
is finite, so it took the clamp path while a real `NaN` took the fallback path. The
harness was lying about the input. Inputs now cross the boundary as JS literals.

Related, and **not fixed here**: `embedded.test.mjs` sets module-block `let` bindings with
`g("obrRole = 'PLAYER'")` in the drive tests. jsdom gives each `eval` its own scope for
lexical declarations, so those assignments create globals the block never reads, and
those assertions pass without exercising what they name. Found while trying the same
trick for the save-before-move test, which is why that test boots a real sheet onto a real
token instead. Worth a pass of its own.

# v1.30 / 0.9.10 — A room with no GM says so, and the popout says why it failed

Creator **v1.30**, extension **0.9.10**. Both change; deploy the extension first. No room
metadata schema change. Rollback point is still `dnm-cc c21e8ac` / `dnm-obr bd3586c`.

From QA of 1.29. Carries both fixes and deliberate changes, so it is a number.

## A room with no GM

Reported: a player adds Momentum, the sheet moves, the roller's pool does not. Traced by
the reporter to a room with no GM, and they are exactly right.

**This is `background.js` working as designed.** `persist()` only runs on the GM's client,
so with nobody in that seat no one writes room metadata and every pool change is dropped
on the floor. The single-writer rule is what stops two clients clobbering each other and
it stays. What was wrong is that it happened **silently**, so the tools looked broken
rather than unattended.

Both halves now warn. `roomHasGM()` exists in three places — the roller, the creator's
direct bridge, and the relay host — because each has a different way to ask. All three
share two rules:

- **`getPlayers()` lists everyone EXCEPT this client**, so the caller's own role has to be
  checked separately or a lone GM is told there is no GM.
- **Fail OPEN.** A party read that races a disconnect must not put "the GM has vanished"
  on every sheet at the table.

## The popout: not fixed, but no longer mute

QA: the window opens, shows the character creator's import screen, and a while later says
it lost the room. **I could not reproduce it and I have not fixed it.** What 0.9.10 does is
make the three causes tell themselves apart, because all three looked identical and that
ambiguity cost the round.

What was ruled out, so nobody repeats it:

- **Third-party storage partitioning was my first theory and it is wrong.** The host is an
  iframe under `owlbear.rodeo`; the popout is a first-party window on
  `gsgrimoire.github.io`. That is the partitioned shape. Tested in Chromium with
  `--enable-features=ThirdPartyStoragePartitioning` and with the loopback exemption
  disabled: **the channel crosses in every configuration.** Not the cause.
- **An opaque origin from a sandboxed popup** is also out: the window listed the
  characters saved in browser storage, so it has a normal origin.

What is left, in order of likelihood:

1. **The room is running an older extension.** Owlbear caches the background page for the
   whole room session, so 0.9.9's relay is not running until the room itself is reloaded —
   a tab refresh is not enough. This is the likeliest by a distance and it is exactly what
   "no answer at all" looks like.
2. A room id mismatch.
3. The room has closed.

So: the host answers `hello` **regardless of room** now, and includes its room id and
`EXT_VERSION`. A window that gets no reply says "no answer from the extension — reload the
Owlbear room and press Pop out again" and offers a **Try again** button. A window answered
by a different room names both rooms and offers no retry, because retrying would fail the
same way.

`EXT_VERSION` in `dnm.js` must be changed with `manifest.json`. It exists so a window that
cannot reach the room can say what the room is running.

## The dice hint

The Complication clause is on its own line — it wrapped to two lines anyway, so the break
is now somewhere it reads — and a **raised** range is drawn in Threat's colour, because
raising it is extra danger and a player who does not notice is playing on the wrong odds.

## Testing

Creator 167, embedded 43, party 102, popout 30, security 68. The three popout failure
messages are mutation-tested. Verified in Chromium: the clause is `display: block` and
orange only when raised, and both no-GM warnings appear and are hidden when a GM is present.

**One test was written to the old protocol and had to be corrected**: the fake host in
`popout.test.mjs` still dropped non-matching rooms, so the wrong-room case could not fire.
A fake that lags the real contract tests the fake.

## Live checks

1. **Reload the Owlbear room first**, then press Pop out. If it still fails, the banner now
   says which of the three causes it is — send that sentence back.
2. Leave the room with no GM. Both the roller and the sheet show a warning.
3. Promote someone to GM. Both warnings clear without a reload.
4. As GM, lower the Complication range. Players see the clause on its own line, in orange.

---

# v1.29 / 0.9.9 — The sheet in its own window, and it remembers its rolls

Creator **v1.29**, extension **0.9.9**. Both change; deploy the extension first. No room
metadata schema change.

## ROLLBACK

This release adds a whole new way for the sheet to run. If it goes wrong at the table,
the known-good state is:

| repo | commit | version |
|---|---|---|
| `dnm-cc` | `c21e8ac` | 1.28B |
| `dnm-obr` | `bd3586c` | 0.9.8B |

`git push origin <sha>:main --force-with-lease` on each, or download
`https://github.com/GSGrimoire/dnm-cc/archive/c21e8ac.zip` and its `dnm-obr` twin.

**A failure should not need the rollback.** The popout is additive: a new button and a
second boot path. If the window will not open, the button says so and the modal stays
exactly where it was. Nothing on the existing path changed behaviour — what it changed
is who it calls, and that is covered below.

## Why a separate window needs a courier

The SDK talks to Owlbear through `window.parent.postMessage` and refuses to send
anything until that parent completes an `OBR_READY` handshake — traced in the vendored
bundle, where `isAvailable` is `!!ee.origin` from the `obrref` query parameter and
`send()` throws "Unable to send message: not ready" without a `ref`. A window opened
with `window.open()` is its own top-level context: `window.parent` is itself, the
handshake never arrives, every call throws. **There is no way to fix that from inside
the page.**

So the popout talks to `background.js` over a **BroadcastChannel**. Both halves are
published from `gsgrimoire.github.io` — the creator under `/dnm-cc/`, the extension
under `/dnm-obr/` — and an origin is scheme, host and port, so the differing paths do
not matter. **Verified in a real Chromium**, serving both repos from one origin: the
handshake crossed and the popout adopted the room's Threat.

`background.js` is the host because it is the one extension page that lives for the
whole room session. The obvious alternative, the modal that opened the popout, is
exactly the window the user is about to close.

## The bridge

Every Owlbear call in the module block now goes through a `bridge` with two
implementations: `direct` (the SDK) and `relay` (the channel). The surface is **narrow
on purpose** — `getSelf`, `getMetadata`/`onMetadataChange`, `getTokenCode`/
`writeTokenCode`/`clearTokenCode`, `getPartyCodes`/`onItemsChange`, `broadcast`,
`closeSheet`.

A general SDK proxy could not work anyway: the token write is
`scene.items.updateItems(ids, mutator)` and **a mutator function cannot be
structured-cloned across a channel**. Naming the four things the sheet does to a token
sidesteps that and gives something small enough to test.

Scoped by room id, because one browser can have two rooms open and both background
pages would otherwise answer the same popout.

## The defect the tests caught before deploy

The host replied `{ dir, id, v, ...payload }`. That read more neatly and was wrong: the
answer to `self` carries the player's **`id`**, which overwrote the envelope's
correlation `id`. No response could be matched to its request, so **every read from a
popped-out sheet hung until it timed out** — and the window sat there rendering a
complete, editable sheet that reached nobody.

The answer is nested under `data` now, and `popout.test.mjs` pins it from both sides:
the host must contain `data: payload` and must not spread a payload into a reply.

## Two live sheets on one token would fight

Popping out **closes the modal**, and that is not tidiness. Both sheets would hold the
character and both would write the code back on every edit, last write winning — so
whichever window you were not typing in would quietly undo you.

The save is flushed before the window opens, or the popout would read a token a few
hundred milliseconds out of date.

## When the room is gone

A popout whose room has closed shows a banner across the top saying so. Without it the
window renders a complete, editable sheet that reaches nobody, which is the worst way
this could fail. Every relay call also has a **6-second timeout** rather than a promise
that never settles.

## Recent Rolls

The result of a roll lived in `diceUI.lastResult`, a module binding, so it was gone the
moment the sheet closed — and in Owlbear the sheet is a modal that gets closed
constantly. The last **three** are now kept on the character, so they survive closing
and travel with the code.

Three because this is a memory aid, not a second log. Recorded in `doRoll()` rather than
`postRoll()`, so it works in a plain browser tab as well as in Owlbear.

`classifyDie()` takes the Complication threshold as a parameter now, defaulting to the
live one and matching the signature in `dnm.js`. **A stored roll keeps the threshold it
was made under**, or the GM lowering it would redraw every old roll and rewrite how it
read after the fact.

`normalizeRecentRolls()` clamps on the way OUT of storage. This is the only field in the
creator whose renderer **loops**, and a character code is untrusted input — an entry
claiming a hundred thousand dice would build a hundred thousand nodes and freeze the
sheet, which is exactly what `sanitizeEntry()` exists to prevent on the extension side.

## Testing

Creator 167, embedded 43, party 102, popout 24, security 68.

`popout.test.mjs` is new: it runs the real module block with `?popout=1` against a fake
channel and a fake host. Every guard mutation-tested — room scoping, the roll stamp, the
token write going through the relay, the response nesting, the history clamp, the stored
threshold, the three-roll cap.

Also verified in a real Chromium: a genuine BroadcastChannel between `/dnm-cc/` and
`/dnm-obr/`, and the lost-room banner appearing when no host answers.

## Live checks

1. Open a sheet from a token, press **Pop out**. A window opens and the modal closes.
2. In that window: roll. It appears in the roller's log at the table.
3. Nudge Threat as GM from the window. The pool moves for everyone.
4. Edit something, close the window, reopen the sheet from the token. The edit is there.
5. Press Pop out twice. The second press focuses the window already open; it does not
   open a rival sheet.
6. **If the window does not open at all**, the button says the browser blocked it and
   the modal stays put. Allow pop-ups for Owlbear and try again. That is the one thing
   this design cannot verify without a live room.
7. Close the Owlbear tab with the popout still open. The window shows the lost-room
   banner rather than pretending to work.
8. Roll three times, close the sheet, open it again. The three rolls are still there.

---

# v1.28B / 0.9.8B — A sheet roll says who made it

Letter release: this corrects something 0.9.5 got wrong. No behaviour was added.

**The report:** "Add Momentum" in the roller was clickable for the GM and for nobody
else.

**The cause:** the roller offers a roll's surplus to the person who made it and to the
GM, matching on `entry.by`. The roller has stamped `by` on its own rolls since 0.9.4.
**The character sheet never has.** Every roll made from a sheet was therefore
unattributable, matched nobody, and fell through to the GM-only branch — so a player
rolling their own dice watched the GM claim their Momentum for them.

It only ever showed up at a table that rolls from the sheet, which is why three releases
went past it.

Two halves:

- `installRollBridge()` now stamps `by: obrPlayerId`, resolved once in `startEmbedded()`
  via `OBR.player.getId()` and **awaited**, because it has to be there before the first
  roll can be made.
- The roller treats an entry with **no** `by` as claimable by anyone. Every sheet roll
  made before this release is one of those and some will sit in live rooms for a while;
  offering them to nobody but the GM is exactly what the bug looked like from a player's
  seat. The pool is the group's, the claim is one-way and idempotent, and refusing it
  helps no one.

A roll that IS stamped keeps the original rule: the person who rolled, or the GM.

## Testing

Creator 155, embedded 43, party 102, security 68. Both halves of the fix were reverted
in turn and the new assertion watched to fail.

`embedded.test.mjs` is what made this testable at all — it drives the real
`postRoll()` through the module block and reads what would have been broadcast. Before
v1.27 there was no suite that could see a bridged roll's fields.

## Live check

A **player** rolls from their character sheet, then opens the roller. The roll's *Add
Momentum* button is theirs to press, not just the GM's.

---

# v1.28 / 0.9.8 — The Maverick drive fires by itself

Creator **v1.28**, extension **0.9.8**. Both change; deploy the extension first. No room
metadata schema change — `drive` is a third `kind` on the existing bond queue.

"When the GM spends 3 or more Threat at once, regain 1 Spirit." v1.27 made this
*readable*, and the note there said it was deliberately not automated because all six
temperament drives are claimed by hand. Asked for, so built — with the announcement the
request specified: a broadcast to the shared log and a toast at both ends, so nothing
happens silently.

## Why it needed v1.27 first

"At once" had nothing to read while a spend of 3 arrived as three spends of 1. Coalescing
is the whole reason this is possible, and it is also why the announcement has to come
from **the client that made the spend**: only that client knows a run of presses was one
decision. Room metadata just shows a number that moved.

There are two such clients — the roller's pool buttons and the sheet's Threat controls,
which have been the GM's since v1.23 — so `announceThreatSpendDrive()` exists in both,
hung off each side's batcher flush.

## GM-only, unlike the two bonds

`isGmOnlyEvent()` now returns true for a `bond` event of kind `drive`. That is a
departure from v1.26, which deliberately left bonds open, and the reason is the rule's own
wording: "when **the GM** spends". A forged rivalry can only pay a sheet that already
holds the matching bond; a forged drive would reach every Maverick at the table on
nobody's authority. The sender-side role check stays as well, but it is the reducer's
check the GM's background page actually enforces.

## Recipient side

`applyPendingBondEffects()` grows a third branch. It reads the character's own
**temperament**, not a bond list — nobody writes a bond for this — and it checks
`fx.drive === 'maverick'` rather than paying out on the strength of being a drive at all.
The other five drives are not detectable by the sheet ("the first PC to take a turn in a
round", "create a Truth that represents a plan"), so an effect naming one is a message
from a future version and paying it would be inventing a rule.

**No self-guard, unlike the two bonds.** The sender is the GM rather than a character, so
a GM who also plays a Maverick is entitled to their own drive. The guard moved inside the
rivalry and grant branches rather than sitting above all three.

The log entry is labelled **Drive**, not Bond. Calling it a bond would send a Maverick
looking for a bond they never wrote.

## Announcements

- The spending GM: a toast on the sheet, a status line in the roller — "Spent 3 Threat at
  once — every Maverick regains 1 Spirit."
- Each Maverick: the existing bond payout path, which already broadcasts one entry to the
  shared log and shows a local toast. Now labelled Drive.

## Testing

Creator 155, embedded 40, party 100, security 68. Mutation-tested: the temperament check,
the drive-key check, the threshold, the sender's role check and the Drive label each
break their own assertion when reverted.

The temperament test **walks every temperament in `DM_DATA`** rather than asserting the
one that pays. A test naming only Maverick would not catch a branch that pays everyone.

## Live checks

1. As GM, press Threat − three times quickly. Toast: "Spent 3 Threat at once". Every
   Maverick at the table gains 1 Spirit and their log shows a **Drive** line.
2. Do it with a Maverick's sheet **closed**. They gain it when they next open it.
3. Press − twice. Nothing fires.
4. Press − twice, wait, press − twice. Still nothing — two runs, not one spend of 4.
5. A player using an ability that adds Threat fires nothing. Adding is not spending.
6. A non-Maverick gains nothing and sees nothing.

---

# v1.27 / 0.9.7 — One press is not one broadcast

Creator **v1.27**, extension **0.9.7**. Both change; deploy the extension first. No room
metadata schema change.

Reported from play: raising Threat by 3 meant pressing + three times, which sent three
pool events and wrote three "added 1 Threat" lines. The log was recording the clicking
rather than the decision, and the table had to add the lines up.

A run of changes to the same pool under the same **label** is now summed and sent once:
one pool event, one entry reading "added 3 Threat".

## What the label does

The label is the coalescing key, and that is the whole of the safety. A different label
closes the open run and starts a new one, so an ability can never be folded into a manual
nudge — every ability passes its own reason, and "Nanobarrier" is not "manual adjustment".

Two rules fall out of it:

- **A parked Momentum label is never batched.** Its detail is written by the ability
  ("spent 3 Momentum, regained 3 Spirit"), cannot be regenerated from a total, and two
  uses of Second Wind are two decisions rather than one spend of six. Those flush the open
  run and send on their own, exactly as before. Only the unlabelled path — which IS the
  +/- buttons and the number input — is summed. Threat is batchable under any label
  because its detail always regenerates from the sum.
- **Manual + and − share one key**, `MANUAL_POOL_LABEL`, with the direction deliberately
  left out. Encode the direction and a press up followed by a press down cannot cancel;
  it lands as two entries for a change nobody made. It now sends nothing at all.

## The display problem

Pool events are deltas and are never applied optimistically — applying locally and again
from the GM's update would double count. So without help the number would sit still for
the length of the window and the buttons would feel broken.

`peek()` reports what has been counted but not confirmed, and the display adds it on and
marks it unsettled (dimmed, dotted underline). It keeps reporting **across the flush**,
until the room's own value arrives or a five-second safety timeout fires. Clearing on
flush instead would drop the number back to its old value for the length of the broadcast
round trip — a visible flinch on every press.

The creator needs this only for Threat: Momentum is already applied locally through the
accessor's mirror. But `adoptRoom()` now adds any still-queued Momentum back when it
takes the room's number, or an unrelated room change mid-run would snap the counter to
the older value and lose the presses on screen.

## Ordering

`announce()` in the roller and `sendAction()` in the creator both flush first, so a roll
or a named action cannot land in the log ahead of the presses that came before it. Both
are re-entered from inside the batcher's own send, and that is safe by construction: the
batcher clears `pending` **before** calling send, so the re-entrant flush finds nothing.
Moving that assignment after the send is the mutation that breaks five tests at once.

## The Maverick drive

"When the GM spends 3 or more Threat at once, regain 1 Spirit" was undetectable when a
spend of 3 arrived as three spends of 1. It now arrives as one event of −3 and one line
reading "removed 3 Threat", which is what a Maverick player needs in order to claim it.

**Deliberately not automated.** All six temperament drives are displayed as text and
claimed by hand, and several of them — "the first PC to take a turn in a round", "create a
Truth that represents a plan" — are not detectable by the sheet at all. Automating one of
six would be the inconsistency, not the omission.

## Contract

- `dnm.js` — `createPoolBatcher(send, { delay, maxWait, settleAfter })` with
  `POOL_BATCH_MS` 900, `POOL_BATCH_MAX_MS` 2500, `POOL_SETTLE_MS` 5000. `maxWait` is why
  leaning on a button still lands rather than waiting for the hand to stop.
- **The batcher is duplicated** in the creator's module block, which cannot import
  without becoming a page that needs the network — the property the vendored SDK exists
  to protect. Change one, change both, like the four shared constants.
- `background.js` and the reducer are **unchanged**. A batched delta is an ordinary pool
  event; `isGmOnlyEvent()` reads the total, so a batched −3 is checked exactly as three
  −1s were.

## embedded.test.mjs — the module block finally has coverage

The other three suites all ended by saying the module block was not covered, because
jsdom does not execute `<script type="module">` and the block carries the bundled SDK.
That was true for fifteen releases, and it is the half of the file where the interesting
failures live.

It has no imports — the SDK is inlined — so once the SDK is removed it is ordinary script
code that runs in the same jsdom window. **Find the SDK by line length, not by text**: two
comments above the bundle quote `const OBR = Zo;`, so a substring search deletes a comment
and leaves the bundle. jsdom gives each `w.eval` its own scope for lexical declarations,
so the block's `const`s are unreachable; assert through the bridges and through what was
broadcast, which is the honest surface anyway.

## Testing

Creator 148, embedded 32, party 87, security 68. Every guard mutation-tested.

One test was **wrong and passed**: the headline batching test drove three presses in a
single tick, and three synchronous adds coalesce under any deferral at all, including
`setTimeout(…, 0)`. It passed with the debounce removed. Only a test with real gaps
between the presses caught it. When the behaviour is about timing, space the test out like
a hand does.

## Live checks

1. Press + on Threat three times quickly. The number moves at once and reads dimmed with a
   dotted underline; about a second later it settles and the log shows **one** line,
   "added 3 Threat".
2. Press + then − quickly. Nothing appears in the log at all.
3. Press + once, wait, press + again. Two separate lines — coalescing must not swallow a
   second decision.
4. Use an ability that charges Threat right after a manual nudge. Two entries, the ability
   under its own name.
5. Use Second Wind twice in quick succession. Two entries, each with its own detail.
6. As GM, press − three times. One line reading "removed 3 Threat" — the trigger a
   Maverick player is watching for.

---

# v1.26 / 0.9.6 — Bond automation, and sharing a rest

Creator **v1.26**, extension **0.9.6**. Both change; deploy the extension first. Room
metadata schema moves to **v4**.

All deliberate, so both halves take a number. This is the release held back from 1.25.

## The rules question that changed the scope

Two things were checked against `DM_DATA` before writing any of this, because the
answer decided what had to be built.

**Adrenaline Rush really is the only way to spend Threat for Spirit**, and therefore
the only rivalry trigger. Two near misses: `bold` is a *modifier* on Adrenaline Rush
(+1) rather than a second route, and the Maverick drive — "when the GM spends 3 or more
Threat at once, regain 1 Spirit" — is Spirit gained when the GM SPENDS Threat, which is
not "by adding to Threat" and so does not satisfy the bond's wording.

**Second Wind is NOT the only way to help an ally.** The supportive bond's own text
names two routes: "by spending Momentum **or giving up their own Spirit during a
rest**", and the `performer` talent exists solely to extend the second one. The sheet
had no rest-sharing at all — `takeRest()` restored your own Spirit and stopped — so
automating the bond on Second Wind alone would have shipped half a rule. Rest sharing
is therefore in this release rather than the next.

## The mechanism

A bond pays out on somebody else's sheet, and at any moment nearly every sheet at the
table is closed. That is the epoch problem again, so it takes the epoch answer: a
**queue in room metadata** (`bonds`) that each sheet drains when it next opens, not a
broadcast that only reaches whoever is looking.

The two bonds resolve **at opposite ends**, and that is the rules rather than an
inconsistency:

| | Who holds the bond | Who is paid | Where it resolves |
|---|---|---|---|
| Rivalry | the beneficiary | the holder | recipient's sheet |
| Supportive | the helper | the ally | sender's sheet |

**The rivalry direction is the thing most likely to be "corrected" into a bug.** The
rule is "when an ally with whom the character has a rivalry regains Spirit by adding to
Threat, the character recovers one Spirit as well" — the person spending the Threat
needs no bond at all. So `useAdrenalineRush()` announces the actor and *nothing else*;
every other sheet asks itself whether it holds a rivalry naming that actor. There is
nothing for the actor's sheet to check, which is why `announceRivalryTrigger()` takes no
arguments. The creator's own toast had this backwards — it read the actor's bonds and
said "your rivalry-bonded ally also gains 1 Spirit" — while the Actions catalogue entry
three inches above it had it right. Fixed.

Supportive needs a target, which is why Second Wind's ally option now has a name field
at all. It spent the Momentum and told nobody who benefited, and that missing name is
precisely what made the bond unautomatable before.

## Contract

- `dnm.js` — `EMPTY_STATE.v: 4`, `bonds: []`. `sanitizeBondEffect()`, `readBondQueue()`,
  `pruneBondQueue()`, `bondNameKey()` / `bondNamesMatch()`, `MAX_BOND_EFFECTS` (12),
  `BOND_EFFECT_TTL_MS` (6h). One reducer branch for `{ type: "bond", effect }`.
- `background.js` — **unchanged**. `persist()` is event-shape agnostic and hands
  everything to `applyEvent()`, which is the single place that knows what an event
  means. That this needed no edit is the design working.
- Creator — `appliedBondEffects` (array of ids, capped 24) and `restShare`
  (`{ key, left, recipients }`) are created lazily on the character, like
  `appliedEpochs`. Both ride along in the CP payload via the `...c` spread, so no code
  format change and no snapshot change.

`MAX_APPLIED_BOND_IDS` is 24 against a `MAX_BOND_EFFECTS` of 12 **on purpose**: if an
id could age out of the applied list while the effect were still in the room's queue,
the same bond would pay twice. Twice the queue size is the invariant; change one and
change the other.

## Not GM-only, deliberately

`isGmOnlyEvent()` is untouched. A forged rivalry effect can only land on a sheet that
already holds a rivalry naming that actor, for one Spirit; a forged grant has to name a
target who exists. That is a nuisance, not a privilege — and making it privileged would
break every bond at a table whose GM has the extension closed. What *is* enforced is in
the reducer, where a sender's clamp cannot be skipped: amounts clamp to 0–4 (3 from
Second Wind plus at most 1 from a bond), every string is length-bounded, unknown kinds
are refused, and the queue is capped and aged so a client broadcasting in a loop cannot
eat the room's shared 16 kB.

## Name matching

Bond names are free text typed at creation; character names are free text too. Both
halves normalise through one rule — trimmed, lower-cased, empty never matches
(`bondNameKey`). The ally pickers are `<input list=…>` with a datalist fed from the
characters attached to tokens in the scene, so a player can pick the exact spelling
rather than guess it; typing an unlisted name stays legal, because a bond may name an
NPC or someone who has not attached a token yet.

**A bond whose name does not match any character silently does nothing.** That is the
known sharp edge of this release. The picker makes it avoidable on the supportive side;
rivalry depends on what was typed during character creation. Worth surfacing in the
party panel later — deliberately not built here.

## Rest sharing

`takeRest()` opens a budget equal to what the rest actually returned. The rules phrase
it as reducing the amount you regain; done afterwards it is the same arithmetic and does
not ask the player to commit before they know the number — which at a table is the
difference between a control people use and one they skip. The budget is what stops it
becoming a way to hand out Spirit earned elsewhere. It lapses at the next rest and at
every scene boundary, so a live "give away 3 Spirit" control cannot sit on the sheet in
a scene the rest had nothing to do with.

`performer` lifts the one-ally-per-rest limit. Its own ceiling ("one ally for each
Spirit you gave up") needs no separate check: every recipient costs at least 1 out of a
budget already capped at what was gained.

## Two talents that were in the data and in no code

- **`cautious`** — +1 Spirit on a Second Wind taken on yourself, the exact mirror of
  `bold` on the Adrenaline Rush side. Implemented now. It had never done anything.
- **`inspire`** — mentioned in the Second Wind toast rather than automated. Granting a
  free d20 re-roll needs a mechanism the sheet does not have, and inventing one for a
  single talent is not worth the surface.

## Testing

Creator 139, party 65, security 68. Every new guard was **mutation-tested**: the fix was
reverted one at a time and the matching assertion watched to fail — the self-guard, the
bond-list check, the supportive +1, the Performer gate, Cautious, the dedupe, first
contact, the rest budget, the trim order, the queue cap direction, the amount clamp and
the TTL. A test written after the fix can pass for reasons unrelated to the bug.

The rest-share control was also driven end to end in real Chromium: typed name survives
the re-render, the two-step confirm arms and fires, giver drops by 2, the grant carries
3 (2 + supportive bond), and 2 stays in the budget.

## Live checks — these cannot be covered by the suites

1. Two attached characters, A holds a rivalry naming B. **Close A's sheet.** B uses
   Adrenaline Rush. Open A: A gains 1 Spirit and the log says so.
2. Same pair reversed — B holds no bond. B uses Adrenaline Rush; **B gains nothing extra
   and A gains nothing**, because the bond belongs to whoever holds it.
3. A has a supportive bond naming B. A uses Second Wind on "B" for 2. B's sheet gains
   **3**.
4. A takes a Break, gives 2 to B. A's Spirit drops 2, B gains 2 (or 3 with a supportive
   bond). A second ally is refused without Performer.
5. A character attached to a token **mid-session**, after effects are already in the
   queue, gains nothing on first open — and then receives the next effect normally.
6. The ally picker lists the other characters in the scene, and not the character
   themselves.
7. Reload the room after deploying. The extension's background page is cached per room
   session and a tab refresh is not always enough.

---

# v1.25B / 0.9.5B — Fixes from testing 1.25

Letter release: everything here corrects what 1.25 got wrong. No behaviour was added.

**Tooltip spacing, for real this time.** 1.25 set `margin-bottom` on `.dm-tip-title`
and it landed on four tooltips out of nineteen. **Fifteen of the titles are written as
`<span>`, and vertical margin on an inline element does nothing** — so the gap only
appeared where the call site happened to use a `<div>`. That is exactly the "some
tooltips but not all" that came back. `.dm-tip-title` is now `display: block`, which
makes the gap work whichever tag a call site used, and the gap is 3px rather than 7 —
a word-space, which is what was asked for.

**The last double rule.** 1.25 fixed the rule with `.sheet-block-title + .sheet-section`,
which covered Items, Growth and the rest. *Actions, Talents & Abilities* opens with a
`details.sheet-collapse`, not a section, so it kept its own `border-top`. Widened to
`.sheet-block-title + *`: the heading's rule is the divider, and whatever follows it
must not draw another regardless of what element it is. Padding is still corrected only
for a section, which is the only thing that reserved space for a rule it no longer
draws.

**Measuring this needed a real browser.** The first attempt to confirm the fix used
jsdom's `getComputedStyle`, which reported a 16px top border on every element including
ones with no border at all — jsdom does no cascade. It sent the diagnosis to the wrong
place until it was re-run in Chromium, where all six blocks read `0px`. The assertions
that shipped test the SOURCE rule instead, for the same reason.

**Knowledge Fragments** collapses now, and no longer repeats its own name as a
subheading directly under the block title that already says it. Open by default: a
fragment you have forgotten you recovered is no use to a Weaver.

**Table Controls**: *Complication on* is *Complication Level*, and `.gm-group-label`
went from 56px to 74px with a line-height, because the longer label wrapped mid-word
and knocked the number buttons out of line with the rows above and below.

---

# v1.25 / 0.9.5 — Logging coverage, claimable Momentum, the GM's Complication range

Creator **v1.25**, extension **0.9.5**. Both change; deploy the extension first. Room
metadata schema moves to **v3**.

All deliberate, so both halves take a number. Bond automation was planned alongside
this and was **deliberately held back** to its own release — eleven changes plus a
cross-character schema change in one drop would be untestable.

---

## The logging gap had one cause, not six

Reported as two symptoms: End Scene showed a toast and logged nothing, and Ask a
Question moved Momentum and logged nothing.

`logAction()` only **parks** a label. It is flushed either by a pool write — the
Momentum accessor and `addThreat()` both consume `pendingActionLabel` — or by an
explicit `logActionNow()`. So an action was logged only if it happened to move a pool
in a way that consumed the label.

- `endScene()`, `startNewSession()` and `startNewAdventure()` never called `logAction`
  **at all**. Toast only.
- `spendMomentumForAction()` parked a label and relied on the accessor. Whatever the
  precise reason it did not land, the design was the fault: the entry depended on a
  side effect of a different operation.

A parked label that is never flushed is worse than silence — it sits there and
mislabels the next thing that *does* spend a pool.

`announceSheetAction(label, detail)` is now the one way a sheet action announces
itself: `logAction()` then `logActionNow()`. Flushing afterwards is safe whether or not
something already consumed the label, because `logActionNow()` returns immediately when
there is nothing parked. So every action can end with it and none has to know which
kind it is. The Momentum spenders keep the accessor path and call it as a backstop.

## Truths and Knowledge Fragments

Logged on **commit**, not on input — the fields save per keystroke, and logging there
would post an entry per letter. `beginTextListEdit`/`commitTextListEdit` mirror the
Injury pair.

Opt-in per field via `LOGGED_TEXT_LISTS`, because Knowledge Fragments and Custom Items
share `renderAutoGrowList()` and quietly logging someone's kit list would be noise.

---

## Claimable Momentum

A roll that beats its Difficulty produces surplus successes. The sheet reported the
number; nothing collected it.

Both halves now offer a button. Two different mechanisms, because the two contexts
differ:

- **The sheet** claims locally: `diceUI.lastResult.momentumClaimed` guards the roll
  object being rendered, so a re-render keeps the button greyed rather than offering
  the same surplus twice.
- **The roller** claims through a new `claim` event, because the log is shared. Local
  state would leave the button live on every other client and the pool would gain the
  surplus once per person who pressed it. The reducer's claim is **idempotent**, so a
  double-click or a re-delivered broadcast is harmless.

Offered to the roller and the GM only. It is their Momentum to claim or spend instead,
and the GM needs it for a roll whose owner has closed their sheet. Every roll now
carries `by` so the button knows whose surplus it is.

The claim is **one-way**. Undoing it would mean tracking who claimed what; the pool's
own +/- already exists for a correction. A pool already at its cap says so rather than
greying silently.

---

## The GM's Complication range

`compAt` joins room state at schema v3: the die value at or above which a roll
complicates. 20 is the rulebook default; the GM lowers it as far as 15.

Below 15 a d20 complicates more often than not, which stops being a difficult scene
and starts being a broken one, so the range is bounded at both ends and clamped in the
reducer — it arrives over the same open broadcast channel as everything else.

`classifyDie()` gained a `compAt` parameter defaulting to 20, so every existing caller
keeps rulebook behaviour. **Order is unchanged**: a Complication is checked first and
can never also be a success, which matters more once the threshold can overlap the
Attribute.

The roller's dice hint names the live threshold. Leaving it reading "Complication on
20" while the GM had moved it would have players working from the wrong odds.

### A bug caught in testing, not in play

`readCompAt()` and the creator's `getCompAt()` both coerced before checking for
absence. **`Number(null)` is `0`, which is finite** — so a null threshold clamped to
the FLOOR, and every roll of 15 or higher would have complicated in a room that had
never set one. The `{}` case passed because `Number(undefined)` is NaN, which is why
the first round of tests looked green.

Both now check `null`/`undefined`/`""` before coercing, and both cases are pinned.

---

## End Scene costs the group 1 Momentum

Per the rules, and applied on the **GM's** press in `pushEpoch()`, not on the sheet's
own End Scene button.

A sheet-side deduction would fire once per character: five players ending the same
scene would cost the table five Momentum. The scene ends once, so the pool moves once,
and the GM is the one who ends it. The sheet's End Scene stays a personal reset that
never touches the group pool.

**GM undo was considered and rejected.** With the above, sheets no longer change
global state, so there is very little left to undo, and an undo button is a lot of
machinery for a rare case.

---

## Layout

- **The double rule under every heading** was a real bug, not a style choice.
  `.sheet-block > .sheet-section:first-of-type` matches the first element of its TYPE
  among siblings — and the first div in a block is the **title**, so the rule never
  matched and the inline `border-top` on three sections drew a second line. Adjacency
  (`.sheet-block-title + .sheet-section`) is what was meant. The inline borders moved
  to `.sheet-section-ruled` so the stylesheet is the only place a rule is decided.
- **Knowledge Fragments** left the Resources grid for a block of its own between the
  character and Actions. It was the odd cell there — every other cell is a counter —
  and it sat between Resources and the dice panel, pushing the roller away from the
  Attributes and Skills a roll is picked from. The dice panel was already directly
  under Resources; removing the Fragments cell is what actually closed the gap.
- **Momentum is labelled "Group Pool"**, matching Threat's scope note.
- **Tooltip titles** got 7px under them instead of 4, which against a 0.72rem body
  read as one block of text with a coloured first line.

---

## Deploy order

1. **`dnm-obr` first** — `dnm.js`, `roller.js`, `index.html`, `style.css`,
   `manifest.json` (0.9.5). Schema v3: a creator reading `compAt` from a `dnm.js` that
   never writes it would sit at 20 forever.
2. **`dnm-cc/index.html`**
3. Docs
4. **Full room reload, everyone.**

No reinstall. `readCompAt()` defaults a missing key, so live v2 rooms keep working.

---

## Testing

**203 assertions, all passing** — creator 106, party 46, security 51.

New: the threshold's defaults, clamps and null case; `classifyDie` at and around a
lowered threshold, including that a Complication still outranks a success and a
critical on the same die; the claim event's idempotence and that an unknown id touches
nothing; and that setting the threshold is GM-only while claiming is not.

The layout assertions were **rewritten to look blocks up by name rather than index**.
Inserting Knowledge Fragments shifted every index and broke five assertions that were
really only asserting "still in position 4", which is not what any of them meant.

Verified end to end in jsdom: End Scene, Ask a Question, a Truth and a Fragment all
produce log entries; claiming adds Momentum once and the second press adds nothing.

**Not verified here.** Anything needing a live room: the GM's threshold reaching other
clients, the claim button greying out on someone else's screen, and the End Scene
Momentum deduction landing once.

### Live checks

- Press End Scene on a sheet — it should appear in the shared log.
- Spend Momentum on Ask a Question — it should appear too.
- Write a Truth and a Knowledge Fragment; confirm one entry each, on finishing typing.
- Roll well enough to beat the Difficulty, press **Add N Momentum**, confirm the pool
  moves and the button greys **on every client**.
- As a player, confirm you cannot claim someone else's surplus.
- GM: set Complication to 17, confirm the roller hint changes for **players too**, and
  that a 17 now complicates.
- GM: press End Scene and confirm the group loses exactly 1 Momentum, once.



# v1.24 / 0.9.4 — The GM reads hidden rolls; three things off the sheet

Creator **v1.24**, extension **0.9.4**. Both change. Deploy the extension first.

A number on both halves: everything here was deliberate, so nothing takes a letter.

---

## The GM must see a player's hidden roll

Reported plainly: *"The GM should know everything. A player rolling a hidden roll only
hides it from the other players — not from the GM."* Correct, and 0.9.3 had it wrong.

### Why 0.9.3 could not do it

0.9.3 broadcast a redacted **placeholder** and kept the real result in the roller's own
browser. That made the result genuinely unreadable by anyone else — including the GM,
who is the one person who has to read it.

There is no way to have both, and it is worth writing down why rather than
rediscovering it. **Owlbear has no private channel.**

- `OBR.broadcast.sendMessage` takes `destination: "ALL" | "REMOTE" | "LOCAL"`. There is
  no per-player target.
- Every storage surface it offers — room metadata, player metadata, item metadata — is
  readable by every client in the room.

So a result that reaches the GM reaches every browser at the table. The only question
is what each client *draws*.

### What shipped

The full entry is broadcast, tagged `conceal: "hidden"` and `by: <playerId>`, and
**redacted at render**. `canRevealConcealed(entry, viewer)` in `dnm.js` decides:

| Viewer | Sees |
|---|---|
| GM | everything |
| the roller | their own roll |
| another player | that a roll happened, plus the typed label |

**Be honest about the guarantee.** Hidden now conceals a result from other players'
*screens*, not from a player who opens devtools. That is a real reduction from 0.9.3,
and it is the price of the GM being able to read it. Say so in the interface rather
than letting someone find out later — the mode hint now reads "The GM sees the result",
and the changelog states the limitation outright.

**Secret is untouched and is now the only absolute mode**: never broadcast, never in
room metadata, GM only. It exists precisely for the case Hidden no longer covers, which
is why it was not folded into Hidden when it looked redundant.

### Implementation notes

- The hidden roll is **not** kept in the private log. It returns through room metadata
  like any other roll, and keeping a local copy too would render it twice.
- `sanitizeEntry()` carries `conceal` and `by` through the reducer. Stripping them
  would turn a concealed roll into an ordinary one the moment it round-tripped — the
  worst available failure for this feature — so both are asserted. `conceal` is
  constrained to the two known values rather than copied, because an arbitrary string
  falls through `canRevealConcealed()` as "not concealed".
- `by` is length-clamped like any other untrusted string.

`concealedPlaceholder()` and its twelve leak assertions are gone with the design they
served. The replacement assertions cover the visibility rule instead, including that
concealment survives the reducer.

---

## Sheet furniture removed

Three requests, all the same shape: things drawn on the sheet that told the reader
nothing.

**The Finalized badge.** It labelled a state visible at a glance from the sheet being a
sheet.

**The "Character" heading**, and the rule under it. `block()` now takes `null` for a
title and renders `.sheet-block.is-untitled`; the rule belonged to the heading and went
with it, so only the padding it reserved had to be taken back. Every other block still
names itself, because those group genuinely different things.

**The share code itself.** The section is now Copy Code, Save Local, the character
count and the copied message. Nobody read 13 kB of base64 — they copy it or save it —
and rendering it cost a disclosure widget, a scroller and two rules to frame something
never looked at.

That removal had three dependents, which is the interesting part:

- `copyCode()` read `#charCode.textContent`. It now calls `buildCharacterCode()`, which
  is the better source anyway: an element is only ever as fresh as the last render.
- `printSheet()` forced the disclosure open so the code reached the PDF, then restored
  it. Both halves are gone; a printed sheet is for the table, not for re-importing.
- The module block's clipboard fallback selected the on-page code when the async
  clipboard API was refused. It now copies from a detached textarea via
  `execCommand("copy")` — deprecated, but still the only thing that works where the
  async API is refused, and it needs a real focused selection.

`copyCode()` also reports a blocked copy now instead of failing silently, since the
visible code that used to serve as the fallback is no longer there.

---

## Deploy order

1. **`dnm-obr` first** — `dnm.js`, `roller.js`, `manifest.json` (0.9.4).
2. **`dnm-cc/index.html`**
3. Docs
4. **Full room reload, everyone.**

No reinstall. Schema stays at v2.

---

## Testing

**177 assertions, all passing** — creator 103, party 23, security 51.

The layout assertions were **updated rather than deleted**, which matters: three of
them failed on the first run because they encoded the old sheet, and a failing test
that describes deliberately removed behaviour should be rewritten to describe the new
intent, not dropped. They now assert the first block is untitled, that every other
block still names itself, that no Finalized badge survives, and that the share section
holds the buttons and the count but no `#charCode` and no disclosure.

Verified in Chromium: all three modes render, the Hidden status names the GM, a Secret
roll still lands in the private log alone, and the resize grip is intact.

**Not verified here.** Anything needing two clients: that the GM actually reads a
player's hidden roll, that another player sees only the redacted row, and that Secret
is unavailable to a player.

### Live checks

- As a **player**, roll Hidden. **As the GM, confirm you see the dice and the result.**
- As a **second player**, confirm you see only "Hidden roll" with their name.
- As the **GM**, roll Secret and confirm nothing appears for anyone else.
- Confirm a player is not offered Secret at all.
- On the sheet: no Finalized tag, no "Character" heading or rule above the identity
  band, and a Share Code section with two buttons, a count, and no code.
- Press Copy Code and confirm the confirmation appears and the code pastes correctly.



# 0.9.3 — A real resizer, and three kinds of roll

Extension **0.9.3**. The creator is unchanged and stays at **v1.23**.

**Versioning, first application of the new rule.** A number goes up only when something
changed on purpose; fixing what a release got wrong gets a letter. This release carries both —
the resizer is a fix to 0.9.2, the roll modes are a deliberate feature — and a release that
carries a deliberate change is a number. The creator did not change, so it does not move at
all. The rule now lives in the `gsgrimoire-dnm-vtt` skill.

---

## The resizer

0.9.2 claimed the panel was resizable and shipped `−` and `+` buttons in the log header.
Reported back as "no resize capability, nowhere to grab and drag" — which is fair on both
counts. They were not a resizer in the sense anyone means, and after the 0.9.2 reorder the log
header sits well down a 900px panel, so they were below the fold as well.

`#resizer` is now a sticky strip at the foot of the page standing in for the bottom edge
Owlbear does not give a popover. Pointer events rather than mouse events, so a trackpad and a
touch screen behave the same, and `setPointerCapture` so the drag survives the pointer leaving
a strip only a few pixels tall. Dragging down grows the panel: the strip *is* the bottom edge,
so the pointer and the edge move together.

The height is written to `localStorage` once at the end of a drag rather than per frame — a
drag would otherwise write a hundred times on the way down. The `−`/`+` buttons stay, beside
the grip, because a drag is not keyboard reachable.

---

## Three roll modes

The Hidden tick-box became **Open / Hidden / Secret**, and this is a design change, not a
rename.

| Mode | The table sees | Who may use it |
|---|---|---|
| Open | the roll and the result | everyone |
| Hidden | that you rolled, and who | everyone |
| Secret | nothing at all | GM |

**Hidden is open to everyone** because concealing a result is ordinary play, and the table
still learns a roll happened, so nothing disappears from the record. **Secret stays the GM's**
deliberately: a player rolling with no trace is the single thing a shared log exists to
prevent. The role is re-checked in `doRoll()`, not merely in the button's `hidden` attribute —
a hidden attribute is not a control.

### The placeholder

A Hidden roll broadcasts a placeholder built by `concealedPlaceholder()` in `dnm.js`. It lives
there rather than in the roller so its contents can be asserted, because the whole feature
rests on what it does **not** carry: the placeholder goes into room metadata, where anyone can
read it out of devtools.

Built by **allow-list, never by deleting from the roll**. Spreading the entry and stripping
`detail`, `succ` and the rest would leak the day someone adds a field, and the leak would be
silent. Twelve assertions cover it, including that the placeholder holds exactly six keys.

It is shaped as an **action** entry, not a roll. It is not a roll anyone can read, and making
it one would mean every consumer of a roll entry learning to handle a roll with no dice in it.
Its id derives from the roll's (`<id>-c`) so it dedupes like anything else.

### The private copy

`hiddenLog` is now everyone's, not the GM's, and holds both kinds with a `conceal` field
naming which. Entries stored before 0.9.3 are read back as `secret`, which is what they were —
it was the only kind that existed.

The badges are deliberately different colours: amber **Hidden**, orange **Secret**. Reading
one as the other is a real misunderstanding about what the table was told, so they never share
a label.

---

## Deploy order

Extension only.

1. **`dnm-obr`** — `dnm.js`, `roller.js`, `index.html`, `style.css`, `manifest.json` (0.9.3).
2. Docs in `dnm-cc` (changelog entry and the required-extension line).
3. **Full room reload, everyone.**

No reinstall. No creator deploy. Schema stays at v2.

---

## Testing

**177 assertions, all passing** — creator 97, party 23, security 57.

Eighteen are new, and all of them are about the placeholder not leaking: no dice value, no
target, no successes, no verdict, exactly six keys, and the same again after the reducer has
run.

Browser-verified in Chromium rather than only parsed:

- dragging the grip down 200px took the panel from 900 to 1100, the `−` button then took it to
  980, the strip computes to `position: sticky`, and the height persisted.
- all three modes render, the hint text changes with the mode, a Hidden roll and a Secret roll
  produce correctly-coloured badges, and `localStorage` holds `["secret","hidden"]`.

**Not verified here.** The placeholder actually reaching other clients needs a live room, as
does Secret being unavailable to a player.

### Live checks

- Drag the strip at the foot of the roller. Close and reopen: the height is remembered.
- As a **player**, confirm Open and Hidden are offered and **Secret is not**.
- As a **player**, roll Hidden. Your own log shows the result with an amber badge; the GM and
  the rest of the table see only "Hidden roll" with your name.
- As **GM**, roll Secret. Nobody else sees anything at all.
- Close the roller and reopen: concealed rolls are still there, still badged.



# v1.23 / 0.9.2 — QA pass from the table

Creator **v1.23**, extension **0.9.2**. Both repos change. Deploy the extension first.

Everything here came out of one structured test pass in a live room. Three were real
bugs, one of them a regression introduced by 0.9.1.

---

## Sentinel characters were invisible to the party panel

The best bug in a while, because the reproduction reads as nonsense: Sentinel never
appeared in the party panel, Weaver and Firebrand always did, and the same Sentinel
code imported into the creator perfectly.

A DM1 code mixes **two segment kinds**:

- **tagged** — a two-letter tag plus payload: `CP…`, `SN…`, `NM…`, `GW…`
- **positional and untagged** — segments 1 to 3 are bare lookup codes written straight
  in by `buildCharacterCode()`: `parts.push(archetypeData.code)`

Sentinel's archetype code is **`SNT`**. `parseCode()` located the snapshot with

```js
const snIndex = parts.findIndex((p) => p.startsWith("SN"));
```

which matched the **archetype at index 2**, not the snapshot at index 16. It then fed
one character of archetype code to `JSON.parse` and returned "That code is damaged".
`readPartyMember()` drops anything with an error, so the character silently vanished
from the panel — and from the roller's selected-character banner, which uses the same
parser.

The creator was unaffected because it has its own parser and never looks for `SN`.
Rests still landed for the same reason, which is why the character looked half-present.

Both lookups now scan **backwards**. The tagged segments are appended after the
positional ones, so the last match is always the real one, and a future archetype
coded `CPX` cannot resurrect this.

The full collision surface, checked rather than assumed: `EVR` (Everan) collides with
the `EV` tag and `CRC` (Circumspect) with `CR`, but nothing reads those, so `SNT` was
the only live break.

**The test walks every archetype** rather than naming Sentinel. Confirmed non-vacuous:
reverting to `findIndex` makes it fail with `sentinel:` named in the message.

---

## Loading a saved character did not attach it

`loadCharacterLocal()` assigns a fresh character and renders. It never touched
`ready`, so `queueSave()` returned at its guard, no `CHAR_KEY` was written, and no
header bar appeared. Pressing Edit then Finalize worked only because that route went
through the v1.21 finalize hook.

This is the same bug for the third release running:

| release | entry point | outcome |
|---|---|---|
| v1.20 | paste a code | hooked |
| v1.21 | finalize a new build | missed, then hooked |
| v1.23 | load a local save | missed again |

Each fix hooked one more door. **The pattern was the mistake**, so all three now call
one `adoptOntoToken()`. A fifth way in needs a call, not a fourth copy of the same six
lines.

`hookLoadLocal()` compares the character object identity before and after: the
original returns early on a bad id or damaged code, and adopting then would write the
*previous* character onto the token.

---

## 0.9.1 broke players paying Threat — regression, now corrected

Reported as "a player adds Threat, it broadcasts, the meter does not move."

0.9.1 made **all** Threat changes GM-only at the relay. That is wrong about the game.
Adding Threat is a player action: `useNanobarrier()` charges it, Adrenaline Rush pays
in it, and five catalogue items add it on use — every one routed through the creator's
`addThreat()` and out over this channel. All of them were being refused. A Sentinel
could press Barrier, watch the cost announce itself in the log, and see the pool sit
still.

The creator's own tooltip had the rule right the whole time: *"Anyone can add; only
the GM should spend."* **The direction is what is privileged, not the pool.** A player
can pay Threat in and cannot drain it.

The rule moved to `isGmOnlyEvent()` in `dnm.js` so it is testable without a live room
and stated once. A zero delta is explicitly not a spend.

**Lesson worth keeping:** 0.9.1 tightened a permission by reading the UI — the roller
disables Threat for players — without checking who else called the same path. The
sheet had been the main Threat writer since v1.17.

### The manual buttons

Separately, the sheet's own Threat `+`/`−` are now GM-only, matching the roller.
Removed rather than disabled: since 0.9.1 a player pressing them got the worst
outcome available, an action that announced itself in the shared log and did nothing.
Abilities and items are untouched.

`obrRole` is resolved before the first render so the buttons never appear and then
vanish, and refreshed on `player.onChange` for mid-session promotion. It fails closed
to player.

---

## Hidden rolls

Two changes, neither touching the security property: a hidden roll is still never
broadcast and never written to room metadata.

**They now survive closing the panel.** `hiddenLog` was a plain array, so closing the
popover discarded it. From the GM's seat that is indistinguishable from hidden rolls
working only sometimes. They persist to `localStorage` — this browser only, never
reaching a player, and not spending the room's shared 16 kB. Every access is wrapped;
private windows throw on the accessor itself. Entries are re-marked `hidden: true` on
read, so a mangled record can never render as a public roll the GM believes the table
saw.

**The label is a badge**, warning-coloured and boxed, with the row tinted. It was
`"(hidden)"` appended to the character name in the same weight and colour, which reads
as part of the name.

The related complaint — that the status note is too far from the log to be useful —
is fixed by the reorder below rather than by moving the note.

---

## Layout

- **Order is now Table Controls, Party, dice, log.** The log sits directly under the
  roller instead of two panels below it, so a result is where you are already looking
  after pressing Roll.
- **Height control** in the log header, `OBR.action.setHeight()`, 480–1600 in steps of
  120, remembered per browser in `localStorage`. Owlbear sizes the popover from the
  manifest and gives the viewer no drag handle. Default raised to 900×420.
- **The panes grow with it.** `.log` was a flat `max-height: 220px`, so a taller panel
  bought empty space and the same eight visible entries. Both it and `.party-list` are
  now viewport-relative with a floor.
- **Themed scrollbars**, both the standard properties and the WebKit pseudo-elements:
  Firefox reads one, Chromium the other, and neither alone covers the table.

## Party panel: open a sheet

Each row carries a **Sheet** button opening that token's character, using the same
modal id and URL shape as the context menu — a second id would allow one token's sheet
open twice, in two windows, both saving.

`refreshParty()` now carries the token id alongside the code, and it is part of the
render signature so a new token with a duplicate code still redraws. The id is attached
with a spread rather than written onto the cached member, which would pin the first
token that happened to carry that code.

**Removing a party member** needs no feature: removing the token does it, as confirmed
in testing.

---

## Deploy order

1. **`dnm-obr` first** — `dnm.js`, `background.js`, `roller.js`, `index.html`,
   `style.css`, `manifest.json` (0.9.2).
2. **`dnm-cc/index.html`**
3. Docs
4. **Full room reload, everyone.**

No reinstall. Schema stays at v2; no metadata migration. `manifest.json` changes only
`version` and the action size, so the install URL is unchanged.

---

## Testing

**159 assertions, all passing** — creator 97, party 23, security 39.

New: every archetype parses for the party panel (non-vacuous, verified by reverting
the fix); Sentinel's code really is `SNT`; and nine assertions on `isGmOnlyEvent()`
covering both Threat directions, Momentum in both directions, epochs, clear, and junk.

Browser-verified in Chromium rather than only parsed: section order reads
`pools → gm-panel → party-panel → roller → log-section → status`, the height control
renders, `.log` computes to 331px rather than the old flat 220, the scrollbar resolves
to teal on the panel background, and the page raises no console errors.

**Not verified here.** The relay's role check still needs a live room, as does the
party panel's Sheet button and the Threat direction rule end to end.

### Live checks

- Attach a **Sentinel** to a token and confirm it appears in the Party panel.
- Load a locally saved character onto a token: header bar appears, and it is still
  there after close and reopen, with no Edit/Finalize.
- As a **player**, use an ability that costs Threat and confirm the pool moves.
- As a **player**, confirm the sheet shows no Threat +/- buttons.
- As **GM**, confirm the sheet's Threat +/- still work.
- As **GM**, roll hidden, close the roller, reopen: the roll is still there, badged.
- Resize with the height control, close and reopen the panel: the height is remembered.
- Press **Sheet** on a Party row and confirm the right character opens.



# v1.22 / 0.9.1 — Security sweep

Creator **v1.22**, extension **0.9.1**. Both repos change. Deploy the extension first.

A deliberate sweep rather than a response to an incident. Nothing here was observed
being exploited; the table is five people who know each other. It is written up as if
that were not the case, because the code cannot tell the difference.

---

## The one that mattered: forged GM events

**Any player at the table could call a rest on every character, wipe the shared log,
or move Threat.** Not by defeating a check — by making the request the ordinary way.

`pushEpoch()`, `clearLog()` and `stepPool()` each open with a role test:

```js
if (role !== "GM" || !EPOCH_KEYS.includes(boundary)) return;
```

Every one of those runs **in the sender's own tab**. `OBR.broadcast` is open to every
client in the room by design — that is the whole reason the broadcast-then-persist
shape exists, so a player can announce a roll without write permission on room
metadata. A player therefore never has to defeat the check; they call
`OBR.broadcast.sendMessage` from the console and skip the function holding it.

The receiving end was:

```js
OBR.broadcast.onMessage(CHANNEL, (event) => persist(event.data));
```

`persist()` hands straight to `applyEvent()`, which applied `epoch`, `clear` and
`pool` without asking who sent them. The GM's background page is the only writer of
room metadata, so it was the only place a real check could ever have lived, and it
did not have one.

### Why this is worse than the README's "convenience, not a boundary"

That line was written for **0.6.0**, when the privileged actions were the Hidden
toggle, Clear, and Threat, and it was a fair call: "nothing in a roll log is worth
cheating over." Epochs arrived in **0.8.0** and are a different kind of thing.

A forged `bed`:

- reaches **every attached character**, not the sender's own,
- applies to players **who are not online**, because catch-up is lazy by design,
- resets scene flags, refreshes abilities and restores Spirit, and
- **has no undo.** The counter is monotonic; there is no decrement.

A forged `clear` destroys the shared log permanently — it is the record of the
session, and it is gone from room metadata.

Neither needs malice. A well-meant script, a shared browser profile, or a future
sender with a bug does the same thing.

### The fix

`background.js` verifies the sender:

```js
const GM_ONLY_TYPES = new Set(["epoch", "clear"]);
// plus pool events where pool === "threat"
```

against a set of GM **connection ids** — a broadcast identifies its sender by
connection, not by player id. The set is `OBR.party.getPlayers()` filtered to
`role === "GM"`, plus `OBR.player.getConnectionId()` for this client, because
`getPlayers()` lists everyone *else* and this page only relays while it is the GM.
`OBR.party.onChange` refreshes it.

Three details that are deliberate:

- **Populated before subscribing.** An empty set refuses everything privileged, which
  is the safe direction, but it would also refuse the GM. `setRelay()` is now `async`
  and awaits the first refresh.
- **A failed party read keeps the previous set** rather than clearing it. Clearing on
  a transient failure would refuse the GM's own controls until the next party change,
  which at the table reads as the buttons having broken.
- **The sender-side checks stay.** They stop accidents, which is worth having. They
  are simply not the control.

Momentum stays open to everyone. It is the group's pool and always was.

**Not verified in the harness.** `OBR.broadcast` has no jsdom stand-in, so the check
itself needs a live room. See the live checks below.

---

## Unvalidated event payloads

`applyEvent()` took whatever arrived and put it in the log. Every sender clamps
(`who` 24, `label` 48, `detail` 80) and none of that was worth anything, for the same
reason as above: the clamp runs in a tab the sender controls.

Two consequences, neither needing malice — a future sender with a bug reaches both:

1. **`trimState()` stops at one entry.** It drops log entries until the state fits,
   `while (next.log.length > 1 && ...)`. A single entry larger than the budget
   survives, and the write exceeds the room's **16 kB, which is shared with every
   other extension installed in that room**, not just this one.
2. **`renderRollEntry()` builds one DOM node per die.** An entry claiming a hundred
   thousand dice freezes every client rendering the log, the GM's included.

`sanitizeEntry()` now normalises every entry inside the reducer — the one function
both sides run — rather than at each call site. A sender that forgets to clamp is
harmless, and so is one that never meant to. Pools are bounded per event as well: an
unbounded delta sets a pool to `Number.MAX_SAFE_INTEGER` and every later sum on it is
meaningless until the room is rebuilt.

Entries already in live rooms were written by clamped senders, so this is idempotent
on them and nothing in an existing log changes shape. Asserted.

---

## The SDK came from a third party at runtime

```js
import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
```

in both `background.js` and `roller.js`. Whatever esm.sh returned ran in the room with
full access to the SDK: every character code on every token, room metadata, and the
GM's writes. **An ES module import cannot carry an SRI hash**, so there was no way to
pin it — the URL names a version and the server decides what that version means.

The creator solved this for itself in **v1.14** by bundling the SDK inline. The
extension did not follow, and there is no reason for the two halves to disagree about
whether a third party is inside the trust boundary.

`sdk.js` is now vendored in the repo. It is the same bundle the creator carries,
differing only in its last line: the creator's inline copy ends `const OBR = Zo;`
because an inline module cannot import from itself, and this one is a real module so
it ends `export default Zo;`.

This keeps the project's no-build-step rule. The file is committed, not built.

**Smoke-tested in Chromium**, not just parsed: the popover was served over HTTP and
loaded, and the vendored module resolved and evaluated, exposing all seven surfaces
the extension calls (`room`, `player`, `party`, `broadcast`, `scene`, `contextMenu`,
`modal`). The roller reached its standalone state, and the only off-origin request
left in the page is Google Fonts, which is unrelated and pre-existing.

---

## Character codes and prototypes

`parseCharacterCode()` does `Object.assign(c, getDefaultCharacter(), payload)` with a
`JSON.parse`d payload. `JSON.parse` produces `__proto__` as an ordinary **own**
property, and `Object.assign` copies with `Set` semantics, which invokes the prototype
setter rather than defining a property. A crafted code could therefore choose the
character object's prototype.

**Stated honestly: `Object.assign` is shallow, so this cannot reach
`Object.prototype`.** It is containment, not a live exploit, and it is fixed because a
code is untrusted input — pasted from a chat window, or read off a token any player
can write to — and there is no reading under which it should pick an object's
prototype. `stripUnsafeKeys()` drops `__proto__`, `constructor` and `prototype`.

---

## Swept and found clean

Recorded so the next sweep does not redo it:

- **XSS in the creator.** `escHtml()` is correct and is applied at every site where
  character-controlled text reaches markup — names, bonds, truths, injuries, custom
  items, knowledge fragments. Verified rather than assumed.
- **XSS in the extension.** Every `innerHTML` in `roller.js` is `= ""`. All content is
  `createElement` plus `textContent`, including the log, the banner and the party
  panel.
- **`sanitizeImageUrl()`** rejects `javascript:` and `data:`, and the portrait renders
  with `referrerpolicy="no-referrer"`. A portrait URL is still an outbound request to
  a host the code's author chose, which leaks that a sheet was opened; that is
  inherent to remote images and is accepted.
- **No `eval`, no `new Function`, no string `setTimeout`** anywhere in either repo.
- **The role default is `"PLAYER"`**, not `"GM"`. `startStandalone()` sets `"GM"`
  deliberately, and guards the party panel with `standalone`. A slow role fetch in a
  real room cannot flash GM controls at a player.
- **Token metadata** holds only the DM1 code. The extension never interprets it beyond
  the read the party panel needs.

### Known and accepted

- **Hidden rolls** stay out of room metadata entirely and live only in the GM's open
  panel. Unchanged, and still the right trade.
- **Momentum is unauthenticated** on purpose.
- **A player can still forge a roll or an action entry** attributed to any name. The
  log is a shared record, not evidence, and locking it down would mean authenticating
  every entry against a connection id — a much larger change for a table of friends.
  Worth revisiting only if the log ever becomes something decisions rest on.

---

## Deploy order

1. **`dnm-obr` first** — `sdk.js` (new), `background.js`, `dnm.js`, `manifest.json`
   (0.9.1). A creator sending sanitised events to an old relay is harmless; a new
   relay is what enforces the role check.
2. **`dnm-cc/index.html`**
3. Docs
4. **Full room reload, everyone.** The background page is cached per room session, and
   the relay check lives there.

No reinstall. Schema stays at v2; no metadata migration.

---

## Testing

**147 assertions, all passing** — creator 94, party 14, security 39.

`tests/security.test.mjs` is new and is written from the attacker's side: forged
events go straight into the reducer and hostile codes straight into the parser, never
through a sender, because a sender is what an attacker does not use.

It covers oversized fields, the hundred-thousand-dice freeze, the single oversized
entry that `trimState()` alone could not contain, entries that are not objects,
unbounded pool deltas, a 500-event flood against the log cap, dedupe surviving
sanitising, unknown epoch boundaries, a hostile `__proto__` payload, and the escaping
and URL sanitising that keep hostile text out of the DOM.

One test bug worth recording: the first draft asserted
`!("__proto__" in s.epochs)`, which passes vacuously — `"__proto__" in obj` is true
for **every** object, because it is an inherited accessor on `Object.prototype`. It
now uses `hasOwnProperty` and checks the prototype directly.

**Not verified here.** The relay's role check needs a live room, as noted above.

### Live checks

- As a **player**, open the console in the Owlbear tab and send a forged epoch:
  `OBR.broadcast.sendMessage("com.thuknights.dnm-obr/events", {type:"bed"}, {destination:"ALL"})`
  — nothing should move, and the GM's console should log a refusal.
- As the **GM**, press Bed normally. It must still work. This is the check that would
  break if the connection-id set were wrong.
- Promote a player to GM mid-session and confirm their controls start working.
- Confirm Momentum still moves for players, and Threat still does not.
- Confirm the roller loads with the network tab showing **no request to esm.sh**.

# v1.21 — Attach persistence, and an editable sheet in play

Creator **v1.21**. `dnm-obr` is unchanged and stays at **0.9.0**.

Both items were found in play on the v1.20 release, which was rolled back to v1.19B for
that session and is redeployed here with these fixes on top.

---

## A new character never reached its token

Reported as three separate faults. They were one.

`commit()` is the only thing that writes `metadata[CHAR_KEY]`, and `queueSave()` guards
it with `if (!ready) return`. `ready` was set in exactly two places: `loadIntoCreator()`,
for a token that already holds a code, and the `hookImport()` patch, for a pasted code.

**Nothing set it for a character built from scratch on an attached token.** The wizard's
Finalize button calls `finalizeCharacter()`, which calls `renderAll()`, which
`hookRenderAll()` has wrapped to call `queueSave()` since v1.13 — and that call returned
at the guard every time. The sheet rendered, played, rolled and logged correctly, and the
token stayed empty. Closing the modal lost the character entirely.

The two symptoms that did not look related:

- **Party panel empty.** `refreshParty()` lists tokens by `metadata[CHAR_KEY]?.code`. A
  character that was never written is not on a token to be listed. The panel was correct.
- **GM rests not arriving.** Same cause. Catch-up reconciles a character found on a
  token; there was none.

`hookFinalize()` mirrors `hookImport()`: on the first finalize it binds the Momentum
accessor, sets `ready`, inserts the on-token bar, commits, and reconciles.

**Worth keeping:** there are now three legitimate ways a sheet becomes live — open an
existing token, paste a code, finalize a new build — and each needs its own hook because
each is a different entry point into the same state. A fourth will need one too. The
guard is right; the coverage was not.

---

## Editing a finished character in play

A GM granting Growth mid-session had nowhere to spend it.

The wizard was never gated. `editCharacter()` has never been `tab-only`, and `goToStep()`
accepts any index without validation. What was missing was the way in: embedded mode hid
`.progress-bar`, grouped in the CSS with `.site-header` and `.hex-bg` as page chrome a
modal does not need.

That grouping is the mistake. `renderProgress()` **already** hides the bar whenever
`character.finalized` is true, so embedded the bar could only ever have appeared *after*
Edit Character was pressed — precisely the moment its step links are the entire point.
Hiding it left the steps reachable only by walking backwards through `wrapStep()`'s Back
button, with nothing on screen suggesting that was possible.

Three changes:

- The bar renders embedded, with a tighter margin for the modal. It already wraps, so it
  costs two rows at 1280px. The finalized gate stays in `renderProgress()`, where it
  belongs — moving that gate into CSS is what caused this.
- `renderGrowthSummarySection()` carries a **Spend Growth** button. It resolves the step
  by name via `STEPS.indexOf('growth')`, so reordering `STEPS` cannot silently aim it at
  Bonds.
- `wrapStep()` offers **Done — back to play** while a finished character is being edited.

### The resume flag

`resumingFinishedCharacter` is a module binding, not a field on the character. It
describes this visit to the wizard rather than the character, and a field would serialise
into the share code and the token. `goToStep()` latches it before clearing `finalized` —
that is the only moment that still knows the edit began from a finished sheet — and
`finalizeCharacter()` clears it.

This is what separates the two cases that otherwise look identical to `renderStep()`,
both being `finalized === false`: a new character walks forward to Summary and finalizes
there, and must **not** be offered a shortcut past its own remaining steps. There is a
test for that.

`editCharacter()` now delegates to `goToStep()` rather than repeating its three lines, so
the latch cannot be bypassed by the one entry point that predates it.

### Re-finalizing mid-session is not destructive

`finalizeCharacter()` calls `seedResourcesOnFinalize()`, which reads as alarming on a
character in play. It only fills `currentSpirit` and `currentSupply` when they are
`null`, so a character that has spent anything is untouched. Asserted rather than assumed.

---

## Catch-up on every finalize, not only the first

`catchUpToRoomEpochs()` opens with `!state.character.finalized` and returns null. Once a
sheet could be put into edit mode deliberately, that became reachable in play: a rest
pushed while a player was part-way through spending Growth was skipped.

It was skipped **safely** — `writeAppliedEpochs()` sits behind the same early return, so
the boundary stayed pending rather than being marked applied. But it would then wait for
the next room metadata change or the next sheet open, which from the player's seat is the
v1.19B "the rest arrives at random" bug wearing a different hat.

`hookFinalize()` therefore calls `reconcileOnOpen()` on every finalize, not only the
first. Finalizing is the moment the character can accept a boundary, so that is where it
is applied.

---

## Deploy order

Creator-only. `dnm-obr` is untouched at 0.9.0 and needs no redeploy beyond restoring the
0.9.0 files that the session rollback reverted.

1. **`dnm-obr`** back to 0.9.0 — `dnm.js`, `roller.js`, `index.html`, `style.css`,
   `manifest.json`, `README.md`. Unchanged from the 0.9.0 that shipped with v1.20.
2. **`dnm-cc/index.html`**
3. Docs
4. Full room reload

No reinstall. Schema stays at v2; no metadata migration.

---

## Testing

94 creator assertions and 14 party assertions, all passing.

14 are new: the embedded CSS no longer hides the progress bar and the finalized gate is
still in `renderProgress()`; `editGrowth()` lands on the growth step and latches the
resume flag; the growth step renders the back-to-play button; a Growth purchase made this
way survives the code round trip; re-finalizing does not reset Spirit; the play view
carries the Growth route; and a first-time build is **not** offered back-to-play.

The Growth round-trip assertion is the one that matters most. An edit that cannot reach
the token is the v1.20 attach bug again in a different place, and asserting the purchase
is in `state.character` would not have caught it — the assertion goes through
`buildCharacterCode()` and `parseCharacterCode()`, which is the path the token actually
uses.

**Unchanged jsdom limits.** `OBR.isAvailable` is false, so `hookFinalize()` itself is
**not** exercised here: the module block is stripped by the harness. The bug it fixes and
the fix for it both live in that block. What the tests cover is that the creator-side
functions it calls behave correctly when called.

### Live checks

- Attach a fresh token, build a character, press Finalize, **close the sheet, reopen it**.
  The character should still be there. This is the whole of the first fix.
- With that character attached, confirm it appears in the GM's Party panel.
- GM presses Bed; confirm it reaches the newly built character.
- On a finished sheet, press Edit Character and confirm the step bar appears.
- Press Spend Growth from the play view, add a purchase, press Done — back to play, and
  confirm the purchase is on the sheet and survives a close and reopen.
- GM presses Bed while a player sits in edit mode; the player presses Done and the rest
  should land immediately.


## Release index

Newest first. Each entry records rationale, deliberate exclusions and known limitations, not just what shipped.

| Version | Extension | What it was |
|---|---|---|
| **v1.20** | 0.9.0 | Injuries in the log, GM party panel, sheet in five blocks, Shared Roll Room removed |
| v1.19B | 0.8.1 | Nanobarrier fix, eager catch-up, visible reconciliation |
| v1.19 | 0.8.0 | GM table controls |
| v1.18 | 0.7.0 | Nanobarrier, damage buttons, charge logging |
| v1.17 | 0.7.0 | the Rolls and Actions log |
| v1.16 | — | one file, and the SDK comes in-house |
| v1.15 | — | Threat reaches the table |
| v1.14 | — | rolling from the sheet |
| v1.13 | — | snapshot v3, and the static/computed split |
| v1.12 | — | Snapshot v2: abilities, descriptions, exhaustion |
| v1.11 | — | Owlbear Rodeo snapshot (`SN` segment) |
| v1.10 | — | see entry |
| v1.09 | — | see entry |
| v1.08 | — | see entry |
| v1.07 | — | see entry |
| v1.06 | — | see entry |
| v1.05 | — | see entry |
| v1.04 | — | see entry |
| v1.03 | — | see entry |

---

*Standing reference, not a release note. This section was written at **v1.17** and is kept current; it sat orphaned between the v1.18 and v1.17 entries until v1.20 moved it here.*

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

# v1.20 + dnm-obr 0.9.0 — injuries in the log, party panel, sheet layout

Creator **v1.20**, extension **0.9.0**. Deploy the extension first. No manifest filename
or `background_url` change, so **nobody has to reinstall**.

---

## Corrections to the v1.20 handoff document

The handoff was read as a description and checked against source before anything was
built. Three of its claims were wrong.

| Handoff claim | Source says |
|---|---|
| `dnm-character-creator.html` "has never existed in the repo" | It existed at `dnm-cc/beta/dnm-character-creator.html`, v1.13-beta, 468 kB. It was never the *deployed* sheet, so the operative rule held, but the file was real. Gus deleted `beta/` during this run, so the claim is true from v1.20 onward and was not true before it. |
| "Bundle the OBR SDK from npm" applies to the project | It applies to **`dnm-cc` only**. `dnm-obr/roller.js` and `dnm-obr/background.js` both still `import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0"`, and no bundled SDK exists anywhere in `dnm-obr`. See the section below. |
| Share Code "sits at the bottom of another section; promote it" | It was already the last top-level call in `renderSummaryStep()`, a direct child of `.char-sheet`. What it lacked was section *styling*, not promotion. |

Two of the handoff's claims were confirmed against source and are worth restating
because they are load-bearing:

- Its correction to the project instructions is **right**. `parseCode()` lives in
  `dnm.js`, `refreshSelection()` in `roller.js` has called it since v1.12, and
  `shutDownAttrs(snap, char)` reads `char.activeExhaustion`. The roller *does* read
  character data. The accurate rule is narrower: the **background page** never
  interprets character data, the **sheet** is the only thing that writes it, and the
  **roller may read** it. The party panel below depends on that being allowed.
- Five catalogue items carry `itemActions`, not four. Walked with a Node script over
  the 118-item array rather than eyeballed: Combat Automed, Combat Medkit, Communicator,
  Emergency Trauma Kit, Tactical Lens. Combat Medkit is the one that gets missed, because
  it spends Momentum where the other four add Threat.

A prior session note claimed the live install was `manifest-embed.json`, that
`manifest.json` was partially broken, and that consolidating the two was outstanding.
**That was stale.** `dnm-obr` has exactly one manifest. There is nothing to consolidate
and no reinstall-forcing change pending.

## The OBR SDK is bundled in one repo, not both

`dnm-cc/index.html` carries the SDK inline, bundled from npm with esbuild — the v1.16 fix,
and the reasoning in the comment above the bundle still stands: a remote import fails
*silently* under a CSP, a corporate proxy, a CDN outage or simply being offline, and the
page then loads looking correct while having quietly forgotten the character.

`dnm-obr` does **not**. Both `roller.js` and `background.js` fetch from `esm.sh` at load.

This was left alone in v1.20, deliberately, on two grounds. It has worked in live play,
plausibly because the extension only ever runs *inside* Owlbear where the network is
already known-good, whereas the creator also gets opened as a bare tab on whatever
machine a player has. And changing how the extension loads is exactly the class of change
that fails for one player and nobody else — a bad thing to discover mid-session.

**If it is hardened later it should be its own release with its own live check, not a
rider on a feature release.** Until then: do not write extension code that assumes a
local SDK is present.

---

## Party panel (extension 0.9.0)

GM-only section in the roller, between Table Controls and the log. Per character: name,
Spirit current/max, and a status badge.

### Why no creator change was needed

The v1.20 handoff flagged this as a risk — that a needed field might be missing from the
snapshot, making it a creator change plus a share-code round trip. It is not. Everything
required already crosses the wire:

| Field | Segment | Note |
|---|---|---|
| `name` | `SN` | snapshot |
| `spiritMax` | `SN` | snapshot |
| `currentSpirit` | `CP` | `applyChar()` in `roller.js` already reads exactly this for the banner |
| `appliedEpochs` | `CP` | written by `writeAppliedEpochs()` in the creator |

`buildOwlbearSnapshot()`'s own comment explains why: live session values — current
Spirit, injuries, equipped and discharged state — are deliberately **not** duplicated
into `SN`, because they ride in `CP` and keeping mutable state in exactly one place is
what makes an Owlbear round trip lossless. That decision, made in v1.11, is what made
this feature cheap in v1.20.

### Three states, not two

`epochStatus()` in `dnm.js` returns `unsynced`, `behind` or `current`.

The distinction that matters is **null vs all-zeros**. `readAppliedEpochs()` returns
`null` when the character has no `appliedEpochs` at all — newly built, or attached to a
token for the first time. The creator's `catchUpToRoomEpochs()` adopts the room's
position for that character and applies **nothing**, on purpose, so a new character does
not arrive and immediately run a rest it was never present for.

Reading that as zeros would report it as behind by however many boundaries the table has
been through, and send the GM chasing a player who has nothing to catch up on — the exact
failure the panel exists to prevent. So it reads **Not synced**, styled distinctly from
Behind. A `behind` row also names what it is waiting on (`Waiting on Bed, End Scene`),
which turns the panel from a yes/no into something actionable.

`readAppliedEpochs()` deliberately **mirrors** the creator function of the same name:
same six keys, same coercion, same null semantics. Two implementations of this would
drift the first time either side changed.

### Cost control

`scene.items.onChange` fires on every drag frame, and parsing a character is a base64
decode plus two `JSON.parse`. Two guards:

1. **Parse cache** keyed on the code string. A token that moved but was not edited is a
   cache hit. Bounded at 60 entries and cleared wholesale past that, because every edit
   writes a new code and an unbounded cache would grow per save.
2. **Render signature** over `[codes, roomEpochs]`. Dragging changes neither, so a drag
   costs one string comparison and returns before touching the DOM.

`onChange` hands us the item list already, so it is passed straight through rather than
triggering a second fetch.

### Bug fixed in passing

`refreshSelection()` was only ever called inside `OBR.player.onChange`. Opening the
popover with a token **already selected** showed no character banner until you clicked
something else. One line at startup. Pre-existing since v1.12; unrelated to this feature
but found while reading the file.

---

## Injuries in the Rolls and Actions log (creator v1.20)

### The ruling

**An Injury has no mechanical effect of its own. Gus ruled this directly: it is flavour.**

The rulebook text carried in `INJURY_RULE_INFO` agrees — an Injury is a Truth
representing harm, and first aid treats one by *renaming* it, Bleeding becoming Bandaged
Wound. The mechanics live in the Spirit spent to *avoid* an Injury, and that path is
already logged. So this feature is **announcement only**. Nothing added here touches a
pool, alters a stat, or invents a rule, and there is a test asserting exactly that.

That ruling is what unblocked the item. The handoff had it marked as blocked pending
rulebook mechanics; there were none to find.

### Entry format

| Act | Label | Detail |
|---|---|---|
| new injury typed | `Took an injury` | the text |
| text changed | `Changed injury` | `old to new` |
| Heal pressed | `Healed injury` | the text |
| Reopen pressed | `Reopened injury` | the text |
| Remove pressed, or field emptied | `Removed injury` | the text |

Label and detail are split rather than concatenated, matching every other action entry —
`renderActionEntry()` in `roller.js` puts the label in the head and the detail on its own
line.

**Remove was not in the original spec and is a deliberate addition.** Removing is a
different act from healing: it says the injury was never real, where Heal says it got
better. Left unlogged, the table would see a `Took an injury` entry and then nothing, and
assume the character was still carrying it. Emptying the field by hand is the same act
and reads the same way.

### Why `onchange` and not `oninput`

`oninput` fires per keystroke — typing "Bleeding" would post eight entries. `onchange`
fires once, on blur or Enter, which is when the edit is actually finished. `beginInjuryEdit()`
captures the value at focus, because `oninput` has already written the new value into
state by the time `onchange` runs, so the old half of a rename has to come from somewhere.

Focus-then-blur with no change logs nothing, or reading your own sheet would spam the table.

### Why this hooks the injury handlers and not `updateAutoList()`

Injuries share the auto-list machinery with **Custom Items and Knowledge Fragments**.
Logging inside the shared function would post an entry every time somebody edited a
Knowledge Fragment. There is a test asserting those two stay silent.

`removeInjuryField()` is no longer a thin wrapper around `removeAutoList()` for the same
reason — it needs to read the text before the splice in order to name it.

### Flush

`announceInjury()` calls `logAction()` then `logActionNow()`. No pool moves on any of
these, so nothing downstream would consume the pending label; without the explicit flush
it would sit in `pendingActionLabel` and mislabel the next real spend. Same pattern as
item discharge (v1.18) and Nanobarrier's free first use (v1.19B).

---

## Shared Roll Room removed (creator v1.20)

Dormant behind `SHARED_ROOM_ENABLED = false` since v1.17. Ro's server is not being stood
up, so with `DM_API_BASE` empty every request resolved against `gsgrimoire.github.io` and
404'd. Roughly 10 kB of JS and CSS removed:

`renderSharedRoomBlock`, `joinRoom`, `startPolling`, `normalizeIncoming`,
`parseRollString`, `updateRoomStatus`, `pushFeedEntry`, `pushFeedEntryRaw`, `renderFeed`,
`redrawFeed`, `roomState`, `SHARED_ROOM_ENABLED`, `DM_API_BASE`, the `roomCode` field, and
the `.room-*` / `.feed-*` CSS including the `body.obr-embedded .dm-room-block` hide and
the `.room-feed` print exclusion.

### `postRoll()` is kept as an empty stub. Do not delete it.

`installRollBridge()` in the module block does `window.postRoll = ...`. That is what
carries a roll to the shared log in Owlbear. Deleting the standalone function and its
call site in `doRoll()` would **silently stop rolls reaching the table** while the sheet
carried on looking correct. The seam is commented at both ends.

### Share-code round trip

The handoff warned of a base64 padding bug that once dropped state on import for certain
payload lengths. Checked rather than assumed: `b64decodeSafe()` re-pads every case
including the invalid `pad === 1`, and `parseCharacterCode()` imports via
`Object.assign(c, getDefaultCharacter(), payload)` with no fixed offsets. Removing a
field changes the payload length arbitrarily, which already happens every time a
character is renamed.

Tested across **sixteen payload length classes** rather than one, and a synthetic
pre-v1.20 code still carrying `roomCode` imports cleanly.

---

## Sheet layout (creator v1.20)

Five top-level `.sheet-block` bands, on a lighter ground:

1. **Character** — identity, Bonds/Temperament, Exhaustion, Truths/Injuries, Attributes,
   Skills, Resources, Dice Roller
2. **Actions, Talents & Abilities**
3. **Items and Equipment**
4. **Growth**
5. **Share Code**

**Section order inside the blocks is unchanged.** Nothing moved relative to anything
else; the v1.09 reading order and the v1.14 roller promotion are both intact. What
changed is that a run-on column of fifteen panels separated by hairline rules now reads
as five things.

### Collapse defaults

Starting Equipment and Item Catalogue are now closed on open; Owned Items and Custom
Items stay open, being what a player actually consults in play. **Starting Equipment
keeps its position above Item Catalogue**, where v1.17 put it.

Note the interaction with the v1.10 re-render continuity logic: `restoreDetailsState()`
restores *both* directions, so a panel a player deliberately opens stays open through
re-renders. The default only governs a fresh render, which is what was wanted.

### `.sheet-block` was deliberately NOT added to `SCOPE_SELECTOR`

`detailsStateKey()` builds its key from `scope | className | label`, where scope is the
nearest `.sheet-section` ancestor's title. Adding `.sheet-block` to `SCOPE_SELECTOR`
would change the key of every `<details>` that currently resolves to no scope — the Share
Code block among them — and silently reset remembered open/closed state once for every
player. Leaving the selector alone keeps every existing key byte-identical. There is a
test asserting keys stay unique after wrapping.

### Duplicate titles removed

The block headings made three inner labels redundant: the inventory section's
`Inventory & Equipment` title, the word `Growth` in the growth section title (the live
`Available / Max / Spent` counts are kept), and the Actions collapse summary, now
`Show all`. The Share Code collapse summary is now `Show the code`.

---

## Testing

Two harnesses, 94 assertions, both green.

`tests/party.test.mjs` — 14 assertions against the **real exported helpers** in `dnm.js`,
not a reimplementation. Covers all three states, the null-vs-all-zeros distinction, the
pending list, legacy rooms with no `epochs` key, applied-ahead-of-room, partial
`appliedEpochs` objects, and junk coercion.

`tests/creator.test.mjs` — 80 assertions in jsdom.

**Access note for whoever picks this up cold:** the creator is one classic `<script>`, so
`const state` and `const DM_DATA` are global *lexical* bindings and are **not** properties
of `window`. `window.state` is undefined even when the app has booted fine. Everything is
reached through indirect eval in global scope. Function declarations *do* land on
`window`, which is why overwriting `window.logActionNow` genuinely intercepts the app's
own internal calls — the same seam the module block uses.

Fixtures drive the construction path — an origin, archetype and temperament that exist in
`DM_DATA`, then `computeStats()` — and the fixture **throws** rather than passing quietly
if the character does not compute. It resolves archetypes from `DM_DATA.archetypes ||
DM_DATA.advancedArchetypes`, and it deliberately does **not** write a forced talent into
`c.talent`, because that is precisely the lie that masked the Nanobarrier bug through a
full release.

Two assertions failed on first run. **Both were defects in the tests, not the code** —
checking the fixture before the code, as the rule says. One asserted `/api/` appeared
nowhere, but it appears in the comment explaining the removal, which is worth keeping;
narrowed to assert no live `fetch()`. The other asserted the Bonds row renders, but the
fixture had no bonds and a character without bonds correctly renders no Bonds row; the
fixture now has a bond.

### Live checks — none of the below is verified locally

`OBR.isAvailable` is false in jsdom, so the module block never runs. **Nothing** in this
list was tested: every broadcast (rolls, actions, pool events, injury entries reaching the
log), every room-metadata read and write, the Momentum accessor, the `addThreat()`
replacement, epoch catch-up on sheet open, role gates, modal behaviour, and **the entire
party panel**, which is extension code and has no jsdom coverage at all.

Extension 0.9.0, before touching the creator:

1. GM opens the roller. Party panel visible, listing every character on a token, with
   Spirit matching each sheet.
2. **Player opens the roller. Party panel must NOT be visible.**
3. GM presses Bed, confirms. Every row flips to Behind, naming Bed.
4. One player opens their sheet. That row alone returns to Caught up. The others stay
   Behind.
5. Attach a freshly built character to a token. It reads **Not synced**, not Behind.
   Open its sheet once; it becomes Caught up without having taken a rest.
6. Drag a token around the map for several seconds. The panel must not flicker or
   visibly re-render.
7. Select a token, close the popover, reopen it. The character banner appears
   immediately — this is the `refreshSelection()` fix.
8. Empty scene, or scene with no attached characters: the panel says so rather than
   erroring.

Creator v1.20, after 0.9.0 is confirmed:

9. Type an injury, click away. One `Took an injury` line in the log, on both browsers.
10. Rename it. One `Changed injury: old to new` line. Confirm **no entry per keystroke**.
11. Click into the field and out again without editing. **No entry.**
12. Heal it. `Healed injury`. Reopen it. `Reopened injury`. Remove one. `Removed injury`.
13. Edit a Knowledge Fragment and a Custom Item. **No injury entries.**
14. Confirm no pool moved during any of the above.
15. Roll from the sheet in Owlbear and confirm it still reaches the log — this is the
    `postRoll` stub seam.
16. Open the sheet in the Owlbear modal at 1280×940 and check the five bands, the scroll
    length, and that Starting Equipment and Item Catalogue start closed.
17. Open the Catalogue, then press something that re-renders (Equip, Discharge). It must
    stay open and the viewport must not jump.
18. Export a character and re-import it in a fresh tab. Confirm nothing was lost.
19. Import a character code saved **before** v1.20.

## Still open

Nothing is blocking.

- The `dnm-obr` SDK import, above. A standalone job between sessions if it is ever done.
- `GLIF-Pattern Clothing` stays excluded from tracked features: its limit is per machine,
  not per character.
- Timed effect tracking remains **out of scope by ruling**. Nanobarrier's "until the start
  of your next action", scene effect durations and similar: *"that is too much bookkeeping
  on the sheet. As long as the activation is broadcast in the log it's fine."* Do not
  build it and do not re-propose it.
- `HANDOFF-v1_20.md` should be deleted now that v1.20 has shipped. It is a third
  description of the system, three of its claims were wrong, and the corrections are
  recorded above. `beta/` was deleted during this run and must not come back.

---

# v1.19B — Nanobarrier fix, eager catch-up, visible reconciliation

Creator **v1.19B**, extension **0.8.1**. Fix release on top of v1.19.

---

## The Nanobarrier bug

Nanobarrier did nothing. The card rendered, showed `NEXT: FREE`, and never changed. No
Threat, no log entry, no counter movement.

Cause: `useNanobarrier()` opens with `if (!hasTalent('nanobarrier')) return;`, and
`hasTalent()` read only `c.talent` and `c.growthExtraTalents`. **Nanobarrier is a forced
talent** — Sentinel's `forcedTalent` — and a forced talent is granted by the archetype
and is *never written into `c.talent`*. The render sites read it straight off
`archetypeData`, which is why the card appeared while every press was silently ignored.

Two things made this survive testing:

1. The v1.18 harness set `state.character.talent = 'nanobarrier'` directly. That is not
   how a real character of that archetype is shaped. The fixture asserted the code
   worked for a character that cannot exist.
2. The first attempt at this fix read `DM_DATA.archetypes[c.archetype]` only. Sentinel
   lives in **`advancedArchetypes`**, so the fix failed in the same silent direction.
   Caught because the corrected fixture threw rather than quietly passing.

`getCharacterTalentKeys()` now resolves the archetype from both tables, exactly as the
five other call sites in the file already did, and prepends `forcedTalent`.

**Lesson worth keeping:** a fixture that assigns state directly instead of building the
object the way the app builds it will confirm whatever the code already does. When a
feature depends on how a character is *shaped*, the test has to construct it from
`DM_DATA` rather than assert its way past the shape.

---

## Catch-up now happens on open

Reported as: rests only landing once the sheet was interacted with.

Cause: `adoptRoom()` runs during `startEmbedded()` **before** `loadFromToken()` sets
`ready = true`, and it guarded reconciliation with `if (ready && found)`. The first pass
therefore always skipped. After that, reconciliation only ran when
`OBR.room.onMetadataChange` fired — some *other* change to the room — which from a
player's seat looked like the rest arriving at random.

Fixes:

- `adoptRoom()` stores the room state in `lastRoomState` regardless of `ready`.
- `reconcileOnOpen()` runs after `ready = true`, at the end of `loadFromToken()` and
  after a fresh import onto a token.

---

## Catch-up is now visible in the log

v1.19 suppressed catch-up logging to stop one GM press producing an entry per character.
That was right about the flood and **wrong about the need**.

A player whose sheet has not caught up cannot distinguish "the rest already applied" from
"the rest has not reached me". The natural response to that doubt is to take the rest
again — two Bed rests from one call.

So the internal `logAction()` calls from `endScene()` and `takeRest()` stay suppressed,
but they are now **captured rather than discarded**, and exactly **one** deliberate entry
is sent per character carrying their detail:

> **Kell** · Caught up — *Bed — regained 5 Spirit, recharged 2 items*

One entry per character is the point here: the table can see who has caught up and who
has not. That is the question v1.19's silence left unanswered.

`capturedActions` saves and restores its previous value, matching the two suppression
flags, so nesting cannot strand a buffer.

Also fixed: a rest restoring no Spirit no longer emits `regained 0 Spirit`. The clause is
dropped when the value is zero.

---

## GM button confirmations

Two-step. First press arms the button and relabels it `Confirm?`; second press sends.
Arming clears after 4 seconds, and arming one button disarms any other, so a stray click
elsewhere in the panel cannot fire something armed earlier.

The 800 ms disable-after-send from v1.19 is kept — it stops a double-send, but it does
nothing about the *first* press being a misclick, which is the expensive case. Every
attached character acts on it and there is no undo.

---

## Roller pool adjustments are logged

The roller's own +/- buttons were the last unlogged way to move a pool. The sheet has
logged its pool changes since v1.17, so a number moving with no entry beside it meant
somebody had used these — invisible, and precisely the ambiguity the log exists to
remove.

**On attribution:** the roller does not know which character an Owlbear login is playing,
and there is no mapping to consult. It uses the selected token's character name when
there is one, falling back to the Owlbear display name, and labels the entry *Manual
adjustment* so it is never mistaken for an ability.

---

## Deploy order

1. **`dnm-obr` first** — `roller.js`, `style.css`, `manifest.json` (0.8.1). `dnm.js`,
   `index.html`, `background.js` and `background.html` are unchanged from 0.8.0.
2. **`dnm-cc/index.html`**
3. Docs
4. Full room reload

No reinstall. Schema stays at v2; no metadata migration.

---

## Documentation history restored

`CHANGELOG.html` was rebuilt **from the deployed file** rather than from the copy in this
workspace, and now runs unbroken from **v1.03 to v1.19B** — 18 entries.

The v1.18 and v1.19 changelogs shipped earlier had silently dropped v1.03–v1.05 and
v1.11–v1.14. They were regenerated from a v1.17 copy reconstructed out of the old 1.08
file plus what was known in-session, rather than from the live document. Same failure as
the backfill claim and the handoff's stale filename: **a document rebuilt from a
description of itself loses whatever the description omitted.**

Rule going forward: edit the deployed `CHANGELOG.html`, never regenerate it.

---

## Testing

Nanobarrier is now tested against a character built the way a real Sentinel is built —
archetype resolved from `DM_DATA`, `c.talent` deliberately set to something *else* —
plus a negative case confirming a non-Sentinel archetype does not gain it.

Catch-up: structured return verified, captured detail present, zero-Spirit clause
omitted, internal calls still suppressed, suppression and capture buffer both restored,
normal logging resumes after.

Regression: v1.19 catch-up semantics (highest boundary wins, boundary before rest, three
presses equal one rest, legacy rooms no-op), v1.18 damage buttons and Precision Firepower
doubling, v1.17 room disabled, five item actions, Start Over, pool clamp suppression.

**Untested here, as before.** `OBR.isAvailable` is false in jsdom, so the broadcast of the
catch-up entry, the reconcile-on-open trigger, the role gate, and the roller's two-step
confirm are **not** verified. They need a live room.

### Live checks

- Sentinel: press Barrier, confirm the log entry and that the cost moves to 1 Threat.
- Close a player's sheet, GM presses Bed, player **opens** the sheet — catch-up should be
  immediate, with no roll or button press needed first.
- Confirm exactly one catch-up entry per character, carrying Spirit/item detail.
- GM panel: first press shows `Confirm?`, wait 4 s, confirm it disarms itself.
- Nudge Threat from the roller and confirm it appears in the log with a name.

# v1.19 + dnm-obr 0.8.0 — GM table controls

Append to `UPGRADE_NOTES.md`. Both repos change together. The room metadata schema
moves to **v2**, so deploy the extension first.

---

## The problem

A rest or a scene boundary is per-character state living inside each token's DM1 code.
The GM wants one button that reaches every attached character.

Three ways to do it, two of them wrong:

**Broadcast the reset.** Only reaches sheets that are currently open, which at any
moment is nearly none of them. A player whose sheet was closed never gets the rest, and
there is no way for them to find out they missed it.

**Have the extension decode every token, apply the reset, re-encode.** Works, but drags
the entire DM1 format into the extension. The snapshot split exists precisely so the
extension never has to interpret character data; this would undo it, and every future
character-format change would become an extension change too.

**Epoch counters.** The GM increments an integer in room metadata. Each character
records the epoch it last applied and reconciles when its sheet next opens.

The third one is what shipped. The extension increments integers and knows nothing else.
The reset becomes lazy, which is what makes it correct for closed sheets: a player who
was offline gets their rest the moment they open up.

---

## Schema (extension 0.8.0)

`EMPTY_STATE` is now `v: 2` and carries:

```js
epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 }
```

Rests sit alongside scene boundaries because the mechanism is identical — a counter the
GM increments and each sheet catches up to. They differ only in what the sheet does on
arrival.

**Rooms written before 0.8.0 have no `epochs` key at all**, and those rooms are live
right now. Both sides read through a defaulting helper — `readEpochs()` in `dnm.js`,
`readRoomEpochs()` in the creator — rather than assuming presence. A missing key must
read as zero, not `undefined`, or every comparison silently fails.

`applyEvent` handles `type: "epoch"` with a **monotonic increment, never an assignment**,
so a GM with the panel open in two windows cannot clobber themselves into a lower value.

`trimState` now rebuilds `epochs` before trimming. Losing one to the byte budget would
send every sheet backwards and re-apply a boundary the table already had.

---

## Catch-up rules (creator v1.19)

`catchUpToRoomEpochs()` compares room epochs against `character.appliedEpochs`.

**Applies once, not N times.** Three Bed presses missed while a sheet was closed produce
one Bed rest. Rests clamp to maxima and boundary resets clear flags, so replaying would
change nothing except flooding the log.

**Highest wins.** New Adventure subsumes New Session subsumes End Scene; Bed subsumes
Break subsumes Breather. Only the strongest pending boundary and the strongest pending
rest are applied; the rest are synced without acting.

**Boundary before rest.** A new scene followed by a rest reads correctly in that order,
and a rest's ability refresh should not be undone by a boundary reset applied after it.

**First contact syncs silently.** A character with no `appliedEpochs` — newly built, or
attached to a token for the first time — adopts the room's position without applying
anything. Otherwise every new character would arrive and immediately take a rest it was
never present for.

### The flood guard

This is the part that would have been a bad bug.

`endScene()` and `takeRest()` both call `logAction()`. Without intervention, every
character reconciling the same GM press would post its own copy to the shared log — one
button producing an entry per character at the table.

Catch-up therefore runs inside `withActionLogSuppressed()`, and `logAction()` returns
early while that flag is set. The GM's press is logged **once**, by the GM, from the
roller. There is a test asserting catch-up emits exactly zero log entries, and another
asserting normal logging resumes afterwards.

The flag saves and restores its previous value rather than clearing to `false` on exit,
matching `withPoolLogSuppressed`, so nesting cannot clear a suppression it did not set.

`adoptRoom()` reconciles **before** its early return, because a room whose pools happen
to be unchanged can still have moved a boundary forward.

---

## The panel

GM-only, above the log in the roller popover. Rest row: Breather, Break, Bed. Boundary
row: End Scene, New Session, New Adventure.

Hidden for players rather than disabled — these reach every character at the table, and
it should not look like something a player might be permitted to press. `pushEpoch()`
re-checks the role anyway rather than trusting the hidden attribute.

Each button disables itself for 800 ms after a press. Every press is a real increment
that every sheet will act on, so an accidental double-click is a second rest at the
table.

---

## Deploy order

1. **`dnm-obr` first** — `dnm.js`, `roller.js`, `index.html`, `style.css`,
   `manifest.json`. A creator sending nothing new is harmless; a creator expecting
   `epochs` from a `dnm.js` that never writes them would sit permanently at zero.
2. **`dnm-cc/index.html`** as `index.html`.
3. Docs.
4. Full room reload. The background page is cached per room session.

No reinstall. `background_url` and the manifest filename are unchanged from 0.7.0 —
only `version` and `description` moved.

---

## Testing

18 assertions on catch-up, all passing: first contact silent, no-op when current, scene
applied once, highest boundary wins, three missed Beds produce one rest, highest rest
tier wins, boundary-then-rest ordering, catch-up logs nothing, suppression restored,
logging resumes, legacy rooms are a no-op, unfinalized characters ignored.

11 on the reducer: increments, unknown boundaries ignored, legacy v1 rooms upgrade
without losing pools, epoch log entries dedupe by id while the increment still lands,
trim preserves epochs under byte pressure.

Regression: v1.17 and v1.18 features intact.

**Unchanged jsdom limits.** `OBR.isAvailable` is false, so the broadcast path, the GM's
metadata write, and the role gate on the panel are **not** verified here. The harness
calls `catchUpToRoomEpochs()` directly; it does not exercise `OBR.broadcast` or
`OBR.player.getRole()`.

### Live checks worth doing

- GM presses Bed. A player with their sheet **open** catches up; confirm exactly one log
  entry, attributed to the GM, not one per player.
- GM presses End Scene while a player's sheet is **closed**. That player opens it and
  should see the catch-up toast and a cleared Nanobarrier counter.
- Confirm players cannot see the Table Controls panel at all.
- Attach a brand-new character to a token in a room with non-zero epochs. It should
  apply nothing.

---

## Still open

**Nothing blocking.** Nanobarrier shipped in v1.18; the backfill item was withdrawn as
based on a stale claim.

`GLIF-Pattern Clothing` remains excluded — its limit is per machine, not per character.

Worth considering later: the panel pushes boundaries but has no way to show the GM which
characters have caught up and which are still behind. Not needed for play, but it would
answer "did everyone get that rest?" without asking around the table.



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


# v1.17 — the Rolls and Actions log

The player write test **passed** before this release: a player edited a sheet in an incognito window and the change was visible from the GM window. That clears the blocker recorded at v1.16.

## What this release is for

Rolls have travelled to the shared log since v1.12. Nothing else did. A player spent Momentum on a Counterattack, pushed Threat to send a Communicator message, or burned a once-per-scene ability, and the pools moved with no record of who moved them or why. The GM saw a number change.

v1.17 puts abilities, item uses and every pool change into the same log as rolls.

## Attribution, and why the accessor could not do it alone

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

## The clamp had to be silenced

`normalizeCurrentValues()` clamps `currentMomentum`, and embedded that field is an accessor bound to the room pool. Every clamp is a pool write. Loading a sheet whose Momentum sits above its current maximum would have announced a spend to the whole table that no player made.

`normalizeCurrentValues()` is now a thin wrapper calling `normalizeCurrentValuesInner()` inside `withPoolLogSuppressed()`. The whole function is wrapped rather than the single clamp line, so this stays correct if another resource is bound to the room later.

`withPoolLogSuppressed` saves and restores the previous flag value rather than setting it to `false` on exit, so nesting cannot clear a suppression it did not set.

## Threat already carried its reason

`addThreat(amount, reason)` has taken a reason since v1.15 and every call site passes a real one. The embedded bridge computed it, used it for the local toast, and dropped it from the broadcast. Carrying it through is most of what makes the Threat half of the log readable, and it cost one field.

Manual counter nudges log, by ruling. Their reason string changed from `'manual'` to `'manual adjustment'` so the entry reads properly on its own line.

## `logActionNow()`

For actions that announce but move no pool, a limited-use ability with no cost, nothing downstream is coming to consume the parked label. Without an explicit flush it would sit in `pendingActionLabel` and mislabel the next real spend. `logActionNow()` flushes and clears; standalone it only clears.

## Log entry shape

Action entries share `state.log` with rolls. Same dedupe by `id`, same `MAX_LOG_ENTRIES` cap, same `trimState` byte budget.

```js
{ id, t, kind: "action", who, label, detail, pool, delta }
```

They are not a second list. The log's value is one ordered record of what happened; two lists would need interleaving by timestamp at every consumer instead of once in `applyEvent`.

**A roll entry carries no `kind` at all**, including the entries already sitting in a live room's metadata from before v1.17. Consumers must treat *absent* `kind` as "roll" rather than requiring the field. `renderEntry` branches on `e.kind === "action"` and falls through to `renderRollEntry` otherwise.

This was not cosmetic. `renderEntry` read `e.detail.length`, `e.succ` and `e.diff` unconditionally. An action entry reaching the old renderer would have thrown and taken the whole feed down, rolls included. That is why `roller.js` and `style.css` shipped in this drop and not just `dnm.js`.

`who` prefers the character name and falls back to `OBR.player.getName()`, resolved once at start. A failed name lookup is non-fatal and never blocks an action.

## Item actions became buttons

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

## Shared Roll Room disabled

`DM_API_BASE` is `''`, so `/api/roll`, `/api/stream` and `/api/tail` resolved against `gsgrimoire.github.io` and 404'd. The endpoint was to be hosted by Ro and is not going to be stood up. The panel offered a Connect button that could only ever fail.

Turned off behind `SHARED_ROOM_ENABLED = false`, **not deleted**. The wire format is a worked design: the POST contract, SSE with a polling tail as fallback, the feed renderer. Rebuilding it from nothing later would cost more than carrying a few hundred dormant lines. Setting the flag true and pointing `DM_API_BASE` at a live host is the whole of the work to restore it.

`postRoll()` gained an early return on the flag. A character saved before v1.17 can still carry a `roomCode` in its share code, and without the guard those characters would fire a failing POST on every roll forever.

This is unrelated to the in-Owlbear log, which needs no server: it rides the broadcast channel and is persisted to room metadata by the GM's background page.

## Start Over

There was no way out of a finished sheet except reloading the tab by hand.

`startOver()` navigates to `location.pathname` rather than resetting state in place. A reload is the only thing that reliably clears every module-level variable the creator accumulates during a build: `diceUI`, `roomState`, the scroll-restore scope map, `pendingThreat`. Resetting `state.character` alone leaves those behind.

Nothing is auto-loaded from `localStorage` at boot, since the local library is explicit with Load buttons, so a reload lands on an empty front page.

The confirm text differs depending on whether the character is already in the local library, because "you will lose this" is false when it is saved and worth saying plainly when it is not.

The button carries `.tab-only`, a new inverse of `.obr-only`: visible by default, hidden under `body.obr-embedded`. Embedded, the character lives on the token and "start over" would mean something destructive and unintended.

## Other changes

- Starting Equipment moved above the Item Catalogue in Inventory & Equipment.
- `CHANGELOG.html` rebuilt in the graphical v1.08 layout. Its back link points at `./` rather than a filename, because the old `./1.10.html` target 404s.

## Rulings settled

**New Adventure clears I Know a Guy, already true.** `startNewAdventure()` clears the `scene`, `session` and `adventure` boundaries, and `iKnowAGuy` is `reset: 'adventure'`. The v1.16 handoff carried this as an open question; the code answered it. No change shipped and the backlog item is closed.

## Still open

**Nanobarrier.** Deliberately still absent from `LIMITED_USE_FEATURES`. The escalating cost is in the rulebook text carried in `DM_DATA`: first use free, second 1 Threat, each subsequent +1. So the counter is straightforward. What does not exist anywhere in the source is a **reset boundary**. Treating it as a binary used flag would be mechanically wrong, and inventing a boundary would be worse. Blocked on a ruling: scene, session, or Bed.

`GLIF-Pattern Clothing` remains excluded for the separate reason that its limit is per machine, not per character.

**Log does not backfill on connect.** A player who joins late or reloads sees an empty feed. This mattered less when the log held only rolls; now that it is the session's record of actions, it matters more. The log is in room metadata, so the data exists. The gap is that a connecting client does not seed from it. Ruled a nice-to-have, not a blocker.

**Discharge is not logged.** `toggleItemDischarged()` moves no shared pool, so it sat outside the "changes Momentum or Threat" scope this release was built to. Ruled afterwards that it should log; not yet built.

## Testing

`applyEvent` was tested directly for action handling, dedupe, ordering and legacy roll entries lacking `kind`.

The creator was booted in jsdom with the module block stripped, and the accessor was reproduced around the real `state.character` to verify: labelled spends carry the ability name, unlabelled writes still log, gains read as gains, the `normalizeCurrentValues()` clamp is silent, and a flushed label does not leak into the next spend.

**Both jsdom limits from v1.16 still apply.** `OBR.isAvailable` is false and the transport cannot handshake, so the real broadcast path, frame detection and the GM's metadata write are **not verified in the harness** and can only be confirmed in a live room. The accessor test reproduces the setter's logic; it does not exercise `OBR.broadcast`.

---

# v1.16 — one file, and the SDK comes in-house

`APP_VERSION` and the header comment moved to `1.16`. Two things happened in this release: the Owlbear sheet and the character creator became one file, and the Owlbear SDK was bundled in.

## One file instead of two

Until v1.15 the extension carried its own character sheet (`sheet.html`, `sheet.js`, `sheet.css`, plus a generated `rules.js`), rebuilt from the code's snapshot. That sheet and the creator's own finished sheet were two implementations of the same thing, and they drifted. The bug that opened this session was exactly that: `sheet.js` wrote to a `#char-sub` element that `sheet.html` no longer had, which threw on the third line of `render()` and silently killed every section below it.

v1.16 embeds the creator itself in the Owlbear modal instead. One file detects its context and renders as either the full creator (browser tab) or the in-play sheet (Owlbear modal).

Mechanism:

- `OBR.isAvailable` decides the context. Not `window.self === window.top`, which was tried at v1.14, could not be tested in jsdom, and shipped broken.
- `body.obr-embedded` is added in embedded mode. `.obr-only` shows an element only when embedded; `.tab-only` (added v1.17) is its inverse.
- The token's metadata holds the DM1 code. Everything on screen derives from it and every edit rewrites it, so the code handed back at end of session is current by construction.
- Embedded, the sheet opens straight to the character rather than the import screen.

The five files supporting the old duplicate-sheet approach (`sheet.js`, `sheet.html`, `sheet.css`, `rules.js`, `build-rules.mjs`) were quarantined pending deletion rather than removed immediately.

## Why the SDK is bundled

Embedded mode was silently dead before this release. The symptom was misleading: the modal opened, the creator rendered, the import screen offered the local library, and edits persisted across a close and reopen, so it looked like a working sheet that had merely forgotten which character it was on. The persistence was `localStorage`, not the token. Nothing in the module block was running at all.

The cause was the SDK import. v1.13 used a static `import` from esm.sh and worked. v1.14 made it a lazy `import()` behind a frame check, to avoid fetching a CDN module for tab users who would never need it. Either way the file depends, at runtime, on a third-party script fetched from inside somebody else's iframe on somebody else's network. A Content Security Policy, a corporate proxy, a CDN outage or being offline each take embedded mode down, and each does it silently.

Bundling removes the dependency rather than working around it. From npm `@owlbear-rodeo/sdk@3.1.0`, bundled with esbuild as minified ESM, with the trailing `export{Zo as default}` replaced by `const OBR = Zo;`. An inline module cannot import from itself, so the default export becomes a plain binding in the block's scope. That substitution is the only edit to published code.

This also restores what the lazy import was for. There is now no request at all, so a tab user pays nothing, and the file works offline and from a downloaded copy, which the static import had broken and the lazy import only partly fixed.

**To update the SDK:** `npm install @owlbear-rodeo/sdk@<version>`, bundle with esbuild `--format=esm --minify`, swap the trailing export for `const OBR = Zo;`, and paste it over the block. Verified there are no identifier collisions between the minified bundle and the embedded block's own names.

Cost: the file grows from about 485 kB to 529 kB. One cached request, against a dependency that could not be relied on.

## Difficulty in roll entries, again

The roll bridge had been sending `diff: 0` with a faked verdict. It was fixed at v1.14, but the fix was applied to the *generated* file, and the next rebuild overwrote it, so `diff: 0` shipped for two versions. The fix now lives in `embed-block.html`, which is the source.

**Rule worth keeping: anything patched into a generated file is temporary.** Fixes go into the source or the build script.

## Verified, and not verified

Confirmed live: rolls reach the shared log, Momentum and Threat sync with the group pools, once-per-scene tracking holds, and the embedded sheet opens directly to the character.

Not verifiable in jsdom, and recorded as such at the time: frame detection, `OBR.isAvailable` behaviour, and whether a player's writes persist to the token in a way the GM can see. That last one was the release's open blocker, and it passed live before v1.17.

## Debugging note

When reading the console, set the context dropdown to the **extension frame** (the `gsgrimoire.github.io` entry), not the top Owlbear page. Two separate debugging rounds were lost to CSP errors that belonged to Owlbear's own page.

---

# v1.15 — Threat reaches the table

`APP_VERSION` and the header comment moved to `1.15`.

## What changed

New function `addThreat(amount, reason)`. Every Threat change in the app goes through it. Standalone it shows a toast, which is all it ever did; embedded, the module block replaces it to broadcast a `pool` event on the extension channel.

Wired to it:

- `useAdrenalineRush()`: 1/3/6 Threat for 1/2/3 Spirit. The amount was previously concatenated into the success toast; it is now a separate call.
- `useLimitedFeature('iKnowAGuy', 'threat')`: 2 Threat, held in `pendingThreat` and flushed only after `markLimitedFeatureUsed()` succeeds, so a feature that bails out partway does not push Threat for something that did not happen.

New `renderThreatCounter()` in the Resources grid, carrying `.obr-only` so it is present in the DOM always and visible only when embedded.

## Why a funnel rather than two call sites

Threat appears in this file about thirty times, and nearly all of it is rules prose in item and ability descriptions rather than a control the app drives: the Communicator's message, the Tactical Lens signal, Combat Automed's self-revive, Nanobarrier's escalating cost, several talents. Only two places are interactive.

Wiring those two and stopping would have left the other twenty-eight to be said out loud, which is the problem this release exists to fix. So there are two mechanisms: the funnel for the sources the app drives, and a manual +/− counter for everything printed in text. The counter is the honest answer to a rules surface that is mostly prose.

The funnel also means a Threat source added later is wired in both contexts by calling one function, rather than being wired standalone and forgotten embedded. That is the mistake the v1.14 Momentum bridge made in the other direction.

Five of those prose sources became buttons at v1.17.

## Momentum as a group pool, via an accessor

`DM_DATA` calls Momentum a group pool in two places: the Momentum resource text says the group can save up to 6, and the Circumspect drive refers to the group pool explicitly. Confirmed with the table: there is no personal pool, except that Momentum generated by a roll may be spent immediately by the roller.

Embedded, `currentMomentum` **is** the room's pool.

The first attempt overrode `adjustResource()`, which is what the counter's + and − buttons call. It caught one of six write paths and therefore looked correct while being wrong everywhere else. The others: `setResource()` from the number input, the direct `-=` in the three Momentum-spending abilities, the direct `=` in Adrenaline Rush, and the clamp in `normalizeCurrentValues()`.

Defining `currentMomentum` as an accessor property on the character object catches all of them, including any added later, because there is no way to write the field that does not go through the setter. `JSON.stringify` reads accessors normally, so `buildCharacterCode()` still serialises a plain number.

## Not applied locally, unlike Momentum

The Momentum accessor applies the change immediately and then broadcasts, because the player is spending their own resource and watching the counter respond. Threat waits for the GM's metadata update. It is announced to the table rather than spent by the player, the round trip is a few hundred milliseconds, and waiting keeps a single writer.

## Verified

Standalone: `addThreat` present, toast reads "Add 3 Threat — Adrenaline Rush", the Threat counter is in the DOM but carries `.obr-only`, and no network call is made on load.

Embedded: the counter reads the room's Threat on open; Adrenaline Rush at 2 Spirit broadcast `delta: 3`; the manual button broadcast `delta: 1`; a GM update setting Threat to 9 flowed back to the counter; and Momentum was untouched by any of it.

---

# v1.14 — rolling from the sheet

`APP_VERSION` and the header comment moved to `1.14`.

## What changed

- Attributes and Skills became pickable. Clicking one selects it for a test and highlights it. An Attribute shut down by Exhaustion cannot be picked.
- The Dice Roller moved up to sit directly beneath Attributes, Skills and Resources instead of near the bottom of the sheet.
- A Difficulty selector (D0–D5) was added beside the Roll button. The result now reports the verdict and the Momentum gained: "4 successes · Passed vs D2 · +2 Momentum".
- The share code block leads with Copy Code and Save Local, with the code itself in a small scrolling box below rather than filling the page.

## Why Difficulty mattered more than it looks

Momentum gained is successes beyond the Difficulty. Without a Difficulty the sheet could not report the one number a player acts on immediately after a test, and the roll bridge had been sending `diff: 0` with a faked verdict (passed on one or more successes, which matches D1, the commonest case). With the selector in place the embedded sheet and the roller popover produce identical log entries.

That fix was applied to the generated beta file and lost on the next rebuild. See v1.16.

## Build structure

From this release the live file is built from the previous live file, and the Owlbear beta is derived from the live file by appending the embed block. The beta is the live creator plus Owlbear support, by construction, so the two cannot drift during testing.

## The SDK import regression

v1.14 changed the SDK import from static to lazy `import()` behind a `window.self === window.top` frame check, to spare tab users a CDN fetch. The frame check could not be tested in jsdom and the lazy import inherited the same silent-failure mode as the static one. Both were replaced at v1.16 by a bundled SDK and `OBR.isAvailable`.

---

# v1.13 — snapshot v3, and the static/computed split

## What changed

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

## The decision this release turned on

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

## Deliberately not resolved statically

`getEquipmentTraitInfo()` composes the Powered trait's text from the item it sits on: a powered weapon, a powered armor and the Illuminator each read differently. No flat table can answer that, so `snapshotTraitTag()` compares the resolved text against the static table entry and inlines it only when they differ. Every other trait travels as a key.

## Verified

Booted the edited file in jsdom, built a Spear/Tech/Stubborn character with three catalogue items chosen for coverage (a Powered weapon, an armor with equip effects, a multi-quality thrown weapon), generated a code, and confirmed snapshot `v: 3`, all new fields populated, and `parseCharacterCode()` reading its own output without error.

Round trip confirmed: edited exhaustion, quantity, equipped and discharged state on the token, re-read the emitted code in the creator, and confirmed every segment except `CP` was byte identical.

---

# v1.12 — Snapshot v2: abilities, descriptions, exhaustion

## What changed

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

## Why this way

Exhaustion editing was deliberately withheld in v1.11. `activeExhaustion` holds keys
into `DM_DATA.exhaustionTypes`, and a consumer that cannot read that table has no safe
way to write the field. Rather than let the extension guess at key names and risk
writing a value the creator cannot read back, the table now travels with the code.

The alternative was porting `DM_DATA` to the consumer. Rejected for the same reason as
in v1.11: it duplicates rules data and guarantees drift.

`getAbilities()` is called defensively via `typeof getAbilities === 'function'`, so
reordering the script block cannot break code generation.

## Consequences

- Codes grow to roughly 9.4 kB, up from about 5.6 kB at v1.11. Still copy-paste safe.
- Snapshot `v` is now `2`. Consumers should treat a missing `exhaustionTypes` as
  "exhaustion unsupported" rather than an error, so v1 codes keep working.
- No change to `CP`, so the round trip is unaffected.

## Verified

Generated a code from a built character and confirmed `v: 2`, four exhaustion types
mapped to their attributes, abilities resolved with descriptions, and origin and
archetype description text present. Confirmed a v1 snapshot with `exhaustionTypes`
stripped degrades to "no exhaustion" without throwing.

---

# v1.11 — Owlbear Rodeo snapshot (`SN` segment)

## What changed

Added `buildOwlbearSnapshot()` and appended an `SN` segment to every character code.
`APP_VERSION` moved to `1.11`.

The segment carries computed, read-only values: `attrs`, `skills`, `techLevel`,
`spiritMax`, `supplyMax`, resolved `talents`, resolved catalogue `items`, plus name,
pronouns, portrait, truths, bonds and goals.

## Why this exists

A consumer outside this file cannot compute a character's stats. Deriving Might from
origin + archetype + temperament + growth needs `DM_DATA`, which is roughly 214 kB of a
445 kB file. Shipping a copy to the consumer would mean maintaining the same rules data
in two places, and the two would diverge the first time either was edited.

The creator already computes all of this in `computeStats()`. Writing the finished
numbers into the code lets a consumer read values without knowing the rules that
produced them, and keeps this file the single source of truth.

## Design constraints

**Derived only.** Live session values (`currentSpirit`, `injuries`, equipped and
discharged flags) are *not* duplicated into `SN`. They already ride in `CP`. Keeping
mutable state in exactly one place is what makes a round trip lossless: a consumer can
edit `CP` and re-emit the code without `SN` going stale.

**Appended last.** `parseCharacterCode()` reads segments by prefix from index 5 onward
and ignores unrecognised prefixes, so a code carrying `SN` still loads in v1.10 and
earlier. Forwards and backwards compatible.

**`fullDescription` dropped** from items. It is the largest field per item and a play
aid does not need the full rules text.

## Consequences

- Codes roughly doubled in length, from about 2.8 kB to 5.6 kB.
- Base64-of-URI-encoded inflates the payload about 2.1x. Kept anyway for consistency
  with the existing `CP` convention.

## Verified

Built a character in a stubbed browser, generated a code, decoded `SN` and confirmed
attributes, skills, spirit and supply maxima, tech level, talents by name and items
with quantity and equipped state. Confirmed the edited creator reparses its own code
with no error. Separately confirmed that editing `CP` and rebuilding leaves every other
segment byte-identical.

---

# v1.10
Released against v.1.09.

## Setup and deployment

1. Replace `dnm-character-creator.html` in place. Filenames do not change.
2. `CHANGELOG.html` and `UPGRADE_NOTES.md` are updated in the same release and belong in the same directory.
3. No storage migration is required. The browser library key remains `dm_character_creator_library_v1`.
4. `DM1` share codes from v.1.09 import without loss. Characters saved in v.1.10 carry one new field, `limitedUseAbilities`, which older builds ignore.
5. From this release the version number is written once, in `APP_VERSION`, and stamped into the header link at load. Earlier releases carried it as literal markup in two places, which had already drifted: the link read `Version v.1.09` while the constant read `v.1.10`. Do not hard-code it again.

## Limited-use abilities

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

## Boundary controls

`Boundaries & Rest` in the sheet header now holds six controls. The three rest controls behave as in v.1.09.

| Control | Clears |
|---|---|
| End Scene | once-per-scene actions, scene-length effects, scene-limited abilities |
| New Session | everything End Scene clears, plus session-limited abilities |
| New Adventure | everything New Session clears, plus adventure-limited abilities |

New Session and New Adventure exist because those boundaries have no automatic trigger. A rest does not imply either one, and neither substitutes for a rest: New Adventure does not restore Spirit or recharge Powered items.

## Identity header layout

Tech Level moved from the right-hand play-controls column into the name row, right-aligned opposite the character name. It is a single number that does not change during play, so it reads as identity rather than as a play control, and moving it lets the Rest buttons sit directly under the portrait instead of being pushed down by a 3rem numeral.

Its tooltip opens downward. On the top line of the panel an upward tooltip is clipped by the panel edge.

Origin, Archetype, and Temperament tags now stack vertically, each hugging its own text, matching the Rest button column. The identity column is sized to its content instead of holding a 150px minimum, so the three Goals boxes absorb the freed width.

## Identity tag tooltips

These tooltips previously printed the type label in both the title and the body, so hovering the Archetype tag produced "Archetype / Archetype". The body now carries the description from `DM_DATA`, which exists for every Origin, Archetype, and Temperament. Where no description exists the body is omitted rather than rendered empty, so the tooltip degrades to a bare title.

Two supporting changes were required. The tooltip box widened from 180px to 300px, because a 300-character description at 180px renders as a tall thin column; and it anchors to the tag's left edge instead of its midpoint, because a centred 300px box on a short tag such as `RIVER` hangs off the left of the sheet.

## Re-render continuity

`renderStep()` rebuilds the active view by assigning `innerHTML`. That keeps rendering a pure function of state and is worth keeping, but it cost continuity: every `<details>` reverted to its markup default and the document got shorter, so any button that triggered a re-render collapsed the panels the player had open and jumped the viewport. Equip and Discharge were the most visible cases, but the behaviour affected every re-render, including rests and confirmations.

The open and closed set, and the scroll offset, are now captured immediately before the swap and reapplied immediately after, synchronously, so nothing paints in between. The alternative was targeted DOM updates per handler, which means tracking exactly which fragments each of roughly thirty handlers can touch and getting it wrong on the next change.

Implementation points worth knowing before editing this code:

- Keys are derived from content, not position: summary text, the nearest labelled ancestor, and an occurrence counter for repeats. Position-based keys shift the moment a list gains or loses a row, which is precisely the case this has to survive.
- Both directions are restored. A `<details open>` in the markup that the player deliberately closed stays closed through a re-render.
- Scroll is restored only when the view is unchanged. Moving between steps, or finalizing, legitimately changes what the player is looking at, and those paths scroll to top themselves.
- An element's class list is part of its key, because a card's classes encode its state. Two cards with the same name but different state are different rows and must not inherit each other's open flag.

## Exhaustible feature coverage

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

# v1.09
Released against v.1.08.

## Setup and deployment

1. Upload `dnm-character-creator.html`, `CHANGELOG.html`, and `UPGRADE_NOTES.md` to the same directory.
2. Replace links to `1.08.html` or earlier versioned creator filenames with `dnm-character-creator.html`.
3. Existing versioned files may remain as historical copies, but the public link should point to the stable filename.
4. Browser local saves continue to use the existing `dm_character_creator_library_v1` storage key.
5. Existing `DM1` share codes remain the import format. The full payload now carries the new v.1.09 fields.

## Actions, Talents & Abilities

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

## Once-per-scene state

Adrenaline Rush becomes unavailable after use. `End Scene` clears:

- `oncePerSceneUsed`
- `activeSceneEffects`

End Scene does not change Spirit, Supply Points, Momentum, Coin, Growth, Truths, Injuries, or item state.

The once-per-scene and active scene-effect arrays are included in local saves and share codes. This prevents reloading the page from refreshing an action unintentionally.

## Spear's Blend and automatic Spirit bonuses

Characters with the `spearsBlend` Origin Ability receive an additional expandable action card.

- Activating Spear's Blend spends 1 Supply Point.
- The effect remains active until End Scene.
- While active, Adrenaline Rush restores +1 additional Spirit, subject to the normal Spirit maximum.

This activation step is required because Spear's Blend is administered at the start of a conflict scene. Possessing the ability alone does not make the benefit permanently active.

The `Bold` talent is also applied automatically when Adrenaline Rush is used. A momentary notification explains any bonus from Bold or Spear's Blend. If the character has a Rivalry Bond, the notification also reminds the player that the bonded ally gains 1 Spirit.

## Rest and recovery

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

## Powered item state

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

## Spirit and Supply Point initialization fix

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

## Custom Items

Custom Items is a separate subsection under Owned Items. It stores plain single-line text for story objects and module-specific possessions that are not catalogue items.

- Typing into the final blank line creates another blank line.
- Empty entries are removed when the field loses focus.
- Entries are included in local saves and share codes.
- Custom Items have no quantity, equipped state, or automated rules.

## Knowledge Fragments

Knowledge Fragments are tracked as an auto-growing free-text list inside Resources.

- The list uses a fixed-height scroll area to prevent it from making the Resources section disproportionately tall.
- Fields use the same text styling as Truths and Injuries.
- There is no Remove button. Clearing a field removes the empty entry.
- Entries are included in local saves and share codes.

## Truths

`Character Truths` is relabeled `Truths` because location, situation, personal, and equipment Truths may all be relevant on the sheet.

- The manual add control is labeled `Create Truth`.
- The Truth tooltip explains the four Truth types.
- Define Truth can add a field without a Momentum cost.
- Create Truth spends 2 Momentum and adds a field.

## Finished sheet layout

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

## Persistence fields added or extended

```javascript
customItems: []
knowledgeFragments: []
oncePerSceneUsed: []
activeSceneEffects: []
items: [{ id, qty, equipped, discharged }]
```

Older saves and share codes default missing arrays to empty arrays and missing discharge state to `false`.

## Verification performed

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

# v1.08
Released against v.1.07.

## Features and fixes

- Added equipped state to owned catalogue items.
- Added structured equipped resource modifiers, situational reminders, and manual item actions.
- Applied equipped item effects to derived values, including maximum Supply Points where relevant.
- Added fuller item descriptions, rules notes, availability notes, and effect notes to expandable owned items.
- Expanded equipment category, property, quality, Tech Level, rarity, and manufacturing tooltips.
- Added editable current values for Spirit, Supply Points, Coin, Growth, and Momentum.
- Added editable Truth and Injury fields on the finished sheet.
- Improved catalogue scrolling, floating tooltip placement, clear-search behavior, and section layout.
- Improved dark and light printable sheet output.

## Compatibility note

The v.1.08 Spirit and Supply Point initialization fault is repaired in v.1.09 but is not retroactively guessed for existing zero values. See the v.1.09 migration note above.

---

# v1.07
Released against v.1.06.

## Features and fixes

- Added a Character Portrait Web Address field in Character Info.
- Added live portrait preview and a fixed portrait frame on the finished sheet.
- Persisted `portraitUrl` through full payloads, imports, share codes, and local saves.
- Restricted portrait addresses to `http://` and `https://` and added Clear Portrait behavior.
- Expanded Supportive and Rivalry Bond tooltips with their mechanical effects.
- Added disclosure indicators and improved spacing to owned item rows.
- Removed repeated metadata from expanded owned item content.
- Fixed Item Catalogue search focus loss by updating only the item grid while typing.

## Implementation notes

- Portrait image bytes are not embedded in character data.
- Browser-side `object-fit: cover` handles the visible crop.
- Image hosts may block external display. Failed loads do not corrupt character data.
- Characters without `portraitUrl` default to an empty value.

---

# v1.06
Released against v.1.05.

## Features and fixes

- Added the standalone player-facing changelog.
- Linked the header version label to the changelog.
- Added Back to Character Creator links.
- Moved Growth to the second-to-last finished-sheet section.
- Moved Character Share Code to the bottom.
- Fixed Item Catalogue sub-filter refresh when the main category changes.

## Implementation notes

- The changelog is static and works when kept beside the creator.
- Catalogue refresh replaces the full catalogue block when category controls must change.

---

# v1.05
Released against v.1.04.

## Features and fixes

- Exhaustion now disables Dice Roller options that use the shut-down attribute.
- Exhausted attribute options are visibly struck through.
- The Roll button and roll execution both block tests using an exhausted attribute.
- Item Catalogue sub-filters prioritize Atoma or manufacturing category, with practical fallbacks.
- Character Share Code moved near the bottom and Growth moved to the final section for that release.

---

# v1.04
Released against v.1.03.

## Features and fixes

- Added multiple local character saves using browser local storage.
- Added finalized character mode with an Edit Character return path.
- Moved Character Share Code into a collapsible finished-sheet section.
- Limited character-code import controls to the opening screen.
- Added mutable Spirit, Supply Points, Coin, Growth, and Momentum session values.
- Expanded equipment trait and property tooltips.
- Made Item Catalogue and Starting Equipment collapsible.
- Added clickable Exhaustion States and visible affected-attribute styling.
- Made owned inventory entries expandable.

## Save behavior

Browser local storage is convenient but tied to the browser and site origin. Share codes remain the portable backup. Clearing site data removes local saves.

---

# v1.03
Released against the earlier creator build.

## Features and fixes

- Added full skill names and attribute and skill tooltips.
- Added the inlined item catalogue with search, filters, and quantity tracking.
- Added Exhaustion States and their affected attributes.
- Added the client-side Dice Roller.
- Added shared roll room support through `/api/roll`, Server-Sent Events, and a polling fallback.
- Added the standalone `/room/<code>` view contract.
- Added collapsible Character Share Code output.
- Fixed character-code base64 padding so names, goals, items, and full-state payloads import reliably.

## Server note

The character creator itself works client-side. Shared roll rooms require the companion server endpoints. With `DM_API_BASE` set to an empty string, the creator expects those endpoints on the same origin.
