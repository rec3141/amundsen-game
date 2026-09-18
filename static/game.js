import { minigames, activities } from './minigames/registry.js';
import { STORAGE_KEY, COLS, ROWS, newVoyage, readVoyage, chartPosition, chartPercent, operationRecorder, runAground } from './exploration.js';
import { loadWorld, ICE_STATION_MIN } from './world.js';
import { renderChart, CHART_SCALE } from './world-chart.js';
const $ = s => document.querySelector(s);
const canvas = $('#ocean'), ctx = canvas.getContext('2d');
const fog = document.createElement('canvas'), mini = document.createElement('canvas');
let width = 900, height = 480, keys = new Set(), last = 0, angle = -.4, cleanup = null, page = 'game';
let world = null, chart = null, miniBase = null, sea = null, zoom = 3.2, progress = 0;
let state = newVoyage(), known = new Set(), recorder = null, returnFocus = null, chartElapsed = 0;
let waypoints = [], routeComplete = true, holdUntil = 0, shake = 0;
// Nothing is written until the world has placed the ship, so a slow load cannot overwrite a saved voyage.
function save() { if (!world) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { $('#save-status').textContent = 'Chart stays in this tab · storage unavailable'; } }
let toastTimer;
function toast(message, long = false) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), long ? 7000 : 3500); }
function showPage(name) { page = name; keys.clear(); waypoints = []; $('#game-page').hidden = name !== 'game'; $('#ideas-page').hidden = name !== 'ideas'; $('#board-page').hidden = name !== 'board'; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.page === name)); if (name === 'ideas') loadIdeas(); else if (name === 'board') loadLeaderboard(); else resize(); }
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showPage(b.dataset.page));
$('#suggest-shortcut').onclick = $('#crew-link').onclick = () => showPage('ideas');

// Ship position in world cells, and the world context every operation receives.
const shipU = () => state.x * world.cols, shipV = () => state.y * world.rows;
const degrees = (value, positive, negative) => { const abs = Math.abs(value), whole = Math.floor(abs), minutes = ((abs - whole) * 60).toFixed(1); return `${whole}°${minutes.padStart(4, '0')}′${value >= 0 ? positive : negative}`; };
const formatPosition = (lon, lat) => `${degrees(lat, 'N', 'S')} ${degrees(lon, 'E', 'W')}`;
function iceLabel(ice) {
  if (!ice) return 'no ice chart';
  if (!ice.percent) return /iceberg/i.test(ice.form) ? 'bergy water' : 'open water';
  return `ice ${ice.percent === 5 ? '<1' : ice.tenths}/10 ${ice.stage.replace(/ \(.*\)/, '').toLowerCase()}`;
}
function here() {
  const u = shipU(), v = shipV(), { lon, lat } = world.unproject(u, v), ice = world.ice(u, v);
  return { x: state.x, y: state.y, lon, lat, depth: world.depth(u, v), ice: ice && { ...ice, concentration: ice.tenths, chartDate: world.chartDate } };
}
const iceHere = () => (world?.ice(shipU(), shipV())?.percent ?? 0) >= ICE_STATION_MIN;
const available = activity => activity.requires !== 'ice' || iceHere();

function updateProgress() { const percent = chartPercent(state, sea); $('#chart-percent').textContent = `${percent}%`; $('#chart-progress').value = percent; }
function updateUI() {
  $('#score').textContent = state.score; $('#completed').textContent = state.operations; updateProgress();
  $('#discovery-log').replaceChildren();
  if (!state.discoveries.length) { const p = document.createElement('li'); p.className = 'muted'; p.textContent = 'A blank log, an open sea. Complete an operation anywhere afloat to leave your first mark.'; $('#discovery-log').append(p); }
  for (const entry of [...state.discoveries].reverse()) {
    const item = document.createElement('li'), name = document.createElement('b'), meta = document.createElement('small');
    name.textContent = entry.title;
    const where = Number.isFinite(entry.lon) && Number.isFinite(entry.lat) ? formatPosition(entry.lon, entry.lat) : entry.x === null ? 'earlier chart' : `Chart ${Math.round(entry.x * 100)} / ${Math.round(entry.y * 100)}`;
    const depth = Number.isFinite(entry.depth) ? ` · ${Math.round(entry.depth)} m` : '';
    const tally = entry.activity === 'grounding' ? (entry.lost ? `−${entry.lost} points` : 'no points to lose') : `+${entry.points}`;
    meta.textContent = `${entry.date ? new Date(entry.date).toLocaleDateString() + ' · ' : ''}${where}${depth} · ${tally}`;
    item.append(name, meta); if (entry.activity === 'grounding') item.className = 'grounding'; $('#discovery-log').append(item);
  }
  updateActivities();
}
const activityButtons = new Map();
for (const activity of activities) {
  const button = document.createElement('button'), key = document.createElement('kbd'), copy = document.createElement('span'), name = document.createElement('b'), description = document.createElement('small');
  button.className = 'activity'; key.textContent = activity.key.toUpperCase(); name.textContent = activity.title; description.textContent = activity.description;
  copy.append(name, description); button.append(key, copy); button.onclick = () => startActivity(activity); $('#activities').append(button);
  activityButtons.set(activity, { button, description });
}
function updateActivities() {
  for (const [activity, { button, description }] of activityButtons) {
    const ok = !world || available(activity);
    button.classList.toggle('unavailable', !ok); button.setAttribute('aria-disabled', String(!ok));
    description.textContent = ok ? activity.description : 'No ice here · sail into ice of 4/10 or more';
  }
}
function endActivity() {
  recorder?.cancel(); recorder = null;
  const dispose = cleanup; cleanup = null;
  try { if (typeof dispose === 'function') dispose(); } catch (error) { console.error('Activity cleanup failed', error); }
  $('#minigame').replaceChildren();
}
function startActivity(activity) {
  if ($('#mission-dialog').open || page !== 'game') return;
  if (!world) { toast('The chart is still unrolling. One moment.'); return; }
  const game = minigames[activity.id]; if (!game?.mount) { toast('This operation is unavailable.'); return; }
  if (!available(activity)) { toast('No ice here. Ice stations need a floe under the ship: sail into ice of 4/10 or more, the white patches on the chart.', true); return; }
  endActivity(); waypoints = []; keys.clear(); returnFocus = document.activeElement;
  $('#mission-title').textContent = activity.title;
  const location = here();
  recorder = operationRecorder(state, activity, location, entry => { save(); updateUI(); toast(`${entry.title} · +${entry.points} science points · added to chart`); postScore(activity, entry); });
  const session = recorder;
  $('#mission-dialog').showModal();
  // showModal focuses the first focusable control, the close button; Enter or Space would then close the
  // operation. Focus the game root instead so the keys reach the minigame's own handlers.
  $('#minigame').focus();
  try { cleanup = game.mount($('#minigame'), { complete: (points, detail) => { if ($('#mission-dialog').open) session.complete(points, detail); }, expedition: { ...location, score: state.score, operations: state.operations, chartPercent: chartPercent(state, sea) } }); }
  catch (error) { endActivity(); $('#mission-dialog').close(); toast('Could not open this operation. Please try again.'); console.error(error); }
}
$('#close-mission').onclick = () => { endActivity(); $('#mission-dialog').close(); };
// Only a pointer closes the operation with the × button; Enter and Space belong to the minigame (Escape still closes).
$('#close-mission').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
$('#mission-dialog').addEventListener('cancel', () => endActivity());
$('#mission-dialog').addEventListener('close', () => { if ($('#mission-dialog').open) return; endActivity(); if (returnFocus?.isConnected) returnFocus.focus(); else canvas.focus(); });
$('#reset').onclick = () => { if (confirm('Start a fresh voyage and clear your chart, log and science points? Crew ideas stay on the server.')) { endActivity(); state = newVoyage(0, world?.start); try { localStorage.removeItem('amundsen-expedition'); } catch {} known = new Set(); chartPosition(state, known); waypoints = []; keys.clear(); save(); updateUI(); buildFog(); } };

// The view follows the ship; zoom is chart pixels per grid cell, clamped so the view never leaves the world.
const minZoom = () => world ? Math.max(1, width / world.cols, height / world.rows) : 1;
function view() {
  const z = Math.max(minZoom(), zoom), w = width / z, h = height / z;
  const u = Math.max(w / 2, Math.min(world.cols - w / 2, shipU())), v = Math.max(h / 2, Math.min(world.rows - h / 2, shipV()));
  return { z, u0: u - w / 2, v0: v - h / 2 };
}
function setZoom(next) { zoom = Math.max(minZoom(), Math.min(8, next)); }
$('#zoom-in').onclick = () => setZoom(zoom * 1.4); $('#zoom-out').onclick = () => setZoom(zoom / 1.4);
function resize() { const r = canvas.getBoundingClientRect(); if (!r.width) return; width = r.width; height = r.height; const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (width < 520 && zoom === 3.2) zoom = 2.4; }
new ResizeObserver(resize).observe(canvas);
const miniRect = () => { const w = width < 520 ? 96 : 156, h = Math.round(w * (world ? world.rows / world.cols : .7)); return { x: width - w - 12, y: 12, w, h }; };
function sailTo(u, v) {
  if (!world) return;
  const plan = world.route({ u: shipU(), v: shipV() }, { u, v });
  waypoints = plan.points; routeComplete = plan.complete;
  if (!plan.complete) toast(plan.points.length ? 'No sea route there. Holding short of the coast.' : 'That is land. The ship stays afloat.');
}
canvas.addEventListener('pointerdown', e => {
  canvas.focus(); if (!world || !chart) return;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, m = miniRect();
  if (px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) { sailTo((px - m.x) / m.w * world.cols, (py - m.y) / m.h * world.rows); return; }
  const { z, u0, v0 } = view(); keys.clear(); sailTo(u0 + px / z, v0 + py / z);
});
function isControl(element) { return element?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog'); }
window.addEventListener('keydown', e => {
  if (page !== 'game' || $('#mission-dialog').open || isControl(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), activity = activities.find(a => a.key.toLowerCase() === k) || (k === 'e' ? activities.find(a => a.id === 'ctd') : null);
  if (activity) { e.preventDefault(); if (!e.repeat) startActivity(activity); return; }
  if (k === '+' || k === '=') { e.preventDefault(); setZoom(zoom * 1.4); return; }
  if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom / 1.4); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); waypoints = []; }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase())); window.addEventListener('blur', () => { keys.clear(); save(); });
document.addEventListener('focusin', e => { if (isControl(e.target)) keys.clear(); });
document.addEventListener('visibilitychange', () => { keys.clear(); last = 0; save(); });
window.addEventListener('pagehide', save);

// Charted fog cells are cleared as overlapping discs, so the edge of the known world is ragged rather than square.
const FOG_PX = 4;
function buildFog() {
  fog.width = COLS * FOG_PX; fog.height = ROWS * FOG_PX;
  const f = fog.getContext('2d'); f.fillStyle = '#ddcca7'; f.fillRect(0, 0, fog.width, fog.height); f.globalCompositeOperation = 'destination-out'; f.beginPath();
  for (const cell of known) { const x = (cell % COLS + .5) * FOG_PX, y = (Math.floor(cell / COLS) + .5) * FOG_PX; f.moveTo(x + FOG_PX * .8, y); f.arc(x, y, FOG_PX * .8, 0, Math.PI * 2); }
  f.fill(); f.globalCompositeOperation = 'source-over';
  if (!miniBase) return;
  mini.width = miniBase.width; mini.height = miniBase.height;
  const m = mini.getContext('2d'); m.drawImage(miniBase, 0, 0); m.imageSmoothingEnabled = true; m.drawImage(fog, 0, 0, mini.width, mini.height);
}
// Places come into view as the fog lifts around them.
function sightPlaces() {
  const seen = world.places.filter(place => !state.sighted.includes(place.name) && known.has(Math.floor(place.v / world.rows * ROWS) * COLS + Math.floor(place.u / world.cols * COLS)));
  if (!seen.length) return;
  state.sighted.push(...seen.map(place => place.name));
  toast(`Sighted: ${seen.map(place => place.name).join(', ')}`);
}
function aground() {
  const u = shipU(), v = shipV(), { lon, lat } = world.unproject(u, v), lost = state.score;
  const record = runAground(state, { x: state.x, y: state.y, lon, lat }, world.nearestPlace(u, v)?.name ?? '');
  waypoints = []; keys.clear(); holdUntil = performance.now() + 1200; shake = 1;
  $('.map-panel').classList.remove('aground'); void $('.map-panel').offsetWidth; $('.map-panel').classList.add('aground');
  save(); updateUI();
  toast(`${record.title}. ${lost ? `${lost} science points lost` : 'Nothing left to lose'} · back to safe water, chart and log intact.`, true);
}
// Steering is stopped a step short of the shore; only the ship's own position touching land counts as grounding.
function move(du, dv) {
  const u = shipU(), v = shipV(), cols = world.cols, rows = world.rows;
  const nu = Math.max(.5, Math.min(cols - .5, u + du)), nv = Math.max(.5, Math.min(rows - .5, v + dv));
  if (world.isLand(nu, nv) || !world.lineClear(u, v, nu, nv)) { state.x = nu / cols; state.y = nv / rows; aground(); return false; }
  state.x = nu / cols; state.y = nv / rows;
  return true;
}
function drawGraticule(z, u0, v0) {
  const pole = world.pole, px = (pole.u - u0) * z, py = (pole.v - v0) * z;
  ctx.save(); ctx.strokeStyle = '#4a3f2a30'; ctx.lineWidth = 1; ctx.fillStyle = '#4a3f2a99'; ctx.font = '10px Georgia';
  for (let lat = 66; lat <= 84; lat += 2) {
    const r = world.parallelRadius(lat) * z; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    const dx = 26 - px; if (Math.abs(dx) < r) { const y = py + Math.sqrt(r * r - dx * dx); if (y > 14 && y < height - 4) ctx.fillText(`${lat}°N`, 4, y - 3); }
  }
  for (let lon = -160; lon <= -20; lon += 10) {
    const a = (lon + 90) * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a), far = Math.hypot(width, height) + Math.hypot(px, py);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx * far, py + dy * far); ctx.stroke();
    if (dy > .01) { const t = (height - 6 - py) / dy, x = px + dx * t; if (t > 0 && x > 24 && x < width - 40) ctx.fillText(`${-lon}°W`, x + 3, height - 8); }
  }
  ctx.restore();
}
function drawShip(x, y, scale) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
  ctx.strokeStyle = '#a8d5d05a'; for (let n = 0; n < 3; n++) { ctx.beginPath(); ctx.moveTo(-22 - n * 8, -5 - n * 4); ctx.lineTo(-32 - n * 8, 0); ctx.lineTo(-22 - n * 8, 5 + n * 4); ctx.stroke(); }
  ctx.shadowColor = '#041d33aa'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(8, -10); ctx.lineTo(-22, -9); ctx.lineTo(-25, 0); ctx.lineTo(-22, 9); ctx.lineTo(8, 10); ctx.closePath(); ctx.fillStyle = '#f1e9d9'; ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#ca5342'; ctx.fillRect(-20, -7, 27, 14); ctx.fillStyle = '#f6f4e6'; ctx.fillRect(-3, -6, 12, 12); ctx.fillStyle = '#2b5660'; ctx.fillRect(4, -4, 3, 8); ctx.fillStyle = '#e7b254'; ctx.fillRect(-14, -3, 6, 6); ctx.restore();
}
function drawLoading() {
  ctx.fillStyle = '#ddcca7'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#6a5d42'; ctx.font = 'italic 16px Georgia'; ctx.textAlign = 'center';
  ctx.fillText(world ? 'Drawing the chart…' : 'Unrolling the chart…', width / 2, height / 2 - 8);
  ctx.fillStyle = '#9c7a3f'; ctx.fillRect(width / 2 - 90, height / 2 + 8, 180 * progress, 4); ctx.textAlign = 'left';
}
function draw() {
  if (!chart) { drawLoading(); return; }
  const { z, u0, v0 } = view(), S = CHART_SCALE, toX = u => (u - u0) * z, toY = v => (v - v0) * z;
  ctx.save(); if (shake > 0) ctx.translate((Math.random() - .5) * 8 * shake, (Math.random() - .5) * 8 * shake);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(chart, u0 * S, v0 * S, width / z * S, height / z * S, 0, 0, width, height);
  ctx.drawImage(fog, u0 / world.cols * fog.width, v0 / world.rows * fog.height, width / z / world.cols * fog.width, height / z / world.rows * fog.height, 0, 0, width, height);
  drawGraticule(z, u0, v0);
  ctx.strokeStyle = '#e8c589'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); state.route.forEach((p, i) => i ? ctx.lineTo(toX(p.x * world.cols), toY(p.y * world.rows)) : ctx.moveTo(toX(p.x * world.cols), toY(p.y * world.rows))); ctx.stroke(); ctx.setLineDash([]);
  for (const d of state.discoveries) {
    if (d.x === null) continue;
    const x = toX(d.x * world.cols), y = toY(d.y * world.rows);
    if (d.activity === 'grounding') { ctx.strokeStyle = '#b3352b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); continue; }
    ctx.fillStyle = '#f0ba70'; ctx.strokeStyle = '#523d25'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // Sighted places are named; where settlements crowd a fjord, only the first label at that spot is written.
  ctx.fillStyle = '#3b3222'; ctx.font = 'italic 12px Georgia'; const labelled = [];
  for (const place of world.places) {
    if (!state.sighted.includes(place.name)) continue;
    const x = toX(place.u), y = toY(place.v); if (x < -80 || x > width + 20 || y < 0 || y > height) continue;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    if (labelled.some(([lx, ly]) => Math.abs(lx - x) < 70 && Math.abs(ly - y) < 14)) continue;
    labelled.push([x, y]); ctx.fillText(place.name, x + 6, y + 4);
  }
  if (waypoints.length) {
    ctx.strokeStyle = routeComplete ? '#cfdfd880' : '#e9955c'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(toX(shipU()), toY(shipV()));
    for (const p of waypoints) ctx.lineTo(toX(p.u), toY(p.v));
    ctx.stroke(); ctx.setLineDash([]); const end = waypoints.at(-1); ctx.beginPath(); ctx.arc(toX(end.u), toY(end.v), 5, 0, 7); ctx.stroke();
  }
  drawShip(toX(shipU()), toY(shipV()), Math.min(1, .35 + z * .1));
  ctx.restore();
  // Compass: true north is the direction of the pole, which swings with longitude on this projection.
  const north = world.northAngle(shipU(), shipV());
  ctx.save(); ctx.translate(34, height - 40); ctx.rotate(north + Math.PI / 2); ctx.strokeStyle = '#3b3222'; ctx.fillStyle = '#3b3222'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-5, -6); ctx.lineTo(5, -6); ctx.closePath(); ctx.fill(); ctx.font = 'bold 11px Georgia'; ctx.fillText('N', -4, -19); ctx.restore();
  const m = miniRect();
  ctx.drawImage(mini, m.x, m.y, m.w, m.h); ctx.strokeStyle = '#3b3222'; ctx.lineWidth = 1; ctx.strokeRect(m.x + .5, m.y + .5, m.w - 1, m.h - 1);
  ctx.strokeStyle = '#ffffffcc'; ctx.strokeRect(m.x + u0 / world.cols * m.w, m.y + v0 / world.rows * m.h, width / z / world.cols * m.w, height / z / world.rows * m.h);
  ctx.fillStyle = '#ca5342'; ctx.beginPath(); ctx.arc(m.x + shipU() / world.cols * m.w, m.y + shipV() / world.rows * m.h, 2.5, 0, 7); ctx.fill();
}
function loop(time) {
  const dt = last ? Math.min((time - last) / 1000, .04) : 0; last = time;
  if (page === 'game' && !document.hidden && !$('#mission-dialog').open && world && chart) {
    let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    let len = 0;
    if (time < holdUntil) { dx = dy = 0; keys.clear(); }
    const z = view().z, ice = world.ice(shipU(), shipV());
    // Cells per second: 20 (40 km/s) at the default zoom, a little slower when zoomed in, slowed further by the pack.
    const speed = 20 * Math.sqrt(3.2 / z) * world.iceSpeed(ice ? ice.percent : 255) * dt;
    if (waypoints.length) {
      let budget = speed;
      while (waypoints.length && budget > 0) {
        const next = waypoints[0], du = next.u - shipU(), dv = next.v - shipV(), d = Math.hypot(du, dv);
        if (d < .05) { waypoints.shift(); continue; }
        angle = Math.atan2(dv, du); const step = Math.min(budget, d); len = 1;
        if (!move(du / d * step, dv / d * step)) break;
        budget -= step; if (step === d) waypoints.shift();
      }
      if (!waypoints.length) save();
    } else if (dx || dy) {
      len = Math.hypot(dx, dy); angle = Math.atan2(dy, dx);
      for (let part = 0; part < 4; part++) if (!move(dx / len * speed / 4, dy / len * speed / 4)) break;
    }
    shake = Math.max(0, shake - dt * 3);
    chartElapsed += dt;
    if (chartElapsed >= .15) {
      chartElapsed = 0;
      if (chartPosition(state, known)) { buildFog(); updateProgress(); sightPlaces(); }
      if (world.seaRoom(shipU(), shipV())) state.safe = { x: state.x, y: state.y };
      const { lon, lat } = world.unproject(shipU(), shipV());
      const navigation = `BRIDGE / ${formatPosition(lon, lat)} · ${Math.round(world.depth(shipU(), shipV()))} m · ${iceLabel(ice)} · ${len ? 'Underway' : 'Holding position'}`;
      if ($('#navigation').textContent !== navigation) $('#navigation').textContent = navigation;
      updateActivities();
    }
  }
  draw();
  requestAnimationFrame(loop);
}
async function boot() {
  try {
    world = await loadWorld();
    state = readVoyage(localStorage, world.start); known = new Set(state.revealed);
    if (world.isLand(shipU(), shipV())) Object.assign(state, world.start);
    if (!world.seaRoom(state.safe.x * world.cols, state.safe.y * world.rows)) state.safe = { ...world.start };
    sea = world.seaFog(COLS, ROWS);
    chartPosition(state, known); updateUI(); buildFog();
    $('#chart-credit').textContent = `GEBCO 2024 · CIS ice chart ${world.chartDate}`;
    chart = await renderChart(world, value => { progress = value; });
    miniBase = document.createElement('canvas'); const m = miniRect(); miniBase.width = m.w * 2; miniBase.height = m.h * 2;
    const base = miniBase.getContext('2d'); base.imageSmoothingEnabled = true; base.drawImage(chart, 0, 0, miniBase.width, miniBase.height);
    buildFog(); sightPlaces(); save(); canvas.focus();
  } catch (error) {
    console.error(error);
    $('#navigation').textContent = `BRIDGE / The chart could not be loaded: ${error.message}`;
  }
}
// Scores go to the shared leaderboard only under a name; the name is shared with the idea board's comment form.
function playerName() { try { return (localStorage.getItem('amundsen-crew-name') || '').trim(); } catch { return ''; } }
$('#player-name').value = playerName();
$('#player-name').onchange = () => { crewName = $('#player-name').value.trim(); try { localStorage.setItem('amundsen-crew-name', crewName); } catch {} };
async function postScore(activity, entry) {
  const player = playerName();
  if (!player) { toast('Sign the log with your name to post scores to the leaderboard.'); return; }
  try { await fetch('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player, activity: activity.id, title: activity.title, points: entry.points }) }); } catch {}
}
function boardList(list, rows, empty) { list.replaceChildren(); if (!rows.length) { list.append(el('li', 'none', empty)); return; } for (const r of rows) { const item = el('li'); item.append(el('span', '', r.player), el('b', '', `${r.points}${r.operations ? ` · ${r.operations} ops` : ''}`)); list.append(item); } }
async function loadLeaderboard() {
  try {
    const response = await fetch('api/leaderboard'); if (!response.ok) throw Error(); const board = await response.json();
    $('#board-refresh').textContent = 'Updates every 10 seconds';
    boardList($('#overall-board'), board.overall, 'No scores yet. Sign the log on the expedition page and complete an operation.');
    const holder = $('#activity-boards'); holder.replaceChildren();
    for (const activity of activities) {
      const section = el('section', 'board'), entry = board.activities.find(a => a.activity === activity.id);
      section.append(el('h2', '', activity.title)); const list = el('ol'); boardList(list, entry?.top || [], 'Nobody has logged this one yet.'); section.append(list); holder.append(section);
    }
  } catch { $('#board-refresh').textContent = 'Cannot reach the server. Retrying…'; }
}
const BUILD_LABEL = { building: 'Being built', review: 'In review', live: 'In the game', failed: 'Build stalled' };
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
let crewName = ''; try { crewName = localStorage.getItem('amundsen-crew-name') || ''; } catch {}
function commentForm(idea) {
  const form = el('form', 'comment-form'); form.innerHTML = '<input name="name" maxlength="60" placeholder="Name or team (optional)"><textarea name="body" required maxlength="1500" rows="2" placeholder="Add to this idea: a twist, a rule, a fix…"></textarea><div class="comment-actions"><button type="submit" class="secondary">Add comment</button><span role="status"></span></div>';
  form.name.value = crewName;
  form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('button'), status = form.querySelector('span'); button.disabled = true; status.textContent = 'Sending…';
    try {
      const response = await fetch(`api/suggestions/${idea.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.value, body: form.body.value }) });
      if (!response.ok) throw Error((await response.json()).error || 'Could not save comment');
      crewName = form.name.value.trim(); try { localStorage.setItem('amundsen-crew-name', crewName); } catch {}
      form.body.value = ''; status.textContent = ''; await loadIdeas(true);
    } catch (error) { status.textContent = error.message === 'Failed to fetch' ? 'Connection lost; your comment is still here.' : error.message; }
    finally { button.disabled = false; }
  };
  return form;
}
const summaryText = idea => `${idea.comments?.length || 0} comment${idea.comments?.length === 1 ? '' : 's'} · iterate on this idea`;
function commentList(idea, thread) { thread.replaceChildren(); for (const c of idea.comments || []) { const item = el('div', 'comment'); item.append(el('b', '', c.name), el('span', '', c.body)); thread.append(item); } }
function ideaCard(idea) {
  const article = el('article', 'idea'); article.dataset.id = idea.id;
  const head = el('div', 'idea-head'); head.append(el('h3', '', idea.title));
  if (idea.build) head.append(el('span', `build build-${idea.build}`, BUILD_LABEL[idea.build] || idea.build));
  const meta = el('small', '', `${idea.name} · Idea #${idea.id}`);
  const thread = el('div', 'comments'); commentList(idea, thread);
  const details = el('details', 'thread');
  details.append(el('summary', '', summaryText(idea)), thread, commentForm(idea));
  article.append(head, el('p', '', idea.description), meta, details);
  return article;
}
// A refresh never replaces a card whose thread is open or being typed in, so drafts survive the 5 s poll.
async function loadIdeas(force = false) { try { const response = await fetch('api/suggestions'); if (!response.ok) throw Error(); const ideas = await response.json(); $('#idea-count').textContent = ideas.length; $('#board-status').textContent = 'Updates every 5 seconds'; const list = $('#idea-list'); const keep = new Map(); for (const card of list.querySelectorAll('.idea')) { const details = card.querySelector('details'); if (!force && (details?.open || card.contains(document.activeElement))) keep.set(card.dataset.id, card); } list.replaceChildren(); if (!ideas.length) { list.append(el('div', 'empty', 'The next adventure starts with an idea. Be the first to share yours.')); } for (const idea of ideas) { const kept = keep.get(String(idea.id)); if (kept) { kept.querySelector('summary').textContent = summaryText(idea); commentList(idea, kept.querySelector('.comments')); list.append(kept); } else list.append(ideaCard(idea)); } } catch { $('#board-status').textContent = 'Cannot reach the server. Retrying…'; } }
$('#idea-form').onsubmit = async e => { e.preventDefault(); const form = e.currentTarget, button = form.querySelector('button'); button.disabled = true; $('#form-status').textContent = 'Sending…'; try { const response = await fetch('api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); if (!response.ok) throw Error((await response.json()).error || 'Could not save idea'); form.reset(); $('#form-status').textContent = 'Your idea is on the crew board. Thank you!'; await loadIdeas(); } catch (error) { $('#form-status').textContent = error.message === 'Failed to fetch' ? 'Connection lost. Your draft is still here; try again.' : error.message; } finally { button.disabled = false; } };
setInterval(() => { if (!document.hidden) loadIdeas(); if (world) save(); }, 5000); setInterval(() => { if (!document.hidden && page === 'board') loadLeaderboard(); }, 10000); updateUI(); loadIdeas(); resize(); requestAnimationFrame(loop); boot();
