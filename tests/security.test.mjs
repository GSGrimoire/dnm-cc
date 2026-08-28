// =============================================================
// Security regressions — creator v1.22 / extension 0.9.1
// -------------------------------------------------------------
// These assert the trust boundary, not the happy path. Every case here is written
// as the attacker writes it: a forged event straight into the reducer, a hostile
// character code straight into the parser. Nothing goes through a sender, because
// a sender is exactly what an attacker does not use.
//
// The role check itself lives in background.js and is NOT exercised here —
// OBR.broadcast has no jsdom equivalent. What is testable is that the reducer no
// longer trusts what it is handed, and that is asserted below.
// =============================================================
import fs from "fs";
import { JSDOM } from "jsdom";
import {
  applyEvent, trimState, sanitizeEntry, EMPTY_STATE,
  MAX_STATE_BYTES, MAX_LOG_ENTRIES, FIELD_LIMITS, canRevealConcealed,
  sanitizeBondEffect, readBondQueue, MAX_BOND_EFFECTS,
} from "../out/dnm-obr/dnm.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const fresh = () => structuredClone(EMPTY_STATE);
const rollEv = (entry) => ({ type: "roll", entry });

// -------------------------------------------------------------
// Oversized fields cannot reach room metadata
// -------------------------------------------------------------
{
  const huge = "A".repeat(50000);
  const s = applyEvent(fresh(), rollEv({
    id: "x1", t: Date.now(), who: huge, label: huge,
    an: huge, sn: huge, detail: [],
  }));
  const e = s.log[0];
  ok("who is clamped", e.who.length === FIELD_LIMITS.who);
  ok("label is clamped", e.label.length === FIELD_LIMITS.label);
  ok("attribute and skill names are clamped",
    e.an.length === FIELD_LIMITS.label && e.sn.length === FIELD_LIMITS.label);
  ok("the whole entry now fits the budget",
    JSON.stringify(s).length < MAX_STATE_BYTES);
}

// The dice array is the field the renderer loops over, so it is the freeze vector.
{
  const s = applyEvent(fresh(), rollEv({
    id: "x2", t: Date.now(), who: "A",
    detail: Array.from({ length: 100000 }, () => ({ d: 1, kind: "crit" })),
  }));
  ok("a hundred thousand dice are cut to the cap",
    s.log[0].detail.length === FIELD_LIMITS.dice);
  ok("an unknown die kind falls back rather than reaching a class name",
    applyEvent(fresh(), rollEv({ id: "x3", who: "A", detail: [{ d: 3, kind: "<img>" }] }))
      .log[0].detail[0].kind === "fail");
}

// This is the case trimState() alone could not handle: it stops at one entry, so a
// single oversized entry used to survive and blow the room's shared 16 kB budget.
{
  const s = trimState(applyEvent(fresh(), rollEv({
    id: "x4", t: Date.now(), who: "B".repeat(40000),
    label: "C".repeat(40000), detail: [],
  })));
  ok("one oversized entry cannot exceed the state budget",
    JSON.stringify(s).length < MAX_STATE_BYTES);
  ok("and the entry is still logged rather than dropped", s.log.length === 1);
}

// -------------------------------------------------------------
// Entries that are not entries
// -------------------------------------------------------------
{
  ok("an entry with no id is refused", sanitizeEntry({ who: "A" }) === null);
  ok("null is refused", sanitizeEntry(null) === null);
  ok("a string is refused", sanitizeEntry("nope") === null);
  for (const junk of [null, undefined, "x", 42, []]) {
    const s = applyEvent(fresh(), { type: "roll", entry: junk });
    ok(`a ${JSON.stringify(junk)} entry logs nothing`, s.log.length === 0);
  }
  ok("a non-array detail does not throw",
    Array.isArray(sanitizeEntry({ id: "a", detail: "not-an-array" }).detail));
}

// -------------------------------------------------------------
// Pools cannot be driven to nonsense
// -------------------------------------------------------------
{
  let s = applyEvent(fresh(), { type: "pool", pool: "threat", delta: Number.MAX_SAFE_INTEGER });
  ok("an enormous delta is bounded", s.threat <= 9999);
  s = applyEvent(s, { type: "pool", pool: "threat", delta: -Number.MAX_SAFE_INTEGER });
  ok("a pool never goes negative", s.threat === 0);
  s = applyEvent(fresh(), { type: "pool", pool: "momentum", delta: NaN });
  ok("NaN does not poison a pool", s.momentum === 0);
  s = applyEvent(fresh(), { type: "pool", pool: "momentum", delta: 3 });
  ok("an ordinary delta still applies", s.momentum === 3);
}

// -------------------------------------------------------------
// The log cap still holds under a flood
// -------------------------------------------------------------
{
  let s = fresh();
  for (let i = 0; i < 500; i++) {
    s = applyEvent(s, rollEv({ id: `f${i}`, t: Date.now() + i, who: "Flood", detail: [] }));
  }
  ok("the log stays capped under a flood", s.log.length === MAX_LOG_ENTRIES);
  ok("a flooded log still fits the budget",
    JSON.stringify(trimState(s)).length < MAX_STATE_BYTES);
}

// -------------------------------------------------------------
// Ordinary traffic is unchanged
// -------------------------------------------------------------
{
  const real = {
    id: "r1", t: 1700000000000, who: "Kell", label: "Forcing the door",
    an: "Might", av: 9, sn: "Fight", sv: 2,
    detail: [{ d: 3, kind: "crit" }, { d: 17, kind: "fail" }],
    diff: 1, succ: 2, comp: 0, pass: true, gain: 1,
  };
  const out = applyEvent(fresh(), rollEv(real)).log[0];
  ok("a real roll survives untouched",
    out.who === "Kell" && out.av === 9 && out.succ === 2 &&
    out.pass === true && out.detail.length === 2 && out.detail[0].kind === "crit");
  ok("sanitising is idempotent",
    JSON.stringify(sanitizeEntry(out)) === JSON.stringify(out));

  const action = {
    id: "a1", t: 1700000000001, kind: "action", who: "Kell",
    label: "Nanobarrier — Barrier", detail: "spent 1 Threat", pool: "threat", delta: 1,
  };
  const aOut = applyEvent(fresh(), { type: "action", entry: action }).log[0];
  ok("a real action survives untouched",
    aOut.kind === "action" && aOut.detail === "spent 1 Threat" &&
    aOut.pool === "threat" && aOut.delta === 1);
  ok("an unknown pool name on an action is dropped",
    applyEvent(fresh(), { type: "action", entry: { ...action, pool: "evil" } })
      .log[0].pool === null);
}

// Dedupe must still work, and must work on the SANITISED id.
{
  let s = applyEvent(fresh(), rollEv({ id: "dup", who: "A", detail: [] }));
  s = applyEvent(s, rollEv({ id: "dup", who: "B", detail: [] }));
  ok("dedupe by id still holds after sanitising", s.log.length === 1);
}

// Epochs still increment, and still only for known boundaries.
{
  let s = applyEvent(fresh(), { type: "epoch", boundary: "bed" });
  ok("a known boundary increments", s.epochs.bed === 1);
  s = applyEvent(s, { type: "epoch", boundary: "__proto__" });
  // hasOwnProperty, not `in`: `"__proto__" in obj` is true for every object, because
  // it is an inherited accessor on Object.prototype. Using `in` here asserts nothing.
  ok("an unknown boundary is ignored",
    s.epochs.bed === 1 &&
    !Object.prototype.hasOwnProperty.call(s.epochs, "__proto__") &&
    Object.getPrototypeOf(s.epochs) === Object.prototype);
  ok("epochs survive trimming", trimState(s).epochs.bed === 1);
}

// -------------------------------------------------------------
// A hostile character code
// -------------------------------------------------------------
{
  const raw = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");
  const modStart = raw.indexOf('<script type="module">');
  const modEnd = raw.indexOf("</script>", modStart);
  const html = raw.slice(0, modStart) + raw.slice(modEnd + "</script>".length);
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://gsgrimoire.github.io/dnm-cc/" });
  const w = dom.window;
  await new Promise((r) => { if (w.document.readyState === "complete") r(); else w.addEventListener("load", r); });
  const g = (code) => w.eval(code);

  // Built the way the app builds one, then a payload spliced in the way an attacker
  // would: a real code with its CP segment replaced.
  const hostile = g(`(function(){
    var c = state.character = getDefaultCharacter();
    c.origin = Object.keys(DM_DATA.origins)[0];
    c.archetype = Object.keys(DM_DATA.archetypes)[0];
    c.temperament = Object.keys(DM_DATA.temperaments)[0];
    c.name = 'Fixture';
    normalizeEditableLists();
    var code = buildCharacterCode();
    var payload = { name: 'Pwned', __proto__: { polluted: 'yes' } };
    var b64 = btoa(encodeURIComponent(JSON.stringify(payload))).replace(/=/g,'');
    return code.split('-').map(function(p){
      return p.charAt(0) === 'C' && p.charAt(1) === 'P' ? 'CP' + b64 : p;
    }).join('-');
  })()`);

  const res = g(`parseCharacterCode(${JSON.stringify(hostile)})`);
  ok("a hostile code still parses rather than throwing", !res.error);
  ok("Object.prototype is not polluted", g("({}).polluted") === undefined);
  ok("the parsed character keeps a normal prototype",
    g(`(function(){
      var r = parseCharacterCode(${JSON.stringify(hostile)});
      return Object.getPrototypeOf(r.character) === Object.prototype;
    })()`) === true);

  // The escaping that keeps a hostile name out of the DOM as markup.
  ok("escHtml neutralises a script tag",
    g(`escHtml('<script>alert(1)<\\/script>')`) === "&lt;script&gt;alert(1)&lt;/script&gt;");
  ok("escHtml neutralises an attribute break-out",
    g(`escHtml('" onerror="alert(1)')`).indexOf('"') === -1);
  ok("a javascript: portrait URL is refused",
    g(`sanitizeImageUrl('javascript:alert(1)')`) === "");
  ok("a data: portrait URL is refused",
    g(`sanitizeImageUrl('data:text/html,<script>alert(1)<\\/script>')`) === "");
  ok("an ordinary https portrait URL is kept",
    g(`sanitizeImageUrl('https://example.com/a.png')`) === "https://example.com/a.png");
}

// -------------------------------------------------------------
// Who may read a concealed roll (0.9.4)
// -------------------------------------------------------------
// 0.9.3 sent a redacted placeholder, which was genuinely unreadable and also meant the
// GM could not see a player's hidden roll. 0.9.4 sends the whole roll and redacts at
// render, because Owlbear has no private channel to send a result down.
//
// Be clear about what these assert: they cover who the interface DRAWS a result for.
// A hidden roll is on the wire and in room metadata, so a player with devtools can
// read one. Secret is the mode that is actually unreachable, and the tests below pin
// the difference so nobody later "simplifies" the two into one.
{
  const gm = { role: "GM", playerId: "gm-1" };
  const mine = { role: "PLAYER", playerId: "p-1" };
  const theirs = { role: "PLAYER", playerId: "p-2" };
  const hidden = { id: "h1", who: "Kell", conceal: "hidden", by: "p-1", detail: [] };

  ok("an ordinary roll is readable by anyone",
    canRevealConcealed({ id: "r1", detail: [] }, theirs) === true);

  ok("the GM reads a player's hidden roll — the point of the change",
    canRevealConcealed(hidden, gm) === true);
  ok("the roller reads their own hidden roll",
    canRevealConcealed(hidden, mine) === true);
  ok("another player does not",
    canRevealConcealed(hidden, theirs) === false);
  ok("a viewer with no id does not",
    canRevealConcealed(hidden, { role: "PLAYER" }) === false);
  ok("a missing viewer does not throw and reveals nothing",
    canRevealConcealed(hidden, undefined) === false);

  // A secret roll only ever exists in its own browser, so whoever holds one may draw
  // it. The protection is that it was never sent, not that it is filtered on arrival.
  ok("a secret roll is drawn by whoever holds it",
    canRevealConcealed({ id: "s1", conceal: "secret", detail: [] }, mine) === true);

  // An unknown conceal value must not become a silent reveal-to-all... it is coerced
  // away by the reducer, which is the assertion below.
  ok("an unrecognised conceal value is dropped by the reducer",
    applyEvent(fresh(), rollEv({ id: "u1", who: "A", detail: [], conceal: "sort-of" }))
      .log[0].conceal === null);

  // Concealment has to survive the round trip through room metadata, or a hidden roll
  // becomes an ordinary one the moment it comes back from the GM.
  const through = applyEvent(fresh(), rollEv(hidden)).log[0];
  ok("conceal survives the reducer", through.conceal === "hidden");
  ok("the roller's id survives the reducer", through.by === "p-1");
  ok("and it is still hidden from another player after the round trip",
    canRevealConcealed(through, theirs) === false);
  ok("`by` is length-clamped like any other untrusted string",
    applyEvent(fresh(), rollEv({ id: "b1", who: "A", detail: [], conceal: "hidden", by: "x".repeat(500) }))
      .log[0].by.length === FIELD_LIMITS.id);
}

// -------------------------------------------------------------
// Forged bond effects (0.9.6)
// -------------------------------------------------------------
// Bond effects are the first events that make something happen on ANOTHER player's
// sheet, so they are worth going at directly. The honest threat model: a forged
// effect can only pay a sheet that already holds the matching bond, for one Spirit,
// and a forged grant has to name a target who exists. That is a nuisance, not a
// privilege — which is why it is not GM-only and why the reducer, not the role
// check, is what bounds it.
{
  const forged = (extra) => sanitizeBondEffect({ id: "f1", t: Date.now(), kind: "grant", from: "A", target: "B", amount: 1, ...extra });

  ok("an effect that is not an object is refused", sanitizeBondEffect("rivalry") === null);
  ok("an effect with no kind is refused", sanitizeBondEffect({ id: "x", t: 1 }) === null);
  ok("an invented kind is refused", sanitizeBondEffect({ id: "x", t: 1, kind: "drain" }) === null);
  ok("an effect with no id is refused", sanitizeBondEffect({ t: 1, kind: "rivalry" }) === null);

  // The sanitiser BUILDS a new object rather than copying the one it was handed, so
  // a forged effect cannot smuggle extra keys into room metadata for some later
  // reader to trip over.
  const smuggled = forged({ evil: "payload", gm: true });
  ok("unknown keys do not survive the sanitiser",
    !Object.prototype.hasOwnProperty.call(smuggled, "evil")
    && !Object.prototype.hasOwnProperty.call(smuggled, "gm"));

  // Written through JSON.parse rather than an object literal on purpose: a literal's
  // `__proto__` sets the prototype at creation and never becomes an own property, so
  // a literal would assert nothing. JSON.parse creates it as an ordinary own key,
  // which is the shape an event actually arrives in — it crossed the wire as JSON.
  const hostile = JSON.parse('{"id":"f9","t":1,"kind":"rivalry","from":"A","__proto__":{"polluted":true}}');
  const cleaned = sanitizeBondEffect(hostile);
  ok("a `__proto__` key arriving over the wire does not survive",
    !Object.prototype.hasOwnProperty.call(cleaned, "__proto__"));
  ok("and nothing was written to Object.prototype", ({}).polluted === undefined);

  // A rivalry effect carries no target and no amount by design — the recipient's own
  // sheet decides both. A forged one claiming otherwise must not gain either.
  const rivalry = sanitizeBondEffect({ id: "f2", t: Date.now(), kind: "rivalry", from: "A", amount: 99, target: "B" });
  ok("a forged rivalry cannot carry an amount", rivalry.amount === undefined);
  ok("a forged rivalry cannot name a target", rivalry.target === undefined);

  ok("a fractional amount is rounded rather than carried through",
    forged({ amount: 2.7 }).amount === 3);
  ok("a non-numeric amount becomes zero", forged({ amount: "lots" }).amount === 0);
  ok("Infinity does not survive as an amount", forged({ amount: Infinity }).amount === 4);
  ok("every text field is length-clamped",
    forged({ from: "x".repeat(9000), target: "y".repeat(9000), source: "z".repeat(9000) }).source.length === FIELD_LIMITS.label);
  ok("an id is length-clamped like any other untrusted string",
    forged({ id: "i".repeat(9000) }).id.length === FIELD_LIMITS.id);

  // The flood case. One client broadcasting bond effects in a loop must not be able
  // to push the room's shared 16 kB budget over on its own.
  let state = structuredClone(EMPTY_STATE);
  for (let i = 0; i < 500; i++) {
    state = applyEvent(state, { type: "bond", effect: { id: `flood${i}`, t: Date.now(), kind: "grant", from: "A".repeat(80), target: "B".repeat(80), amount: 4, source: "S".repeat(80) } });
  }
  ok("a flood of forged effects cannot grow the queue past its cap",
    readBondQueue(state).length === MAX_BOND_EFFECTS);
  ok("and the state still fits the room budget after one",
    JSON.stringify(trimState(state)).length <= MAX_STATE_BYTES);

  // Garbage already sitting in a room's metadata — written by a bug, or by hand —
  // must not reach a reader as a live effect.
  ok("junk in the stored queue is filtered on read",
    readBondQueue({ bonds: [null, 42, "x", { id: "ok", t: Date.now(), kind: "rivalry", from: "K" }] }).length === 1);
}

console.log(`\nsecurity: ${pass} passed, ${fail} failed`);
console.log(`
NOT VERIFIED HERE — needs a live room:
  · the GM-only relay check in background.js (OBR.broadcast has no jsdom stand-in)
  · that a player's forged epoch is actually refused by the GM's background page
  · that a second GM in the room is still accepted`);
process.exit(fail ? 1 : 0);
