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

**A number goes up only when something changed on purpose. Fixing what a release got wrong
gets a letter.**

```
1.23   a deliberate change — a feature, a redesign, a decision
1.23B  fixing what 1.23 got wrong
1.23C  still fixing it
1.24   the next deliberate change
```

Why it matters: a run of numbers reads like a run of progress. Three numbers in an evening
says three things were built, when what actually happened was one thing built and two attempts
to make it work. The letter is honest about that, and it keeps the number meaning "we decided
to do this".

The distinction is **intent**, not size:

| Change | Version |
|---|---|
| A bug found in play on the release you just shipped | letter |
| A regression you introduced fixing something else | letter |
| Restoring behaviour that used to work | letter |
| A new panel, a new control, a new rule | number |
| A deliberate reversal of an earlier decision | number |
| A security fix that changes what users can do | number — the behaviour changed on purpose |

When a release carries **both** a fix and a deliberate change, it is a number. The deliberate
part is what the release is for.

Apply the rule to whatever is actually deployed, not to what someone remembers being deployed.
If 1.23 is live and it needs a fix, that is **1.23B** — not 1.22B, even if the conversation
said 1.22.

The extension carries its own number (`0.9.x`) and follows the same rule. The two do not have
to move together; a creator-only release leaves the extension where it is, and says so.

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

`dnm-cc/tests/` holds three suites. They read the two repos from `dnm-cc/out/`, which is
gitignored scaffolding, not source — stage it before every run or you will test the last
release:

```sh
cd dnm-cc
npm install jsdom playwright --no-save     # both, together: --no-save prunes the other
mkdir -p out/dnm-cc && cp index.html out/dnm-cc/
rm -rf out/dnm-obr && cp -r ../dnm-obr out/dnm-obr
for t in creator party security; do node tests/$t.test.mjs; done
```

`npm install X --no-save` removes anything else installed the same way, so install jsdom
and playwright in ONE command or the next run dies on a missing module.

- `creator.test.mjs` — the creator in jsdom, module block stripped
- `embedded.test.mjs` — the module block itself, run against a stub SDK
- `party.test.mjs` — party status, the GM-only rule, the bond queue, the pool batcher
- `security.test.mjs` — written from the attacker's side: forged events into the reducer,
  hostile codes into the parser

`embedded.test.mjs` (v1.27) closed a gap the other three had disclaimed for fifteen
releases. The block has no imports — the SDK is inlined — so once the SDK is removed it
is ordinary script code that can be evaluated in the same jsdom window. **Find the SDK by
LINE LENGTH, not by text**: two comments above the bundle quote `const OBR = Zo;`, so a
substring search deletes a comment and leaves the SDK in place.

jsdom gives each `w.eval` its own scope for lexical declarations, so the block's `const`
and `let` bindings are unreachable from a test. Function declarations and `window.*`
assignments are. Assert through the bridges and through what was BROADCAST — which is
the honest surface anyway, since what the room is told is the thing that matters.

Two rules earned the hard way:

**Build fixtures the way the app builds them** — an origin, archetype and temperament that
exist in `DM_DATA`, then `computeStats()`. A fixture that assigns state directly confirms
whatever the code already does. That is how a forced-talent bug survived a full release.

**Prove a new regression test fails without the fix.** Revert the fix, watch it fail, restore.
A test written after the fix can pass for reasons unrelated to the bug.

Do it against `out/`, not the source — mutate the staged copy, run, restage. And when the
behaviour is about TIMING, space the test out like a hand does. The pool batcher's
headline test drove three presses in one tick, which coalesce under any deferral at all
including `setTimeout(…, 0)` — so it passed with the debounce removed. Only a test with
real gaps between the presses caught it.

What no suite can reach: actual broadcast delivery, the GM's relay, room metadata round
trips, role gates, the modal, and the party panel. Use Playwright against either
standalone page for layout and cascade — **jsdom does no cascade and will report borders
and computed styles that do not exist** — and list the rest as live checks in the release
notes rather than implying coverage that does not exist.
