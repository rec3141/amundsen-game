import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransect, drill, move, finish, score, measurements, HOLE_COUNT, MAX_DEPTH_CM, STROKE_CM } from '../static/minigames/ice-model.js';

function completeHole(state) {
  while (drill(state)) { /* Drill until breakthrough. */ }
}

test('seeded floes are repeatable, varied, and fit the chart range', () => {
  assert.deepEqual(createTransect('crew'), createTransect('crew'));
  assert.notDeepEqual(createTransect('crew').holes, createTransect('other').holes);
  for (let seed = 0; seed < 100; seed++) {
    const state = createTransect(seed);
    assert.equal(state.holes.length, HOLE_COUNT);
    assert.ok(HOLE_COUNT >= 8);
    state.holes.forEach((hole, i) => {
      assert.equal(hole.distanceM, i * 5);
      assert.ok(hole.thicknessCm > 0 && hole.thicknessCm < MAX_DEPTH_CM);
    });
  }
});

test('each stroke advances depth; only breakthrough reveals the measurement', () => {
  const state = createTransect('crew');
  const hole = state.holes[0];
  assert.equal(finish(state), null);
  drill(state);
  assert.equal(hole.depthCm, STROKE_CM);
  assert.deepEqual(measurements(state), []);
  assert.equal(score(state), 0);
  completeHole(state);
  assert.equal(hole.depthCm, hole.thicknessCm);
  assert.equal(hole.strokes, Math.ceil(hole.thicknessCm / STROKE_CM));
  assert.equal(measurements(state).length, 1);
  const saved = structuredClone(state);
  assert.equal(drill(state), false);
  assert.deepEqual(state, saved);
});

test('movement preserves partial work and respects transect bounds', () => {
  const state = createTransect('crew');
  assert.equal(move(state, -1), false);
  assert.equal(move(state, .5), false);
  drill(state);
  move(state, 1);
  assert.equal(state.holes[1].depthCm, 0);
  move(state, -1);
  assert.equal(state.holes[0].depthCm, STROKE_CM);
  move(state, HOLE_COUNT - 1);
  assert.equal(move(state, 1), false);
});

test('early finish awards once and excludes partial holes', () => {
  const state = createTransect('crew');
  completeHole(state);
  move(state, 1);
  drill(state);
  const result = finish(state);
  assert.equal(result.points, 25);
  assert.equal(result.detail.holes, 1);
  assert.equal(result.detail.title, 'Ice thickness');
  assert.equal(result.detail.source, 'seeded game floe');
  assert.deepEqual(result.detail.transect, [{ distanceM: 0, thicknessCm: state.holes[0].thicknessCm }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const saved = structuredClone(state);
  assert.equal(finish(state), null);
  assert.equal(drill(state), false);
  assert.equal(move(state, 1), false);
  assert.deepEqual(state, saved);
});

test('more holes increase score, with a full transect bonus', () => {
  const state = createTransect('crew');
  for (let i = 0; i < HOLE_COUNT; i++) {
    completeHole(state);
    assert.equal(score(state), (i + 1) * 25 + (i === HOLE_COUNT - 1 ? 50 : 0));
    move(state, 1);
  }
  const result = finish(state);
  assert.equal(result.points, 300);
  assert.equal(result.detail.holes, HOLE_COUNT);
  assert.equal(result.detail.transect.at(-1).distanceM, 45);
});
