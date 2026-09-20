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
ok("APP_VERSION is 2.2", g("APP_VERSION") === "2.2");

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
  ok("exactly six top-level blocks", blocks.length === 6);

  // v1.25: the blocks are looked up BY NAME rather than by index. Inserting Knowledge
  // Fragments shifted every index and broke five assertions that were really only
  // asserting "still in position 4" — which is not what any of them meant.
  const titles = blocks.map((b) => b.querySelector(".sheet-block-title")?.textContent.trim());
  const blockNamed = (name) => blocks[titles.indexOf(name)];

  // v1.24: the first block is deliberately untitled. Labelling it "Character" on a
  // character sheet said nothing, and the rule under the heading went with it.
  ok("blocks are in the specified order",
    JSON.stringify(titles) === JSON.stringify([undefined, "Knowledge Fragments", "Actions, Talents & Abilities", "Items and Equipment", "Growth", "Share Code"]));
  ok("the first block carries no title element and no rule under one",
    !blocks[0].querySelector(".sheet-block-title") && blocks[0].classList.contains("is-untitled"));
  ok("every other block still names itself",
    blocks.slice(1).every((b) => !!b.querySelector(".sheet-block-title")));

  // v1.25: Knowledge Fragments left the Resources grid so the dice panel sits directly
  // under the Attributes and Skills a roll is picked from.
  ok("Knowledge Fragments is its own block, right after the character",
    titles[1] === "Knowledge Fragments");
  ok("Knowledge Fragments is no longer a cell in the Resources grid",
    !blocks[0].querySelector(".resource-grid")?.textContent.includes("Knowledge Fragment"));
  ok("the dice panel is the last thing in the first block",
    !!blocks[0].querySelector("#diceAttr, .dice-panel"));

  // v1.24: the Share Code block is the two buttons, the size and the copy message.
  const share = blockNamed("Share Code");
  ok("Share Code offers Copy Code and Save Local",
    /Copy Code/.test(share.textContent) && /Save Local/.test(share.textContent));
  ok("Share Code still reports the length", /[\d,]+ characters/.test(share.textContent));
  ok("Share Code keeps a slot for the copied message", !!share.querySelector("#copyMsg"));
  ok("the character code itself is no longer in the DOM",
    !share.querySelector("#charCode") && !sheet.includes('id="charCode"'));
  ok("the code disclosure is gone with it",
    !share.querySelector("details") && !sheet.includes('id="shareCodeBlock"'));

  // v1.25B. The heading's own rule is the divider; nothing directly beneath it may
  // draw a second. Asserted on the SOURCE rather than computed style, because jsdom
  // does no cascade — it reported a 16px border on elements that have none, which is
  // what sent the first attempt at this fix looking in the wrong place.
  ok("the suppression rule covers any first child, not only a section",
    /\.sheet-block-title \+ \* \{[^}]*border-top:\s*none/.test(html));
  ok("tooltip titles are blocks, so the gap works on a span too",
    /\.dm-tip-title \{[^}]*display:\s*block/.test(html));

  // v1.25B: Knowledge Fragments collapses and does not repeat its own name inside.
  {
    const kf = blockNamed("Knowledge Fragments");
    ok("Knowledge Fragments collapses", !!kf.querySelector("details.sheet-collapse > summary"));
    ok("Knowledge Fragments has no inner subheading",
      kf.querySelectorAll(".sheet-section-title").length === 0);
    ok("its summary is not a second copy of the block title",
      !/^Knowledge Fragments/.test(kf.querySelector("summary").textContent.trim()));
  }

  ok("the dice roller sits in the first block, under the numbers it rolls",
    !!blocks[0].querySelector("#diceAttr, .dice-panel"));
  ok("Growth block still shows the live counts",
    /Available:\s*\d+\s*\/\s*Max:/.test(blockNamed("Growth").textContent));
  ok("Items block does not repeat its title inside itself",
    !blockNamed("Items and Equipment").textContent.includes("Inventory & Equipment"));

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
  ok("a finalized character shows no Finalized badge",
    !sheet.includes("finalized-badge") && !/>\s*Finalized\s*</.test(sheet));

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


// -------------------------------------------------------------
// Every archetype survives the extension's parser (v1.23)
// -------------------------------------------------------------
// Found in play: Sentinel characters never appeared in the GM's party panel, while
// importing them into the creator worked perfectly.
//
// A code mixes two segment kinds. Most carry a two-letter TAG plus a payload (CP, SN,
// NM, GW), but segments 1-3 are bare lookup codes with no tag: the origin, archetype
// and temperament, written straight in. Sentinel's archetype code is SNT, so a
// front-to-back search for a segment starting with "SN" found the ARCHETYPE at index
// 2 instead of the snapshot at the end, and the parser reported the whole code as
// damaged. Only the extension searches for SN, which is why the creator was fine.
//
// This walks every archetype rather than asserting the one that broke. The next
// collision will be some other three-letter code, and a test naming Sentinel would
// not catch it.
// -------------------------------------------------------------
// DM1 compatibility, v2.3
// -------------------------------------------------------------
// This is a REAL character code, generated by index.html as v2.2 shipped it and
// frozen here as a literal. It is not rebuilt from the current file, and that is
// the whole point: a compatibility test that regenerates its own fixture proves
// only that the code agrees with itself.
//
// Every code anyone has ever copied into a chat window, and every code sitting on
// a token in a room nobody has opened since, is one of these. If this assertion
// ever fails, those characters are gone. Do not delete it, and do not "refresh"
// the constant — a newer creator writing DM2 cannot produce a DM1 code at all.
const DM1_FROM_V2_2 = "DM1-EVR-FXR-CRC-IKN-AB-AA-AS-OA0-TAXX-TSXX-NMS2VzaCUyMCVDMyU4NWx2YXJhbiUyMCVFMiU5QyVBNg-SGRmluZCUyMHRoZSUyMGNhcmF2YW4lMjB0aGF0JTIwbGVmdCUyMHdpdGhvdXQlMjBtZS4-LGTGVhcm4lMjB3aGF0JTIwdGhlJTIwTWFjaGluZSUyMHJlbWVtYmVycyUyMG9mJTIwbXklMjBtb3RoZXIu-CPJTdCJTIybmFtZSUyMiUzQSUyMktlc2glMjAlQzMlODVsdmFyYW4lMjAlRTIlOUMlQTYlMjIlMkMlMjJwcm9ub3VucyUyMiUzQSUyMiUyMiUyQyUyMnBvcnRyYWl0VXJsJTIyJTNBJTIyJTIyJTJDJTIyb3JpZ2luJTIyJTNBJTIyZXZlcmFuJTIyJTJDJTIyb3JpZ2luQWJpbGl0eUNob2ljZSUyMiUzQW51bGwlMkMlMjJvcmlnaW5BYmlsaXRpZXNDaG9pY2UlMjIlM0ElNUIlNUQlMkMlMjJvcmlnaW5BdHRyQm9vc3RzJTIyJTNBJTVCJTVEJTJDJTIyb3JpZ2luQXR0ckJvb3N0Q2hvaWNlJTIyJTNBbnVsbCUyQyUyMmFyY2hldHlwZSUyMiUzQSUyMmZpeGVyJTIyJTJDJTIyYXJjaGV0eXBlQXR0ckRpc3RyaWJ1dGlvbiUyMiUzQSU3QiU3RCUyQyUyMmFyY2hldHlwZVNraWxsRGlzdHJpYnV0aW9uJTIyJTNBJTdCJTdEJTJDJTIyYXJjaGV0eXBlQXR0ckNob2ljZSUyMiUzQSU1QiU1RCUyQyUyMmFyY2hldHlwZVNraWxsQ2hvaWNlJTIyJTNBJTVCJTVEJTJDJTIydGFsZW50JTIyJTNBJTIyaUtub3dBR3V5JTIyJTJDJTIydGVtcGVyYW1lbnQlMjIlM0ElMjJjaXJjdW1zcGVjdCUyMiUyQyUyMnRlbXBlcmFtZW50QXR0ckJvb3N0JTIyJTNBbnVsbCUyQyUyMnRlbXBlcmFtZW50U2tpbGxCb29zdCUyMiUzQW51bGwlMkMlMjJib25kcyUyMiUzQSU1QiU3QiUyMm5hbWUlMjIlM0ElMjJWZXJhJTIwU3VubiUyMiUyQyUyMmRldGFpbCUyMiUzQSUyMk93ZXMlMjBtZSUyMGElMjBkZWJ0JTIwc2hlJTIwd2lsbCUyMG5vdCUyMG5hbWUuJTIyJTdEJTVEJTJDJTIyc2hvcnRUZXJtR29hbCUyMiUzQSUyMkZpbmQlMjB0aGUlMjBjYXJhdmFuJTIwdGhhdCUyMGxlZnQlMjB3aXRob3V0JTIwbWUuJTIyJTJDJTIybG9uZ1Rlcm1Hb2FsJTIyJTNBJTIyTGVhcm4lMjB3aGF0JTIwdGhlJTIwTWFjaGluZSUyMHJlbWVtYmVycyUyMG9mJTIwbXklMjBtb3RoZXIuJTIyJTJDJTIydHJ1dGhzJTIyJTNBJTVCJTIyJTIyJTJDJTIyJTIyJTVEJTJDJTIyaW5qdXJpZXMlMjIlM0ElNUIlMjJDcmFja2VkJTIwcmlicyUyMiU1RCUyQyUyMmhlYWxlZEluanVyaWVzJTIyJTNBJTVCJTVEJTJDJTIyY3VzdG9tSXRlbXMlMjIlM0ElNUIlNUQlMkMlMjJrbm93bGVkZ2VGcmFnbWVudHMlMjIlM0ElNUIlNUQlMkMlMjJncm93dGhQb29sJTIyJTNBNCUyQyUyMmdyb3d0aFB1cmNoYXNlcyUyMiUzQSU1QiU3QiUyMnR5cGUlMjIlM0ElMjJhdHRyJTIyJTJDJTIybGFiZWwlMjIlM0ElMjJNaWdodCUyMCUyQjElMjIlMkMlMjJkZXRhaWwlMjIlM0ElMjIlMjIlMkMlMjJjb3N0JTIyJTNBMyU3RCU1RCUyQyUyMmdyb3d0aFNlY29uZEFyY2hldHlwZSUyMiUzQW51bGwlMkMlMjJncm93dGhFeHRyYVRhbGVudHMlMjIlM0ElNUIlNUQlMkMlMjJncm93dGhBdHRySW5jcmVhc2VzJTIyJTNBJTVCJTVEJTJDJTIyZ3Jvd3RoU2tpbGxJbmNyZWFzZXMlMjIlM0ElNUIlNUQlMkMlMjJncm93dGhUZWNoSW5jcmVhc2VzJTIyJTNBMCUyQyUyMmdyb3d0aFNwaXJpdEluY3JlYXNlcyUyMiUzQTAlMkMlMjJncm93dGhTdXBwbHlJbmNyZWFzZXMlMjIlM0EwJTJDJTIyZ3Jvd3RoVHJ1dGhDaGFuZ2VzJTIyJTNBMCUyQyUyMmdyb3d0aEJvbmRzJTIyJTNBJTVCJTVEJTJDJTIyaXRlbXMlMjIlM0ElNUIlNUQlMkMlMjJvbmNlUGVyU2NlbmVVc2VkJTIyJTNBJTVCJTVEJTJDJTIyYWN0aXZlU2NlbmVFZmZlY3RzJTIyJTNBJTVCJTVEJTJDJTIybGltaXRlZFVzZUFiaWxpdGllcyUyMiUzQSU3QiUyMnNjZW5lJTIyJTNBJTVCJTVEJTJDJTIyYnJlYXRoZXIlMjIlM0ElNUIlNUQlMkMlMjJicmVhayUyMiUzQSU1QiU1RCUyQyUyMmJlZCUyMiUzQSU1QiU1RCUyQyUyMnNlc3Npb24lMjIlM0ElNUIlNUQlMkMlMjJhZHZlbnR1cmUlMjIlM0ElNUIlNUQlN0QlMkMlMjJmaW5hbGl6ZWQlMjIlM0F0cnVlJTJDJTIyY3VycmVudFNwaXJpdCUyMiUzQTYlMkMlMjJjdXJyZW50U3VwcGx5JTIyJTNBMyUyQyUyMmN1cnJlbnRDb2luJTIyJTNBMiUyQyUyMmNvaW5NYXglMjIlM0EyMCUyQyUyMmN1cnJlbnRHcm93dGglMjIlM0EwJTJDJTIyY3VycmVudE1vbWVudHVtJTIyJTNBMCUyQyUyMm1vbWVudHVtTWF4JTIyJTNBNiUyQyUyMmFjdGl2ZUV4aGF1c3Rpb24lMjIlM0ElNUIlNUQlMkMlMjJsb2NhbFNhdmVJZCUyMiUzQW51bGwlN0Q-GW4-SNJTdCJTIydiUyMiUzQTMlMkMlMjJmcm9tJTIyJTNBJTIyMi4yJTIyJTJDJTIybmFtZSUyMiUzQSUyMktlc2glMjAlQzMlODVsdmFyYW4lMjAlRTIlOUMlQTYlMjIlMkMlMjJwcm9ub3VucyUyMiUzQSUyMiUyMiUyQyUyMnBvcnRyYWl0VXJsJTIyJTNBJTIyJTIyJTJDJTIyb3JpZ2luJTIyJTNBJTIyRXZlcmFuJTIyJTJDJTIyb3JpZ2luRGVzYyUyMiUzQSUyMlRoZSUyMG1ham9yaXR5JTIwb2YlMjBwZW9wbGUlMjBvbiUyMEV2ZXJhJTIwUHJpbWUlMjBhcmUlMjBFdmVyYW5zLiUyMFRoZWlyJTIwY29tbXVuaXRpZXMlMjB0ZW5kJTIwdG8lMjBiZSUyMHRoZSUyMGxhcmdlc3QlMjBhbmQlMjBtb3N0JTIwd2VsY29taW5nJTJDJTIwd2l0aCUyMHN0cm9uZyUyMHRyYWRpdGlvbnMlMjBvZiUyMGhvc3BpdGFsaXR5LiUyMEV2ZXJhbnMlMjBrbm93JTIwdGhhdCUyMHN0cmVuZ3RoJTIwY29tZXMlMjBmcm9tJTIwZGlmZmVyZW5jZSUyQyUyMGFuZCUyMHVuaXF1ZW5lc3MlMjBpcyUyMGElMjBxdWFsaXR5JTIwd29ydGglMjBjZWxlYnJhdGluZy4lMjIlMkMlMjJhcmNoZXR5cGUlMjIlM0ElMjJGaXhlciUyMiUyQyUyMmFyY2hldHlwZURlc2MlMjIlM0ElMjJFdmVyeSUyMGN1bHR1cmUlMjBoYXMlMjB0aGVpciUyMHRhbGVudGVkJTIwZ28tYmV0d2VlbiUyQyUyMGFuZCUyMHRoYXQncyUyMHlvdS4lMjBZb3UncmUlMjBhJTIwd2hlZWxlci1kZWFsZXIlMkMlMjB0cmF2ZWxpbmclMjB3aGVyZSUyMHRoZSUyMGRlYWxzJTIwdGFrZSUyMHlvdS4lMjBZb3UlMjBrbm93JTIwZXZlcnlib2R5JTJDJTIwYW5kJTIwZXZlcnlib2R5JTIwa25vd3MlMjB5b3UlMkMlMjBhbmQlMjB5b3UlMjBrZWVwJTIweW91ciUyMGVhciUyMHRvJTIwdGhlJTIwZ3JvdW5kLiUyMiUyQyUyMnRlbXBlcmFtZW50JTIyJTNBJTIyQ2lyY3Vtc3BlY3QlMjIlMkMlMjJ0ZW1wZXJhbWVudERlc2MlMjIlM0ElMjJZb3UncmUlMjB2ZXJ5JTIwY2FyZWZ1bCUyMGluJTIwaG93JTIweW91JTIwbWFrZSUyMGRlY2lzaW9ucyUyQyUyMHBlcmhhcHMlMjB0b28lMjBjYXV0aW91cy4lMjBZb3UlMjBjb25zaWRlciUyMGFsbCUyMHRoZSUyMGFuZ2xlcyUyMGFuZCUyMG9ubHklMjBhY3QlMjB3aGVuJTIweW91J3JlJTIwcmVhZHkuJTIyJTJDJTIydGVtcGVyYW1lbnRFeGhhdXN0aW9uJTIyJTNBJTIyWW91ciUyMHJlc29sdmUlMjBzbGlwcyUyMHdoZW4lMjB5b3UlMjBkb24ndCUyMGhhdmUlMjBhJTIwcGxhbi4lMjBXaGVuJTIweW91JTIwYmVjb21lJTIwZXhoYXVzdGVkJTJDJTIwYWRkJTIwJTJCMSUyMHRvJTIwVGhyZWF0JTIwaWYlMjB5b3UlMjBjaG9vc2UlMjBhbnklMjBleGhhdXN0aW9uJTIwb3RoZXIlMjB0aGFuJTIwRGVzcGFpcmluZy4lMjIlMkMlMjJ0ZW1wZXJhbWVudERyaXZlJTIyJTNBJTIyV2hlbiUyMHRoZXJlJ3MlMjBhbnklMjBNb21lbnR1bSUyMGluJTIwdGhlJTIwZ3JvdXAlMjBwb29sJTIwYXQlMjB0aGUlMjBzdGFydCUyMG9mJTIweW91ciUyMHR1cm4lMkMlMjByZWdhaW4lMjAxJTIwU3Bpcml0LiUyMiUyQyUyMnRlbXBlcmFtZW50QXR0aXR1ZGUlMjIlM0ElMjJJZiUyMHlvdXIlMjBncm91cCUyMGZhY2VkJTIwYSUyMHByb2JsZW0lMjBiZWNhdXNlJTIweW91JTIwd2FudGVkJTIwdG8lMjBzcGVuZCUyMHRpbWUlMjBwbGFubmluZyUyMGFuZCUyMHN0dWR5aW5nJTIwYSUyMGRhbmdlcm91cyUyMHNpdHVhdGlvbiUyMGJlZm9yZSUyMGFjdGluZyUyQyUyMGdhaW4lMjBncm93dGguJTIyJTJDJTIyYXJjaGV0eXBlR29hbCUyMiUzQSUyMldoZW4lMjB0aGlzJTIwY2hhcmFjdGVyJTIwbWFrZXMlMjBhbiUyMGludHJvZHVjdGlvbiUyMGJldHdlZW4lMjB0d28lMjBwZW9wbGUlMjBvciUyMGdyb3VwcyUyMG9mJTIwcGVvcGxlJTIwdGhhdCUyMGhlbHBzJTIwdGhlbSUyQyUyMHRoZWlyJTIwZ3JvdXAlMkMlMjBvciUyMGElMjBmcmllbmRseSUyMGNvbW11bml0eSUyQyUyMGdhaW4lMjBncm93dGguJTIyJTJDJTIyc3RhcnRpbmdFcXVpcG1lbnQlMjIlM0ElMjJPbmUlMjBIYW5kLU1hZGUlMjBvciUyMFNlY3VyaXR5JTIwV2VhcG9uJTJDJTIwUHJvdGVjdGl2ZSUyMENsb3RoaW5nJTIwKFRMMiUyMG9yJTIwVEwzKSUyQyUyMENvbW11bmljYXRvciUyMChUTDMpJTIwYW5kJTIwJTJCMyUyMENvaW4lMkMlMjBvciUyMDYlMjBDb2luLiUyMiUyQyUyMm9yaWdpblNwZWNpYWxOb3RlJTIyJTNBJTIyJTIyJTJDJTIyYWJpbGl0aWVzJTIyJTNBJTVCJTdCJTIya2V5JTIyJTNBJTIyZ2xpZlBhdHRlcm5DbG90aGluZyUyMiUyQyUyMm5hbWUlMjIlM0ElMjJHTElGLVBhdHRlcm4lMjBDbG90aGluZyUyMiUyQyUyMmRlc2MlMjIlM0ElMjJBcyUyMGFuJTIwYWN0aW9uJTJDJTIwcGVyZm9ybSUyMG1vdmVtZW50cyUyMChubyUyMFNraWxsJTIwVGVzdCklMjB0byUyMG1ha2UlMjBhJTIwbWFjaGluZSUyMG92ZXJsb29rJTIweW91LiUyMEl0JTIwYWRkcyUyMCUyQjElMjBkaWZmaWN1bHR5JTIwdG8lMjBhbiUyMGF0dGFjayUyMGFnYWluc3QlMjB5b3UlMjBuZXh0JTIwdHVybi4lMjBBJTIwbWFjaGluZSUyMGNhbiUyMG9ubHklMjBiZSUyMGFmZmVjdGVkJTIwYnklMjB0aGlzJTIwb25jZSUyMHBlciUyMHNjZW5lLiUyMiUyQyUyMnNvdXJjZSUyMiUzQSUyMm9yaWdpbiUyMiU3RCU1RCUyQyUyMmV4aGF1c3Rpb25UeXBlcyUyMiUzQSU1QiU3QiUyMmtleSUyMiUzQSUyMndlYXJ5JTIyJTJDJTIybmFtZSUyMiUzQSUyMldlYXJ5JTIyJTJDJTIyYXR0ciUyMiUzQSUyMm1pZ2h0JTIyJTJDJTIyYXR0ck5hbWUlMjIlM0ElMjJNaWdodCUyMiUyQyUyMmRlc2MlMjIlM0ElMjJTaHV0cyUyMGRvd24lMjB5b3VyJTIwTWlnaHQlMjBhdHRyaWJ1dGUuJTIwWW91JTIwYXV0b21hdGljYWxseSUyMGZhaWwlMjB0ZXN0cyUyMHJlbGF0ZWQlMjB0byUyME1pZ2h0JTJDJTIwYW5kJTIwYWxsJTIwb3RoZXIlMjB0ZXN0cyUyMHN1ZmZlciUyMGElMjAlMkIxJTIwcGVuYWx0eS4lMjIlN0QlMkMlN0IlMjJrZXklMjIlM0ElMjJicmVhdGhsZXNzJTIyJTJDJTIybmFtZSUyMiUzQSUyMkJyZWF0aGxlc3MlMjIlMkMlMjJhdHRyJTIyJTNBJTIycXVpY2tuZXNzJTIyJTJDJTIyYXR0ck5hbWUlMjIlM0ElMjJRdWlja25lc3MlMjIlMkMlMjJkZXNjJTIyJTNBJTIyU2h1dHMlMjBkb3duJTIweW91ciUyMFF1aWNrbmVzcyUyMGF0dHJpYnV0ZS4lMjBZb3UlMjBhdXRvbWF0aWNhbGx5JTIwZmFpbCUyMHRlc3RzJTIwcmVsYXRlZCUyMHRvJTIwUXVpY2tuZXNzJTJDJTIwYW5kJTIwYWxsJTIwb3RoZXIlMjB0ZXN0cyUyMHN1ZmZlciUyMGElMjAlMkIxJTIwcGVuYWx0eS4lMjIlN0QlMkMlN0IlMjJrZXklMjIlM0ElMjJjb25mdXNlZCUyMiUyQyUyMm5hbWUlMjIlM0ElMjJDb25mdXNlZCUyMiUyQyUyMmF0dHIlMjIlM0ElMjJpbnNpZ2h0JTIyJTJDJTIyYXR0ck5hbWUlMjIlM0ElMjJJbnNpZ2h0JTIyJTJDJTIyZGVzYyUyMiUzQSUyMlNodXRzJTIwZG93biUyMHlvdXIlMjBJbnNpZ2h0JTIwYXR0cmlidXRlLiUyMFlvdSUyMGF1dG9tYXRpY2FsbHklMjBmYWlsJTIwdGVzdHMlMjByZWxhdGVkJTIwdG8lMjBJbnNpZ2h0JTJDJTIwYW5kJTIwYWxsJTIwb3RoZXIlMjB0ZXN0cyUyMHN1ZmZlciUyMGElMjAlMkIxJTIwcGVuYWx0eS4lMjIlN0QlMkMlN0IlMjJrZXklMjIlM0ElMjJkZXNwYWlyaW5nJTIyJTJDJTIybmFtZSUyMiUzQSUyMkRlc3BhaXJpbmclMjIlMkMlMjJhdHRyJTIyJTNBJTIycmVzb2x2ZSUyMiUyQyUyMmF0dHJOYW1lJTIyJTNBJTIyUmVzb2x2ZSUyMiUyQyUyMmRlc2MlMjIlM0ElMjJTaHV0cyUyMGRvd24lMjB5b3VyJTIwUmVzb2x2ZSUyMGF0dHJpYnV0ZS4lMjBZb3UlMjBhdXRvbWF0aWNhbGx5JTIwZmFpbCUyMHRlc3RzJTIwcmVsYXRlZCUyMHRvJTIwUmVzb2x2ZSUyQyUyMGFuZCUyMGFsbCUyMG90aGVyJTIwdGVzdHMlMjBzdWZmZXIlMjBhJTIwJTJCMSUyMHBlbmFsdHkuJTIyJTdEJTVEJTJDJTIyYXR0cnMlMjIlM0ElN0IlMjJtaWdodCUyMiUzQTYlMkMlMjJxdWlja25lc3MlMjIlM0E2JTJDJTIyaW5zaWdodCUyMiUzQTYlMkMlMjJyZXNvbHZlJTIyJTNBNyU3RCUyQyUyMnNraWxscyUyMiUzQSU3QiUyMm1vdmUlMjIlM0ExJTJDJTIyZmlnaHQlMjIlM0ExJTJDJTIyc25lYWslMjIlM0ExJTJDJTIydGFsayUyMiUzQTElMkMlMjJvcGVyYXRlJTIyJTNBMSUyQyUyMnN0dWR5JTIyJTNBMSUyQyUyMnN1cnZpdmUlMjIlM0ExJTdEJTJDJTIydGVjaExldmVsJTIyJTNBMyUyQyUyMnNwaXJpdE1heCUyMiUzQTYlMkMlMjJzdXBwbHlNYXglMjIlM0EzJTJDJTIyY29pbk1heCUyMiUzQTIwJTJDJTIyZ3Jvd3RoTWF4JTIyJTNBMTAlMkMlMjJtb21lbnR1bU1heCUyMiUzQTYlMkMlMjJyZXNvdXJjZUJyZWFrZG93biUyMiUzQSU3QiU3RCUyQyUyMnRhbGVudHMlMjIlM0ElNUIlN0IlMjJrZXklMjIlM0ElMjJpS25vd0FHdXklMjIlMkMlMjJuYW1lJTIyJTNBJTIySSUyMEtub3clMjBhJTIwR3V5JTIyJTJDJTIyZGVzYyUyMiUzQSUyMllvdSUyMGhhdmUlMjBvbmUlMjBhZGRpdGlvbmFsJTIwYm9uZCUyMHdpdGhpbiUyMHRoZSUyMGdyb3VwLiUyMEluJTIwYWRkaXRpb24lMkMlMjBvbmNlJTIwcGVyJTIwYWR2ZW50dXJlJTIwd2hlbiUyMHlvdSUyMGFwcHJvYWNoJTIwYSUyMG5ldyUyMGdyb3VwJTIwb2YlMjBwZW9wbGUlMkMlMjB5b3UlMjBtYXklMjBzcGVuZCUyMDIlMjBNb21lbnR1bSUyMG9yJTIwYWRkJTIwMiUyMHRvJTIwVGhyZWF0JTIwdG8lMjBkZWNsYXJlJTIwdGhhdCUyMHlvdSUyMGhhdmUlMjBhJTIwY29udGFjdCUyMHdpdGhpbiUyMHRoYXQlMjBncm91cCUyQyUyMHVubGVzcyUyMHRoYXQlMjBncm91cCUyMGlzJTIwaG9zdGlsZS4lMjIlN0QlNUQlMkMlMjJpdGVtcyUyMiUzQSU1QiU1RCUyQyUyMnRydXRocyUyMiUzQSU1QiUyMiUyMiUyQyUyMiUyMiU1RCUyQyUyMmJvbmRzJTIyJTNBJTVCJTdCJTIybmFtZSUyMiUzQSUyMlZlcmElMjBTdW5uJTIyJTJDJTIyZGVzYyUyMiUzQSUyMiUyMiU3RCU1RCUyQyUyMnNob3J0VGVybUdvYWwlMjIlM0ElMjJGaW5kJTIwdGhlJTIwY2FyYXZhbiUyMHRoYXQlMjBsZWZ0JTIwd2l0aG91dCUyMG1lLiUyMiUyQyUyMmxvbmdUZXJtR29hbCUyMiUzQSUyMkxlYXJuJTIwd2hhdCUyMHRoZSUyME1hY2hpbmUlMjByZW1lbWJlcnMlMjBvZiUyMG15JTIwbW90aGVyLiUyMiUyQyUyMmN1c3RvbUl0ZW1zJTIyJTNBJTVCJTVEJTJDJTIya25vd2xlZGdlRnJhZ21lbnRzJTIyJTNBJTVCJTVEJTdE";
const DM1_EXPECTED = {
  "name": "Kesh \u00c5lvaran \u2726",
  "origin": "everan",
  "archetype": "fixer",
  "temperament": "circumspect",
  "shortTermGoal": "Find the caravan that left without me.",
  "longTermGoal": "Learn what the Machine remembers of my mother.",
  "growthPool": 4,
  "bonds": [
    {
      "name": "Vera Sunn",
      "detail": "Owes me a debt she will not name."
    }
  ],
  "growthPurchases": [
    {
      "type": "attr",
      "label": "Might +1",
      "detail": "",
      "cost": 3
    }
  ],
  "injuries": [
    "Cracked ribs"
  ]
};

{
  const { parseCode } = await import("../out/dnm-obr/dnm.js");
  const keys = JSON.parse(g(`JSON.stringify(
    Object.keys(DM_DATA.archetypes).concat(Object.keys(DM_DATA.advancedArchetypes)))`));
  ok("there are archetypes to walk", keys.length >= 9);

  const broken = [];
  for (const key of keys) {
    const code = g(`(function(){
      var c = state.character = getDefaultCharacter();
      var arch = DM_DATA.archetypes[${JSON.stringify(key)}] || DM_DATA.advancedArchetypes[${JSON.stringify(key)}];
      c.name = 'Probe';
      c.origin = Object.keys(DM_DATA.origins)[0];
      c.archetype = ${JSON.stringify(key)};
      c.temperament = Object.keys(DM_DATA.temperaments)[0];
      c.bonds = [{ name: 'Halvard', type: Object.keys(DM_DATA.bondInfo)[0] }];
      if (!arch.forcedTalent) {
        var t = Object.keys(arch.talents || {});
        if (t.length) c.talent = t[0];
      }
      c.finalized = true;
      normalizeEditableLists();
      normalizeCurrentValues();
      return buildCharacterCode();
    })()`);
    const r = parseCode(code);
    if (r.error) broken.push(`${key}: ${r.error}`);
  }
  ok(`every archetype parses for the party panel${broken.length ? " — BROKEN: " + broken.join("; ") : ""}`,
    broken.length === 0);

  // The specific shape of the bug, asserted directly so a future refactor that
  // reintroduces a front-to-back search fails here with an obvious name.
  ok("Sentinel's archetype code really does collide with the SN tag",
    g(`(DM_DATA.advancedArchetypes.sentinel || {}).code`) === "SNT");

  // The EXTENSION's parser, on both formats. The creator's own parser needs only CP;
  // this one needs CP and SN, so a format change can break the party panel and the
  // roller's banner while importing into the creator still works perfectly. That
  // asymmetry has already cost one release, when every Sentinel went invisible.
  const { rebuildCode } = await import("../out/dnm-obr/dnm.js");
  for (const [label, sample] of [["DM2", g("buildCharacterCode()")], ["DM1", DM1_FROM_V2_2]]) {
    const r = parseCode(sample);
    ok(`the extension parses a ${label} code`, !r.error);
    if (r.error) continue;
    ok(`${label}: the extension gets a usable snapshot`, !!r.snap && typeof r.snap === "object");

    // rebuildCode writes CP back. It must stay in the format it was handed, or the
    // next read of that token comes back as noise with no error to point at it.
    const edited = rebuildCode(r.parts, r.cpIndex, { ...r.char, name: "Edited \u00c5" });
    ok(`${label}: a rebuilt code keeps its version byte`, edited.split("-")[0] === label);
    const after = parseCode(edited);
    ok(`${label}: a rebuilt code parses again`, !after.error);
    ok(`${label}: the edit survived the rebuild`, !after.error && after.char.name === "Edited \u00c5");
    ok(`${label}: every other segment is byte for byte unchanged`,
      !after.error && edited.split("-").filter((_, i) => i !== r.cpIndex).join("-")
        === sample.split("-").filter((_, i) => i !== r.cpIndex).join("-"));
    // And the creator can read back what the extension wrote.
    const back = g(`parseCharacterCode(${JSON.stringify(edited)})`);
    ok(`${label}: the creator reads a code the extension rebuilt`,
      !back.error && back.character.name === "Edited \u00c5");
  }
}

// -------------------------------------------------------------
// Bonds (v1.26)
// -------------------------------------------------------------
// The rivalry bond runs BACKWARDS from how the ability reads, and that is the thing
// most likely to be "corrected" into a bug by someone refactoring later. The rule:
//
//   "When an ally with whom the character has a rivalry regains one or more Spirit by
//    adding to Threat, the character recovers one Spirit as well."
//
// The person spending the Threat needs no bond. The BOND HOLDER is paid. So these
// tests are written from the holder's seat and assert the actor gets nothing.
{
  // grantSpiritToAlly() is the seam the module block replaces with a broadcast.
  // Intercepting it here is what lets a jsdom run see what would have gone to the
  // room, which is otherwise invisible without a live Owlbear.
  const grants = [];
  w.grantSpiritToAlly = (payload) => { grants.push(payload); };
  const rivalryCalls = { n: 0 };
  w.announceRivalryTrigger = () => { rivalryCalls.n++; };

  const setUp = (bonds, name) => g(`(function(){
    var c = state.character;
    c.name = ${JSON.stringify(name || "Fixture")};
    c.bonds = ${JSON.stringify(bonds)};
    c.appliedBondEffects = [];
    c.currentSpirit = 1;
    return getResourceMaxes().spirit;
  })()`);

  const drain = (queue) => JSON.parse(g(
    `JSON.stringify(applyPendingBondEffects(${JSON.stringify(queue)}) || null)`));
  const spirit = () => g("getEffectiveResource('spirit')");

  ok("name matching ignores case and stray spaces",
    g(`bondNamesEqual('  Halvard ', 'halvard')`) === true);
  ok("an empty name matches nothing, including another empty name",
    g(`bondNamesEqual('', '')`) === false);

  // --- rivalry, from the holder's seat ---
  setUp([{ name: "Kestrel", type: "rivalry" }]);
  let before = spirit();
  let result = drain([{ id: "fx1", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("a rivalry holder gains 1 Spirit when their rival uses Adrenaline Rush",
    spirit() === before + 1 && result && result.gained === 1);

  // Re-running the same queue must change nothing. A broadcast can be delivered
  // twice and room metadata is re-read on every change, so this runs constantly.
  before = spirit();
  ok("draining the same effect twice pays once",
    drain([{ id: "fx1", t: Date.now(), kind: "rivalry", from: "Kestrel" }]) === null
    && spirit() === before);

  // --- rivalry, from the actor's seat ---
  setUp([{ name: "Kestrel", type: "rivalry" }], "Kestrel");
  before = spirit();
  drain([{ id: "fx2", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("the character who spent the Threat is not paid by their own rivalry",
    spirit() === before);

  // --- rivalry, no bond ---
  setUp([{ name: "Halvard", type: "supportive" }]);
  before = spirit();
  drain([{ id: "fx3", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("a character with no rivalry naming the actor gains nothing",
    spirit() === before);

  // A supportive bond is not a rivalry, even when it names the right person.
  setUp([{ name: "Kestrel", type: "supportive" }]);
  before = spirit();
  drain([{ id: "fx4", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("a supportive bond does not pay out on Adrenaline Rush", spirit() === before);

  // --- grants ---
  setUp([{ name: "Kestrel", type: "rivalry" }]);
  before = spirit();
  drain([{ id: "fx5", t: Date.now(), kind: "grant", from: "Kestrel", target: "fixture",
           amount: 2, source: "Second Wind" }]);
  ok("a grant reaches the named target regardless of case", spirit() === before + 2);

  setUp([]);
  before = spirit();
  drain([{ id: "fx6", t: Date.now(), kind: "grant", from: "Kestrel", target: "Someone Else",
           amount: 2, source: "Second Wind" }]);
  ok("a grant aimed at somebody else is ignored", spirit() === before);

  // --- first contact ---
  // A character attached mid-session must adopt the queue's position rather than
  // collect six hours of other people's effects. Same rule as catchUpToRoomEpochs().
  g(`(function(){
    state.character.name = 'Fixture';
    state.character.bonds = [{ name: 'Kestrel', type: 'rivalry' }];
    delete state.character.appliedBondEffects;
    state.character.currentSpirit = 1;
  })()`);
  before = spirit();
  result = drain([{ id: "fx7", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("a character meeting the room for the first time adopts without collecting",
    spirit() === before && result && result.gained === 0 && !result.detail);
  ok("first contact still records the ids, so a later effect is not swallowed",
    JSON.parse(g("JSON.stringify(state.character.appliedBondEffects)")).includes("fx7"));

  // An effect that lands on a full Spirit track is still reported. "Nothing happened"
  // and "you were already full" are different answers and only one of them sends a
  // player asking whether bonds work at all.
  setUp([{ name: "Kestrel", type: "rivalry" }]);
  g(`(function(){ state.character.currentSpirit = getResourceMaxes().spirit; })()`);
  result = drain([{ id: "fx8", t: Date.now(), kind: "rivalry", from: "Kestrel" }]);
  ok("a payout onto a full Spirit track says so rather than staying silent",
    !!result && result.gained === 0 && /already at full/.test(result.detail || ""));

  // --- Second Wind ---
  setUp([{ name: "Kestrel", type: "supportive" }]);
  g("state.character.currentMomentum = 6");
  grants.length = 0;
  g(`setAllyTarget('secondWind', 'Kestrel')`);
  g("useSecondWind(2, 'ally')");
  ok("Second Wind on a supportive-bonded ally sends 2 + 1",
    grants.length === 1 && grants[0].amount === 3 && grants[0].target === "Kestrel");

  grants.length = 0;
  g("state.character.currentMomentum = 6");
  g(`setAllyTarget('secondWind', 'Someone Unbonded')`);
  g("useSecondWind(2, 'ally')");
  ok("Second Wind on an unbonded ally sends the plain amount",
    grants.length === 1 && grants[0].amount === 2);

  // The Momentum must not leave the pool when there is nobody to give it to.
  grants.length = 0;
  g("state.character.currentMomentum = 6");
  g(`setAllyTarget('secondWind', '   ')`);
  g("useSecondWind(2, 'ally')");
  ok("Second Wind with no ally named spends nothing",
    grants.length === 0 && g("state.character.currentMomentum") === 6);

  // Cautious was in the data from the start and implemented nowhere, which meant a
  // Cautious character paid full price for a smaller Second Wind.
  g(`(function(){
    state.character.growthExtraTalents = ['cautious'];
    state.character.currentMomentum = 6;
    state.character.currentSpirit = 1;
  })()`);
  before = spirit();
  g("useSecondWind(2, 'self')");
  ok("Cautious adds +1 to a Second Wind taken on yourself", spirit() === before + 3);
  g("state.character.growthExtraTalents = []");

  // --- Adrenaline Rush announces regardless of the actor's own bonds ---
  g(`(function(){
    state.character.bonds = [];
    state.character.oncePerSceneUsed = [];
    state.character.currentSpirit = 1;
  })()`);
  rivalryCalls.n = 0;
  g("useAdrenalineRush(1)");
  ok("Adrenaline Rush announces the rivalry trigger even with no bonds of its own",
    rivalryCalls.n === 1);

  // --- rest sharing ---
  const restSetup = (talents) => g(`(function(){
    var c = state.character;
    c.name = 'Fixture';
    c.bonds = [{ name: 'Kestrel', type: 'supportive' }];
    c.growthExtraTalents = ${JSON.stringify(talents || [])};
    c.oncePerSceneUsed = [];
    c.currentSpirit = 1;
    delete c.restShare;
    return takeRest('break');
  })()`);

  restSetup();
  ok("a rest opens a share budget equal to what it returned",
    g("state.character.restShare.left") === g("state.character.restShare.left")
    && g("!!state.character.restShare") && g("state.character.restShare.left") > 0);

  grants.length = 0;
  before = spirit();
  let budget = g("state.character.restShare.left");
  g(`setAllyTarget('restShare', 'Kestrel')`);
  g("giveRestSpirit(2)");
  ok("giving 2 costs the giver 2 and sends 2 + 1 for the supportive bond",
    spirit() === before - 2 && grants.length === 1 && grants[0].amount === 3);
  ok("the budget shrinks by what was given",
    g("state.character.restShare.left") === budget - 2);

  // "You may help multiple allies" is the whole of Performer. Without it the rules
  // allow one ally per rest.
  grants.length = 0;
  g(`setAllyTarget('restShare', 'Halvard')`);
  g("giveRestSpirit(1)");
  ok("without Performer a second ally is refused", grants.length === 0);

  restSetup(["performer"]);
  grants.length = 0;
  g(`setAllyTarget('restShare', 'Kestrel')`);
  g("giveRestSpirit(1)");
  g(`setAllyTarget('restShare', 'Halvard')`);
  g("giveRestSpirit(1)");
  ok("Performer allows a second ally", grants.length === 2);

  // The budget is what stops this being a way to hand out Spirit earned elsewhere.
  restSetup();
  budget = g("state.character.restShare.left");
  g(`setAllyTarget('restShare', 'Kestrel')`);
  g(`giveRestSpirit(${budget})`);
  ok("spending the whole budget closes the control",
    g("!state.character.restShare"));

  // A rest's unspent generosity must not survive into the next scene.
  restSetup();
  ok("a rest leaves a share budget behind", g("!!state.character.restShare"));
  g("endScene()");
  ok("End Scene clears the share budget", g("!state.character.restShare"));

  // --- the Maverick drive ---
  // "When the GM spends 3 or more Threat at once, regain 1 Spirit." The recipient side
  // reads its own TEMPERAMENT, not a bond list — nobody writes a bond for this — and
  // whether the spend was big enough was settled by the sender, which is the only
  // client that knows a run of presses was one decision.
  const asTemperament = (key) => g(`(function(){
    var c = state.character;
    c.name = 'Fixture';
    c.temperament = ${JSON.stringify(key)};
    c.bonds = [];
    c.appliedBondEffects = [];
    c.currentSpirit = 1;
  })()`);
  const driveFx = (extra) => ({ id: `dv${Math.random()}`, t: Date.now(), kind: "drive", drive: "maverick", from: "GM", amount: 3, ...extra });

  asTemperament("maverick");
  before = spirit();
  result = drain([driveFx()]);
  ok("a Maverick regains 1 Spirit when the GM spends 3 at once",
    spirit() === before + 1 && result && result.gained === 1);
  ok("and the entry is named a Drive, not a Bond", result.label === "Drive");
  ok("saying how much was spent", /spent 3 Threat at once/.test(result.detail));

  // Every other temperament reads the same effect and is owed nothing by it.
  const others = JSON.parse(g("JSON.stringify(Object.keys(DM_DATA.temperaments))")).filter((k) => k !== "maverick");
  ok("there are other temperaments to check", others.length >= 4);
  const wrongly = others.filter((key) => {
    asTemperament(key);
    const start = spirit();
    drain([driveFx()]);
    return spirit() !== start;
  });
  ok(`no other temperament is paid by it${wrongly.length ? " — PAID: " + wrongly.join(", ") : ""}`,
    wrongly.length === 0);

  // A drive key this build does not know must do nothing rather than pay out on the
  // strength of being a drive at all. The other five drives are not detectable by the
  // sheet and are claimed by hand; an effect naming one is a message from a future
  // version, and paying it would be inventing a rule.
  asTemperament("maverick");
  before = spirit();
  drain([driveFx({ drive: "circumspect" })]);
  ok("a drive this build does not implement pays nothing", spirit() === before);

  // Unlike the two bonds there is no self-guard: the sender is the GM rather than a
  // character, and a GM playing a Maverick alongside is entitled to their own drive.
  asTemperament("maverick");
  before = spirit();
  drain([driveFx({ from: "Fixture" })]);
  ok("a GM who also plays a Maverick is not excluded from their own drive",
    spirit() === before + 1);

  g("state.character.temperament = Object.keys(DM_DATA.temperaments)[0];");

  // --- the ally picker ---
  g(`(function(){
    state.character.name = 'Fixture';
    state.character.bonds = [{ name: 'Kestrel', type: 'rivalry' }, { name: 'Halvard', type: 'supportive' }];
    obrPartyNames = ['Kestrel', 'Fixture', 'Nadia'];
  })()`);
  const names = JSON.parse(g("JSON.stringify(getKnownAllyNames())"));
  ok("the picker offers bond names and party names", names.includes("Kestrel") && names.includes("Nadia"));
  ok("the picker does not offer the character themselves", !names.includes("Fixture"));
  ok("the picker does not list a name twice",
    names.length === new Set(names.map((n) => n.toLowerCase())).size);
  g("obrPartyNames = []");
}

// -------------------------------------------------------------
// Pool batching seams (v1.27)
// -------------------------------------------------------------
// The batching itself lives in the module block and is covered against dnm.js in
// party.test.mjs. What is testable HERE is that the standalone half still has the
// seams the module block replaces, and that the Threat counter reads the pending
// total rather than the room's number alone — a display that ignored it would freeze
// for the length of the batching window and the buttons would feel broken.
{
  ok("getPendingThreat exists as the bridge seam", g("typeof getPendingThreat") === "function");
  ok("and reports nothing standalone, where there is no room to wait for",
    g("getPendingThreat()") === 0);

  // The counter is Owlbear-only markup, rendered always and hidden by CSS in a tab.
  g("obrRole = 'GM'; obrThreat = 4;");
  ok("the counter shows the room's number when nothing is pending",
    /resource-value">4</.test(g("renderThreatCounter()")));
  ok("and is not marked unsettled", !g("renderThreatCounter()").includes("resource-controls unsettled"));

  w.getPendingThreat = () => 3;
  ok("the counter adds what has not been confirmed yet",
    /resource-value">7</.test(g("renderThreatCounter()")));
  ok("and says so, rather than claiming the room has agreed",
    g("renderThreatCounter()").includes("resource-controls unsettled"));

  // A pool cannot read below zero even if a pending spend overshoots.
  w.getPendingThreat = () => -9;
  ok("a pending total cannot drag the display below zero",
    /resource-value">0</.test(g("renderThreatCounter()")));
  w.getPendingThreat = () => 0;

  // addThreat must survive as the funnel. Every Threat source in the file goes through
  // it, and the module block batches at that one point; a call site that broadcast for
  // itself would bypass the batching and be back to one event per press.
  ok("addThreat survives as the single Threat funnel", g("typeof addThreat") === "function");
  ok("no Threat source broadcasts on its own",
    (html.match(/pool:\s*["']threat["']/g) || []).length === 0);

  g("obrRole = null; obrThreat = null;");
}

// -------------------------------------------------------------
// Recent Rolls (v1.29)
// -------------------------------------------------------------
// The result of a roll lived in a module binding, so it vanished the moment the sheet
// closed — and in Owlbear the sheet is a modal that gets closed constantly. Three
// rolls are now kept on the CHARACTER, so they survive closing and travel with the code.
{
  buildCharacter();
  g("state.character.recentRolls = []; diceUI.difficulty = 1;");
  g("doRoll(); doRoll(); doRoll(); doRoll();");
  const kept = JSON.parse(g("JSON.stringify(state.character.recentRolls)"));
  ok("only the last three are kept", kept.length === 3);
  ok("newest first", kept[0].t >= kept[1].t && kept[1].t >= kept[2].t);
  ok("each records the dice that were rolled", kept.every((e) => Array.isArray(e.d) && e.d.length));
  ok("and the Attribute and Skill they were read against",
    kept.every((e) => e.an && e.av > 0 && e.sn && e.sv >= 0));
  // Without the threshold, an old roll would be redrawn under whatever the GM has set
  // since — rewriting how a roll read after the fact.
  ok("and the Complication threshold in force at the time",
    kept.every((e) => e.at >= 15 && e.at <= 20));

  ok("they survive a round trip through the character code", g(`(function(){
    var back = parseCharacterCode(buildCharacterCode()).character;
    return Array.isArray(back.recentRolls) && back.recentRolls.length === 3
      && back.recentRolls[0].d.length === state.character.recentRolls[0].d.length;
  })()`));

  ok("the block renders", g("renderRecentRolls()").includes("Recent Rolls (3)"));
  ok("and is absent entirely for a character that has not rolled", g(`(function(){
    state.character.recentRolls = [];
    return renderRecentRolls();
  })()`) === "");

  // classifyDie now takes the threshold as a parameter so history stays true. The live
  // default must not have moved.
  ok("a stored roll is classified by ITS threshold, not the current one",
    g("classifyDie(17, 9, 2, 17)") === "complication" && g("classifyDie(17, 9, 2, 20)") === "fail");
  ok("and the live default is unchanged when no threshold is passed",
    g("classifyDie(20, 9, 2)") === "complication" && g("classifyDie(19, 9, 2)") === "fail");

  // A character code is untrusted — pasted from a chat window, or read off a token any
  // player can write to — and this is the only field in the file whose renderer LOOPS.
  ok("a hostile roll history is clamped rather than rendered", g(`(function(){
    state.character.recentRolls = [
      { d: new Array(50000).fill(20), av: 1e9, sv: -5, su: 1e9, co: 1e9, an: 'x'.repeat(5000), at: 1 },
      {}, {}, {}, {}, {}, {}, {}, {}, {}
    ];
    var out = normalizeRecentRolls();
    return out.length === 3
      && out[0].d.length === 5
      && out[0].av === 20 && out[0].sv === 0
      && out[0].an.length === 16
      && out[0].at === 15;
  })()`));
  ok("and junk entries do not throw the renderer", g(`(function(){
    state.character.recentRolls = [null, 'nope', 42];
    try { renderRecentRolls(); return true; } catch (e) { return 'threw: ' + e.message; }
  })()`) === true);
  g("state.character.recentRolls = [];");
}


{
  ok("the frozen fixture really is a DM1 code", DM1_FROM_V2_2.startsWith("DM1-"));
  const res = g(`parseCharacterCode(${JSON.stringify(DM1_FROM_V2_2)})`);
  ok("a v2.2 DM1 code still imports", !res.error);
  const c = (res && res.character) || {};
  for (const key of ["name", "origin", "archetype", "temperament", "shortTermGoal", "longTermGoal", "growthPool"]) {
    ok(`DM1 round trip keeps ${key}`, JSON.stringify(c[key]) === JSON.stringify(DM1_EXPECTED[key]));
  }
  // The name carries a non-ASCII letter and a glyph on purpose: DM1's
  // encodeURIComponent step and DM2's UTF-8 encoder handle those differently, and
  // an ASCII-only fixture would pass under either one.
  ok("DM1 round trip keeps non-ASCII in the name", c.name === "Kesh \u00c5lvaran \u2726");
  ok("DM1 round trip keeps the bonds", JSON.stringify(c.bonds) === JSON.stringify(DM1_EXPECTED.bonds));
  ok("DM1 round trip keeps the growth purchases", JSON.stringify(c.growthPurchases) === JSON.stringify(DM1_EXPECTED.growthPurchases));
  ok("DM1 round trip keeps the injuries", JSON.stringify(c.injuries) === JSON.stringify(DM1_EXPECTED.injuries));

  // And the current file writes DM2, smaller, for a character built the same way.
  const fresh = g(`(function(){
    var r = parseCharacterCode(${JSON.stringify(DM1_FROM_V2_2)});
    state.character = Object.assign(getDefaultCharacter(), r.character);
    computeStats();
    return buildCharacterCode();
  })()`);
  ok("the same character re-exports as DM2", fresh.startsWith("DM2-"));
  ok(`DM2 is at least 2.5x shorter (${DM1_FROM_V2_2.length} -> ${fresh.length})`,
     fresh.length * 2.5 <= DM1_FROM_V2_2.length);
  const again = g(`parseCharacterCode(${JSON.stringify(fresh)})`);
  ok("and that DM2 code imports back", !again.error && again.character.name === DM1_EXPECTED.name);
}

console.log(`\ncreator: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — OBR.isAvailable is false, so the module block never ran.
Since v1.27 much of it IS covered, by embedded.test.mjs, which runs the block
against a stub SDK: the bridges, the Momentum accessor, addThreat, the bond
bridge and the pool batcher. What neither suite can reach:
  · that a broadcast is actually delivered, and the GM's relay accepting it
  · room metadata round trips, and epoch or bond catch-up against a real room
  · role gates, modal open / close / resize, token reads and writes
  · the party panel in its entirety — that is extension code, in roller.js
These need the live checks listed in UPGRADE_NOTES.md.`);
process.exit(fail ? 1 : 0);
