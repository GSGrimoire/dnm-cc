// Review evidence for extension 70cb3cb and creator 10c8c38.
// These assertions describe current defects, not passing release acceptance tests.
// Run from dnm-cc: node --experimental-vm-modules docs/reviews/2026-11-01/probes.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { JSDOM, VirtualConsole } from 'jsdom';
const root = path.resolve(new URL('../../../', import.meta.url).pathname);
const ext = path.join(root, 'out/dnm-obr');
const html = fs.readFileSync(path.join(root, 'out/dnm-cc/index.html'), 'utf8');
const start = html.indexOf('<script type="module">'), end = html.indexOf('</script>', start);
const classic = html.slice(0, start) + html.slice(end + 9);
const lines = html.slice(start + '<script type="module">'.length, end).split('\n');
lines.splice(lines.findIndex(x => x.length > 2000), 1);
const moduleBody = lines.join('\n');
const virtualConsole = new VirtualConsole();
const results = [];
const record = (id, observed) => { results.push({ id, observed }); console.log(JSON.stringify({ id, observed })); };
const delay = ms => new Promise(r => setTimeout(r, ms));
function baseWindow() {
 const dom = new JSDOM(classic, { runScripts: 'dangerously', pretendToBeVisual: true,
   url: 'https://gsgrimoire.github.io/dnm-cc/?item=review-token', virtualConsole });
 const w = dom.window;
 w.scrollTo = () => {};
 w.eval(`(() => { const c = state.character = getDefaultCharacter();
  c.name = 'Aster'; c.origin = Object.keys(DM_DATA.origins)[0];
  c.archetype = Object.keys(DM_DATA.archetypes)[0]; c.temperament = Object.keys(DM_DATA.temperaments)[0];
  c.finalized = true; normalizeEditableLists(); computeStats();
  c.currentSpirit = 3; c.appliedRerolls = []; })()`);
 return dom;
}
const fixture = baseWindow();
const initialCode = fixture.window.eval('buildCharacterCode()');
const initialCodeFirstContact = fixture.window.eval('delete state.character.appliedRerolls; buildCharacterCode()');
fixture.window.close();
const emptyRoom = { v: 5, momentum: 0, threat: 0, log: [], bonds: [],
 epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 }, compAt: 20 };
const CHAR = 'com.thuknights.dnm-obr/char', ROOM = 'com.thuknights.dnm-rolls/state';
async function sheet(code = initialCode, room = emptyRoom) {
 const dom = baseWindow(), w = dom.window;
 w.__io = { code, room: structuredClone(room), events: [], writes: [], pending: [], hold: false, failWrite: false, failSend: false };
 const stub = `const OBR = {
  isAvailable: true, onReady: fn => { window.__start = fn; },
  player: { getRole: async () => 'GM', getId: async () => 'p1', getName: async () => 'Reviewer', onChange: () => () => {} },
  party: { getPlayers: async () => [], onChange: () => () => {} },
  broadcast: { onMessage: () => () => {}, sendMessage: async (ch, ev) => { if (window.__io.failSend) throw Error('injected send failure'); window.__io.events.push(ev); } },
  room: { getMetadata: async () => ({ ['${ROOM}']: window.__io.room }), onMetadataChange: () => () => {} },
  scene: { onReadyChange: () => () => {}, items: {
   getItems: async () => [{ id: 'review-token', metadata: { ['${CHAR}']: { v: 1, code: window.__io.code } } }],
   onChange: () => () => {},
   updateItems: async (ids, mutate) => {
    const items = [{ id: 'review-token', metadata: { ['${CHAR}']: { v: 1, code: window.__io.code } } }];
    mutate(items); const next = items[0].metadata['${CHAR}'].code;
    window.__io.writes.push(next);
    if (window.__io.failWrite) throw Error('injected token write failure');
    if (window.__io.hold) return new Promise(resolve => window.__io.pending.push({ code: next, finish() { window.__io.code = next; resolve(); } }));
    window.__io.code = next;
   }
  } },
  popover: { close: async () => {}, setWidth: async () => {}, setHeight: async () => {}, open: async () => {} },
  modal: { close: async () => {} }, viewport: { getWidth: async () => 1200, getHeight: async () => 900 }, action: { setHeight: async () => {} }
 };`;
 w.eval(stub + moduleBody);
 await w.__start();
 await delay(500); // settle the real save debounce before injecting a failure
 w.__io.events.length = 0; w.__io.writes.length = 0;
 return { w, dom, g: text => w.eval(text), io: w.__io };
}
async function moduleApp(filename, io, append = '', documentHtml = null) {
 const dom = documentHtml ? new JSDOM(documentHtml, { runScripts: 'outside-only', url: 'https://gsgrimoire.github.io/dnm-obr/', virtualConsole }) : null;
 const store = new Map();
 const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
 const context = dom ? dom.getInternalVMContext() : vm.createContext({ console, structuredClone, TextEncoder, TextDecoder, URL, Date, setTimeout, clearTimeout, atob, btoa });
 const target = dom ? dom.window : context;
 if (!dom) target.window = target;
 Object.assign(target, { __io: io, structuredClone, TextEncoder, TextDecoder });
 if (!dom) target.localStorage = storage;
 const sdk = `export default { isAvailable: true, onReady() {}, action: { setHeight: async () => {} },
  player: { getId: async () => window.__io.playerId || 'gm1', getConnectionId: async () => window.__io.connectionId || 'gm1-conn' },
  party: { getPlayers: async () => window.__io.players || [] },
  room: { id: 'review-room', getMetadata: async () => structuredClone(window.__io.metadata), setMetadata: async patch => { Object.assign(window.__io.metadata, structuredClone(patch)); } },
  broadcast: { sendMessage: async (channel, ev) => { window.__io.events.push(ev); } }
 };`;
 const cache = new Map();
 function load(file) {
  if (cache.has(file)) return cache.get(file);
  let src = file.endsWith('/sdk.js') ? sdk : fs.readFileSync(file, 'utf8');
  if (file.endsWith('/' + filename)) src += '\n' + append;
  const mod = new vm.SourceTextModule(src, { context, identifier: file, initializeImportMeta(meta) { meta.url = 'file://' + file; } });
  cache.set(file, mod); return mod;
 }
 const main = load(path.join(ext, filename));
 await main.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
 await main.evaluate();
 return { api: main.namespace, dnm: load(path.join(ext, 'dnm.js')).namespace, dom, target };
}
const roll = (id = 'r1', extra = {}) => ({ id, by: 'p1', who: 'Aster', t: 1000, an: 'Might', av: 10, sn: 'Fight', sv: 2,
 diff: 1, compAt: 20, src: 'pc', detail: [{ d: 19, kind: 'fail' }, { d: 9, kind: 'success' }], succ: 1, comp: 0, pass: true, gain: 0, ...extra });
const rr = (id = 'r1') => ({ type: 'reroll', id, how: 'spirit', pay: 'room', g: 'g-' + id, t: 2000, dice: [{ i: 0, to: 1 }] });
const request = { id: 'paid-review-1', attr: 'might', skill: 'fight', extra: 2, difficulty: 2, label: 'Review primary' };

// 1. Same-sheet save completions can arrive in the wrong order.
{
 const s = await sheet(); s.io.hold = true;
 s.g('state.character.currentSpirit = 2'); const first = s.w.commit();
 s.g('state.character.currentSpirit = 1'); const second = s.w.commit();
 assert.equal(s.io.pending.length, 2);
 s.io.pending[1].finish(); await second;
 s.io.pending[0].finish(); await first;
 const saved = s.g(`parseCharacterCode(${JSON.stringify(s.io.code)}).character.currentSpirit`);
 const local = s.g("getEffectiveResource('spirit')");
 assert.equal(saved, 2); assert.equal(local, 1);
 record('save-completion-order', { savedSpirit: saved, localSpirit: local, status: s.w.document.getElementById('obrSaveState').textContent });
 s.w.close();
}

// 2a. A paid roll is published even though its resource/receipt save failed.
{
 const s = await sheet(); s.io.failWrite = true; s.w.rollDie = () => 4;
 const result = await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
 const publicEntry = s.io.events.find(e => e.type === 'roll')?.entry;
 const durableSpirit = s.g(`parseCharacterCode(${JSON.stringify(s.io.code)}).character.currentSpirit`);
 assert(result); assert(publicEntry); assert.equal(durableSpirit, 3);
 const retry = await sheet(s.io.code, { ...emptyRoom, log: [publicEntry] }); retry.w.rollDie = () => 7;
 const second = await retry.w.consumeRequestedSpiritTest(JSON.stringify(request));
 assert(second); assert.notEqual(result.dice.join(), second.dice.join());
 record('paid-roll-save-failure', { durableSpirit, publishedDice: result.dice, replayDice: second.dice, sameRollId: second.rollId === result.rollId });
 s.w.close(); retry.w.close();
}
// 2b. Opposite failure: Spirit and receipt persist, but a failed broadcast cannot retry.
{
 const s = await sheet(); s.io.failSend = true;
 const result = await s.w.consumeRequestedSpiritTest(JSON.stringify(request));
 assert(result); assert.equal(s.io.events.filter(e => e.type === 'roll').length, 0);
 const retry = await sheet(s.io.code); const next = await retry.w.consumeRequestedSpiritTest(JSON.stringify(request));
 assert.equal(next, null); assert.equal(retry.io.events.filter(e => e.type === 'roll').length, 0);
 record('paid-roll-send-failure', { persistedSpirit: retry.g("getEffectiveResource('spirit')"), retriedResult: next, roomRolls: 0 });
 s.w.close(); retry.w.close();
}

// Load the real background and reducer; no live account, room or SDK session is used.
const backgroundAppend = `export function auditPersist(ev, ctx) { return persist(ev, ctx); }
 export function auditWatch(items) { recoveryRoom = 'review-room'; watchForLostCharacters(items); }
 export function auditRecovery() { return readRecovery(safeStorage(), 'review-room'); }
 export async function auditRefresh() { await refreshGmConnections(); }
 export function auditAccept(ev) { relay(ev); return writeChain; }`;
const io = { metadata: { [ROOM]: structuredClone(emptyRoom) }, events: [] };
const bg = await moduleApp('background.js', io, backgroundAppend);
const dnm = bg.dnm;
// 3. Each gamemaster background is a writer; a second one can apply the same delta twice.
{
 const other = await moduleApp('background.js', { ...io, playerId: 'gm2', connectionId: 'gm2-conn' }, backgroundAppend);
 const ev = { type: 'pool', pool: 'momentum', delta: 1 };
 await bg.api.auditPersist(ev, { sender: 'p1' });
 await other.api.auditPersist(ev, { sender: 'p1' });
 assert.equal(io.metadata[ROOM].momentum, 2);
 record('two-background-writers', { oneEventDelta: 1, resultingMomentum: io.metadata[ROOM].momentum });
}

// 4. A same-length character edit is not incorporated into the recovery baseline.
{
 const f = baseWindow(), w = f.window;
 const byLength = new Map(); let pair;
 for (let i = 0; i < 40 && !pair; i++) {
  w.eval(`state.character.customItems = [${JSON.stringify('Review item ' + i)}]`);
  const code = w.eval('buildCharacterCode()');
  if (byLength.has(code.length)) pair = [byLength.get(code.length), code]; else byLength.set(code.length, code);
 }
 assert(pair); assert.notEqual(pair[0], pair[1]);
 const token = code => [{ id: 'same-token', metadata: { [CHAR]: { v: 1, code } } }];
 bg.api.auditWatch(token(pair[0])); bg.api.auditWatch(token(pair[1])); bg.api.auditWatch([]);
 const recovered = bg.api.auditRecovery()[0].code;
 assert.equal(recovered, pair[0]); assert.notEqual(recovered, pair[1]);
 record('same-length-recovery', { characterCodeLength: pair[0].length, recoveredLatestEdit: false });
 w.close();
}

// 5. Debts in the display log can be silently adopted or evicted rather than collected.
{
 const changed = dnm.applyEvent({ ...emptyRoom, log: [roll()] }, rr(), { sender: 'p1' });
 const s = await sheet(initialCodeFirstContact, changed);
 assert.equal(s.g("getEffectiveResource('spirit')"), 3);
 record('first-open-reroll-debt', { beforeSpirit: 3, afterSpirit: 3, receiptMarkedApplied: s.g('state.character.appliedRerolls.length') === 1 });
 s.w.close();
 let trimmed = changed;
 for (let i = 0; i < 40; i++) trimmed = dnm.applyEvent(trimmed, { type: 'action', entry: { id: 'later-' + i, t: i + 3000, kind: 'action', who: 'Reviewer', label: 'Later', detail: 'Later table action' } });
 assert(!trimmed.log.some(e => e.id === 'r1'));
 const later = await sheet(initialCode, trimmed);
 assert.equal(later.g("getEffectiveResource('spirit')"), 3);
 record('trimmed-reroll-debt', { logEntries: trimmed.log.length, afterSpirit: 3, paidRerollRemoved: true });
 later.w.close();
}

// 6. The real roller claim sends separate claim and pool events; stale clients both pay out.
{
 const io = { metadata: { [ROOM]: structuredClone(emptyRoom) }, events: [] };
 const append = `export function auditSeed(next) { state = next; role = 'GM'; myPlayerId = 'p1'; standalone = false; render(); }
 export function auditClaim(entry) { return claimMomentum(entry); }`;
 const roller = await moduleApp('roller.js', io, append, fs.readFileSync(path.join(ext, 'index.html'), 'utf8'));
 const entry = roll('gain', { gain: 3, succ: 4 });
 roller.api.auditSeed({ ...emptyRoom, log: [entry] });
 await Promise.all([roller.api.auditClaim(entry), roller.api.auditClaim(entry)]);
 let state = { ...emptyRoom, log: [entry] };
 for (const ev of io.events) state = dnm.applyEvent(state, ev, { sender: 'p1' });
 assert.equal(state.momentum, 6);
 record('duplicate-momentum-claim', { singleRollGain: 3, twoStaleClaimsPay: state.momentum });
 io.events.length = 0;
 roller.api.auditSeed({ ...emptyRoom, momentum: 5, log: [entry] }); await roller.api.auditClaim(entry);
 state = { ...emptyRoom, momentum: 5, log: [entry] };
 for (const ev of io.events) state = dnm.applyEvent(state, ev, { sender: 'p1' });
 assert.equal(state.momentum, 8);
 record('momentum-cap-disagreement', { initialPool: 5, rollGain: 3, resultingPool: 8, sheetCap: 6 });
 roller.dom.window.close();
}

// The normal sheet claim never sends the shared claim lock at all.
{
 const s = await sheet(); s.w.rollDie = () => 1;
 const res = await s.w.consumeRequestedSpiritTest(JSON.stringify({ ...request, id: 'sheet-claim', extra: 1, difficulty: 5 }));
 assert.equal(res.momentumGained, 1);
 s.w.claimRollMomentum();
 let room = structuredClone(emptyRoom);
 for (const ev of s.io.events) room = dnm.applyEvent(room, ev, { sender: 'p1' });
 assert.equal(room.momentum, 1);
 const shared = room.log.find(e => e.id === 'sheet-claim');
 assert(!shared.claimed); assert.equal(s.io.events.filter(e => e.type === 'claim').length, 0);
 record('sheet-claim-not-shared', { gainedMomentum: room.momentum, sharedClaimed: !!shared.claimed, localClaimed: s.g('diceUI.lastResult.momentumClaimed') });
 s.w.close();
}

// 7. Import does not bound expansion or rendering work from a compressed payload.
{
 const compressed = deflateRawSync(Buffer.from('x'.repeat(2 * 1024 * 1024)));
 const decoded = dnm.unpackPayload(compressed.toString('base64').replace(/=/g, ''));
 assert.equal(decoded.length, 2 * 1024 * 1024);
 record('unbounded-decompression', { compressedBytes: compressed.length, expandedBytes: decoded.length, rejected: false });
 const f = baseWindow(), w = f.window;
 const character = JSON.parse(w.eval('JSON.stringify(state.character)'));
 character.bonds = Array.from({ length: 1000 }, () => ({ name: 'Review bond', type: 'supportive' }));
 const payload = deflateRawSync(Buffer.from(JSON.stringify(character))).toString('base64').replace(/=/g, '');
 const code = initialCode.split('-').map(p => p.startsWith('CP') ? 'CP' + payload : p).join('-');
 const rendered = w.eval(`(() => {
  const parsed = parseCharacterCode(${JSON.stringify(code)});
  if (parsed.error) throw Error(parsed.error);
  const text = renderSheetBondsTemperamentRow(parsed.character, DM_DATA.temperaments[parsed.character.temperament]);
  return { acceptedBonds: parsed.character.bonds.length, renderedCharacters: text.length };
 })()`);
 assert.equal(rendered.acceptedBonds, 1000);
 record('unbounded-character-list', { characterCodeCharacters: code.length, ...rendered });
 w.close();
}

// 8. A corrupt CP is silently replaced with the incomplete legacy segments.
{
 const f = baseWindow(), w = f.window;
 w.eval(`state.character.items = [{ id: DM_DATA.items[0].id, qty: 1 }]; state.character.currentSpirit = 1;`);
 const good = w.eval('buildCharacterCode()');
 const corrupt = good.split('-').map(p => p.startsWith('CP') ? 'CP!' : p).join('-');
 const parsed = w.eval(`parseCharacterCode(${JSON.stringify(corrupt)})`);
 assert(!parsed.error); assert.equal(parsed.character.items.length, 0);
 record('corrupt-character-fallback', { rejected: false, inventoryBefore: 1, inventoryAfter: parsed.character.items.length, spiritBefore: 1, parsedSpiritAfter: parsed.character.currentSpirit });
 w.close();
}

// Positive controls: exercise the actual background relay against forged privileged events.
{
 io.players = [{ id: 'p1', connectionId: 'pc1-conn', role: 'PLAYER' }];
 io.metadata[ROOM] = { ...structuredClone(emptyRoom), threat: 10, log: [roll()] };
 await bg.api.auditRefresh();
 for (const ev of [{ type: 'clear' }, { type: 'epoch', boundary: 'bed' }, { type: 'pool', pool: 'threat', delta: -1 }, rr()]) {
  const before = JSON.stringify([io.metadata[ROOM].momentum, io.metadata[ROOM].threat, io.metadata[ROOM].epochs, io.metadata[ROOM].log]);
  await bg.api.auditAccept({ connectionId: ev.type === 'reroll' ? 'unknown-conn' : 'pc1-conn', data: ev });
  assert.equal(JSON.stringify([io.metadata[ROOM].momentum, io.metadata[ROOM].threat, io.metadata[ROOM].epochs, io.metadata[ROOM].log]), before);
 }
 await bg.api.auditAccept({ connectionId: 'pc1-conn', data: rr() });
 assert.equal(io.metadata[ROOM].log[0].rr.length, 1);
 await bg.api.auditAccept({ connectionId: 'gm1-conn', data: { type: 'clear' } });
 assert.equal(io.metadata[ROOM].log.length, 0);
 console.log('Positive controls passed: four unauthorized messages refused; own reroll and gamemaster clear accepted.');
}
fs.writeFileSync(new URL('./observed.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.log(`Review probes reproduced ${results.length} defect scenarios.`);
