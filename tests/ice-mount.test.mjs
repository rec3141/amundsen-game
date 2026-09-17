import test from 'node:test';
import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { ice } from '../static/minigames/ice.js';

// A minimal DOM contract double exercises events and lifecycle, not layout.
class Element extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.attributes = {};
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
    this.isConnected = true;
    this.textContent = '';
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  focus() { document.activeElement = this; }
  closest() { return null; }
}

function fixture() {
  setMaxListeners(0);
  const root = new Element();
  const game = new Element();
  const nodes = new Map();
  const buttons = Array.from({ length: 10 }, () => new Element());
  const dialog = { open: true };
  root.closest = () => dialog;
  root.querySelector = () => game;
  game.querySelector = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  game.querySelectorAll = () => buttons;
  const node = selector => game.querySelector(selector);
  node('.ice-progress').firstElementChild = new Element();
  globalThis.window = new EventTarget();
  globalThis.document = { activeElement: null, createElementNS: () => new Element() };
  const results = [];
  const cleanup = ice.mount(root, { expedition: { seed: 'test' }, complete: (...args) => results.push(args) });
  function key(key, options = {}) {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ key, repeat: false, ...options }).map(([name, value]) => [name, { value }])));
    window.dispatchEvent(event);
    return event;
  }
  const click = selector => node(selector).dispatchEvent(new Event('click'));
  return { root, game, dialog, node, key, click, results, cleanup, buttons };
}

test('mount uses proxy-relative stylesheet; repeat, text input and modifiers do not drill', () => {
  const f = fixture();
  try {
    assert.match(f.root.innerHTML, /minigames\/ice.css/);
    assert.equal(f.node('[data-reading]').textContent, 'Drilled: 0 cm');
    assert.equal(f.key('d', { repeat: true }).defaultPrevented, true);
    f.key('d', { target: { closest: () => ({}) } });
    f.key('d', { ctrlKey: true });
    assert.equal(f.node('[data-reading]').textContent, 'Drilled: 0 cm');
    assert.equal(f.key('D').defaultPrevented, true);
    assert.equal(f.node('[data-reading]').textContent, 'Drilled: 20 cm');
    f.key('ArrowRight');
    f.click('[data-drill]');
    f.key('ArrowLeft');
    assert.equal(f.node('[data-reading]').textContent, 'Drilled: 20 cm');
    assert.equal(f.node('[data-chart]').children.length, 0);
  } finally { f.cleanup(); }
});

test('breakthrough reveals chart, enables early finish, and complete is called once', () => {
  const f = fixture();
  try {
    f.click('[data-finish]');
    assert.equal(f.results.length, 0);
    for (let i = 0; i < 40; i++) f.click('[data-drill]');
    assert.equal(f.node('[data-chart]').children.length, 1);
    assert.equal(f.node('[data-drill]').disabled, true);
    assert.equal(f.node('[data-finish]').disabled, false);
    f.click('[data-finish]');
    f.click('[data-finish]');
    f.key('d');
    assert.equal(f.results.length, 1);
    assert.equal(f.results[0][0], 25);
    assert.equal(f.results[0][1].holes, 1);
  } finally { f.cleanup(); }
});

test('closed or detached game ignores keyboard, and cleanup removes keyboard and button listeners', () => {
  const f = fixture();
  f.dialog.open = false;
  assert.equal(f.key('d').defaultPrevented, false);
  f.dialog.open = true;
  f.game.isConnected = false;
  assert.equal(f.key('d').defaultPrevented, false);
  f.game.isConnected = true;
  f.cleanup();
  f.cleanup();
  assert.equal(f.key('d').defaultPrevented, false);
  f.click('[data-drill]');
  assert.equal(f.node('[data-reading]').textContent, 'Drilled: 0 cm');
  assert.equal(f.results.length, 0);
});

test('chart leaves unmeasured gaps, then joins adjacent measurements; full finish awards once', () => {
  const f = fixture();
  try {
    const drillHole = () => { for (let i = 0; i < 30; i++) ['d', 'p', 'e', 'x'].forEach(k => f.key(k)); };
    drillHole();
    f.key('ArrowRight');
    f.key('ArrowRight');
    drillHole();
    assert.equal(f.node('[data-chart]').children.length, 2);
    f.key('ArrowLeft');
    drillHole();
    assert.equal(f.node('[data-chart]').children.length, 5);
    for (let i = 3; i < 10; i++) {
      f.buttons[i].dispatchEvent(new Event('click'));
      drillHole();
    }
    assert.equal(f.node('[data-chart]').children.length, 19);
    assert.equal(f.node('[data-count]').textContent, '10 / 10 logged');
    assert.equal(f.results.length, 0);
    f.click('[data-finish]');
    f.click('[data-finish]');
    assert.equal(f.results.length, 1);
    assert.equal(f.results[0][0], 300);
    assert.equal(f.results[0][1].holes, 10);
  } finally { f.cleanup(); }
});
