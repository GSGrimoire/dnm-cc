// Runs actual roller modules and die DOM without a browser or network server.
// Run: node --experimental-vm-modules tests/rollerclick.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
let pass = 0, fail = 0;
const ok = (name, value) => { if (value) pass++; else { fail++; console.log('FAIL:', name); } };
const root = path.resolve('out/dnm-obr');
const creatorRaw = fs.readFileSync('out/dnm-cc/index.html', 'utf8');
const modStart = creatorRaw.indexOf('<script type="module">');
const creator = new JSDOM(creatorRaw.slice(0, modStart), { runScripts: 'dangerously', url: 'https://gsgrimoire.github.io/dnm-cc/' });
const code = creator.window.eval(`(() => {
  const c = state.character = getDefaultCharacter();
  c.name = 'Kesh'; c.origin = Object.keys(DM_DATA.origins)[0];
  c.archetype = Object.keys(DM_DATA.archetypes)[0]; c.temperament = Object.keys(DM_DATA.temperaments)[0];
  c.finalized = true; c.currentSpirit = 3; normalizeEditableLists(); computeStats();
  return buildCharacterCode();
})()`);
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://gsgrimoire.github.io/dnm-obr/' });
const w = dom.window;
w.structuredClone = structuredClone;
w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
w.__sent = [];
const context = dom.getInternalVMContext();
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  let source = filename.endsWith('/sdk.js') ? `export default { isAvailable: true, onReady() {}, action: { setHeight: async () => {} }, broadcast: { sendMessage: async (ch, ev) => { window.__sent.push(ev); } } };` : fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('/roller.js')) source += `\nexport function seedTest(next, items) { state = next; sceneItems = items; standalone = false; role = 'PLAYER'; myPlayerId = 'p1'; render(); }`;
  const module = new vm.SourceTextModule(source, { context, identifier: filename, initializeImportMeta(meta) { meta.url = 'file://' + filename; } });
  cache.set(filename, module);
  return module;
}
const main = load(path.join(root, 'roller.js'));
await main.link((specifier, referencing) => load(path.resolve(path.dirname(referencing.identifier), specifier)));
await main.evaluate();
const dnm = load(path.join(root, 'dnm.js')).namespace;
const token = { id: 'kesh', metadata: { [dnm.CHAR_KEY]: { v: 1, code } } };
const roll = { id: 'direct', t: Date.now(), by: 'p1', who: 'Kesh', an: 'Might', av: 10, sn: 'Fight', sv: 2,
  diff: 2, compAt: 20, src: 'pc', detail: [{ d: 19, kind: 'fail' }, { d: 9, kind: 'success' }], succ: 1, comp: 0, pass: false, gain: 0 };
let state = { ...dnm.EMPTY_STATE, momentum: 2, log: [roll] };
main.namespace.seedTest(state, [token]);
w.Math.random = () => 0;
const button = w.document.querySelector('#log button.die.fail');
ok('failed die advertises 1 Spirit', button && /1 Spirit/.test(button.title));
button?.click();
await new Promise(r => setTimeout(r, 0));
const event = w.__sent.find(e => e.type === 'reroll');
ok('one click sends exactly one Spirit reroll', event?.how === 'spirit' && event.dice.length === 1 && event.dice[0].i === 0 && event.dice[0].to === 1);
ok('payment belongs to the character sheet', event?.pay === 'room');
ok('no Momentum or Threat is spent', !w.__sent.some(e => e.type === 'pool'));
state = dnm.applyEvent(state, event, { sender: 'p1' });
main.namespace.seedTest(state, [token]);
ok('only the chosen die changes', state.log[0].detail.map(d => d.d).join() === '1,9');
ok('the log shows old die, new die and Spirit price', /Reroll 19 → 1 \(1 Spirit\)/.test(w.document.querySelector('#log').textContent));
ok('the original die remains visible', w.document.querySelector('#log .is-replaced')?.textContent === '19');
ok('the log shows the new successes and Momentum', /3 successes vs D2/.test(w.document.querySelector('#log').textContent) && state.log[0].gain === 1);
ok('the paid reroll cannot be taken twice', !w.document.querySelector('#log button.die'));
ok('duplicate event does not add a reroll', dnm.applyEvent(state, event, { sender: 'p1' }).log[0].rr.length === 1);
main.namespace.seedTest({ ...state, log: [{ ...roll, by: 'someone-else' }] }, [token]);
ok('other players cannot click your roll', !w.document.querySelector('#log button.die'));
main.namespace.seedTest({ ...state, log: [{ ...roll, claimed: true }] }, [token]);
ok('claimed Momentum still locks the dice', !w.document.querySelector('#log button.die'));
w.close(); creator.window.close();
console.log(`rollerclick: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
