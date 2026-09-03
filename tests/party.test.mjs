// Party-status tests. These exercise the real exported helpers from dnm.js — no
// reimplementation, no hand-built status objects.
import { epochStatus, readAppliedEpochs, EPOCH_KEYS, emptyEpochs, EPOCH_LABELS, isGmOnlyEvent, readCompAt, classifyDie, applyEvent, EMPTY_STATE,
  COMP_AT_MIN, COMP_AT_MAX, readBondQueue, pruneBondQueue, bondNamesMatch,
  MAX_BOND_EFFECTS, BOND_EFFECT_TTL_MS, trimState, MAX_LOG_ENTRIES,
  createPoolBatcher, sanitizeBondEffect, DRIVE_THREAT_SPEND_MIN, FIELD_LIMITS } from "../out/dnm-obr/dnm.js";

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

console.log(`\nparty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
