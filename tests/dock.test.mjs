// =============================================================
// The docked sheet — creator v2.0 / extension 1.0
// -------------------------------------------------------------
// Replaces popout.test.mjs, which tested the BroadcastChannel relay that v2.0 deleted.
// It inherits that suite's real job: the dock helpers exist TWICE — once exported from
// dnm.js for the extension, once copied into the creator's module block — for the same
// reason createPoolBatcher does, and two copies drift. popout.test.mjs compared the op
// names on each side of the relay; this compares the two copies over a grid of inputs
// and fails if they disagree by so much as a pixel.
//
// The geometry is worth testing on its own, because it encodes a constraint that is
// easy to forget and expensive to rediscover: PopoverApi has setWidth and setHeight but
// NO setPosition, and anchorPosition is read once at open. transformOrigin is what pins
// a dock to its edge — a right dock pinned by its RIGHT corner grows leftwards when
// setWidth is called, and one pinned by its left corner would walk off the screen.
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
// sheet here would only add noise. The functions are declarations, so they are
// reachable from w.eval even though the block's consts are not.
w.eval(`const OBR = { isAvailable: false };\n` + body);
const g = (code) => w.eval(code);

ok("the creator carries its own sheetPopover", g("typeof sheetPopover") === "function");
ok("and its own clampDock", g("typeof clampDock") === "function");
ok("and its own readDock/writeDock", g("typeof readDock") === "function" && g("typeof writeDock") === "function");

// -------------------------------------------------------------
// The two copies agree
// -------------------------------------------------------------
// A grid rather than a couple of spot checks: the interesting disagreements are at the
// clamps and on the small viewport, which is exactly where a hand-copied edit goes
// wrong. Every side, every limit, and a viewport too small for the dock asked for.
const sides = ["right", "left", "bottom", "nonsense", undefined];
const widths = [0, 379, 380, 560, 1280, 1281, 99999, -50, NaN, "560", null];
const heights = [0, 259, 260, 420, 1000, 1001, -5];
const viewports = [
  { width: 1600, height: 900 },
  { width: 1280, height: 800 },
  { width: 600, height: 400 },
  { width: 0, height: 0 },
  null,
  { width: "1600", height: "900" },
];

// Handed over as a JS LITERAL, not as JSON. JSON.stringify turns NaN into null, and
// Number(null) is 0 — which is finite, so it takes the clamp path while a real NaN
// takes the fallback path. The first run of this suite reported the two copies
// disagreeing because of exactly that, and they did not: the harness was lying about
// the input. A test run on the wrong shape is worse than no test.
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

let mismatches = 0, compared = 0;
for (const side of sides) {
  for (const width of widths) {
    for (const height of heights) {
      for (const viewport of viewports) {
        const dock = { side, width, height };
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

ok("the popover id is not the context menu id", ext.SHEET_POPOVER_ID === "com.thuknights.dnm-obr/sheet-panel");
ok("and the creator agrees on it", g(`sheetPopover({url:"u",dock:{},viewport:null}).id`) === ext.SHEET_POPOVER_ID);

// -------------------------------------------------------------
// The geometry pins each dock to its edge
// -------------------------------------------------------------
const V = { width: 1600, height: 900 };
const at = (side, dock = {}) => ext.sheetPopover({ url: "u", dock: { side, ...dock }, viewport: V });

const right = at("right");
ok("a right dock anchors at the right edge", right.anchorPosition.left === 1600 && right.anchorPosition.top === 0);
// This is the one that matters for setWidth: pinned by its RIGHT corner, widening moves
// the left edge inwards. Pinned by its left corner it would grow off the screen.
ok("a right dock is pinned by its right corner", right.transformOrigin.horizontal === "RIGHT");
ok("a right dock is full height", right.height === 900);

const left = at("left");
ok("a left dock anchors at the left edge", left.anchorPosition.left === 0);
ok("a left dock is pinned by its left corner", left.transformOrigin.horizontal === "LEFT");
ok("a left dock is full height", left.height === 900);

const bottom = at("bottom");
ok("a bottom dock anchors at the bottom edge", bottom.anchorPosition.top === 900 && bottom.anchorPosition.left === 0);
ok("a bottom dock is pinned by its bottom corner", bottom.transformOrigin.vertical === "BOTTOM");
ok("a bottom dock is full width", bottom.width === 1600);
ok("a bottom dock takes its height from the dock", bottom.height === 420);

// disableClickAway is the whole point of the release: without it the first click on the
// map dismisses the sheet, which is the behaviour v2.0 exists to remove.
ok("every dock disables click-away", [right, left, bottom].every((p) => p.disableClickAway === true));
// MUI's default marginThreshold is 16, and a dock that stops 16px short of the edge
// looks like a bug rather than a dock.
ok("every dock sits flush to the edge", [right, left, bottom].every((p) => p.marginThreshold === 0));
ok("every dock is positioned, not element-anchored", [right, left, bottom].every((p) => p.anchorReference === "POSITION"));

// -------------------------------------------------------------
// It never eats the whole window
// -------------------------------------------------------------
// A laptop, or a browser window on half a screen. A 1280 dock on a 600px viewport would
// leave no map at all, which is the same problem as the modal.
const small = ext.sheetPopover({ url: "u", dock: { side: "right", width: 1280 }, viewport: { width: 600, height: 400 } });
ok("a side dock never takes more than three quarters of the width", small.width === 450);
const smallBottom = ext.sheetPopover({ url: "u", dock: { side: "bottom", height: 1000 }, viewport: { width: 600, height: 400 } });
ok("a bottom dock never takes more than three quarters of the height", smallBottom.height === 300);

// A viewport that reads zero before the scene is up must not position the sheet at 0,0.
const noViewport = ext.sheetPopover({ url: "u", dock: {}, viewport: null });
ok("a missing viewport falls back rather than collapsing", noViewport.anchorPosition.left === 1600 && noViewport.height === 900);
const zeroViewport = ext.sheetPopover({ url: "u", dock: {}, viewport: { width: 0, height: 0 } });
ok("a zero viewport falls back too", zeroViewport.anchorPosition.left === 1600);

// -------------------------------------------------------------
// The stored dock is untrusted
// -------------------------------------------------------------
// localStorage is shared by every page on gsgrimoire.github.io and a user can edit it by
// hand. Same rule the character code follows: clamp on the way OUT of storage.
const fakeStore = (value) => ({ getItem: () => value, setItem: () => {} });

ok("no stored dock is the default", ext.readDock(fakeStore(null)).side === "right");
ok("unparseable JSON is the default", ext.readDock(fakeStore("{{{")).side === "right");
ok("a string instead of an object is the default", ext.readDock(fakeStore('"right"')).width === 560);
ok("an unknown side is the default", ext.readDock(fakeStore('{"side":"ceiling"}')).side === "right");
ok("a width far past the limit is clamped", ext.readDock(fakeStore('{"width":99999}')).width === 1280);
ok("a negative width is clamped", ext.readDock(fakeStore('{"width":-4000}')).width === 380);
ok("a non-numeric width falls back", ext.readDock(fakeStore('{"width":"wide"}')).width === 560);
ok("a null dock survives", ext.readDock(fakeStore("null")).side === "right");
// An array is an object, and its .side is undefined — the default path, not a throw.
ok("an array survives", ext.readDock(fakeStore("[1,2,3]")).side === "right");
// The clamp returns a fresh object with exactly three keys, so nothing extra rides in.
ok("nothing else rides along", Object.keys(ext.readDock(fakeStore('{"side":"left","evil":1}'))).join() === "side,width,height");

// A storage that throws is a frame with cookies blocked, not a bug.
const throwingStore = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
ok("a storage that throws on read gives the default", ext.readDock(throwingStore).side === "right");
ok("a storage that throws on write still returns the dock", ext.writeDock(throwingStore, { side: "bottom" }).side === "bottom");

// Round trip.
let held = null;
const realStore = { getItem: () => held, setItem: (k, v) => { held = v; } };
ext.writeDock(realStore, { side: "bottom", width: 700, height: 500 });
const back = ext.readDock(realStore);
ok("a written dock reads back", back.side === "bottom" && back.width === 700 && back.height === 500);
ext.writeDock(realStore, { side: "left", width: 99999, height: 500 });
ok("and is clamped on the way in as well", ext.readDock(realStore).width === 1280);

// The creator's copy has to reject the same things, or a hand-edited localStorage would
// open a sheet the extension and the sheet disagree about.
for (const [name, stored] of [["unknown side", '{"side":"ceiling"}'], ["huge width", '{"width":99999}'], ["garbage", "{{{"]]) {
  const mine = JSON.stringify(ext.readDock(fakeStore(stored)));
  const theirs = g(`JSON.stringify(readDock({ getItem: () => ${JSON.stringify(stored)} }))`);
  ok(`both copies clamp ${name} the same way`, mine === theirs);
}

// -------------------------------------------------------------
// openSheetPopover is the one route in
// -------------------------------------------------------------
// The roller's party list and the token context menu both call this. They used to hold
// a modal id and a URL each, and the comment in roller.js warned that opening under a
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
ok("it uses the live viewport", opened[0].anchorPosition.left === 1920 && opened[0].height === 1080);

// A token id is an Owlbear id, but it reaches the URL as a query value either way.
await ext.openSheetPopover(stubObr({ width: 1600, height: 900 }), "a b&c=d", null);
ok("the item id is escaped into the URL", opened[1].url.endsWith("?item=a%20b%26c%3Dd"));

// Before a scene is up, the viewport read throws. Opening the sheet anyway beats
// refusing to open it.
await ext.openSheetPopover(stubObr(null), "token-2", null);
ok("a viewport that throws still opens the sheet", opened[2].anchorPosition.left === 1600);

// And it honours the stored side, which is what makes the sheet reopen where you left it.
held = null;
ext.writeDock(realStore, { side: "left", width: 640 });
await ext.openSheetPopover(stubObr({ width: 1600, height: 900 }), "token-3", realStore);
ok("it opens on the stored side", opened[3].anchorPosition.left === 0 && opened[3].transformOrigin.horizontal === "LEFT");
ok("at the stored width", opened[3].width === 640);

// -------------------------------------------------------------
// Moving the sheet saves it first
// -------------------------------------------------------------
// The reopened sheet reads the character back off the token, so an edit still sitting
// in the 400ms save debounce would be undone by a move that was meant to be cosmetic.
// v1.29's Pop out button flushed the save for exactly this reason and the reason
// survives it, because a redock is a genuine reload.
//
// This needs a sheet booted onto a REAL token — `ready` and `tokenId` are `let`
// bindings in the module block, and jsdom gives each eval its own scope for those, so
// they cannot be set from a test. Faking them was tried and quietly did nothing: commit()
// returned early on `ready` being false and the ordering assertion passed on an empty
// list. So the sheet is booted the way Owlbear boots it, with ?item= in the URL and a
// character code on the token, and the character is built the way the app builds one.
{
  // Built in the window already open above, which has the classic script live.
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

  // A real edit through a real setter, then a move before the debounce has fired.
  trace.length = 0;
  g2("state.character.name = 'Edited'; queueSave();");
  await g2("redock('bottom')");
  await new Promise((r) => setTimeout(r, 100));

  ok("the token is written before the popover closes",
    trace.indexOf("write") >= 0 && trace.indexOf("write") < trace.indexOf("close"));
  ok("and the popover is reopened after", trace.indexOf("close") < trace.indexOf("open"));
  ok("the move did not wait for the debounce", trace.filter((t) => t === "write").length === 1);
}

// -------------------------------------------------------------
// The relay really is gone
// -------------------------------------------------------------
// Named explicitly so that reintroducing it is a decision rather than an accident. It
// never once connected in play, and the note in dnm.js says why.
ok("dnm.js exports no popout channel", ext.POPOUT_CHANNEL === undefined && ext.POPOUT_PROTOCOL === undefined);
// Comments stripped first: the notes above sheetPopover() and the boot switch both
// describe the window.open() route in order to say why it is gone, and a bare substring
// search finds those and calls the prose a regression.
const code = body.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
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
// The creator reaching 2.0 takes the extension to 1.0 — they are one product and a
// headline release should read that way on both halves.
const manifest = JSON.parse(fs.readFileSync(new URL("../out/dnm-obr/manifest.json", import.meta.url), "utf8"));
ok("the manifest is at 1.0", manifest.version === "1.0");
ok("EXT_VERSION matches the manifest", ext.EXT_VERSION === manifest.version);

console.log(`\ndock: ${pass} passed, ${fail} failed`);
console.log(`
Not covered here, and still live checks in UPGRADE_NOTES.md:
  · that Owlbear honours anchorPosition and marginThreshold as this geometry assumes
  · that the map stays interactive behind a popover with disableClickAway
  · that the sheet popover and the roller's action popover can be open at once
  · that setWidth on an open popover resizes without reloading the sheet
`);
process.exit(fail ? 1 : 0);
