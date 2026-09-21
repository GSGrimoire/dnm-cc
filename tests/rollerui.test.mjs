// =============================================================
// rollerui.test.mjs — the roller's party panel, in a real browser (1.4B)
// -------------------------------------------------------------
// The FIRST suite that runs roller.js at all. Until now the extension's interface
// was reachable only through CSS measurement in layout.test.mjs, which builds rows
// by hand — so it proved the stylesheet and nothing about the code that decides
// what a row contains, who sees it, or what order it is in.
//
// That gap mattered the moment the initiative tracker was folded into the party
// panel in 1.4B: one renderer now serves characters and adversaries, GM and player,
// shared and private, ordered and alphabetical. Those are the decisions worth
// testing, and none of them is visible from a hand-built fixture.
//
// It works by swapping the vendored SDK for a stub in a staged copy — roller.js
// does `import OBR from "./sdk.js"`, so replacing that one file is enough, and no
// request interception or local server is needed. The stub records subscriptions so
// the test can push a scene, a room and a role at it the way Owlbear would.
// =============================================================
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

function findChromium() {
  const root = "/opt/pw-browsers";
  if (!fs.existsSync(root)) return null;
  for (const d of fs.readdirSync(root)) {
    if (!d.startsWith("chromium-")) continue;
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let browser;
try {
  browser = await chromium.launch(findChromium() ? { executablePath: findChromium() } : {});
} catch (err) {
  console.log("rollerui: SKIPPED — no browser available:", String(err.message).split("\n")[0]);
  process.exit(0);
}

// -------------------------------------------------------------
// Stage a copy of the extension with the SDK stubbed out.
// -------------------------------------------------------------
const stageDir = path.resolve("out/roller-stub");
fs.rmSync(stageDir, { recursive: true, force: true });
fs.cpSync(path.resolve("out/dnm-obr"), stageDir, { recursive: true });
fs.writeFileSync(path.join(stageDir, "sdk.js"), `
// Stub SDK. Only the surface roller.js actually touches.
const subs = { player: [], party: [], items: [], ready: [], meta: [], msg: [] };
const state = { role: "GM", items: [], meta: {}, selection: [] };
const on = (list) => (cb) => { list.push(cb); return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }; };
const OBR = {
  isAvailable: true,
  onReady(cb) { subs.ready.push(cb); queueMicrotask(cb); },
  player: {
    getRole: async () => state.role,
    getId: async () => "player-1",
    getName: async () => "Tester",
    getSelection: async () => state.selection,
    onChange: on(subs.player),
    getConnectionId: async () => "conn-1",
  },
  party: { getPlayers: async () => [], onChange: on(subs.party) },
  scene: {
    items: {
      getItems: async (ids) => (ids ? state.items.filter((i) => ids.includes(i.id)) : state.items),
      onChange: on(subs.items),
      updateItems: async () => {},
    },
    onReadyChange: on(subs.ready),
  },
  room: {
    id: "room-test",
    getMetadata: async () => state.meta,
    setMetadata: async (m) => { Object.assign(state.meta, m); },
    onMetadataChange: on(subs.meta),
  },
  broadcast: { onMessage: on(subs.msg), sendMessage: async () => {} },
  action: { setHeight: async () => {} },
};
// The handles the test drives it through.
window.__stub = {
  state,
  setRole(role) { state.role = role; subs.player.forEach((cb) => cb({ role, name: "Tester" })); },
  setItems(items) { state.items = items; subs.items.forEach((cb) => cb(items)); },
  setMeta(meta) { state.meta = meta; subs.meta.forEach((cb) => cb(meta)); },
};
export default OBR;
`);

const ROOM_KEY = "com.thuknights.dnm-rolls/state";
const CHAR_KEY = "com.thuknights.dnm-obr/char";
// Served over http, not file://. Chromium refuses to load an ES module from
// file:// and reports it only to the console, so roller.js would never run and
// every assertion here would pass against an empty page. See serve.mjs.
const site = await serve(stageDir);
const url = site.origin + "/index.html";

// Real character codes, built by the real creator, so the panel parses what it would
// parse in a room rather than a hand-made snapshot.
const { JSDOM } = await import("jsdom");
async function makeCodes(names) {
  const raw = fs.readFileSync("out/dnm-cc/index.html", "utf8");
  const s = raw.indexOf('<script type="module">'), e = raw.indexOf("</script>", s);
  const dom = new JSDOM(raw.slice(0, s) + raw.slice(e + 9),
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://gsgrimoire.github.io/dnm-cc/" });
  const w = dom.window;
  await new Promise((r) => (w.document.readyState === "complete" ? r() : w.addEventListener("load", r)));
  const out = {};
  for (const name of names) {
    out[name] = w.eval(`(function(){
      var c = state.character = getDefaultCharacter();
      var arch = Object.keys(DM_DATA.archetypes)[0];
      c.name = ${JSON.stringify(name)};
      c.origin = Object.keys(DM_DATA.origins)[0];
      c.archetype = arch;
      c.temperament = Object.keys(DM_DATA.temperaments)[0];
      var a = DM_DATA.archetypes[arch];
      if (!a.forcedTalent) { var t = Object.keys(a.talents || {}); if (t.length) c.talent = t[0]; }
      c.finalized = true; normalizeEditableLists(); normalizeCurrentValues();
      if (!computeStats()) throw new Error('fixture does not compute');
      return buildCharacterCode();
    })()`);
  }
  return out;
}

const codes = await makeCodes(["Kesh", "Orrin", "Vee"]);
const token = (id, name) => ({ id, metadata: { [CHAR_KEY]: { v: 1, code: codes[name] } } });
const SCENE = [token("t1", "Vee"), token("t2", "Kesh"), token("t3", "Orrin")];

async function boot({ role = "GM", initiative = null, partyShared = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(({ r }) => { window.__wantRole = r; }, { r: role });
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!window.__stub);
  await page.evaluate(({ role: r, meta, key, items }) => {
    window.__stub.state.role = r;
    window.__stub.setItems(items);
    window.__stub.setMeta({ [key]: meta });
    window.__stub.setRole(r);
  }, { role, key: ROOM_KEY,
       meta: { v: 5, momentum: 0, threat: 0, log: [],
               epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 },
               compAt: 20, bonds: [], initiative, partyShared },
       items: SCENE });
  await page.waitForTimeout(250);
  return { page, errors };
}

const readPanel = (page) => page.evaluate(() => {
  const panel = document.getElementById("party-panel");
  const rows = [...document.querySelectorAll("#party-list .party-row")].map((li) => ({
    name: (li.querySelector(".party-name") || {}).textContent || "",
    isLink: !!li.querySelector(".party-name.is-link"),
    isNpc: !!li.querySelector(".party-name.is-npc"),
    acted: li.classList.contains("is-acted"),
    hasSpirit: !!li.querySelector(".party-spirit"),
    hasBadge: !!li.querySelector(".party-status"),
    hasArrows: !!li.querySelector(".init-move"),
    hasHidden: !!li.querySelector(".init-hidden-mark"),
    buttons: [...li.querySelectorAll(".party-row-actions button")].map((b) => b.textContent),
  }));
  return {
    hidden: panel.hidden,
    rows,
    nameCount: document.querySelectorAll(".party-name").length,
    round: (document.getElementById("init-round") || {}).textContent || "",
    roundHidden: (document.getElementById("init-round") || {}).hidden,
    nextHidden: (document.getElementById("init-next") || {}).hidden,
    nextReady: (document.getElementById("init-next") || {}).classList?.contains("ready"),
    addHidden: (document.getElementById("init-add-row") || {}).hidden,
    backupHidden: (document.getElementById("party-backup") || {}).hidden,
    shareHidden: (document.getElementById("party-share") || {}).hidden,
    note: (document.getElementById("party-note") || {}).textContent || "",
  };
});

// -------------------------------------------------------------
// 1. No round running — the panel it has always been.
// -------------------------------------------------------------
{
  const { page, errors } = await boot({ role: "GM" });
  const p = await readPanel(page);
  ok("GM, no round: the roller starts without throwing", errors.length === 0);
  if (errors.length) console.log("      " + errors[0]);
  ok("GM, no round: the panel is visible", p.hidden === false);
  ok(`GM, no round: one row per character (${p.rows.length})`, p.rows.length === 3);
  // Alphabetical, which is what it was before initiative existed.
  ok("GM, no round: sorted by name",
    p.rows.map((r) => r.name).join() === "Kesh,Orrin,Vee");
  ok("GM, no round: every name is a link to the sheet", p.rows.every((r) => r.isLink));
  ok("GM, no round: there is no Sheet button any more",
    p.rows.every((r) => !r.buttons.includes("Sheet")));
  ok("GM, no round: stats are drawn", p.rows.every((r) => r.hasSpirit));
  ok("GM, no round: the epoch badge is drawn", p.rows.every((r) => r.hasBadge));
  ok("GM, no round: no initiative controls", p.rows.every((r) => !r.hasArrows && !r.buttons.length));
  ok("GM, no round: the round controls are hidden",
    p.roundHidden === true && p.nextHidden === true && p.addHidden === true);
  await page.close();
}

// -------------------------------------------------------------
// 2. A round running — THE MERGE. One list, in order, adversaries included.
// -------------------------------------------------------------
const RUNNING = {
  round: 3,
  rows: [
    { id: "pc:vee", name: "Vee", kind: "pc", acted: true, hidden: false },
    { id: "npc:1", name: "Reaver", kind: "npc", acted: false, hidden: false },
    { id: "pc:kesh", name: "Kesh", kind: "pc", acted: false, hidden: false },
    { id: "npc:2", name: "", kind: "npc", acted: false, hidden: true },
  ],
};
{
  const { page, errors } = await boot({ role: "GM", initiative: RUNNING });
  const p = await readPanel(page);
  ok("GM, round: nothing throws", errors.length === 0);
  if (errors.length) console.log("      " + errors[0]);
  // Four in the order, plus Orrin who is in the scene but not in it.
  ok(`GM, round: the order plus the unordered (${p.rows.length})`, p.rows.length === 5);
  ok("GM, round: rows follow the ORDER, not the alphabet",
    p.rows.slice(0, 3).map((r) => r.name).join() === "Vee,Reaver,Kesh");
  ok("GM, round: a character not in the order comes last",
    p.rows[4].name === "Orrin");
  ok("GM, round: and is offered a way in", p.rows[4].buttons.includes("+ Order"));
  // THE POINT OF 1.4B. Three characters and two adversaries, five names, not ten.
  ok(`GM, round: each combatant appears exactly once (${p.nameCount})`, p.nameCount === 5);
  ok("GM, round: an adversary is drawn as one", p.rows[1].isNpc === true);
  ok("GM, round: an adversary has no Spirit", p.rows[1].hasSpirit === false);
  ok("GM, round: a character still has Spirit", p.rows[0].hasSpirit === true);
  // The badge answers a between-scenes question and is the longest thing on the row.
  ok("GM, round: the epoch badge steps aside", p.rows.every((r) => !r.hasBadge));
  ok("GM, round: the acted row is marked", p.rows[0].acted === true);
  ok("GM, round: and offers Undo", p.rows[0].buttons.includes("Undo"));
  ok("GM, round: an unacted row offers Acted", p.rows[2].buttons.includes("Acted"));
  ok("GM, round: the GM gets Hide and remove on ordered rows",
    p.rows[0].buttons.includes("Hide") && p.rows[0].buttons.includes("×"));
  ok("GM, round: ordered rows have arrows", p.rows.slice(0, 4).every((r) => r.hasArrows));
  ok("GM, round: the unordered row has none", p.rows[4].hasArrows === false);
  ok("GM, round: a hidden row is marked as such", p.rows[3].hasHidden === true);
  ok("GM, round: a hidden row reads Hidden without the GM's stored name",
    p.rows[3].name === "Hidden");
  ok("GM, round: the round number shows", p.round === "Round 3" && p.roundHidden === false);
  ok("GM, round: Next Round is offered", p.nextHidden === false);
  ok("GM, round: but not lit while three are still to act", p.nextReady === false);
  ok("GM, round: the add-adversary box is there", p.addHidden === false);
  ok("GM, round: the note counts who is left", /3 still to act/.test(p.note));
  await page.close();
}

// -------------------------------------------------------------
// 3. Everyone has acted — the button lights, and only lights.
// -------------------------------------------------------------
{
  const allActed = { round: 4, rows: RUNNING.rows.map((r) => ({ ...r, acted: true })) };
  const { page } = await boot({ role: "GM", initiative: allActed });
  const p = await readPanel(page);
  ok("GM, all acted: Next Round lights up", p.nextReady === true);
  ok("GM, all acted: it has not fired by itself", p.round === "Round 4");
  ok("GM, all acted: the note says so", /Everyone has acted/.test(p.note));
  await page.close();
}

// -------------------------------------------------------------
// 4. A player — sees the order, touches only their own row.
// -------------------------------------------------------------
{
  const { page, errors } = await boot({ role: "PLAYER", initiative: RUNNING });
  await page.evaluate(() => { document.getElementById("char-name").value = "Kesh"; });
  await page.evaluate(() => window.__stub.setItems(window.__stub.state.items));
  await page.waitForTimeout(150);
  const p = await readPanel(page);
  ok("player: nothing throws", errors.length === 0);
  if (errors.length) console.log("      " + errors[0]);
  ok("player: the panel is visible", p.hidden === false);
  // The hidden row was never sent a name, so there is nothing to draw.
  ok(`player: the hidden adversary is absent (${p.rows.length})`, p.rows.length === 4);
  ok("player: no hidden row leaks in", p.rows.every((r) => !r.hasHidden && r.name !== "Hidden"));
  ok("player: no arrows", p.rows.every((r) => !r.hasArrows));
  ok("player: no Hide or remove anywhere",
    p.rows.every((r) => !r.buttons.includes("Hide") && !r.buttons.includes("×")));
  ok("player: only their own row can be ticked",
    p.rows.filter((r) => r.buttons.includes("Acted") || r.buttons.includes("Undo")).length === 1);
  ok("player: and it is theirs",
    (p.rows.find((r) => r.buttons.length) || {}).name === "Kesh");
  ok("player: the GM's buttons are hidden", p.backupHidden === true && p.shareHidden === true);
  ok("player: Next Round is not offered", p.nextHidden === true);
  ok("player: nor the add-adversary box", p.addHidden === true);
  await page.close();
}

// -------------------------------------------------------------
// 5. Sharing off. Two different questions, and folding the panels made it easy to
//    answer them as one by mistake: seeing WHOSE TURN it is is not the same as
//    seeing the party's Spirit and injuries.
// -------------------------------------------------------------
{
  const { page } = await boot({ role: "PLAYER", initiative: RUNNING, partyShared: false });
  const p = await readPanel(page);
  ok("player, not shared, round running: the panel still opens", p.hidden === false);
  ok("player, not shared: they can see the order", p.rows.length === 4);
  ok("player, not shared: but no Spirit", p.rows.every((r) => !r.hasSpirit));
  ok("player, not shared: and no epoch badge", p.rows.every((r) => !r.hasBadge));
  await page.close();
}
{
  const { page } = await boot({ role: "PLAYER", initiative: null, partyShared: false });
  const p = await readPanel(page);
  ok("player, not shared, no round: the panel is hidden entirely", p.hidden === true);
  await page.close();
}
{
  const { page } = await boot({ role: "PLAYER", initiative: null, partyShared: true });
  const p = await readPanel(page);
  ok("player, shared, no round: the panel is visible", p.hidden === false);
  ok("player, shared, no round: with stats", p.rows.every((r) => r.hasSpirit));
  await page.close();
}

await browser.close();
await site.close();
fs.rmSync(stageDir, { recursive: true, force: true });
console.log(`\nrollerui: ${pass} passed, ${fail} failed`);
console.log(`
NOT covered here — the SDK is a stub, so this is the panel's logic, not Owlbear:
  · whether a broadcast is delivered, and the GM's background page relaying it
  · room metadata round trips and the 16 kB budget in a live room
  · that a hidden name is truly absent from a PLAYER's room metadata — the unit
    test asserts it on the state, but only a live room proves the round trip
`);
process.exit(fail ? 1 : 0);
