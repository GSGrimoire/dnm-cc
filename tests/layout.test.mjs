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
  ok(`${width}px: the item has tags to check`, m.itemTags && m.itemTags.count > 3);
  ok(`${width}px: no item tag hangs past its row`, m.itemTags && m.itemTags.past === 0);
  ok(`${width}px: no item tag is squashed to nothing`, m.itemTags && m.itemTags.zeroWidth === 0);
  // Twelve tags cannot fit on one line in a narrow panel, so if they are all on one row
  // they are not wrapping — which is the state that ran them past the edge.
  ok(`${width}px: the tags wrap onto several rows`, m.itemTags && (width > 700 || m.itemTags.rows > 1));
}

await browser.close();
console.log(`\nlayout: ${pass} passed, ${fail} failed`);
console.log(`
Not covered here — this is one browser at one zoom, laying out one character:
  · how it looks, as opposed to whether it fits
  · Owlbear's own chrome around the panel
  · the wizard steps, which have their own grids
`);
process.exit(fail ? 1 : 0);
