import { publicMirror } from './site.js';
import { minigames, activities } from './minigames/registry.js';
import { STORAGE_KEY, COLS, ROWS, FUEL, STORES, WIDE_SWATH, newVoyage, readVoyage, chartPosition, chartPercent, operationRecorder, runAground, mapSwath, swathWidth, tankCapacity, burnRate, sail, buy, bunker, towSouth, logEvent } from './exploration.js';
import { loadWorld, ICE_STATION_MIN } from './world.js';
import { renderChart, CHART_SCALE } from './world-chart.js';
const $ = s => document.querySelector(s);
if (publicMirror) {
  document.querySelectorAll('[data-page="ideas"], [data-page="board"], #suggest-shortcut, .crew-note, .player').forEach(node => { node.hidden = true; });
  $('.online').textContent = 'EXPLORE THE ARCTIC';
}
const canvas = $('#ocean'), ctx = canvas.getContext('2d');
const fog = document.createElement('canvas'), mini = document.createElement('canvas');
let width = 900, height = 480, keys = new Set(), last = 0, angle = -.4, cleanup = null, page = 'game';
let world = null, chart = null, miniBase = null, sea = null, zoom = 3.2, progress = 0;
let state = newVoyage(), known = new Set(), recorder = null, returnFocus = null, chartElapsed = 0;
let helicopter = null, flightAngle = 0, mapped = new Set(), surface = null, mappingDirty = false, seaCells = 1;
// One small craft is under the player's control at a time; the AUV runs on its own. `adrift` holds the moment the
// tanks ran dry, `routePlan` the distance and diesel of the committed route, `preview` the route under the mouse.
let zodiac = null, auv = null, auvArmed = false, adrift = null, routePlan = null, preview = null, pointer = null, startPlace = '', radioSeen = -1;
const craft = () => helicopter || zodiac;
const pilotU = () => craft()?.u ?? shipU(), pilotV = () => craft()?.v ?? shipV();
let waypoints = [], routeComplete = true, holdUntil = 0, shake = 0;
// The zodiac keeps within a tether of the ship; the AUV runs straight out and maps a fixed near-bottom swath;
// bunkering, and recovering the AUV, need the ship within BUNKER_KM; dry tanks drift for the grace period, then a tow.
const ZODIAC_TETHER_KM = 30, AUV_RANGE_KM = 60, AUV_SWATH_M = 3000, AUV_CELLS_PER_S = 12, BUNKER_KM = 6, PORT_CHART_KM = 300, ADRIFT_GRACE_MS = 30000;
// M/T Nanny, the sealift tanker, lies 8 minutes at each anchorage in turn on a 12-minute cycle of the wall clock.
const TANKER = { name: 'M/T Nanny', slot: 720000, stay: 480000, anchorages: [
  { name: 'Baffin Bay off Clyde River', lon: -67, lat: 70.6 }, { name: 'Melville Bay', lon: -60, lat: 75.2 }, { name: 'Smith Sound', lon: -73, lat: 78.3 },
  { name: 'Jones Sound', lon: -85, lat: 76 }, { name: 'Lancaster Sound', lon: -84, lat: 74.15 }, { name: 'Barrow Strait', lon: -92, lat: 74.3 },
  { name: 'Peel Sound', lon: -96.5, lat: 73.2 }, { name: 'Viscount Melville Sound', lon: -108, lat: 74.5 }, { name: 'Amundsen Gulf', lon: -122, lat: 70.5 }] };
function tanker(now = Date.now()) {
  const slot = Math.floor(now / TANKER.slot), n = TANKER.anchorages.length, anchorage = TANKER.anchorages[slot % n];
  return { slot, anchorage, next: TANKER.anchorages[(slot + 1) % n], at: now - slot * TANKER.slot < TANKER.stay, until: slot * TANKER.slot + TANKER.stay, arrives: (slot + 1) * TANKER.slot };
}
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function tankerLine() { const t = tanker(); return t.at ? `${TANKER.name} at anchor · ${t.anchorage.name} until ${clock(t.until)} · 1 point per 5 m³` : `${TANKER.name} underway · ${t.next.name} from ${clock(t.arrives)}`; }
const m3 = value => value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString();
// Nothing is written until the world has placed the ship, so a slow load cannot overwrite a saved voyage.
function save() { if (!world) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { $('#save-status').textContent = 'Chart stays in this tab · storage unavailable'; } }
let toastTimer;
function toast(message, long = false) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), long ? 7000 : 3500); }
function showPage(name) { if (publicMirror && name !== 'game') return; page = name; keys.clear(); waypoints = []; $('#game-page').hidden = name !== 'game'; $('#ideas-page').hidden = name !== 'ideas'; $('#board-page').hidden = name !== 'board'; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.page === name)); if (name === 'ideas') loadIdeas(); else if (name === 'board') loadLeaderboard(); else resize(); }
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showPage(b.dataset.page));
$('#suggest-shortcut').onclick = $('#crew-link').onclick = () => showPage('ideas');

// Ship position in world cells, and the world context every operation receives.
const shipU = () => state.x * world.cols, shipV = () => state.y * world.rows;
const degrees = (value, positive, negative) => { const abs = Math.abs(value), whole = Math.floor(abs), minutes = ((abs - whole) * 60).toFixed(1); return `${whole}°${minutes.padStart(4, '0')}′${value >= 0 ? positive : negative}`; };
const formatPosition = (lon, lat) => `${degrees(lat, 'N', 'S')} ${degrees(lon, 'E', 'W')}`;
function iceLabel(ice) {
  if (!ice) return 'ice coverage unknown · outside CIS chart';
  if (!ice.percent) return /iceberg/i.test(ice.form) ? 'bergy water' : 'open water';
  return `ice ${ice.percent === 5 ? '<1' : ice.tenths}/10 ${ice.stage.replace(/ \(.*\)/, '').toLowerCase()}`;
}
function here(airborne = false) {
  const u = airborne ? pilotU() : shipU(), v = airborne ? pilotV() : shipV(), { lon, lat } = world.unproject(u, v), ice = world.ice(u, v);
  return { x: u / world.cols, y: v / world.rows, vehicle: airborne ? 'helicopter' : 'ship', lon, lat, depth: world.depth(u, v), ice: ice && { ...ice, concentration: ice.tenths, chartDate: world.chartDate } };
}
const iceHere = () => (world?.ice(shipU(), shipV())?.percent ?? 0) >= ICE_STATION_MIN;
function unavailableReason(activity) {
  if (activity.id === 'patrol') return !state.upgrades.helicopter ? 'Hire the helicopter in the ship’s stores (Q) for Ice Patrol' : !helicopter ? 'Launch the helicopter (G) for Ice Patrol' : world.isLand(pilotU(), pilotV()) || !(world.ice(pilotU(), pilotV())?.percent > 0) ? 'Fly over charted sea ice for Ice Patrol' : '';
  if (activity.id === 'raft') return !state.upgrades.helicopter ? 'Hire the helicopter in the ship’s stores (Q) for The Raft' : !helicopter ? 'Launch the helicopter (G) for The Raft' : !world.isLand(pilotU(), pilotV()) ? 'Fly inland over land for The Raft' : '';
  return activity.requires === 'ice' && !iceHere() ? 'Ice stations need charted ice of 4/10 or more under the ship' : '';
}
const available = activity => !unavailableReason(activity);
const craftReady = () => world && chart && page === 'game' && !$('#mission-dialog').open;
function toggleHelicopter() {
  if (!craftReady()) return;
  if (!helicopter) {
    if (!state.upgrades.helicopter) { toggleStores(true); toast(`No helicopter aboard · hire one in the ship’s stores for ${STORES.find(item => item.id === 'helicopter').price} science points.`, true); return; }
    if (zodiac) { toast('Recover the zodiac (Y) before the helicopter lifts.'); return; }
  }
  helicopter = helicopter ? null : { u: shipU(), v: shipV(), rtb: false };
  if (!helicopter) state.heliFuel = FUEL.heliTank;
  keys.clear(); waypoints = []; routePlan = null; preview = null;
  $('#helicopter').setAttribute('aria-pressed', String(!!helicopter));
  toast(helicopter ? `Helicopter airborne · ${FUEL.heliTank} L Jet A-1 · ship holding position. Fly with arrows / WASD or tap the chart; G returns aboard, and she turns back on her own at bingo fuel.` : 'Helicopter aboard · refuelled · ship controls resumed.');
  updateUI(); canvas.focus();
}
$('#helicopter').onclick = toggleHelicopter;
function toggleZodiac() {
  if (!craftReady()) return;
  if (!zodiac) {
    if (!state.upgrades.zodiac) { toggleStores(true); toast('No zodiac aboard · buy one in the ship’s stores.', true); return; }
    if (helicopter) { toast('Land the helicopter (G) before the zodiac goes over the side.'); return; }
    if (world.ice(shipU(), shipV())?.percent > 0) { toast('The zodiac needs open water alongside · the ship sits in the pack.'); return; }
  }
  zodiac = zodiac ? null : { u: shipU(), v: shipV() };
  keys.clear(); waypoints = []; routePlan = null; preview = null;
  $('#zodiac').setAttribute('aria-pressed', String(!!zodiac)); $('#zodiac').textContent = zodiac ? 'Y · Recover zodiac' : 'Y · Launch zodiac';
  toast(zodiac ? `Zodiac away · open water only, ${ZODIAC_TETHER_KM} km from the ship at most · it sounds the seabed under its track. Y recovers it.` : 'Zodiac hoisted aboard · ship controls resumed.');
  updateUI(); canvas.focus();
}
$('#zodiac').onclick = toggleZodiac;
// The AUV is armed with its key or button, then aimed with the next tap on the chart.
function armAuv() {
  if (!craftReady()) return;
  if (!state.upgrades.auv) { toggleStores(true); toast('No AUV aboard · buy one in the ship’s stores.', true); return; }
  if (auv) { toast(auv.waiting ? `The AUV is waiting at its launch point · bring the ship within ${BUNKER_KM} km to recover it.` : `The AUV is running · ${auv.cells} cells mapped so far.`); return; }
  auvArmed = !auvArmed; $('#auv').setAttribute('aria-pressed', String(auvArmed)); preview = null;
  toast(auvArmed ? `AUV armed · tap the chart to set a straight run of up to ${AUV_RANGE_KM} km. 1 again stands it down.` : 'AUV stood down.');
  canvas.focus();
}
$('#auv').onclick = armAuv;
function auvEnd(u, v) {
  const su = shipU(), sv = shipV(), d = Math.hypot(u - su, v - sv), reach = AUV_RANGE_KM / world.km;
  if (d > reach) { u = su + (u - su) / d * reach; v = sv + (v - sv) / d * reach; }
  return world.lastClear(su, sv, u, v);
}
function launchAuv(u, v) {
  auvArmed = false; $('#auv').setAttribute('aria-pressed', 'false');
  const su = shipU(), sv = shipV(), end = auvEnd(u, v), km = Math.hypot(end.u - su, end.v - sv) * world.km;
  if (km < world.km) { toast('No clear water that way for the AUV.'); return; }
  auv = { u: su, v: sv, target: end, dock: { u: su, v: sv }, home: false, waiting: false, cells: 0 };
  toast(`AUV away · ${Math.round(km)} km out and back on a ${AUV_SWATH_M / 1000} km swath.`);
}
function recoverAuv() { toast(`AUV recovered · ${auv.cells} cells mapped.`); auv = null; }
function stepAuv(dt) {
  if (!auv) return;
  const near = () => Math.hypot(auv.u - shipU(), auv.v - shipV()) * world.km <= BUNKER_KM;
  if (auv.waiting) { if (near()) recoverAuv(); return; }
  const goal = auv.home ? auv.dock : auv.target, du = goal.u - auv.u, dv = goal.v - auv.v, d = Math.hypot(du, dv), step = Math.min(d, AUV_CELLS_PER_S * dt);
  const nu = d ? auv.u + du / d * step : auv.u, nv = d ? auv.v + dv / d * step : auv.v;
  const added = mapSwath(state, mapped, world, { u: auv.u, v: auv.v }, { u: nu, v: nv }, 1, AUV_SWATH_M);
  if (added.length) { clearSeabed(added); mappingDirty = true; auv.cells += added.length; }
  auv.u = nu; auv.v = nv;
  if (step < d - 1e-9) return;
  if (!auv.home) auv.home = true;
  else if (near()) recoverAuv();
  else { auv.waiting = true; toast(`AUV surfaced at its launch point · ${auv.cells} cells mapped · bring the ship within ${BUNKER_KM} km to recover it.`, true); }
}
// At bingo fuel the helicopter has just enough Jet A-1 to reach the ship, and turns for home on her own.
function checkHelicopterFuel() {
  if (!helicopter) return;
  const back = Math.hypot(helicopter.u - shipU(), helicopter.v - shipV()) * world.km;
  if (state.heliFuel <= 0 || (helicopter.rtb && back < world.km * .6)) { toggleHelicopter(); return; }
  if (!helicopter.rtb && state.heliFuel <= back * FUEL.heliBurn * 1.15 + 20) { helicopter.rtb = true; keys.clear(); toast('Bingo fuel · the helicopter turns for the ship.', true); }
  if (helicopter.rtb) waypoints = [{ u: shipU(), v: shipV() }];
}

// Bunkering: a fuel port's berth or the tanker at anchor within BUNKER_KM of the ship.
function fuelSource() {
  const u = shipU(), v = shipV(), reach = BUNKER_KM / world.km;
  for (const port of world.ports) if (Math.hypot(port.berth.u - u, port.berth.v - v) <= reach) return { label: `at ${port.name}`, rate: FUEL.portRate };
  const t = tanker();
  if (t.at && Math.hypot(t.anchorage.u - u, t.anchorage.v - v) <= reach) return { label: `from ${TANKER.name}, ${t.anchorage.name}`, rate: FUEL.tankerRate };
  return null;
}
function nearestFuel() {
  const u = shipU(), v = shipV(), t = tanker();
  const spots = [...world.ports.map(port => ({ name: port.name, ...port.berth })), ...(t.at ? [{ name: `${TANKER.name} in ${t.anchorage.name}`, u: t.anchorage.u, v: t.anchorage.v }] : [])];
  return spots.reduce((best, spot) => { const km = Math.hypot(spot.u - u, spot.v - v) * world.km; return km < best.km ? { name: spot.name, km } : best; }, { name: '', km: Infinity });
}
function doBunker() {
  if (!craftReady()) return;
  if (craft()) { toast('Recover the helicopter or zodiac before bunkering.'); return; }
  const source = fuelSource();
  if (!source) { const near = nearestFuel(); toast(`No fuel within ${BUNKER_KM} km. Nearest: ${near.name}, ${Math.round(near.km)} km · fuel ports show on the chart within ${PORT_CHART_KM} km.`, true); return; }
  const record = bunker(state, here(), source.label, source.rate);
  if (!record) { toast('Tanks are full.'); return; }
  adrift = null; waypoints = []; routePlan = null; save(); updateUI();
  toast(`${record.title} · ${record.lost ? `−${record.lost} science points` : 'no charge'} · ${Math.round(state.fuel).toLocaleString()} m³ aboard.`, true);
}
$('#bunker').onclick = doBunker;
// A new arrival of the tanker while the chart is open goes into the log; the ship card always shows her schedule.
function radio() {
  const t = tanker();
  if (!t.at || t.slot === radioSeen) return;
  radioSeen = t.slot;
  logEvent(state, { x: t.anchorage.u / world.cols, y: t.anchorage.v / world.rows, lon: t.anchorage.lon, lat: t.anchorage.lat }, 'radio', `Radio · ${TANKER.name} at anchor in ${t.anchorage.name} until ${clock(t.until)}`);
  save(); updateUI(); toast(`Radio · ${TANKER.name} anchored in ${t.anchorage.name} until ${clock(t.until)} · bunker alongside for 1 point per 5 m³.`, true);
}
// Dry tanks: the ship drifts with the wind for the grace period, then is towed back to the start of the leg.
function drift(time, dt) {
  if (craft() || state.fuel > 0) { adrift = null; return; }
  if (!adrift) { adrift = { since: time, heading: angle }; waypoints = []; routePlan = null; keys.clear(); toast(`Tanks dry · the ship drifts. U bunkers if fuel is within ${BUNKER_KM} km; otherwise a tow south in ${ADRIFT_GRACE_MS / 1000} s.`, true); }
  adrift.heading += (Math.random() - .5) * dt;
  const u = shipU(), v = shipV(), nu = u + Math.cos(adrift.heading) * .4 * dt, nv = v + Math.sin(adrift.heading) * .4 * dt;
  if (nu > .5 && nv > .5 && nu < world.cols - .5 && nv < world.rows - .5 && !world.isLand(nu, nv) && world.lineClear(u, v, nu, nv)) { state.x = nu / world.cols; state.y = nv / world.rows; } else adrift.heading += Math.PI / 2;
  if (time - adrift.since >= ADRIFT_GRACE_MS) tow();
}
function tow() {
  const u = shipU(), v = shipV(), { lon, lat } = world.unproject(u, v);
  const record = towSouth(state, { x: state.x, y: state.y, lon, lat, depth: world.depth(u, v) }, world.nearestPlace(u, v)?.name ?? '', world.start, startPlace);
  adrift = null; waypoints = []; routePlan = null; keys.clear(); holdUntil = performance.now() + 1500; angle = -.4;
  save(); updateUI();
  toast(`${record.title} · ${FUEL.towed} m³ of diesel aboard · chart and log intact.`, true);
}
// Distance and diesel for a run of waypoints, sampling the ice chart every cell along the way.
function routeCost(points, from = { u: shipU(), v: shipV() }) {
  let km = 0, fuel = 0, prev = from;
  for (const p of points) {
    const d = Math.hypot(p.u - prev.u, p.v - prev.v), steps = Math.max(1, Math.ceil(d)), leg = d / steps * world.km;
    for (let n = 1; n <= steps; n++) { km += leg; fuel += leg * burnRate(state, world.ice(prev.u + (p.u - prev.u) * n / steps, prev.v + (p.v - prev.v) * n / steps)?.percent ?? 255); }
    prev = p;
  }
  return { km, fuel };
}

// Ship's stores.
const storeRows = new Map();
for (const item of STORES) {
  const row = el('div', 'store'), copy = el('span'), button = el('button', 'secondary');
  copy.append(el('b', '', item.title), el('small', '', item.description)); button.onclick = () => purchase(item.id);
  row.append(copy, button); $('#stores-list').append(row); storeRows.set(item.id, { row, button });
}
function updateStores() {
  for (const item of STORES) {
    const { row, button } = storeRows.get(item.id), owned = !!state.upgrades[item.id];
    row.classList.toggle('owned', owned); button.disabled = owned || state.score < item.price;
    button.textContent = owned ? 'Aboard' : `${item.price} pts`;
    button.setAttribute('aria-label', owned ? `${item.title} aboard` : `Buy ${item.title} for ${item.price} science points`);
  }
  $('#helicopter').textContent = helicopter ? 'G · Return to ship' : state.upgrades.helicopter ? 'G · Launch helicopter' : 'G · Hire helicopter';
  $('#zodiac').hidden = !state.upgrades.zodiac; $('#auv').hidden = !state.upgrades.auv;
}
function purchase(id) {
  const item = STORES.find(i => i.id === id);
  if (!item || state.upgrades[id]) return;
  if (state.score < item.price) { toast(`${item.title} costs ${item.price} science points · ${item.price - state.score} more to earn.`); return; }
  buy(state, id); save(); updateUI();
  toast(`${item.title} aboard · −${item.price} science points.`, true);
}
function toggleStores(open = !!$('#stores').hidden) { $('#stores').hidden = !open; $('#stores-toggle').setAttribute('aria-expanded', String(open)); }
$('#stores-toggle').onclick = () => toggleStores();
function updateFuel() {
  const cap = tankCapacity(state), share = state.fuel / cap, gauge = $('#fuel-gauge');
  $('#fuel').textContent = Math.round(state.fuel).toLocaleString();
  gauge.max = cap; gauge.value = state.fuel; gauge.classList.toggle('low', share < .2);
  $('#fuel-note').textContent = state.fuel <= 0 ? `Tanks dry · adrift · U bunkers if fuel is within ${BUNKER_KM} km` : `${Math.round(share * 100)}% of ${cap.toLocaleString()} m³ · about ${Math.round(state.fuel / burnRate(state, 0)).toLocaleString()} km in open water · ${state.upgrades.helicopter ? `helicopter ${Math.round(state.heliFuel)} L` : 'U bunkers at a fuel port or the tanker'}`;
  $('#tanker-status').textContent = world ? tankerLine() : '';
}

function updateProgress() { const percent = Math.floor(mapped.size / seaCells * 1000) / 10; $('#chart-percent').textContent = `${percent}% · ${mapped.size} cells`; $('#chart-progress').value = percent; }
function updateUI() {
  $('#score').textContent = state.score; $('#completed').textContent = state.operations; updateProgress();
  $('#discovery-log').replaceChildren();
  if (!state.discoveries.length) { const p = document.createElement('li'); p.className = 'muted'; p.textContent = 'A blank log, an open sea. Complete an operation anywhere afloat to leave your first mark.'; $('#discovery-log').append(p); }
  for (const entry of [...state.discoveries].reverse()) {
    const item = document.createElement('li'), name = document.createElement('b'), meta = document.createElement('small');
    name.textContent = entry.title;
    const where = Number.isFinite(entry.lon) && Number.isFinite(entry.lat) ? formatPosition(entry.lon, entry.lat) : entry.x === null ? 'earlier chart' : `Chart ${Math.round(entry.x * 100)} / ${Math.round(entry.y * 100)}`;
    const depth = Number.isFinite(entry.depth) ? ` · ${Math.round(entry.depth)} m` : '';
    const tally = entry.lost ? `−${entry.lost} points` : { grounding: 'no points to lose', bunker: 'no charge', tow: 'no points lost', radio: 'schedule' }[entry.activity] ?? `+${entry.points}`;
    meta.textContent = `${entry.date ? new Date(entry.date).toLocaleDateString() + ' · ' : ''}${where}${depth} · ${tally}`;
    item.append(name, meta); if (['grounding', 'bunker', 'tow', 'radio'].includes(entry.activity)) item.className = entry.activity; $('#discovery-log').append(item);
  }
  updateActivities(); updateStores(); updateFuel();
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
    description.textContent = ok ? activity.description : unavailableReason(activity);
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
  if (!available(activity)) { toast(unavailableReason(activity), true); return; }
  endActivity(); waypoints = []; keys.clear(); returnFocus = document.activeElement;
  $('#mission-title').textContent = activity.title;
  const location = here(['patrol', 'raft'].includes(activity.id));
  recorder = operationRecorder(state, activity, location, entry => { save(); updateUI(); toast(`${entry.title} · +${entry.points} science points · added to chart`); postScore(activity, entry); });
  const session = recorder;
  $('#mission-dialog').showModal();
  // showModal focuses the first focusable control, the close button; Enter or Space would then close the
  // operation. Focus the game root instead so the keys reach the minigame's own handlers.
  $('#minigame').focus();
  // The fast winch lets a CTD station bank more casts: 25% more points for that operation.
  const bonus = activity.id === 'ctd' && state.upgrades.winch ? 1.25 : 1;
  try { cleanup = game.mount($('#minigame'), { complete: (points, detail) => { if ($('#mission-dialog').open) session.complete(Number.isFinite(points) ? points * bonus : points, detail); }, expedition: { ...location, score: state.score, operations: state.operations, chartPercent: chartPercent(state, sea), fuel: state.fuel, upgrades: { ...state.upgrades } } }); }
  catch (error) { endActivity(); $('#mission-dialog').close(); toast('Could not open this operation. Please try again.'); console.error(error); }
}
$('#close-mission').onclick = () => { endActivity(); $('#mission-dialog').close(); };
// Only a pointer closes the operation with the × button; Enter and Space belong to the minigame (Escape still closes).
$('#close-mission').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
$('#mission-dialog').addEventListener('cancel', () => endActivity());
$('#mission-dialog').addEventListener('close', () => { if ($('#mission-dialog').open) return; endActivity(); if (returnFocus?.isConnected) returnFocus.focus(); else canvas.focus(); });
$('#reset').onclick = () => { if (confirm('Start a fresh voyage and clear your chart, log, science points and stores? Crew ideas stay on the server.')) { endActivity(); if (helicopter) toggleHelicopter(); if (zodiac) toggleZodiac(); auv = null; auvArmed = false; adrift = null; routePlan = null; preview = null; $('#auv').setAttribute('aria-pressed', 'false'); state = newVoyage(0, world?.start); try { localStorage.removeItem('amundsen-expedition'); } catch {} known = new Set(); mapped = new Set(); rebuildSurface(); chartPosition(state, known); waypoints = []; keys.clear(); save(); updateUI(); buildFog(); } };

// The view follows the active vehicle; zoom is chart pixels per grid cell, clamped so the view never leaves the world.
const minZoom = () => world ? Math.max(1, width / world.cols, height / world.rows) : 1;
function view() {
  const z = Math.max(minZoom(), zoom), w = width / z, h = height / z;
  const u = Math.max(w / 2, Math.min(world.cols - w / 2, pilotU())), v = Math.max(h / 2, Math.min(world.rows - h / 2, pilotV()));
  return { z, u0: u - w / 2, v0: v - h / 2 };
}
function setZoom(next) { zoom = Math.max(minZoom(), Math.min(8, next)); }
$('#zoom-in').onclick = () => setZoom(zoom * 1.4); $('#zoom-out').onclick = () => setZoom(zoom / 1.4);
function resize() { const r = canvas.getBoundingClientRect(); if (!r.width) return; width = r.width; height = r.height; const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (width < 520 && zoom === 3.2) zoom = 2.4; }
new ResizeObserver(resize).observe(canvas);
const miniRect = () => { const w = width < 520 ? 96 : 156, h = Math.round(w * (world ? world.rows / world.cols : .7)); return { x: width - w - 12, y: 12, w, h }; };
function sailTo(u, v) {
  if (!world) return;
  if (helicopter?.rtb) { toast('Bingo fuel · the helicopter is returning to the ship.'); return; }
  if (craft()) { waypoints = [{ u: Math.max(.5, Math.min(world.cols - .5, u)), v: Math.max(.5, Math.min(world.rows - .5, v)) }]; routeComplete = true; return; }
  if (state.fuel <= 0) { toast(`Tanks dry · the ship drifts. U bunkers if fuel is within ${BUNKER_KM} km.`); return; }
  const plan = world.route({ u: shipU(), v: shipV() }, { u, v });
  waypoints = plan.points; routeComplete = plan.complete; routePlan = plan.points.length ? routeCost(plan.points) : null;
  if (!plan.complete) toast(plan.points.length ? 'No sea route there. Holding short of the coast.' : 'That is land. The ship stays afloat.');
  else if (routePlan && routePlan.fuel > state.fuel) toast(`Route ${Math.round(routePlan.km)} km needs about ${m3(routePlan.fuel)} m³ · ${Math.round(state.fuel)} m³ aboard. Bunker on the way.`, true);
}
canvas.addEventListener('pointerdown', e => {
  canvas.focus(); if (!world || !chart) return;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, m = miniRect();
  pointer = null; preview = null;
  if (px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) { sailTo((px - m.x) / m.w * world.cols, (py - m.y) / m.h * world.rows); return; }
  const { z, u0, v0 } = view(); keys.clear();
  if (auvArmed) { launchAuv(u0 + px / z, v0 + py / z); return; }
  sailTo(u0 + px / z, v0 + py / z);
});
// Under a mouse the chart previews the route and its diesel before the click commits it (or the AUV's run when armed).
canvas.addEventListener('pointermove', e => {
  if (!world || !chart || e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, m = miniRect();
  if (px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) { pointer = null; preview = null; return; }
  pointer = { px, py, moved: true };
});
canvas.addEventListener('pointerleave', () => { pointer = null; preview = null; });
function updatePreview() {
  if (!pointer?.moved || craft()) { if (!pointer) preview = null; return; }
  pointer.moved = false;
  const { z, u0, v0 } = view(), u = u0 + pointer.px / z, v = v0 + pointer.py / z;
  if (auvArmed) { const end = auvEnd(u, v); preview = { points: [end], complete: true, auv: true, km: Math.hypot(end.u - shipU(), end.v - shipV()) * world.km }; return; }
  if (state.fuel <= 0) { preview = null; return; }
  const plan = world.route({ u: shipU(), v: shipV() }, { u, v });
  preview = plan.points.length ? { ...plan, ...routeCost(plan.points) } : null;
}
function isControl(element) { return element?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog'); }
window.addEventListener('keydown', e => {
  if (page !== 'game' || $('#mission-dialog').open || isControl(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), activity = activities.find(a => a.key.toLowerCase() === k) || (k === 'e' ? activities.find(a => a.id === 'ctd') : null);
  if (k === 'g') { e.preventDefault(); if (!e.repeat) toggleHelicopter(); return; }
  if (k === 'u') { e.preventDefault(); if (!e.repeat) doBunker(); return; }
  if (k === 'q') { e.preventDefault(); if (!e.repeat) toggleStores(); return; }
  if (k === 'y') { e.preventDefault(); if (!e.repeat) toggleZodiac(); return; }
  if (k === '1') { e.preventDefault(); if (!e.repeat) armAuv(); return; }
  if (activity) { e.preventDefault(); if (!e.repeat) startActivity(activity); return; }
  if (k === '+' || k === '=') { e.preventDefault(); setZoom(zoom * 1.4); return; }
  if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom / 1.4); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k)) { e.preventDefault(); if (helicopter?.rtb) return; keys.add(k); waypoints = []; routePlan = null; }
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
  const u = shipU(), v = shipV(), { lon, lat } = world.unproject(u, v);
  const record = runAground(state, { x: state.x, y: state.y, lon, lat }, world.nearestPlace(u, v)?.name ?? '');
  const lost = record.lost;
  waypoints = []; keys.clear(); holdUntil = performance.now() + 1200; shake = 1;
  $('.map-panel').classList.remove('aground'); void $('.map-panel').offsetWidth; $('.map-panel').classList.add('aground');
  save(); updateUI();
  toast(`${record.title}. ${lost ? `${lost} science points lost, the last operation's worth` : 'Nothing to lose yet'} · back to safe water, chart and log intact.`, true);
}
// The helicopter crosses land freely on its own fuel; the zodiac stops at the shore, the ice edge and its tether
// and sounds the cells it crosses; the ship checks the shore, maps its swept fan and burns diesel for the distance.
function hold(message) { keys.clear(); waypoints = []; toast(message); return false; }
function move(du, dv) {
  const u = pilotU(), v = pilotV(), cols = world.cols, rows = world.rows;
  const nu = Math.max(.5, Math.min(cols - .5, u + du)), nv = Math.max(.5, Math.min(rows - .5, v + dv)), km = Math.hypot(nu - u, nv - v) * world.km;
  if (helicopter) { helicopter.u = nu; helicopter.v = nv; state.heliFuel = Math.max(0, state.heliFuel - km * FUEL.heliBurn); return true; }
  if (zodiac) {
    if (world.isLand(nu, nv) || !world.lineClear(u, v, nu, nv)) return hold('Shore ahead · the zodiac holds off the beach.');
    if (world.ice(nu, nv)?.percent > 0) return hold('Ice ahead · the zodiac cannot enter the pack.');
    if (Math.hypot(nu - shipU(), nv - shipV()) * world.km > ZODIAC_TETHER_KM) return hold(`End of the zodiac’s ${ZODIAC_TETHER_KM} km tether.`);
    const added = mapSwath(state, mapped, world, { u, v }, { u: nu, v: nv }, 1, 0);
    if (added.length) { clearSeabed(added); mappingDirty = true; }
    zodiac.u = nu; zodiac.v = nv; return true;
  }
  if (state.fuel <= 0) return false;
  if (world.isLand(nu, nv) || !world.lineClear(u, v, nu, nv)) { state.x = nu / cols; state.y = nv / rows; aground(); return false; }
  const added = mapSwath(state, mapped, world, { u, v }, { u: nu, v: nv }, state.upgrades.swath ? WIDE_SWATH : 1);
  if (added.length) { clearSeabed(added); mappingDirty = true; }
  state.x = nu / cols; state.y = nv / rows;
  if (!sail(state, km, world.ice(u, v)?.percent ?? 255)) { keys.clear(); waypoints = []; routePlan = null; }
  return true;
}
let surfaceBase = null;
function clearSeabed(cells) {
  if (!surface) return;
  const paint = surface.getContext('2d');
  for (const cell of cells) paint.clearRect(cell % world.cols * CHART_SCALE, Math.floor(cell / world.cols) * CHART_SCALE, CHART_SCALE, CHART_SCALE);
}
function rebuildSurface() {
  if (!surfaceBase) return;
  surface = document.createElement('canvas'); surface.width = surfaceBase.width; surface.height = surfaceBase.height;
  surface.getContext('2d').drawImage(surfaceBase, 0, 0); clearSeabed(mapped);
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
function label(text, x, y, colour = '#1b2a2c', font = 'bold 11px sans-serif') {
  ctx.font = font; ctx.lineWidth = 3; ctx.strokeStyle = '#ddcca7cc'; ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
}
// A fuel port's berth: a teal drop, gold with a ring when the ship can bunker there.
function drawFuel(x, y, near, text, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.fillStyle = near ? '#f6c75f' : '#116b6b'; ctx.strokeStyle = '#1b2a2c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.bezierCurveTo(7, -1, 7, 5, 0, 6); ctx.bezierCurveTo(-7, 5, -7, -1, 0, -9); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (near) { ctx.strokeStyle = '#f6c75f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); }
  ctx.restore();
  if (text) label(text, x + 10, y + 14, '#0f4a4a', 'italic 11px Georgia');
}
function drawTanker(x, y, near, text) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#7a2f23'; ctx.strokeStyle = '#1b2a2c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-15, -3); ctx.lineTo(10, -3); ctx.lineTo(16, 0); ctx.lineTo(10, 4); ctx.lineTo(-15, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f1e9d9'; ctx.fillRect(-13, -9, 6, 6); ctx.fillStyle = '#e7b254'; ctx.fillRect(-4, -6, 10, 3);
  if (near) { ctx.strokeStyle = '#f6c75f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.stroke(); }
  ctx.restore();
  label(text, x + 20, y + 4, '#7a2f23');
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
  if (surface) ctx.drawImage(surface, u0 * S, v0 * S, width / z * S, height / z * S, 0, 0, width, height);
  ctx.drawImage(fog, u0 / world.cols * fog.width, v0 / world.rows * fog.height, width / z / world.cols * fog.width, height / z / world.rows * fog.height, 0, 0, width, height);
  drawGraticule(z, u0, v0);
  ctx.strokeStyle = '#e8c589'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); state.route.forEach((p, i) => i ? ctx.lineTo(toX(p.x * world.cols), toY(p.y * world.rows)) : ctx.moveTo(toX(p.x * world.cols), toY(p.y * world.rows))); ctx.stroke(); ctx.setLineDash([]);
  for (const d of state.discoveries) {
    if (d.x === null) continue;
    const x = toX(d.x * world.cols), y = toY(d.y * world.rows);
    if (d.activity === 'radio') continue;
    if (d.activity === 'bunker') { drawFuel(x, y, false, '', .6); continue; }
    if (d.activity === 'grounding' || d.activity === 'tow') { ctx.strokeStyle = d.activity === 'tow' ? '#d9822b' : '#b3352b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); continue; }
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
  // Fuel ports within PORT_CHART_KM of the ship, and the tanker whenever she is at anchor.
  const su = shipU(), sv = shipV(), chartReach = PORT_CHART_KM / world.km, bunkerReach = BUNKER_KM / world.km;
  for (const port of world.ports) {
    const d = Math.hypot(port.berth.u - su, port.berth.v - sv); if (d > chartReach) continue;
    const x = toX(port.berth.u), y = toY(port.berth.v); if (x < -40 || x > width + 40 || y < -20 || y > height + 20) continue;
    drawFuel(x, y, d <= bunkerReach, `${port.name} · fuel`);
  }
  const call = tanker();
  if (call.at) { const x = toX(call.anchorage.u), y = toY(call.anchorage.v); if (x > -60 && x < width + 60 && y > -20 && y < height + 20) drawTanker(x, y, Math.hypot(call.anchorage.u - su, call.anchorage.v - sv) <= bunkerReach, `${TANKER.name} · ${call.anchorage.name} · until ${clock(call.until)}`); }
  if (preview?.points.length && !waypoints.length) {
    ctx.strokeStyle = preview.auv ? '#d9e26bb0' : preview.complete ? '#ffffff70' : '#e9955c90'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(toX(su), toY(sv));
    for (const p of preview.points) ctx.lineTo(toX(p.u), toY(p.v));
    ctx.stroke(); ctx.setLineDash([]); const end = preview.points.at(-1);
    label(preview.auv ? `AUV run ${Math.round(preview.km)} km out and back` : `${Math.round(preview.km)} km · ${m3(preview.fuel)} m³${preview.complete ? '' : ' · no sea route'}`, toX(end.u) + 8, toY(end.v) - 8, preview.fuel > state.fuel ? '#b3352b' : '#1b2a2c');
  }
  if (waypoints.length) {
    ctx.strokeStyle = routeComplete ? '#cfdfd880' : '#e9955c'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(toX(pilotU()), toY(pilotV()));
    for (const p of waypoints) ctx.lineTo(toX(p.u), toY(p.v));
    ctx.stroke(); ctx.setLineDash([]); const end = waypoints.at(-1); ctx.beginPath(); ctx.arc(toX(end.u), toY(end.v), 5, 0, 7); ctx.stroke();
    if (routePlan && !craft()) label(`${Math.round(routePlan.km)} km · ${m3(routePlan.fuel)} m³`, toX(end.u) + 8, toY(end.v) - 8, routePlan.fuel > state.fuel ? '#b3352b' : '#1b2a2c');
  }
  if (auv) {
    const x = toX(auv.u), y = toY(auv.v), goal = auv.home ? auv.dock : auv.target;
    if (!auv.waiting) { ctx.strokeStyle = '#d9e26bb0'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(toX(goal.u), toY(goal.v)); ctx.stroke(); ctx.setLineDash([]); }
    ctx.save(); ctx.translate(x, y); if (!auv.waiting) ctx.rotate(Math.atan2(goal.v - auv.v, goal.u - auv.u)); ctx.fillStyle = '#d9e26b'; ctx.strokeStyle = '#25290c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-9, -3.5, 18, 7, 3.5); ctx.fill(); ctx.stroke(); ctx.restore();
    label(auv.waiting ? 'AUV · surfaced, waiting' : `AUV · ${auv.cells} cells`, x + 12, y - 8, '#25290c');
  }
  if (zodiac) { ctx.strokeStyle = '#f0a35b90'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(toX(su), toY(sv)); ctx.lineTo(toX(zodiac.u), toY(zodiac.v)); ctx.stroke(); ctx.setLineDash([]); }
  drawShip(toX(su), toY(sv), Math.min(1, .35 + z * .1));
  if (zodiac) {
    const x = toX(zodiac.u), y = toY(zodiac.v);
    ctx.save(); ctx.translate(x, y); ctx.rotate(flightAngle); ctx.fillStyle = '#f0a35b'; ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(3, -5); ctx.lineTo(-8, -5); ctx.lineTo(-8, 5); ctx.lineTo(3, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5b6b70'; ctx.fillRect(-5, -2.5, 8, 5); ctx.restore();
    label('ZODIAC', x + 14, y - 12, '#2b1a0c', 'bold 12px sans-serif');
  }
  if (helicopter) {
    const x = toX(pilotU()), y = toY(pilotV());
    ctx.save(); ctx.translate(x, y); ctx.rotate(flightAngle); ctx.fillStyle = '#f6c75f'; ctx.strokeStyle = '#332912'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(0, 0); ctx.moveTo(0, -18); ctx.lineTo(0, 18); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#f6c75f'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('HELICOPTER', x + 15, y - 15);
  }
  ctx.restore();
  // Compass: true north is the direction of the pole, which swings with longitude on this projection.
  const north = world.northAngle(pilotU(), pilotV());
  ctx.save(); ctx.translate(34, height - 40); ctx.rotate(north + Math.PI / 2); ctx.strokeStyle = '#3b3222'; ctx.fillStyle = '#3b3222'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-5, -6); ctx.lineTo(5, -6); ctx.closePath(); ctx.fill(); ctx.font = 'bold 11px Georgia'; ctx.fillText('N', -4, -19); ctx.restore();
  const m = miniRect();
  ctx.drawImage(mini, m.x, m.y, m.w, m.h); ctx.strokeStyle = '#3b3222'; ctx.lineWidth = 1; ctx.strokeRect(m.x + .5, m.y + .5, m.w - 1, m.h - 1);
  ctx.strokeStyle = '#ffffffcc'; ctx.strokeRect(m.x + u0 / world.cols * m.w, m.y + v0 / world.rows * m.h, width / z / world.cols * m.w, height / z / world.rows * m.h);
  ctx.fillStyle = '#ca5342'; ctx.beginPath(); ctx.arc(m.x + shipU() / world.cols * m.w, m.y + shipV() / world.rows * m.h, 2.5, 0, 7); ctx.fill();
  if (craft()) { ctx.fillStyle = helicopter ? '#f6c75f' : '#f0a35b'; ctx.fillRect(m.x + pilotU() / world.cols * m.w - 2, m.y + pilotV() / world.rows * m.h - 2, 4, 4); }
  if (auv) { ctx.fillStyle = '#d9e26b'; ctx.fillRect(m.x + auv.u / world.cols * m.w - 2, m.y + auv.v / world.rows * m.h - 2, 4, 4); }
}
function loop(time) {
  const dt = last ? Math.min((time - last) / 1000, .04) : 0; last = time;
  if (page === 'game' && !document.hidden && !$('#mission-dialog').open && world && chart) {
    let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    let len = 0;
    if (time < holdUntil) { dx = dy = 0; keys.clear(); }
    const z = view().z, ice = world.ice(shipU(), shipV());
    drift(time, dt); stepAuv(dt);
    // Cells per second: 20 (40 km/s) at the default zoom, a little slower when zoomed in, slowed further by the pack
    // (less with an ice-strengthened hull). The helicopter flies at 2.5 times that, the zodiac at 1.6.
    const speed = 20 * Math.sqrt(3.2 / z) * (helicopter ? 2.5 : zodiac ? 1.6 : world.iceSpeed(ice ? ice.percent : 255, state.upgrades.hull ? .6 : 1)) * dt;
    if (waypoints.length) {
      let budget = speed;
      while (waypoints.length && budget > 0) {
        const next = waypoints[0], du = next.u - pilotU(), dv = next.v - pilotV(), d = Math.hypot(du, dv);
        if (d < .05) { waypoints.shift(); continue; }
        if (craft()) flightAngle = Math.atan2(dv, du); else angle = Math.atan2(dv, du); const step = Math.min(budget, d); len = 1;
        if (!move(du / d * step, dv / d * step)) break;
        budget -= step; if (step === d) waypoints.shift();
      }
      if (!waypoints.length) save();
    } else if (dx || dy) {
      len = Math.hypot(dx, dy); if (craft()) flightAngle = Math.atan2(dy, dx); else angle = Math.atan2(dy, dx);
      for (let part = 0; part < 4; part++) if (!move(dx / len * speed / 4, dy / len * speed / 4)) break;
    }
    shake = Math.max(0, shake - dt * 3);
    chartElapsed += dt;
    if (chartElapsed >= .15) {
      chartElapsed = 0;
      if (chartPosition(craft() ? { ...state, x: pilotU() / world.cols, y: pilotV() / world.rows, route: [] } : state, known)) { buildFog(); updateProgress(); sightPlaces(); }
      if (mappingDirty) { mappingDirty = false; $('#score').textContent = state.score; updateProgress(); updateStores(); }
      if (world.seaRoom(shipU(), shipV())) state.safe = { x: state.x, y: state.y };
      checkHelicopterFuel(); radio(); updatePreview(); updateFuel();
      if (waypoints.length && !craft()) routePlan = routeCost(waypoints); else if (!waypoints.length) routePlan = null;
      const source = craft() ? null : fuelSource(); $('#bunker').classList.toggle('ready', !!source);
      const { lon, lat } = world.unproject(pilotU(), pilotV()), depth = Math.round(world.depth(shipU(), shipV()));
      const navigation = helicopter ? `HELICOPTER / ${formatPosition(lon, lat)} · ${world.isLand(pilotU(), pilotV()) ? 'over land' : iceLabel(world.ice(pilotU(), pilotV()))} · ${Math.round(state.heliFuel)} L${helicopter.rtb ? ' · bingo fuel, returning' : ''} · ship holding · G to return`
        : zodiac ? `ZODIAC / ${formatPosition(lon, lat)} · ${Math.round(world.depth(pilotU(), pilotV()))} m · ${Math.round(Math.hypot(zodiac.u - shipU(), zodiac.v - shipV()) * world.km)} of ${ZODIAC_TETHER_KM} km from the ship · Y to recover`
        : state.fuel <= 0 ? `BRIDGE / ${formatPosition(lon, lat)} · ADRIFT, tanks dry · tow south in ${Math.max(0, Math.ceil((ADRIFT_GRACE_MS - (time - (adrift?.since ?? time))) / 1000))} s${source ? ` · ${source.label}: U to bunker` : ` · U bunkers within ${BUNKER_KM} km`}`
        : `BRIDGE / ${formatPosition(lon, lat)} · ${depth} m · ${iceLabel(ice)} · ${len ? 'Underway' : 'Holding position'} · swath ${(swathWidth(world.depth(shipU(), shipV()), state.upgrades.swath ? WIDE_SWATH : 1) / 1000).toFixed(1)} km · ${burnRate(state, ice ? ice.percent : 255).toFixed(2)} m³/km${routePlan ? ` · route ${Math.round(routePlan.km)} km, ${m3(routePlan.fuel)} m³` : ''}${source ? ` · ${source.label}: U to bunker` : ''}`;
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
    state.mapped = state.mapped.filter(cell => cell < world.cols * world.rows && world.sign[cell] < 0); mapped = new Set(state.mapped);
    if (world.isLand(shipU(), shipV())) Object.assign(state, world.start);
    if (!world.seaRoom(state.safe.x * world.cols, state.safe.y * world.rows)) state.safe = { ...world.start };
    sea = world.seaFog(COLS, ROWS);
    seaCells = world.sign.reduce((sum, sign) => sum + (sign < 0 ? 1 : 0), 0) || 1;
    for (const anchorage of TANKER.anchorages) Object.assign(anchorage, world.project(anchorage.lon, anchorage.lat));
    startPlace = world.nearestPlace(world.start.x * world.cols, world.start.y * world.rows)?.name ?? '';
    radioSeen = tanker().slot;
    chartPosition(state, known); updateUI(); buildFog();
    $('#mapping-rule').textContent = `1 point per new ${world.km} × ${world.km} km grid cell · 120° fan widens with depth`;
    $('#chart-credit').textContent = `GEBCO 2024 · CIS ice chart ${world.chartDate}`;
    surfaceBase = await renderChart(world, () => {}, false); rebuildSurface();
    chart = await renderChart(world, value => { progress = value; });
    miniBase = document.createElement('canvas'); const m = miniRect(); miniBase.width = m.w * 2; miniBase.height = m.h * 2;
    const base = miniBase.getContext('2d'); base.imageSmoothingEnabled = true; base.drawImage(surfaceBase, 0, 0, miniBase.width, miniBase.height);
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
  if (publicMirror) return;
  const player = playerName();
  if (!player) { toast('Sign the log with your name to post scores to the leaderboard.'); return; }
  try { await fetch('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player, activity: activity.id, title: activity.title, points: entry.points }) }); } catch {}
}
function boardList(list, rows, empty) { list.replaceChildren(); if (!rows.length) { list.append(el('li', 'none', empty)); return; } for (const r of rows) { const item = el('li'); item.append(el('span', '', r.player), el('b', '', `${r.points}${r.operations ? ` · ${r.operations} ops` : ''}`)); list.append(item); } }
async function loadLeaderboard() {
  if (publicMirror) return;
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
      form.body.value = ''; status.textContent = ''; await loadIdeas();
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
async function loadIdeas() {
  if (publicMirror) return;
  try {
    const response = await fetch('api/suggestions'); if (!response.ok) throw Error();
    const ideas = await response.json(), list = $('#idea-list');
    $('#idea-count').textContent = ideas.length; $('#board-status').textContent = 'Updates every 5 seconds';
    list.querySelector('.empty')?.remove();
    const ids = new Set(ideas.map(idea => String(idea.id)));
    for (const card of list.querySelectorAll('.idea')) if (!ids.has(card.dataset.id) && !card.contains(document.activeElement) && !card.querySelector('textarea')?.value) card.remove();
    for (const idea of ideas) {
      const card = [...list.children].find(node => node.dataset.id === String(idea.id));
      if (!card) { list.append(ideaCard(idea)); continue; }
      card.querySelector('summary').textContent = summaryText(idea);
      commentList(idea, card.querySelector('.comments'));
      const head = card.querySelector('.idea-head'); head.querySelector('.build')?.remove();
      if (idea.build) head.append(el('span', `build build-${idea.build}`, BUILD_LABEL[idea.build] || idea.build));
    }
    if (!ideas.length && !list.children.length) list.append(el('div', 'empty', 'The next adventure starts with an idea. Be the first to share yours.'));
  } catch { $('#board-status').textContent = 'Cannot reach the server. Retrying…'; }
}
$('#idea-form').onsubmit = async e => { e.preventDefault(); const form = e.currentTarget, button = form.querySelector('button'); button.disabled = true; $('#form-status').textContent = 'Sending…'; try { const response = await fetch('api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); if (!response.ok) throw Error((await response.json()).error || 'Could not save idea'); form.reset(); $('#form-status').textContent = 'Your idea is on the crew board. Thank you!'; await loadIdeas(); } catch (error) { $('#form-status').textContent = error.message === 'Failed to fetch' ? 'Connection lost. Your draft is still here; try again.' : error.message; } finally { button.disabled = false; } };
setInterval(() => { if (!document.hidden) loadIdeas(); if (world) save(); }, 5000); setInterval(() => { if (!document.hidden && page === 'board') loadLeaderboard(); }, 10000); updateUI(); loadIdeas(); resize(); requestAnimationFrame(loop); boot();
