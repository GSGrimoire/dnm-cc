# Dreams & Machines VTT — backlog

Things worth building, things deliberately parked, and the reasoning for both.

This exists because there was nowhere to put an idea. `UPGRADE_NOTES.md` is a
cumulative log of what shipped — 2,400 lines, newest first, with a "Still not done"
section per release that nobody reads back through. Asana is the QA log. Neither is a
list of what to do next.

**Rules for this file.** Newest thinking at the top of each entry. Record the reasoning,
not just the idea, and especially record what was measured and rejected — a rejected
option with a number beside it saves the next session from re-deriving it. When an entry
ships, delete it and let `UPGRADE_NOTES.md` carry the record.

---

## Open — what Chapter 5 left for later

1.6 shipped the chapter's rules and its ten stat blocks (as a private import file).

- **More creatures.** Chapter 5 has one Waker and no machines or people beyond the
  Thrall. If another book or the Quickstart has stat blocks, they go in the same private
  file, never the repo.
- **Quote Revive and Rouse.** 2.5 built them from the GM's NotebookLM summary of the
  Players Guide. When the Players Guide is to hand, check the numbers against the page
  and note the page on the action cards.
- **Allies under a player's control** (p.126: "Players can often take direct control of
  NPCs"). Today only the GM rolls for an NPC token. Letting a player do it means the
  player's client reading a stat block, which lives only in the GM's browser.
- **Lurk hides the token** (p.131: "remove their token from its current zone"). The
  button spends the Threat; hiding the token is still the GM's click in Owlbear.

---

## Open — a reason on every pool change

1.5 solved this for the GM: every press in GM Tools carries its reason, and spends keep
it in the GM's private log. What remains is the roller's and the sheet's plain +/−,
which still log "Manual adjustment".

`stepPool()` passes the player's NAME as the batching label, and the log entry it writes
hardcodes `label: "Manual adjustment"`. So every Threat and Momentum move in the log reads
**"Manual adjustment — added 3 Threat"**, with no record of what it bought. Threat is the
game's main currency of consequence and a session log cannot tell you what any of it was
for.

Small, because the machinery is already there: the label is the coalescing key that keeps
an ability's spend from merging into a manual one. A reason chip row beside the +/− that
becomes the batch label is mostly threading a string. It would also make the Maverick
drive's line say what the Threat was spent on.

Keep the batching rule in mind: **a parked Momentum label is never batched**, and manual +
and − must keep sharing one key or a press up and a press down cannot cancel.

---

## Open — the GM calls for a test

The GM says "Might + Fight, Difficulty 2" and four people set two dropdowns and a number
by hand. A GM "call for a test" broadcast that pre-fills everyone's roller would delete a
round of table talk per test.

The reducer already handles arbitrary event types, so this is a new event plus UI rather
than new architecture. Unknown whether the calling-out is real friction or just how the
table talks — worth watching a session before building.

---

## Open — the drag-ghost

Unchanged since 2.1 and still gated on three checks that need a real room. A popover
cannot be moved (`anchorPosition` is read once at open and there is no `setPosition`
anywhere in SDK 3.1.0), so moving costs a close and reopen, which reloads the sheet.

The route that might work: inflate the panel to the full viewport with `setWidth` and
`setHeight`, which is reload-free, draw the ghost inside it, and reopen at the target on
release.

**The three checks, all needing a live room:**

1. Is a popover with `hidePaper` genuinely transparent, so the map shows through?
2. Is inflating to the full viewport reload-free *at that size*?
3. Does the pointer keep reporting for the whole gesture, once it leaves the handle?

Any one of them failing kills the approach. Do not start building before they are answered.

**Do not revisit** the full-screen transparent modal with a floating sheet inside it.
`disablePointerEvents` makes the frame transparent to hit-testing *entirely*, and content
in a different document cannot re-enable itself from the inside. The result is a
draggable sheet over a dead map, or a live map under a dead sheet.

---

## Open — tooltip bodies are the remaining render cost

With the catalogue lazy-rendered in 2.3, tooltip bodies are roughly 48% of what is left
of the sheet's markup. Every item tag carries a hidden tooltip body as a child.

Only worth doing if the sheet feels slow again. For scale: the catalogue fix took
`renderAll()` from 52.1ms to 11.4ms and node count from 5,191 to 485, so the pressure is
off. If it does come back, the shape is the same — build the body on hover rather than on
render.

Note for whoever does it: `layout.test.mjs` measures item tags with per-tag rectangles
rather than `scrollWidth`, *because* of these hidden bodies. Changing how they are built
means checking that assertion still measures what it thinks it does.

---

## Open — dead code

Found in the 2.0 sweep, still present, harmless, worth deleting during some other change
rather than as its own release:

| where | what |
|---|---|
| `dnm-cc/index.html` | `compactInjuryList`, `renderKnowledgeFragmentsCounter`, `snapshotEffects`, `snapshotItemTags`, `updateDiceLabels` |
| `dnm-obr/dnm.js` | `rebuildCode` (exported, documented in the architecture reference, called by nothing but tests), `bondNamesMatch` (tests only) |

Also a naming split worth settling when one of them is touched: the creator calls it
`bondNamesEqual`, the extension `bondNamesMatch`.

---

## Parked — a server for real durability

2.3 put recovery and backups under the "a token got deleted" accident. Neither covers the
GM changing computers, or Owlbear going away.

The only thing that would is a small server keyed on Owlbear room id plus player id — no
login, no account, nothing for a player to do. A free Cloudflare Worker with KV covers a
table of six by several orders of magnitude.

**Parked on purpose.** It would be the first infrastructure this project owns: a URL to
keep alive, and characters sitting on someone else's disk. The accident was worth fixing
first. Revisit if a character is lost in a way recovery and backups did not catch.
