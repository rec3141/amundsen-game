import { t, text as localize } from './i18n-text.js';
import { publicMirror } from './site.js';
import { minigames, activities } from './minigames/registry.js';
import { randomCasualty } from './minigames/crew-12-model.js';
import { STORAGE_KEY, COLS, ROWS, FUEL, STORES, WIDE_SWATH, MAP_KM2, newVoyage, readVoyage, chartPosition, chartPercent, operationRecorder, runAground, mapSwath, swathWidth, tankCapacity, burnRate, sail, buy, bunker, towSouth, logEvent } from './exploration.js';
import { loadWorld } from './world.js';
import { createChart } from './world-chart.js';
import { multiplayer } from './multiplayer.js';
const $ = s => document.querySelector(s);
if (publicMirror) {
  document.querySelectorAll('[data-page="ideas"], [data-page="board"], #suggest-shortcut, .crew-note, .player').forEach(node => { node.hidden = true; });
  $('#fleet-tab').hidden = true;
}
const canvas = $('#ocean'), ctx = canvas.getContext('2d');
const fog = document.createElement('canvas'), mini = document.createElement('canvas');
let width = 900, height = 480, dpr = 1, keys = new Set(), last = 0, angle = -.4, cleanup = null, page = 'game';
// `zoom` is chart pixels per grid cell once the player has zoomed; null follows the starting scale for the screen.
let world = null, chart = null, placeholder = null, miniBase = null, sea = null, zoom = null, progress = 0;
let state = newVoyage(), known = new Set(), recorder = null, returnFocus = null, chartElapsed = 0;
let helicopter = null, flightAngle = 0, mapped = new Set(), mappingDirty = false, seaCells = 1;
// One small craft is under the player's control at a time; the AUV runs on its own. `adrift` holds the moment the
// tanks ran dry, `routePlan` the distance and diesel of the committed route, `preview` the route under the mouse.
let zodiac = null, auv = null, auvArmed = false, adrift = null, routePlan = null, preview = null, pointer = null, startPlace = '', radioSeen = -1;
const craft = () => helicopter || zodiac;
const pilotU = () => craft()?.u ?? shipU(), pilotV = () => craft()?.v ?? shipV();
let waypoints = [], routeComplete = true, holdUntil = 0, shake = 0;
// Live events: the archive wrecks on the chart, the wreck the ship is steaming to, an alarm waiting to open, the
// cached nearest-ice search and the chart mark under the mouse.
let wrecks = [], target = null, pendingAlarm = null, iceCache = null, hovered = null;
// The ship makes SHIP_KM_PER_S at the starting zoom (a little less zoomed in, less again in ice); the zodiac keeps
// within a tether of the ship; the AUV runs straight out at AUV_KM_PER_S and maps a fixed near-bottom swath;
// bunkering, and recovering the AUV, need the ship within BUNKER_KM; dry tanks drift at DRIFT_KM_PER_S for the grace
// period, then a tow.
const SHIP_KM_PER_S = 50, ZODIAC_TETHER_KM = 30, AUV_RANGE_KM = 60, AUV_SWATH_M = 3000, AUV_KM_PER_S = 36, DRIFT_KM_PER_S = 1.2, BUNKER_KM = 6, PORT_CHART_KM = 300, ADRIFT_GRACE_MS = 30000;
// Wreck datums and Mayday calls add context to operations, which can launch anywhere. Calls stand down after
// SAR_LIFE_S. Intervals are seconds of active play: calls and alarms use a minimum gap plus an exponential draw.
const WRECK_KM = 15, SAR_LIFE_S = 1200, SAR_GAP_S = 360, SAR_SPREAD_S = 360, SAR_FIRST_S = [150, 300], SAR_RANGE_KM = [60, 300];
const ALARM_GAP_S = 480, ALARM_SPREAD_S = 420, ALARM_FIRST_S = [300, 480], ALARM_DELAY_MS = 2000, ICE_NEAR_KM = 10, ICE_NEAR_PERCENT = 10, ICE_SEARCH_CELLS = 400;
const ALARMS = { flood: 'flooding in the aft lab', contaminants: 'contamination on the rosette deck' };
const expo = mean => -Math.log(1 - Math.random()) * mean, between = ([lo, hi]) => lo + Math.random() * (hi - lo);
// Event state rides in the saved voyage beside the exploration fields and is restored here with guarded defaults:
// `played` seconds of active play; `lastCall`, `nextCall`, `lastAlarm`, `nextAlarm` on that clock; the active
// Mayday; the id of the wreck the ship is steaming to.
function restoreEvents(state, raw) {
  const num = (value, fallback) => Number.isFinite(value) && value >= 0 ? value : fallback, text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  state.played = num(raw?.played, 0);
  state.lastCall = Number.isFinite(raw?.lastCall) ? raw.lastCall : null; state.lastAlarm = Number.isFinite(raw?.lastAlarm) ? raw.lastAlarm : null;
  state.nextCall = num(raw?.nextCall, state.played + between(SAR_FIRST_S)); state.nextAlarm = num(raw?.nextAlarm, state.played + between(ALARM_FIRST_S));
  const m = raw?.mayday;
  state.mayday = m && [m.x, m.y, m.lon, m.lat, m.at, m.until].every(Number.isFinite) && m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1
    ? { name: text(m.name, 60) || 'an unnamed vessel', kind: text(m.kind, 40), trouble: text(m.trouble, 120), x: m.x, y: m.y, lon: m.lon, lat: m.lat, at: m.at, until: m.until } : null;
  state.target = text(raw?.target, 40) || null;
}
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
function toast(message, long = false, klaxon = false) { $('#toast').textContent = localize(message); $('#toast').classList.toggle('klaxon', klaxon); $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), long ? 7000 : 3500); }
function showPage(name) { if (publicMirror && name !== 'game') return; page = name; keys.clear(); waypoints = []; $('#game-page').hidden = name !== 'game'; $('#ideas-page').hidden = name !== 'ideas'; $('#board-page').hidden = name !== 'board'; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.page === name)); if (name === 'ideas') loadIdeas(); else if (name === 'board') loadLeaderboard(); else { fitBridge(); resize(); } }
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showPage(b.dataset.page));
$('#suggest-shortcut').onclick = $('#crew-link').onclick = () => showPage('ideas');

// Ship position in world cells, and the world context every operation receives.
const shipU = () => state.x * world.cols, shipV = () => state.y * world.rows;
const degrees = (value, positive, negative) => { const abs = Math.abs(value), whole = Math.floor(abs), minutes = ((abs - whole) * 60).toFixed(1); return `${whole}°${minutes.padStart(4, '0')}′${value >= 0 ? positive : negative}`; };
const formatPosition = (lon, lat) => `${degrees(lat, 'N', 'S')} ${degrees(lon, 'E', 'W')}`;
function iceLabel(ice) {
  if (!ice) return 'no ice measurement here';
  if (!ice.percent) return /iceberg/i.test(ice.form) ? 'bergy water' : 'open water';
  if (ice.source === 'NSIDC') return `ice ${ice.tenths.toFixed(1)}/10 · NSIDC satellite`;
  return `ice ${ice.percent === 5 ? '<1' : ice.tenths}/10 ${ice.stage.replace(/ \(.*\)/, '').toLowerCase()}`;
}
function here(airborne = false) {
  const u = airborne ? pilotU() : shipU(), v = airborne ? pilotV() : shipV(), { lon, lat } = world.unproject(u, v), ice = world.ice(u, v);
  return { x: u / world.cols, y: v / world.rows, vehicle: airborne ? 'helicopter' : 'ship', lon, lat, depth: world.depth(u, v), ice: ice && { ...ice, concentration: ice.tenths, chartDate: ice.source === 'NSIDC' && world.satellite ? world.satellite.date : world.chartDate } };
}
// Distances and compass bearings between grid positions; north is the direction of the pole at the origin.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const kmBetween = (u0, v0, u1, v1) => Math.hypot(u1 - u0, v1 - v0) * world.km;
function bearing(u0, v0, u1, v1) { const a = Math.atan2(v1 - v0, u1 - u0) - world.northAngle(u0, v0), deg = ((a * 180 / Math.PI) % 360 + 360) % 360; return COMPASS[Math.round(deg / 45) % 8]; }
// Charted ice of ICE_NEAR_PERCENT or more within ICE_NEAR_KM of a position, and the nearest such cell to it,
// searched in rings out to ICE_SEARCH_CELLS and cached for the grid cell the position is in.
const icy = i => world.sign[i] < 0 && world.iceConcentration[i] !== 255 && world.iceConcentration[i] >= ICE_NEAR_PERCENT;
function nearIce(u, v) {
  const reach = ICE_NEAR_KM / world.km, r = Math.ceil(reach), c0 = Math.floor(u), r0 = Math.floor(v);
  for (let rr = Math.max(0, r0 - r); rr <= Math.min(world.rows - 1, r0 + r); rr++) for (let cc = Math.max(0, c0 - r); cc <= Math.min(world.cols - 1, c0 + r); cc++)
    if (Math.hypot(cc + .5 - u, rr + .5 - v) <= reach && icy(rr * world.cols + cc)) return true;
  return false;
}
function nearestIce(u, v) {
  const c0 = Math.floor(u), r0 = Math.floor(v), key = r0 * world.cols + c0;
  if (iceCache?.key === key) return iceCache.result;
  let best = null;
  const look = (cc, rr) => { if (cc < 0 || rr < 0 || cc >= world.cols || rr >= world.rows || !icy(rr * world.cols + cc)) return; const d = Math.hypot(cc + .5 - u, rr + .5 - v); if (!best || d < best.d) best = { d, u: cc + .5, v: rr + .5 }; };
  for (let ring = 0; ring <= ICE_SEARCH_CELLS && !(best && ring - 1 > best.d); ring++) {
    for (let cc = c0 - ring; cc <= c0 + ring; cc++) { look(cc, r0 - ring); if (ring) look(cc, r0 + ring); }
    for (let rr = r0 - ring + 1; rr < r0 + ring; rr++) { look(c0 - ring, rr); look(c0 + ring, rr); }
  }
  iceCache = { key, result: best && { km: best.d * world.km, bearing: bearing(u, v, best.u, best.v) } };
  return iceCache.result;
}
// The archive wrecks: the nearest to the ship, and the one whose datum the ship is on.
function nearestWreck(u = shipU(), v = shipV()) { let best = null; for (const wreck of wrecks) { const km = kmBetween(u, v, wreck.u, wreck.v); if (!best || km < best.km) best = { wreck, km, bearing: bearing(u, v, wreck.u, wreck.v) }; } return best; }
const wreckHere = () => { const near = world && nearestWreck(); return near && near.km <= (near.wreck.reach ?? WRECK_KM) ? near.wreck : null; };
const maydayU = () => state.mayday.x * world.cols, maydayV = () => state.mayday.y * world.rows;
const maydayRange = () => ({ km: kmBetween(shipU(), shipV(), maydayU(), maydayV()), bearing: bearing(shipU(), shipV(), maydayU(), maydayV()) });
const maydayLine = () => { const r = maydayRange(); return `Answer the Mayday from ${state.mayday.name} · ${Math.round(r.km)} km ${r.bearing}`; };
// The activity description can reflect a call or a wreck under the ship.
function describe(activity) {
  if (!world) return activity.description;
  if (['sar', 'escort'].includes(activity.id) && state.mayday) return maydayLine();
  if (activity.id === 'wrecks') { const wreck = wreckHere(); if (wreck) return `Survey the ${wreck.ship} datum · on station`; }
  return activity.description;
}
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
  if (!helicopter && target) routeTarget();
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
  if (!zodiac && target) routeTarget();
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
  const goal = auv.home ? auv.dock : auv.target, du = goal.u - auv.u, dv = goal.v - auv.v, d = Math.hypot(du, dv), step = Math.min(d, AUV_KM_PER_S / world.km * dt);
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
  adrift = null; waypoints = []; routePlan = null; if (target) routeTarget(); save(); updateUI();
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
  const u = shipU(), v = shipV(), drifted = DRIFT_KM_PER_S / world.km * dt, nu = u + Math.cos(adrift.heading) * drifted, nv = v + Math.sin(adrift.heading) * drifted;
  if (nu > .5 && nv > .5 && nu < world.cols - .5 && nv < world.rows - .5 && !world.isLand(nu, nv) && world.lineClear(u, v, nu, nv)) { state.x = nu / world.cols; state.y = nv / world.rows; } else adrift.heading += Math.PI / 2;
  if (time - adrift.since >= ADRIFT_GRACE_MS) tow();
}
function tow() {
  const u = shipU(), v = shipV(), { lon, lat } = world.unproject(u, v);
  const record = towSouth(state, { x: state.x, y: state.y, lon, lat, depth: world.depth(u, v) }, world.nearestPlace(u, v)?.name ?? '', world.start, startPlace);
  adrift = null; waypoints = []; routePlan = null; keys.clear(); holdUntil = performance.now() + 1500; angle = -.4; clearTarget();
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

// The archive wrecks, fetched relative to the page once the world can place them.
async function loadWrecks() {
  try {
    const response = await fetch('data/crew-18-wrecks.json'); if (!response.ok) throw Error('wreck archive missing');
    const data = await response.json();
    wrecks = (Array.isArray(data?.wrecks) ? data.wrecks : []).filter(w => typeof w?.id === 'string' && Number.isFinite(w.lon) && Number.isFinite(w.lat))
      .map(w => ({ id: w.id.slice(0, 40), ship: String(w.ship ?? w.id).slice(0, 60), year: Number.isFinite(w.year) ? w.year : null, place: String(w.place ?? '').slice(0, 80), lon: w.lon, lat: w.lat, ...world.project(w.lon, w.lat) }));
    // A datum deep in a bay with no water within WRECK_KM is surveyed from the nearest water instead.
    for (const wreck of wrecks) wreck.reach = Math.max(WRECK_KM, nearestWaterKm(wreck.u, wreck.v) + 2);
  } catch (error) { console.error(error); wrecks = []; }
}
function nearestWaterKm(u, v, reach = 12) {
  let best = Infinity;
  for (let r = Math.max(0, Math.floor(v) - reach); r <= Math.min(world.rows - 1, Math.floor(v) + reach); r++) for (let c = Math.max(0, Math.floor(u) - reach); c <= Math.min(world.cols - 1, Math.floor(u) + reach); c++)
    if (world.sign[r * world.cols + c] < 0) best = Math.min(best, Math.hypot(c + .5 - u, r + .5 - v));
  return best * world.km;
}
// Water the ship can reach nearest a datum: the datum itself when it is afloat, else the closest cell with sea room
// within `reach` cells, then any water cell, the first with a complete route winning. Falls back to holding short.
function approach(u, v, reach = 12) {
  const from = { u: shipU(), v: shipV() }, roomy = [], tight = [];
  if (!world.isLand(u, v)) roomy.push({ u, v, d: 0 });
  for (let r = Math.max(0, Math.floor(v) - reach); r <= Math.min(world.rows - 1, Math.floor(v) + reach); r++) for (let c = Math.max(0, Math.floor(u) - reach); c <= Math.min(world.cols - 1, Math.floor(u) + reach); c++) {
    if (world.sign[r * world.cols + c] >= 0) continue;
    const spot = { u: c + .5, v: r + .5, d: Math.hypot(c + .5 - u, r + .5 - v) };
    (world.seaRoom(spot.u, spot.v) ? roomy : tight).push(spot);
  }
  const order = [...roomy.sort((a, b) => a.d - b.d), ...tight.sort((a, b) => a.d - b.d)];
  let first = null;
  for (const spot of order.slice(0, 8)) { const plan = world.route(from, spot); first ??= { goal: spot, plan }; if (plan.complete) return { goal: spot, plan }; }
  return first ?? { goal: { u, v }, plan: world.route(from, { u, v }) };
}
function routeTarget() {
  if (!target || craft() || state.fuel <= 0) return null;
  const way = approach(target.wreck.u, target.wreck.v);
  target.goal = way.goal; waypoints = way.plan.points; routeComplete = way.plan.complete; routePlan = waypoints.length ? routeCost(waypoints) : null; keys.clear(); preview = null;
  return way;
}
function clearTarget() { target = null; state.target = null; }
// The Shipwrecks picker hands over a wreck: the operation closes and the ship sets off for the datum, to be surveyed
// with V once she is within WRECK_KM of it. Returns false when the wreck cannot be placed on the chart.
function steamTo(wreck) {
  if (!world) return false;
  const known = wrecks.find(w => w.id === wreck?.id) ?? (Number.isFinite(wreck?.lon) && Number.isFinite(wreck?.lat)
    ? { id: String(wreck.id ?? '').slice(0, 40), ship: String(wreck.ship ?? 'the wreck').slice(0, 60), year: Number.isFinite(wreck.year) ? wreck.year : null, place: String(wreck.place ?? '').slice(0, 80), lon: wreck.lon, lat: wreck.lat, ...world.project(wreck.lon, wreck.lat) } : null);
  if (!known) return false;
  endActivity(); if ($('#mission-dialog').open) $('#mission-dialog').close();
  target = { wreck: known, goal: null }; state.target = known.id;
  const way = routeTarget(); save(); updateUI(); canvas.focus();
  if (!way) toast(`${known.ship} is the target · the passage begins once the ${state.fuel <= 0 ? 'tanks are filled' : 'craft is aboard'}.`, true);
  else if (!way.plan.complete) toast(`No sea route to the ${known.ship} datum from here · holding short. Sail round and press V within ${WRECK_KM} km of it.`, true);
  else toast(`Steaming to ${known.ship} · ${Math.round(routePlan.km)} km · ${m3(routePlan.fuel)} m³ · V surveys her within ${WRECK_KM} km of the datum.`, true);
  return true;
}
function targetLine() {
  if (!target) return '';
  const km = routePlan && waypoints.length ? routePlan.km : kmBetween(shipU(), shipV(), target.wreck.u, target.wreck.v);
  return `Steaming to ${target.wreck.ship} · ${Math.round(km)} km${routePlan && waypoints.length ? ` · ${m3(routePlan.fuel)} m³` : ''}`;
}
// Once the passage ends: on the datum, V surveys the wreck; short of it, the ship holds where the water ran out.
function checkTarget() {
  if (!target || craft() || waypoints.length || adrift) return;
  const km = kmBetween(shipU(), shipV(), target.wreck.u, target.wreck.v), wreck = target.wreck;
  if (km <= (wreck.reach ?? WRECK_KM)) { clearTarget(); save(); updateUI(); toast(`On the ${wreck.ship} datum · ${Math.round(km)} km off · press V to survey her.`, true); }
  else if (target.goal && kmBetween(shipU(), shipV(), target.goal.u, target.goal.v) < 1.5) { clearTarget(); save(); updateUI(); toast(`Holding ${Math.round(km)} km off the ${wreck.ship} datum · no water closer. V surveys within ${WRECK_KM} km.`, true); }
}
// A Mayday is placed on water with sea room SAR_RANGE_KM from the ship, in charted ice when the draw finds any,
// and always somewhere the ship can route to.
function placeMayday() {
  const su = shipU(), sv = shipV(); let routes = 0, fallback = null;
  for (let n = 0; n < 300 && routes < 8; n++) {
    const km = between(SAR_RANGE_KM), a = Math.random() * Math.PI * 2, u = Math.floor(su + Math.cos(a) * km / world.km) + .5, v = Math.floor(sv + Math.sin(a) * km / world.km) + .5;
    if (u < 1 || v < 1 || u >= world.cols - 1 || v >= world.rows - 1) continue;
    const i = Math.floor(v) * world.cols + Math.floor(u);
    if (world.sign[i] >= 0 || !world.seaRoom(u, v)) continue;
    if (!icy(i) && n < 200) { fallback ??= { u, v }; continue; }
    routes++; if (world.route({ u: su, v: sv }, { u, v }).complete) return { u, v };
  }
  return fallback && world.route({ u: su, v: sv }, fallback).complete ? fallback : null;
}
function raiseMayday() {
  const spot = placeMayday();
  if (!spot) { state.nextCall = state.played + 120; return; }
  const who = randomCasualty(), { lon, lat } = world.unproject(spot.u, spot.v);
  state.mayday = { ...who, lon, lat, x: spot.u / world.cols, y: spot.v / world.rows, at: state.played, until: state.played + SAR_LIFE_S };
  state.lastCall = state.played; state.nextCall = state.played + SAR_GAP_S + expo(SAR_SPREAD_S);
  const r = maydayRange(), where = `${Math.round(r.km)} km ${r.bearing}`;
  logEvent(state, { x: state.mayday.x, y: state.mayday.y, lon, lat, depth: world.depth(spot.u, spot.v) }, 'radio', `Mayday · ${who.name}, ${who.kind}, ${who.trouble} · ${where}`);
  save(); updateUI(); toast(`MAYDAY · ${who.name}, ${who.kind}, ${who.trouble} · ${where} · X search / 0 ice escort`, true, true);
}
function standDown(reason, quiet = false) {
  const m = state.mayday; if (!m) return;
  state.mayday = null;
  logEvent(state, { x: m.x, y: m.y, lon: m.lon, lat: m.lat, depth: world.depth(m.x * world.cols, m.y * world.rows) }, 'radio', `Radio · ${m.name} stood down · ${reason}`);
  save(); updateUI(); if (!quiet) toast(`Radio · ${m.name} stood down · ${reason}.`, true);
}
const minutesAgo = at => Math.round((state.played - at) / 60);
// A random alarm sounds when due; the operation opens itself ALARM_DELAY_MS later, once no other is open.
function soundAlarm(time) {
  const ids = Object.keys(ALARMS).filter(id => activities.some(a => a.id === id) && minigames[id]?.mount);
  if (!ids.length) { state.nextAlarm = Infinity; return; }
  const id = ids[Math.floor(Math.random() * ids.length)];
  pendingAlarm = { id, at: time + ALARM_DELAY_MS }; keys.clear();
  $('.map-panel')?.classList.remove('alarm'); void $('.map-panel')?.offsetWidth; $('.map-panel')?.classList.add('alarm');
  updateEvents(); toast(`ALARM · ${ALARMS[id]}`, true, true);
}
function fireAlarm() {
  const activity = activities.find(a => a.id === pendingAlarm.id); pendingAlarm = null;
  state.lastAlarm = state.played; state.nextAlarm = state.played + ALARM_GAP_S + expo(ALARM_SPREAD_S); save();
  if (activity) startActivity(activity, { alarm: true });
}
// The event tick, on the active-play clock: calls stand down and are raised, alarms sound and open, passages end.
function events(time) {
  if (state.mayday && state.played >= state.mayday.until) standDown('another responder reached her');
  if (!state.mayday && state.played >= state.nextCall) raiseMayday();
  if (pendingAlarm) { if (time >= pendingAlarm.at) fireAlarm(); }
  else if (state.played >= state.nextAlarm) soundAlarm(time);
  checkTarget();
}
// The ship card in plain words: the passage, the radio, the alarms, the ice and the nearest wreck.
function updateEvents() {
  if (!world) return;
  const lines = [];
  if (target) lines.push(['target', targetLine()]);
  else { const near = nearestWreck(); if (near) lines.push(['wreck', near.wreck === wreckHere() ? `On the ${near.wreck.ship} datum · ${Math.round(near.km)} km ${near.bearing} · V surveys her` : `Nearest wreck datum · ${near.wreck.ship}${near.wreck.year ? ` (${near.wreck.year})` : ''} ${Math.round(near.km)} km ${near.bearing} · V surveys within ${WRECK_KM} km`]); }
  if (state.mayday) { const r = maydayRange(), m = state.mayday; lines.push(['mayday', `Mayday · ${m.name}, ${m.kind}, ${m.trouble} · ${Math.round(r.km)} km ${r.bearing} · ${Math.max(1, Math.ceil((m.until - state.played) / 60))} min before she is stood down · X search / 0 ice escort`]); }
  else lines.push(['radio', 'Radio · no call · listening on channel 16']);
  if (pendingAlarm) lines.push(['alarm', `ALARM · ${ALARMS[pendingAlarm.id]} · opening now`]);
  else lines.push(['quiet', state.lastAlarm === null ? 'Alarms · none this voyage' : `Alarms · last one ${minutesAgo(state.lastAlarm) ? `${minutesAgo(state.lastAlarm)} min ago` : 'just now'}`]);
  const u = pilotU(), v = pilotV(), who = helicopter ? 'the helicopter' : 'the ship';
  const ice = nearIce(u, v) ? null : nearestIce(u, v);
  lines.push(['ice', nearIce(u, v) ? `Charted ice within ${ICE_NEAR_KM} km of ${who}` : ice ? `Nearest charted ice ${Math.round(ice.km)} km ${ice.bearing} of ${who}` : `No charted ice within ${ICE_SEARCH_CELLS * world.km} km`]);
  const list = $('#events'); list.replaceChildren();
  for (const [kind, text] of lines) { const row = el('div', kind); row.textContent = text; list.append(row); }
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
function selectSidebar(name, focus = false) {
  if (name === 'fleet' && publicMirror) return;
  for (const panel of document.querySelectorAll('[data-sidebar-panel]')) panel.hidden = panel.dataset.sidebarPanel !== name;
  for (const button of document.querySelectorAll('[data-sidebar-tab]')) {
    const selected = button.dataset.sidebarTab === name;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  $('#stores-toggle').setAttribute('aria-expanded', String(name === 'stores'));
}
for (const button of document.querySelectorAll('[data-sidebar-tab]')) {
  button.onclick = () => selectSidebar(button.dataset.sidebarTab);
  button.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const tabs = [...document.querySelectorAll('[data-sidebar-tab]')].filter(b => !b.hidden), index = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectSidebar(tabs[next].dataset.sidebarTab, true);
  };
}
function toggleStores(open = !!$('#stores').hidden) { selectSidebar(open ? 'stores' : 'nearby'); }
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
    name.dataset.i18nSkip = '';
    name.textContent = entry.title;
    const where = Number.isFinite(entry.lon) && Number.isFinite(entry.lat) ? formatPosition(entry.lon, entry.lat) : entry.x === null ? 'earlier chart' : `Chart ${Math.round(entry.x * 100)} / ${Math.round(entry.y * 100)}`;
    const depth = Number.isFinite(entry.depth) ? ` · ${Math.round(entry.depth)} m` : '';
    const tally = entry.lost ? `−${entry.lost} points` : entry.activity === 'faceoff' && !entry.points ? 'no points lost' : { grounding: 'no points to lose', bunker: 'no charge', tow: 'no points lost', radio: 'on the radio' }[entry.activity] ?? `+${entry.points}`;
    meta.textContent = `${entry.date ? new Date(entry.date).toLocaleDateString() + ' · ' : ''}${where}${depth} · ${tally}`;
    item.append(name, meta); if (['grounding', 'bunker', 'tow', 'radio'].includes(entry.activity)) item.className = entry.activity; $('#discovery-log').append(item);
  }
  updateActivities(); updateStores(); updateFuel(); updateEvents();
}
const activityButtons = new Map();
const plannedCardGames = ['Euchre', 'Gin Rummy', 'Spades', 'Poker', 'Solitaire'].map(title => ({
  id: title.toLowerCase().replaceAll(' ', '-'), title, description: 'Coming soon', key: '', upcoming: true,
}));
const HANDS = [
  { id: 'science', title: 'Ship & science', suit: '♣', cards: ['ctd', 'ice', 'net', 'seep', 'contaminants', 'plan'] },
  { id: 'arctic', title: 'Ice & exploration', suit: '♠', cards: ['patrol', 'wildlife', 'oldice', 'cliceify', 'heli', 'raft'] },
  { id: 'crew', title: 'Crew & adventure', suit: '♥', cards: ['sar', 'escort', 'wrecks', 'rivals', 'flood', 'neptune', 'inuktitut'] },
  { id: 'cards', title: 'Card games', suit: '♦', cards: ['hearts', 'cribbage', ...plannedCardGames.map(game => game.id)] },
];
for (const hand of HANDS) {
  const section = document.createElement('section'), heading = document.createElement('h3'), row = document.createElement('div');
  section.className = `activity-suit ${hand.id}`; heading.id = `hand-${hand.id}`;
  heading.textContent = hand.title;
  if (hand.id === 'cards') heading.dataset.i18n = 'cards.heading';
  section.setAttribute('aria-labelledby', heading.id);
  row.className = 'activity-hand'; section.append(heading, row); $('#activities').append(section);
  hand.cards.forEach((id, index) => {
    const activity = activities.find(a => a.id === id) || plannedCardGames.find(a => a.id === id);
    const button = document.createElement('button'), corner = document.createElement('span'), key = document.createElement('kbd'), suit = document.createElement('span'), art = document.createElement('canvas'), copy = document.createElement('span'), name = document.createElement('b'), description = document.createElement('small');
    button.type = 'button'; button.className = 'activity'; button.dataset.activity = id;
    if (activity.upcoming) button.classList.add('upcoming');
    if (hand.id === 'cards') art.dataset.cardGame = '';
    button.style.setProperty('--tilt', `${(index - (hand.cards.length - 1) / 2) * 1.5}deg`);
    button.style.setProperty('--lift', `${Math.abs(index - (hand.cards.length - 1) / 2) * 3}px`);
    corner.className = 'card-corner'; key.textContent = activity.key.toUpperCase(); suit.textContent = hand.suit; suit.setAttribute('aria-hidden', 'true');
    corner.append(key, suit); art.width = art.height = 96; art.className = 'card-art'; art.setAttribute('aria-hidden', 'true');
    copy.className = 'card-copy'; name.textContent = activity.id === 'ctd' ? t('ctd.activity') : activity.title;
    description.textContent = activity.id === 'ctd' ? t('ctd.description') : activity.description;
    if (activity.id === 'ctd') { name.dataset.i18n = 'ctd.activity'; name.dataset.i18nLocale = ''; description.dataset.i18nLocale = ''; }
    if (hand.id === 'cards') {
      name.textContent = id === 'hearts' ? 'Hearts' : activity.title;
      name.dataset.i18n = `cards.${id}`;
      if (activity.upcoming) description.dataset.i18n = 'cards.soon';
    }
    copy.append(name, description); button.append(corner, art, copy); button.onclick = () => startActivity(activity); row.append(button);
    activityButtons.set(activity, { button, description, art });
  });
}
function updateActivities() {
  for (const [activity, { description }] of activityButtons) {
    description.textContent = activity.upcoming ? t('cards.soon') : activity.id === 'ctd' ? t('ctd.description') : describe(activity);
  }
}
window.addEventListener('uw:localechange', updateActivities);
function endActivity() {
  recorder?.cancel(); recorder = null;
  const dispose = cleanup; cleanup = null;
  try { if (typeof dispose === 'function') dispose(); } catch (error) { console.error('Activity cleanup failed', error); }
  $('#minigame').replaceChildren();
}
function startActivity(activity, extra = {}) {
  if ($('#mission-dialog').open || page !== 'game') return;
  if (!world) { toast('The chart is still unrolling. One moment.'); return; }
  const game = minigames[activity.id]; if (!game?.mount) { toast('This operation is unavailable.'); return; }
  endActivity(); waypoints = []; keys.clear(); returnFocus = document.activeElement;
  const title = $('#mission-title');
  delete title.dataset.i18n; delete title.dataset.i18nLocale; title.removeAttribute('lang');
  const activityTitle = document.createElement('span');
  if (activity.id === 'ctd') { activityTitle.dataset.i18n = 'ctd.activity'; activityTitle.dataset.i18nLocale = ''; activityTitle.lang = globalThis.UWI18n?.locale || 'en'; }
  activityTitle.textContent = activity.id === 'ctd' ? t('ctd.activity') : activity.title;
  title.replaceChildren(activityTitle);
  if (extra.duel) {
    const opponent = document.createElement('span'); opponent.dataset.i18nSkip = ''; opponent.textContent = extra.duel.opponent;
    title.append(document.createTextNode(' · face-off with '), opponent);
  }
  const location = here(['patrol', 'raft'].includes(activity.id));
  const rescueCall = ['sar', 'escort'].includes(activity.id) ? state.mayday : null;
  recorder = operationRecorder(state, activity, location, entry => {
    const rescued = rescueCall && state.mayday === rescueCall && (activity.id === 'sar' || entry.detail?.won === true) ? rescueCall.name : '';
    if (rescued) state.mayday = null;
    save(); updateUI(); toast(`${entry.title} · +${entry.points} science points · added to chart${rescued ? ` · ${rescued} safe, call cleared` : ''}`); postScore(activity, entry);
    multiplayer.scored(activity.id, entry.points, extra.duel?.id);
  });
  const session = recorder;
  $('#mission-dialog').showModal();
  // showModal focuses the first focusable control, the close button; Enter or Space would then close the
  // operation. Focus the game root instead so the keys reach the minigame's own handlers.
  $('#minigame').focus();
  // The fast winch lets a CTD station bank more casts: 25% more points for that operation.
  const bonus = activity.id === 'ctd' && state.upgrades.winch ? 1.25 : 1;
  // Shipwrecks learns the wreck under the ship and how to steam to another; SAR learns the casualty; alarms say so.
  const wreck = activity.id === 'wrecks' ? wreckHere() : null, mayday = rescueCall || (['sar', 'escort'].includes(activity.id) ? randomCasualty() : null);
  const expedition = { ...location, score: state.score, operations: state.operations, chartPercent: chartPercent(state, sea), fuel: state.fuel, upgrades: { ...state.upgrades }, steamTo, ...extra };
  if (wreck) expedition.wreck = wreck.id;
  if (mayday) expedition.sar = { name: mayday.name, kind: mayday.kind, trouble: mayday.trouble, lon: mayday.lon, lat: mayday.lat, distanceKm: rescueCall ? Math.round(maydayRange().km * 10) / 10 : null };
  try { cleanup = game.mount($('#minigame'), { complete: (points, detail) => { if ($('#mission-dialog').open) session.complete(Number.isFinite(points) ? points * bonus : points, detail); }, close: () => { if (recorder === session) { endActivity(); $('#mission-dialog').close(); } }, expedition }); }
  catch (error) { endActivity(); $('#mission-dialog').close(); toast('Could not open this operation. Please try again.'); console.error(error); }
}
$('#close-mission').onclick = () => { endActivity(); $('#mission-dialog').close(); };
// Only a pointer closes the operation with the × button; Enter and Space belong to the minigame (Escape still closes).
$('#close-mission').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
$('#mission-dialog').addEventListener('cancel', () => endActivity());
$('#mission-dialog').addEventListener('close', () => { if ($('#mission-dialog').open) return; endActivity(); multiplayer.closed(); if (returnFocus?.isConnected) returnFocus.focus(); else canvas.focus(); });
$('#reset').onclick = () => { if (confirm('Start a fresh voyage and clear your chart, log, science points and stores? Crew ideas stay on the server.')) { endActivity(); if (helicopter) toggleHelicopter(); if (zodiac) toggleZodiac(); auv = null; auvArmed = false; adrift = null; routePlan = null; preview = null; $('#auv').setAttribute('aria-pressed', 'false'); state = newVoyage(0, world?.start); restoreEvents(state, null); target = null; pendingAlarm = null; iceCache = null; try { localStorage.removeItem('amundsen-expedition'); } catch {} known = new Set(); mapped = new Set(); rebuildSurface(); chartPosition(state, known); waypoints = []; keys.clear(); save(); updateUI(); buildFog(); } };

// The view follows the active vehicle. Zoom is chart pixels per grid cell, set from a scale in pixels per kilometre so
// the chart shows the same stretch of sea whatever the grid's cell size: ZOOM_PX_PER_KM to begin with
// (PHONE_ZOOM_PX_PER_KM on a narrow screen), between MIN_ZOOM_PX_PER_KM and MAX_ZOOM_PX_PER_KM, and never so far out
// that the view leaves the world. Craft are drawn at two screen pixels per sprite pixel from SPRITE_2X_PX_PER_KM and
// the log's marks are all titled from LABEL_PX_PER_KM.
const ZOOM_PX_PER_KM = 1.1, PHONE_ZOOM_PX_PER_KM = .8, MIN_ZOOM_PX_PER_KM = 1 / 3, MAX_ZOOM_PX_PER_KM = 4, SPRITE_2X_PX_PER_KM = 2, LABEL_PX_PER_KM = 1.6;
const defaultZoom = () => (width < 520 ? PHONE_ZOOM_PX_PER_KM : ZOOM_PX_PER_KM) * world.km;
const minZoom = () => world ? Math.max(MIN_ZOOM_PX_PER_KM * world.km, width / world.cols, height / world.rows) : 1;
function view() {
  const z = Math.max(minZoom(), zoom ?? defaultZoom()), w = width / z, h = height / z;
  const u = Math.max(w / 2, Math.min(world.cols - w / 2, pilotU())), v = Math.max(h / 2, Math.min(world.rows - h / 2, pilotV()));
  return { z, u0: u - w / 2, v0: v - h / 2 };
}
function setZoom(next) { zoom = Math.max(minZoom(), Math.min(MAX_ZOOM_PX_PER_KM * world.km, next)); }
const zoomBy = factor => { if (world) setZoom(view().z * factor); };
$('#zoom-in').onclick = () => zoomBy(1.4); $('#zoom-out').onclick = () => zoomBy(1 / 1.4);
function resize() { const r = canvas.getBoundingClientRect(); if (!r.width) return; width = r.width; height = r.height; dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
new ResizeObserver(resize).observe(canvas);
function fitBridge() {
  const panel = $('.map-panel'); if ($('#game-page').hidden) return;
  const top = panel.getBoundingClientRect().top + window.scrollY;
  document.documentElement.style.setProperty('--toast-top', `${document.querySelector('body > header').getBoundingClientRect().height + 10}px`);
  const available = Math.max(360, window.innerHeight - top - 16), phone = window.matchMedia('(max-width:740px)').matches;
  const mapHeight = phone ? Math.max(165, Math.round(available * .48)) : Math.min(820, available);
  $('.expedition').style.setProperty('--map-height', `${mapHeight}px`);
  $('.expedition').style.setProperty('--sidebar-height', `${phone ? available - mapHeight - 10 : mapHeight}px`);
}
window.addEventListener('resize', fitBridge);
const bridgeObserver = new ResizeObserver(fitBridge);
bridgeObserver.observe(document.querySelector('body > header')); bridgeObserver.observe($('#game-intro'));
setTimeout(() => { $('#game-intro').hidden = true; fitBridge(); }, 4000);
fitBridge();

const miniRect = () => { const w = width < 520 ? 96 : 156, h = Math.round(w * (world ? world.rows / world.cols : .7)); return { x: width - w - 12, y: 12, w, h }; };
function sailTo(u, v) {
  if (!world) return;
  if (helicopter?.rtb) { toast('Bingo fuel · the helicopter is returning to the ship.'); return; }
  if (craft()) { waypoints = [{ u: Math.max(.5, Math.min(world.cols - .5, u)), v: Math.max(.5, Math.min(world.rows - .5, v)) }]; routeComplete = true; return; }
  if (state.fuel <= 0) { toast(`Tanks dry · the ship drifts. U bunkers if fuel is within ${BUNKER_KM} km.`); return; }
  if (target) { clearTarget(); updateEvents(); }
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
  if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.4); return; }
  if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.4); return; }
  if (k === '2') { e.preventDefault(); if (!e.repeat) toggleLegend(); return; }
  if (k === '4') { e.preventDefault(); if (!e.repeat) { selectSidebar('fleet'); multiplayer.toggleFleet(); } return; }
  if (k === '5') { e.preventDefault(); if (!e.repeat) multiplayer.nextShip(); return; }
  if (k === '6') { e.preventDefault(); if (!e.repeat) multiplayer.faceOff(); return; }
  if (k === '7') { e.preventDefault(); if (!e.repeat) multiplayer.snowball(); return; }
  if (k === '8') { e.preventDefault(); if (!e.repeat) multiplayer.decline(); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k)) { e.preventDefault(); if (helicopter?.rtb) return; keys.add(k); waypoints = []; routePlan = null; if (target && !craft()) { clearTarget(); updateEvents(); } }
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
// The chart keeps the seabed hidden until it is mapped; cells are shown as the swath adds them.
function clearSeabed(cells) { chart?.reveal(cells); }
function rebuildSurface() { if (chart) { chart.reset(); chart.reveal(mapped); } }
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
// Craft are pixel sprites; `px` is screen pixels per sprite pixel, 1 on the open chart and 2 zoomed close in.
import { drawShip as shipSprite, drawHelicopter as helicopterSprite, drawZodiac as zodiacSprite, drawAUV as auvSprite, drawTanker as tankerSprite } from './sprites.js';
function drawShip(x, y, px) { shipSprite(ctx, x, y, angle, px); }
function label(text, x, y, colour = '#1b2a2c', font = 'bold 11px sans-serif') {
  text = localize(text);
  ctx.font = font; ctx.lineWidth = 3; ctx.strokeStyle = '#ddcca7cc'; ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
}
// A fuel port's berth: a teal drop, gold with a ring when the ship can bunker there.
const fuelDrop = (c, near) => { c.fillStyle = near ? '#f6c75f' : '#116b6b'; c.strokeStyle = '#1b2a2c'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -9); c.bezierCurveTo(7, -1, 7, 5, 0, 6); c.bezierCurveTo(-7, 5, -7, -1, 0, -9); c.closePath(); c.fill(); c.stroke(); };
function drawFuel(x, y, near, text, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); fuelDrop(ctx, near);
  if (near) { ctx.strokeStyle = '#f6c75f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); }
  ctx.restore();
  if (text) label(text, x + 10, y + 14, '#0f4a4a', 'italic 11px Georgia');
}
function drawTanker(x, y, near, text) {
  tankerSprite(ctx, x, y, 0, 1);
  ctx.save(); ctx.translate(x, y);
  if (near) { ctx.strokeStyle = '#f6c75f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.stroke(); }
  ctx.restore();
  label(text, x + 30, y + 4, '#7a2f23');
}
// Chart glyphs, one per logged activity, about 10 px across: one fill colour and the chart ink.
const INK = '#2b1d10', CREAM = '#f6f1e4';
const GLYPHS = {
  escort(c) { GLYPHS.sar(c); },
  inuktitut(c) { c.fillStyle = '#f6f1e4'; c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -4); c.quadraticCurveTo(-3, -7, -7, -5); c.lineTo(-7, 5); c.quadraticCurveTo(-3, 3, 0, 6); c.quadraticCurveTo(3, 3, 7, 5); c.lineTo(7, -5); c.quadraticCurveTo(3, -7, 0, -4); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(0, -4); c.lineTo(0, 6); c.stroke(); },
  ctd(c) { c.fillStyle = '#c9ced2'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 5.5, 0, 7); c.fill(); c.stroke(); c.fillStyle = INK; for (let n = 0; n < 6; n++) { c.beginPath(); c.arc(Math.cos(n * Math.PI / 3) * 3.2, Math.sin(n * Math.PI / 3) * 3.2, 1.2, 0, 7); c.fill(); } },
  ice(c) { c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -7); c.lineTo(0, 7); c.stroke(); c.strokeStyle = '#7cc4ea'; c.lineWidth = 1.6; c.beginPath(); for (let y = -4; y <= 4; y += 3) { c.moveTo(-3.5, y); c.lineTo(3.5, y + 1.6); } c.stroke(); },
  net(c) { c.fillStyle = '#e2cf93'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.moveTo(-6, -5); c.lineTo(6, -5); c.lineTo(0, 6); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(-3, -5); c.lineTo(2, 2.5); c.moveTo(3, -5); c.lineTo(-2, 2.5); c.moveTo(-4.5, -1.5); c.lineTo(4.5, -1.5); c.stroke(); },
  sar(c) { c.lineWidth = 3.5; c.strokeStyle = '#e0392b'; c.beginPath(); c.arc(0, 0, 4.5, 0, 7); c.stroke(); c.strokeStyle = CREAM; for (let n = 0; n < 4; n++) { c.beginPath(); c.arc(0, 0, 4.5, n * Math.PI / 2 + .4, n * Math.PI / 2 + 1.2); c.stroke(); } c.strokeStyle = INK; c.lineWidth = .8; c.beginPath(); c.arc(0, 0, 6.3, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 2.7, 0, 7); c.stroke(); },
  flood(c) { c.fillStyle = '#3f8fd1'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -7); c.bezierCurveTo(5.5, -1, 5.5, 5.5, 0, 6.5); c.bezierCurveTo(-5.5, 5.5, -5.5, -1, 0, -7); c.closePath(); c.fill(); c.stroke(); },
  contaminants(c) { c.fillStyle = '#e7b254'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.arc(0, 1, 6, Math.PI, 0); c.lineTo(6, 4.5); c.lineTo(-6, 4.5); c.closePath(); c.fill(); c.stroke(); c.fillStyle = INK; c.fillRect(-4, -1, 8, 3); },
  neptune(c) { c.strokeStyle = '#116b6b'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 7.5); c.lineTo(0, -7.5); c.moveTo(-4.5, -1); c.lineTo(-4.5, -6.5); c.moveTo(4.5, -1); c.lineTo(4.5, -6.5); c.moveTo(-4.5, -1); c.quadraticCurveTo(0, 2.5, 4.5, -1); c.stroke(); c.fillStyle = '#f6c75f'; c.beginPath(); c.arc(0, 4, 1.7, 0, 7); c.fill(); },
  wrecks(c) { const anchor = () => { c.beginPath(); c.arc(0, -5.5, 1.6, 0, 7); c.moveTo(0, -3.9); c.lineTo(0, 7); c.moveTo(-4, -1); c.lineTo(4, -1); c.moveTo(-6, 2.5); c.quadraticCurveTo(0, 9.5, 6, 2.5); c.stroke(); }; c.strokeStyle = INK; c.lineWidth = 3; anchor(); c.strokeStyle = '#f0ba70'; c.lineWidth = 1.2; anchor(); },
  patrol(c) { c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-7, -7); c.lineTo(7, 7); c.moveTo(7, -7); c.lineTo(-7, 7); c.stroke(); c.fillStyle = '#f6c75f'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 3.2, 0, 7); c.fill(); c.stroke(); },
  wildlife(c) { c.fillStyle = '#6f9a5c'; c.strokeStyle = INK; c.lineWidth = 1; c.fillRect(-2, -4, 4, 3); c.strokeRect(-2, -4, 4, 3); for (const x of [-3.6, 3.6]) { c.beginPath(); c.arc(x, 1.5, 3.6, 0, 7); c.fill(); c.stroke(); } },
  faceoff(c) { c.strokeStyle = INK; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-5, 7); c.lineTo(-5, -7); c.moveTo(5, 7); c.lineTo(5, -7); c.stroke(); c.lineWidth = 1; c.fillStyle = '#c8402e'; c.beginPath(); c.moveTo(-5, -7); c.lineTo(2, -4.5); c.lineTo(-5, -2); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#2d6fc4'; c.beginPath(); c.moveTo(5, -7); c.lineTo(-2, -4.5); c.lineTo(5, -2); c.closePath(); c.fill(); c.stroke(); },
  rivals(c) { c.fillStyle = '#9b6bb3'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.moveTo(-2, -7); c.lineTo(2, -7); c.lineTo(2, -2); c.lineTo(6.5, 6.5); c.lineTo(-6.5, 6.5); c.lineTo(-2, -2); c.closePath(); c.fill(); c.stroke(); },
  raft(c) { c.fillStyle = '#c9a56b'; c.strokeStyle = INK; c.lineWidth = 1; c.fillRect(-2.5, -7, 5, 14); c.strokeRect(-2.5, -7, 5, 14); c.fillStyle = INK; c.fillRect(-2.5, -3, 5, 1.5); c.fillRect(-2.5, 2, 5, 1.5); },
  plan(c) { c.fillStyle = CREAM; c.strokeStyle = INK; c.lineWidth = 1; c.fillRect(-5, -6, 10, 12.5); c.strokeRect(-5, -6, 10, 12.5); c.fillStyle = INK; c.fillRect(-2, -7.5, 4, 2.5); c.strokeStyle = '#116b6b'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-3, .5); c.lineTo(-1, 3); c.lineTo(3.2, -2.5); c.stroke(); },
  oldice(c) { c.fillStyle = '#eef6f8'; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); for (let n = 0; n < 6; n++) { const a = n * Math.PI / 3 + Math.PI / 6; c[n ? 'lineTo' : 'moveTo'](Math.cos(a) * 6.8, Math.sin(a) * 6.8); } c.closePath(); c.fill(); c.stroke(); c.strokeStyle = '#4a8fb8'; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.stroke(); },
  seep(c) { c.fillStyle = '#9fd0c0'; c.strokeStyle = INK; c.lineWidth = 1; for (const [x, y, r] of [[2.5, 4.5, 1.6], [-2.5, .5, 2.3], [2, -4.5, 3]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); } },
  cliceify(c) { c.fillStyle = '#5b6b70'; c.strokeStyle = INK; c.lineWidth = 1; c.fillRect(-7, -4, 14, 9.5); c.strokeRect(-7, -4, 14, 9.5); c.fillRect(-3, -6.5, 6, 2.5); c.fillStyle = CREAM; c.beginPath(); c.arc(0, .8, 3, 0, 7); c.fill(); c.stroke(); },
  heli(c) { c.fillStyle = '#f0a35b'; c.strokeStyle = INK; c.lineWidth = 1; c.fillRect(-5.5, -5.5, 11, 11); c.strokeRect(-5.5, -5.5, 11, 11); c.fillStyle = INK; c.fillRect(-5.5, -1, 11, 2); c.fillRect(-1, -5.5, 2, 11); },
  radio(c) { c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 7.5); c.lineTo(0, -2); c.stroke(); c.fillStyle = INK; c.beginPath(); c.arc(0, -2, 1.5, 0, 7); c.fill(); c.strokeStyle = '#85683b'; c.lineWidth = 1.4; for (const r of [3.5, 6.5]) { c.beginPath(); c.arc(0, -2, r, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); } },
};
const drawCross = (c, colour) => { c.strokeStyle = colour; c.lineWidth = 2; c.beginPath(); c.moveTo(-5, -5); c.lineTo(5, 5); c.moveTo(5, -5); c.lineTo(-5, 5); c.stroke(); };
// An entry with no glyph of its own keeps the diamond.
function drawMark(c, activity, x, y, scale = 1) {
  c.save(); c.translate(x, y); c.scale(scale, scale); c.lineJoin = 'round'; c.lineCap = 'round';
  if (activity === 'bunker') fuelDrop(c, false);
  else if (activity === 'grounding' || activity === 'tow') drawCross(c, activity === 'tow' ? '#d9822b' : '#b3352b');
  else if (GLYPHS[activity]) GLYPHS[activity](c);
  else { c.fillStyle = '#f0ba70'; c.strokeStyle = '#523d25'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -6); c.lineTo(5, 0); c.lineTo(0, 6); c.lineTo(-5, 0); c.closePath(); c.fill(); c.stroke(); }
  c.restore();
}
// A wreck datum is the chart symbol for a wreck, ringed in gold when the ship can survey it from here.
function drawWreckDatum(c, near) {
  c.lineJoin = 'round'; c.strokeStyle = INK; c.lineWidth = 1.5; c.fillStyle = '#8a3b2b';
  c.beginPath(); c.moveTo(-6.5, 0); c.quadraticCurveTo(0, 7.5, 6.5, 0); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); for (const [x, h] of [[-3, 4], [0, 6.5], [3, 4]]) { c.moveTo(x, 0); c.lineTo(x, -h); } c.stroke();
  if (near) { c.strokeStyle = '#f6c75f'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 14, 0, 7); c.stroke(); }
}
// The casualty: a red mark inside a ring that swells and fades with `pulse` (0–1).
function drawMayday(c, pulse) {
  c.strokeStyle = `rgba(224,57,43,${(.95 - pulse * .8).toFixed(2)})`; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 6 + pulse * 12, 0, 7); c.stroke();
  c.fillStyle = '#e0392b'; c.strokeStyle = CREAM; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 4.5, 0, 7); c.fill(); c.stroke();
}
const drawTargetRing = (c, r) => { c.setLineDash([5, 4]); for (const [colour, w] of [[INK, 4], ['#f6c75f', 2]]) { c.strokeStyle = colour; c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke(); } c.setLineDash([]); c.beginPath(); c.moveTo(-4, 0); c.lineTo(4, 0); c.moveTo(0, -4); c.lineTo(0, 4); c.stroke(); };
// The legend lists every glyph the chart can carry; 2 or the button in the chart's bottom bar shows it.
const LEGEND = [...activities.map(a => ({ id: a.id, name: a.title })), { id: 'radio', name: 'Radio call' }, { id: 'faceoff', name: 'Face-off' }, { id: 'bunker', name: 'Bunkered' }, { id: 'grounding', name: 'Ran aground' }, { id: 'tow', name: 'Towed' }, { id: 'datum', name: 'Wreck datum' }, { id: 'mayday', name: 'Mayday' }, { id: 'target', name: 'Steaming to' }];
function buildLegend() {
  for (const item of LEGEND) {
    const row = el('span', 'legend-item'), swatch = document.createElement('canvas'); swatch.width = swatch.height = 44;
    const c = swatch.getContext('2d'); c.scale(2, 2); c.translate(11, 11);
    if (item.id === 'datum') drawWreckDatum(c, false); else if (item.id === 'mayday') drawMayday(c, .25); else if (item.id === 'target') drawTargetRing(c, 8); else drawMark(c, item.id, 0, 0);
    row.append(swatch, el('span', '', localize(item.name))); $('#legend').append(row);
  }
}
function toggleLegend(open = !!$('#legend').hidden) { $('#legend').hidden = !open; $('#legend-toggle').setAttribute('aria-expanded', String(open)); }
$('#legend-toggle').onclick = () => toggleLegend();
function drawLoading() {
  ctx.fillStyle = '#ddcca7'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#6a5d42'; ctx.font = 'italic 16px Georgia'; ctx.textAlign = 'center';
  ctx.fillText(localize(world ? 'Drawing the chart…' : 'Unrolling the chart…'), width / 2, height / 2 - 8);
  ctx.fillStyle = '#9c7a3f'; ctx.fillRect(width / 2 - 90, height / 2 + 8, 180 * progress, 4); ctx.textAlign = 'left';
}
function draw() {
  if (!chart) { drawLoading(); return; }
  const { z, u0, v0 } = view(), toX = u => (u - u0) * z, toY = v => (v - v0) * z;
  ctx.save(); if (shake > 0) ctx.translate((Math.random() - .5) * 8 * shake, (Math.random() - .5) * 8 * shake);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  chart.draw(ctx, { z, u0, v0, width, height, dpr }, placeholder);
  ctx.drawImage(fog, u0 / world.cols * fog.width, v0 / world.rows * fog.height, width / z / world.cols * fog.width, height / z / world.rows * fog.height, 0, 0, width, height);
  drawGraticule(z, u0, v0);
  ctx.strokeStyle = '#e8c589'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); state.route.forEach((p, i) => i ? ctx.lineTo(toX(p.x * world.cols), toY(p.y * world.rows)) : ctx.moveTo(toX(p.x * world.cols), toY(p.y * world.rows))); ctx.stroke(); ctx.setLineDash([]);
  // Every logged entry with a place gets its activity's glyph; the titles show under the mouse and at high zoom.
  const marks = [];
  for (const d of state.discoveries) {
    if (d.x === null) continue;
    const x = toX(d.x * world.cols), y = toY(d.y * world.rows); if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
    marks.push({ x, y, text: d.title });
    drawMark(ctx, d.activity, x, y, d.activity === 'bunker' ? .6 : 1);
  }
  const onDatum = wreckHere();
  for (const wreck of wrecks) {
    const x = toX(wreck.u), y = toY(wreck.v); if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
    marks.push({ x, y, text: `${wreck.ship}${wreck.year ? ` · ${wreck.year}` : ''} · wreck datum` });
    ctx.save(); ctx.translate(x, y); drawWreckDatum(ctx, wreck === onDatum); ctx.restore();
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
  if (target) {
    const x = toX(target.wreck.u), y = toY(target.wreck.v);
    ctx.save(); ctx.translate(x, y); drawTargetRing(ctx, Math.max(10, WRECK_KM / world.km * z)); ctx.restore();
    label(targetLine(), x + 12, y - 10, '#7a5a1c', 'bold 11px sans-serif');
  }
  if (state.mayday) {
    const x = toX(maydayU()), y = toY(maydayV()), r = maydayRange(), pulse = (Math.sin(performance.now() / 250) + 1) / 2;
    ctx.strokeStyle = '#e0392b90'; ctx.setLineDash([2, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(toX(su), toY(sv)); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.save(); ctx.translate(x, y); drawMayday(ctx, pulse); ctx.restore();
    label(`MAYDAY · ${state.mayday.name} · ${Math.round(r.km)} km ${r.bearing}`, x + 12, y - 10, '#8c1d12', 'bold 11px sans-serif');
  }
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
  const px = z / world.km >= SPRITE_2X_PX_PER_KM ? 2 : 1;
  if (auv) {
    const x = toX(auv.u), y = toY(auv.v), goal = auv.home ? auv.dock : auv.target;
    if (!auv.waiting) { ctx.strokeStyle = '#d9e26bb0'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(toX(goal.u), toY(goal.v)); ctx.stroke(); ctx.setLineDash([]); }
    auvSprite(ctx, x, y, auv.waiting ? 0 : Math.atan2(goal.v - auv.v, goal.u - auv.u), px + 1);
    label(auv.waiting ? 'AUV · surfaced, waiting' : `AUV · ${auv.cells} cells`, x + 12, y - 8, '#25290c');
  }
  if (zodiac) { ctx.strokeStyle = '#f0a35b90'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(toX(su), toY(sv)); ctx.lineTo(toX(zodiac.u), toY(zodiac.v)); ctx.stroke(); ctx.setLineDash([]); }
  drawShip(toX(su), toY(sv), px);
  multiplayer.draw(ctx, { toX, toY, px, width, height });
  if (zodiac) {
    const x = toX(zodiac.u), y = toY(zodiac.v);
    zodiacSprite(ctx, x, y, flightAngle, px + 1);
    label('ZODIAC', x + 14, y - 12, '#2b1a0c', 'bold 12px sans-serif');
  }
  if (helicopter) {
    const x = toX(pilotU()), y = toY(pilotV());
    helicopterSprite(ctx, x, y, flightAngle, px + 1, last);
    ctx.fillStyle = '#f6c75f'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('HELICOPTER', x + 15, y - 15);
  }
  hovered = pointer ? marks.reduce((best, m) => { const d = Math.hypot(m.x - pointer.px, m.y - pointer.py); return d <= 12 && (!best || d < best.d) ? { ...m, d } : best; }, null) : null;
  if (z / world.km >= LABEL_PX_PER_KM) for (const m of marks) if (m !== hovered) label(m.text, m.x + 8, m.y - 7, '#1b2a2c', 'italic 11px Georgia');
  if (hovered) label(hovered.text, hovered.x + 10, hovered.y - 9, '#1b2a2c', 'bold 12px sans-serif');
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
  multiplayer.drawMini(ctx, m);
  if (auv) { ctx.fillStyle = '#d9e26b'; ctx.fillRect(m.x + auv.u / world.cols * m.w - 2, m.y + auv.v / world.rows * m.h - 2, 4, 4); }
  if (state.mayday) { ctx.fillStyle = '#e0392b'; ctx.beginPath(); ctx.arc(m.x + state.mayday.x * m.w, m.y + state.mayday.y * m.h, 2.5, 0, 7); ctx.fill(); }
  if (target) { ctx.strokeStyle = '#f6c75f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(m.x + target.wreck.u / world.cols * m.w, m.y + target.wreck.v / world.rows * m.h, 3, 0, 7); ctx.stroke(); }
}
function loop(time) {
  const dt = last ? Math.min((time - last) / 1000, .04) : 0; last = time;
  if (page === 'game' && !document.hidden && !$('#mission-dialog').open && world && chart) {
    let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    let len = 0;
    if (time < holdUntil) { dx = dy = 0; keys.clear(); }
    const z = view().z, ice = world.ice(shipU(), shipV());
    state.played += dt; drift(time, dt); stepAuv(dt);
    // Cells per second: SHIP_KM_PER_S at the starting zoom, a little slower when zoomed in, slowed further by the pack
    // (less with an ice-strengthened hull). The helicopter flies at 2.5 times that, the zodiac at 1.6.
    const speed = SHIP_KM_PER_S / world.km * Math.sqrt(ZOOM_PX_PER_KM * world.km / z) * (helicopter ? 2.5 : zodiac ? 1.6 : world.iceSpeed(ice ? ice.percent : 255, state.upgrades.hull ? .6 : 1)) * dt;
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
      checkHelicopterFuel(); radio(); updatePreview(); updateFuel(); events(time); updateEvents();
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
    let raw = null; try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
    state = readVoyage(localStorage, world.start); restoreEvents(state, raw); known = new Set(state.revealed);
    state.mapped = state.mapped.filter(cell => cell < world.cols * world.rows && world.sign[cell] < 0); mapped = new Set(state.mapped);
    if (world.isLand(shipU(), shipV())) Object.assign(state, world.start);
    if (!world.seaRoom(state.safe.x * world.cols, state.safe.y * world.rows)) state.safe = { ...world.start };
    sea = world.seaFog(COLS, ROWS);
    seaCells = world.sign.reduce((sum, sign) => sum + (sign < 0 ? 1 : 0), 0) || 1;
    for (const anchorage of TANKER.anchorages) Object.assign(anchorage, world.project(anchorage.lon, anchorage.lat));
    startPlace = world.nearestPlace(world.start.x * world.cols, world.start.y * world.rows)?.name ?? '';
    radioSeen = tanker().slot;
    loadWrecks().then(() => { const wreck = wrecks.find(w => w.id === state.target); if (wreck) { target = { wreck, goal: null }; routeTarget(); } else state.target = null; updateUI(); });
    chartPosition(state, known); updateUI(); buildFog();
    // The fleet relay learns the ship's chart position and heading and carries hails; other charts' ships are drawn
    // over this one. A face-off can be played in any operation; its round opens
    // through startActivity like any other, and a settled face-off is written to the log here.
    multiplayer.start({
      world, ship: () => ({ x: state.x, y: state.y, heading: angle }), sailTo, toast,
      games: activities.filter(a => minigames[a.id]?.mount && !minigames[a.id].multiplayerOnly),
      play: (id, duel) => { const activity = activities.find(a => a.id === id); if (!activity || !craftReady()) return false; startActivity(activity, { duel }); return $('#mission-dialog').open; },
      award: (points, title) => { state.score = Math.min(Number.MAX_SAFE_INTEGER, state.score + points); const record = logEvent(state, here(), 'faceoff', title); record.points = points; save(); updateUI(); if (points) postScore({ id: 'faceoff', title: 'Face-off' }, record); },
      jolt: () => { shake = Math.max(shake, .7); },
    });
    $('#mapping-rule').textContent = `1 point per ${MAP_KM2} km² of new seabed · ${world.km} km cells · 120° fan widens with depth`;
    $('#chart-credit').textContent = `GEBCO 2024 · CIS ice charts ${world.chartDate}${world.satellite ? ` · NSIDC sea ice ${world.satellite.date}` : ''}`;
    // The chart draws itself in tiles as the view moves; the half-pixel-per-cell overview stands in under them and
    // is the minimap's base.
    const drawn = createChart(world); drawn.reveal(mapped);
    placeholder = drawn.overview(.5); progress = 1;
    miniBase = document.createElement('canvas'); const m = miniRect(); miniBase.width = m.w * 2; miniBase.height = m.h * 2;
    const base = miniBase.getContext('2d'); base.imageSmoothingEnabled = true; base.drawImage(placeholder, 0, 0, miniBase.width, miniBase.height);
    chart = drawn;
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
function boardList(list, rows, empty) { list.replaceChildren(); if (!rows.length) { list.append(el('li', 'none', empty)); return; } for (const r of rows) { const item = el('li'), player = el('span', '', r.player); player.dataset.i18nSkip = ''; item.append(player, el('b', '', `${r.points}${r.operations ? ` · ${r.operations} ops` : ''}`)); list.append(item); } }
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
const BUILD_LABEL = { building: 'Being built', review: 'In review', live: 'In the game', failed: 'Build stalled', retired: 'Set aside' };
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
function commentList(idea, thread) { thread.replaceChildren(); for (const c of idea.comments || []) { const item = el('div', 'comment'), name = el('b', '', c.name), body = el('span', '', c.body); name.dataset.i18nSkip = ''; body.dataset.i18nSkip = ''; item.append(name, body); thread.append(item); } }
function ideaCard(idea) {
  const article = el('article', 'idea'); article.dataset.id = idea.id;
  const head = el('div', 'idea-head'), title = el('h3', '', idea.title); title.dataset.i18nSkip = ''; head.append(title);
  if (idea.build) head.append(el('span', `build build-${idea.build}`, BUILD_LABEL[idea.build] || idea.build));
  const meta = el('small', '', `${idea.name} · Idea #${idea.id}`); meta.dataset.i18nSkip = '';
  const thread = el('div', 'comments'); commentList(idea, thread);
  const details = el('details', 'thread');
  details.append(el('summary', '', summaryText(idea)), thread, commentForm(idea));
  const description = el('p', '', idea.description); description.dataset.i18nSkip = '';
  article.append(head, description, meta, details);
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
for (const [activity, { art }] of activityButtons) {
  const c = art.getContext('2d');
  if ('cardGame' in art.dataset) {
    c.fillStyle = '#e4d4b6'; c.strokeStyle = '#9a7139'; c.lineWidth = 3;
    c.fillRect(18, 14, 48, 64); c.strokeRect(18, 14, 48, 64);
    c.fillStyle = '#fffaf0'; c.fillRect(32, 23, 48, 64); c.strokeRect(32, 23, 48, 64);
    c.fillStyle = '#a14d3d'; c.font = '36px Georgia'; c.textAlign = 'center'; c.fillText(activity.id === 'hearts' ? '♥' : '♦', 56, 67);
  } else {
    c.translate(48, 48); c.scale(4, 4); (GLYPHS[activity.id] || GLYPHS.ctd)(c);
  }
}
buildLegend(); setInterval(() => { if (!document.hidden) loadIdeas(); if (world) save(); }, 5000); setInterval(() => { if (!document.hidden && page === 'board') loadLeaderboard(); }, 10000); updateUI(); loadIdeas(); resize(); requestAnimationFrame(loop); boot();
