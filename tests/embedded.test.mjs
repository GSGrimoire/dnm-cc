// =============================================================
// The Owlbear module block — creator v1.27
// -------------------------------------------------------------
// The other three suites all end by saying the module block is not covered, because
// jsdom does not execute <script type="module"> and the block carries the bundled OBR
// SDK. That was true for fifteen releases, and it is the half of the file where the
// interesting failures live: the Momentum accessor, the addThreat funnel, the bond
// bridge, and now the pool batcher.
//
// HOW THIS RUNS IT. The block has no imports — the SDK is inlined — so once the SDK is
// removed it is ordinary script code. The SDK is one enormous minified line, so it is
// found by length rather than by matching its text (two nearby COMMENTS mention `const
// OBR = Zo;`, which is what a substring search finds first). A stub OBR is prepended
// and the rest is evaluated in the same jsdom window the classic script already booted
// in, which is the scope it would have had anyway.
//
// WHAT IT STILL CANNOT SEE. jsdom gives each w.eval its own scope for lexical
// declarations, so the block's `const`s and `let`s — poolBatch, ready, obrRole — are
// not reachable from here. Function declarations and window assignments are. So every
// assertion below is made through the bridges or through what was BROADCAST, which is
// the honest surface anyway: what the room is told is the thing that matters.
//
// This is not a substitute for a live room. It cannot test delivery, the GM's relay,
// role changes, the modal, or the party panel. Those stay in UPGRADE_NOTES as live
// checks.
// =============================================================
import fs from "fs";
import { JSDOM } from "jsdom";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const raw = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");
const modStart = raw.indexOf('<script type="module">');
if (modStart < 0) { console.log("FATAL: module block marker not found"); process.exit(1); }
const modEnd = raw.indexOf("</script>", modStart);
const modSrc = raw.slice(modStart + '<script type="module">'.length, modEnd);
const html = raw.slice(0, modStart) + raw.slice(modEnd + "</script>".length);

// -------------------------------------------------------------
// The block PARSES, with the SDK still in it (v2.1C)
// -------------------------------------------------------------
// This has to come before the SDK is stripped, and it is the assertion this suite was
// missing for its whole life.
//
// Every suite here evaluates the module block with the bundled SDK REMOVED, because the
// SDK cannot run under jsdom. That makes any collision between our code and the SDK's own
// top-level names completely invisible: the tests see a block that parses, and the browser
// sees a SyntaxError.
//
// It happened in 2.1. The dock geometry declared `const H` and `const V`, and the minified
// bundle already declares `V` at top level. A duplicate top-level const is a SyntaxError,
// and a SyntaxError in a module means the module never runs AT ALL — so the sheet loaded
// as the plain standalone creator, with no header bar, no way to close the panel, and no
// character on it. Every suite passed.
//
// vm.Script rather than SourceTextModule: the block has no import or export statements, so
// it parses as a script, and that needs no experimental flag. A duplicate top-level const
// is a SyntaxError either way.
{
  const full = raw.slice(modStart + '<script type="module">'.length, modEnd);
  let parsed = null;
  try { new vm.Script(full); } catch (e) { parsed = e.message; }
  ok("the module block parses with the bundled SDK still in it", parsed === null);
  if (parsed) console.log("      " + parsed);

  // The rule that follows from it, asserted directly so the next person does not have to
  // rediscover why. Minified bundles own the short names; ours must not be short.
  const ours = full.slice(full.indexOf("const SHEET_POPOVER_ID"));
  const shortNames = [...ours.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]?)\s*[=({]/gm)].map((m) => m[1]);
  ok(`no top-level name in the dock helpers is one or two characters (found: ${shortNames.join(",") || "none"})`,
    shortNames.length === 0);
}

// By length, not by text. The two comments above the bundle both quote `const OBR =
// Zo;`, so a substring search removes a comment and leaves the SDK in place.
const lines = modSrc.split("\n");
const sdkLine = lines.findIndex((l) => l.length > 2000);
ok("the bundled SDK line was found", sdkLine >= 0);
lines.splice(sdkLine, 1);
const body = lines.join("\n");
ok("and removed", !body.split("\n").some((l) => l.length > 2000));

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://gsgrimoire.github.io/dnm-cc/" });
const w = dom.window;
await new Promise((r) => { if (w.document.readyState === "complete") r(); else w.addEventListener("load", r); });

// Records what would have gone to the room. Everything else is a no-op that returns
// the right SHAPE — an empty scene, an empty room, a GM.
const sent = [];
w.__sent = sent;
// v2.0. What the sheet asked Owlbear to do to its own popover.
const obrCalls = [];
w.__obrCalls = obrCalls;
const stub = `const OBR = {
  isAvailable: true,
  onReady: (f) => f(),
  broadcast: {
    sendMessage: (ch, ev) => { window.__sent.push(ev); return Promise.resolve(); },
    onMessage: () => () => {},
  },
  room: { getMetadata: async () => ({}), setMetadata: async () => {}, onMetadataChange: () => {} },
  scene: {
    items: {
      getItems: async () => [],
      onChange: () => {},
      updateItems: async () => { window.__obrCalls.push(["items.updateItems", null]); },
    },
    onReadyChange: () => {},
  },
  player: { getRole: async () => "GM", getName: async () => "Tester", getId: async () => "p1", onChange: () => {} },
  party: { getPlayers: async () => [] },
  modal: { close: (id) => { window.__obrCalls.push(["modal.close", id]); } },
  action: { setHeight: async () => {} },
  viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
  popover: {
    open: async (cfg) => { window.__obrCalls.push(["popover.open", cfg]); },
    close: async (id) => { window.__obrCalls.push(["popover.close", id]); },
    setWidth: async (id, w) => { window.__obrCalls.push(["popover.setWidth", w]); },
    setHeight: async (id, h) => { window.__obrCalls.push(["popover.setHeight", h]); },
  },
};
`;

w.eval(stub + body);
await new Promise((r) => setTimeout(r, 50));

const g = (code) => w.eval(code);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------
// The bridges are installed
// -------------------------------------------------------------
// Each of these is a seam the standalone file leaves open on purpose. A rename that
// missed one would leave the creator silently working alone inside Owlbear, which is
// the failure mode this whole block exists to avoid and the hardest one to notice.
ok("the roll bridge replaced postRoll", g("postRoll.name") === "postRollToOwlbear");
ok("the Threat bridge replaced addThreat", g("addThreat.name") === "patchedAddThreat");
ok("the action bridge replaced logActionNow", g("logActionNow.name") === "flushActionToOwlbear");
ok("the bond bridge replaced grantSpiritToAlly", g("grantSpiritToAlly.name") === "grantSpiritToRoom");
ok("the bond bridge replaced announceRivalryTrigger", g("announceRivalryTrigger.name") === "announceRivalryToRoom");
ok("the pending-Threat bridge replaced getPendingThreat", g("getPendingThreat.name") === "pendingThreatFromBatcher");

// -------------------------------------------------------------
// Fixture
// -------------------------------------------------------------
g(`(function(){
  var c = state.character = getDefaultCharacter();
  c.name = 'Tester';
  c.origin = Object.keys(DM_DATA.origins)[0];
  c.archetype = Object.keys(DM_DATA.archetypes)[0];
  c.temperament = Object.keys(DM_DATA.temperaments)[0];
  var arch = DM_DATA.archetypes[c.archetype];
  if (!arch.forcedTalent) { var t = Object.keys(arch.talents || {}); if (t.length) c.talent = t[0]; }
  c.bonds = [{ name: 'Kestrel', type: 'supportive' }];
  c.finalized = true;
  normalizeEditableLists(); computeStats(); normalizeCurrentValues();
})()`);

// Installed by adoptOntoToken()/loadIntoCreator() in real use, neither of which runs
// for a character assigned directly. Without it currentMomentum is an ordinary field
// and nothing reaches the room at all.
g("bindMomentumToRoom(state.character)");
ok("the Momentum accessor is installed",
  g("!!Object.getOwnPropertyDescriptor(state.character,'currentMomentum').get"));

const poolEvents = () => sent.filter((e) => e.type === "pool");
const actionEvents = () => sent.filter((e) => e.type === "action");

// -------------------------------------------------------------
// Coalescing pool nudges (v1.27)
// -------------------------------------------------------------
// The report from play: raising Threat by 3 meant three presses, three pool events and
// three "added 1 Threat" lines. The log recorded the clicking rather than the decision.
{
  sent.length = 0;
  g("addThreat(1,'manual adjustment'); addThreat(1,'manual adjustment'); addThreat(1,'manual adjustment');");
  ok("three presses broadcast nothing yet", sent.length === 0);
  ok("but the counter already shows them", g("getPendingThreat()") === 3);

  await wait(1100);
  ok("one pool event, not three", poolEvents().length === 1);
  ok("carrying the total", poolEvents()[0].delta === 3 && poolEvents()[0].pool === "threat");
  ok("one log line, not three", actionEvents().length === 1);
  ok("reading as the whole decision rather than the clicking",
    actionEvents()[0].entry.detail === "added 3 Threat");

  // What makes the Maverick drive readable: "spends 3 or more Threat AT ONCE" could
  // not be seen when a spend of 3 arrived as three spends of 1.
  sent.length = 0;
  g("addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment');");
  await wait(1100);
  ok("a spend of three is one event of -3", poolEvents().length === 1 && poolEvents()[0].delta === -3);
  ok("and one line saying so", actionEvents()[0].entry.detail === "removed 3 Threat");
}

// An ability must never be folded into a manual nudge: every ability passes its own
// reason, and a different reason closes the run.
{
  sent.length = 0;
  g("addThreat(1,'manual adjustment'); addThreat(6,'Adrenaline Rush');");
  await wait(1100);
  const labels = actionEvents().map((e) => e.entry.label);
  ok("a manual nudge and an ability stay two entries", labels.length === 2);
  ok("and the ability keeps its own name", labels.includes("Adrenaline Rush"));
  ok("and its own amount", poolEvents().some((e) => e.delta === 6));
}

// Previously two events and two log lines for a change nobody made.
{
  sent.length = 0;
  g("addThreat(1,'manual adjustment'); addThreat(-1,'manual adjustment');");
  await wait(1100);
  ok("a press up and a press down send nothing at all", sent.length === 0);
}

// Momentum reaches the room through the accessor rather than a named function, so it
// is worth asserting separately — the accessor catches six write paths and the
// batching has to sit on the right side of it.
{
  g("state.character.currentMomentum = 0;");
  await wait(1100);
  sent.length = 0;
  g("adjustResource('momentum',1); adjustResource('momentum',1); adjustResource('momentum',1);");
  ok("the Momentum counter answers the press immediately",
    g("state.character.currentMomentum") === 3);
  await wait(1100);
  ok("three presses are one event", poolEvents().length === 1 && poolEvents()[0].delta === 3);
  ok("and one line", actionEvents().length === 1 && actionEvents()[0].entry.detail === "gained 3 Momentum");
}

// A PARKED label is never batched. Its detail is written by the ability itself and
// cannot be regenerated from a total, and two uses of Second Wind are two decisions
// rather than one spend of six.
{
  g("state.character.currentMomentum = 6;");
  await wait(1100);
  sent.length = 0;
  g("state.character.currentSpirit = 1;");
  g("useSecondWind(1,'self')");
  await wait(1100);
  ok("a named ability sends its own entry",
    actionEvents().some((e) => e.entry.label === "Second Wind"));
  ok("keeping the detail the ability wrote, not one rebuilt from a total",
    actionEvents().some((e) => e.entry.label === "Second Wind" && /regained/.test(e.entry.detail)));
}

// -------------------------------------------------------------
// A roll says who made it (v1.28B)
// -------------------------------------------------------------
// Reported from play: "Add Momentum" in the roller was clickable for the GM and for
// nobody else. The roller offers a roll's surplus to the person who made it and to the
// GM, matching on `by` — and the sheet had never stamped it. Every roll made from a
// character sheet was therefore unattributable, so a player rolling their own dice
// watched the GM claim their Momentum for them.
//
// The roller has stamped its own rolls since 0.9.4, which is why this only ever showed
// up for tables that roll from the sheet.
{
  sent.length = 0;
  g(`(function(){
    state.character.currentSpirit = 3;
    postRoll('Tester', { dice: [4, 12], attrValue: 9, skillValue: 2, attrName: 'Might',
      skillName: 'Fight', difficulty: 1, successes: 2, complications: 0, passed: true,
      momentumGained: 1 });
  })()`);
  const rolls = sent.filter((e) => e.type === "roll");
  ok("a sheet roll reaches the room", rolls.length === 1);
  ok("stamped with the player who made it", rolls[0].entry.by === "p1");
  ok("and still carries its surplus, which is what there is to claim",
    rolls[0].entry.gain === 1);
}

// -------------------------------------------------------------
// The bond bridge (v1.26)
// -------------------------------------------------------------
{
  sent.length = 0;
  g("state.character.oncePerSceneUsed = []; state.character.currentSpirit = 1;");
  g("useAdrenalineRush(1)");
  await wait(1100);
  const bonds = sent.filter((e) => e.type === "bond");
  ok("Adrenaline Rush announces a rivalry effect", bonds.length === 1);
  ok("naming who did it", bonds[0].effect.from === "Tester");
  ok("and carrying no target — every other sheet decides for itself",
    bonds[0].effect.target === undefined && bonds[0].effect.kind === "rivalry");

  sent.length = 0;
  g("state.character.currentMomentum = 6;");
  await wait(1100);
  sent.length = 0;
  g("setAllyTarget('secondWind','Kestrel'); useSecondWind(2,'ally');");
  await wait(1100);
  const grant = sent.filter((e) => e.type === "bond")[0];
  ok("Second Wind on an ally sends a grant", !!grant && grant.effect.kind === "grant");
  ok("to the named target", grant.effect.target === "Kestrel");
  ok("carrying 2 plus the supportive bond's 1", grant.effect.amount === 3);
}

// -------------------------------------------------------------
// The Maverick drive (v1.28)
// -------------------------------------------------------------
// The sheet's Threat controls are the GM's, so this is one of the two places a spend
// can happen. The announcement has to come from wherever it happened, because only
// that client knows a run of presses was one decision — the room's metadata just shows
// a number that moved. This is why coalescing had to land first.
{
  const drives = () => sent.filter((e) => e.type === "bond" && e.effect.kind === "drive");

  g("obrRole = 'GM';");
  sent.length = 0;
  g("addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment');");
  await wait(1100);
  ok("spending 3 at once announces the drive", drives().length === 1);
  ok("naming which drive, so a future one cannot be paid by accident",
    drives()[0].effect.drive === "maverick");
  ok("and how much was spent", drives()[0].effect.amount === 3);
  ok("it names no target — every sheet reads its own temperament",
    drives()[0].effect.target === undefined);

  // "At once" is the whole of the rule. Two is two.
  sent.length = 0;
  g("addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment');");
  await wait(1100);
  ok("spending 2 announces nothing", drives().length === 0);

  // Two spends of 2, far enough apart to be two runs, is not a spend of 4.
  sent.length = 0;
  g("addThreat(-2,'manual adjustment');");
  await wait(1100);
  g("addThreat(-2,'manual adjustment');");
  await wait(1100);
  ok("two separate spends of 2 are not one spend of 4", drives().length === 0);

  // ADDING Threat is a player action several abilities require. It is not a spend.
  sent.length = 0;
  g("addThreat(6,'Adrenaline Rush');");
  await wait(1100);
  ok("paying Threat IN never fires the drive", drives().length === 0);

  // Sender-side role check. Not the control — that is isGmOnlyEvent() in the reducer,
  // enforced by the GM's background page — but it stops an honest misclick.
  g("obrRole = 'PLAYER';");
  sent.length = 0;
  g("addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment'); addThreat(-1,'manual adjustment');");
  await wait(1100);
  ok("a player's client does not announce a drive", drives().length === 0);
  g("obrRole = 'GM';");
}

// -------------------------------------------------------------
// The docked sheet (v2.0, regridded v2.1)
// -------------------------------------------------------------
// dock.test.mjs proves the geometry and that the creator's copy of it matches the
// extension's. This is the other half: that the CONTROLS do what they say, which is
// where the v1.29 Pop out button failed — it was wired correctly to a route that could
// never work, and nothing in any suite noticed for two releases.
{
  const calls = (name) => obrCalls.filter((c) => c[0] === name);

  ok("the dock controls are built", g("typeof buildDockControls") === "function");
  ok("the resize handles are built", g("typeof buildResizeHandles") === "function");
  ok("redock exists", g("typeof redock") === "function");
  ok("zoomSheet exists", g("typeof zoomSheet") === "function");
  ok("the Pop out button is gone", !g("typeof popOutSheet === 'function'"));
  // v2.1 replaced the panel-size buttons with a drag handle. A leftover would be a
  // second control for the same thing, disagreeing with the first.
  ok("the old panel-size stepper is gone", !g("typeof resizeDock === 'function'"));

  // Built directly rather than through insertBar(), which needs a character on a token.
  g("writeDockSafe({ anchor: 'right', width: 560, height: 4000, zoom: 1 })");
  // Attached to the document: applyZoom() finds its readout by id, and a detached
  // fragment is not in the document, so the readout assertion below would test nothing.
  const controls = g("(function(){ var c = buildDockControls(); document.body.append(c); return c; })()");
  const cells = [...controls.querySelectorAll(".obr-pad-cell")];
  ok("the position pad offers nine anchors", cells.length === 9);
  // v2.2. The character name is gone from the header. It was the first thing squeezed out
  // at a narrow width and the sheet immediately below says whose it is in readable type.
  ok("the header carries no character name", !g("!!document.querySelector('#obrBar .obr-name')"));
  ok("every cell names its anchor", cells.every((c) => !!c.dataset.anchor));
  // Where it already is: a readout, not a button. Pressing it would close and reopen the
  // popover to arrive exactly where it already was.
  const here = cells.find((c) => c.dataset.anchor === "right");
  const elsewhere = cells.find((c) => c.dataset.anchor === "top-left");
  ok("the current anchor is marked", here.getAttribute("aria-pressed") === "true");
  ok("and cannot be pressed", here.disabled === true);
  ok("another anchor is not marked", elsewhere.getAttribute("aria-pressed") === "false");
  ok("and can be pressed", elsewhere.disabled === false);

  // -------------------------------------------------------------
  // Zoom scales the sheet and leaves the panel alone
  // -------------------------------------------------------------
  // The two are deliberately different controls: the panel size covers more of the map,
  // the zoom does not. Confusing them would make the zoom useless.
  obrCalls.length = 0;
  g("zoomSheet(0.1)");
  ok("zooming stores the new level", g("readDockSafe().zoom") === 1.1);
  ok("zooming touches the popover not at all", obrCalls.length === 0);
  ok("zooming scales the sheet", g("document.getElementById('app').style.zoom") === "1.1");
  const readout = g("document.getElementById('obrZoomReadout')");
  ok("and says so", readout && readout.textContent === "110%");

  for (let i = 0; i < 20; i++) g("zoomSheet(0.1)");
  ok("zoom stops at its ceiling", g("readDockSafe().zoom") === 1.6);
  for (let i = 0; i < 30; i++) g("zoomSheet(-0.1)");
  ok("and at its floor", g("readDockSafe().zoom") === 0.6);
  g("zoomSheet(0.4)");
  ok("a stepped zoom stays on one decimal", g("readDockSafe().zoom") === 1);

  // -------------------------------------------------------------
  // Resize handles
  // -------------------------------------------------------------
  // Which edges exist depends on the anchor: a right-anchored panel has its right edge
  // against the window, so pulling it would do nothing.
  g("writeDockSafe({ anchor: 'right', width: 560, height: 4000, zoom: 1 })");
  const rightHandles = [...g("(function(){ var d=document.createElement('div'); d.append(buildResizeHandles()); return d; })()").querySelectorAll(".obr-resize")];
  ok("a right-anchored panel gets three edges and no corner off-screen",
    rightHandles.map((h) => h.dataset.dir).sort().join(",") === "n,nw,s,sw,w");

  g("writeDockSafe({ anchor: 'top-left', width: 560, height: 420, zoom: 1 })");
  const cornerHandles = [...g("(function(){ var d=document.createElement('div'); d.append(buildResizeHandles()); return d; })()").querySelectorAll(".obr-resize")];
  ok("a corner-anchored panel gets two edges and the one corner between them",
    cornerHandles.map((h) => h.dataset.dir).sort().join(",") === "e,s,se");

  // A drag resizes live. Size is the one dimension PopoverApi lets us change without a
  // reload, which is why moving is a press and resizing is a drag.
  // The drag measures from the panel's REAL width, not the stored one — a stored height
  // of 4000 means "fill", and dragging from 4000 would throw the edge off the screen on
  // the first pixel. So the assertions below compare against that real width. An earlier
  // version compared against the stored 560 and passed with the sign inverted, because
  // any drag at all cleared 560.
  const panelWidth = g("window.innerWidth");
  const dragWest = (fromX, toX) => g(`(function(){
    var d = document.createElement('div');
    d.append(buildResizeHandles());
    document.body.append(d);
    var handle = d.querySelector('.obr-resize-w');
    handle.dispatchEvent(new window.PointerEvent('pointerdown', { button: 0, clientX: ${fromX}, clientY: 400, bubbles: true }));
    window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: ${toX}, clientY: 400, bubbles: true }));
    window.dispatchEvent(new window.PointerEvent('pointerup', { clientX: ${toX}, clientY: 400, bubbles: true }));
    d.remove();
    return true;
  })()`);

  g("writeDockSafe({ anchor: 'right', width: 560, height: 4000, zoom: 1 })");
  obrCalls.length = 0;
  ok("a drag on the west handle runs", dragWest(900, 800) === true);
  await wait(40);
  ok("dragging resizes the panel", calls("popover.setWidth").length > 0);
  // The panel is anchored on its right edge, so pulling the LEFT edge LEFTWARDS makes it
  // wider. Getting this sign wrong makes the panel shrink when you pull it open, which
  // is the single most obvious way this feature can be broken.
  const widened = calls("popover.setWidth").map((c) => c[1]);
  ok("pulling the west edge left makes it wider", widened.every((n) => n > panelWidth));
  ok("by roughly the distance dragged", widened.some((n) => Math.abs(n - (panelWidth + 100)) <= 1));
  ok("dragging never reopens the popover", calls("popover.open").length === 0 && calls("popover.close").length === 0);

  // And the other way, which the sign error would also get wrong.
  g("writeDockSafe({ anchor: 'right', width: 560, height: 4000, zoom: 1 })");
  obrCalls.length = 0;
  dragWest(800, 900);
  await wait(40);
  const narrowed = calls("popover.setWidth").map((c) => c[1]);
  ok("pulling the west edge right makes it narrower", narrowed.every((n) => n < panelWidth));
  ok("the dragged size is remembered",
    g("dockSizeFor(readDockSafe(), 'right').width") === narrowed[narrowed.length - 1]);

  // v2.2. A size per anchor. Dragging the panel at one anchor must not disturb the size
  // it has at another, which is the point of the change: a sheet along the bottom wants
  // to be broad and short and the same sheet at a side wants to be narrow and tall.
  // Moved, not rewritten: a dock written without a sizes map is a FRESH dock and
  // correctly resets every anchor to its default, which would erase the size just
  // dragged above and leave this asserting nothing.
  g("writeDockSafe({ ...readDockSafe(), anchor: 'bottom' })");
  obrCalls.length = 0;
  dragWest(800, 700);
  await wait(40);
  const bottomWidth = g("dockSizeFor(readDockSafe(), 'bottom').width");
  const rightWidth = g("dockSizeFor(readDockSafe(), 'right').width");
  ok("dragging at the bottom changes the bottom's size", bottomWidth > 0);
  ok("and leaves the right's size alone", rightWidth === narrowed[narrowed.length - 1]);
  ok("the anchor is unchanged by a resize", g("readDockSafe().anchor") === "bottom");

  // -------------------------------------------------------------
  // Moving
  // -------------------------------------------------------------
  g("writeDockSafe({ anchor: 'right', width: 560, height: 4000, zoom: 1 })");
  obrCalls.length = 0;
  await g("redock('bottom-left')");
  await wait(50);
  // This window has no token, so there is nothing to flush. That the save IS flushed
  // before the move is tested in dock.test.mjs, on a sheet booted onto a real token.
  ok("moving closes the popover", calls("popover.close").length === 1);
  ok("and opens it again", calls("popover.open").length === 1);
  const reopened = calls("popover.open")[0][1];
  ok("at the anchor that was asked for",
    reopened.anchorPosition.left === 0 && reopened.anchorPosition.top === 900);
  ok("pinned by the matching corner",
    reopened.transformOrigin.horizontal === "LEFT" && reopened.transformOrigin.vertical === "BOTTOM");
  ok("using the live viewport", reopened.width <= 1600);
  ok("and the anchor is remembered", g("readDockSafe().anchor") === "bottom-left");

  const rebuilt = g("buildDockControls()");
  const nowHere = [...rebuilt.querySelectorAll(".obr-pad-cell")].find((c) => c.dataset.anchor === "bottom-left");
  ok("the rebuilt pad marks the new anchor",
    nowHere.getAttribute("aria-pressed") === "true" && nowHere.disabled === true);

  // Closing the sheet closes the popover AND both legacy modal ids: a room that was
  // already open when the extension updated still has the old modal on screen, because
  // Owlbear caches the background page for the whole room session.
  obrCalls.length = 0;
  g("closeModal()");
  ok("closing closes the popover", calls("popover.close").length === 1);
  ok("and both legacy modal ids", calls("modal.close").length === 2);
}

console.log(`\nembedded: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — the SDK is a stub, so this is the block's logic, not Owlbear:
  · that a broadcast is actually delivered, and the GM's relay accepting or refusing it
  · room metadata round trips, and epoch or bond catch-up against a real room
  · role changes, token reads and writes, and whether Owlbear honours the popover
    geometry the dock controls ask for
  · the party panel, which is extension code in roller.js
Those stay as live checks in UPGRADE_NOTES.md.`);
process.exit(fail ? 1 : 0);
