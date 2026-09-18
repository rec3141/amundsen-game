export const STORAGE_KEY = 'amundsen-exploration', VERSION = 2;
// The fog grid covers the whole world (2600 x 1800 km): a cell is 20 km, the ship charts 120 km around it.
export const COLS = 130, ROWS = 90, MAX_ROUTE = 1200, MAX_LOG = 100, MAX_SIGHTED = 300;
const REVEAL_X = .046, REVEAL_Y = .0667;
// Northern Baffin Bay off Pituffik, the first open-water waypoint of the Leg 3 plan (world.json start).
export const START = { x: .6916, y: .4508 };
const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const position = (p, start = START) => ({ x: finite(p?.x, start.x, 0, 1), y: finite(p?.y, start.y, 0, 1) });
const validPosition = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const title = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
const optional = (value, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : null;
export function newVoyage(score = 0, start = START) {
  return { version: VERSION, ...position(null, start), safe: position(null, start), score: finite(score, 0, 0, Number.MAX_SAFE_INTEGER), operations: 0, groundings: 0, revealed: [], mapped: [], route: [], discoveries: [], sighted: [] };
}
// Log entries keep where they happened; an entry from an older chart with no place on this one has x and y null.
function entry(d, placed = true) {
  const at = placed && validPosition(d) ? position(d) : { x: null, y: null };
  return { ...at, lon: optional(d.lon, -180, 180), lat: optional(d.lat, -90, 90), depth: optional(d.depth, 0, 12000), title: title(d.title, 'Observation'), activity: title(d.activity, 'operation'), points: finite(d.points, 0, 0, 1000000), lost: Math.floor(finite(d.lost, 0, 0, Number.MAX_SAFE_INTEGER)), date: typeof d.date === 'string' && Number.isFinite(Date.parse(d.date)) ? d.date : '', detail: safeDetail(d.detail) };
}
export function restoreVoyage(raw, legacy, start = START) {
  if (raw?.version === 1) {
    // Version 1 charted an imaginary sea: the score, the tally and the log carry over, positions do not.
    const state = newVoyage(raw.score, start);
    state.operations = Math.floor(finite(raw.operations, 0, 0, Number.MAX_SAFE_INTEGER));
    state.discoveries = (Array.isArray(raw.discoveries) ? raw.discoveries : []).filter(d => d && typeof d === 'object').slice(-MAX_LOG).map(d => entry(d, false));
    return state;
  }
  if (!raw || raw.version !== VERSION) return newVoyage(legacy?.score, start);
  const state = { ...newVoyage(raw.score, start), ...position(raw, start) };
  state.safe = validPosition(raw.safe) ? position(raw.safe, start) : position(state, start);
  state.operations = Math.floor(finite(raw.operations, 0, 0, Number.MAX_SAFE_INTEGER));
  state.groundings = Math.floor(finite(raw.groundings, 0, 0, Number.MAX_SAFE_INTEGER));
  state.revealed = [...new Set((Array.isArray(raw.revealed) ? raw.revealed : []).filter(n => Number.isInteger(n) && n >= 0 && n < COLS * ROWS))];
  state.mapped = [...new Set((Array.isArray(raw.mapped) ? raw.mapped : []).filter(n => Number.isInteger(n) && n >= 0 && n < 10000000))];
  state.route = (Array.isArray(raw.route) ? raw.route : []).filter(validPosition).slice(-MAX_ROUTE).map(p => position(p));
  state.discoveries = (Array.isArray(raw.discoveries) ? raw.discoveries : []).filter(d => d && typeof d === 'object').slice(-MAX_LOG).map(d => entry(d));
  state.sighted = [...new Set((Array.isArray(raw.sighted) ? raw.sighted : []).filter(name => typeof name === 'string').map(name => name.slice(0, 80)))].slice(-MAX_SIGHTED);
  return state;
}
export function readVoyage(storage, start = START) {
  const read = key => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };
  return restoreVoyage(read(STORAGE_KEY), read('amundsen-expedition'), start);
}
// Metadata is optional and bounded so a large or cyclic result cannot prevent saving the chart.
function safeDetail(detail) {
  try { const json = JSON.stringify(detail); return json && json.length <= 4096 ? JSON.parse(json) : null; } catch { return null; }
}
export function chartPosition(state, known = new Set(state.revealed)) {
  const cx = Math.floor(state.x * COLS), cy = Math.floor(state.y * ROWS);
  const reachX = Math.ceil(REVEAL_X * COLS), reachY = Math.ceil(REVEAL_Y * ROWS);
  let changed = false;
  for (let y = Math.max(0, cy - reachY); y <= Math.min(ROWS - 1, cy + reachY); y++) {
    for (let x = Math.max(0, cx - reachX); x <= Math.min(COLS - 1, cx + reachX); x++) {
      if (((x + .5) / COLS - state.x) ** 2 / REVEAL_X ** 2 + ((y + .5) / ROWS - state.y) ** 2 / REVEAL_Y ** 2 > 1) continue;
      const cell = y * COLS + x;
      if (!known.has(cell)) { known.add(cell); state.revealed.push(cell); changed = true; }
    }
  }
  const tail = state.route.at(-1);
  if (!tail || Math.hypot(state.x - tail.x, state.y - tail.y) >= .002) {
    state.route.push(position(state));
    // Thin the older track to retain the voyage's shape within a fixed storage budget.
    if (state.route.length > MAX_ROUTE) state.route = state.route.filter((_, i) => i >= MAX_ROUTE / 2 || i % 2 === 0);
  }
  return changed;
}
// Share of the chart revealed; with a sea mask (one flag per fog cell) only cells holding water count.
export function chartPercent(state, sea = null) {
  if (!sea) return Math.floor(state.revealed.length / (COLS * ROWS) * 100);
  let total = 0, seen = 0;
  for (let i = 0; i < sea.length; i++) total += sea[i];
  for (const cell of state.revealed) seen += sea[cell] ?? 0;
  return total ? Math.floor(seen / total * 100) : 0;
}
export function operationRecorder(state, activity, location, onAward = () => {}) {
  let active = true;
  return {
    cancel() { active = false; },
    complete(points, detail) {
      if (!active || !Number.isFinite(points) || points < 0) return false;
      active = false;
      points = Math.min(1000000, Math.floor(points));
      state.score = Math.min(Number.MAX_SAFE_INTEGER, state.score + points);
      state.operations = Math.min(Number.MAX_SAFE_INTEGER, state.operations + 1);
      const record = entry({ ...location, title: title(detail?.title, activity.title), activity: activity.id, points, date: new Date().toISOString(), detail });
      state.discoveries.push(record);
      if (state.discoveries.length > MAX_LOG) state.discoveries.shift();
      onAward(record);
      return true;
    },
  };
}
// Touching land costs every science point; the chart, the log and the discoveries stay.
export function runAground(state, location, place = '') {
  const lost = state.score;
  state.score = 0;
  state.groundings = Math.min(Number.MAX_SAFE_INTEGER, state.groundings + 1);
  const record = entry({ ...location, title: place ? `Ran aground near ${place}` : 'Ran aground', activity: 'grounding', points: 0, lost, date: new Date().toISOString() });
  state.discoveries.push(record);
  if (state.discoveries.length > MAX_LOG) state.discoveries.shift();
  Object.assign(state, position(state.safe, START));
  return record;
}

// A 120-degree fan spans 2 * depth * tan(60°). Cells are credited once at DEM resolution.
export const swathWidth = depth => 2 * depth * Math.sqrt(3);
export function mapSwath(state, mapped, world, from, to) {
  const du = to.u - from.u, dv = to.v - from.v, distance = Math.hypot(du, dv);
  if (!distance) return [];
  const added = [], steps = Math.max(1, Math.ceil(distance * 4));
  for (let step = 0; step <= steps; step++) {
    const u = from.u + du * step / steps, v = from.v + dv * step / steps;
    const half = swathWidth(world.depth(u, v)) / world.meta.grid.resolution / 2;
    const samples = Math.max(1, Math.ceil(half * 8));
    for (let n = 0; n <= samples; n++) {
      const offset = half * (2 * n / samples - 1);
      const x = u - dv / distance * offset, y = v + du / distance * offset;
      if (x < 0 || y < 0 || x >= world.cols || y >= world.rows || world.isLand(x, y) || !world.lineClear(u, v, x, y)) continue;
      const cell = Math.floor(y) * world.cols + Math.floor(x);
      if (world.sign[cell] > 0 || mapped.has(cell)) continue;
      mapped.add(cell); state.mapped.push(cell); added.push(cell);
    }
  }
  state.score = Math.min(Number.MAX_SAFE_INTEGER, state.score + added.length);
  return added;
}
