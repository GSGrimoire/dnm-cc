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

## Open — a Foundry build, and the shared core under it

**There is already a Dreams and Machines system for Foundry, and it is not ours to
take.** Checked 2026-09-22. Two repos, one lineage:

- `Mezryss/FVTT-Dreams-And-Machines` — the original. Latest release v1.1.2, manifest
  version 1.2.0, and `compatibility` is `{minimum: 11, verified: 11, maximum: 11}`. A
  hard cap at 11 means it will not install on a current Foundry without the user
  overriding the check. No compendium packs at all.
- `Muttley/foundryvtt-dreams-and-machines` — a fork, and the live one. Its `develop`
  branch carries a v13 rewrite: `{minimum: 13, verified: 13}`, version reset to 1.0.0,
  a gulp/rollup/sass build, jest, and five compendium packs — `character_options`,
  `equipment`, `glifs_and_patterns`, `system_documentation`, `vehicles`. Last commit
  2025-08-29. **No releases published**, and its manifest still points update checks at
  the old repo, so nobody is installing the v13 work.

So the state is: a good v13 rewrite with content, roughly a year cold and unreleased,
while the package listing still serves a v11-capped version.

**The licence, and why it constrains us.** The Foundry system is CC-BY-SA-4.0 and says
it was "produced with the explicit consent of Modiphius Entertainment". Two things
follow, and both were nearly got wrong:

- That consent was granted to that project. It does not transfer to us by being nearby.
- CC-BY-SA is a share-alike. Taking their code into a shared core would carry that
  licence into whatever the core touches, which is both live repos. Neither `dnm-cc`
  nor `dnm-obr` has a LICENSE file today, so this would be the decision that sets one.

Separately, Modiphius run **2d20 World Builders** through DriveThruRPG for published
content — Community Content Agreement, 50/30/20 split. That is the route for selling
supplements, not for a VTT system, and it is not what governs the Foundry package.

**Three routes, and what each costs.**

1. *Contribute to Muttley's fork.* Cheapest by a long way, and it already has the
   equipment pack we would otherwise rebuild. Our contributions become CC-BY-SA. We do
   not control releases.
2. *Our own system, from our own `DM_DATA`.* No licence entanglement with them, and it
   keeps the core clean. But it duplicates a real community effort, and the Modiphius
   consent question is ours to open rather than inherit.
3. *An importer module only.* Reads DM1/DM2 codes into an Actor in whichever system is
   installed. Small, useful whatever else happens, and it does not commit us.

Not decided. Route 1 is the one to price first, and the question that decides it is
whether we are willing to publish under CC-BY-SA.

**What is unblocked regardless, and has started: `dnm-core`.** Whatever the Foundry
answer, the same code should not be written twice. `DM_DATA` (1,040 lines, 190 KB) and
`computeStats()` are the part a Foundry build actually wants, and they currently live
in the middle of a 700 KB HTML file. The four constants, `createPoolBatcher()` and the
codec were already duplicated by hand across the two repos.

The codec's two copies each carried the word GENERATED and **nothing generated them**.
They matched because `codec.test.mjs` compared them character for character and someone
fixed it by hand each time. Same for the dock helpers. `dnm-core` makes the generator
those comments already described real, with `npm run check` failing on drift.

Measured while doing it: the two codec copies differed only in a four-line header
comment and four `export` keywords, over 12,453 and 12,314 characters. The hand
discipline had held — which is the argument for mechanising it while it still holds,
not after it fails.

---

## Open — the NPC roster and a bestiary

**The problem, measured.** There is no adversary concept anywhere in either repo —
`grep -i "adversary\|npc"` returns nothing. `applyChar()` in `roller.js` fills the
roller's attribute and skill values only from a token carrying a *player* character.
Select an adversary token and you get nothing, so the GM sets attribute, value, skill and
value by hand on every single NPC roll. In a fight with three adversaries acting a few
times each, this is the most repeated manual action at the table.

**The question that has no answer yet: where does a bestiary live?** This is the part
that stalled the idea, and it is worth being precise about why, because the same wall
was hit with character storage in 2.3.

- **GitHub Pages cannot host writable data.** It is a static file host. This was settled
  in 2.3 and applies here too: writing means a commit, which means a repo-write token per
  GM. Not low effort, not safe. A *read-only* bestiary shipped as a file in `dnm-obr` is
  possible — see below.
- **Room metadata is too small.** 16 kB shared across every extension in the room, and
  the roll log already reserves 11,000 of it. Fine for the handful of adversaries in the
  current scene; nowhere near enough for a library.
- **The GM's `localStorage`** holds a library comfortably, but it does not follow the GM
  to another computer and clearing site data clears it. Same trade-off the character
  recovery buffer accepts, and probably acceptable for the same reason — but a bestiary
  is authored work, not a safety net, so losing it hurts more.

**Three shapes, roughly in order of effort.**

1. **A roster in the GM's browser.** Add an adversary once (name, four attributes, seven
   skills), pick it from a dropdown above the roller, values fill the way a selected
   character's do. No new infrastructure. Loses on a browser change — so pair it with the
   same export/import the 2.3 backup uses, which is nearly free once the pattern exists.
2. **Adversaries attached to tokens, like characters.** Reuses the whole existing attach
   flow, the selection banner, and the party panel. Much more useful in play, because the
   GM selects the token and rolls, exactly as a player does. Needs a code format for an
   adversary — probably a cut-down DM2 payload rather than a second format.
3. **A read-only bestiary shipped in the repo.** A JSON file in `dnm-obr` holding the
   published adversaries, versioned with the extension and fetched from the same origin.
   That solves hosting for *published* content and leaves the GM's own creations to 1 or
   2. Precedent: the creator already ships the whole equipment catalogue this way.

**Open questions before any of this is worth starting.**

- Does the GM want a library at all, or just the four adversaries in tonight's fight?
  If it is the latter, 1 is overbuilt and ad-hoc rows in the initiative tracker plus a
  stat field may be the whole feature.
- Do adversaries need to be attached to tokens, or is picking a name enough? Attaching is
  most of the extra work in 2.
- Is there a licensing question about shipping published adversary statistics in a public
  repo? Worth answering before 3, not after.

**Related, already built:** ad-hoc NPC rows in the initiative tracker (2.4). Those are
deliberately the seam this plugs into — an adversary from a roster is just a tracker row
that also carries stats.

---

## Open — a reason on every pool change

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
