# How the two halves work

Read this before changing how the creator and the extension talk. Each section records the
design and the failure it avoids, because most of these look over-engineered until you know
what they are for.

## Contents

- [The character code (DM1)](#the-character-code-dm1)
- [Token metadata](#token-metadata)
- [Becoming live on a token](#becoming-live-on-a-token)
- [The event reducer](#the-event-reducer)
- [Epochs: rests and boundaries](#epochs-rests-and-boundaries)
- [Concealed rolls](#concealed-rolls)
- [Room metadata budget](#room-metadata-budget)
- [Known sharp edges](#known-sharp-edges)

## The character code (DM1)

A `-` joined list of segments, built by `buildCharacterCode()`.

It mixes **two kinds of segment**, and this is the part that bites:

- **Positional and untagged** — indices 1 to 3 are bare lookup codes written straight in:
  the origin (`EVR`), the archetype (`SNT`), the temperament (`CRC`).
- **Tagged** — everything after carries a two-letter tag plus payload: `CP…` (the character
  object), `SN…` (the computed snapshot), `NM…` (name), `GW…` (growth).

Because a bare code can begin with the same two letters as a tag, **find tagged segments by
searching from the end**. Sentinel is `SNT`; a forward search for `SN` finds the archetype at
index 2 instead of the snapshot at the end, and reports the whole code as damaged. `EVR`
collides with `EV` and `CRC` with `CR` in the same way, harmlessly today because nothing reads
those.

Two parsers exist and they are not the same:

- `parseCharacterCode()` in the creator — needs only `CP`
- `parseCode()` in `dnm.js` — needs `CP` **and** `SN`, and is what the party panel and the
  roller's selection banner use

This is why a broken code can import into the creator perfectly and still be invisible to the
extension.

Only `CP` is ever rewritten. Every other segment is preserved byte for byte, which is what
makes the round trip lossless: the extension never has to understand a segment to keep it.

The `CP` payload is untrusted — pasted from chat, or read off a token any player can edit.
`stripUnsafeKeys()` drops `__proto__`, `constructor` and `prototype` before it reaches
`Object.assign`.

## Token metadata

A token holds `metadata[CHAR_KEY] = { v: 1, code }` and nothing else. Everything on the sheet
derives from that code, and every edit rewrites it, so the code copied at end of session is
current. Writes are debounced.

The extension deliberately does **not** interpret character data beyond the read the party
panel needs. Keeping the format in one repo is why a character-format change is not also an
extension change.

## Becoming live on a token

`ready` is the single flag that makes a sheet live. Until it is true, `queueSave()` returns at
its guard, so every `renderAll()` saves nothing and `CHAR_KEY` is never written — the
character looks completely normal and the token stays empty.

Every way a character can arrive must call `adoptOntoToken()`:

- opening a token that already holds a code
- pasting a code
- finalizing a newly built character
- loading a locally saved character

Three separate releases each hooked one more of these and left the next to be found in play.
A fifth entry point needs a call, not a fourth copy of the same lines.

`adoptOntoToken()` rebinds the Momentum accessor every time, because the import and local-load
paths **assign a fresh character object**, which drops the accessor and silently returns that
character to a private Momentum counter.

## The event reducer

Rolls, actions and pool changes travel as **broadcasts**, not direct metadata writes:

1. Broadcast is not role-restricted, so a player can announce a roll where a metadata write
   would be refused.
2. It makes the GM the only writer. Read-modify-write from every client meant two simultaneous
   rolls could clobber each other.

Every client applies events locally for an instant view; the GM's background page applies the
same events to room metadata so history survives refreshes and late joins. Both sides run
`applyEvent()`, so they converge.

Roll and action entries carry an id and are **deduplicated**, so applying one twice is safe.
Pool events are **deltas** and cannot be, which is why clients do not apply them optimistically
and instead wait for the GM's update. This is the source of the small delay on a pool change.

`sanitizeEntry()` clamps every field inside the reducer rather than at each sender, because a
sender's clamp runs in a tab the sender controls. It bounds the dice array in particular: the
renderer builds one DOM node per die, so an unbounded array freezes every client.

## Epochs: rests and boundaries

The GM pushes a rest or a scene boundary by incrementing a counter in room metadata. Each
character records the epoch it last applied and catches up when its sheet next opens.

Lazy on purpose — at any moment nearly every sheet is closed, and a broadcast would only reach
whoever happened to be looking. Three alternatives were rejected: broadcasting the reset
(misses closed sheets), having the extension decode and rewrite every token (drags the DM1
format into the extension), and assignment instead of increment (two GM windows clobber each
other).

Rules:

- **Applies once, not N times.** Three missed Bed presses produce one Bed rest.
- **Highest wins.** New Adventure subsumes New Session subsumes End Scene; Bed subsumes Break
  subsumes Breather.
- **Boundary before rest**, so a rest's refresh is not undone by a boundary applied after it.
- **First contact syncs silently.** A character with no `appliedEpochs` adopts the room's
  position without applying anything — otherwise every new character arrives and immediately
  takes a rest it was never present for.

`readEpochs()` defaults missing keys to zero. Rooms written before epochs existed are still
live and have no `epochs` key at all; a missing key read as `undefined` makes every comparison
fail silently.

`catchUpToRoomEpochs()` refuses to act on an unfinalized character, and `writeAppliedEpochs()`
sits behind the same early return — so a boundary arriving mid-edit is left **pending**, not
lost. Reconciliation therefore runs on every finalize, not only the first.

The party panel reports three states, and the distinction matters: **null `appliedEpochs` is
"never met this room"**, not "behind by everything". Reading it as zeros sends the GM chasing a
player with nothing to catch up on.

## Concealed rolls

Three modes:

- **Open** — the full entry is broadcast.
- **Hidden** — the result stays in the roller's browser; a placeholder action entry tells the
  table that someone rolled, and who. Available to everyone.
- **Secret** — nothing is broadcast at all, so no one can tell a roll happened. GM only,
  deliberately: a player rolling with no trace is what a shared log exists to prevent.

`concealedPlaceholder()` builds the placeholder by **allow-list**, never by deleting fields
from the roll. Spreading the entry and stripping `detail`, `succ` and the rest would leak the
day someone adds a field, and the leak would be silent.

The roller's private copy lives in `localStorage` — this browser only, never reaching another
player, and not spending the room's shared budget. It used to be a plain array, so closing the
popover discarded it, which read as concealed rolls working only sometimes.

## Room metadata budget

Owlbear allows **16 kB of room metadata total across every extension in the room** — not per
extension. `MAX_STATE_BYTES` is 11000 to leave headroom.

`trimState()` drops log entries until the state fits but stops at one entry, so a single
oversized entry could still exceed the budget and break metadata for unrelated extensions.
That is why entry fields are clamped in the reducer.

Epochs are rebuilt before trimming and must survive it. Losing one sends every sheet backwards
and re-applies a boundary the table already had.

## Known sharp edges

- **`OBR.broadcast` reaches everyone.** Treat anything sent as public.
- **`event.connectionId`** identifies a broadcast's sender. `OBR.party.getPlayers()` lists
  everyone *else*; the GM's own connection comes from `OBR.player.getConnectionId()`.
- **The background page is cached per room session.** Changes to it need a full room reload,
  not a tab refresh.
- **The popover has no resizable edge.** `OBR.action.setHeight()` is the only lever; the drag
  strip at the foot of the page stands in for a bottom edge.
- **`"__proto__" in obj` is true for every object.** Use `hasOwnProperty` — an `in` check here
  asserts nothing and passes vacuously.
- **ES module imports cannot carry an integrity hash**, which is why the SDK is vendored in
  both repos rather than fetched from a CDN.
