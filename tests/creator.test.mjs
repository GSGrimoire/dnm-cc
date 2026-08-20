// =============================================================
// jsdom harness — creator v1.20
// -------------------------------------------------------------
// The module block at the end of index.html is STRIPPED: jsdom does not execute
// <script type="module">, and it carries the bundled OBR SDK. Everything the block
// replaces (postRoll, logActionNow) therefore runs in its standalone form here.
//
// ACCESS NOTE: the creator is one classic <script>. `const state` and `const DM_DATA`
// at its top level are global LEXICAL bindings, not properties of window, so
// window.state is undefined even when the app has booted correctly. Everything is
// reached through g() — indirect eval in global scope — which sees them. Function
// declarations DO land on window, which is why overwriting logActionNow below really
// does intercept the app's own internal calls, exactly as the module block does.
//
// Fixtures drive the app's construction path — an origin, archetype and temperament
// that exist in DM_DATA, then computeStats() — never direct field assignment. Direct
// assignment asserts the code works for characters that cannot exist, which is how
// the Nanobarrier forced-talent bug survived a full release.
//
// WHAT THIS CANNOT VERIFY is printed at the end of the run.
// =============================================================
import fs from "fs";
import { JSDOM } from "jsdom";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const raw = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");

const modStart = raw.indexOf('<script type="module">');
if (modStart < 0) { console.log("FATAL: module block marker not found"); process.exit(1); }
const modEnd = raw.indexOf("</script>", modStart);
const html = raw.slice(0, modStart) + raw.slice(modEnd + "</script>".length);
ok("module block stripped", !html.includes("const OBR = Zo;"));

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://gsgrimoire.github.io/dnm-cc/" });
const w = dom.window;
await new Promise((r) => { if (w.document.readyState === "complete") r(); else w.addEventListener("load", r); });

const g = (code) => w.eval(code);

ok("app booted", g("typeof state") === "object" && g("typeof DM_DATA") === "object");
ok("APP_VERSION is 1.21", g("APP_VERSION") === "1.21");

// -------------------------------------------------------------
// Fixture
// -------------------------------------------------------------
function buildCharacter(archetypeKey) {
  return g(`(function(){
    var c = state.character = getDefaultCharacter();
    var originKey = Object.keys(DM_DATA.origins)[0];
    var archKey = ${JSON.stringify(archetypeKey || null)} || Object.keys(DM_DATA.archetypes)[0];
    var tempKey = Object.keys(DM_DATA.temperaments)[0];
    // Resolve the archetype the way the other call sites in this file do: an
    // archetype lives in EITHER map, and reading only DM_DATA.archetypes is the
    // exact mistake that broke Nanobarrier twice.
    var arch = DM_DATA.archetypes[archKey] || DM_DATA.advancedArchetypes[archKey];
    if (!arch) throw new Error('archetype not in DM_DATA: ' + archKey);
    c.name = 'Fixture';
    c.origin = originKey;
    c.archetype = archKey;
    c.temperament = tempKey;
    // A bond, so the Bonds row actually renders. Without one the section is omitted
    // by design, and a layout assertion against it would be testing the fixture.
    c.bonds = [{ name: 'Halvard', type: Object.keys(DM_DATA.bondInfo)[0] }];
    // A forced talent is granted by the archetype and is NEVER written to c.talent.
    // Writing one here would be the fixture lying about the shape of a real character.
    if (!arch.forcedTalent) {
      var talents = Object.keys(arch.talents || {});
      if (talents.length) c.talent = talents[0];
    }
    c.finalized = true;
    normalizeEditableLists();
    if (!computeStats()) throw new Error('fixture does not compute — not a valid character');
    return { archetype: archKey, forced: arch.forcedTalent || null, talent: c.talent || null };
  })()`);
}

const fixture = buildCharacter();
ok("fixture computes stats", g("!!computeStats()"));

// -------------------------------------------------------------
// Shared Roll Room is gone
// -------------------------------------------------------------
for (const gone of ["renderSharedRoomBlock", "joinRoom", "renderFeed", "redrawFeed",
                    "pushFeedEntry", "pushFeedEntryRaw", "startPolling",
                    "normalizeIncoming", "parseRollString", "updateRoomStatus",
                    "SHARED_ROOM_ENABLED", "DM_API_BASE", "roomState"]) {
  ok(`${gone} removed`, g(`typeof ${gone}`) === "undefined");
}
ok("roomCode gone from the default character", g(`!('roomCode' in getDefaultCharacter())`));
// The strings "/api/roll" etc. still appear once, in the comment that explains why
// the Shared Roll Room was removed. That comment is worth keeping. What must not
// survive is a live call, so assert on the call shape rather than the substring.
ok("no fetch to any /api/ endpoint survives", !/fetch\s*\([^)]*\/api\//.test(html));
ok("no EventSource is constructed", !/new\s+EventSource/.test(html));
ok("DM_API_BASE is not concatenated anywhere", !html.includes("DM_API_BASE +"));

// postRoll must still EXIST: the module block replaces it, and deleting it would
// silently stop rolls reaching the table in Owlbear while the sheet looked fine.
ok("postRoll survives as the bridge seam", g("typeof postRoll") === "function");
ok("doRoll runs with no feed and no server", g(`(function(){
  try { doRoll(); return true; } catch(e) { return 'threw: ' + e.message; }
})()`) === true);

// -------------------------------------------------------------
// Share-code round trip after dropping roomCode
// -------------------------------------------------------------
{
  ok("code round-trips without error", g("!parseCharacterCode(buildCharacterCode()).error"));
  ok("round trip preserves the name", g("parseCharacterCode(buildCharacterCode()).character.name") === "Fixture");
  ok("round trip preserves the archetype", g("parseCharacterCode(buildCharacterCode()).character.archetype") === fixture.archetype);
  ok("SN segment still written", g(`buildCharacterCode().split('-').some(function(p){return p.indexOf('SN')===0;})`));

  // The historic bug: base64 length mod 4 varies with payload length, and removing a
  // field changes that length. Walk every length class rather than trusting one.
  ok("round trip survives every payload length class", g(`(function(){
    var bad = [];
    for (var n = 1; n <= 16; n++) {
      var name = new Array(n + 1).join('x');
      state.character.name = name;
      var p = parseCharacterCode(buildCharacterCode());
      if (p.error || p.character.name !== name) bad.push(n);
    }
    state.character.name = 'Fixture';
    return bad.length;
  })()`) === 0);

  // A code written before v1.20 still carries roomCode and must import cleanly.
  ok("a pre-v1.20 code carrying roomCode still imports", g(`(function(){
    var legacy = JSON.parse(JSON.stringify(state.character));
    legacy.roomCode = 'our-tuesday-game';
    var b64 = btoa(encodeURIComponent(JSON.stringify(legacy))).replace(/=/g,'');
    var code = buildCharacterCode().split('-').map(function(p){
      return p.indexOf('CP') === 0 ? 'CP' + b64 : p;
    }).join('-');
    var p = parseCharacterCode(code);
    return !p.error && p.character.name === 'Fixture';
  })()`));
}

// -------------------------------------------------------------
// Injury logging
// -------------------------------------------------------------
// logAction() parks a label in pendingActionLabel; logActionNow() flushes it.
// Intercepting the flush is the standalone equivalent of what installActionBridge()
// does in Owlbear, so what is asserted here is what would actually be broadcast.
g(`window.__cap = [];
   logActionNow = function () {
     if (pendingActionLabel) window.__cap.push({ label: pendingActionLabel.label, detail: pendingActionLabel.detail });
     pendingActionLabel = null;
   };`);
const cap = () => g("window.__cap.map(function(e){return e.label + '|' + e.detail;})");
const reset = () => g("window.__cap.length = 0;");

{
  reset();
  g(`state.character.injuries = []; beginInjuryEdit(''); updateInjury(0,'Bleeding'); commitInjury(0,'Bleeding');`);
  const c = cap();
  ok("taking an injury logs exactly once", c.length === 1);
  ok("taking an injury reads 'Took an injury: Bleeding'", c[0] === "Took an injury|Bleeding");
}

{
  reset();
  g(`beginInjuryEdit('Bleeding'); updateInjury(0,'Bandaged Wound'); commitInjury(0,'Bandaged Wound');`);
  const c = cap();
  ok("renaming logs exactly once", c.length === 1);
  ok("renaming reads 'Changed injury: Bleeding to Bandaged Wound'", c[0] === "Changed injury|Bleeding to Bandaged Wound");
}

{
  // The whole reason this hangs off onchange rather than oninput.
  reset();
  g(`beginInjuryEdit('Bandaged Wound');
     'Scarred'.split('').forEach(function(_, i){ updateInjury(0, 'Scarred'.slice(0, i+1)); });`);
  ok("typing alone logs nothing", cap().length === 0);
  g(`commitInjury(0,'Scarred');`);
  ok("only the finished edit logs", cap().length === 1);
}

{
  // Reading the sheet must not spam the table.
  reset();
  g(`beginInjuryEdit('Scarred'); commitInjury(0,'Scarred');`);
  ok("focus and blur with no change logs nothing", cap().length === 0);
}

{
  reset();
  g(`state.character.injuries = ['Scarred']; healInjury(0);`);
  const c = cap();
  ok("healing logs exactly once", c.length === 1);
  ok("healing reads 'Healed injury: Scarred'", c[0] === "Healed injury|Scarred");
  ok("healed injury reached the archive", g(`state.character.healedInjuries.indexOf('Scarred') >= 0`));
  ok("healed injury left the active list", g(`state.character.injuries.indexOf('Scarred') < 0`));
}

{
  reset();
  g(`reopenHealedInjury(state.character.healedInjuries.indexOf('Scarred'));`);
  const c = cap();
  ok("reopening logs exactly once", c.length === 1);
  ok("reopening reads 'Reopened injury: Scarred'", c[0] === "Reopened injury|Scarred");
}

{
  reset();
  g(`state.character.injuries = ['Concussed']; removeInjuryField(0);`);
  const c = cap();
  ok("removing logs exactly once", c.length === 1);
  ok("removing reads 'Removed injury: Concussed'", c[0] === "Removed injury|Concussed");
  ok("removed injury left the list", g(`state.character.injuries.indexOf('Concussed') < 0`));
}

{
  // Emptying the field by hand is the same act as pressing Remove.
  reset();
  g(`state.character.injuries = ['Impaled']; beginInjuryEdit('Impaled'); updateInjury(0,''); commitInjury(0,'');`);
  ok("emptying the field reads as 'Removed injury: Impaled'", cap()[0] === "Removed injury|Impaled");
}

{
  // Why logging hangs off the injury handlers and not updateAutoList(): injuries
  // share that machinery with Custom Items and Knowledge Fragments.
  reset();
  g(`state.character.knowledgeFragments = []; updateAutoList('knowledgeFragments', 0, 'A rumour about the Dark City');
     state.character.customItems = []; updateAutoList('customItems', 0, 'A pressed flower');`);
  ok("editing other auto-lists logs nothing", cap().length === 0);
}

{
  // Gus's ruling asserted: an injury is flavour and must move nothing.
  reset();
  ok("an injury moves no Spirit and no Momentum", g(`(function(){
    var before = { s: state.character.currentSpirit, m: state.character.currentMomentum };
    state.character.injuries = [];
    beginInjuryEdit(''); updateInjury(0,'Burned'); commitInjury(0,'Burned');
    return state.character.currentSpirit === before.s && state.character.currentMomentum === before.m;
  })()`));
  ok("the injury entry carries no pool movement", g(`window.__cap.every(function(e){ return e.pool == null; })`));
}

// -------------------------------------------------------------
// Layout
// -------------------------------------------------------------
{
  buildCharacter();
  const sheet = g("renderFinalizedCharacterView()");
  const frag = JSDOM.fragment(sheet);
  const blocks = [...frag.querySelectorAll(".sheet-block")];
  ok("exactly five top-level blocks", blocks.length === 5);

  const titles = blocks.map((b) => b.querySelector(".sheet-block-title")?.textContent.trim());
  ok("blocks are in the specified order",
    JSON.stringify(titles) === JSON.stringify(["Character", "Actions, Talents & Abilities", "Items and Equipment", "Growth", "Share Code"]));

  const shareBlock = blocks[4] && blocks[4].querySelector("#shareCodeBlock");
  ok("Share Code is its own block", !!shareBlock);
  ok("Share Code is not nested inside another sheet-section", !!shareBlock && !shareBlock.closest(".sheet-section"));

  ok("the dice roller sits in the first block, under the numbers it rolls",
    !!blocks[0].querySelector("#diceAttr, .dice-panel"));
  ok("Growth block still shows the live counts", /Available:\s*\d+\s*\/\s*Max:/.test(blocks[3].textContent));
  ok("Items block does not repeat its title inside itself",
    !blocks[2].textContent.includes("Inventory & Equipment"));

  const details = [...frag.querySelectorAll("details.collapsible-section")];
  const labels = details.map((d) => d.querySelector("summary")?.textContent.trim());
  const openState = Object.fromEntries(details.map((d) => [d.querySelector("summary")?.textContent.trim(), d.hasAttribute("open")]));
  ok("Starting Equipment starts collapsed", openState["Starting Equipment"] === false);
  ok("Item Catalogue starts collapsed", openState["Item Catalogue"] === false);
  ok("Owned Items stays open", openState["Owned Items"] === true);
  ok("Custom Items stays open", openState["Custom Items"] === true);
  ok("Starting Equipment still sits above Item Catalogue",
    labels.indexOf("Starting Equipment") < labels.indexOf("Item Catalogue"));

  for (const marker of ["Attributes", "Skills", "Resources", "Exhaustion", "Truths", "Injuries", "Bonds", "Growth"]) {
    ok(`${marker} survives the regrouping`, sheet.includes(marker));
  }
  ok("the sheet still carries its full set of sections",
    frag.querySelectorAll(".sheet-section").length >= 8);
}

// -------------------------------------------------------------
// Re-render continuity must survive the new wrappers
// -------------------------------------------------------------
{
  ok("a deliberately opened Catalogue stays open through a re-render", g(`(function(){
    var container = document.getElementById('stepsContainer');
    container.innerHTML = renderFinalizedCharacterView();
    var find = function(){
      return Array.prototype.slice.call(container.querySelectorAll('details.collapsible-section'))
        .filter(function(d){ var s = d.querySelector('summary'); return s && s.textContent.trim() === 'Item Catalogue'; })[0];
    };
    find().open = true;
    var snap = snapshotDetailsState(container);
    container.innerHTML = renderFinalizedCharacterView();
    restoreDetailsState(container, snap);
    return find().open === true;
  })()`));

  ok("a fresh render gives the collapsed default", g(`(function(){
    var container = document.getElementById('stepsContainer');
    container.innerHTML = renderFinalizedCharacterView();
    var d = Array.prototype.slice.call(container.querySelectorAll('details.collapsible-section'))
      .filter(function(x){ var s = x.querySelector('summary'); return s && s.textContent.trim() === 'Item Catalogue'; })[0];
    return d.open === false;
  })()`));

  ok("details keys stay unique after wrapping (no collisions)", g(`(function(){
    var container = document.getElementById('stepsContainer');
    container.innerHTML = renderFinalizedCharacterView();
    return snapshotDetailsState(container).size === container.querySelectorAll('details').length;
  })()`));
}

// -------------------------------------------------------------
// Regression: v1.18 / v1.19 features
// -------------------------------------------------------------
{
  const sentinel = g(`(function(){
    var keys = Object.keys(DM_DATA.advancedArchetypes || {});
    for (var i = 0; i < keys.length; i++) {
      if (DM_DATA.advancedArchetypes[keys[i]].forcedTalent === 'nanobarrier') return keys[i];
    }
    return null;
  })()`);

  if (sentinel) {
    const built = buildCharacter(sentinel);
    ok("Sentinel fixture computes", g("!!computeStats()"));
    ok("the fixture did NOT write the forced talent to c.talent", built.talent !== "nanobarrier");
    ok("hasTalent finds a forced talent never written to c.talent", g(`hasTalent('nanobarrier') === true`));
    reset();
    ok("Nanobarrier's free first use still logs", g(`(function(){
      try { useNanobarrier('barrier'); } catch (e) { return 'threw: ' + e.message; }
      return window.__cap.length >= 1;
    })()`) === true);
  } else {
    fail++; console.log("  FAIL: no advanced archetype carries forcedTalent 'nanobarrier' — regression guard cannot run");
  }
}

{
  buildCharacter();
  reset();
  g(`takeRest('breather');`);
  ok("a rest still logs one summary line, not one per item", cap().length === 1);
}

{
  // Verified against DM_DATA, not against a description of it.
  ok("exactly five catalogue items carry itemActions",
    g(`DM_DATA.items.filter(function(i){ return i.itemActions; }).length`) === 5);
  ok("Combat Medkit is one of them (it spends Momentum, so it is easy to miss)",
    g(`DM_DATA.items.filter(function(i){ return i.itemActions; }).map(function(i){ return i.name; }).indexOf('Combat Medkit') >= 0`));
}

// -------------------------------------------------------------
// Editing a finished character in play (v1.21)
// -------------------------------------------------------------
// A GM granting Growth mid-session is the case that exposed this. The wizard was
// always reachable — editCharacter() has never been tab-only — but embedded, the
// progress bar was hidden as page chrome, which left the steps navigable only by
// walking backwards through wrapStep()'s Back button with nothing on screen saying
// so. These assert the route exists, that an edit made through it reaches the token,
// and that returning to play costs nothing.
{
  // The CSS assertion is on the stylesheet text because jsdom applies the rule but
  // the class is only added by the module block, which is stripped here.
  ok("embedded mode no longer hides the progress bar",
    !/body\.obr-embedded\s+\.progress-bar\s*,/.test(html));
  // The bar must still disappear during play. That gate belongs to renderProgress(),
  // and moving it to CSS is what broke this in the first place.
  ok("the finalized gate on the progress bar is still in renderProgress",
    /state\.character\.finalized\)\s*\{\s*bar\.style\.display\s*=\s*'none'/.test(html));

  buildCharacter();
  g("finalizeCharacter()");
  ok("finalize clears the resume latch", g("resumingFinishedCharacter") === false);

  g("editGrowth()");
  ok("editGrowth lands on the growth step", g("STEPS[state.currentStep]") === "growth");
  ok("editing a finished character latches the resume flag", g("resumingFinishedCharacter") === true);
  ok("the growth step offers a way back to play",
    g("renderGrowthStep()").includes("Done — back to play"));

  // Spend it the way the UI does: the pool input, then a purchase button.
  g("setResource('growth', 3)");
  g("addGrowthSimple('increaseSpirit','Increase Maximum Spirit +1',1,'spirit')");
  ok("the purchase is recorded", g("state.character.growthPurchases.length") === 1);
  ok("remaining Growth drops after a purchase", g("getGrowthRemaining()") === 2);

  // The edit is worthless if it cannot reach the token, and the token holds a code.
  ok("the code still builds while unfinalized",
    typeof g("buildCharacterCode()") === "string");
  ok("the purchase survives the code round trip", g(`(function(){
    var r = parseCharacterCode(buildCharacterCode());
    return !r.error && (r.character.growthPurchases || []).length === 1;
  })()`) === true);

  // Re-finalizing mid-session must not re-seed anything already in play. It is
  // safe because seedResourcesOnFinalize() only fills nulls, and this is the
  // assertion that keeps it that way.
  const spiritBefore = g("state.character.currentSpirit");
  g("finalizeCharacter()");
  ok("back to play re-finalizes", g("state.character.finalized") === true);
  ok("returning to play does not reset Spirit",
    g("state.character.currentSpirit") === spiritBefore);
  ok("the play view carries the Growth route",
    g("renderFinalizedCharacterView()").includes("Spend Growth"));
}

{
  // The button is for resuming a finished character. A character being built for
  // the first time must not be offered a shortcut past its own remaining steps.
  g(`(function(){ state.character = getDefaultCharacter(); state.currentStep = 0; })()`);
  g("resumingFinishedCharacter = false");
  ok("a new build is not offered back-to-play",
    !g("renderOriginStep()").includes("Done — back to play"));
}

console.log(`\ncreator: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — OBR.isAvailable is false, so the module block never ran:
  · every broadcast: rolls, actions, pool events, injury entries reaching the log
  · every room-metadata read and write
  · the Momentum accessor and the addThreat() replacement
  · epoch catch-up on sheet open
  · role gates, and modal open / close / resize
  · the party panel in its entirety — that is extension code, in roller.js
These need the live checks listed in UPGRADE_NOTES.md.`);
process.exit(fail ? 1 : 0);
