// =============================================================
// The popped-out sheet — creator v1.29 / extension 0.9.9
// -------------------------------------------------------------
// A sheet in its own browser window cannot reach Owlbear. The SDK talks through
// `window.parent.postMessage` and refuses to send until that parent completes an
// OBR_READY handshake, and a window opened with window.open() is its own top-level
// context — so `window.parent` is itself and the handshake never arrives. The sheet
// therefore talks to the extension's background page over a BroadcastChannel instead,
// and this suite is that conversation.
//
// It runs the real module block with `?popout=1`, against a FAKE CHANNEL and a fake
// host. The host is written to the protocol rather than being the real background.js,
// which imports the SDK and cannot run here — so the last block below compares the two
// halves' op names directly, because a request one side sends and the other has never
// heard of is the failure this design is most likely to produce.
// =============================================================
import fs from "fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const raw = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");
const modStart = raw.indexOf('<script type="module">');
const modEnd = raw.indexOf("</script>", modStart);
const modSrc = raw.slice(modStart + '<script type="module">'.length, modEnd);
const html = raw.slice(0, modStart) + raw.slice(modEnd + "</script>".length);

// By length, not by text: two comments above the bundle quote `const OBR = Zo;`.
const lines = modSrc.split("\n");
const sdkLine = lines.findIndex((l) => l.length > 2000);
lines.splice(sdkLine, 1);
const body = lines.join("\n");

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://gsgrimoire.github.io/dnm-cc/?popout=1&item=token-1&room=room-1",
});
const w = dom.window;
await new Promise((r) => { if (w.document.readyState === "complete") r(); else w.addEventListener("load", r); });

// -------------------------------------------------------------
// A fake channel, and a fake room on the other end of it
// -------------------------------------------------------------
const hub = { peers: [] };
class FakeChannel {
  constructor(name) { this.name = name; this.onmessage = null; hub.peers.push(this); }
  postMessage(data) {
    // Structured clone in spirit: a message that cannot survive the trip must not pass
    // here either. This is what would catch someone trying to send a function.
    const copy = JSON.parse(JSON.stringify(data));
    for (const peer of hub.peers) {
      if (peer === this) continue;
      if (peer.onmessage) peer.onmessage({ data: copy });
    }
  }
  close() { hub.peers = hub.peers.filter((p) => p !== this); }
}
w.BroadcastChannel = FakeChannel;

// Everything the host was asked to do, in order, so a test can assert on the traffic
// rather than on a side effect the popout cannot see.
const seen = [];
const room = {
  metadata: { "com.thuknights.dnm-rolls/state": { v: 4, momentum: 2, threat: 5, log: [], epochs: {}, compAt: 20, bonds: [] } },
  tokens: { "token-1": null },
  self: { role: "GM", name: "Tester", id: "p-popout" },
  partyCodes: [],
};

const hostChannel = new FakeChannel("com.thuknights.dnm-obr/popout");
hostChannel.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.dir !== "req") return;
  seen.push(msg);
  if (msg.room && msg.room !== "room-1") return;   // a different room must stay silent
  let payload = { ok: true };
  if (msg.op === "self") payload = { ...room.self };
  else if (msg.op === "metadata") payload = { metadata: room.metadata };
  else if (msg.op === "tokenCode") payload = { code: room.tokens[msg.itemId] || null };
  else if (msg.op === "writeToken") { room.tokens[msg.itemId] = msg.code; payload = { ok: true }; }
  else if (msg.op === "clearToken") { room.tokens[msg.itemId] = null; payload = { ok: true }; }
  else if (msg.op === "partyCodes") payload = { codes: room.partyCodes };
  else if (msg.op === "broadcast") payload = { ok: true };
  else if (msg.op === "bye") return;
  hostChannel.postMessage({ dir: "res", id: msg.id, v: 1, data: payload });
};

// A dead SDK, which is exactly what a popped-out window has. If any of this suite's
// assertions were being satisfied by the SDK rather than the relay, they would fail.
w.eval(`const OBR = { isAvailable: false, onReady: () => {}, room: { get id() { return ""; } } };\n` + body);

const g = (code) => w.eval(code);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(300);

// -------------------------------------------------------------
// It connects
// -------------------------------------------------------------
ok("the popout says hello before doing anything else",
  seen.length > 0 && seen[0].op === "hello");
ok("and stamps the room it belongs to, so a second room stays out of it",
  seen[0].room === "room-1");
ok("and the protocol version, so a mismatched pair fails loudly",
  seen[0].v === 1);
ok("it reads the player through the relay", seen.some((m) => m.op === "self"));
ok("and the room state", seen.some((m) => m.op === "metadata"));
ok("and asks the token for its character", seen.some((m) => m.op === "tokenCode" && m.itemId === "token-1"));
// `bridge` and `roomMomentum` are module-block `const`/`let`, and jsdom gives each
// w.eval its own scope for those — the same limit embedded.test.mjs documents. So the
// evidence that the SDK was not used is that the traffic happened at all: a direct
// bridge would have posted nothing to the channel.
ok("the sheet did not use the SDK, which is dead in a popped-out window",
  seen.length >= 3);
ok("it adopted the room's Threat", g("obrThreat") === 5);

// -------------------------------------------------------------
// It works
// -------------------------------------------------------------
{
  // A character, adopted onto the token exactly as the framed sheet does it.
  g(`(function(){
    var c = state.character = getDefaultCharacter();
    c.name = 'Popped';
    c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = Object.keys(DM_DATA.archetypes)[0];
    c.temperament = Object.keys(DM_DATA.temperaments)[0];
    var arch = DM_DATA.archetypes[c.archetype];
    if (!arch.forcedTalent) { var t = Object.keys(arch.talents || {}); if (t.length) c.talent = t[0]; }
    c.finalized = true;
    normalizeEditableLists(); computeStats(); normalizeCurrentValues();
  })()`);
  g("adoptOntoToken({ render: false })");
  await wait(80);
  ok("saving writes the character back to the token through the relay",
    typeof room.tokens["token-1"] === "string" && room.tokens["token-1"].startsWith("DM1-"));

  seen.length = 0;
  g(`(function(){
    postRoll('Popped', { dice: [3, 15], attrValue: 9, skillValue: 2, attrName: 'Might',
      skillName: 'Fight', difficulty: 1, successes: 1, complications: 0, passed: true,
      momentumGained: 0 });
  })()`);
  await wait(60);
  const rolls = seen.filter((m) => m.op === "broadcast" && m.event.type === "roll");
  ok("a roll made in the popped-out window reaches the table", rolls.length === 1);
  ok("carrying the player id, so its Momentum is claimable", rolls[0].event.entry.by === "p-popout");

  // Threat is the pool most likely to be nudged from a popout, and it goes through the
  // batcher — so this also proves the batcher survived being put behind the relay.
  seen.length = 0;
  g("addThreat(1,'manual adjustment'); addThreat(1,'manual adjustment'); addThreat(1,'manual adjustment');");
  await wait(1100);
  const pools = seen.filter((m) => m.op === "broadcast" && m.event.type === "pool");
  ok("three Threat presses are still one event through the relay",
    pools.length === 1 && pools[0].event.delta === 3);
}

// -------------------------------------------------------------
// The room pushes changes to it
// -------------------------------------------------------------
{
  room.metadata["com.thuknights.dnm-rolls/state"] = {
    v: 4, momentum: 6, threat: 1, log: [], epochs: {}, compAt: 18, bonds: [],
  };
  hostChannel.postMessage({ event: "room", room: "room-1", v: 1, metadata: room.metadata });
  await wait(60);
  ok("a room change reaches the popped-out sheet", g("obrThreat") === 1);
  ok("including the GM's Complication threshold", g("obrCompAt") === 18);

  // A second room open in the same browser must not be able to move this sheet.
  hostChannel.postMessage({ event: "room", room: "some-other-room", v: 1, metadata: {
    "com.thuknights.dnm-rolls/state": { v: 4, momentum: 0, threat: 99, log: [], epochs: {}, compAt: 20, bonds: [] },
  } });
  await wait(60);
  ok("a push from a different room is ignored", g("obrThreat") === 1);
}

// -------------------------------------------------------------
// The two halves speak the same language
// -------------------------------------------------------------
// The host cannot run here — background.js imports the SDK — so this compares the op
// names each side knows. A request one side sends and the other has never heard of is
// the failure this design is most likely to produce, and it would show up at the table
// as a sheet that loads and then does nothing.
{
  const host = fs.readFileSync(new URL("../out/dnm-obr/background.js", import.meta.url), "utf8");
  const hostOps = new Set([...host.matchAll(/case "([a-zA-Z]+)":/g)].map((m) => m[1]));
  // hello, ping and bye are handled before the switch rather than in it.
  for (const lifecycle of ["hello", "ping", "bye"]) {
    ok(`the host handles "${lifecycle}"`, host.includes(`"${lifecycle}"`));
  }
  const sentOps = [...body.matchAll(/call\("([a-zA-Z]+)"/g)].map((m) => m[1])
    .filter((op) => !["hello", "ping", "bye"].includes(op));
  ok("the popout sends at least the five it needs", new Set(sentOps).size >= 5);
  const unknown = [...new Set(sentOps)].filter((op) => !hostOps.has(op));
  ok(`every op the popout sends is one the host answers${unknown.length ? " — MISSING: " + unknown.join(", ") : ""}`,
    unknown.length === 0);

  ok("both halves agree on the channel name",
    host.includes("POPOUT_CHANNEL") && body.includes("com.thuknights.dnm-obr") && body.includes("/popout"));

  // The defect this suite found before it ever reached a room, pinned so it cannot
  // come back. The host used to SPREAD its answer into the reply envelope, which read
  // more neatly and was wrong: the answer to "self" carries the player's `id`, and it
  // overwrote the envelope's correlation `id`. No response could be matched to its
  // request, so every read from a popped-out sheet hung until it timed out — and the
  // window sat there rendering a complete, editable sheet that reached nobody.
  //
  // Asserted against the source because the fake host above is written to the
  // protocol and so cannot reproduce a host that breaks it.
  ok("the host nests its answer rather than spreading it into the envelope",
    host.includes("data: payload"));
  ok("and does not spread a payload anywhere in the reply",
    !/postMessage\(\{[^}]*\.\.\.payload/.test(host));
  ok("the popout reads the nested answer", body.includes("waiting.resolve(msg.data"));
}

console.log(`\npopout: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — the channel and the host are both fakes:
  · that Owlbear's iframe permits window.open at all. If it does not, the button
    reports that the browser blocked it and nothing else changes.
  · that a real BroadcastChannel crosses /dnm-cc/ and /dnm-obr/ (it should: an origin
    is scheme, host and port, and both are on gsgrimoire.github.io)
  · the real background.js answering, since it imports the SDK
These are live checks in UPGRADE_NOTES.md.`);
process.exit(fail ? 1 : 0);
