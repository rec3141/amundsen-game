// Ice Patrol model: a ten-tenths chart grid, floe pieces built from egg codes, and the flight log.
export const COLS = 10;
export const ROWS = 16;
export const FUEL_SECONDS = 180;
export const FUEL_PER_BAND = 5;
export const KM_PER_BAND = 5;
export const BAND_POINTS = [0, 100, 250, 450, 700];
export const SIGHTING_POINTS = { bear: 60, muskox: 40 };
export const FALSE_SIGHTING_PENALTY = 15;

// Stage of development as printed in the egg code, with the chart colour used in the notebook
// and the look of the ice from the air. Codes with a dot are the older, thicker stages.
export const STAGES = {
  '1': { name: 'New ice', look: 'new', chart: '#e64dff' },
  '2': { name: 'Nilas', look: 'new', chart: '#d94dff' },
  '3': { name: 'Young ice', look: 'young', chart: '#b36bff' },
  '4': { name: 'Grey ice', look: 'young', chart: '#9b6be6' },
  '5': { name: 'Grey-white ice', look: 'young', chart: '#8a7fe0' },
  '6': { name: 'First-year ice', look: 'firstYear', chart: '#66cc66' },
  '7': { name: 'Thin first-year ice', look: 'firstYear', chart: '#99e699' },
  '8': { name: 'Thin first-year ice, stage 1', look: 'firstYear', chart: '#8fdc8f' },
  '9': { name: 'Thin first-year ice, stage 2', look: 'firstYear', chart: '#85d985' },
  '1•': { name: 'Medium first-year ice', look: 'firstYear', chart: '#33bb33' },
  '4•': { name: 'Thick first-year ice', look: 'firstYear', chart: '#1f8f1f' },
  '7•': { name: 'Old ice', look: 'old', chart: '#f39c27' },
  '8•': { name: 'Second-year ice', look: 'old', chart: '#f07020' },
  '9•': { name: 'Multi-year ice', look: 'old', chart: '#d83a2a' },
  'X': { name: 'Undetermined ice', look: 'young', chart: '#9aa5ab' },
};
export const FORMS = { '1': 'Pancake ice', '2': 'Brash ice', '3': 'Small floe', '4': 'Medium floe', '5': 'Big floe', '6': 'Vast floe', '7': 'Giant floe', '8': 'Fast ice', '9': 'Icebergs', 'X': 'Undetermined form' };

export function stageInfo(code) {
  return STAGES[code] ?? { name: `Stage ${code}`, look: 'firstYear', chart: '#9aa5ab' };
}

// Polyominoes by cell count. A zone's concentration scales to one through four cells.
const SHAPES = {
  1: [[[0, 0]]],
  2: [[[0, 0], [1, 0]]],
  3: [[[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [1, 1]]],
  4: [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[2, 0], [0, 1], [1, 1], [2, 1]],
  ],
};
const FAST_ICE = SHAPES[4][0];

export function createRandom(seed = Date.now()) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function tenths(partial, zone) {
  const value = Number(partial.c);
  return Number.isFinite(value) && value > 0 ? value : zone.concentration;
}

// Spreads the zone's partial concentrations over the piece's cells by largest remainder,
// so a 9+ zone of 8 tenths old ice and 2 tenths first-year gives three old cells and one first-year cell.
function allocate(zone, count) {
  const partials = zone.partials.length ? zone.partials : [{ s: 'X', c: '–' }];
  const weights = partials.map(partial => tenths(partial, zone));
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const shares = weights.map(w => w / total * count);
  const cells = shares.map(Math.floor);
  let remaining = count - cells.reduce((sum, c) => sum + c, 0);
  const order = shares.map((share, i) => [share - cells[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (remaining <= 0) break; cells[i] += 1; remaining -= 1; }
  if (cells[0] === 0) { cells[0] = 1; cells[cells.findIndex((c, i) => i > 0 && c > 0)] -= 1; }
  return partials.flatMap((partial, i) => Array(cells[i]).fill(partial.s));
}

export function pieceFromZone(zone, random) {
  const count = Math.max(1, Math.min(4, Math.round(zone.concentration / 10 * 4)));
  const fast = count === 4 && zone.partials.some(partial => partial.f === '8');
  const options = SHAPES[count];
  const shape = fast ? FAST_ICE : options[Math.floor(random() * options.length)];
  const stages = allocate(zone, count);
  for (let i = stages.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [stages[i], stages[j]] = [stages[j], stages[i]]; }
  return normalise({ zone, cells: shape.map(([x, y], i) => ({ x, y, stage: stages[i] })), x: 0, y: 0 });
}

function normalise(piece) {
  const minX = Math.min(...piece.cells.map(c => c.x));
  const minY = Math.min(...piece.cells.map(c => c.y));
  piece.cells = piece.cells.map(c => ({ ...c, x: c.x - minX, y: c.y - minY }));
  piece.width = Math.max(...piece.cells.map(c => c.x)) + 1;
  piece.height = Math.max(...piece.cells.map(c => c.y)) + 1;
  return piece;
}

// The flight route: zones in order of distance from the ship, with a little look-ahead so
// repeat flights meet them in a different order.
export function createRoute(zones, random) {
  const queue = zones.slice();
  let index = 0;
  return () => {
    if (!queue.length) return null;
    const window = Math.min(4, queue.length - index);
    const pick = index + Math.floor(random() * window);
    const zone = queue[pick];
    [queue[index], queue[pick]] = [queue[pick], queue[index]];
    index = (index + 1) % queue.length;
    return zone;
  };
}

export function createGame(zones, seed = Date.now()) {
  const random = createRandom(seed);
  const nextZone = createRoute(zones, random);
  const state = {
    random,
    nextZone,
    grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    piece: null,
    next: pieceFromZone(nextZone(), random),
    bands: [],
    points: 0,
    fuel: FUEL_SECONDS,
    sightings: [],
    falseSightings: 0,
    started: false,
    finished: false,
    reason: null,
  };
  return state;
}

export function collides(state, piece, dx = 0, dy = 0, cells = piece.cells) {
  return cells.some(({ x, y }) => {
    const gx = piece.x + x + dx;
    const gy = piece.y + y + dy;
    return gx < 0 || gx >= COLS || gy >= ROWS || (gy >= 0 && state.grid[gy][gx]);
  });
}

// Brings the next floe under the helicopter; returns false when the pack has closed the field.
export function spawn(state) {
  const piece = state.next;
  piece.x = Math.floor((COLS - piece.width) / 2);
  piece.y = 0;
  state.next = pieceFromZone(state.nextZone(), state.random);
  if (collides(state, piece)) {
    state.piece = piece;
    return false;
  }
  state.piece = piece;
  return true;
}

export function move(state, dx) {
  const piece = state.piece;
  if (!piece || state.finished || collides(state, piece, dx, 0)) return false;
  piece.x += dx;
  return true;
}

export function rotate(state, direction = 1) {
  const piece = state.piece;
  if (!piece || state.finished || piece.cells.length === 1) return false;
  const turned = normalise({ ...piece, cells: piece.cells.map(c => ({ ...c, x: direction > 0 ? -c.y : c.y, y: direction > 0 ? c.x : -c.x })) });
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collides(state, { ...turned, x: piece.x + kick }, 0, 0)) {
      Object.assign(piece, turned, { x: piece.x + kick });
      return true;
    }
  }
  return false;
}

// One gravity step. Returns { locked, cleared, bands } describing what the step did.
export function step(state) {
  const piece = state.piece;
  if (!piece || state.finished) return { locked: false, cleared: [], bands: [] };
  if (!collides(state, piece, 0, 1)) {
    piece.y += 1;
    return { locked: false, cleared: [], bands: [] };
  }
  return lock(state);
}

export function drop(state) {
  const piece = state.piece;
  if (!piece || state.finished) return { locked: false, cleared: [], bands: [], fell: 0 };
  let fell = 0;
  while (!collides(state, piece, 0, 1)) { piece.y += 1; fell += 1; }
  return { ...lock(state), fell };
}

function lock(state) {
  const piece = state.piece;
  for (const { x, y, stage } of piece.cells) {
    const gy = piece.y + y;
    if (gy >= 0) state.grid[gy][piece.x + x] = stage;
  }
  state.piece = null;
  const cleared = [];
  for (let y = 0; y < ROWS; y++) if (state.grid[y].every(Boolean)) cleared.push(y);
  const bands = cleared.map(y => composition(state.grid[y], state.bands.length + cleared.indexOf(y) + 1));
  for (const y of cleared) {
    state.grid.splice(y, 1);
    state.grid.unshift(Array(COLS).fill(null));
  }
  if (cleared.length) {
    state.bands.push(...bands);
    state.points += BAND_POINTS[Math.min(cleared.length, BAND_POINTS.length - 1)];
    state.fuel = Math.min(FUEL_SECONDS, state.fuel + FUEL_PER_BAND * cleared.length);
  }
  return { locked: true, cleared, bands };
}

// A full row is ten tenths, so its make-up reads directly as an egg code: total concentration
// 10 with each stage's cell count as its partial concentration.
export function composition(row, index) {
  const counts = new Map();
  for (const stage of row) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  const partials = [...counts].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ s, c }));
  return { index, ct: '10', partials, km: index * KM_PER_BAND };
}

export function distanceKm(state) {
  return state.bands.length * KM_PER_BAND;
}

export function speedMs(state) {
  return Math.max(230, 820 - state.bands.length * 42);
}

export function burnFuel(state, seconds) {
  if (!state.started || state.finished) return;
  state.fuel = Math.max(0, state.fuel - seconds);
}

export function logSighting(state, kind, km = distanceKm(state)) {
  if (state.finished) return 0;
  const points = SIGHTING_POINTS[kind] ?? 0;
  state.sightings.push({ kind, km });
  state.points += points;
  return points;
}

export function falseSighting(state) {
  if (state.finished) return 0;
  state.falseSightings += 1;
  const penalty = Math.min(FALSE_SIGHTING_PENALTY, state.points);
  state.points -= penalty;
  return penalty;
}

// Mean tenths of each stage across the charted bands, the way an observer sums up a flight.
export function summary(state) {
  const totals = new Map();
  for (const band of state.bands) for (const { s, c } of band.partials) totals.set(s, (totals.get(s) ?? 0) + c);
  const bands = state.bands.length || 1;
  return [...totals].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ stage: s, name: stageInfo(s).name, tenths: Math.round(c / bands * 10) / 10 }));
}

export function finish(state, reason, chart) {
  if (state.finished) return null;
  state.finished = true;
  state.reason = reason;
  const bears = state.sightings.filter(s => s.kind === 'bear').length;
  const muskox = state.sightings.length - bears;
  return {
    points: state.points,
    detail: {
      title: 'Ice Patrol',
      reason,
      bandsCharted: state.bands.length,
      distanceKm: distanceKm(state),
      fuelLeftS: Math.round(state.fuel),
      sightings: { polarBear: bears, muskOx: muskox, unconfirmed: state.falseSightings },
      meanTenths: summary(state),
      bands: state.bands.map(band => ({ km: band.km, egg: `${band.ct} | ${band.partials.map(p => `${p.c}·${p.s}`).join(' ')}` })),
      chart: chart ? { id: chart.id, date: chart.date, region: chart.region, attribution: chart.attribution } : undefined,
    },
  };
}
