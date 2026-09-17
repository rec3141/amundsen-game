export const HOLE_COUNT = 10;
export const SPACING_M = 5;
export const MAX_DEPTH_CM = 240;
export const STROKE_CM = 14;

// A seeded floe keeps the transect stable while the player revisits holes.
export function createTransect(seed = 'ice-floe') {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const baseline = 95 + random() * 35;
  const ridge = 3 + Math.floor(random() * 4);
  const holes = Array.from({ length: HOLE_COUNT }, (_, index) => ({
    distanceM: index * SPACING_M,
    thicknessCm: Math.round(baseline + 65 * Math.exp(-((index - ridge) ** 2) / 3) + random() * 22),
    depthCm: 0,
    measured: false,
    strokes: 0,
  }));
  return { holes, current: 0, finished: false };
}

export function drill(state) {
  const hole = state.holes[state.current];
  if (state.finished || hole.measured) return false;
  hole.strokes += 1;
  hole.depthCm = Math.min(hole.thicknessCm, hole.depthCm + STROKE_CM);
  hole.measured = hole.depthCm === hole.thicknessCm;
  return true;
}

export function move(state, direction) {
  if (state.finished) return false;
  const next = state.current + direction;
  if (!Number.isInteger(next) || next < 0 || next >= state.holes.length) return false;
  state.current = next;
  return true;
}

export function measurements(state) {
  return state.holes.filter(hole => hole.measured).map(hole => ({
    distanceM: hole.distanceM,
    thicknessCm: hole.thicknessCm,
  }));
}

export function score(state) {
  const count = measurements(state).length;
  return count * 25 + (count === state.holes.length ? 50 : 0);
}

export function finish(state) {
  if (state.finished || !state.holes.some(hole => hole.measured)) return null;
  state.finished = true;
  const transect = measurements(state);
  return {
    points: score(state),
    detail: { title: 'Ice thickness', holes: transect.length, source: 'seeded game floe', transect },
  };
}
