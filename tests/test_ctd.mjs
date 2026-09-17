import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findLayer, segments, scoreBottle, advance, targets } from '../static/minigames/ctd-layers.js';
const profile = (v, p = v.map((_, i) => i)) => ({ p, vars: Object.fromEntries(['Temperature', 'Fluorescence', 'Oxygen', 'Sigma-t'].map(c => [c, v])) });
test('finite data only; flat and absent channels are unavailable', () => {
  assert.equal(findLayer(profile(Array(20).fill(2)), 'temperature'), null);
  assert.equal(findLayer({ p: [1, 2], vars: {} }, 'chlorophyll'), null);
  assert.equal(findLayer(profile([null, null, null, null, null]), 'oxygen'), null);
});
test('median rejects an isolated spike and locates a broad peak', () => {
  const a = Array.from({ length: 31 }, (_, i) => 15 - Math.abs(i - 15)); a[3] = 1000;
  const layer = findLayer(profile(a), 'chlorophyll');
  assert.ok(layer.pressures.every(p => p >= 14 && p <= 16));
  assert.equal(scoreBottle(15, layer).points, 100);
  assert.equal(scoreBottle(100, layer).points, 0);
});
test('monotonic minima remain legitimate edge targets', () => {
  const layer = findLayer(profile(Array.from({ length: 20 }, (_, i) => i)), 'temperature');
  assert.ok(layer.edge); assert.match(layer.description, /edge/);
});
test('gaps and missing observations split lines and prevent spurious pycnoclines', () => {
  const a = profile([0, 0, 0, 0, 0, null, 100, 100, 100, 100, 100]);
  assert.equal(segments(a, 'Sigma-t').length, 2);
  assert.equal(findLayer(a, 'pycnocline'), null);
  assert.equal(findLayer(profile([0, 0, 0, 0, 0, 100, 100, 100, 100, 100], [0, 1, 2, 3, 4, 30, 31, 32, 33, 34]), 'pycnocline'), null);
});
test('density target is strongest positive gradient, negative gradients excluded', () => {
  const a = Array.from({ length: 40 }, (_, i) => i < 15 ? 20 : i < 23 ? 20 + (i - 15) * .3 : 22.4);
  const layer = findLayer(profile(a), 'pycnocline');
  assert.ok(layer.p >= 17 && layer.p <= 21);
  assert.equal(findLayer(profile(a.map(v => -v)), 'pycnocline'), null);
});
test('winch holds at bottom, respects pause, and finishes at surface', () => {
  const bottom = advance({ phase: 'down', pressure: 95 }, 1, 100, 10);
  assert.deepEqual(bottom, { phase: 'bottom', pressure: 100 });
  assert.equal(advance(bottom, 999, 100, 10), bottom);
  const paused = { phase: 'up', pressure: 50, paused: true };
  assert.equal(advance(paused, 10, 100, 10), paused);
  assert.equal(advance({ phase: 'up', pressure: 5 }, 1, 100, 10).phase, 'done');
});
test('bundled profiles preserve finite targets and M4A provenance', () => {
  const manifest = JSON.parse(readFileSync(new URL('../static/data/ctd/index.json', import.meta.url)));
  assert.ok(manifest.casts.length >= 20);
  const counts = Object.fromEntries(Object.keys(targets).map(k => [k, 0]));
  for (const cast of manifest.casts) {
    const data = JSON.parse(readFileSync(new URL(`../static/data/ctd/${cast.file}`, import.meta.url)));
    for (const key of Object.keys(targets)) {
      const layer = findLayer(data, key);
      if (layer) { counts[key]++; assert.ok(Number.isFinite(layer.p)); }
    }
    if (cast.id.endsWith('051')) { assert.equal(data.station, 'M4A'); assert.equal(Math.max(...data.p), 534); }
  }
  for (const count of Object.values(counts)) assert.ok(count >= 20);
});
test('mount returns synchronous cleanup; three bottles finish; retry cannot award twice', async () => {
  const { ctd } = await import('../static/minigames/ctd.js');
  class Element {
    constructor() { this.children = []; this.nodes = new Map(); this.value = ''; this.textContent = ''; this._html = ''; }
    append(el) { this.children.push(el); }
    remove() { this.removed = true; }
    set innerHTML(value) { this._html = value; this.textContent = value.replace(/<[^>]*>/g, ''); }
    get innerHTML() { return this._html; }
    querySelector(key) {
      if (!this.nodes.has(key)) { const el = new Element(); el.value = key === '.ctd-target' ? 'chlorophyll' : key === '.ctd-cast' ? 'test' : ''; this.nodes.set(key, el); }
      return this.nodes.get(key);
    }
  }
  const original = Object.fromEntries(['document', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame'].map(k => [k, globalThis[k]]));
  let callback, signal, removed = false; const awards = [];
  globalThis.document = { createElement: () => new Element(), addEventListener() {}, removeEventListener() { removed = true; } };
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const data = { ...profile(Array.from({ length: 41 }, (_, i) => 20 - Math.abs(20 - i))), id: 'test', units: {} };
  globalThis.fetch = async (url, options) => { signal = options.signal; return { ok: true, json: async () => String(url).endsWith('index.json') ? { casts: [{ id: 'test', file: 'test.json', source: 'source.json' }] } : data }; };
  try {
    const root = new Element(); const cleanup = ctd.mount(root, { complete: (...args) => awards.push(args) });
    assert.equal(typeof cleanup, 'function');
    await new Promise(resolve => setImmediate(resolve));
    const game = root.children[1], get = key => game.querySelector(key);
    let time = 0;
    const descend = () => { get('.ctd-action').onclick(); for (let i = 0; i < 400; i++) callback(time += 100); };
    descend(); assert.match(get('.ctd-phase').textContent, /At depth/);
    assert.ok(!get('svg').innerHTML.includes('stroke-dasharray'));
    get('.ctd-action').onclick();
    for (let i = 0; i < 3; i++) get('.ctd-fire').onclick();
    assert.equal(awards.length, 1); assert.equal(awards[0][1].bottles.length, 3);
    assert.ok(get('svg').innerHTML.includes('stroke-dasharray'));
    assert.doesNotThrow(() => JSON.stringify(awards));
    get('.ctd-retry').onclick(); descend(); get('.ctd-action').onclick();
    for (let i = 0; i < 3; i++) get('.ctd-fire').onclick();
    assert.equal(awards.length, 1);
    cleanup(); assert.ok(signal.aborted); assert.ok(removed); assert.ok(game.removed);
  } finally { for (const [k, value] of Object.entries(original)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; } }
});
