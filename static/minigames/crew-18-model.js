// Shipwrecks model: pure functions over plain state, no DOM. A site is a square search box GRID cells
// across centred on the archive datum; the target's offset, the seabed and the false contacts are
// generated from a seed and honour the record's clue (static/data/crew-18-wrecks.json).

export const GRID = 32;                 // cells across the search box
export const SURVEY_KN = 5;             // survey speed over the ground
export const TURN_H = 0.08;             // time to come round at the end of a line
export const TRANSIT_H = 0.15;          // time to reach the first line of a new box
export const ROV_M_PER_MIN = 30;        // ROV descent and ascent rate
export const ROV_BOTTOM_MIN = 25;       // time on the bottom identifying a contact
export const SIDESCAN_MAX_DEPTH = 60;   // shallower than this the towfish is used
export const SIDESCAN_SWATH_M = 150;    // 75 m range each side of the fish
export const MULTIBEAM_MIN_M = 200, MULTIBEAM_MAX_M = 1500;   // 120° hull-mounted swath, clamped
export const FALSE_DIVE_PENALTY = 25;
const KM_PER_H = SURVEY_KN * 1.852;

// ---- deterministic randomness -------------------------------------------------------------
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Smooth value noise on the cell grid, for seabed depth and backscatter texture.
export function noiseField(seed, size, octaves = 3) {
  const random = rng(seed), lattice = [];
  for (let o = 0; o < octaves; o++) { const n = 4 << o, cells = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < cells.length; i++) cells[i] = random(); lattice.push({ n, cells }); }
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    let value = 0, weight = 0, amp = 1;
    for (const { n, cells } of lattice) {
      const fx = Math.min(n - 1e-6, Math.max(0, x / size * n)), fy = Math.min(n - 1e-6, Math.max(0, y / size * n));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0), w = n + 1;
      const a = cells[y0 * w + x0], b = cells[y0 * w + x0 + 1], c = cells[(y0 + 1) * w + x0], d = cells[(y0 + 1) * w + x0 + 1];
      value += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty); weight += amp; amp *= 0.5;
    }
    return value / weight;
  };
}

// ---- geography ----------------------------------------------------------------------------
const RAD = Math.PI / 180;
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
export const compass = deg => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export function formatPosition(lat, lon) {
  const dm = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${d}°${m.toFixed(1).padStart(4, '0')}′${v >= 0 ? pos : neg}`; };
  return `${dm(lat, 'N', 'S')} ${dm(lon, 'E', 'W')}`;
}
// The world's own projection (WGS84 polar stereographic, lat_ts 78, lon_0 −90), in metres from the pole.
export function projectStereo(lon, lat) {
  const a = 6378137, f = 1 / 298.257223563, e = Math.sqrt(2 * f - f * f), lon0 = -90, latTs = 78;
  const tOf = phi => { const s = Math.sin(phi); return Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2); };
  const phiC = latTs * RAD, scale = a * Math.cos(phiC) / Math.sqrt(1 - (e * Math.sin(phiC)) ** 2) / tOf(phiC);
  const rho = scale * tOf(lat * RAD), lam = (lon - lon0) * RAD;
  return { x: rho * Math.sin(lam), y: rho * Math.cos(lam) };   // y grows southward along lon0
}

// ---- sonar and time -----------------------------------------------------------------------
export function sonarFor(depth) {
  if (depth <= SIDESCAN_MAX_DEPTH) return { mode: 'side-scan', label: 'towed side-scan', swathM: SIDESCAN_SWATH_M };
  return { mode: 'multibeam', label: 'hull multibeam', swathM: Math.min(MULTIBEAM_MAX_M, Math.max(MULTIBEAM_MIN_M, Math.round(2 * depth * Math.sqrt(3)))) };
}
export const diveHours = depth => (2 * depth / ROV_M_PER_MIN + ROV_BOTTOM_MIN) / 60;
// 'the Breadalbane' but 'a Baffin Fair whaler'.
export const named = ship => /^(a|an|the) /i.test(ship) ? ship : `the ${ship}`;
const SECTORS = { N: 270, NE: 315, E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225 };   // screen angles, y down

// ---- the site -----------------------------------------------------------------------------
export function createSite(wreck, seed = wreck.id) {
  const random = rng(`${wreck.id}:${seed}`);
  const cellM = wreck.boxKm * 1000 / GRID, depth = wreck.depth.m, sonar = sonarFor(depth);
  const swathCells = sonar.swathM / cellM, spacing = Math.max(1, Math.floor(swathCells));
  const hint = wreck.hint, half = GRID / 2;
  // Target offset from the datum, inside the sector the clue names.
  let tx, ty;
  if (hint?.bearing === 'centre') { const r = random() * 0.12 * GRID, a = random() * Math.PI * 2; tx = half + Math.cos(a) * r; ty = half + Math.sin(a) * r; }
  else if (hint?.bearing in SECTORS) {
    const a = (SECTORS[hint.bearing] + (random() - 0.5) * 60) * RAD, r = (hint.shore ? 0.26 + random() * 0.1 : 0.2 + random() * 0.22) * GRID;
    tx = half + Math.cos(a) * r; ty = half + Math.sin(a) * r;
  } else { tx = (0.08 + random() * 0.84) * GRID; ty = (0.08 + random() * 0.84) * GRID; }
  const target = { x: tx, y: ty, heading: random() * Math.PI, lengthM: 30 + random() * 20 };
  // Land along the clue's side of the box: a wavy line beyond which cells are shore.
  const wave = noiseField(`${wreck.id}:shore`, GRID, 2);
  const land = new Uint8Array(GRID * GRID);
  if (hint?.shore) {
    const dir = SECTORS[hint.bearing] * RAD, ux = Math.cos(dir), uy = Math.sin(dir);
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const px = c + 0.5 - half, py = r + 0.5 - half, along = px * ux + py * uy, across = -px * uy + py * ux;
      if (along > (0.42 + (wave(across + half, 0) - 0.5) * 0.12) * GRID) land[r * GRID + c] = 1;
    }
  }
  // Seabed depth per cell and a backscatter texture value (0..1) for the mosaic.
  const relief = noiseField(`${wreck.id}:relief`, GRID, 3), texture = noiseField(`${wreck.id}:texture`, GRID * 4, 4);
  const seabed = new Float32Array(GRID * GRID);
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const i = r * GRID + c;
    let d = depth * (0.75 + relief(c, r) * 0.5);
    if (hint?.shore) {
      const dir = SECTORS[hint.bearing] * RAD, along = (c + 0.5 - half) * Math.cos(dir) + (r + 0.5 - half) * Math.sin(dir);
      const shoreward = Math.max(0, Math.min(1, (along / GRID + 0.5) / 0.92));   // 0 far side .. 1 at the shore
      d *= 1.1 - shoreward * 0.9;
    }
    seabed[i] = land[i] ? 0 : Math.max(2, d);
  }
  // False contacts: boulders and ice scours in open water, the odd rock outcrop near a shore.
  const contacts = [];
  const count = 6 + Math.floor(random() * 5);
  for (let i = 0; i < count; i++) {
    const x = 1 + random() * (GRID - 2), y = 1 + random() * (GRID - 2);
    if (land[Math.floor(y) * GRID + Math.floor(x)] || Math.hypot(x - tx, y - ty) < 2) { i--; continue; }
    const kind = random() < 0.55 ? 'boulder' : random() < 0.7 ? 'scour' : 'outcrop';
    contacts.push({ x, y, kind, heading: random() * Math.PI, size: kind === 'scour' ? 2 + random() * 4 : 0.35 + random() * 0.45 });
  }
  const fullLines = Math.ceil(GRID / spacing);
  const fullHours = TRANSIT_H + fullLines * (wreck.boxKm / KM_PER_H + TURN_H);
  const budgetH = Math.round((0.7 * fullHours + 2 * diveHours(depth)) * 10) / 10;
  const difficulty = Math.max(1, Math.min(6, 1 + Math.round(Math.log2(Math.max(1, fullHours / 2))) + (hint ? 0 : 1) + (depth > 300 ? 1 : 0)));
  return { wreck, cellM, depth, sonar, swathCells, spacing, target, land, seabed, texture, contacts, fullHours, budgetH, difficulty };
}

// ---- the game -----------------------------------------------------------------------------
export function createGame(wreck, seed) {
  const site = createSite(wreck, seed);
  return {
    site, phase: 'plan', hoursLeft: site.budgetH, hoursUsed: 0,
    box: { x: Math.round(GRID / 4), y: Math.round(GRID / 4), w: Math.round(GRID / 2), h: Math.round(GRID / 2) },
    cursor: { x: GRID / 2 + 0.5, y: GRID / 2 + 0.5 },   // cell centres, so a step of one cell stays centred
    covered: new Uint8Array(GRID * GRID), surveys: 0, kmRun: 0,
    survey: null, ship: null, dives: [], found: false, result: null,
  };
}
export const clampBox = box => {
  const w = Math.max(2, Math.min(GRID, Math.round(box.w))), h = Math.max(2, Math.min(GRID, Math.round(box.h)));
  return { w, h, x: Math.max(0, Math.min(GRID - w, Math.round(box.x))), y: Math.max(0, Math.min(GRID - h, Math.round(box.y))) };
};
// Lawnmower legs across the box, one per swath spacing, alternating direction.
export function planLegs(site, box) {
  const legs = [], step = Math.min(site.spacing, box.h);
  let dir = 1, y = box.y + step / 2;
  for (; y < box.y + box.h; y += step) { legs.push({ y, x0: dir > 0 ? box.x : box.x + box.w, x1: dir > 0 ? box.x + box.w : box.x, dir }); dir = -dir; }
  // A box that is not a whole number of spacings gets a last line along its far edge.
  const last = legs.at(-1);
  if (last && last.y + site.swathCells / 2 < box.y + box.h - 0.5) legs.push({ y: box.y + box.h - step / 2, x0: dir > 0 ? box.x : box.x + box.w, x1: dir > 0 ? box.x + box.w : box.x, dir });
  return legs;
}
export function planCost(site, box) {
  const legs = planLegs(site, box), km = legs.length * box.w * site.cellM / 1000;
  return { lines: legs.length, km, hours: TRANSIT_H + km / KM_PER_H + legs.length * TURN_H };
}
export function startSurvey(state, box = state.box) {
  if (state.phase !== 'plan' || state.result) return { ok: false, reason: 'not planning' };
  const cost = planCost(state.site, box);
  if (cost.hours > state.hoursLeft + 1e-9) return { ok: false, reason: 'over budget', cost };
  const legs = planLegs(state.site, box);
  state.box = { ...box };
  state.survey = { legs, leg: 0, progress: 0, cost, done: false, speed: 1 };
  state.ship = { x: legs[0].x0, y: legs[0].y, heading: legs[0].dir > 0 ? 0 : Math.PI };
  state.phase = 'survey';
  state.hoursLeft -= TRANSIT_H; state.hoursUsed += TRANSIT_H;
  state.surveys++;
  return { ok: true, cost };
}
function coverAt(state, x, y, box) {
  const { site, covered } = state, hw = site.swathCells / 2;
  const c = Math.max(box.x, Math.min(box.x + box.w - 1, Math.floor(x)));
  for (let r = Math.max(0, Math.floor(y - hw)); r < Math.min(GRID, Math.ceil(y + hw)); r++) if (Math.abs(r + 0.5 - y) <= hw + 0.01) covered[r * GRID + c] = 1;
}
// Advance the ship along the planned legs by dtHours; returns 'leg', 'done' or null.
export function advanceSurvey(state, dtHours) {
  const { survey, site } = state;
  if (!survey || survey.done || state.phase !== 'survey') return null;
  let remaining = dtHours * KM_PER_H * 1000 / site.cellM, event = null;   // cells of track to run
  while (remaining > 0 && !survey.done) {
    const leg = survey.legs[survey.leg], length = Math.abs(leg.x1 - leg.x0);
    const step = Math.min(remaining, length - survey.progress);
    const from = survey.progress, to = from + step;
    for (let s = from; s < to + 0.5; s += 0.5) coverAt(state, leg.x0 + leg.dir * Math.min(s, to), leg.y, state.box);
    survey.progress = to; remaining -= step;
    const hours = step * site.cellM / 1000 / KM_PER_H;
    state.hoursLeft -= hours; state.hoursUsed += hours; state.kmRun += step * site.cellM / 1000;
    state.ship = { x: leg.x0 + leg.dir * to, y: leg.y, heading: leg.dir > 0 ? 0 : Math.PI };
    if (survey.progress >= length - 1e-9) {
      state.hoursLeft -= TURN_H; state.hoursUsed += TURN_H;
      if (survey.leg + 1 < survey.legs.length) { survey.leg++; survey.progress = 0; event = 'leg'; remaining -= TURN_H * KM_PER_H * 1000 / site.cellM; }
      else { survey.done = true; state.phase = 'plan'; event = 'done'; }
    }
  }
  if (event === 'done' && stranded(state)) { finish(state, false); event = 'timeout'; }
  return event;
}
// The search is over when the ship time left cannot pay for the dive that would win it, or for the
// smallest survey when nothing has been surveyed yet.
export function stranded(state) {
  if (state.result) return false;
  if (state.hoursLeft < diveHours(state.site.depth) - 1e-9) return true;
  const surveyed = state.covered.some(c => c);
  return !surveyed && state.hoursLeft < planCost(state.site, { x: 0, y: 0, w: 2, h: 2 }).hours - 1e-9;
}
export const isCovered = (state, x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && !!state.covered[Math.floor(y) * GRID + Math.floor(x)];
// What the mosaic shows at a cell, for the inspect cursor readout.
export function contactAt(site, x, y, radius = 1) {
  if (Math.hypot(site.target.x - x, site.target.y - y) <= radius) return { kind: 'wreck' };
  let best = null, bestD = radius;
  for (const c of site.contacts) { const d = Math.hypot(c.x - x, c.y - y); if (d < bestD) { best = c; bestD = d; } }
  return best;
}
// Drop the ROV on the cursor. Hours are charged; a wreck ends the game.
export function dive(state, x = state.cursor.x, y = state.cursor.y) {
  if (state.phase !== 'plan' || state.result) return { ok: false, reason: 'busy' };
  if (!isCovered(state, x, y)) return { ok: false, reason: 'unsurveyed' };
  const hours = diveHours(state.site.depth);
  if (hours > state.hoursLeft + 1e-9) return { ok: false, reason: 'over budget', hours };
  const what = contactAt(state.site, x, y);
  const hit = what?.kind === 'wreck';
  state.hoursLeft -= hours; state.hoursUsed += hours;
  state.dives.push({ x, y, hit, what: what?.kind ?? 'seabed', hours });
  state.phase = 'dive';
  return { ok: true, hit, what: what?.kind ?? 'seabed', hours };
}
export function endDive(state) {
  if (state.phase !== 'dive') return;
  const last = state.dives.at(-1);
  if (last?.hit) finish(state, true);
  else if (stranded(state)) finish(state, false);
  else state.phase = 'plan';
}
export function score(state) {
  const { site } = state, base = 80 + 50 * site.difficulty;
  const efficiency = Math.max(0, Math.min(1, state.hoursLeft / site.budgetH));
  const falseDives = state.dives.filter(d => !d.hit).length;
  const points = Math.max(40, Math.round(base * (0.6 + 0.8 * efficiency) - falseDives * FALSE_DIVE_PENALTY + (falseDives === 0 ? 40 : 0)));
  return { base, efficiency, falseDives, points };
}
function finish(state, found) {
  const s = found ? score(state) : { base: 0, efficiency: 0, falseDives: state.dives.length, points: 0 };
  state.found = found; state.phase = 'done';
  const w = state.site.wreck;
  state.result = {
    points: s.points, found, title: found ? `Found ${named(w.ship)} (${w.year})` : `Search for ${named(w.ship)} called off`,
    wreck: w.id, ship: w.ship, year: w.year, depthM: state.site.depth, sonar: state.site.sonar.label, difficulty: state.site.difficulty,
    surveys: state.surveys, kmRun: Math.round(state.kmRun * 10) / 10, hoursUsed: Math.round(state.hoursUsed * 10) / 10, budgetH: state.site.budgetH,
    dives: state.dives.length, falseDives: s.falseDives, efficiency: Math.round(s.efficiency * 100) / 100, base: s.base,
  };
  return state.result;
}
