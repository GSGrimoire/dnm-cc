// Party-status tests. These exercise the real exported helpers from dnm.js — no
// reimplementation, no hand-built status objects.
import { epochStatus, readAppliedEpochs, EPOCH_KEYS, emptyEpochs, EPOCH_LABELS, isGmOnlyEvent } from "../out/dnm-obr/dnm.js";

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

console.log(`\nparty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
