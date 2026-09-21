// =============================================================
// Layout in a real browser — creator v2.1D
// -------------------------------------------------------------
// The other five suites run in jsdom, which does NO CASCADE: it will happily report
// borders and computed styles that do not exist, and it cannot lay anything out. So none
// of them can see the class of bug this file exists for — an element that overflows its
// panel, or a flex child that collapses to zero width and drops its contents on top of
// its neighbours.
//
// That is not hypothetical. In 2.1 the docked sheet at its narrowest put the Roll button
// 19px past the edge of the panel and dropped an item's tags across its own buttons, and
// every suite was green. The cause in both cases was the same and is worth naming: a flex
// or grid child with min-width:0 shrinks to NOTHING rather than wrapping, and a grid with
// a bare minmax(280px, 1fr) will not go below 280px however narrow its container is.
//
// The sheet is now read at whatever width the panel has been dragged to, so this measures
// the widths that actually occur rather than the one it was designed at.
// =============================================================
import fs from "fs";
import path from "path";
import { serve } from "./serve.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (err) {
  console.log("layout: SKIPPED — playwright is not installed");
  console.log("        npm install jsdom playwright --no-save");
  process.exit(0);
}

// The bundled browser is versioned into its directory name, so it is found rather than
// hardcoded. Falling back to the default launch covers a normal local install.
function findChromium() {
  const root = "/opt/pw-browsers";
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root)) {
    if (!dir.startsWith("chromium-")) continue;
    const exe = path.join(root, dir, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

let browser;
try {
  const executablePath = findChromium();
  browser = await chromium.launch(executablePath ? { executablePath } : {});
} catch (err) {
  console.log("layout: SKIPPED — no browser available:", String(err.message).split("\n")[0]);
  process.exit(0);
}

const sheetUrl = "file://" + path.resolve("out/dnm-cc/index.html");

async function measure(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(sheetUrl);
  await page.waitForLoadState("domcontentloaded");

  // Built the way the app builds one, then rendered as the docked panel renders it.
  await page.evaluate(() => {
    document.body.classList.add("obr-embedded");
    const c = state.character = getDefaultCharacter();
    c.name = "Narrow Test";
    c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = Object.keys(DM_DATA.archetypes)[0];
    c.temperament = Object.keys(DM_DATA.temperaments)[0];
    c.finalized = true;
    normalizeEditableLists();
    if (!computeStats()) throw new Error("fixture does not compute");
    // A weapon carries more meta tags than anything else in the catalogue, so it is the
    // worst case for the row that broke.
    const weapon = (DM_DATA.items || []).find((i) => i.category === "weapon" && i.damage != null)
      || (DM_DATA.items || [])[0];
    c.items = [{ id: weapon.id, qty: 1, equipped: true, discharged: false }];
    state.currentStep = STEPS.indexOf("summary");
    renderAll();

    // Recorded before anything is opened: proves the catalogue really is lazy in a
    // real browser, not only in jsdom, and that this harness is measuring a
    // catalogue it opened rather than one that was there all along.
    window.__lazy = document.querySelectorAll(".cat-item").length === 0;

    // v2.3: the catalogue is rendered only while its <details> is open, and it
    // starts closed. It is OPENED here rather than dropped from the suite —
    // minmax(280px, 1fr) on that grid hung 34px past a 320px panel in 2.1, and a
    // lazy render that stopped it being measured would have quietly retired the
    // assertion written for that bug rather than fixed anything.
    const catalogue = [...document.querySelectorAll("details.collapsible-section")]
      .find((d) => (d.querySelector(":scope > summary") || {}).textContent === "Item Catalogue");
    if (!catalogue) throw new Error("no catalogue section to open");
    catalogue.open = true;
    catalogueToggled(catalogue);
    if (!document.querySelector(".catalogue-grid")) throw new Error("opening the catalogue rendered nothing");
  });
  await page.waitForTimeout(150);

  const result = await page.evaluate((w) => {
    const past = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      // Hover tooltips are laid out off-panel until they are hovered, and positioned
      // elements are placed deliberately. Neither is the failure this is looking for.
      if (el.closest(".dm-tip-body")) continue;
      const pos = getComputedStyle(el).position;
      if (pos === "absolute" || pos === "fixed") continue;
      if (r.right > w + 1) past.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}@${Math.round(r.right)}`);
    }
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), r: Math.round(r.right) }; };
    return {
      past: past.slice(0, 6),
      pastCount: past.length,
      roll: rect(".dice-roll-btn"),
      picked: rect(".dice-field.dice-picked"),
      ident: rect(".owned-item-ident"),
      // v2.2. Every tag on an owned item, and whether any of them is clipped or hangs
      // past the panel. The catalogue wraps its tags with flex and this did not, which is
      // why QA saw an item's tags cut off while the same tags in the catalogue were fine.
      itemTags: (() => {
        const meta = document.querySelector(".owned-item-ident .owned-item-meta");
        if (!meta) return null;
        const box = meta.getBoundingClientRect();
        const tags = [...meta.children].map((t) => t.getBoundingClientRect());
        // NOT scrollWidth. Every tag carries a hover tooltip as a hidden child, laid out
        // far to the right, so the row's scrollWidth measures the tooltips and reports a
        // clip that is not there. Measure the tags themselves.
        return {
          count: tags.length,
          past: tags.filter((t) => t.right > box.right + 1 || t.right > w + 1).length,
          zeroWidth: tags.filter((t) => t.width < 8).length,
          rows: new Set(tags.map((t) => Math.round(t.top))).size,
        };
      })(),
      catalogue: rect(".catalogue-grid"),
      lazy: window.__lazy,
    };
  }, width);

  await page.close();
  return { ...result, errors };
}

// 320 is about as narrow as the panel can be dragged; 560 is the default; 1280 is the
// standalone page, which must not have been changed by any of this.
for (const width of [320, 400, 520, 560, 1280]) {
  const m = await measure(width);
  ok(`${width}px: the page throws nothing`, m.errors.length === 0);
  if (m.errors.length) console.log("      " + m.errors[0]);
  ok(`${width}px: nothing overflows the panel (${m.pastCount})`, m.pastCount === 0);
  if (m.pastCount) console.log("      " + m.past.join(", "));

  // The two that collapsed to zero width in 2.1. A zero-width flex child does not clip its
  // contents — it spills them over whatever is beside it, which is what the report showed.
  ok(`${width}px: the roller's readout has width`, m.picked && m.picked.w > 40);
  ok(`${width}px: an item's name column has width`, m.ident && m.ident.w > 40);
  ok(`${width}px: the Roll button is inside the panel`, m.roll && m.roll.r <= width + 1);
  ok(`${width}px: the catalogue grid is inside the panel`, m.catalogue && m.catalogue.r <= width + 1);
  ok(`${width}px: the catalogue was closed until the harness opened it`, m.lazy === true);
  ok(`${width}px: the item has tags to check`, m.itemTags && m.itemTags.count > 3);
  ok(`${width}px: no item tag hangs past its row`, m.itemTags && m.itemTags.past === 0);
  ok(`${width}px: no item tag is squashed to nothing`, m.itemTags && m.itemTags.zeroWidth === 0);
  // Twelve tags cannot fit on one line in a narrow panel, so if they are all on one row
  // they are not wrapping — which is the state that ran them past the edge.
  ok(`${width}px: the tags wrap onto several rows`, m.itemTags && (width > 700 || m.itemTags.rows > 1));
}

// -------------------------------------------------------------
// The roller's party rows, v2.3 / 1.3, merged with initiative in 1.4B
// -------------------------------------------------------------
// One list now. A party row was three children; with the initiative folded in it is
// up to seven — stacked arrows, the name, Spirit, exhaustion marks, an injury count,
// a hidden mark, and three buttons. The name is the only child that gives way, and
// with overflow:hidden its automatic minimum size is 0, which is the exact shape that
// put the Roll button outside the panel in 2.1 and collapsed the party name in 1.3.
//
// Measured rather than reasoned about because jsdom does no cascade: the party panel
// is extension code and was unreachable by any suite before 1.3.
// Served over http rather than file://, because Chromium refuses to load an ES
// module from file:// and reports the refusal only to the console. Loaded that way,
// roller.js never ran and "the roller throws nothing" below was passing against a
// page with no script on it. The measurements were always real — they are made
// against DOM this file builds — but the error claim was not. See serve.mjs.
const rollerSite = await serve("out/dnm-obr");
const rollerUrl = rollerSite.origin + "/index.html";

// `running` drives both states from one harness: the quiet party list, and the same
// list mid-fight carrying adversaries and every control.
async function measureParty(width, running) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(rollerUrl);
  await page.waitForLoadState("domcontentloaded");

  return { errors, ...(await page.evaluate((isRunning) => {
    const panel = document.getElementById("party-panel");
    const list = document.getElementById("party-list");
    panel.hidden = false;
    list.innerHTML = "";
    if (isRunning) {
      document.getElementById("init-round").hidden = false;
      document.getElementById("init-round").textContent = "Round 12";
      document.getElementById("init-next").hidden = false;
      document.getElementById("init-end").hidden = false;
      document.getElementById("init-add-row").hidden = false;
    }

    // Worst realistic case in every direction at once.
    const rows = [
      { name: "Kesh Ålvaran of the Long Road", marks: ["W", "S", "H", "D"], injuries: 12, acted: true, npc: false, hidden: false },
      { name: "Reaver Pack Leader (Wounded)", marks: [], injuries: 0, acted: false, npc: true, hidden: true },
      { name: "Vee", marks: ["W"], injuries: 1, acted: false, npc: false, hidden: false },
    ];
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "party-row" + (isRunning && row.acted ? " is-acted" : "");
      const head = document.createElement("div");
      head.className = "party-head";

      if (isRunning) {
        const moves = document.createElement("span");
        moves.className = "init-moves";
        for (const glyph of ["▲", "▼"]) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "ghost init-move"; b.textContent = glyph;
          moves.append(b);
        }
        head.append(moves);
      }

      // The name is a BUTTON now, not a span — it is the link to the sheet.
      const name = document.createElement(row.npc ? "span" : "button");
      name.className = "party-name" + (row.npc ? " is-npc" : " is-link");
      name.textContent = row.name;
      head.append(name);

      if (!row.npc) {
        const spirit = document.createElement("span");
        spirit.className = "party-spirit"; spirit.textContent = "Spirit 8/12"; head.append(spirit);
        if (row.marks.length) {
          const marks = document.createElement("span");
          marks.className = "party-exhaustion";
          for (const m of row.marks) {
            const mark = document.createElement("span");
            mark.className = "party-mark"; mark.textContent = m; marks.append(mark);
          }
          head.append(marks);
        }
        if (row.injuries) {
          const hurt = document.createElement("span");
          hurt.className = "party-injuries";
          hurt.textContent = row.injuries === 1 ? "1 Injury" : row.injuries + " Injuries";
          head.append(hurt);
        }
        // The epoch badge is drawn ONLY when no round is running — it answers a
        // between-scenes question and is the longest thing on the row.
        if (!isRunning) {
          const badge = document.createElement("span");
          badge.className = "party-status is-behind"; badge.textContent = "Not synced";
          head.append(badge);
        }
      }
      if (isRunning && row.hidden) {
        const mark = document.createElement("span");
        mark.className = "init-hidden-mark"; mark.textContent = "hidden"; head.append(mark);
      }

      // Appended only when it HAS controls, matching appendInitControls(). An empty
      // flex child still takes a slot and reads as a zero-width child, which is
      // exactly what the assertion below is watching for.
      if (isRunning) {
        const actions = document.createElement("div");
        actions.className = "party-row-actions";
        for (const text of [row.acted ? "Undo" : "Acted", row.hidden ? "Show" : "Hide", "×"]) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "ghost"; b.textContent = text;
          actions.append(b);
        }
        head.append(actions);
      }
      li.append(head);
      list.append(li);
    }

    const limit = document.documentElement.clientWidth;
    const past = [];
    let zeroWidth = 0, narrowestName = Infinity, marksSeen = 0, tinyButtons = 0;
    for (const li of list.children) {
      for (const child of li.querySelector(".party-head").children) {
        const r = child.getBoundingClientRect();
        if (r.right > limit + 1) past.push(child.className + "@" + Math.round(r.right));
        if (r.width < 1) zeroWidth++;
      }
      const n = li.querySelector(".party-name").getBoundingClientRect().width;
      if (n < narrowestName) narrowestName = n;
      marksSeen += li.querySelectorAll(".party-mark").length;
      for (const mark of li.querySelectorAll(".party-mark")) {
        if (mark.getBoundingClientRect().width < 6) zeroWidth++;
      }
    }
    // A control squeezed to nothing is a control the GM cannot press, which is
    // indistinguishable from a bug.
    for (const b of list.querySelectorAll("button")) {
      if (b.getBoundingClientRect().width < 8) tinyButtons++;
    }
    const warning = getComputedStyle(document.documentElement).getPropertyValue("--warning").trim();
    const markEl = list.querySelector(".party-mark");
    const hurtEl = list.querySelector(".party-injuries");
    const asRgb = (hex) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const actedName = list.querySelector(".is-acted .party-name");
    const headBox = document.querySelector("#party-panel .gm-panel-head");
    return {
      past, zeroWidth, narrowestName, marksSeen, tinyButtons,
      warningMatches: markEl && hurtEl
        && getComputedStyle(markEl).color === asRgb(warning)
        && getComputedStyle(hurtEl).color === asRgb(warning),
      // Only ONE list: the merged panel means there is no second copy of these names.
      nameCount: document.querySelectorAll(".party-name").length,
      dimmed: actedName ? Number(getComputedStyle(actedName).opacity) : null,
      headPast: headBox.getBoundingClientRect().right > limit + 1,
      addPast: isRunning
        ? document.getElementById("init-add").getBoundingClientRect().right > limit + 1
        : false,
    };
  }, running)) };
}

// 260 is below anything Owlbear gives the drawer; it is here because the failure mode
// is silent overlap rather than a scrollbar, so the floor has to be proven somewhere
// the layout is genuinely under pressure.
for (const width of [260, 320, 400, 520]) {
  for (const running of [false, true]) {
    const label = running ? "party+init" : "party";
    const m = await measureParty(width, running);
    ok(`${label} ${width}px: the roller throws nothing`, m.errors.length === 0);
    if (m.errors.length) console.log("      " + m.errors[0]);
    ok(`${label} ${width}px: nothing overflows the panel (${m.past.length})`, m.past.length === 0);
    if (m.past.length) console.log("      " + m.past.join(", "));
    ok(`${label} ${width}px: no row child collapses to nothing`, m.zeroWidth === 0);
    ok(`${label} ${width}px: the name keeps a readable floor (${Math.round(m.narrowestName)}px)`,
       m.narrowestName >= 34);
    ok(`${label} ${width}px: every control is still pressable`, m.tinyButtons === 0);
    ok(`${label} ${width}px: the panel header fits`, m.headPast === false);
    // The whole point of 1.4B: three combatants, three names, not six.
    ok(`${label} ${width}px: each name appears exactly once (${m.nameCount})`, m.nameCount === 3);
    if (running) {
      ok(`${label} ${width}px: the add-adversary box fits`, m.addPast === false);
      // Dimmed, not invisible — the GM has to read a row to undo it.
      ok(`${label} ${width}px: an acted row is dimmed but legible`, m.dimmed > 0.3 && m.dimmed < 1);
    } else {
      ok(`${label} ${width}px: all five exhaustion marks are drawn`, m.marksSeen === 5);
      ok(`${label} ${width}px: marks and injuries are warning yellow`, m.warningMatches);
    }
  }
}

await browser.close();
await rollerSite.close();
console.log(`\nlayout: ${pass} passed, ${fail} failed`);
console.log(`
Not covered here — this is one browser at one zoom, laying out one character:
  · how it looks, as opposed to whether it fits
  · Owlbear's own chrome around the panel
  · the wizard steps, which have their own grids
`);
process.exit(fail ? 1 : 0);
