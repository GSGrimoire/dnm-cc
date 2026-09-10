---
name: gsgrimoire-dnm-vtt
description: >
  Development conventions for the Dreams & Machines virtual-table toolchain: the character
  creator (GSGrimoire/dnm-cc) and the Owlbear Rodeo extension (GSGrimoire/dnm-obr). Load this
  skill whenever touching either repo — bug reports from play, new features, a release, a
  version number, a deploy, or a question about how the two halves talk to each other.
  Triggers: "dnm-cc", "dnm-obr", "the creator", "the extension", "the roller", "the party
  panel", "the sheet", "Owlbear", "character code", "DM1", "table controls", "epochs",
  "hidden roll", "attach to token", "deploy the creator", "what version", "bump the version",
  "ship this", "QA came back", "found a bug at the table". Also load it when writing the
  CHANGELOG or UPGRADE_NOTES for these repos, and when deciding whether a change is a letter
  release or a number release. This carries the VERSIONING RULE, the DEPLOY ORDER and the
  TRUST BOUNDARY, all three of which have been got wrong at least once and cost a session.
  It does not cover game content — encounters and adventures go to gsgrimoire-modules.
---

# Dreams & Machines VTT toolchain

Two repos, one product. Get the version, the deploy order and the trust boundary right and
the rest is ordinary work.

## Where this file lives, and why

`GSGrimoire/dnm-cc/.claude/skills/gsgrimoire-dnm-vtt/`. It is committed to the repo on
purpose. It lived in a session's home directory once and a skills sync deleted it, taking
the versioning rule and the deploy order with it — both of which had already cost a session
each to learn. In the repo it is versioned, reviewable, and arrives with the code it
describes.

It covers both repos even though it sits in one. `dnm-obr` has no copy: two copies drift,
and the first drift would be in the part that matters. `dnm-obr/README.md` points here.

**Update it in the same commit as the thing it describes.** A convention recorded a week
later is a convention nobody followed.

## The versioning rule

**Three sizes, and the size is decided by INTENT, not by how much code moved.**

```
1.30    a real feature — something the table could not do before
1.30.1  a minor edit — layout, wording, a tooltip, a colour
1.30.1B fixing what 1.30.1 got wrong
1.30.1C still fixing it
1.31    the next real feature
2.0     a major feature, the kind the product is remembered for
```

| Change | Version |
|---|---|
| A bug found in play on the release you just shipped | **letter** |
| A regression you introduced fixing something else | **letter** |
| Restoring behaviour that used to work | **letter** |
| Layout, spacing, wording, colour, a label | **.x** |
| Rearranging a panel, renaming a control | **.x** |
| A new panel, a new control, a new rule, a new automation | **number** |
| A deliberate reversal of an earlier decision | **number** |
| A security fix that changes what users can do | **number** — behaviour changed on purpose |
| A headline capability: the sheet usable beside the map, or similar | **whole number** (2.0) |

**The default is the smallest thing that fits.** Numbers ran away in the first weeks of
this project — 1.24 to 1.30 in a handful of evenings, most of it tooltips and line
breaks — and a number that goes up for a tooltip stops meaning anything. When in doubt
between `.x` and a number, take `.x`.

When a release carries **both** a fix and a deliberate change, take the larger of the
two: the deliberate part is what the release is for.

Apply the rule to whatever is actually DEPLOYED, not to what someone remembers being
deployed. If 1.30 is live and needs a fix, that is **1.30B** — not 1.29B, even if the
conversation said 1.29.

The extension carries its own number (`0.9.x`) and follows the same shape. The two do not
have to move together; a creator-only release leaves the extension where it is and says
so. **When the creator reaches 2.0 the extension goes to 1.0** — they are one product and
a headline release should read that way on both halves.

## Where the version lives

Change all of these together or the release is half-applied:

- `dnm-cc/index.html` — `APP_VERSION`
- `dnm-cc/CHANGELOG.html` — the new entry, the `<h1>Version v.x.y</h1>` banner, AND the
  footer note naming the required extension version. The banner and footer are easy to miss.
- `dnm-cc/UPGRADE_NOTES.md` — a new section at the top
- `dnm-cc/tests/creator.test.mjs` — the `APP_VERSION` assertion
- `dnm-obr/manifest.json` — `version`, when the extension changed

**Edit `CHANGELOG.html` in place. Never regenerate it.** It was rebuilt from a description of
itself once and silently lost eight entries. A document rebuilt from a summary loses whatever
the summary omitted.

`CHANGELOG.html` is for players and says what changed at the table. `UPGRADE_NOTES.md` is for
a developer reading cold and says why, including what was deliberately left out.

## Deploy order

GitHub Pages serves `main` on both repos. `main` is production. Work on a branch.

1. **`dnm-obr` first.** A creator sending events an old extension ignores is harmless. A
   creator expecting something the extension never writes sits broken.
2. **`dnm-cc/index.html`**
3. Docs
4. **Everyone reloads the room.** The extension's background page is cached per room session,
   so a tab refresh is not always enough. Say this in every release note.

Before claiming a deploy: **verify `main` actually moved.** Check `git rev-parse main` against
`origin/main`. Pushing `main` while checked out on another branch succeeds and does nothing —
it has happened, and the release was reported as live when it was not.

## Two ways the sheet runs

`OBR.isAvailable` is `!!ee.origin`, read from the `obrref` query parameter — not from
being framed. But the transport sends through `window.parent.postMessage` and throws
"not ready" until that parent completes an `OBR_READY` handshake. So:

| | SDK | how it reaches the room |
|---|---|---|
| Framed by Owlbear | works | directly |
| A plain browser tab | dead | it does not; the creator runs alone |

Since v2.0 "framed by Owlbear" means a **docked popover**, not a centred modal. A popover
is still framed, so it keeps a working SDK — which is the whole reason the route works.

**A separate window can never use the SDK.** Do not try to make `window.open` work by
copying `obrref` into the URL: `isAvailable` will then be true and every call will still
throw, which is worse than the honest failure.

**v1.29's popped-out window and its BroadcastChannel relay were deleted in v2.0.** It
never once connected in play, including in a brand new room where the extension was
certainly current. The likeliest cause is Chrome partitioning storage by top-level site:
the extension is a third-party frame under `owlbear.rodeo` and a popped-out window is
first-party on `gsgrimoire.github.io`, so their channels sit in different partitions. It
was once "disproved" by a Chromium test that ran on `localhost` and `127.0.0.1` — **and
Chrome exempts loopback from partitioning**, so the test could never have shown the
effect. What settled it was play, not the test bench.

**A test run on the wrong shape is worse than no test**, because it gets written down as
a fact. To test partitioning you need two real cross-site hostnames.

`dock.test.mjs` asserts that neither half opens a `BroadcastChannel`, so reviving the
relay has to be a decision rather than an accident.

Everything Owlbear-shaped still goes through `bridge`, which now has one implementation.
Keep its surface NARROW: a general SDK proxy cannot work, because the token write is
`scene.items.updateItems(ids, mutator)` and a mutator function cannot be
structured-cloned.

**Owlbear caches the background page for the whole room session.** A new extension
version is not running until the ROOM is reloaded; a tab refresh is not enough. This is
the first thing to suspect when a new feature does nothing.

## The docked sheet (v2.0 / 1.0, regridded v2.1 / 1.1)

The sheet opens as `OBR.popover.open` with `anchorReference: "POSITION"`, pinned to one of
NINE anchor points. `disableClickAway: true` is the release: without it the first click on
the map dismisses the sheet, which is what the docked sheet exists to remove.

**What the API allows, checked across all twelve APIs in SDK 3.1.0 (the current release).
Do not re-derive this.**

| API | geometry it exposes |
|---|---|
| Popover | open, close, getWidth, setWidth, getHeight, setHeight |
| Modal | open, close. Nothing else, not even size |
| Action | the right-hand drawer: size only, Owlbear owns the position |

**There is no `setPosition` anywhere**, and `anchorPosition` is read once at open. So SIZE
is live and free, and MOVING costs a close and a reopen, which reloads the sheet. That is
why moving is a press on the position pad and resizing is a drag, and why `redock()`
flushes the save first — the reopened sheet reads the character back off the token.

**Roll20's free-floating sheet is not buildable here, and the reason is structural.**
Roll20 IS the page; its sheet is a div it owns. Ours is a separate site in an iframe
Owlbear places. A full-screen transparent modal with our own floating sheet inside looks
like the way round it and is not: `disablePointerEvents` makes the frame transparent to
hit-testing entirely, and content in a different document cannot re-enable itself from the
inside, so you get a draggable sheet over a dead map or a live map under a dead sheet.

The drag-ghost that IS possible: inflate the panel to the full viewport with `setWidth`
and `setHeight`, which is reload-free, draw the ghost inside it, and reopen at the target
on release. Unproven in a room as of 2.1 — see UPGRADE_NOTES for the three checks.

Four details that each look like a bug when got wrong:

- **`transformOrigin` pins the panel to its anchor.** One held by its RIGHT corner grows
  leftwards under `setWidth`; one held by its left corner walks off the screen.
- **`marginThreshold` defaults to 16**, so a panel left at the default stops just short of
  the edge.
- **The panel may fill EITHER axis but never both.** That is what lets a full-height panel
  sit beside the map and a full-width one sit below it. Width is decided first and height
  gives way, so the geometry cannot answer differently for the same stored dock.
- **A 1.0 dock carries a fill the stored object never held.** A side dock was full height
  and the bottom dock was full width whatever their stored numbers, so `LEGACY_SIDES`
  restores that axis or a bottom dock silently shrinks to 560px on the update.

The popover id is `${ID}/sheet-panel`, deliberately **not** `${ID}/sheet` — that string is
already the token context menu item.

**Each anchor keeps its OWN size** (1.2). `clampDock()` returns `{ anchor, zoom, sizes }`
with an entry for every anchor; `dockSizeFor()` reads one and `withDockSize()` replaces
one, and the resize drag must write through the latter or dragging at one anchor silently
resizes the rest. Defaults follow the anchor's shape: sides and centre are tall, top and
bottom are broad, corners are a box. A 1.1 dock's single flat size seeds only the anchor
it belonged to.

**The creator's copy of the dock helpers is GENERATED from `dnm.js`**, not hand-copied.
Regenerate it rather than editing it; that is what made a 3x3 rewrite of duplicated code
safe to attempt. `dock.test.mjs` compares the two copies over thousands of inputs. The
dock preference lives in `localStorage`, which is shared origin but **untrusted** — clamp
it on the way OUT.

## Recent Rolls comes from two places (v2.1)

Rolls made on the sheet are recorded locally; rolls made in the roller are picked up from
the ROOM LOG by `reconcileRolls()`, not from broadcasts — the log is already sanitised,
and reading it catches up rolls made while the sheet was closed.

- **Every roll carries an id**, stamped once in `doRoll()` and used by both the local
  record and the broadcast entry, or a sheet's own roll comes back as a stranger and is
  listed twice.
- **Matching is by character NAME** through `bondNameKey()`, because that is all the
  roller knows. An unnamed character matches nothing, or it would match every unnamed roll
  at the table.
- **A concealed roll is never copied to a sheet.** The roller decides who may draw one.

## The two halves

`dnm-cc/index.html` is the whole creator in one file: a classic `<script>` with the app, then
a `<script type="module">` at the end that only runs inside Owlbear and bridges to the
extension. It also carries a vendored copy of the Owlbear SDK inline.

`dnm-obr` is the extension: `roller.js` (the popover), `background.js` (the room-lifetime
page), `dnm.js` (shared helpers and the event reducer), `sdk.js` (vendored SDK).

**Four constants are the contract** and appear in both repos. Change one, change both:
`com.thuknights.dnm-obr` (`EXT_ID`), `…/char` (`CHAR_KEY`), `…/events` (`CHANNEL`), and
`com.thuknights.dnm-rolls/state` (`ROOM_KEY`).

`thuknights` is the original host from before the move to GSGrimoire. It is a namespace
string, never a URL, and nothing is fetched from it. It is load-bearing as a key: renaming it
orphans every attached character and every room's log, so it needs a migration, not a
find-and-replace.

Read `references/architecture.md` before changing how the halves talk — the character code
format, the token metadata, the epoch mechanism and the event reducer are all documented
there, along with the failure each design avoids.

## The trust boundary

Owlbear's broadcast channel is open to every client in the room. **A check that runs in the
sender's own tab is not a control** — the sender can skip the function holding it.

The GM's `background.js` is the only writer of room metadata, so it is the only place a real
check lives. It verifies the sender's connection id against the room's GMs for privileged
events. Anything that must be enforced goes there.

What is privileged, and why:

- **Epochs and clearing the log** — GM only. An epoch reaches every attached character
  including offline players and cannot be undone.
- **Threat** — GM only *downwards*. Paying Threat in is a player action the rules require:
  Nanobarrier, Adrenaline Rush and several items all add it. The direction is privileged, not
  the pool.
- **Momentum** — open to everyone. It is the group's pool.

**A room with NO GM writes nothing at all.** `persist()` runs only on the GM's client, so
with nobody in that seat every pool change, rest and log entry is dropped. That is the
single-writer rule working, and it stays — but warn, do not fail silently: a player whose
Momentum moves on their sheet and nowhere else will report the sheet as broken.
`roomHasGM()` exists in the roller, the creator's direct bridge and the relay host.
`getPlayers()` lists everyone EXCEPT this client, so check the caller's own role too or a
lone GM is told there is no GM — and fail OPEN, because a party read racing a disconnect
must not cry wolf at the whole table.
- **Bond effects** — open. A forged one can only pay a sheet that already holds the
  matching bond, and blocking them would break every bond at a table whose GM has the
  extension closed.
- **The Maverick drive** — GM only, unlike the two bonds, because its own text says "when
  THE GM spends". A forged one would reach every Maverick at the table on nobody's
  authority.

Sender-side checks stay anyway: they stop honest misclicks, which is worth having.

Before tightening a permission, find **every** caller of the path. Threat was locked to the GM
by reading the roller's UI, which had disabled it for players — and that silently broke every
ability that charges Threat from the sheet.

## Pool changes

Every Threat change funnels through the creator's `addThreat()`; every Momentum change
goes through the accessor `bindMomentumToRoom()` installs, which catches all six write
paths because there is no way to write the field that does not go through the setter. A
call site that broadcasts for itself is a bug — it bypasses the funnel and, since v1.27,
the batching with it.

Since v1.27 a run of nudges to the same pool under the same LABEL is summed and sent once:
one pool event, one log line reading "added 3 Threat". Three presses used to be three of
each, and the log recorded the clicking rather than the decision. The label is the
coalescing key, which is what keeps an ability out of a manual run — every ability passes
its own reason.

Two rules the batching depends on:

- **A parked Momentum label is never batched.** Its detail is written by the ability
  ("spent 3 Momentum, regained 3 Spirit") and cannot be regenerated from a total, and two
  uses of Second Wind are two decisions rather than one spend of six. Threat is batchable
  under any label because its detail always regenerates from the sum.
- **Manual + and − share one key** (`MANUAL_POOL_LABEL`) with the direction left out, or a
  press up and a press down cannot cancel and land as two entries for a change nobody made.

`createPoolBatcher()` is duplicated: `dnm.js` for the roller, and a copy in the creator's
module block, which cannot import without becoming a page that needs the network. Change
one, change both — the same rule as the four shared constants.

Coalescing is also what made the **Maverick drive** possible (v1.28): "spends 3 or more
Threat at once" had nothing to read while a spend of 3 arrived as three spends of 1. It
follows that the announcement must come from the client that made the spend — only that
client knows a run of presses was one decision — so `announceThreatSpendDrive()` hangs off
each side's batcher flush, in both repos.

**The other five drives are not automated and should not be.** They are things the sheet
cannot see: being first to act in a round, creating a Truth that represents a plan. Only
Maverick's has an observable trigger.

## Working from a QA report

Play reports arrive as symptoms, and the same root cause usually produces several. Reproduce
before fixing: a symptom that sounds impossible ("Sentinel doesn't appear, Weaver does") is
the most informative thing in the report, because it names the variable.

Two habits worth keeping:

- **Ask what is different about the case that fails.** Sentinel's archetype code is `SNT`, and
  the parser searched forward for a segment starting with `SN`.
- **Fix the pattern, not the instance.** Attaching a character to a token broke three releases
  running because each fix hooked one more entry point. Route them through one function
  instead.

Where a report is ambiguous and the readings mean different work — especially anything
touching the trust boundary — ask before building.

## Testing

`dnm-cc/tests/` holds six suites. They read the two repos from `dnm-cc/out/`, which is
gitignored scaffolding, not source — stage it before every run or you will test the last
release:

```sh
cd dnm-cc
npm install jsdom playwright --no-save     # both, together: --no-save prunes the other
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator embedded party dock security layout; do node tests/$t.test.mjs; done
```

`npm install X --no-save` removes anything else installed the same way, so install jsdom
and playwright in ONE command or the next run dies on a missing module.

- `creator.test.mjs` — the creator in jsdom, module block stripped
- `embedded.test.mjs` — the module block itself, run against a stub SDK
- `dock.test.mjs` — the dock geometry, the creator's generated copy against `dnm.js`'s,
  and the roll merge on a sheet booted onto a real token
- `party.test.mjs` — party status, the GM-only rule, the bond queue, the pool batcher
- `security.test.mjs` — written from the attacker's side: forged events into the reducer,
  hostile codes into the parser
- `layout.test.mjs` — Chromium through Playwright, at the panel widths the sheet is
  actually read at. The only suite that can see layout at all; skips if Playwright is
  missing

`embedded.test.mjs` (v1.27) closed a gap the other three had disclaimed for fifteen
releases. The block has no imports — the SDK is inlined — so once the SDK is removed it
is ordinary script code that can be evaluated in the same jsdom window. **Find the SDK by
LINE LENGTH, not by text**: two comments above the bundle quote `const OBR = Zo;`, so a
substring search deletes a comment and leaves the SDK in place.

**Stripping the SDK hides every collision with it, so PARSE THE BLOCK WITH THE SDK IN
PLACE FIRST.** The vendored bundle is minified and owns the short top-level names. v2.1
declared `const H` and `const V` beside it; `V` was already taken, a duplicate top-level
const is a SyntaxError, and a SyntaxError in a module means the module never runs AT ALL.
The sheet loaded as the plain standalone creator — no header bar, no way to close the
panel, no character — and all five suites passed, because they had removed the half of the
file that made it illegal.

`embedded.test.mjs` now runs `new vm.Script(block)` before stripping anything, and asserts
that no top-level name in the generated dock helpers is one or two characters. **Never give
anything in the module block a one or two character top-level name.**

jsdom gives each `w.eval` its own scope for lexical declarations, so the block's `const`
and `let` bindings are unreachable from a test. Function declarations and `window.*`
assignments are. Assert through the bridges and through what was BROADCAST — which is
the honest surface anyway, since what the room is told is the thing that matters.

Two rules earned the hard way:

**Build fixtures the way the app builds them** — an origin, archetype and temperament that
exist in `DM_DATA`, then `computeStats()`. A fixture that assigns state directly confirms
whatever the code already does. That is how a forced-talent bug survived a full release.

**Untrusted input is anything that arrives in a character code.** It is pasted from chat
and read off tokens any player can write to. Clamp it on the way OUT of storage, not on
the way in, and clamp hardest whatever the renderer LOOPS over — `recentRolls` in the
creator, `detail` in the extension's `sanitizeEntry()`. An entry claiming a hundred
thousand dice freezes whoever draws it.

**And ESCAPE it.** `buildCharacterCode()` embeds the whole character object as a base64
JSON payload, so every field in it is attacker-controlled, and the creator renders with
`innerHTML` in twenty places. v2.0B fixed a code that could run script in whoever opened
the sheet, through an unescaped growth purchase label. That is not defacement: the sheet
is framed by Owlbear with a working SDK, so the script holds the reader's seat at the
table, and `background.js` verifying connection ids cannot help — XSS in the GM's sheet
IS the GM's connection.

Three rules from that one:

- **Every character field reaching `innerHTML` goes through `escHtml()`**, or through a
  normaliser that coerces it to a number. The discipline was already right in eleven
  places; three were missed.
- **Find every render of the same data.** The growth list is rendered twice, in the play
  view and in the wizard, and fixing only the first left the second live.
- **Fuzz it, do not read it.** Poison every character field with a marker and check which
  come back as live DOM. Reading found one sink; the harness found the rest and proved
  the others safe. Distinguish "escaped" from "never rendered" or the clean result is
  meaningless.

**Validate a key AFTER the CP payload is applied, not before.** `parseCharacterCode()`
checked the origin, archetype and temperament segment codes and then `Object.assign`ed the
payload over the top without re-checking, so a character naming a key this build does not
have parsed cleanly and threw on render — a blank sheet with no message. The likely cause
is a character from a newer creator meeting a room serving the cached older one, or a
renamed key. Refuse only a key that is SET and does not RESOLVE: an EMPTY origin is an
unfinished character and has always imported.

**Ask what a green suite cannot see.** Three releases running, the bug was in the gap
between the test environment and the real one: a fixture the earlier assertions had already
normalised, an assertion sitting next to the thing it cared about rather than on it, and a
test environment with the SDK removed. Green means the assertions passed, not that the
thing works.

**When an assertion fails against code you believe is correct, suspect the ASSERTION
first.** Four times in five releases a first-draft assertion measured something adjacent to
the thing it cared about: a character name instead of the header bar it sat next to, a
regex over rendered HTML instead of the parsed DOM, a stored width instead of the real one
the drag starts from, and `scrollWidth` on a tag row that was actually measuring the hidden
tooltips inside each tag. Go and look at what it is really measuring before changing the
code.

**Prove a new regression test fails without the fix.** Revert the fix, watch it fail, restore.
A test written after the fix can pass for reasons unrelated to the bug.

Do it against `out/`, not the source — mutate the staged copy, run, restage.

**Assert through the DOM, not a regex over rendered HTML.** A regex encodes a guess about
how the markup was written; the parser decides what it actually IS. An escaping assertion
written as a regex passed under mutation and proved nothing. And **do not reuse a fixture
the assertions above have already mutated** — a block that ran after the play view had
rendered was asserting against data the play view had normalised.

And when the behaviour is about TIMING, space the test out like a hand does. The pool batcher's
headline test drove three presses in one tick, which coalesce under any deferral at all
including `setTimeout(…, 0)` — so it passed with the debounce removed. Only a test with
real gaps between the presses caught it.

What no suite can reach: actual broadcast delivery, the GM's relay, room metadata round
trips, role gates, the party panel, and everything about how Owlbear actually renders the
docked popover — whether the map stays interactive behind it, whether the geometry lands
flush, whether `setWidth` resizes without reloading. **jsdom does no cascade and cannot lay anything out**, which is a limitation with a whole
class of bug behind it: v2.1 put the Roll button 19px outside the panel and dropped an
item's tags across its own buttons, and all five jsdom suites were green. `layout.test.mjs`
exists for that and should be extended rather than worked around. Two faults it was written
for, both worth knowing before writing narrow-width CSS:

- **A flex or grid child with `min-width: 0` shrinks to NOTHING rather than wrapping**, and
  a zero-width child spills its contents over its neighbours rather than clipping them.
  `flex: 1 0 100%` forces a wrap where `1 1 100%` still gives way.
- **`minmax(Npx, 1fr)` is a floor the grid will not go below**, so it hangs past the edge
  of any narrower container. `minmax(min(Npx, 100%), 1fr)` gives way.

List whatever is left as live checks in the release notes rather than implying coverage
that does not exist.
