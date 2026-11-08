// Acceptance regressions for the 1 November 2026 review (creator 2.6B, extension 1.8B).
//
// The review's probes (docs/reviews/2026-11-01/probes.mjs on the review branch)
// REPRODUCED each defect: their assertions describe the broken behaviour. This suite
// is those same scenarios turned round to require the corrected behaviour, built on
// the same harness: the real creator booted onto a stub token, and the real
// background page, reducer and roller loaded as ES modules with only sdk.js swapped.
//
// Run from dnm-cc after staging out/ (see the skill):
//   node --experimental-vm-modules tests/review.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { deflateRawSync } from "node:zlib";
import { JSDOM, VirtualConsole } from "jsdom";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const root = path.resolve(new URL("../", import.meta.url).pathname);
const ext = path.join(root, "out/dnm-obr");
const html = fs.readFileSync(path.join(root, "out/dnm-cc/index.html"), "utf8");
const start = html.indexOf('<script type="module">'), end = html.indexOf("</script>", start);
const classic = html.slice(0, start) + html.slice(end + 9);
const lines = html.slice(start + '<script type="module">'.length, end).split("\n");
// The vendored SDK is the one very long line; found by length, as embedded.test.mjs does.
lines.splice(lines.findIndex((x) => x.length > 2000), 1);
const moduleBody = lines.join("\n");
const virtualConsole = new VirtualConsole();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAR = "com.thuknights.dnm-obr/char", ROOM = "com.thuknights.dnm-rolls/state";

function baseWindow() {
  const dom = new JSDOM(classic, { runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://gsgrimoire.github.io/dnm-cc/?item=review-token", virtualConsole });
  const w = dom.window;
  w.scrollTo = () => {};
  // Built from DM_DATA the way the app builds one, then computeStats().
  w.eval(`(() => { const c = state.character = getDefaultCharacter();
    c.name = 'Aster'; c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = Object.keys(DM_DATA.archetypes)[0]; c.temperament = Object.keys(DM_DATA.temperaments)[0];
    c.finalized = true; normalizeEditableLists(); if (!computeStats()) throw Error('fixture');
    c.currentSpirit = 3; c.appliedRerolls = []; })()`);
  return dom;
}
const fixture = baseWindow();
const initialCode = fixture.window.eval("buildCharacterCode()");
const firstContactCode = fixture.window.eval("delete state.character.appliedRerolls; buildCharacterCode()");
fixture.window.close();

const emptyRoom = () => ({ v: 6, momentum: 0, threat: 0, log: [], bonds: [], claimPay: 1,
  epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 }, compAt: 20 });

async function sheet(code = initialCode, room = emptyRoom()) {
  const dom = baseWindow(), w = dom.window;
  w.__io = { code, room: structuredClone(room), events: [], writes: [], pending: [], hold: false, failWrite: false, failSend: false };
  const stub = `const OBR = {
    isAvailable: true, onReady: fn => { window.__start = fn; },
    player: { getRole: async () => 'GM', getId: async () => 'p1', getName: async () => 'Reviewer', onChange: () => () => {} },
    party: { getPlayers: async () => [], onChange: () => () => {} },
    broadcast: { onMessage: () => () => {}, sendMessage: async (ch, ev) => { if (window.__io.failSend) throw Error('injected send failure'); window.__io.events.push(ev); } },
    room: { getMetadata: async () => ({ ['${ROOM}']: window.__io.room }), onMetadataChange: () => () => {} },
    scene: { onReadyChange: () => () => {}, items: {
      getItems: async () => [{ id: 'review-token', metadata: { ['${CHAR}']: { v: 1, code: window.__io.code } } }],
      onChange: () => () => {},
      updateItems: async (ids, mutate) => {
        const items = [{ id: 'review-token', metadata: { ['${CHAR}']: { v: 1, code: window.__io.code } } }];
        mutate(items); const next = items[0].metadata['${CHAR}'].code;
        window.__io.writes.push(next);
        if (window.__io.failWrite) throw Error('injected token write failure');
        if (window.__io.hold) return new Promise(resolve => window.__io.pending.push({ code: next, finish() { window.__io.code = next; resolve(); } }));
        window.__io.code = next;
      } } },
    popover: { close: async () => {}, setWidth: async () => {}, setHeight: async () => {}, open: async () => {} },
    modal: { close: async () => {} }, viewport: { getWidth: async () => 1200, getHeight: async () => 900 }, action: { setHeight: async () => {} }
  };`;
  w.eval(stub + moduleBody);
  await w.__start();
  await delay(500);
  // What the sheet sent while it opened, kept before the slate is wiped for the test.
  w.__io.bootEvents = w.__io.events.slice();
  w.__io.events.length = 0; w.__io.writes.length = 0;
  return { w, g: (t) => w.eval(t), io: w.__io };
}
const durable = (s, field) => s.g(`parseCharacterCode(${JSON.stringify(s.io.code)}).character.${field}`);

async function moduleApp(filename, io, append = "", documentHtml = null) {
  const dom = documentHtml ? new JSDOM(documentHtml, { runScripts: "outside-only", url: "https://gsgrimoire.github.io/dnm-obr/", virtualConsole }) : null;
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const context = dom ? dom.getInternalVMContext() : vm.createContext({ console, structuredClone, TextEncoder, TextDecoder, URL, Date, setTimeout, clearTimeout, atob, btoa });
  const target = dom ? dom.window : context;
  if (!dom) target.window = target;
  Object.assign(target, { __io: io, structuredClone, TextEncoder, TextDecoder });
  if (!dom) target.localStorage = storage;
  const sdk = `export default { isAvailable: true, onReady() {}, action: { setHeight: async () => {} },
    player: { getId: async () => window.__io.playerId || 'gm1', getConnectionId: async () => window.__io.connectionId || 'gm1-conn' },
    party: { getPlayers: async () => window.__io.players || [] },
    room: { id: 'review-room', getMetadata: async () => structuredClone(window.__io.metadata), setMetadata: async patch => { Object.assign(window.__io.metadata, structuredClone(patch)); } },
    broadcast: { sendMessage: async (channel, ev) => { window.__io.events.push(ev); } } };`;
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let src = file.endsWith("/sdk.js") ? sdk : fs.readFileSync(file, "utf8");
    if (file.endsWith("/" + filename)) src += "\n" + append;
    const mod = new vm.SourceTextModule(src, { context, identifier: file, initializeImportMeta(meta) { meta.url = "file://" + file; } });
    cache.set(file, mod); return mod;
  }
  const main = load(path.join(ext, filename));
  await main.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  await main.evaluate();
  return { api: main.namespace, dnm: load(path.join(ext, "dnm.js")).namespace, dom };
}

const roll = (id = "r1", extra = {}) => ({ id, by: "p1", who: "Aster", t: 1000, an: "Might", av: 10, sn: "Fight", sv: 2,
  diff: 1, compAt: 20, src: "pc", detail: [{ d: 19, kind: "fail" }, { d: 9, kind: "success" }], succ: 1, comp: 0, pass: true, gain: 0, ...extra });
const rr = (id = "r1") => ({ type: "reroll", id, how: "spirit", pay: "room", g: "g-" + id, t: Date.now(), dice: [{ i: 0, to: 1 }] });
const request = { id: "paid-review-1", attr: "might", skill: "fight", extra: 2, difficulty: 2, label: "Review primary" };

// -------------------------------------------------------------
// F01. Overlapping saves: the newest state wins, and "saved" means saved
// -------------------------------------------------------------
{
  const s = await sheet(); s.io.hold = true;
  s.g("state.character.currentSpirit = 2"); const first = s.w.commit();
  s.g("state.character.currentSpirit = 1"); const second = s.w.commit();
  ok("F01: a save asked for during a write does not start a second write", s.io.pending.length === 1);
  s.io.pending[0].finish(); await delay(0);
  ok("F01: the follow-up write starts once the first lands", s.io.pending.length === 2);
  s.io.pending[1].finish();
  const results = await Promise.all([first, second]);
  ok("F01: the token ends on the newest state", durable(s, "currentSpirit") === 1);
  ok("F01: both callers are told the save is confirmed", results.every((r) => r === true));
  ok("F01: and the bar says saved", s.w.document.getElementById("obrSaveState").textContent === "saved");
  s.io.hold = false; s.io.failWrite = true;
  s.g("state.character.currentSpirit = 3");
  ok("F01: a failed write resolves false", (await s.w.commit()) === false);
  ok("F01: and the bar says so", s.w.document.getElementById("obrSaveState").textContent === "save failed");
  s.w.close();
}

// -------------------------------------------------------------
// F02. Paid primary rolls: saved before they are sent, and never lost
// -------------------------------------------------------------
{
  // Moved here from embedded.test.mjs in 2.6B: a paid roll now refuses to publish until
  // the token write is confirmed, and that window has no token to write to.
  const s = await sheet();
  const result = await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
  const rolls = s.io.events.filter((e) => e.type === "roll");
  ok("requested test rolls four dice and pays two Spirit", result?.dice.length === 4 && s.g("getEffectiveResource('spirit')") === 1);
  ok("paid primary reaches the shared log once under the request id", rolls.length === 1 && rolls[0].entry.id === request.id && rolls[0].entry.boughtDice === 2);
  ok("paid primary preserves its label and actor", rolls[0]?.entry.label === request.label && rolls[0]?.entry.by === "p1");
  ok("no Momentum or Threat payment is emitted", !s.io.events.some((e) => e.type === "pool"));
  ok("F02: the payment was on the token before the roll was sent", s.io.writes.length >= 1
    && s.g(`parseCharacterCode(${JSON.stringify(s.io.writes[0])}).character.currentSpirit`) === 1);
  await delay(600);
  ok("F02: once sent, nothing is left waiting", durable(s, "unsentRolls")?.length === 0);
  await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
  ok("duplicate request cannot charge twice", s.io.events.filter((e) => e.type === "roll").length === 1 && s.g("getEffectiveResource('spirit')") === 1);
  ok("oversized request is rejected", (await s.w.consumeRequestedSpiritTest("x".repeat(601))) === null);
  s.g("obrHasGM = false; state.character.currentSpirit = 3;");
  await s.w.consumeRequestedSpiritTest(JSON.stringify({ ...request, id: "no-gm" }));
  ok("no connected GM means no paid test or Spirit charge", s.io.events.filter((e) => e.type === "roll").length === 1 && s.g("getEffectiveResource('spirit')") === 3);
  s.w.close();
}
{
  // The failed WRITE: 2.6 published anyway and the replay rolled new dice.
  const s = await sheet(); s.io.failWrite = true; s.w.rollDie = () => 4;
  await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
  await delay(20);
  ok("F02: a paid roll whose save fails is not published", !s.io.events.some((e) => e.type === "roll"));
  ok("F02: and its Spirit is given back on the sheet", s.g("getEffectiveResource('spirit')") === 3);
  ok("F02: and it is not left in Recent Rolls", !s.g(`(state.character.recentRolls||[]).some(e => e.rid === '${request.id}')`));
  ok("F02: and the request may be made again", !s.g(`(state.character.paidRollRequests||[]).includes('${request.id}')`));
  ok("F02: the token still holds the Spirit", durable(s, "currentSpirit") === 3);
  s.w.close();
}
{
  // The failed SEND: 2.6 kept the payment and lost the roll.
  const s = await sheet(); s.io.failSend = true; s.w.rollDie = () => 6;
  const result = await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
  await delay(2600); // the three send attempts back off 0.8 s and 1.6 s
  ok("F02: an unsent paid roll is kept on the token with the payment",
    durable(s, "currentSpirit") === 1 && durable(s, "unsentRolls")?.[0]?.id === request.id);
  const reopened = await sheet(s.io.code);
  const resent = reopened.io.bootEvents.filter((e) => e.type === "roll");
  ok("F02: reopening sends the SAME roll — same id, same dice", resent.length === 1 && resent[0].entry.id === request.id
    && resent[0].entry.detail.map((x) => x.d).join() === result.dice.join());
  await delay(100);
  ok("F02: and clears it once it has gone", durable(reopened, "unsentRolls")?.length === 0);
  ok("F02: the request is still refused as done", (await reopened.w.consumeRequestedSpiritTest(JSON.stringify(request))) === null);
  s.w.close(); reopened.w.close();
}

// -------------------------------------------------------------
// Background page and reducer
// -------------------------------------------------------------
const backgroundAppend = `export function auditWatch(items) { recoveryRoom = 'review-room'; watchForLostCharacters(items); }
  export function auditRecovery() { return readRecovery(safeStorage(), 'review-room'); }
  export async function auditRefresh() { await refreshGmConnections(); }
  export function auditAccept(ev) { relay(ev); return writeChain; }`;
const io = { metadata: { [ROOM]: emptyRoom() }, events: [] };
const bg = await moduleApp("background.js", io, backgroundAppend);
const dnm = bg.dnm;

// F06. Two GM connections: one writer.
{
  const players = (self) => [{ id: self === "gm1-conn" ? "gm2" : "gm1", connectionId: self === "gm1-conn" ? "gm2-conn" : "gm1-conn", role: "GM" }];
  const ioA = { ...io, players: players("gm1-conn") };
  const a = await moduleApp("background.js", ioA, backgroundAppend);
  const ioB = { ...io, playerId: "gm2", connectionId: "gm2-conn", players: players("gm2-conn") };
  const b = await moduleApp("background.js", ioB, backgroundAppend);
  // The two share one metadata object, as two clients in one room do.
  ioB.metadata = ioA.metadata;
  ioA.metadata[ROOM] = emptyRoom();
  await a.api.auditRefresh(); await b.api.auditRefresh();
  const ev = { connectionId: "gm1-conn", data: { type: "pool", pool: "momentum", delta: 1 } };
  await a.api.auditAccept(ev); await b.api.auditAccept(ev);
  ok("F06: one +1 seen by two GM background pages adds 1", ioA.metadata[ROOM].momentum === 1);
  ok("F06: the election is the lowest connection id", typeof dnm.isElectedWriter === "function" && dnm.isElectedWriter("a", ["b", "a"]) && !dnm.isElectedWriter("b", ["b", "a"]));
  ok("F06: an unknown self still writes, as before 1.8B", typeof dnm.isElectedWriter === "function" && dnm.isElectedWriter(null, ["a"]));
  // Failover: the elected GM leaves and the other takes over on the next party read.
  ioB.players = [];
  await b.api.auditRefresh();
  await b.api.auditAccept(ev);
  ok("F06: when the writer leaves, the next GM writes", ioA.metadata[ROOM].momentum === 2);
}

// F05. Recovery keeps the newest code even when an edit leaves the length unchanged.
{
  const f = baseWindow(), w = f.window;
  const byLength = new Map(); let pair;
  for (let i = 0; i < 60 && !pair; i++) {
    w.eval(`state.character.customItems = [${JSON.stringify("Review item " + i)}]`);
    const code = w.eval("buildCharacterCode()");
    if (byLength.has(code.length)) pair = [byLength.get(code.length), code]; else byLength.set(code.length, code);
  }
  ok("F05: the fixture found two different codes of one length", !!pair && pair[0] !== pair[1]);
  const token = (code) => [{ id: "same-token", metadata: { [CHAR]: { v: 1, code } } }];
  bg.api.auditWatch(token(pair[0])); bg.api.auditWatch(token(pair[1])); bg.api.auditWatch([]);
  const recovered = bg.api.auditRecovery()[0]?.code;
  ok("F05: deleting the token offers the latest edit", recovered === pair[1]);
  w.close();
}

// F04. Reroll debts: paid on first contact, and kept beyond the log.
{
  const changed = dnm.applyEvent({ ...emptyRoom(), log: [roll()] }, rr(), { sender: "p1" });
  ok("F04: a roller reroll files a debt beside the log", (dnm.readRerollDebts || (() => []))(changed).length === 1);
  const s = await sheet(firstContactCode, changed);
  ok("F04: a character with no ledger pays for it", s.g("getEffectiveResource('spirit')") === 2);
  s.w.close();
  let trimmed = changed;
  for (let i = 0; i < 40; i++) trimmed = dnm.trimState(dnm.applyEvent(trimmed, { type: "action", entry: { id: "later-" + i, t: i + 3000, kind: "action", who: "Reviewer", label: "Later", detail: "Later table action" } }));
  ok("F04: the paid roll has fallen off the log", !trimmed.log.some((e) => e.id === "r1"));
  ok("F04: the debt has not", (dnm.readRerollDebts || (() => []))(trimmed).length === 1);
  const later = await sheet(initialCode, trimmed);
  ok("F04: a sheet opened afterwards still pays", later.g("getEffectiveResource('spirit')") === 2);
  later.g(`adoptRoom(${JSON.stringify({ [ROOM]: trimmed })})`);
  ok("F04: and only once", later.g("getEffectiveResource('spirit')") === 2);
  later.w.close();
  const sheetPaid = dnm.applyEvent({ ...emptyRoom(), log: [roll()] }, { ...rr(), pay: "sheet" }, { sender: "p1" });
  ok("F04: a reroll the sheet already paid files no debt", (dnm.readRerollDebts || (() => []))(sheetPaid).length === 0);
  const old = { ...emptyRoom(), debts: [{ k: "x:y", w: "Aster", h: "spirit", t: Date.now() - (dnm.REROLL_DEBT_TTL_MS || 0) - 1 }] };
  ok("F04: a debt older than its TTL is dropped", (dnm.readRerollDebts || (() => []))(old).length === 0);
}

// F03. Claims: one operation, capped, shared by both interfaces.
{
  const io2 = { metadata: { [ROOM]: emptyRoom() }, events: [] };
  const append = `export function auditSeed(next) { state = next; role = 'GM'; myPlayerId = 'p1'; standalone = false; render(); }
    export function auditClaim(entry) { return claimMomentum(entry); }`;
  const roller = await moduleApp("roller.js", io2, append, fs.readFileSync(path.join(ext, "index.html"), "utf8"));
  const entry = roll("gain", { gain: 3, succ: 4 });
  roller.api.auditSeed({ ...emptyRoom(), log: [entry] });
  await Promise.all([roller.api.auditClaim(entry), roller.api.auditClaim(entry)]);
  let state = { ...emptyRoom(), log: [entry] };
  for (const ev of io2.events) state = dnm.applyEvent(state, ev, { sender: "p1" });
  ok("F03: two stale claims on one roll pay once", state.momentum === 3);
  ok("F03: the roller sends no separate pool delta", !io2.events.some((e) => e.type === "pool"));
  ok("F03: the room writes one log line for it", state.log.filter((e) => e.id === "gain-m").length === 1);
  io2.events.length = 0;
  roller.api.auditSeed({ ...emptyRoom(), momentum: 5, log: [entry] }); await roller.api.auditClaim(entry);
  state = { ...emptyRoom(), momentum: 5, log: [entry] };
  for (const ev of io2.events) state = dnm.applyEvent(state, ev, { sender: "p1" });
  ok("F03: a claim stops at the cap of 6", state.momentum === 6);
  ok("F03: and the log says what was really added", state.log.find((e) => e.id === "gain-m")?.detail === "added 1 to the group pool");
  // A writer older than 1.8B: no claimPay, so the old marker-plus-delta, capped.
  io2.events.length = 0;
  const legacy = { ...emptyRoom(), momentum: 5, log: [entry] }; delete legacy.claimPay;
  roller.api.auditSeed(legacy); await roller.api.auditClaim(entry);
  ok("F03: against an older writer the roller falls back to a capped delta",
    io2.events.some((e) => e.type === "claim" && !e.pay) && io2.events.find((e) => e.type === "pool")?.delta === 1);
  roller.dom.window.close();
  ok("F03: a claim forged with its own amount pays the roll's gain, not the claim's",
    dnm.applyEvent({ ...emptyRoom(), log: [entry] }, { type: "claim", id: "gain", pay: true, gain: 99 }).momentum === 3);
}
{
  // The sheet's claim reaches the room as a claim.
  const s = await sheet(); s.w.rollDie = () => 1;
  const res = await s.w.consumeRequestedSpiritTest(JSON.stringify({ ...request, id: "sheet-claim", extra: 1, difficulty: 5 }));
  await delay(20);
  let room = emptyRoom();
  for (const ev of s.io.events) room = dnm.applyEvent(room, ev, { sender: "p1" });
  s.g(`adoptRoom(${JSON.stringify({ [ROOM]: room })})`);
  s.io.events.length = 0;
  s.w.claimRollMomentum();
  ok("F03: the sheet sends a paying claim, not a pool delta",
    s.io.events.some((e) => e.type === "claim" && e.id === "sheet-claim" && e.pay) && !s.io.events.some((e) => e.type === "pool"));
  for (const ev of s.io.events) room = dnm.applyEvent(room, ev, { sender: "p1" });
  ok("F03: the room pays the sheet's claim", room.momentum === res.momentumGained);
  ok("F03: and locks the roll for the roller", room.log.find((e) => e.id === "sheet-claim")?.claimed === true);
  s.w.close();
}

// F07. Import budgets.
{
  const compressed = deflateRawSync(Buffer.from("x".repeat(2 * 1024 * 1024)));
  let threw = false;
  try { dnm.unpackPayload(compressed.toString("base64").replace(/=/g, "")); } catch { threw = true; }
  ok("F07: a payload inflating past the ceiling is refused", threw);
  ok("F07: a real character code still unpacks", !!dnm.parseCode(initialCode).snap);
  const f = baseWindow(), w = f.window;
  const character = JSON.parse(w.eval("JSON.stringify(state.character)"));
  character.bonds = Array.from({ length: 1000 }, () => ({ name: "Review bond", type: "supportive" }));
  const payload = w.eval(`packPayload(${JSON.stringify(JSON.stringify(character))})`);
  const code = initialCode.split("-").map((p) => (p.startsWith("CP") ? "CP" + payload : p)).join("-");
  const parsed = w.eval(`(() => { const p = parseCharacterCode(${JSON.stringify(code)}); return p.error ? -1 : p.character.bonds.length; })()`);
  ok("F07: a thousand bonds are capped on import", parsed === 150);
  w.close();
}

// F08. A damaged payload is refused, not quietly replaced.
{
  const f = baseWindow(), w = f.window;
  w.eval("state.character.items = [{ id: DM_DATA.items[0].id, qty: 1 }]; state.character.currentSpirit = 1;");
  const good = w.eval("buildCharacterCode()");
  const corrupt = good.split("-").map((p) => (p.startsWith("CP") ? "CP!" : p)).join("-");
  const parsed = w.eval(`parseCharacterCode(${JSON.stringify(corrupt)})`);
  ok("F08: a damaged CP payload is an error", !!parsed.error);
  const legacy = good.split("-").filter((p) => !p.startsWith("CP")).join("-");
  ok("F08: a code with no CP at all still imports", !w.eval(`parseCharacterCode(${JSON.stringify(legacy)})`).error);
  w.close();
  // And the sheet keeps the token as it was.
  const s = await sheet(corrupt);
  await delay(600);
  ok("F08: opening a damaged code writes nothing to the token", s.io.writes.length === 0 && s.io.code === corrupt);
  s.w.close();
}

console.log(`\nreview: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — every SDK below is a stub:
  · real broadcast delivery and timing, and Owlbear's ordering of token writes
  · that getPlayers() lists a second tab of the same GM account as its own connection
    (the writer election assumes it does; if not, two tabs behave as before 1.8B)
  · the save-failure and send-failure paths against a real room
Those stay as live checks in UPGRADE_NOTES.md.`);
process.exit(fail ? 1 : 0);
