// =============================================================
// stage-beta.mjs — build the BETA channel from a working tree
// -------------------------------------------------------------
// GitHub Pages serves `main` and nothing else, so a test build has to live ON main —
// in a beta/ folder, beside the live files and never instead of them:
//
//   https://gsgrimoire.github.io/dnm-obr/beta/manifest.json   the beta extension
//   https://gsgrimoire.github.io/dnm-cc/beta/                 the beta creator
//
// Add the beta manifest to Owlbear as its own extension. It is listed as
// "Dreams & Machines (BETA)".
//
// THE BETA IS ISOLATED, not just relocated. Every namespace string is rewritten —
// `com.thuknights.dnm-obr` and `com.thuknights.dnm-rolls` gain a `-beta` suffix — so the
// beta extension reads and writes its OWN room log, pools, initiative, token metadata and
// localStorage. That matters because Owlbear will happily run both extensions in one
// room, and two copies of the same background page would each relay every event: every
// Threat change would land twice. With the namespaces split, the two cannot see each
// other at all. The cost is that a character attached with the live extension is not
// visible to the beta one — copy its code from the live sheet and attach it under the
// beta's "Attach D&M character (BETA)". The live token is untouched.
//
// Usage, from anywhere:
//   node tools/stage-beta.mjs <dnm-obr source> <dnm-cc source> <dnm-obr target> <dnm-cc target>
// Sources are working trees holding the build to test; targets are checkouts of main.
// It writes <target>/beta/ in each and touches nothing else.
// =============================================================
import fs from "fs";
import path from "path";

const [obrSrc, ccSrc, obrDst, ccDst] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!obrSrc || !ccSrc || !obrDst || !ccDst) {
  console.error("usage: node stage-beta.mjs <dnm-obr src> <dnm-cc src> <dnm-obr target> <dnm-cc target>");
  process.exit(2);
}

const HOST = "https://gsgrimoire.github.io";
const OWLBEAR_DESCRIPTION_MAX = 128;

// The namespace split. Order matters: the more specific string first.
const isolate = (text) => text
  .replaceAll("com.thuknights.dnm-obr", "com.thuknights.dnm-obr-beta")
  .replaceAll("com.thuknights.dnm-rolls", "com.thuknights.dnm-rolls-beta");

// Files the extension serves. Anything else in the repo (README, tests) stays out.
const EXT_FILES = [
  "background.html", "background.js", "dnm.js", "gm.html", "gm.js", "gmpanel.js",
  "gmrules.js", "icon-attach.svg", "icon-sheet.svg", "icon.svg", "index.html",
  "npc-token.svg", "roller.js", "sdk.js", "style.css",
];

const obrBeta = path.join(obrDst, "beta");
const ccBeta = path.join(ccDst, "beta");
fs.rmSync(obrBeta, { recursive: true, force: true });
fs.rmSync(ccBeta, { recursive: true, force: true });
fs.mkdirSync(obrBeta, { recursive: true });
fs.mkdirSync(ccBeta, { recursive: true });

for (const file of EXT_FILES) {
  const from = path.join(obrSrc, file);
  if (!fs.existsSync(from)) { console.error(`missing ${from}`); process.exit(1); }
  let text = fs.readFileSync(from, "utf8");
  // sdk.js is the vendored Owlbear SDK. Its own strings are Owlbear's, not ours.
  if (file !== "sdk.js" && /\.(js|html)$/.test(file)) text = isolate(text);
  if (file === "dnm.js") {
    // The beta extension opens the beta creator, never the live one: the live creator
    // speaks the live namespace and would look for the character under the wrong key.
    const before = text;
    text = text.replace(`export const SHEET_URL = "${HOST}/dnm-cc/";`, `export const SHEET_URL = "${HOST}/dnm-cc/beta/";`);
    if (text === before) { console.error("SHEET_URL not found in dnm.js — the rewrite would leave the beta opening the live creator"); process.exit(1); }
  }
  if (file === "background.js") {
    // Two context menus reading "Attach D&M character" would be impossible to tell apart.
    text = text.replace(`label: "Attach D&M character",`, `label: "Attach D&M character (BETA)",`)
      .replace(`label: "Open D&M sheet",`, `label: "Open D&M sheet (BETA)",`);
  }
  fs.writeFileSync(path.join(obrBeta, file), text);
}

const manifest = JSON.parse(fs.readFileSync(path.join(obrSrc, "manifest.json"), "utf8"));
const base = `${HOST}/dnm-obr/beta/`;
manifest.name = "Dreams & Machines (BETA)";
manifest.version = `${manifest.version}-beta`;
// Owlbear refuses a manifest whose description is over 128 characters ("description
// length must be less than or equal to 128 characters long"). Found by installing the
// first beta. Kept short and checked below rather than trusted.
manifest.description = `TEST BUILD ${manifest.version.replace(/-beta$/, "")}. Isolated from the live extension: its own log, pools and tokens.`;
if (manifest.description.length > OWLBEAR_DESCRIPTION_MAX) {
  console.error(`beta description is ${manifest.description.length} characters; Owlbear allows ${OWLBEAR_DESCRIPTION_MAX}`);
  process.exit(1);
}
manifest.icon = base + "icon.svg";
manifest.background_url = base + "background.html";
manifest.action = { ...manifest.action, title: "D&M Rolls (BETA)", icon: base + "icon.svg", popover: base + "index.html" };
fs.writeFileSync(path.join(obrBeta, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// The creator: one file, the same rewrite. Its CHANGELOG link is relative, so the beta
// creator links to a beta copy rather than the live one.
let creator = isolate(fs.readFileSync(path.join(ccSrc, "index.html"), "utf8"));
fs.writeFileSync(path.join(ccBeta, "index.html"), creator);
for (const doc of ["CHANGELOG.html", "UPGRADE_NOTES.md"]) {
  const from = path.join(ccSrc, doc);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(ccBeta, doc));
}

const readme = (what) => `# BETA — test build, not the live ${what}

Built by \`dnm-cc/tools/stage-beta.mjs\` from a feature branch. Everything here is a copy
with its namespaces suffixed \`-beta\`, so it cannot touch the live extension's rooms,
tokens or log. Do not edit by hand; rebuild it.

Install: add \`${HOST}/dnm-obr/beta/manifest.json\` to Owlbear as an extension. Test in a
room of its own. Characters attached with the live extension are not visible to it: copy a
code from a live sheet and use "Attach D&M character (BETA)".

When the build is released, the live files are updated the normal way and this folder can
be deleted or left for the next test.
`;
fs.writeFileSync(path.join(obrBeta, "README.md"), readme("extension"));
fs.writeFileSync(path.join(ccBeta, "README.md"), readme("creator"));

// Proof the split took: no live namespace left in anything we wrote except the SDK.
const leaks = [];
for (const dir of [obrBeta, ccBeta]) {
  for (const f of fs.readdirSync(dir)) {
    if (f === "sdk.js" || f.endsWith(".md") || f === "CHANGELOG.html") continue;
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    if (/com\.thuknights\.dnm-(obr|rolls)(?!-beta)/.test(t)) leaks.push(path.join(dir, f));
    if (/gsgrimoire\.github\.io\/dnm-(obr|cc)\/(?!beta\/)[a-z]/i.test(t.replace(/^\s*\/\/.*$/gm, ""))) leaks.push(path.join(dir, f) + " (live URL)");
  }
}
if (leaks.length) { console.error("LIVE NAMESPACE LEFT IN:\n  " + leaks.join("\n  ")); process.exit(1); }
console.log(`beta staged: ${manifest.name} ${manifest.version}`);
console.log(`  ${obrBeta}`);
console.log(`  ${ccBeta}`);
