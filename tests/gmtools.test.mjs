// =============================================================
// gmtools.test.mjs — the GM tools, run for real in a browser (extension 1.5)
// -------------------------------------------------------------
// The same arrangement rollerui.test.mjs uses: a staged copy of the extension with the
// vendored SDK swapped for a stub, served over http (Chromium will not load an ES module
// from file://, and says so only to the console). What this suite adds is a stand-in for
// the GM's background page: every broadcast the page sends is run through the REAL
// reducer from dnm.js and written back as room metadata, so a press reaches the room and
// comes back the way it would at the table. Without that, the assertions would only ever
// see what the page sent, never what the room ended up holding.
//
// Written to the things that are easy to get wrong and costly when they are:
//
//   * nothing reaches the table without the second press
//   * a spend's REASON never leaves the GM's browser
//   * the costs are the book's
//   * the roster's names and stats never go on a token
//   * a hidden NPC goes into the order without its name ever being sent
//   * tickers fire once per Next Round, on the GM's press, for the round that ended
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
  console.log("gmtools: SKIPPED — no browser available:", String(err.message).split("\n")[0]);
  process.exit(0);
}

const stageDir = path.resolve("out/gmtools-stub");
fs.rmSync(stageDir, { recursive: true, force: true });
fs.cpSync(path.resolve("out/dnm-obr"), stageDir, { recursive: true });
fs.writeFileSync(path.join(stageDir, "sdk.js"), `
const subs = { player: [], party: [], items: [], ready: [], meta: [], msg: [] };
const state = { role: "GM", items: [], meta: {}, selection: [] };
const sent = [];
const updates = [];
const popovers = [];
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
      // Runs the mutator over copies, the way Owlbear hands items to it, and records
      // the result so the test can read exactly what would have been written.
      updateItems: async (ids, fn) => {
        const copies = state.items.filter((i) => ids.includes(i.id)).map((i) => structuredClone(i));
        fn(copies);
        updates.push(structuredClone(copies));
        state.items = state.items.map((i) => copies.find((c) => c.id === i.id) || i);
      },
    },
    onReadyChange: on(subs.ready),
  },
  room: {
    id: "room-gm",
    getMetadata: async () => state.meta,
    setMetadata: async (m) => { Object.assign(state.meta, m); },
    onMetadataChange: on(subs.meta),
  },
  broadcast: { onMessage: on(subs.msg), sendMessage: async (channel, ev) => { sent.push(structuredClone(ev)); } },
  action: { setHeight: async () => {} },
  popover: {
    open: async (p) => { popovers.push({ op: "open", ...p }); },
    close: async (id) => { popovers.push({ op: "close", id }); },
    setWidth: async () => {}, setHeight: async () => {},
  },
  viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
};
window.__stub = {
  state, sent, updates, popovers,
  setRole(role) { state.role = role; subs.player.forEach((cb) => cb({ role, name: "Tester" })); },
  setItems(items) { state.items = items; subs.items.forEach((cb) => cb(items)); },
  setMeta(meta) { state.meta = meta; subs.meta.forEach((cb) => cb(meta)); },
  setSelection(ids) { state.selection = ids; subs.player.forEach((cb) => cb({ role: state.role, name: "Tester" })); },
};
export default OBR;
`);

const ROOM_KEY = "com.thuknights.dnm-rolls/state";
const CHAR_KEY = "com.thuknights.dnm-obr/char";
const NPC_KEY = "com.thuknights.dnm-obr/npc";
const site = await serve(stageDir);
const url = site.origin + "/index.html";

// Real codes from the real creator, as rollerui.test.mjs builds them.
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
const SCENE = [token("t1", "Vee"), token("t2", "Kesh"), token("t3", "Orrin"), { id: "e1", metadata: {} }, { id: "e2", metadata: {} }];

const META = (extra = {}) => ({
  v: 6, momentum: 5, threat: 10, log: [],
  epochs: { scene: 3, session: 1, adventure: 1, breather: 0, break: 0, bed: 0 },
  compAt: 20, bonds: [], initiative: null, partyShared: true, ...extra,
});

async function boot({ role = "GM", meta = META(), open = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every section open, so the suite can reach every button without clicking summaries.
  await page.addInitScript((o) => {
    localStorage.clear();
    if (o) localStorage.setItem("com.thuknights.dnm-obr/gm-ui", JSON.stringify({ open: o }));
  }, open || { tickers: true, gain: true, spend: true, hazard: true, setup: true, npcs: true, log: true, ref: true });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__stub);
  await page.evaluate(({ role: r, meta: m, key, items }) => {
    window.__stub.state.role = r;
    window.__stub.setItems(items);
    window.__stub.setMeta({ [key]: m });
    window.__stub.setRole(r);
  }, { role, meta, key: ROOM_KEY, items: SCENE });
  await page.waitForTimeout(300);
  return { page, errors };
}

// The background page, played by the test: run what was sent through the real reducer
// and hand the result back as room metadata.
async function settle(page) {
  await page.waitForTimeout(80);
  await page.evaluate(async (key) => {
    const m = await import("/dnm.js");
    const stub = window.__stub;
    stub.__applied = stub.__applied || 0;
    let state = stub.state.meta[key];
    while (stub.__applied < stub.sent.length) {
      state = m.trimState(m.applyEvent(state, stub.sent[stub.__applied]));
      stub.__applied++;
    }
    stub.setMeta({ ...stub.state.meta, [key]: state });
  }, ROOM_KEY);
  await page.waitForTimeout(120);
}

const sentSince = (page, from) => page.evaluate((f) => window.__stub.sent.slice(f), from);
const sentCount = (page) => page.evaluate(() => window.__stub.sent.length);
const roomState = (page) => page.evaluate((k) => window.__stub.state.meta[k], ROOM_KEY);
const gmLog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/gmlog/room-gm") || "[]"));

// Finds a GM tools button by the start of its label, inside the inline panel.
async function press(page, startsWith, times = 2) {
  for (let i = 0; i < times; i++) {
    const found = await page.evaluate((s) => {
      const b = [...document.querySelectorAll("#gm-tools button")].find((x) => x.textContent.trim().startsWith(s) && !x.disabled);
      if (!b) return null;
      b.click();
      return b.textContent;
    }, startsWith);
    if (found === null) return false;
    // After the first press the label is the confirm prompt, so find it by that.
    if (i === 0 && times > 1) {
      startsWith = await page.evaluate(() => (document.querySelector("#gm-tools .armed") || {}).textContent || "");
      if (!startsWith) return false;
    }
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);
  return true;
}

// -------------------------------------------------------------
// 1. Who sees it
// -------------------------------------------------------------
{
  const { page, errors } = await boot({ role: "GM" });
  ok("GM: the roller starts without throwing", errors.length === 0);
  if (errors.length) console.log("      " + errors.join("\n      "));
  const r = await page.evaluate(() => ({
    hidden: document.getElementById("gm-tools").hidden,
    head: !!document.querySelector("#gm-tools .gmt-head"),
    sections: [...document.querySelectorAll("#gm-tools .gm-sec")].map((d) => d.dataset.sec),
    threat: (document.querySelector("#gm-tools .gmt-threat-value") || {}).textContent,
  }));
  ok("GM: the tools are shown", r.hidden === false && r.head);
  ok(`GM: every section is drawn (${r.sections.join(",")})`, ["tickers", "gain", "spend", "hazard", "setup", "npcs", "ref"].every((k) => r.sections.includes(k)));
  ok("GM: the private log section belongs to the pop-out only", !r.sections.includes("log"));
  ok("GM: the header reads the room's Threat", r.threat === "10");
  await page.close();
}
{
  const { page, errors } = await boot({ role: "PLAYER" });
  ok("player: starts without throwing", errors.length === 0);
  const r = await page.evaluate(() => ({ hidden: document.getElementById("gm-tools").hidden, kids: document.getElementById("gm-tools").childElementCount }));
  ok("player: the GM tools are hidden and empty", r.hidden === true && r.kids === 0);
  await page.close();
}

// -------------------------------------------------------------
// 2. Gains: confirm first, then logged BY NAME
// -------------------------------------------------------------
{
  const { page } = await boot();
  const before = await sentCount(page);
  await press(page, "Escalation", 1);
  ok("one press arms and sends nothing", (await sentCount(page)) === before);
  const armed = await page.evaluate(() => (document.querySelector("#gm-tools .armed") || {}).textContent);
  ok(`the armed button says what it will do (${armed})`, armed === "Add 1?");
  await page.waitForTimeout(4300);
  const lapsed = await page.evaluate(() => !document.querySelector("#gm-tools .armed"));
  ok("an armed button lapses after four seconds", lapsed);
  ok("and still nothing was sent", (await sentCount(page)) === before);

  await press(page, "Escalation");
  const out = await sentSince(page, before);
  const pool = out.find((e) => e.type === "pool");
  const action = out.find((e) => e.type === "action");
  ok("two presses add 1 Threat", pool && pool.pool === "threat" && pool.delta === 1);
  ok("the table's log names the gain", action && action.entry.label === "Escalation" && action.entry.delta === 1);
  await settle(page);
  ok("the room's Threat moved", (await roomState(page)).threat === 11);
  const log = await gmLog(page);
  ok("the GM's log has its own line, shadowing the public one", log[0] && log[0].shadows === action.entry.id);

  // A stepper gain uses the chosen amount.
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll("#gm-tools .gmt-cell")].find((c) => c.textContent.startsWith("Adversary Momentum to Threat"));
    const plus = [...cell.querySelectorAll(".gm-step")].find((b) => b.textContent === "+");
    plus.click(); plus.click();
  });
  const b2 = await sentCount(page);
  await press(page, "Adversary Momentum to Threat");
  const p2 = (await sentSince(page, b2)).find((e) => e.type === "pool");
  ok("a stepper gain sends the chosen amount (3)", p2 && p2.delta === 3);

  // The tooltip carries the book's words and the page.
  await page.hover("#gm-tools .gmt-gain");
  const t = await page.evaluate(() => {
    const tip = document.querySelector(".gm-tip");
    return tip && !tip.hidden ? tip.textContent : "";
  });
  ok("hovering a rule shows the book's wording", t.includes("risk Escalation"));
  ok("and the page it is on", t.includes("GM Guide p.112"));
  await page.close();
}

// -------------------------------------------------------------
// 3. Spends: the reason stays in the GM's browser
// -------------------------------------------------------------
{
  const { page } = await boot();
  const before = await sentCount(page);
  await press(page, "Reveal");
  const out = await sentSince(page, before);
  const pool = out.find((e) => e.type === "pool");
  const action = out.find((e) => e.type === "action");
  ok("Reveal costs 4 (GM Guide p.115)", pool && pool.delta === -4);
  ok("the table's line says only that Threat was spent", action && action.entry.label === "Threat spent");
  ok("nothing sent mentions the Reveal", !JSON.stringify(out).includes("Reveal"));
  const drive = out.find((e) => e.type === "bond" && e.effect.kind === "drive");
  const adv = out.find((e) => e.type === "bond" && e.effect.kind === "adversity");
  ok("a spend of 4 sets off the Maverick drive", !!drive && drive.effect.amount === 4);
  ok("and adversity Growth, for the characters in the scene", !!adv && adv.effect.targets.slice().sort().join(",") === "Kesh,Orrin,Vee");
  const log = await gmLog(page);
  ok("the GM's own line keeps the reason", log[0] && log[0].label === "Reveal");
  ok("and says what the spend set off", /Maverick/.test(log[0].detail) && /Growth/.test(log[0].detail));

  await settle(page);
  // In the roller's feed the private line replaces the public one for the GM.
  const feed = await page.evaluate(() => [...document.querySelectorAll("#log .entry-action")].map((li) => ({
    text: li.textContent, gm: li.classList.contains("is-gm"),
  })));
  ok("the GM's feed shows the reason", feed.some((f) => f.gm && f.text.includes("Reveal")));
  ok("and not the public twin as well", !feed.some((f) => !f.gm && f.text.includes("Threat spent")));

  // Reinforcements: a group costs half, rounded up.
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll("#gm-tools .gmt-cell")].find((c) => c.textContent.startsWith("Reinforcements"));
    const plus = [...cell.querySelectorAll(".gm-step")].find((b) => b.textContent === "+");
    for (let i = 0; i < 3; i++) plus.click(); // 2 -> 5
  });
  const cost = await page.evaluate(() => [...document.querySelectorAll("#gm-tools .gmt-cell")].find((c) => c.textContent.startsWith("Reinforcements")).querySelector(".gmt-cost").textContent);
  ok(`five as a group cost 3 (${cost})`, cost === "= 3");

  // Growth switched off: the drive still fires, Growth does not.
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("#gm-tools .gmt-growth input")][0];
    box.click();
  });
  const b3 = await sentCount(page);
  await press(page, "Reveal");
  const out3 = await sentSince(page, b3);
  ok("with Growth switched off, no adversity effect", !out3.some((e) => e.type === "bond" && e.effect.kind === "adversity"));
  ok("but the drive still fires", out3.some((e) => e.type === "bond" && e.effect.kind === "drive"));

  // A spend under 3 sets off nothing.
  const b4 = await sentCount(page);
  await press(page, "Create a Complication");
  ok("a spend of 2 sets off nothing", !(await sentSince(page, b4)).some((e) => e.type === "bond"));

  // Undo takes back the last press.
  const b5 = await sentCount(page);
  await press(page, "Undo");
  const u = (await sentSince(page, b5)).find((e) => e.type === "pool");
  ok("Undo gives back the last spend", u && u.delta === 2);
  await page.close();
}

// -------------------------------------------------------------
// 4. Tickers and Next Round
// -------------------------------------------------------------
{
  const init = { round: 2, rows: [{ id: "pc:kesh", name: "Kesh", kind: "pc", acted: true, hidden: false }] };
  const { page } = await boot({ meta: META({ initiative: init }) });
  // Two tickers: one public at 2, one hidden at 1.
  await page.evaluate(() => {
    const add = [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "Add ticker");
    add.click();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const add = [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "Add ticker");
    add.click();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const rows = document.querySelectorAll("#gm-tools .gmt-ticker");
    const plus = [...rows[0].querySelectorAll(".gm-step")].find((b) => b.textContent === "+");
    plus.click();
    rows[0].querySelector(".gmt-eye").click();
  });
  await page.waitForTimeout(120);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/tickers/room-gm")));
  ok("two tickers are stored", stored.length === 2);
  ok("the first is public at 2", stored[0].amount === 2 && stored[0].visible === true);
  ok("the second is hidden at 1", stored[1].amount === 1 && stored[1].visible === false);

  // The roller's own render picks the total up on its next pass; a room change gives it
  // one.
  await settle(page);
  const label = await page.evaluate(() => document.getElementById("init-next").textContent);
  ok(`Next Round says what it will add (${label})`, label === "Next Round (+3)");

  const before = await sentCount(page);
  await page.click("#init-next");
  await page.waitForTimeout(80);
  ok("Next Round with tickers asks first", (await sentCount(page)) === before);
  ok("and says how much", (await page.evaluate(() => document.getElementById("init-next").textContent)) === "Confirm +3 Threat?");
  await page.click("#init-next");
  await page.waitForTimeout(300);
  const out = await sentSince(page, before);
  ok("the second press advances the round", out.some((e) => e.type === "init" && e.action === "next"));
  const pools = out.filter((e) => e.type === "pool");
  ok("one pool change per ticker", pools.length === 2 && pools[0].delta === 2 && pools[1].delta === 1);
  const lines = out.filter((e) => e.type === "action").map((e) => e.entry);
  ok("the public ticker is named in the table's log", lines.some((l) => l.label === "Ticking clock" && l.detail === "Round 2 ended: +2 Threat"));
  ok("the hidden one reads only \"Threat rises\"", lines.some((l) => l.label === "Threat rises" && l.detail === "Round 2 ended: +1 Threat"));
  await settle(page);
  ok("the room gained 3", (await roomState(page)).threat === 13);

  // End Scene clears unpinned tickers.
  await page.evaluate(() => {
    const row = document.querySelectorAll("#gm-tools .gmt-ticker")[1];
    row.querySelector(".gmt-pin").click();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const b = document.querySelector('#gm-panel [data-epoch="scene"]');
    b.click(); b.click();
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/tickers/room-gm")));
  ok("End Scene keeps only the pinned ticker", after.length === 1 && after[0].pinned === true);
  await page.close();
}

// -------------------------------------------------------------
// 5. Rushed
// -------------------------------------------------------------
{
  const { page } = await boot();
  const before = await sentCount(page);
  await press(page, "End Scene, rushed");
  const out = await sentSince(page, before);
  const types = out.map((e) => e.type + (e.pool ? ":" + e.pool : ""));
  ok("rushed ends the scene first", out[0].type === "epoch" && out[0].boundary === "scene");
  ok("costs the usual 1 Momentum for the scene", out.some((e) => e.type === "pool" && e.pool === "momentum" && e.delta === -1));
  ok("and 2 Threat", out.some((e) => e.type === "pool" && e.pool === "threat" && e.delta === -2));
  ok("and sets the rush last", types[types.length - 1] === "rush");
  await settle(page);
  const st = await roomState(page);
  ok("the room records the rush against the new scene", st.rushed && st.rushed.scene === 4);
  const ui = await page.evaluate(() => ({
    rests: [...document.querySelectorAll('#gm-panel [data-epoch]')].filter((b) => ["breather", "break", "bed"].includes(b.dataset.epoch)).map((b) => b.disabled),
    scene: document.querySelector('#gm-panel [data-epoch="scene"]').disabled,
    badge: !document.getElementById("rushed-badge").hidden,
    banner: !!document.querySelector("#gm-tools .gmt-banner.is-rushed"),
  }));
  ok("all three rests are greyed in Table Controls", ui.rests.length === 3 && ui.rests.every(Boolean));
  ok("End Scene is not", ui.scene === false);
  ok("the Rushed badge is lit", ui.badge);
  ok("and the GM tools say so", ui.banner);

  // The next End Scene lifts it, with nothing to clear.
  await page.evaluate(() => { const b = document.querySelector('#gm-panel [data-epoch="scene"]'); b.click(); b.click(); });
  await page.waitForTimeout(300);
  await settle(page);
  const lifted = await page.evaluate(() => [...document.querySelectorAll('#gm-panel [data-epoch]')].filter((b) => b.dataset.epoch === "bed").every((b) => !b.disabled));
  ok("the next End Scene lifts the rush", lifted);
  await page.close();
}

// -------------------------------------------------------------
// 6. Reversal: once per adventure, half Spirit to the characters present
// -------------------------------------------------------------
{
  const { page } = await boot();
  const before = await sentCount(page);
  await press(page, "Reversal");
  const out = await sentSince(page, before);
  const pool = out.find((e) => e.type === "pool" && e.pool === "threat");
  ok("Reversal costs 2 per character present (3 on tokens, so 6)", pool && pool.delta === -6);
  const rev = out.find((e) => e.type === "bond" && e.effect.kind === "reversal");
  ok("it queues half-Spirit for the characters present", rev && rev.effect.targets.length === 3);
  ok("and ends the scene", out.some((e) => e.type === "epoch" && e.boundary === "scene"));
  await settle(page);
  const used = await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent.startsWith("Reversal")));
  const label = await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent.startsWith("Reversal")).textContent);
  ok(`it is spent for the adventure (${label})`, label.includes("used this adventure"));
  // New Adventure gives it back.
  await page.evaluate(() => { const b = document.querySelector('#gm-panel [data-epoch="adventure"]'); b.click(); b.click(); });
  await page.waitForTimeout(300);
  await settle(page);
  const again = await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent.startsWith("Reversal")).textContent);
  ok("New Adventure makes it available again", again === "Reversal");
  await page.close();
}

// -------------------------------------------------------------
// 7. Starting Threat and the hazard builder
// -------------------------------------------------------------
{
  const { page } = await boot();
  // High stakes, three characters on tokens: 9.
  await page.evaluate(() => [...document.querySelectorAll("#gm-tools .gmt-stakes button")].find((b) => b.textContent.startsWith("High")).click());
  const before = await sentCount(page);
  await press(page, "Set Threat to this");
  const p = (await sentSince(page, before)).find((e) => e.type === "pool");
  ok("High stakes for 3 characters sets Threat to 9 (from 10: −1)", p && p.delta === -1);
  ok("setting the start never counts as adversity", !(await sentSince(page, before)).some((e) => e.type === "bond"));

  // Hazard: +2 damage, Blast, Breaker = 1 + 2 + 2 + 1 = 6.
  await page.evaluate(() => {
    const hz = document.querySelector("#gm-tools .gmt-hazard");
    const steppers = hz.querySelectorAll(".gm-stepper");
    const plus = [...steppers[0].querySelectorAll(".gm-step")].find((b) => b.textContent === "+");
    plus.click(); plus.click();
    [...hz.querySelectorAll(".gmt-check")].forEach((l) => { if (/Blast|Breaker/.test(l.textContent)) l.querySelector("input").click(); });
    const name = hz.querySelector(".gmt-hazard-name");
    name.value = "Burning"; name.dispatchEvent(new Event("input"));
  });
  const res = await page.evaluate(() => document.querySelector("#gm-tools .gmt-hazard-result").textContent);
  ok(`the hazard reads back what it is (${res})`, res === "Burning 4, Breaker, Blast, avoid at D2 — 6 Threat");
  const b2 = await sentCount(page);
  await press(page, "Spend on this hazard");
  const out = await sentSince(page, b2);
  ok("the hazard spends 6", out.some((e) => e.type === "pool" && e.delta === -6));
  ok("and its description stays private", !JSON.stringify(out).includes("Burning"));
  await page.close();
}

// -------------------------------------------------------------
// 8. NPCs: into the fight hidden, revealed, tokens
// -------------------------------------------------------------
{
  const { page } = await boot();
  const roster = await page.evaluate(() => [...document.querySelectorAll("#gm-tools .gmt-npc-name")].map((b) => b.textContent));
  ok(`the samples are listed (${roster.join(", ")})`, roster.includes("Raider") && roster.includes("Raider captain"));
  ok("and marked as samples", await page.evaluate(() => document.querySelectorAll("#gm-tools .gmt-tag.is-sample").length === 4));

  // Three Raiders into a fight that is not running yet.
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll("#gm-tools .gmt-npc-wrap")].find((w) => w.querySelector(".gmt-npc-name").textContent === "Raider");
    const plus = [...wrap.querySelectorAll(".gm-step")].find((b) => b.textContent === "+");
    plus.click(); plus.click();
    wrap.setAttribute("data-test", "raider");
  });
  const before = await sentCount(page);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-test="raider"] button')].find((x) => x.textContent === "Into fight"); b.click(); b.click(); });
  await page.waitForTimeout(400);
  const out = await sentSince(page, before);
  ok("with no round running, it starts one", out[0] && out[0].type === "init" && out[0].action === "start");
  const add = out.find((e) => e.type === "init" && e.action === "add" && e.kind === "npc");
  ok("the NPC row goes in hidden", add && add.hidden === true);
  ok("with no name", add && add.name === "");
  ok("and nothing sent anywhere carries the name", !JSON.stringify(out).includes("Raider"));
  const names = await page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/initnames/room-gm") || "{}"));
  ok("the GM's browser holds the name for the party panel", names[add.id] === "Raider ×3");
  await settle(page);
  const party = await page.evaluate(() => [...document.querySelectorAll("#party-list .party-name")].map((n) => n.textContent));
  ok("the party panel names it for the GM", party.includes("Raider ×3"));
  const fight = await page.evaluate(() => [...document.querySelectorAll("#gm-tools .gmt-fighter-name")].map((n) => n.textContent));
  ok("the fight list has it", fight.includes("Raider ×3"));

  // Arrives as reinforcements: a group of 3 costs 2.
  const b2 = await sentCount(page);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#gm-tools .gmt-fighter button")].find((x) => x.textContent === "Arrives"); b.click(); });
  await page.waitForTimeout(60);
  await page.evaluate(() => { document.querySelector("#gm-tools .gmt-fighter .armed").click(); });
  await page.waitForTimeout(300);
  const out2 = await sentSince(page, b2);
  const hide = out2.find((e) => e.type === "init" && e.action === "hide");
  ok("revealing publishes the name", hide && hide.hidden === false && hide.name === "Raider ×3");
  ok("arriving as a group of 3 costs 2 (half, rounded up)", out2.some((e) => e.type === "pool" && e.delta === -2));

  // The drone has Menacing 1: revealing it adds 1.
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll("#gm-tools .gmt-npc-wrap")].find((w) => w.querySelector(".gmt-npc-name").textContent === "Sentry drone");
    const b = [...wrap.querySelectorAll("button")].find((x) => x.textContent === "Into fight"); b.click(); b.click();
  });
  await page.waitForTimeout(300);
  await settle(page);
  const b3 = await sentCount(page);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#gm-tools .gmt-fighter")].find((r) => r.textContent.includes("Sentry drone"));
    const b = [...row.querySelectorAll("button")].find((x) => x.textContent === "Reveal"); b.click(); b.click();
  });
  await page.waitForTimeout(300);
  const out3 = await sentSince(page, b3);
  ok("a Menacing 1 NPC adds 1 Threat when revealed", out3.some((e) => e.type === "pool" && e.delta === 1));
  ok("logged as Menacing", out3.some((e) => e.type === "action" && e.entry.label === "Menacing"));

  // Attaching to a token writes the id and nothing else.
  await page.evaluate(() => window.__stub.setSelection(["e1"]));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll("#gm-tools .gmt-npc-wrap")].find((w) => w.querySelector(".gmt-npc-name").textContent === "Raider captain");
    const b = [...wrap.querySelectorAll("button")].find((x) => x.textContent === "Token"); b.click(); b.click();
  });
  await page.waitForTimeout(300);
  const written = await page.evaluate((k) => window.__stub.updates.at(-1), NPC_KEY);
  const meta = written && written[0] && written[0].metadata[NPC_KEY];
  ok("the token gets the NPC key", !!meta && meta.id === "sample-captain");
  ok("and nothing but an id", meta && Object.keys(meta).sort().join(",") === "id,v");
  ok("no name or stats on the token", !JSON.stringify(written).includes("Raider") && !JSON.stringify(written).includes("cleaver"));

  // A token with a character on it is refused.
  await page.evaluate(() => window.__stub.setSelection(["t1"]));
  await page.waitForTimeout(100);
  const u0 = await page.evaluate(() => window.__stub.updates.length);
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll("#gm-tools .gmt-npc-wrap")].find((w) => w.querySelector(".gmt-npc-name").textContent === "Raider");
    const b = [...wrap.querySelectorAll("button")].find((x) => x.textContent === "Token"); b.click(); b.click();
  });
  await page.waitForTimeout(300);
  ok("a token carrying a character is never given an NPC", (await page.evaluate(() => window.__stub.updates.length)) === u0);

  // Selecting the NPC's token fills the roller (GM only).
  await page.evaluate(() => window.__stub.setSelection(["e1"]));
  await page.waitForTimeout(250);
  const fill = await page.evaluate(() => {
    document.getElementById("attr-key").value = "might";
    document.getElementById("attr-key").dispatchEvent(new Event("change"));
    document.getElementById("skill-key").value = "fight";
    document.getElementById("skill-key").dispatchEvent(new Event("change"));
    return {
      banner: document.getElementById("char-banner").textContent,
      name: document.getElementById("char-name").value,
      a: document.getElementById("attr-val").value,
      s: document.getElementById("skill-val").value,
    };
  });
  ok("selecting the NPC token puts its name in the roller", fill.name === "Raider captain");
  ok(`and a Major NPC fills Might + Fight (${fill.a}/${fill.s})`, fill.a === "11" && fill.s === "3");
  await page.close();
}

// A Normal NPC fills from its Truth pair, and the banner switches to Default.
{
  const { page } = await boot();
  await page.evaluate(() => window.__stub.state.items.find((i) => i.id === "e2").metadata["com.thuknights.dnm-obr/npc"] = { v: 1, id: "sample-raider" });
  await page.evaluate(() => window.__stub.setSelection(["e2"]));
  await page.waitForTimeout(250);
  const a = await page.evaluate(() => [document.getElementById("attr-val").value, document.getElementById("skill-val").value].join("/"));
  ok(`a Normal NPC fills its Truth pair (${a})`, a === "10/2");
  await page.evaluate(() => [...document.querySelectorAll(".npc-mode-btn")].find((b) => b.textContent.startsWith("Default")).click());
  await page.waitForTimeout(100);
  const d = await page.evaluate(() => [document.getElementById("attr-val").value, document.getElementById("skill-val").value].join("/"));
  ok(`and its Default pair on request (${d})`, d === "8/1");
  await page.close();
}

// A player selecting the same token gets nothing.
{
  const { page } = await boot({ role: "PLAYER" });
  await page.evaluate(() => window.__stub.state.items.find((i) => i.id === "e2").metadata["com.thuknights.dnm-obr/npc"] = { v: 1, id: "sample-raider" });
  await page.evaluate(() => window.__stub.setSelection(["e2"]));
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({ banner: document.getElementById("char-banner").hidden, name: document.getElementById("char-name").value }));
  ok("a player selecting an NPC token gets no banner", r.banner === true);
  ok("and no name", r.name !== "Raider");
  await page.close();
}

// -------------------------------------------------------------
// 9. Custom stat blocks, import and hostile text
// -------------------------------------------------------------
{
  const { page, errors } = await boot();
  await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "New stat block").click());
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const ed = document.querySelector("#gm-tools .gmt-editor");
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); };
    const fields = [...ed.querySelectorAll(".gmt-field")];
    const by = (t) => fields.find((f) => f.textContent.startsWith(t)).querySelector("input,textarea");
    set(by("Name"), "Bog lurker");
    set(by("Truth"), "Ambusher in the reeds");
    set(by("Truth attribute"), "12");
    set(by("Menacing"), "2");
    set(by("Weapons"), "Claws | Melee | 3 | Breaker");
    [...ed.querySelectorAll("button")].find((b) => b.textContent === "Save").click();
  });
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/roster")).find((n) => n.name === "Bog lurker"));
  ok("a new stat block is saved to the roster", !!saved);
  ok("with its numbers", saved && saved.main.attr === 12 && saved.menacing === 2);
  ok("and its weapon parsed from the line", saved && saved.weapons[0].name === "Claws" && saved.weapons[0].qualities === "Breaker");
  ok("it is not a sample", saved && saved.sample === false);

  // Import a hostile roster: the name must come out as text.
  const evil = `Dreams & Machines — NPC roster\n${JSON.stringify([{ id: "x1", name: "<img src=x onerror=window.__pwned=1>", kind: "normal", truth: "<b>bold</b>", sample: true }])}`;
  await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "Import").click());
  await page.waitForTimeout(80);
  await page.evaluate((t) => {
    const ta = document.querySelector("#gm-tools textarea");
    ta.value = t; ta.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "Add these to the roster").click();
  }, evil);
  await page.waitForTimeout(200);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#gm-tools .gmt-npc-name")].find((x) => x.textContent.startsWith("<img")); b && b.click(); });
  await page.waitForTimeout(150);
  const xss = await page.evaluate(() => ({
    img: document.querySelectorAll("#gm-tools img").length,
    b: document.querySelectorAll("#gm-tools .gmt-statblock b").length,
    pwned: !!window.__pwned,
    shown: [...document.querySelectorAll("#gm-tools .gmt-npc-name")].some((x) => x.textContent.startsWith("<img")),
  }));
  ok("an imported name is drawn as text", xss.shown && xss.img === 0 && !xss.pwned);
  ok("an imported Truth is drawn as text", xss.b === 0 || await page.evaluate(() => ![...document.querySelectorAll("#gm-tools .gmt-statblock b")].some((b) => b.textContent === "bold")));
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem("com.thuknights.dnm-obr/roster")).find((n) => n.id === "x1"));
  ok("an imported entry cannot claim to be a sample", imported && imported.sample === false);
  ok("no page errors through the editor and import", errors.length === 0);
  if (errors.length) console.log("      " + errors.join("\n      "));
  await page.close();
}

// -------------------------------------------------------------
// 10. Popping out
// -------------------------------------------------------------
{
  const { page } = await boot();
  await page.evaluate(() => [...document.querySelectorAll("#gm-tools button")].find((b) => b.textContent === "Pop out").click());
  await page.waitForTimeout(200);
  const pop = await page.evaluate(() => window.__stub.popovers.at(-1));
  ok("Pop out opens the GM popover", pop && pop.op === "open" && pop.id === "com.thuknights.dnm-obr/gm-panel");
  ok("at its own page", pop && /gm\.html$/.test(pop.url));
  ok("docked on the left by default", pop && pop.transformOrigin.horizontal === "LEFT");
  ok("and it cannot be clicked away", pop && pop.disableClickAway === true);
  const inline = await page.evaluate(() => ({
    back: !!document.querySelector("#gm-tools .gmt-back"),
    sections: document.querySelectorAll("#gm-tools .gm-sec").length,
  }));
  ok("the roller folds its copy away", inline.back && inline.sections === 0);
  await page.evaluate(() => document.querySelector("#gm-tools .gmt-back").click());
  await page.waitForTimeout(200);
  ok("Bring back closes the popover", await page.evaluate(() => window.__stub.popovers.at(-1).op === "close"));
  ok("and draws the tools here again", await page.evaluate(() => document.querySelectorAll("#gm-tools .gm-sec").length > 0));
  await page.close();
}

// The pop-out page itself boots.
{
  const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(site.origin + "/gm.html");
  await page.waitForFunction(() => !!window.__stub);
  await page.evaluate(({ key, m, items }) => { window.__stub.setItems(items); window.__stub.setMeta({ [key]: m }); }, { key: ROOM_KEY, m: META(), items: SCENE });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    pad: document.querySelectorAll("#gm-dock .obr-pad-cell").length,
    here: [...document.querySelectorAll("#gm-dock .obr-pad-cell")].findIndex((c) => c.getAttribute("aria-pressed") === "true"),
    tools: !!document.querySelector("#gm-tools .gmt-head"),
    log: !!document.querySelector('#gm-tools .gm-sec[data-sec="log"]'),
    handles: document.querySelectorAll(".obr-resize").length,
    popped: Number(localStorage.getItem("com.thuknights.dnm-obr/gm-popped")) > 0,
  }));
  ok("the pop-out starts without throwing", errors.length === 0);
  if (errors.length) console.log("      " + errors.join("\n      "));
  ok("it has the nine-cell position pad", r.pad === 9);
  ok("with the left anchor lit", r.here === 3);
  ok("it draws the GM tools", r.tools);
  ok("including the GM's own log", r.log);
  ok("a left-docked panel can be pulled on its right edge only (plus none on the window side)", r.handles >= 1);
  ok("it marks itself as popped out", r.popped);
  await page.evaluate(() => document.querySelectorAll("#gm-dock .obr-pad-cell")[2].click());
  await page.waitForTimeout(200);
  const moves = await page.evaluate(() => window.__stub.popovers.slice(-2).map((p) => p.op + ":" + (p.transformOrigin ? p.transformOrigin.horizontal + "/" + p.transformOrigin.vertical : "")));
  ok(`moving reopens it at the new anchor (${moves.join(" ")})`, moves[0].startsWith("close") && moves[1] === "open:RIGHT/TOP");
  await page.close();
}

// -------------------------------------------------------------
// 11. Nothing hangs off the edge at the widths the panel is read at
// -------------------------------------------------------------
// layout.test.mjs is the suite for this, but it does not run as the GM. The roller at
// 420px was the first casualty of 1.5: "Next Round (+3)" pushed Back up past the edge.
for (const width of [320, 420]) {
  const init = { round: 2, rows: [{ id: "npc:a", name: "", kind: "npc", acted: false, hidden: true }] };
  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("com.thuknights.dnm-obr/gm-ui", JSON.stringify({ open: { tickers: true, gain: true, spend: true, hazard: true, setup: true, npcs: true, ref: true } }));
    localStorage.setItem("com.thuknights.dnm-obr/tickers/room-gm", JSON.stringify([{ id: "a", name: "A very long ticker name that goes on", amount: 6, on: true }]));
    localStorage.setItem("com.thuknights.dnm-obr/fight/room-gm", JSON.stringify([{ rowId: "npc:a", npcId: "sample-captain", name: "Raider captain", count: 1, pt: 2 }]));
  });
  for (const file of ["index.html", "gm.html"]) {
    await page.goto(site.origin + "/" + file);
    await page.waitForFunction(() => !!window.__stub);
    await page.evaluate(({ key, m, items }) => { window.__stub.setItems(items); window.__stub.setMeta({ [key]: m }); window.__stub.setRole("GM"); },
      { key: ROOM_KEY, m: META({ initiative: init, rushed: { scene: 3 } }), items: SCENE });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((e) => !e.closest(".gm-tip") && e.getClientRects().length && e.getBoundingClientRect().right > window.innerWidth + 1)
      .map((e) => (e.className || e.tagName) + ":" + (e.textContent || "").trim().slice(0, 20)));
    ok(`${file} at ${width}px: nothing past the right edge${over.length ? " — " + over.slice(0, 4).join(" | ") : ""}`, over.length === 0);
  }
  await page.close();
}

await browser.close();
await site.close();
console.log(`gmtools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
