// =============================================================
// The docked sheet — creator v2.1 / extension 1.1
// -------------------------------------------------------------
// Replaces popout.test.mjs, which tested the BroadcastChannel relay that v2.0 deleted,
// and inherits its real job: the dock helpers exist TWICE — once exported from dnm.js
// for the extension, once copied into the creator's module block — for the same reason
// createPoolBatcher() does, and two copies drift. This compares them over a grid of
// inputs and fails if they disagree by so much as a pixel.
//
// The geometry is worth testing on its own because it encodes a constraint that is easy
// to forget and expensive to rediscover: PopoverApi has setWidth and setHeight but NO
// setPosition, and anchorPosition is read once at open. transformOrigin is what pins a
// panel to its anchor — one held by its RIGHT corner grows leftwards under setWidth, and
// one held by its left corner walks off the screen.
// =============================================================
import fs from "fs";
import { JSDOM } from "jsdom";
import * as ext from "../out/dnm-obr/dnm.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

// -------------------------------------------------------------
// Load the creator's copy
// -------------------------------------------------------------
// Same trick as embedded.test.mjs: the module block has no imports once the bundled SDK
// is removed, and the SDK is found by LINE LENGTH because two nearby comments quote it.
const raw = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");
const modStart = raw.indexOf('<script type="module">');
if (modStart < 0) { console.log("FATAL: module block marker not found"); process.exit(1); }
const modEnd = raw.indexOf("</script>", modStart);
const modSrc = raw.slice(modStart + '<script type="module">'.length, modEnd);
const html = raw.slice(0, modStart) + raw.slice(modEnd + "</script>".length);

const lines = modSrc.split("\n");
const sdkLine = lines.findIndex((l) => l.length > 2000);
ok("the bundled SDK line was found", sdkLine >= 0);
lines.splice(sdkLine, 1);
const body = lines.join("\n");

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://gsgrimoire.github.io/dnm-cc/" });
const w = dom.window;
await new Promise((r) => { if (w.document.readyState === "complete") r(); else w.addEventListener("load", r); });

// isAvailable false: this suite is about the pure helpers, and booting the embedded
// sheet here would only add noise. The functions are declarations, so they are reachable
// from w.eval even though the block's consts are not.
w.eval(`const OBR = { isAvailable: false };\n` + body);
const g = (code) => w.eval(code);

for (const fn of ["sheetPopover", "clampDock", "dockSize", "anchorParts", "resizeEdges", "readDock", "writeDock"]) {
  ok(`the creator carries its own ${fn}`, g(`typeof ${fn}`) === "function");
}

// -------------------------------------------------------------
// The two copies agree
// -------------------------------------------------------------
// Handed over as a JS LITERAL, not as JSON. JSON.stringify turns NaN into null, and
// Number(null) is 0 — which is finite, so it takes the clamp path while a real NaN takes
// the fallback path. An earlier version of this suite reported the two copies disagreeing
// because of exactly that, and they did not: the harness was lying about the input. A
// test run on the wrong shape is worse than no test.
const js = (v) => {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") return String(v);          // NaN and Infinity survive
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(js).join(",")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v).map(([k, val]) => `${JSON.stringify(k)}:${js(val)}`).join(",")}}`;
  }
  return JSON.stringify(v);
};

const anchors = ext.DOCK_ANCHORS.concat(["nonsense", undefined, null]);
const widths = [0, 319, 320, 560, 4000, 4001, 99999, -50, NaN, "560", null];
const heights = [0, 219, 220, 420, 4000, 4001, -5, NaN];
const zooms = [undefined, 0.5, 0.6, 1, 1.6, 1.7, NaN, "1.2", null];
const viewports = [
  { width: 1600, height: 900 },
  { width: 1280, height: 800 },
  { width: 600, height: 400 },
  { width: 0, height: 0 },
  null,
  { width: "1600", height: "900" },
];

let mismatches = 0, compared = 0;
for (const anchor of anchors) {
  for (const width of widths) {
    for (const height of heights) {
      for (const viewport of viewports) {
        const zoom = zooms[compared % zooms.length];
        const dock = { anchor, width, height, zoom };
        const mine = ext.sheetPopover({ url: "u", dock, viewport });
        const theirs = g(`sheetPopover(${js({ url: "u", dock, viewport })})`);
        compared++;
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          if (mismatches === 0) {
            console.log("  first mismatch for", JSON.stringify({ dock, viewport }));
            console.log("    dnm.js :", JSON.stringify(mine));
            console.log("    creator:", JSON.stringify(theirs));
          }
          mismatches++;
        }
      }
    }
  }
}
ok(`the two copies of sheetPopover agree on all ${compared} inputs`, mismatches === 0);

// clampDock carries the zoom, which sheetPopover never looks at — so the grid above
// cannot see a disagreement about it.
let zoomDrift = 0;
for (const zoom of zooms.concat([0, -1, 3, 1.05, 0.64])) {
  const mine = JSON.stringify(ext.clampDock({ anchor: "right", zoom }));
  const theirs = g(`JSON.stringify(clampDock(${js({ anchor: "right", zoom })}))`);
  if (mine !== theirs) zoomDrift++;
}
ok("the two copies clamp zoom the same way", zoomDrift === 0);

let edgeDrift = 0;
for (const anchor of anchors) {
  const mine = JSON.stringify(ext.resizeEdges(anchor));
  const theirs = g(`JSON.stringify(resizeEdges(${js(anchor)}))`);
  if (mine !== theirs) edgeDrift++;
}
ok("the two copies agree on which edges resize", edgeDrift === 0);

ok("the popover id is not the context menu id", ext.SHEET_POPOVER_ID === "com.thuknights.dnm-obr/sheet-panel");
ok("and the creator agrees on it", g(`sheetPopover({url:"u",dock:{},viewport:null}).id`) === ext.SHEET_POPOVER_ID);

// -------------------------------------------------------------
// Nine anchors, each pinned by the corner that faces its edge
// -------------------------------------------------------------
const V = { width: 1600, height: 900 };
const at = (anchor, dock = {}) => ext.sheetPopover({ url: "u", dock: { anchor, width: 560, height: 420, ...dock }, viewport: V });

ok("there are nine anchors", ext.DOCK_ANCHORS.length === 9);

const expected = {
  "top-left":     { pos: [0, 0],      origin: ["LEFT", "TOP"] },
  "top":          { pos: [800, 0],    origin: ["CENTER", "TOP"] },
  "top-right":    { pos: [1600, 0],   origin: ["RIGHT", "TOP"] },
  "left":         { pos: [0, 450],    origin: ["LEFT", "CENTER"] },
  "center":       { pos: [800, 450],  origin: ["CENTER", "CENTER"] },
  "right":        { pos: [1600, 450], origin: ["RIGHT", "CENTER"] },
  "bottom-left":  { pos: [0, 900],    origin: ["LEFT", "BOTTOM"] },
  "bottom":       { pos: [800, 900],  origin: ["CENTER", "BOTTOM"] },
  "bottom-right": { pos: [1600, 900], origin: ["RIGHT", "BOTTOM"] },
};
let anchorWrong = 0;
for (const [anchor, want] of Object.entries(expected)) {
  const p = at(anchor);
  const posOk = p.anchorPosition.left === want.pos[0] && p.anchorPosition.top === want.pos[1];
  const originOk = p.transformOrigin.horizontal === want.origin[0] && p.transformOrigin.vertical === want.origin[1];
  if (!posOk || !originOk) { anchorWrong++; console.log("   wrong:", anchor, JSON.stringify(p.anchorPosition), JSON.stringify(p.transformOrigin)); }
}
ok("every anchor lands at its point and is pinned by the matching corner", anchorWrong === 0);

// This is the one that matters for setWidth: pinned by its RIGHT corner, widening moves
// the left edge inwards. Pinned by its left corner it would grow off the screen.
ok("a right anchor is pinned by its right corner", at("right").transformOrigin.horizontal === "RIGHT");
ok("a bottom anchor is pinned by its bottom corner", at("bottom").transformOrigin.vertical === "BOTTOM");

// disableClickAway is the whole point of the docked sheet: without it the first click on
// the map dismisses it. marginThreshold defaults to 16 in MUI, and a panel that stops
// 16px short of the edge looks like a bug rather than a dock.
const all = ext.DOCK_ANCHORS.map((a) => at(a));
ok("every anchor disables click-away", all.every((p) => p.disableClickAway === true));
ok("every anchor sits flush to its point", all.every((p) => p.marginThreshold === 0));
ok("every anchor is positioned, not element-anchored", all.every((p) => p.anchorReference === "POSITION"));

// -------------------------------------------------------------
// It never covers the whole table
// -------------------------------------------------------------
// The panel may fill EITHER axis but never both, so the map is always reachable. This is
// what lets a full-height panel sit beside the map and a full-width one sit below it.
let covered = 0;
for (const anchor of ext.DOCK_ANCHORS) {
  for (const v of [{ width: 1600, height: 900 }, { width: 600, height: 400 }, { width: 3000, height: 2000 }]) {
    const p = ext.sheetPopover({ url: "u", dock: { anchor, width: 99999, height: 99999 }, viewport: v });
    const fillsW = p.width >= v.width;
    const fillsH = p.height >= v.height;
    if (fillsW && fillsH) { covered++; console.log("   covers everything:", anchor, JSON.stringify(v), p.width + "x" + p.height); }
  }
}
ok("a panel asked to fill everything still leaves the map reachable", covered === 0);
ok("a full-width panel is capped in height", ext.sheetPopover({ url: "u", dock: { anchor: "bottom", width: 99999, height: 99999 }, viewport: V }).height === 675);
ok("a narrow panel may still be full height", ext.sheetPopover({ url: "u", dock: { anchor: "right", width: 560, height: 99999 }, viewport: V }).height === 900);

// A viewport that reads zero before the scene is up must not position the panel at 0,0.
ok("a missing viewport falls back rather than collapsing",
  ext.sheetPopover({ url: "u", dock: {}, viewport: null }).anchorPosition.left === 1600);
ok("a zero viewport falls back too",
  ext.sheetPopover({ url: "u", dock: {}, viewport: { width: 0, height: 0 } }).anchorPosition.left === 1600);

// -------------------------------------------------------------
// A 1.0 dock still opens where it used to
// -------------------------------------------------------------
// 1.0 stored a `side`, and each side implied a size the stored object did not hold: a
// side dock was full height whatever its stored height, and the bottom dock was full
// width whatever its stored width. Carrying the anchor across without that fill would
// silently shrink a bottom dock from the whole width to 560px on the update.
const legacyRight = ext.sheetPopover({ url: "u", dock: { side: "right", width: 560, height: 420 }, viewport: V });
ok("a 1.0 right dock is still right and still full height", legacyRight.width === 560 && legacyRight.height === 900);
ok("and still pinned by its right corner", legacyRight.transformOrigin.horizontal === "RIGHT");
const legacyBottom = ext.sheetPopover({ url: "u", dock: { side: "bottom", width: 560, height: 420 }, viewport: V });
ok("a 1.0 bottom dock is still full width and still 420 tall", legacyBottom.width === 1600 && legacyBottom.height === 420);
const legacyLeft = ext.sheetPopover({ url: "u", dock: { side: "left", width: 560, height: 420 }, viewport: V });
ok("a 1.0 left dock survives even though Left is no longer offered", legacyLeft.anchorPosition.left === 0 && legacyLeft.height === 900);
// A 1.1 dock carrying both keys is a 1.1 dock: its own size wins over the legacy fill.
const both = ext.clampDock({ side: "bottom", anchor: "center", width: 700, height: 500 });
ok("an anchor beats a leftover side", both.anchor === "center" && both.width === 700 && both.height === 500);

// -------------------------------------------------------------
// Which edges can be dragged
// -------------------------------------------------------------
// A right-anchored panel has its right edge against the window, so pulling it would do
// nothing; only the edges facing into the screen are draggable.
ok("a right anchor offers only its left edge and the two vertical ones",
  ext.resizeEdges("right").sort().join("") === "nsw");
ok("a centred anchor offers all four", ext.resizeEdges("center").sort().join("") === "ensw");
ok("a top-left anchor offers only the two facing in", ext.resizeEdges("top-left").sort().join("") === "es");
ok("a bottom-right anchor offers only the two facing in", ext.resizeEdges("bottom-right").sort().join("") === "nw");
ok("an unknown anchor falls back to the default's edges",
  ext.resizeEdges("nonsense").join("") === ext.resizeEdges("right").join(""));

// -------------------------------------------------------------
// The stored dock is untrusted
// -------------------------------------------------------------
// localStorage is shared by every page on gsgrimoire.github.io and a user can edit it by
// hand. Same rule the character code follows: clamp on the way OUT of storage.
const fakeStore = (value) => ({ getItem: () => value, setItem: () => {} });

ok("no stored dock is the default", ext.readDock(fakeStore(null)).anchor === "right");
ok("unparseable JSON is the default", ext.readDock(fakeStore("{{{")).anchor === "right");
ok("a string instead of an object is the default", ext.readDock(fakeStore('"right"')).width === 560);
ok("an unknown anchor is the default", ext.readDock(fakeStore('{"anchor":"ceiling"}')).anchor === "right");
ok("a width far past the limit is clamped", ext.readDock(fakeStore('{"width":99999}')).width === 4000);
ok("a negative width is clamped", ext.readDock(fakeStore('{"width":-4000}')).width === 320);
ok("a non-numeric width falls back", ext.readDock(fakeStore('{"width":"wide"}')).width === 560);
ok("a wild zoom is clamped", ext.readDock(fakeStore('{"zoom":99}')).zoom === 1.6);
ok("a tiny zoom is clamped", ext.readDock(fakeStore('{"zoom":0.01}')).zoom === 0.6);
ok("a non-numeric zoom falls back", ext.readDock(fakeStore('{"zoom":"big"}')).zoom === 1);
// A zoom is stepped by 0.1 and stored; floating point would otherwise put 0.7000000000000001
// into a readout built from it.
ok("zoom is kept to one decimal", ext.readDock(fakeStore('{"zoom":1.2345}')).zoom === 1.2);
ok("a null dock survives", ext.readDock(fakeStore("null")).anchor === "right");
ok("an array survives", ext.readDock(fakeStore("[1,2,3]")).anchor === "right");
ok("nothing else rides along",
  Object.keys(ext.readDock(fakeStore('{"anchor":"left","evil":1}'))).sort().join() === "anchor,height,width,zoom");

const throwingStore = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
ok("a storage that throws on read gives the default", ext.readDock(throwingStore).anchor === "right");
ok("a storage that throws on write still returns the dock", ext.writeDock(throwingStore, { anchor: "center" }).anchor === "center");

let held = null;
const realStore = { getItem: () => held, setItem: (k, v) => { held = v; } };
ext.writeDock(realStore, { anchor: "bottom-left", width: 700, height: 500, zoom: 1.2 });
const back = ext.readDock(realStore);
ok("a written dock reads back", back.anchor === "bottom-left" && back.width === 700 && back.height === 500 && back.zoom === 1.2);

for (const [name, stored] of [["unknown anchor", '{"anchor":"ceiling"}'], ["huge width", '{"width":99999}'], ["garbage", "{{{"], ["wild zoom", '{"zoom":99}']]) {
  const mine = JSON.stringify(ext.readDock(fakeStore(stored)));
  const theirs = g(`JSON.stringify(readDock({ getItem: () => ${JSON.stringify(stored)} }))`);
  ok(`both copies clamp ${name} the same way`, mine === theirs);
}

// -------------------------------------------------------------
// openSheetPopover is the one route in
// -------------------------------------------------------------
// The roller's party list and the token context menu both call this. They used to hold a
// modal id and a URL each, and the comment in roller.js warned that opening under a
// second id would let one token's sheet be open twice, both saving over each other.
const opened = [];
const stubObr = (viewport) => ({
  viewport: {
    getWidth: async () => { if (!viewport) throw new Error("no scene"); return viewport.width; },
    getHeight: async () => { if (!viewport) throw new Error("no scene"); return viewport.height; },
  },
  popover: { open: async (cfg) => { opened.push(cfg); } },
});

await ext.openSheetPopover(stubObr({ width: 1920, height: 1080 }), "token-1", null);
ok("it opens one popover", opened.length === 1);
ok("it points at the published creator", opened[0].url === "https://gsgrimoire.github.io/dnm-cc/?item=token-1");
ok("it uses the live viewport", opened[0].anchorPosition.left === 1920);

await ext.openSheetPopover(stubObr({ width: 1600, height: 900 }), "a b&c=d", null);
ok("the item id is escaped into the URL", opened[1].url.endsWith("?item=a%20b%26c%3Dd"));

await ext.openSheetPopover(stubObr(null), "token-2", null);
ok("a viewport that throws still opens the sheet", opened[2].anchorPosition.left === 1600);

held = null;
ext.writeDock(realStore, { anchor: "top-left", width: 640, height: 480 });
await ext.openSheetPopover(stubObr({ width: 1600, height: 900 }), "token-3", realStore);
ok("it opens at the stored anchor", opened[3].anchorPosition.left === 0 && opened[3].anchorPosition.top === 0);
ok("at the stored size", opened[3].width === 640 && opened[3].height === 480);

// -------------------------------------------------------------
// Moving the sheet saves it first
// -------------------------------------------------------------
// The reopened sheet reads the character back off the token, so an edit still sitting in
// the 400ms save debounce would be undone by a move that was meant to be cosmetic.
//
// This needs a sheet booted onto a REAL token — `ready` and `tokenId` are `let` bindings
// in the module block, and jsdom gives each eval its own scope for those, so they cannot
// be set from a test. Faking them was tried and quietly did nothing: commit() returned
// early on `ready` being false and the ordering assertion passed on an empty list.
{
  const code = g(`(function(){
    var c = state.character = getDefaultCharacter();
    var arch = Object.keys(DM_DATA.archetypes)[0];
    c.name = 'Dock Fixture';
    c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = arch;
    c.temperament = Object.keys(DM_DATA.temperaments)[0];
    var a = DM_DATA.archetypes[arch];
    if (!a.forcedTalent) {
      var talents = Object.keys(a.talents || {});
      if (talents.length) c.talent = talents[0];
    }
    c.finalized = true;
    normalizeEditableLists();
    if (!computeStats()) throw new Error('fixture does not compute');
    return buildCharacterCode();
  })()`);
  ok("a real character code was built for the fixture", typeof code === "string" && code.length > 0);

  const dom2 = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://gsgrimoire.github.io/dnm-cc/?item=tok-1",
  });
  const w2 = dom2.window;
  await new Promise((r) => { if (w2.document.readyState === "complete") r(); else w2.addEventListener("load", r); });

  const trace = [];
  w2.__trace = trace;
  w2.__code = code;
  const stub2 = `const OBR = {
    isAvailable: true,
    onReady: (f) => f(),
    broadcast: { sendMessage: async () => {}, onMessage: () => () => {} },
    room: { id: "room-1", getMetadata: async () => ({}), setMetadata: async () => {}, onMetadataChange: () => {} },
    scene: {
      items: {
        getItems: async () => [{ id: "tok-1", metadata: { "com.thuknights.dnm-obr/char": { code: window.__code } } }],
        onChange: () => {},
        updateItems: async () => { window.__trace.push("write"); },
      },
      onReadyChange: () => {},
    },
    player: { getRole: async () => "GM", getName: async () => "Tester", getId: async () => "p1", onChange: () => {} },
    party: { getPlayers: async () => [], onChange: () => {} },
    modal: { close: () => {} },
    action: { setHeight: async () => {} },
    viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
    popover: {
      open: async () => { window.__trace.push("open"); },
      close: async () => { window.__trace.push("close"); },
      setWidth: async () => {}, setHeight: async () => {},
    },
  };
  `;
  w2.eval(stub2 + body);
  await new Promise((r) => setTimeout(r, 100));
  const g2 = (c) => w2.eval(c);

  ok("the fixture sheet loaded onto the token", g2("state.character.name") === "Dock Fixture");

  trace.length = 0;
  g2("state.character.name = 'Edited'; queueSave();");
  await g2("redock('center')");
  await new Promise((r) => setTimeout(r, 100));

  ok("the token is written before the popover closes",
    trace.indexOf("write") >= 0 && trace.indexOf("write") < trace.indexOf("close"));
  ok("and the popover is reopened after", trace.indexOf("close") < trace.indexOf("open"));
  ok("the move did not wait for the debounce", trace.filter((t) => t === "write").length === 1);
  ok("the new anchor is remembered", g2("readDockSafe().anchor") === "center");

  // -------------------------------------------------------------
  // Rolls from the room reach the sheet (v2.1)
  // -------------------------------------------------------------
  // Until v2.1 Recent Rolls was written in exactly one place, by a roll made on this
  // sheet. A roll made in the extension's roller reached the shared log and stopped
  // there. It is read from the LOG rather than from broadcasts on purpose: the log is
  // already the shared record, already sanitised by the extension before anything is
  // written, and reading it catches up rolls made while this sheet was closed.
  //
  // Tested here rather than in embedded.test.mjs because it needs a sheet booted onto a
  // real token: reconcileRolls() does nothing until `ready` is true, and `ready` is a
  // `let` in the module block that no test can reach from outside.
  const logRoll = (over) => Object.assign({
    id: "r1", t: 1000, who: "Dock Fixture", an: "Might", av: 9, sn: "Fight", sv: 1,
    detail: [{ d: 4, kind: "success" }, { d: 18, kind: "fail" }],
    diff: 1, succ: 1, comp: 0, pass: true, gain: 0, compAt: 20,
  }, over);
  const room = (entries) => ({ "com.thuknights.dnm-rolls/state": { momentum: 0, threat: 0, log: entries } });
  const recent = () => JSON.parse(g2("JSON.stringify(normalizeRecentRolls())"));
  const adopt = (entries) => g2(`adoptRoom(${JSON.stringify(room(entries))})`);

  // The move test above renamed the character to prove the save flushed. Set it back
  // explicitly rather than inheriting whatever the previous assertions left behind — a
  // fixture the assertions above already mutated is not a fixture.
  g2("state.character.name = 'Dock Fixture'; state.character.recentRolls = [];");
  adopt([logRoll({})]);
  let list = recent();
  ok("a roll for this character is picked up", list.length === 1);
  ok("with its dice", list.length === 1 && list[0].d.join(",") === "4,18");
  ok("and the threshold it was made under", list.length === 1 && list[0].at === 20);

  // The same entry arriving again is the same roll. Without the id it would be listed
  // once per metadata change, which is every pool press at the table.
  adopt([logRoll({})]);
  ok("the same roll is not added twice", recent().length === 1);

  adopt([logRoll({ id: "r2", who: "Someone Else" })]);
  ok("another character's roll is ignored", recent().length === 1);

  // Matching is on a normalised name, the same rule bond effects use, so spacing and
  // case do not decide whether your own roll reaches your sheet.
  adopt([logRoll({ id: "r3", who: "  dock fixture  ", t: 2000 })]);
  ok("the name match ignores case and spacing", recent().length === 2);

  // A concealed roll stays concealed. The roller decides who may draw one, and quietly
  // copying it onto a sheet would be a way around that decision.
  adopt([logRoll({ id: "r4", conceal: "hidden", t: 3000 })]);
  ok("a concealed roll is not copied to the sheet", recent().length === 2);

  adopt([{ id: "a1", t: 4000, kind: "action", who: "Dock Fixture", label: "Manual adjustment", detail: "added 2 Threat" }]);
  ok("an action entry is not a roll", recent().length === 2);

  // Newest first, and a roll from the log can be OLDER than one already held — so the
  // merge sorts rather than assuming the new ones go on top.
  g2("state.character.recentRolls = [];");
  adopt([logRoll({ id: "n1", t: 1000 }), logRoll({ id: "n2", t: 3000 }), logRoll({ id: "n3", t: 2000 })]);
  ok("the merged list is newest first", recent().map((r) => r.t).join(",") === "3000,2000,1000");

  // Everything here crossed a broadcast channel open to the whole room.
  g2("state.character.recentRolls = [];");
  adopt([logRoll({
    id: "r5", av: 9999, sv: -3, diff: 99, succ: 1000000, gain: -5, compAt: 999,
    detail: new Array(60).fill({ d: 99, kind: "success" }),
  })]);
  const clamped = recent()[0];
  ok("a hostile entry is clamped on the way in", !!clamped
    && clamped.av === 20 && clamped.sv === 0 && clamped.df === 5
    && clamped.su === 99 && clamped.gn === 0 && clamped.at === 20);
  ok("and its dice are bounded", !!clamped && clamped.d.length <= 20 && clamped.d.every((n) => n >= 1 && n <= 20));

  // An unnamed character would match every unnamed roll at the table.
  g2("state.character.name = ''; state.character.recentRolls = [];");
  adopt([logRoll({ id: "r6", who: "" })]);
  ok("an unnamed character picks up nothing", recent().length === 0);
}

// -------------------------------------------------------------
// There is always a way out of the panel (v2.1B)
// -------------------------------------------------------------
// The popover sets disableClickAway, so the ONLY way to dismiss it is the Close button in
// the header bar. That bar was built by loadIntoCreator(), which startEmbedded() reaches
// only when a character actually loads — and it has three legitimate ways of not getting
// there. Every one of them left a panel covering part of the table with no way to close
// it, no position pad, no zoom and no resize handles. That is what shipped in 2.1.
//
// The reason it shipped is worth keeping too: the test above DOES boot a real sheet, and
// asserted on state.character.name, which loadIntoCreator() sets BEFORE it builds the
// bar. So it passed while the bar was missing. Assert on the thing you care about, not on
// something that happens to be near it.
{
  const codeFor = (over) => g(`(function(){
    var c = state.character = getDefaultCharacter();
    var arch = Object.keys(DM_DATA.archetypes)[0];
    c.name = 'Way Out'; c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = arch; c.temperament = Object.keys(DM_DATA.temperaments)[0];
    var a = DM_DATA.archetypes[arch];
    if (!a.forcedTalent) { var t = Object.keys(a.talents || {}); if (t.length) c.talent = t[0]; }
    c.finalized = true; normalizeEditableLists();
    if (!computeStats()) throw new Error('fixture does not compute');
    var code = buildCharacterCode();
    var over = ${JSON.stringify("PLACEHOLDER")};
    if (!over) return code;
    var seg = code.split('-').find(function(p){ return p.slice(0,2) === 'CP'; });
    var pad = seg.slice(2); while (pad.length % 4) pad += '=';
    var obj = JSON.parse(decodeURIComponent(atob(pad)));
    obj.archetype = over;
    var b64 = btoa(encodeURIComponent(JSON.stringify(obj))).replace(/=/g,'');
    return code.split('-').map(function(p){ return p.slice(0,2) === 'CP' ? 'CP' + b64 : p; }).join('-');
  })()`.replace('"PLACEHOLDER"', JSON.stringify(over)));

  const goodCode = codeFor(null);
  const unreadableCode = codeFor("from-the-future");

  const bootPanel = async (url, tokenCode) => {
    const d = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url });
    const win = d.window;
    await new Promise((r) => { if (win.document.readyState === "complete") r(); else win.addEventListener("load", r); });
    win.__code = tokenCode;
    win.eval(`const OBR = {
      isAvailable: true,
      onReady: (f) => { Promise.resolve().then(f).catch(() => {}); },
      broadcast: { sendMessage: async () => {}, onMessage: () => () => {} },
      room: { id: "r1", getMetadata: async () => ({}), setMetadata: async () => {}, onMetadataChange: () => {} },
      scene: { items: {
          getItems: async () => (window.__code
            ? [{ id: "tok-1", metadata: { "com.thuknights.dnm-obr/char": { code: window.__code } } }]
            : [{ id: "tok-1", metadata: {} }]),
          onChange: () => {}, updateItems: async () => {} },
        onReadyChange: () => {} },
      player: { getRole: async () => "PLAYER", getName: async () => "P", getId: async () => "p1", onChange: () => {} },
      party: { getPlayers: async () => [], onChange: () => {} },
      modal: { close: () => {} }, action: { setHeight: async () => {} },
      viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
      popover: { open: async () => {}, close: async () => {}, setWidth: async () => {}, setHeight: async () => {} },
    };
    ` + body);
    await new Promise((r) => setTimeout(r, 200));
    const labels = [...win.document.querySelectorAll("#obrBar button")].map((b) => b.textContent.trim());
    return {
      bar: !!win.document.getElementById("obrBar"),
      close: labels.includes("Close"),
      pad: win.document.querySelectorAll(".obr-pad-cell").length,
      zoom: win.document.querySelectorAll(".obr-zoomgroup .obr-dock-btn").length,
      handles: win.document.querySelectorAll(".obr-resize").length,
      labels,
    };
  };

  const U = "https://gsgrimoire.github.io/dnm-cc/";
  const cases = [
    ["a token with a character", U + "?item=tok-1", goodCode],
    ["a token with no character yet", U + "?item=tok-1", null],
    ["opened with no token at all", U, null],
    ["a character this build cannot read", U + "?item=tok-1", unreadableCode],
  ];
  for (const [label, url, tokenCode] of cases) {
    const r = await bootPanel(url, tokenCode);
    ok(`${label}: the panel has a Close button`, r.bar && r.close);
    ok(`${label}: and the position pad`, r.pad === 9);
    ok(`${label}: and the zoom controls`, r.zoom === 2);
    ok(`${label}: and its resize handles`, r.handles > 0);
  }

  // Copy code and Detach act ON a character, so they wait for one. A Detach offered on an
  // empty token would be alarming, and a Copy code with nothing to copy is a dead button.
  const withChar = await bootPanel(U + "?item=tok-1", goodCode);
  const without = await bootPanel(U + "?item=tok-1", null);
  ok("a loaded character offers Copy code and Detach",
    withChar.labels.includes("Copy code") && withChar.labels.includes("Detach"));
  ok("an empty token offers neither",
    !without.labels.includes("Copy code") && !without.labels.includes("Detach"));
}

// -------------------------------------------------------------
// The relay really is gone
// -------------------------------------------------------------
// Named explicitly so that reintroducing it is a decision rather than an accident. It
// never once connected in play, and the note in dnm.js says why.
//
// Comments stripped first: the notes above sheetPopover() and the boot switch both
// describe the window.open() route in order to say why it is gone, and a bare substring
// search finds those and calls the prose a regression.
const code = body.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
ok("dnm.js exports no popout channel", ext.POPOUT_CHANNEL === undefined && ext.POPOUT_PROTOCOL === undefined);
ok("the creator opens no BroadcastChannel", !code.includes("new BroadcastChannel"));
ok("the creator has no popout query flag", !code.includes('get("popout")'));
ok("and no window.open", !code.includes("window.open("));
const extSrc = fs.readFileSync(new URL("../out/dnm-obr/background.js", import.meta.url), "utf8");
ok("background.js opens no BroadcastChannel", !extSrc.includes("BroadcastChannel"));
ok("background.js opens the sheet as a popover", extSrc.includes("openSheetPopover") && !extSrc.includes("OBR.modal.open"));
const rollerSrc = fs.readFileSync(new URL("../out/dnm-obr/roller.js", import.meta.url), "utf8");
ok("roller.js opens the sheet as a popover", rollerSrc.includes("openSheetPopover") && !rollerSrc.includes("OBR.modal.open"));

// -------------------------------------------------------------
// Versions moved together
// -------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(new URL("../out/dnm-obr/manifest.json", import.meta.url), "utf8"));
ok("the manifest is at 1.1", manifest.version === "1.1");
ok("EXT_VERSION matches the manifest", ext.EXT_VERSION === manifest.version);

console.log(`\ndock: ${pass} passed, ${fail} failed`);
console.log(`
Not covered here, and still live checks in UPGRADE_NOTES.md:
  · that Owlbear honours anchorPosition and marginThreshold as this geometry assumes
  · that the map stays interactive behind a popover with disableClickAway
  · that the sheet popover and the roller's action popover can be open at once
  · that setWidth on an open popover resizes without reloading the sheet
  · that a pointer drag on a resize handle keeps reporting once it leaves the handle
`);
process.exit(fail ? 1 : 0);
