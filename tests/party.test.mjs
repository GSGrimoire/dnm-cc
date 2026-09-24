// Party-status tests. These exercise the real exported helpers from dnm.js — no
// reimplementation, no hand-built status objects.
import { epochStatus, readAppliedEpochs, readEpochs, EPOCH_KEYS, emptyEpochs, EPOCH_LABELS, isGmOnlyEvent, readCompAt, classifyDie, applyEvent, EMPTY_STATE,
  COMP_AT_MIN, COMP_AT_MAX, readBondQueue, pruneBondQueue, bondNamesMatch,
  MAX_BOND_EFFECTS, BOND_EFFECT_TTL_MS, trimState, MAX_LOG_ENTRIES,
  createPoolBatcher, sanitizeBondEffect, DRIVE_THREAT_SPEND_MIN, FIELD_LIMITS,
  CHAR_KEY, characterTokens, noteVanished, trimRecovery, readRecovery, writeRecovery,
  visibleRecovery, recoveryKeyFor, MAX_RECOVERY_ENTRIES, RECOVERY_TTL_MS,
  readInitiative, applyInitiativeAction, emptyInitiative, initiativeAllActed,
  INITIATIVE_ACTIONS, MAX_INITIATIVE_ROWS, INITIATIVE_NAME_MAX,
  mayMarkRow, initRowLabel, initRowIdForCharacter } from "../out/dnm-obr/dnm.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  FAIL:", name); } };

// A character built the way the creator builds one: appliedEpochs is written by
// writeAppliedEpochs(), which coerces all six keys. Never hand-assign a partial.
const charWith = (epochs) => ({ appliedEpochs: EPOCH_KEYS.reduce((a,k)=>{a[k]=epochs[k]||0;return a;},{}) });
const room = (epochs) => ({ ...emptyEpochs(), ...epochs });

// --- the three states ---
ok("no appliedEpochs at all reads as unsynced",
  epochStatus({}, room({ bed: 3 })).state === "unsynced");
ok("appliedEpochs null reads as unsynced",
  epochStatus({ appliedEpochs: null }, room({ bed: 3 })).state === "unsynced");
ok("unsynced never reports pending boundaries",
  epochStatus({}, room({ bed: 3, scene: 9 })).pending.length === 0);

ok("all-zero applied against all-zero room is current",
  epochStatus(charWith({}), room({})).state === "current");
ok("level with a room that has moved is current",
  epochStatus(charWith({ bed: 2, scene: 5 }), room({ bed: 2, scene: 5 })).state === "current");

ok("one boundary behind reads as behind",
  epochStatus(charWith({ bed: 1 }), room({ bed: 2 })).state === "behind");

// This is the case the third state exists for. All-zeros and null must NOT agree.
ok("all-zeros is behind where null is unsynced",
  epochStatus(charWith({}), room({ bed: 3 })).state === "behind" &&
  epochStatus({}, room({ bed: 3 })).state === "unsynced");

// --- pending list ---
{
  const s = epochStatus(charWith({ bed: 1, scene: 1 }), room({ bed: 2, scene: 3, breather: 0 }));
  ok("pending lists exactly the boundaries the room is ahead on",
    s.pending.length === 2 && s.pending.includes("bed") && s.pending.includes("scene"));
  ok("every pending key has a display label",
    s.pending.every(k => typeof EPOCH_LABELS[k] === "string" && EPOCH_LABELS[k].length));
}

// --- legacy and defensive ---
ok("a room with no epochs key at all is current, not behind",
  epochStatus(charWith({ bed: 4 }), undefined).state === "current");
ok("applied ahead of the room is current, not an error",
  epochStatus(charWith({ bed: 9 }), room({ bed: 2 })).state === "current");
ok("a partial appliedEpochs object is filled, not left undefined",
  Object.keys(readAppliedEpochs({ appliedEpochs: { bed: 1 } })).length === EPOCH_KEYS.length);
ok("partial applied is still behind on the keys it lacks",
  epochStatus({ appliedEpochs: { bed: 1 } }, room({ scene: 1 })).pending.includes("scene"));
ok("junk values coerce to zero rather than NaN",
  readAppliedEpochs({ appliedEpochs: { bed: "x", scene: -4 } }).bed === 0 &&
  readAppliedEpochs({ appliedEpochs: { bed: "x", scene: -4 } }).scene === 0);


// -------------------------------------------------------------
// Who needs to be the GM (0.9.2)
// -------------------------------------------------------------
// 0.9.1 made every Threat change GM-only, which broke the way players legitimately
// pay Threat: Nanobarrier, Adrenaline Rush and several item actions all add it.
// The privileged thing is the direction, not the pool.
ok("a rest boundary is GM-only", isGmOnlyEvent({ type: "epoch", boundary: "bed" }) === true);
ok("clearing the log is GM-only", isGmOnlyEvent({ type: "clear" }) === true);

ok("ADDING Threat is open — this is how abilities charge it",
  isGmOnlyEvent({ type: "pool", pool: "threat", delta: 1 }) === false);
ok("a multi-point Threat cost is open too",
  isGmOnlyEvent({ type: "pool", pool: "threat", delta: 3 }) === false);
ok("REMOVING Threat is GM-only — spending is the GM's",
  isGmOnlyEvent({ type: "pool", pool: "threat", delta: -1 }) === true);

ok("Momentum is open in both directions",
  isGmOnlyEvent({ type: "pool", pool: "momentum", delta: -3 }) === false &&
  isGmOnlyEvent({ type: "pool", pool: "momentum", delta: 3 }) === false);

ok("a roll is never privileged", isGmOnlyEvent({ type: "roll", entry: {} }) === false);
ok("junk is not privileged", isGmOnlyEvent(null) === false && isGmOnlyEvent("x") === false);
// A zero delta moves nothing; treating it as a spend would refuse a harmless no-op.
ok("a zero Threat delta is not a spend",
  isGmOnlyEvent({ type: "pool", pool: "threat", delta: 0 }) === false);


// -------------------------------------------------------------
// The GM's Complication threshold (0.9.5)
// -------------------------------------------------------------
{
  const fresh = () => structuredClone(EMPTY_STATE);

  ok("a room with no compAt reads as 20", readCompAt({}) === COMP_AT_MAX);
  ok("a pre-0.9.5 room reads as 20", readCompAt({ momentum: 2 }) === COMP_AT_MAX);
  ok("a set value is honoured", readCompAt({ compAt: 17 }) === 17);
  // Clamped rather than trusted: this arrives over the same open broadcast channel
  // as everything else, and a threshold of 2 would make every die a Complication.
  ok("below the floor is clamped", readCompAt({ compAt: 3 }) === COMP_AT_MIN);
  ok("above 20 is clamped", readCompAt({ compAt: 99 }) === COMP_AT_MAX);
  ok("nonsense reads as 20", readCompAt({ compAt: "banana" }) === COMP_AT_MAX);
  // Number(null) is 0, which is finite. Coercing before checking for absence made an
  // unset threshold clamp to the FLOOR, so every 15+ complicated in a room that had
  // never set one. Caught in testing before it shipped; pinned here.
  ok("null reads as 20, not the floor", readCompAt({ compAt: null }) === COMP_AT_MAX);
  ok("an empty string reads as 20", readCompAt({ compAt: "" }) === COMP_AT_MAX);

  // The rulebook default is unchanged for every existing caller.
  ok("20 still complicates by default", classifyDie(20, 9, 2) === "complication");
  ok("19 is an ordinary miss by default", classifyDie(19, 9, 2) === "fail");

  ok("a lowered threshold complicates at and above it",
    classifyDie(17, 9, 2, 17) === "complication" && classifyDie(18, 9, 2, 17) === "complication");
  ok("below the threshold is unaffected", classifyDie(16, 9, 2, 17) === "fail");
  // Order matters: a Complication is never also a success, even where a low threshold
  // overlaps the Attribute.
  ok("a Complication outranks a success on the same die",
    classifyDie(9, 9, 2, 9) === "complication");
  ok("a Complication outranks a critical on the same die",
    classifyDie(2, 9, 2, 2) === "complication");

  // Only the GM may move it, and it must survive a trim like epochs do.
  ok("setting the threshold is GM-only", isGmOnlyEvent({ type: "compAt", value: 17 }) === true);
  ok("the reducer stores it", applyEvent(fresh(), { type: "compAt", value: 16 }).compAt === 16);
  ok("the reducer clamps it", applyEvent(fresh(), { type: "compAt", value: 1 }).compAt === COMP_AT_MIN);
}

// -------------------------------------------------------------
// Claiming a roll's surplus Momentum (0.9.5)
// -------------------------------------------------------------
{
  const fresh = () => structuredClone(EMPTY_STATE);
  const rolled = applyEvent(fresh(), {
    type: "roll",
    entry: { id: "r9", who: "Kell", detail: [], gain: 3, by: "p-1" },
  });
  ok("a roll records who made it and what it earned",
    rolled.log[0].by === "p-1" && rolled.log[0].gain === 3);
  ok("a fresh roll is unclaimed", rolled.log[0].claimed === false);

  const claimed = applyEvent(rolled, { type: "claim", id: "r9" });
  ok("claiming marks the entry", claimed.log[0].claimed === true);
  // Idempotent, so a double-click or a re-delivered broadcast cannot double-count.
  ok("claiming twice changes nothing",
    applyEvent(claimed, { type: "claim", id: "r9" }).log[0].claimed === true);
  ok("claiming an unknown id touches no entry",
    applyEvent(rolled, { type: "claim", id: "nope" }).log[0].claimed === false);
  ok("anyone may claim as far as the reducer is concerned — the check is in the UI",
    isGmOnlyEvent({ type: "claim", id: "r9" }) === false);

  // 0.9.8B. `by` is what the roller matches on to decide whose roll it was, so it has
  // to survive the round trip through room metadata like `conceal` does. Losing it
  // would turn every persisted roll into one nobody is recorded as having made — which
  // is the state every sheet roll was in before v1.28B stamped it.
  ok("`by` survives the reducer", rolled.log[0].by === "p-1");
  ok("a roll with no `by` is stored as null rather than undefined",
    applyEvent(fresh(), { type: "roll", entry: { id: "r10", who: "K", detail: [], gain: 2 } }).log[0].by === null);
}

// -------------------------------------------------------------
// The bond queue (0.9.6)
// -------------------------------------------------------------
{
  const fresh = () => structuredClone(EMPTY_STATE);
  const bondEv = (effect) => ({ type: "bond", effect });
  const now = Date.now();

  ok("a room written before 0.9.6 has no bonds key and reads as an empty queue",
    readBondQueue({ momentum: 2 }).length === 0);
  ok("a bonds key that is not an array reads as empty",
    readBondQueue({ bonds: "nope" }).length === 0);

  ok("name matching ignores case and surrounding space",
    bondNamesMatch(" Kestrel ", "kestrel") === true);
  ok("an empty name never matches", bondNamesMatch("", "") === false);

  const one = applyEvent(fresh(), bondEv({ id: "b1", t: now, kind: "rivalry", from: "Kestrel" }));
  ok("a rivalry effect lands in the queue", readBondQueue(one).length === 1);
  ok("and carries who caused it", readBondQueue(one)[0].from === "Kestrel");

  // A broadcast can be delivered twice, and paying the same bond twice is a free
  // Spirit. Same dedupe rule as a roll entry, for the same reason.
  ok("the same effect id is only queued once",
    readBondQueue(applyEvent(one, bondEv({ id: "b1", t: now, kind: "rivalry", from: "Kestrel" }))).length === 1);

  ok("an unknown kind is refused outright",
    readBondQueue(applyEvent(fresh(), bondEv({ id: "b2", t: now, kind: "steal", from: "X" }))).length === 0);
  ok("an effect with no id is refused",
    readBondQueue(applyEvent(fresh(), bondEv({ kind: "rivalry", from: "X" }))).length === 0);

  // Second Wind restores at most 3, and a supportive bond adds at most 1. Four is the
  // ceiling the rules allow, and the reducer is where it counts — a sender's clamp
  // runs in a tab the sender controls.
  const big = applyEvent(fresh(), bondEv({ id: "b3", t: now, kind: "grant", from: "A", target: "B", amount: 9999 }));
  ok("a forged grant is clamped to what the rules can produce",
    readBondQueue(big)[0].amount === 4);
  ok("a negative grant cannot drain the target",
    readBondQueue(applyEvent(fresh(), bondEv({ id: "b4", t: now, kind: "grant", from: "A", target: "B", amount: -50 })))[0].amount === 0);
  ok("names in a forged effect are length-clamped",
    readBondQueue(applyEvent(fresh(), bondEv({ id: "b5", t: now, kind: "grant", from: "x".repeat(500), target: "y".repeat(500), amount: 1 })))[0].target.length === 24);

  // The queue is bounded so a session cannot fill the room's shared 16 kB with it.
  let many = fresh();
  for (let i = 0; i < MAX_BOND_EFFECTS + 8; i++) {
    many = applyEvent(many, bondEv({ id: `m${i}`, t: now, kind: "rivalry", from: "Kestrel" }));
  }
  const queue = readBondQueue(many);
  ok("the queue is capped", queue.length === MAX_BOND_EFFECTS);
  ok("and the cap drops the OLDEST, so the newest effect is still owed",
    queue[queue.length - 1].id === `m${MAX_BOND_EFFECTS + 7}`);

  // A player who has not opened their sheet in six hours is at a different session.
  const stale = { ...fresh(), bonds: [{ id: "old", t: now - BOND_EFFECT_TTL_MS - 1000, kind: "rivalry", from: "Kestrel" }] };
  ok("an effect older than the TTL is dropped rather than kept waiting",
    pruneBondQueue(readBondQueue(stale)).length === 0);
  ok("an effect inside the TTL survives",
    pruneBondQueue(readBondQueue({ ...fresh(), bonds: [{ id: "new", t: now, kind: "rivalry", from: "K" }] })).length === 1);

  // An undrained effect still owes somebody a Spirit; an old log line owes nobody
  // anything. So the log gives way first when the state has to be trimmed.
  {
    let full = { ...fresh(), bonds: [{ id: "keep", t: now, kind: "grant", from: "A", target: "B", amount: 3, source: "Second Wind" }] };
    for (let i = 0; i < MAX_LOG_ENTRIES; i++) {
      full = applyEvent(full, { type: "roll", entry: { id: `r${i}`, t: now, who: "W".repeat(24), label: "L".repeat(48), detail: Array.from({ length: 20 }, () => ({ d: 20, kind: "crit" })) } });
    }
    const trimmed = trimState(full);
    ok("trimming drops log lines to fit", trimmed.log.length < MAX_LOG_ENTRIES);
    ok("but the pending bond effect survives the trim",
      readBondQueue(trimmed).length === 1 && readBondQueue(trimmed)[0].id === "keep");
  }

  // The two BONDS are not privileged, and deliberately so: a forged effect can only
  // land on a sheet that already holds the matching bond, for one Spirit. Making them
  // GM-only would break every bond at a table whose GM has the extension closed.
  ok("a rivalry effect is not GM-only",
    isGmOnlyEvent({ type: "bond", effect: { id: "b6", kind: "rivalry", from: "K" } }) === false);
  ok("a grant is not GM-only",
    isGmOnlyEvent({ type: "bond", effect: { id: "b7", kind: "grant", from: "K", target: "A", amount: 2 } }) === false);

  // The DRIVE is, because its own text says "when THE GM spends". Unlike a bond, a
  // forged copy would reach every Maverick at the table on nobody's authority.
  ok("a drive effect IS GM-only",
    isGmOnlyEvent({ type: "bond", effect: { id: "b8", kind: "drive", drive: "maverick", amount: 3 } }) === true);
  ok("and a bond event with no effect is not privileged by accident",
    isGmOnlyEvent({ type: "bond" }) === false);
}

// -------------------------------------------------------------
// The Maverick drive (0.9.8)
// -------------------------------------------------------------
{
  const fresh = () => structuredClone(EMPTY_STATE);
  const now = Date.now();
  const drive = (extra) => sanitizeBondEffect({ id: "d1", t: now, kind: "drive", drive: "maverick", from: "GM", amount: 3, ...extra });

  ok("the threshold is the one in the drive's own text", DRIVE_THREAT_SPEND_MIN === 3);

  const d = drive();
  ok("a drive effect survives the reducer", !!d && d.kind === "drive");
  ok("carrying which drive it is", d.drive === "maverick");
  ok("and the size of the spend, for the recipient's log", d.amount === 3);

  // Like a rivalry, a drive names nobody: every sheet decides for itself, here by
  // reading its own temperament. A forged target must not survive to imply otherwise.
  ok("a forged target does not survive on a drive", drive({ target: "Someone" }).target === undefined);
  ok("the amount is clamped like any other untrusted number", drive({ amount: 1e9 }).amount === 999);
  ok("a negative amount cannot survive", drive({ amount: -5 }).amount === 0);
  ok("the drive key is length-clamped", drive({ drive: "x".repeat(500) }).drive.length === FIELD_LIMITS.id);

  const queued = applyEvent(fresh(), { type: "bond", effect: { id: "d2", t: now, kind: "drive", drive: "maverick", from: "GM", amount: 4 } });
  ok("it queues like any other effect", readBondQueue(queued).length === 1);
  ok("waiting for sheets that are shut, which is the whole point",
    readBondQueue(queued)[0].kind === "drive");
}

// -------------------------------------------------------------
// Coalescing pool nudges (0.9.7)
// -------------------------------------------------------------
// Short delays so the suite stays fast. The real values are 900/2500/5000 and the
// behaviour under test is the arithmetic and the flush rules, not the constants.
{
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const make = (opts) => {
    const sent = [];
    const b = createPoolBatcher((batch) => sent.push(batch), { delay: 20, maxWait: 120, settleAfter: 200, ...opts });
    return { b, sent };
  };

  // The report from play: +1 three times sent three events and wrote three log lines.
  {
    const { b, sent } = make();
    b.add("threat", 1, "manual"); b.add("threat", 1, "manual"); b.add("threat", 1, "manual");
    ok("a run of presses sends nothing until it stops", sent.length === 0);
    ok("and the display can see the total meanwhile", b.peek("threat") === 3);
    await wait(60);
    ok("a run of three presses is one event", sent.length === 1);
    ok("carrying the total", sent[0].delta === 3 && sent[0].pool === "threat");
  }

  // The same thing SPACED OUT, which is how a person actually clicks. Three adds in
  // one tick coalesce under any deferral at all, including setTimeout(…, 0) — so the
  // test above passes even with the debounce removed. This is the one that fails.
  {
    const { b, sent } = make({ delay: 50, maxWait: 1000 });
    for (let i = 0; i < 3; i++) { b.add("threat", 1, "manual"); await wait(15); }
    ok("presses spaced out like a real hand are still one run", sent.length === 0);
    await wait(90);
    ok("and land as a single event of 3", sent.length === 1 && sent[0].delta === 3);
  }

  // And a genuinely separate decision, after the run has closed, is a separate entry.
  // Coalescing must not swallow the second thought.
  {
    const { b, sent } = make({ delay: 20, maxWait: 1000 });
    b.add("threat", 1, "manual");
    await wait(70);
    b.add("threat", 1, "manual");
    await wait(70);
    ok("two presses far apart stay two events", sent.length === 2);
  }

  // This is what makes the Maverick drive readable: "spends 3 or more Threat AT ONCE"
  // was undetectable when three presses arrived as three events of 1.
  {
    const { b, sent } = make();
    for (let i = 0; i < 3; i++) b.add("threat", -1, "manual");
    await wait(60);
    ok("a spend of three arrives as one event of -3", sent.length === 1 && sent[0].delta === -3);
    ok("and is still GM-only, because that is read off the total",
      isGmOnlyEvent({ type: "pool", pool: "threat", delta: sent[0].delta }) === true);
  }

  // Previously two events and two log lines for a change nobody made.
  {
    const { b, sent } = make();
    b.add("momentum", 1, "manual");
    b.add("momentum", -1, "manual");
    await wait(60);
    ok("a run that cancels itself out sends nothing at all", sent.length === 0);
    ok("and leaves nothing pending afterwards", b.peek("momentum") === 0);
  }

  // The guard that keeps an ability from being folded into a manual nudge.
  {
    const { b, sent } = make();
    b.add("threat", 1, "manual");
    b.add("threat", 6, "Adrenaline Rush");
    ok("a different label flushes the run immediately rather than merging",
      sent.length === 1 && sent[0].delta === 1 && sent[0].label === "manual");
    await wait(60);
    ok("and the new label goes out on its own",
      sent.length === 2 && sent[1].delta === 6 && sent[1].label === "Adrenaline Rush");
  }

  {
    const { b, sent } = make();
    b.add("threat", 1, "manual");
    b.add("momentum", 1, "manual");
    ok("a different pool flushes too — the two are never summed together",
      sent.length === 1 && sent[0].pool === "threat");
  }

  // Someone leaning on + must still see the pool move rather than nothing until they
  // let go, so the debounce has a ceiling.
  {
    const { b, sent } = make({ delay: 40, maxWait: 90 });
    const t0 = Date.now();
    const id = setInterval(() => b.add("momentum", 1, "manual"), 10);
    await wait(140);
    clearInterval(id);
    ok("holding a button still lands within the ceiling", sent.length >= 1);
    ok("and the first send happened before the presses stopped", Date.now() - t0 >= 90);
  }

  // peek() is what stops the number freezing for the length of the window. It has to
  // keep reporting ACROSS the flush, or the display drops back to the old value for
  // the length of the broadcast round trip — a visible flinch on every press.
  {
    const { b } = make();
    b.add("threat", 2, "manual");
    ok("peek reports what is queued", b.peek("threat") === 2);
    await wait(60);
    ok("and keeps reporting it after the flush, until the room confirms",
      b.peek("threat") === 2);
    b.settle();
    ok("settle clears it", b.peek("threat") === 0);
    ok("peek never reports another pool's total", b.peek("momentum") === 0);
  }

  // If the confirmation never arrives, the display must not be wrong forever.
  {
    const { b } = make({ settleAfter: 40 });
    b.add("momentum", 3, "manual");
    await wait(120);
    ok("an unconfirmed batch gives up on its own rather than sticking", b.peek("momentum") === 0);
  }

  // flush() re-entered from inside its own send finds nothing to do. Both callers rely
  // on this: announce() and sendAction() flush on every outgoing message, and the
  // batcher reaches them through exactly those functions.
  {
    let depth = 0, maxDepth = 0, calls = 0;
    const b = createPoolBatcher(() => {
      calls++;
      depth++; maxDepth = Math.max(maxDepth, depth);
      b.flush();
      depth--;
    }, { delay: 5 });
    b.add("threat", 2, "manual");
    b.flush();
    ok("a re-entrant flush does not send twice or recurse", calls === 1 && maxDepth === 1);
  }
}


// =============================================================
// Character recovery (1.3)
// =============================================================
// The diff is the whole feature. Get it wrong in one direction and a deleted
// character is not captured, which is the failure this exists to prevent; get it
// wrong in the other and every keystroke files a "lost" character, which buries
// the real one. Both are tested, and so is the case that produced the design —
// a scene switch, which empties the item list and must not read as a massacre.
{
  const token = (id, code) => ({ id, metadata: { [CHAR_KEY]: { v: 1, code } } });
  const plain = (id) => ({ id, metadata: {} });
  const NOW = 1_700_000_000_000;

  // --- characterTokens ---
  ok("characterTokens finds tokens carrying a character",
    JSON.stringify(characterTokens([token("a", "DM2-x"), plain("b")])) === JSON.stringify([{ id: "a", code: "DM2-x" }]));
  ok("characterTokens ignores an empty code string",
    characterTokens([token("a", "")]).length === 0);
  ok("characterTokens survives junk", characterTokens([null, {}, { metadata: null }, undefined]).length === 0);
  ok("characterTokens survives no items at all", characterTokens(undefined).length === 0);

  // --- the loss this exists for ---
  {
    const before = characterTokens([token("a", "DM2-kesh"), token("b", "DM2-vera")]);
    const after = characterTokens([token("b", "DM2-vera")]);
    const list = noteVanished([], before, after, NOW);
    ok("a deleted token's character is captured", list.length === 1 && list[0].code === "DM2-kesh");
    ok("the capture records which token it was", list[0].tokenId === "a");
    ok("the capture is stamped", list[0].at === NOW);
    ok("a token that stayed is not captured", !list.some((e) => e.code === "DM2-vera"));
  }

  // --- detaching a character is the same loss, by a different route ---
  {
    const before = characterTokens([token("a", "DM2-kesh")]);
    const after = characterTokens([plain("a")]);
    ok("clearing a token's character is captured too",
      noteVanished([], before, after, NOW).length === 1);
  }

  // --- an ordinary edit must not look like a loss ---
  // Every save rewrites the whole code, so comparing CODES rather than ids would
  // file a lost character on every keystroke. This is the assertion that pins that.
  {
    const before = characterTokens([token("a", "DM2-kesh-v1")]);
    const after = characterTokens([token("a", "DM2-kesh-v2")]);
    ok("editing a character does not file it as lost",
      noteVanished([], before, after, NOW).length === 0);
  }

  // --- a character moved to another token is not a loss either ---
  {
    const before = characterTokens([token("a", "DM2-kesh")]);
    const after = characterTokens([token("b", "DM2-kesh")]);
    ok("a character moved to a different token is not captured",
      noteVanished([], before, after, NOW).length === 0);
  }

  // --- several at once ---
  {
    const before = characterTokens([token("a", "DM2-1"), token("b", "DM2-2"), token("c", "DM2-3")]);
    const after = characterTokens([token("b", "DM2-2")]);
    const list = noteVanished([], before, after, NOW);
    ok("deleting several tokens captures all of them", list.length === 2);
    ok("the newest capture is first", list[0].at === NOW && list.length === 2);
  }

  // --- no duplicate rows for the same character ---
  {
    let list = noteVanished([], characterTokens([token("a", "DM2-kesh")]), [], NOW);
    list = noteVanished(list, characterTokens([token("z", "DM2-kesh")]), [], NOW + 1000);
    ok("losing the same character twice leaves one row", list.length === 1);
    ok("and the row is the newer one", list[0].at === NOW + 1000 && list[0].tokenId === "z");
  }

  // --- bounds ---
  {
    let list = [];
    for (let i = 0; i < MAX_RECOVERY_ENTRIES + 10; i++) {
      list = noteVanished(list, characterTokens([token("t" + i, "DM2-" + i)]), [], NOW + i);
    }
    ok(`the buffer is capped at ${MAX_RECOVERY_ENTRIES}`, list.length === MAX_RECOVERY_ENTRIES);
    ok("and it is the newest that are kept", list[0].code === "DM2-" + (MAX_RECOVERY_ENTRIES + 9));
  }
  {
    const old = [{ code: "DM2-old", tokenId: "a", at: NOW - RECOVERY_TTL_MS - 1 }];
    ok("an entry past its time is dropped", trimRecovery(old, NOW).length === 0);
    ok("an entry inside its time is kept",
      trimRecovery([{ code: "DM2-new", tokenId: "a", at: NOW - 1000 }], NOW).length === 1);
  }

  // --- storage is untrusted on the way out, the same rule the dock follows ---
  {
    const store = (value) => ({ getItem: () => value, setItem() {} });
    ok("unparseable storage reads as empty", readRecovery(store("{{{"), "room").length === 0);
    ok("a stored object rather than a list reads as empty", readRecovery(store('{"a":1}'), "room").length === 0);
    ok("entries without a code are dropped",
      readRecovery(store('[{"tokenId":"a","at":' + NOW + '}]'), "room", NOW).length === 0);
    ok("entries with a junk timestamp are dropped",
      readRecovery(store('[{"code":"DM2-x","at":"soon"}]'), "room", NOW).length === 0);
    ok("no storage at all reads as empty", readRecovery(null, "room").length === 0);
    // A storage that throws on read is what a cookie-blocked frame actually does.
    ok("storage that throws reads as empty",
      readRecovery({ getItem() { throw new Error("blocked"); } }, "room").length === 0);
    // And one that throws on WRITE must not take the caller down with it: this is
    // called from the scene-change handler, so an exception here stops the watcher.
    let threw = false;
    try { writeRecovery({ setItem() { throw new Error("quota"); } }, "room", [{ code: "DM2-x", at: NOW }], NOW); }
    catch (err) { threw = true; }
    ok("storage that throws on write does not throw out", !threw);
  }

  ok("the storage key is per room", recoveryKeyFor("room-a") !== recoveryKeyFor("room-b"));
  ok("a missing room id still produces a key", typeof recoveryKeyFor(undefined) === "string");

  // --- the rule the whole design turns on ---
  // An entry is offered only while NO token holds that character. This is what
  // makes it impossible to put a stale copy over a live one, and it is matched on
  // the NAME because a restored character has a new token id and a new code.
  {
    const names = { "DM2-kesh-old": "Kesh Alvaran", "DM2-kesh-new": "Kesh Alvaran", "DM2-vera": "Vera Sunn" };
    const resolve = (code) => names[code] || "";
    const list = [{ code: "DM2-kesh-old", tokenId: "gone", at: NOW }];

    ok("a lost character is offered while no token holds it",
      visibleRecovery(list, [token("b", "DM2-vera")], resolve).length === 1);
    ok("and is hidden the moment a token holds it again, under a NEW code and id",
      visibleRecovery(list, [token("z", "DM2-kesh-new")], resolve).length === 0);
    ok("matching ignores case and stray spaces",
      visibleRecovery(list, [token("z", "DM2-spaced")], (c) => c === "DM2-spaced" ? "  kesh ALVARAN " : names[c] || "").length === 0);

    // An unnamed character cannot be matched by name, so it falls back to the token
    // id — which all but guarantees it lingers. That is the safe direction: a row
    // the GM dismisses costs nothing, a character silently not offered costs a lot.
    const unnamed = [{ code: "DM2-blank", tokenId: "gone", at: NOW }];
    ok("an unnamed lost character stays on offer",
      visibleRecovery(unnamed, [token("z", "DM2-other")], () => "").length === 1);
    ok("unless that very token comes back",
      visibleRecovery(unnamed, [token("gone", "DM2-other")], () => "").length === 0);
  }

  // --- a real round trip through a real storage object ---
  {
    const backing = new Map();
    const storage = {
      getItem: (k) => (backing.has(k) ? backing.get(k) : null),
      setItem: (k, v) => backing.set(k, v),
    };
    writeRecovery(storage, "room-1", [{ code: "DM2-kesh", tokenId: "a", at: NOW }], NOW);
    ok("a written buffer reads back", readRecovery(storage, "room-1", NOW).length === 1);
    ok("and not from another room", readRecovery(storage, "room-2", NOW).length === 0);
  }
}


// =============================================================
// Initiative (1.4)
// =============================================================
{
  const NOW = 1_700_000_000_000;
  const fresh = () => structuredClone(EMPTY_STATE);
  const run = (state, ...events) => events.reduce((s, ev) => applyEvent(s, ev), state);
  const init = (state) => readInitiative(state);
  const names = (state) => init(state).rows.map((r) => r.name);

  // --- the shape of it ---
  ok("a fresh room has no initiative running", readInitiative(fresh()) === null);
  ok("starting one gives round 1 and no rows",
    JSON.stringify(readInitiative(run(fresh(), { type: "init", action: "start" })))
      === JSON.stringify({ round: 1, rows: [] }));
  ok("ending one removes it entirely",
    readInitiative(run(fresh(), { type: "init", action: "start" }, { type: "init", action: "end" })) === null);

  const started = run(fresh(),
    { type: "init", action: "start" },
    { type: "init", action: "add", id: "a", name: "Kesh", kind: "pc" },
    { type: "init", action: "add", id: "b", name: "Orrin", kind: "pc" },
    { type: "init", action: "add", id: "n1", name: "Reaver", kind: "npc" });

  ok("rows arrive in the order they were added",
    JSON.stringify(names(started)) === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
  ok("a row remembers whether it is a character or an adversary",
    init(started).rows.map((r) => r.kind).join() === "pc,pc,npc");
  ok("nobody has acted yet", init(started).rows.every((r) => !r.acted));

  // --- marking a turn ended ---
  {
    const acted = run(started, { type: "init", action: "act", id: "a", acted: true });
    ok("marking acted marks only that row",
      init(acted).rows.filter((r) => r.acted).map((r) => r.name).join() === "Kesh");
    const back = run(acted, { type: "init", action: "act", id: "a", acted: false });
    ok("and it can be taken back", init(back).rows.every((r) => !r.acted));
    ok("acting on a row that is not there changes nothing",
      JSON.stringify(init(run(started, { type: "init", action: "act", id: "nope", acted: true })))
        === JSON.stringify(init(started)));
  }

  // --- the round ---
  {
    const all = run(started,
      { type: "init", action: "act", id: "a", acted: true },
      { type: "init", action: "act", id: "b", acted: true },
      { type: "init", action: "act", id: "n1", acted: true });
    ok("all acted is detected", initiativeAllActed(init(all)) === true);
    ok("an empty tracker is NOT 'all acted' — nothing to light the button for",
      initiativeAllActed(emptyInitiative()) === false);

    const nextRound = run(all, { type: "init", action: "next" });
    ok("next round advances the number", init(nextRound).round === 2);
    ok("next round clears every acted flag", init(nextRound).rows.every((r) => !r.acted));
    // The whole point of tracking rows rather than a turn pointer: the fight does not
    // change between rounds, only the round does.
    ok("next round keeps the rows and their order",
      JSON.stringify(names(nextRound)) === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
    ok("next round keeps hidden flags and kinds",
      init(nextRound).rows.map((r) => r.kind).join() === "pc,pc,npc");
  }

  // --- reordering ---
  {
    const down = run(started, { type: "init", action: "move", id: "a", delta: 1 });
    ok("moving down swaps with the row below",
      JSON.stringify(names(down)) === JSON.stringify(["Orrin", "Kesh", "Reaver"]));
    const up = run(down, { type: "init", action: "move", id: "a", delta: -1 });
    ok("and moving up puts it back",
      JSON.stringify(names(up)) === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
    // Clamped, not wrapped. Up on the top row must do nothing — sending it to the
    // bottom would be the opposite of what the press asked for.
    ok("up on the top row does nothing",
      JSON.stringify(names(run(started, { type: "init", action: "move", id: "a", delta: -1 })))
        === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
    ok("down on the bottom row does nothing",
      JSON.stringify(names(run(started, { type: "init", action: "move", id: "n1", delta: 1 })))
        === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
    ok("a move of zero does nothing",
      JSON.stringify(names(run(started, { type: "init", action: "move", id: "a", delta: 0 })))
        === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
  }

  // --- hiding, which is the part that has to be actually private ---
  {
    const hidden = run(started, { type: "init", action: "hide", id: "n1", hidden: true });
    const row = init(hidden).rows[2];
    ok("a hidden row is flagged", row.hidden === true);
    // THE ASSERTION THAT MATTERS. Room metadata is readable by every client, so a
    // name that is published is public no matter what the interface draws. Hiding has
    // to DROP the name, not flag it — the same reason concealed rolls are kept in the
    // GM's localStorage rather than in the room.
    ok("a hidden row's name is not in the room state at all", row.name === "");
    ok("the whole serialised state contains no trace of the hidden name",
      !JSON.stringify(hidden).includes("Reaver"));
    ok("a hidden row keeps its position", init(hidden).rows.map((r) => r.id).join() === "a,b,n1");
    ok("a hidden row can still be marked as acted",
      init(run(hidden, { type: "init", action: "act", id: "n1", acted: true })).rows[2].acted === true);
    const shown = run(hidden, { type: "init", action: "hide", id: "n1", hidden: false, name: "Reaver" });
    ok("unhiding restores the name from the event", init(shown).rows[2].name === "Reaver");
  }

  // --- removing ---
  {
    const gone = run(started, { type: "init", action: "remove", id: "b" });
    ok("removing takes the row out", JSON.stringify(names(gone)) === JSON.stringify(["Kesh", "Reaver"]));
    ok("removing something absent changes nothing",
      JSON.stringify(names(run(started, { type: "init", action: "remove", id: "nope" })))
        === JSON.stringify(["Kesh", "Orrin", "Reaver"]));
  }

  // --- End Scene ends the fight; a rest during one must not ---
  {
    const afterScene = run(started, { type: "epoch", boundary: "scene" });
    ok("End Scene ends initiative", readInitiative(afterScene) === null);
    for (const boundary of ["breather", "break", "bed", "session", "adventure"]) {
      const after = run(started, { type: "epoch", boundary });
      // A Breather happens DURING a fight. Clearing the tracker under the table
      // mid-combat would be worse than not having one.
      ok(`a ${boundary} does not end initiative`, readInitiative(after) !== null);
    }
  }

  // --- bounds, because this is rendered in a loop from shared state ---
  {
    let many = run(fresh(), { type: "init", action: "start" });
    for (let i = 0; i < MAX_INITIATIVE_ROWS + 10; i++) {
      many = applyEvent(many, { type: "init", action: "add", id: "r" + i, name: "Row " + i, kind: "npc" });
    }
    ok(`rows are capped at ${MAX_INITIATIVE_ROWS}`, init(many).rows.length === MAX_INITIATIVE_ROWS);

    ok("a duplicate id is refused rather than doubling a row",
      init(run(started, { type: "init", action: "add", id: "a", name: "Impostor", kind: "pc" })).rows.length === 3);
    ok("a row with no id is refused",
      init(run(started, { type: "init", action: "add", id: "", name: "Nameless", kind: "pc" })).rows.length === 3);

    // 1.4C. An adversary is added already hidden, and a hidden add publishes no name
    // even when the event carried one — a forged or careless sender cannot leak it.
    const hiddenAdd = run(started,
      { type: "init", action: "add", id: "n2", name: "Glass Warden", kind: "npc", hidden: true });
    ok("a row can be added already hidden", init(hiddenAdd).rows[3].hidden === true);
    ok("a hidden add publishes no name, whatever the event carried",
      !JSON.stringify(hiddenAdd).includes("Glass Warden"));
    ok("an add without the flag is still visible",
      init(started).rows.every((r) => r.hidden === false));

    const long = run(started, { type: "init", action: "add", id: "long", name: "x".repeat(500), kind: "npc" });
    ok(`a long name is clamped to ${INITIATIVE_NAME_MAX}`,
      init(long).rows[3].name.length <= INITIATIVE_NAME_MAX);

    const silly = { ...fresh(), initiative: { round: 1e9, rows: [{ id: "a", name: "A", kind: "pc" }] } };
    ok("an absurd round number is clamped", readInitiative(silly).round <= 999);
    const negative = { ...fresh(), initiative: { round: -5, rows: [] } };
    ok("a negative round number is clamped up", readInitiative(negative).round >= 1);
  }

  // --- junk from the room, which is where this is read from ---
  {
    ok("initiative that is not an object reads as none",
      readInitiative({ ...fresh(), initiative: "yes" }) === null);
    ok("rows that are not an array read as empty",
      readInitiative({ ...fresh(), initiative: { round: 1, rows: "nope" } }).rows.length === 0);
    ok("junk rows are dropped",
      readInitiative({ ...fresh(), initiative: { round: 1, rows: [null, {}, 7, { id: "ok", name: "Fine" }] } })
        .rows.length === 1);
    ok("an unknown kind falls back to pc",
      readInitiative({ ...fresh(), initiative: { round: 1, rows: [{ id: "a", name: "A", kind: "dragon" }] } })
        .rows[0].kind === "pc");
    ok("an unknown action leaves the tracker alone",
      JSON.stringify(init(run(started, { type: "init", action: "explode" }))) === JSON.stringify(init(started)));
    ok("INITIATIVE_ACTIONS does not contain the unknown action", !INITIATIVE_ACTIONS.has("explode"));
  }


  // --- who may tick a row ---
  {
    const pc = { id: initRowIdForCharacter("Kesh Alvaran"), name: "Kesh Alvaran", kind: "pc", hidden: false };
    const other = { id: initRowIdForCharacter("Orrin"), name: "Orrin", kind: "pc", hidden: false };
    const npc = { id: "npc:1", name: "Reaver", kind: "npc", hidden: false };
    const secret = { id: "npc:2", name: "", kind: "npc", hidden: true };

    ok("the GM may tick anyone", [pc, other, npc, secret].every((r) => mayMarkRow(r, { role: "GM" })));
    ok("a player may tick their own row",
      mayMarkRow(pc, { role: "PLAYER", myNameKey: "Kesh Alvaran" }) === true);
    ok("case and stray spaces do not stop them",
      mayMarkRow(pc, { role: "PLAYER", myNameKey: "  kesh ALVARAN " }) === true);
    ok("a player may not tick someone else's row",
      mayMarkRow(other, { role: "PLAYER", myNameKey: "Kesh Alvaran" }) === false);
    ok("a player may not tick an adversary",
      mayMarkRow(npc, { role: "PLAYER", myNameKey: "Kesh Alvaran" }) === false);
    // They cannot know whose it is, so there is nothing to offer them.
    ok("a player may not tick a hidden row",
      mayMarkRow(secret, { role: "PLAYER", myNameKey: "Kesh Alvaran" }) === false);
    ok("an unnamed player matches nothing",
      mayMarkRow(pc, { role: "PLAYER", myNameKey: "" }) === false);
    ok("and nothing at all is not a row", mayMarkRow(null, { role: "GM" }) === false);
    ok("one character on two tokens is still one row id",
      initRowIdForCharacter("Kesh Alvaran") === initRowIdForCharacter("kesh alvaran "));
    ok("a nameless character gets no row id", initRowIdForCharacter("  ") === "");
  }

  // --- what a row is labelled ---
  {
    const shown = { id: "npc:1", name: "Reaver", kind: "npc", hidden: false };
    const secret = { id: "npc:2", name: "", kind: "npc", hidden: true };
    ok("a visible row shows its name", initRowLabel(shown, { role: "PLAYER" }) === "Reaver");
    ok("a row with no name at all is not blank", initRowLabel({ id: "x", name: "" }, { role: "GM" }) === "Unnamed");
    // The player's client HAS no name to draw — it was never published.
    ok("a player sees a hidden row as Hidden", initRowLabel(secret, { role: "PLAYER" }) === "Hidden");
    ok("a player is not handed the name even if one is passed in",
      initRowLabel(secret, { role: "PLAYER", hiddenNames: { "npc:2": "Reaver Boss" } }) === "Hidden");
    ok("the GM sees it from their own storage",
      initRowLabel(secret, { role: "GM", hiddenNames: { "npc:2": "Reaver Boss" } }) === "Reaver Boss");
    // Honest rather than inventing one: the GM cleared their site data, or is on a
    // different machine from the one that hid it.
    ok("and sees Hidden when their storage has lost it",
      initRowLabel(secret, { role: "GM", hiddenNames: {} }) === "Hidden");
    ok("a remembered name is still clamped",
      initRowLabel(secret, { role: "GM", hiddenNames: { "npc:2": "z".repeat(500) } }).length <= INITIATIVE_NAME_MAX);
  }

  // --- the trust boundary ---
  {
    for (const action of ["start", "end", "next", "add", "remove", "move", "hide"]) {
      ok(`running the round is the GM's: ${action}`,
        isGmOnlyEvent({ type: "init", action }) === true);
    }
    // Deliberately open. Players mark themselves, which is the participatory half of
    // the feature; a forged tick is one GM click to undo.
    ok("marking a turn ended is open to everyone",
      isGmOnlyEvent({ type: "init", action: "act", id: "a", acted: true }) === false);
    ok("the party-share switch is the GM's",
      isGmOnlyEvent({ type: "partyShared", value: false }) === true);
  }

  // --- surviving the metadata budget ---
  {
    // The tracker must outlive a flooded log, the same way the epochs do. A tracker
    // that vanishes mid-fight because someone rolled a lot is worse than no tracker.
    let busy = run(fresh(),
      { type: "init", action: "start" },
      { type: "init", action: "add", id: "a", name: "Kesh", kind: "pc" },
      { type: "init", action: "add", id: "n1", name: "Reaver", kind: "npc" });
    busy = run(busy, { type: "init", action: "act", id: "a", acted: true }, { type: "init", action: "next" });
    for (let i = 0; i < 400; i++) {
      busy = applyEvent(busy, { type: "roll", entry: {
        id: "e" + i, t: NOW + i, kind: "roll", who: "Flooder",
        label: "x".repeat(40), detail: "y".repeat(120) } });
    }
    const trimmed = trimState(busy);
    ok("the log really was trimmed", JSON.stringify(trimmed).length <= 11000);
    ok("initiative survives trimming", readInitiative(trimmed) !== null);
    ok("and keeps its round", readInitiative(trimmed).round === 2);
    ok("and keeps its rows", readInitiative(trimmed).rows.length === 2);
    ok("and keeps the party-share setting", trimmed.partyShared === true);

    // What the normalise in trimState() is actually FOR. The spread already carries
    // initiative through — the trim loop only pops log entries — so survival is not
    // the point. The point is that the loop stops at one log entry, so a forged
    // initiative big enough to blow the 16 kB budget on its own would strip the log
    // to nothing and still overrun, breaking room metadata for every OTHER extension
    // in the room. Clamping on the way through is what stops that.
    const forged = { ...fresh(), initiative: { round: 1, rows: Array.from({ length: 4000 },
      (_, i) => ({ id: "x" + i, name: "n".repeat(300), kind: "npc" })) } };
    const clamped = trimState(forged);
    ok(`a forged oversized initiative is cut to ${MAX_INITIATIVE_ROWS} rows`,
      readInitiative(clamped).rows.length === MAX_INITIATIVE_ROWS);
    ok("and its names are cut to the limit",
      readInitiative(clamped).rows.every((r) => r.name.length <= INITIATIVE_NAME_MAX));
    ok(`and the trimmed state fits the room budget (${JSON.stringify(clamped).length})`,
      JSON.stringify(clamped).length <= 11000);
  }

  // --- the party-share switch ---
  {
    ok("sharing is on by default", fresh().partyShared === true);
    const off = run(fresh(), { type: "partyShared", value: false });
    ok("the GM can turn it off", off.partyShared === false);
    ok("and back on", run(off, { type: "partyShared", value: true }).partyShared === true);
    // A room written before 1.4 has no flag at all. It must read as SHARED rather than
    // as off, or the switch would silently be in the opposite position from the default.
    const old = { ...fresh() };
    delete old.partyShared;
    ok("a room from before 1.4 reads as shared", trimState(old).partyShared === true);
  }

  // --- a v4 room meeting a 1.4 client ---
  {
    const v4 = { v: 4, momentum: 2, threat: 1, log: [],
      epochs: { scene: 3, session: 1, adventure: 0, breather: 0, break: 0, bed: 2 },
      compAt: 18, bonds: [] };
    const seen = trimState(v4);
    ok("a v4 room keeps its pools", seen.momentum === 2 && seen.threat === 1);
    ok("a v4 room keeps its epochs", readEpochs(seen).scene === 3 && readEpochs(seen).bed === 2);
    ok("a v4 room keeps its Complication level", readCompAt(seen) === 18);
    ok("a v4 room simply has no initiative running", readInitiative(seen) === null);
  }
}

console.log(`\nparty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
