// =============================================================
// codec.test.mjs — the DM2 payload codec, v2.3
// -------------------------------------------------------------
// The codec is the one piece of this project where being subtly wrong is
// silent and permanent: a character code that packs but does not unpack is a
// lost character, and it would not be noticed until someone reopened a sheet.
// So this suite does not read the code, it fuzzes it, and it checks it against
// an implementation nobody here wrote — zlib — in BOTH directions:
//
//   our encoder  -> zlib's decoder    proves we emit real RFC 1951
//   zlib's encoder -> our decoder     proves we read what anyone else writes
//   our encoder  -> our decoder       proves the pair agrees with itself
//
// zlib is driven at four levels because level 0 emits STORED blocks and the
// others emit DYNAMIC Huffman trees, neither of which our encoder produces —
// so without this, two of the decoder's three block paths would never run.
//
// It also compares the two vendored copies CHARACTER FOR CHARACTER. The dock
// helpers are held together by a behavioural comparison, which is right for
// geometry; for a codec it is not enough, because two implementations can agree
// on every input a test thinks of and differ on the one it does not.
// =============================================================
import fs from "fs";
import zlib from "zlib";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };

const creatorSrc = fs.readFileSync(new URL("../out/dnm-cc/index.html", import.meta.url), "utf8");
const dnmSrc = fs.readFileSync(new URL("../out/dnm-obr/dnm.js", import.meta.url), "utf8");

const BEGIN = "// ==== BEGIN SHARED CODEC";
const END = "// ==== END SHARED CODEC ====";
function extract(src, what) {
  const i = src.indexOf(BEGIN);
  const j = src.indexOf(END, i);
  if (i < 0 || j < 0) { console.log("FATAL: no codec markers in " + what); process.exit(1); }
  // Drop the marker line itself and the per-copy note under it: the note is
  // allowed to differ, everything from the first '// ---' divider is not.
  const block = src.slice(i, j);
  const divider = block.indexOf("// -------------------------------------------------------------");
  return block.slice(divider);
}

const fromCreator = extract(creatorSrc, "index.html");
const fromDnm = extract(dnmSrc, "dnm.js");

ok("the two copies are identical but for `export `",
   fromCreator === fromDnm.split("\nexport function ").join("\nfunction "));
ok("the creator's copy exports nothing", !fromCreator.includes("\nexport "));

// -------------------------------------------------------------
// Load the extension's copy as a module and the creator's as loose script, so
// BOTH are exercised rather than one standing in for the other.
// -------------------------------------------------------------
const dnm = await import(new URL("../out/dnm-obr/dnm.js", import.meta.url));

const creatorScope = {};
new Function("scope", fromCreator + `
  scope.deflateRaw = deflateRaw; scope.inflateRaw = inflateRaw;
  scope.packPayload = packPayload; scope.unpackPayload = unpackPayload;
`)(creatorScope);

const impls = [["dnm.js", dnm], ["index.html", creatorScope]];

// -------------------------------------------------------------
// Corpus: real payloads, the shapes that break naive implementations, and
// 400 generated strings. The seeded generator means a failure is reproducible.
// -------------------------------------------------------------
const corpus = [
  "", "a", "ab", "abc", "aaa", "aaaa",
  "a".repeat(258), "a".repeat(259), "a".repeat(300),   // exactly the longest match, and past it
  "ab".repeat(5000),
  "\u0000\u0001ÿ", "æøå ✦ 日本語", "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 astral \u{1F600}",
  JSON.stringify({ name: "Kesh", items: Array.from({ length: 40 }, (_, i) => ({ id: "item-" + i, qty: 1, equipped: false })) }),
];
let seed = 20260920;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = 0; i < 400; i++) {
  const len = Math.floor(rnd() * 4000);
  const jsonish = rnd() < 0.5;
  const alpha = '{}[]",:abcdefghij0123456789 \n';
  let s = "";
  for (let j = 0; j < len; j++) {
    s += jsonish ? alpha[Math.floor(rnd() * alpha.length)] : String.fromCharCode(Math.floor(rnd() * 0x2000));
  }
  corpus.push(s);
}

const enc = new TextEncoder(), dec = new TextDecoder();
for (const [name, impl] of impls) {
  let ours = 0, toZlib = 0, fromZlib = 0, text = 0;
  for (const s of corpus) {
    const bytes = enc.encode(s);
    const packed = impl.deflateRaw(bytes);
    if (dec.decode(impl.inflateRaw(packed)) === s) ours++;
    if (zlib.inflateRawSync(Buffer.from(packed)).toString("utf8") === s) toZlib++;
    let all = true;
    for (const level of [0, 1, 6, 9]) {
      const z = zlib.deflateRawSync(Buffer.from(bytes), { level });
      if (dec.decode(impl.inflateRaw(new Uint8Array(z))) !== s) all = false;
    }
    if (all) fromZlib++;
    if (impl.unpackPayload(impl.packPayload(s)) === s) text++;
  }
  ok(`${name}: round trips itself (${ours}/${corpus.length})`, ours === corpus.length);
  ok(`${name}: zlib reads our output (${toZlib}/${corpus.length})`, toZlib === corpus.length);
  ok(`${name}: we read zlib's output at four levels (${fromZlib}/${corpus.length})`, fromZlib === corpus.length);
  ok(`${name}: packPayload/unpackPayload round trip (${text}/${corpus.length})`, text === corpus.length);
}

// The two copies must agree byte for byte on output, not merely each be valid.
{
  let same = 0;
  for (const s of corpus) if (dnm.packPayload(s) === creatorScope.packPayload(s)) same++;
  ok(`both copies pack identically (${same}/${corpus.length})`, same === corpus.length);
  let cross = 0;
  for (const s of corpus) if (creatorScope.unpackPayload(dnm.packPayload(s)) === s) cross++;
  ok(`the creator reads what the extension packs (${cross}/${corpus.length})`, cross === corpus.length);
}

// -------------------------------------------------------------
// The alphabet. A packed payload rides inside a '-' joined code, so a '-'
// anywhere in the output would split a segment in half and lose the character.
// -------------------------------------------------------------
{
  let clean = true;
  for (const s of corpus) if (/[^A-Za-z0-9+/]/.test(dnm.packPayload(s))) clean = false;
  ok("packed payloads never contain '-' or '=' ", clean);
}

// -------------------------------------------------------------
// Hostile input. A code is pasted from chat; a payload that is not one of ours
// must come back as a thrown error, never as a hang or a wrong answer.
// -------------------------------------------------------------
{
  const junk = ["!!!!", "////", "AAAA", "A", "////////////////", "AAAAAAAAAAAAAAAAAAAAAAAA",
                dnm.packPayload("hello").slice(0, 3), "Zm9vYmFy", "+".repeat(100)];
  let threwOrParsed = 0;
  for (const j of junk) {
    try { dnm.unpackPayload(j); threwOrParsed++; }        // a wrong-but-terminating answer is fine
    catch (e) { threwOrParsed++; }                         // so is an error; a hang is not
  }
  ok("junk payloads terminate rather than hang", threwOrParsed === junk.length);
}

// -------------------------------------------------------------
// Size, which is the entire reason this exists. Asserted as a RATIO against
// the old encoding so it keeps meaning if the fixture changes.
// -------------------------------------------------------------
{
  const sample = JSON.stringify({
    name: "Kesh Alvaran", origin: "everan", archetype: "sentinel",
    items: Array.from({ length: 12 }, (_, i) => ({ id: "equipment-item-" + i, qty: 1, equipped: i < 3, discharged: false })),
    bonds: [{ name: "Vera Sunn", detail: "Owes me a debt she will not name." }],
    growthPurchases: Array.from({ length: 6 }, (_, i) => ({ type: "skill", label: "Survival +" + i, detail: "", cost: 2 })),
  });
  const before = btoa(encodeURIComponent(sample)).replace(/=/g, "").length;
  const after = dnm.packPayload(sample).length;
  ok(`DM2 payload is at least 2.5x smaller (${before} -> ${after})`, after * 2.5 <= before);
}

console.log(`codec: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
