export const STORAGE_KEY = 'amundsen-exploration';
export const COLS = 60, ROWS = 40, MAX_ROUTE = 600, MAX_LOG = 100;
const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const position = p => ({ x: finite(p?.x, .22, 0, 1), y: finite(p?.y, .7, 0, 1) });
const validPosition = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const title = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
export function newVoyage(score = 0) {
  return { version: 1, x: .22, y: .7, score: finite(score, 0, 0, Number.MAX_SAFE_INTEGER), operations: 0, revealed: [], route: [], discoveries: [] };
}
export function restoreVoyage(raw, legacy) {
  if (!raw || raw.version !== 1) return newVoyage(legacy?.score);
  const state = { ...newVoyage(raw.score), ...position(raw) };
  state.operations = Math.floor(finite(raw.operations, 0, 0, Number.MAX_SAFE_INTEGER));
  state.revealed = [...new Set((Array.isArray(raw.revealed) ? raw.revealed : []).filter(n => Number.isInteger(n) && n >= 0 && n < COLS * ROWS))];
  state.route = (Array.isArray(raw.route) ? raw.route : []).filter(validPosition).slice(-MAX_ROUTE).map(position);
  state.discoveries = (Array.isArray(raw.discoveries) ? raw.discoveries : []).filter(validPosition).slice(-MAX_LOG).map(d => ({ ...position(d), title: title(d.title, 'Observation'), activity: title(d.activity, 'operation'), points: finite(d.points, 0, 0, 1000000), date: typeof d.date === 'string' && Number.isFinite(Date.parse(d.date)) ? d.date : '', detail: safeDetail(d.detail) }));
  return state;
}
export function readVoyage(storage) {
  const read = key => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };
  return restoreVoyage(read(STORAGE_KEY), read('amundsen-expedition'));
}
// Metadata is optional and bounded so a large or cyclic result cannot prevent saving the chart.
function safeDetail(detail) {
  try { const json = JSON.stringify(detail); return json && json.length <= 4096 ? JSON.parse(json) : null; } catch { return null; }
}
export function chartPosition(state, known = new Set(state.revealed)) {
  const cx = Math.floor(state.x * COLS), cy = Math.floor(state.y * ROWS);
  let changed = false;
  for (let y = Math.max(0, cy - 3); y <= Math.min(ROWS - 1, cy + 3); y++) {
    for (let x = Math.max(0, cx - 4); x <= Math.min(COLS - 1, cx + 4); x++) {
      if (((x + .5) / COLS - state.x) ** 2 / .065 ** 2 + ((y + .5) / ROWS - state.y) ** 2 / .08 ** 2 > 1) continue;
      const cell = y * COLS + x;
      if (!known.has(cell)) { known.add(cell); state.revealed.push(cell); changed = true; }
    }
  }
  const tail = state.route.at(-1);
  if (!tail || Math.hypot(state.x - tail.x, state.y - tail.y) >= .008) {
    state.route.push(position(state));
    // Thin the older track to retain the voyage's shape within a fixed storage budget.
    if (state.route.length > MAX_ROUTE) state.route = state.route.filter((_, i) => i >= MAX_ROUTE / 2 || i % 2 === 0);
  }
  return changed;
}
export const chartPercent = state => Math.floor(state.revealed.length / (COLS * ROWS) * 100);
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
      const entry = { ...position(location), title: title(detail?.title, activity.title), activity: activity.id, points, date: new Date().toISOString(), detail: safeDetail(detail) };
      state.discoveries.push(entry);
      if (state.discoveries.length > MAX_LOG) state.discoveries.shift();
      onAward(entry);
      return true;
    },
  };
}
