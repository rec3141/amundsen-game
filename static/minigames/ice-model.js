export const HOLE_COUNT = 10;
export const SPACING_M = 5;
export const MAX_DEPTH_CM = 400;
export const STROKE_CM = 20;
// A Kovacs Mark II core barrel holds 1 m of core. Deeper ice takes another run on an extension rod.
export const BARREL_CM = 100;

const MULTI_YEAR = /multi|old|second|perennial|\bmy/i;

// Optional ice information from the world: { type | stage, thicknessCm }. Anything missing is drawn from the seed.
function floeProfile(ice, random) {
  const label = typeof ice === 'string' ? ice : `${ice?.type ?? ''} ${ice?.stage ?? ''}`;
  const given = Number.isFinite(ice?.thicknessCm) ? Math.min(300, Math.max(40, ice.thicknessCm)) : null;
  const pick = random();
  const multiYear = label.trim() ? MULTI_YEAR.test(label) : given !== null ? given >= 180 : pick < 0.4;
  const spread = random();
  // Late-summer level ice: first-year 0.7–1.3 m after melt, multi-year 1.9–2.7 m.
  const baseline = given ?? (multiYear ? 190 + spread * 80 : 70 + spread * 60);
  return { multiYear, baseline };
}

// A seeded floe keeps the transect stable while the player revisits holes.
export function createTransect(seed = 'ice-floe', ice = null) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const { multiYear, baseline } = floeProfile(ice, random);
  // One ridge keel (first-year) or hummock (multi-year) thickens the floe; one melt pond thins it.
  const ridge = 2 + Math.floor(random() * 6);
  const keel = (multiYear ? 45 : 55) + random() * 30;
  const pond = (ridge + 3 + Math.floor(random() * 4)) % HOLE_COUNT;
  const melt = 15 + random() * 20;
  const holes = Array.from({ length: HOLE_COUNT }, (_, index) => {
    const modelled = baseline + keel * Math.exp(-((index - ridge) ** 2) / 3) - (index === pond ? melt : 0) + random() * 18;
    return {
      distanceM: index * SPACING_M,
      thicknessCm: Math.round(Math.min(MAX_DEPTH_CM - 10, Math.max(30, modelled))),
      depthCm: 0,
      coreCm: 0,
      stage: 'drilling',
      extensions: 0,
      runs: 0,
      measured: false,
      strokes: 0,
    };
  });
  const deepest = Math.max(...holes.map(hole => hole.thicknessCm));
  return {
    holes,
    current: 0,
    finished: false,
    iceType: multiYear ? 'multi-year' : 'first-year',
    scaleCm: deepest < 240 ? 250 : MAX_DEPTH_CM,
  };
}

// The step the current hole needs next: 'drill', 'pull', 'empty', 'extend', or null when nothing is left to do.
export function nextAction(state) {
  const hole = state.holes[state.current];
  if (state.finished || hole.measured) return null;
  return { drilling: 'drill', full: 'pull', pulled: 'empty', emptied: 'extend' }[hole.stage];
}

export function drill(state) {
  if (nextAction(state) !== 'drill') return false;
  const hole = state.holes[state.current];
  const runFloor = hole.depthCm - hole.coreCm + BARREL_CM;
  const depth = Math.min(hole.thicknessCm, runFloor, hole.depthCm + STROKE_CM);
  hole.strokes += 1;
  hole.coreCm += depth - hole.depthCm;
  hole.depthCm = depth;
  if (depth === hole.thicknessCm) {
    hole.measured = true;
    hole.runs = hole.extensions + 1;
  } else if (hole.coreCm === BARREL_CM) hole.stage = 'full';
  return true;
}

export function pull(state) {
  if (nextAction(state) !== 'pull') return false;
  state.holes[state.current].stage = 'pulled';
  return true;
}

export function empty(state) {
  if (nextAction(state) !== 'empty') return false;
  const hole = state.holes[state.current];
  hole.coreCm = 0;
  hole.stage = 'emptied';
  return true;
}

// Adds a 1 m extension rod and sends the empty barrel back to the bottom of the hole.
export function extend(state) {
  if (nextAction(state) !== 'extend') return false;
  const hole = state.holes[state.current];
  hole.extensions += 1;
  hole.stage = 'drilling';
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
    coreRuns: hole.runs,
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
    detail: {
      title: 'Ice thickness',
      holes: transect.length,
      source: 'seeded game floe',
      iceType: state.iceType,
      corer: 'Kovacs Mark II, 1 m barrel',
      meanThicknessCm: Math.round(transect.reduce((sum, hole) => sum + hole.thicknessCm, 0) / transect.length),
      transect,
    },
  };
}
