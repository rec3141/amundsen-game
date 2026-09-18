// Search and Rescue: the pure model. A seeded ice field on a cell grid, the Amundsen breaking a channel
// through it, a beset cruise ship drifting with the pack until found, then following the channel out.
// Positions are cell units (x east, y south); one cell is CELL_NMI nautical miles. Time runs at
// TIME_SCALE game seconds per real second, so speeds in knots convert to cells per real second with KN.

export const COLS = 44;
export const ROWS = 28;
export const CELL_NMI = 0.5;
export const TIME_SCALE = 180;
export const KN = TIME_SCALE / 3600 / CELL_NMI;
export const OPEN_WATER_KN = 13;
export const CHANNEL_KN = 8;
export const CRUISE_KN = 6;
export const RADAR_CELLS = 6;
export const ID_CELLS = 2;
export const SEARCH_LIMIT_S = 6 * 3600;
export const HOURS_SINCE_FIX = 3;
export const RAM_S = 2.5;
export const RAM_COOLDOWN_S = 6;
export const RAM_BOOST = 3;
export const BEARING_COOLDOWN_S = 8;
export const BEARING_ERROR_DEG = 12;
export const CRUISE_GAP = 1.6;
export const CUT_CELLS = 1.2;
export const VESSEL = 'MV Kittiwake';

// Stages of development as charted by the Canadian Ice Service (WMO egg code), with the thickness each
// stage stands for. Breaking speed comes from the thickness.
export const STAGES = [
  { code: '5', label: 'grey-white ice', range: '15–30 cm', cm: 25 },
  { code: '7', label: 'thin first-year ice', range: '30–70 cm', cm: 50 },
  { code: '1•', label: 'medium first-year ice', range: '70–120 cm', cm: 95 },
  { code: '4•', label: 'thick first-year ice', range: '>120 cm', cm: 160 },
  { code: '7•', label: 'old ice', range: 'multi-year', cm: 260 },
];

// WMO colour code for total concentration, as printed on the CIS daily charts.
export function ctColour(ct) {
  if (ct <= 0) return '#96c8ec';
  if (ct <= 3) return '#8fd28f';
  if (ct <= 6) return '#f4e46a';
  if (ct <= 8) return '#f2a13d';
  return '#e24c3c';
}
export const ctBand = ct => (ct <= 0 ? 'open water' : ct <= 3 ? `${ct}/10 very open drift` : ct <= 6 ? `${ct}/10 open drift` : ct <= 8 ? `${ct}/10 close pack` : `${ct}/10 very close pack`);

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Value noise on a coarse lattice, two octaves, in [0, 1].
function noiseField(random, period) {
  const w = Math.ceil(COLS / period) + 2, h = Math.ceil(ROWS / period) + 2;
  const lattice = Float32Array.from({ length: w * h }, () => random());
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / period, fy = y / period, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const at = (c, r) => lattice[Math.min(h - 1, r) * w + Math.min(w - 1, c)];
    const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
    const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

export const index = (c, r) => r * COLS + c;
export const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
export const cellOf = p => ({ c: Math.min(COLS - 1, Math.max(0, Math.floor(p.x))), r: Math.min(ROWS - 1, Math.max(0, Math.floor(p.y))) });
export const stageOf = cm => STAGES.reduce((best, s) => (Math.abs(s.cm - cm) < Math.abs(best.cm - cm) ? s : best), STAGES[0]);

// Continuous breaking speed for level ice of a given thickness: about 3 kn in a metre, falling steeply beyond.
export function breakingKn(cm) {
  return Math.min(OPEN_WATER_KN, Math.max(0.5, 3 * (100 / cm) ** 1.5));
}
export function cellKn(cell) {
  if (cell.ct <= 0) return OPEN_WATER_KN;
  const f = cell.ct / 10;
  return OPEN_WATER_KN * (1 - f) + breakingKn(cell.cm) * f;
}
// How long a freshly cut channel stays open before pressure closes it, in game seconds (Infinity: never).
function channelLife(cell) {
  if (cell.ct <= 6) return Infinity;
  if (cell.ct <= 8) return 3.5 * 3600;
  return cell.cm >= 120 ? 1.6 * 3600 : 2.4 * 3600;
}

export function createGame(seed) {
  const random = mulberry(hash(seed));
  const ctNoise = noiseField(random, 5.5), leadNoise = noiseField(random, 3.2), cmNoise = noiseField(random, 7);
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const g = Math.min(1, Math.max(0, (c - 4) / 15));
    let raw = g * (0.35 + 0.85 * ctNoise(c, r));
    const lead = leadNoise(c, r);
    if (lead < 0.18) raw -= 0.5;
    const ct = Math.round(10 * Math.min(1, Math.max(0, raw)));
    const t = cmNoise(c, r);
    const cm = t < 0.15 ? 25 : t < 0.42 ? 50 : t < 0.72 ? 95 : t < 0.92 ? 160 : 260;
    cells.push({ c, r, ct: ct > 0 ? ct : 0, cm: ct > 0 ? cm : 0, channel: false, closesAt: Infinity, seen: false });
  }
  // Open water is the sea outside the pack: everything reachable from the west edge through ≤3/10.
  const open = new Uint8Array(COLS * ROWS);
  const queue = [];
  for (let r = 0; r < ROWS; r++) if (cells[index(0, r)].ct <= 3) { open[index(0, r)] = 1; queue.push([0, r]); }
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (!inside(cc, rr) || open[index(cc, rr)] || cells[index(cc, rr)].ct > 3) continue;
      open[index(cc, rr)] = 1; queue.push([cc, rr]);
    }
  }
  // The cruise ship is beset in close pack deep inside the field; its last fix is three hours old.
  let cruise = null;
  for (let tries = 0; tries < 400 && !cruise; tries++) {
    const c = 24 + Math.floor(random() * 13), r = 4 + Math.floor(random() * (ROWS - 8));
    const cell = cells[index(c, r)];
    if (cell.ct >= 8 && !open[index(c, r)]) cruise = { x: c + .5, y: r + .5 };
  }
  cruise ??= { x: 32.5, y: ROWS / 2 };
  const driftDeg = Math.round(random() * 360), driftKn = 0.3 + random() * 0.3;
  const drift = { dx: Math.sin(driftDeg * Math.PI / 180) * driftKn * KN, dy: -Math.cos(driftDeg * Math.PI / 180) * driftKn * KN };
  const err = random() * 2.2, errDeg = random() * Math.PI * 2;
  const datum = {
    x: cruise.x - drift.dx * HOURS_SINCE_FIX * 3600 / TIME_SCALE + Math.cos(errDeg) * err,
    y: cruise.y - drift.dy * HOURS_SINCE_FIX * 3600 / TIME_SCALE + Math.sin(errDeg) * err,
  };
  datum.x = Math.min(COLS - 1.5, Math.max(1.5, datum.x));
  datum.y = Math.min(ROWS - 1.5, Math.max(1.5, datum.y));
  const bergs = [];
  for (let tries = 0; tries < 400 && bergs.length < 5; tries++) {
    const x = 10 + random() * (COLS - 14), y = 1.5 + random() * (ROWS - 3);
    const cell = cells[index(Math.floor(x), Math.floor(y))];
    if (cell.ct < 4 || Math.hypot(x - cruise.x, y - cruise.y) < 4 || bergs.some(b => Math.hypot(b.x - x, b.y - y) < 3)) continue;
    bergs.push({ x, y, known: false });
  }
  const startRow = 3 + Math.floor(random() * (ROWS - 6));
  const state = {
    seed: String(seed), cells, open, cruise: { ...cruise, beset: true, besets: 0, path: [], repathIn: 0 }, bergs, datum, drift, driftDeg, driftKn,
    ship: { x: 2.5, y: startRow + .5, heading: Math.PI / 2, kn: 0 },
    phase: 'search', time: 0, searchTime: 0, escortTime: 0, contactAt: null, contactDistance: 0,
    ram: 0, ramCooldown: 0, bearingCooldown: 0, bearings: [], events: [], finished: false, result: null,
  };
  reveal(state);
  breakCell(state, cellOf(state.ship));
  return state;
}

function reveal(state) {
  const { c, r } = cellOf(state.ship);
  for (let rr = r - RADAR_CELLS; rr <= r + RADAR_CELLS; rr++) for (let cc = c - RADAR_CELLS; cc <= c + RADAR_CELLS; cc++) {
    if (inside(cc, rr) && Math.hypot(cc + .5 - state.ship.x, rr + .5 - state.ship.y) <= RADAR_CELLS + .3) state.cells[index(cc, rr)].seen = true;
  }
}
function breakCell(state, { c, r }) {
  const cell = state.cells[index(c, r)];
  if (cell.ct <= 0) return;
  cell.channel = true;
  cell.closesAt = state.time + channelLife(cell);
}
export const passable = cell => cell.channel || cell.ct <= 3;

// Breadth-first path for the cruise ship through passable cells, eight-connected.
function findPath(state, from, to) {
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const start = index(from.c, from.r), goal = index(to.c, to.r);
  if (start === goal) return [];
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], c = i % COLS, r = (i - c) / COLS;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const cc = c + dc, rr = r + dr;
      if (!inside(cc, rr)) continue;
      const j = index(cc, rr);
      if (prev[j] !== -1 || !passable(state.cells[j])) continue;
      prev[j] = i;
      if (j === goal) {
        const path = [];
        for (let k = j; k !== start; k = prev[k]) path.push({ c: k % COLS, r: Math.floor(k / COLS) });
        return path.reverse();
      }
      queue.push(j);
    }
  }
  return null;
}

// One frame. input: { dx, dy } in [-1, 1] (held direction), ram and bearing as one-shot flags.
export function step(state, input, dtReal) {
  if (state.finished) return [];
  const dt = Math.min(dtReal, 0.1);
  const gameDt = dt * TIME_SCALE;
  const events = [];
  state.time += gameDt;
  state.ramCooldown = Math.max(0, state.ramCooldown - dt);
  state.bearingCooldown = Math.max(0, state.bearingCooldown - dt);
  state.ram = Math.max(0, state.ram - dt);
  const ship = state.ship;
  const at = cellOf(ship);
  const here = state.cells[index(at.c, at.r)];

  if (input.ram && state.ramCooldown <= 0 && here.ct > 0 && !here.channel) {
    state.ram = RAM_S; state.ramCooldown = RAM_S + RAM_COOLDOWN_S;
    events.push({ type: 'ram' });
  }
  if (input.bearing && state.phase === 'search' && state.bearingCooldown <= 0) {
    state.bearingCooldown = BEARING_COOLDOWN_S;
    const truth = Math.atan2(state.cruise.x - ship.x, -(state.cruise.y - ship.y));
    const noise = (Math.sin(state.time * 7.31 + state.bearings.length * 3.7) * 0.5 + Math.sin(state.time * 1.7) * 0.5) * BEARING_ERROR_DEG * Math.PI / 180;
    const bearing = (truth + noise + Math.PI * 2) % (Math.PI * 2);
    state.bearings.push({ x: ship.x, y: ship.y, bearing, at: state.time });
    if (state.bearings.length > 4) state.bearings.shift();
    events.push({ type: 'bearing', deg: Math.round(bearing * 180 / Math.PI) });
  }

  // Steering: the held direction is the course; the hull swings toward it.
  const len = Math.hypot(input.dx, input.dy);
  let kn = 0;
  if (len > 0) {
    const ux = input.dx / len, uy = input.dy / len;
    const want = Math.atan2(ux, -uy);
    let diff = want - ship.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.min(Math.abs(diff), 3.2 * dt);
    ship.heading += Math.sign(diff) * turn;
    kn = here.channel ? CHANNEL_KN : cellKn(here);
    if (state.ram > 0 && !here.channel && here.ct > 0) kn = Math.min(OPEN_WATER_KN, kn * RAM_BOOST);
    const aligned = Math.max(0.15, Math.cos(diff));
    const speed = kn * KN * aligned;
    ship.x = Math.min(COLS - 0.2, Math.max(0.2, ship.x + ux * speed * dt));
    ship.y = Math.min(ROWS - 0.2, Math.max(0.2, ship.y + uy * speed * dt));
    ship.kn = kn * aligned;
  } else ship.kn = 0;
  const cell = cellOf(ship);
  const under = state.cells[index(cell.c, cell.r)];
  if (!under.channel && under.ct > 0) breakCell(state, cell);
  else if (under.channel) under.closesAt = Math.max(under.closesAt, state.time + channelLife(under));
  reveal(state);

  // Pressure closes old channels; a hull sitting in one holds it open.
  const held = state.cruise.cell ? index(state.cruise.cell.c, state.cruise.cell.r) : -1;
  for (let i = 0; i < state.cells.length; i++) {
    const ch = state.cells[i];
    if (ch.channel && state.time >= ch.closesAt) { if (i === held) ch.closesAt = state.time + 600; else { ch.channel = false; ch.closesAt = Infinity; } }
  }

  const cruise = state.cruise;
  if (state.phase === 'search') {
    state.searchTime += gameDt;
    cruise.x = Math.min(COLS - 0.5, Math.max(0.5, cruise.x + state.drift.dx * dt));
    cruise.y = Math.min(ROWS - 0.5, Math.max(0.5, cruise.y + state.drift.dy * dt));
    for (const berg of state.bergs) if (!berg.known && Math.hypot(berg.x - ship.x, berg.y - ship.y) <= ID_CELLS) { berg.known = true; events.push({ type: 'berg' }); }
    if (Math.hypot(cruise.x - ship.x, cruise.y - ship.y) <= ID_CELLS) {
      state.phase = 'escort';
      state.contactAt = state.time;
      state.contactDistance = escapeDistance(state, cellOf(cruise));
      events.push({ type: 'contact' });
    } else if (state.searchTime >= SEARCH_LIMIT_S) {
      finish(state, false);
      events.push({ type: 'timeout' });
    }
  } else {
    state.escortTime += gameDt;
    cruise.cell ??= cellOf(cruise);
    const from = cruise.cell, to = cellOf(ship);
    // Coming alongside cuts the hull free: the ice between the two ships and under the hull becomes channel.
    if (Math.hypot(ship.x - cruise.x, ship.y - cruise.y) <= CUT_CELLS && !passable(state.cells[index(from.c, from.r)])) {
      for (let f = 0; f <= 1; f += 0.2) breakCell(state, cellOf({ x: ship.x + (cruise.x - ship.x) * f, y: ship.y + (cruise.y - ship.y) * f }));
      breakCell(state, from);
      cruise.repathIn = 0;
      events.push({ type: 'cut' });
    }
    cruise.repathIn -= dt;
    if (!passable(state.cells[index(from.c, from.r)])) cruise.path = null;
    else if (cruise.repathIn <= 0 || cruise.path === null) { cruise.path = findPath(state, from, to); cruise.repathIn = 0.4; }
    const gap = Math.hypot(ship.x - cruise.x, ship.y - cruise.y);
    let moving = false;
    if (cruise.path && cruise.path.length && gap > CRUISE_GAP) {
      const next = cruise.path[0];
      const nextCell = state.cells[index(next.c, next.r)];
      if (passable(nextCell)) {
        const tx = next.c + .5, ty = next.r + .5, d = Math.hypot(tx - cruise.x, ty - cruise.y);
        const travel = CRUISE_KN * KN * dt;
        if (d <= travel) { cruise.x = tx; cruise.y = ty; cruise.cell = cruise.path.shift(); } else { cruise.x += (tx - cruise.x) / d * travel; cruise.y += (ty - cruise.y) / d * travel; }
        moving = true;
      } else cruise.path = null;
    }
    const stuck = cruise.path === null;
    if (stuck && !cruise.beset) { cruise.beset = true; cruise.besets += 1; events.push({ type: 'beset' }); }
    if (!stuck && cruise.beset) { cruise.beset = false; events.push({ type: 'freed' }); }
    cruise.moving = moving;
    if (state.open[index(from.c, from.r)]) { finish(state, true); events.push({ type: 'delivered' }); }
  }
  return events;
}

// Steps from a cell to the nearest open water through any ice: the shortest escort an icebreaker could
// cut, the yardstick for the one actually cut.
function escapeDistance(state, from) {
  const seen = new Uint8Array(COLS * ROWS);
  const queue = [[from.c, from.r, 0]];
  seen[index(from.c, from.r)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const [c, r, d] = queue[head];
    if (state.open[index(c, r)]) return d;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (!inside(cc, rr) || seen[index(cc, rr)]) continue;
      seen[index(cc, rr)] = 1; queue.push([cc, rr, d + 1]);
    }
  }
  return COLS;
}

function finish(state, delivered) {
  state.finished = true;
  const found = state.phase === 'escort';
  const searchPoints = found ? Math.round(10 + 30 * Math.max(0, 1 - state.searchTime / SEARCH_LIMIT_S)) : 0;
  // A steady 6 kn along the shortest route is the yardstick for the escort.
  const idealS = state.contactDistance * CELL_NMI / 6 * 3600;
  const efficiency = delivered ? Math.min(1, idealS / Math.max(1, state.escortTime)) : 0;
  const escortPoints = delivered ? Math.max(5, Math.round(60 * efficiency) - 5 * state.cruise.besets) : 0;
  state.result = {
    title: 'Search and Rescue',
    vessel: VESSEL,
    found, delivered,
    points: searchPoints + escortPoints,
    searchPoints, escortPoints,
    searchHours: +(state.searchTime / 3600).toFixed(1),
    escortHours: +(state.escortTime / 3600).toFixed(1),
    besets: state.cruise.besets,
    bearingsTaken: state.bearings.length,
    bergsIdentified: state.bergs.filter(b => b.known).length,
    driftDeg: state.driftDeg,
    driftKn: +state.driftKn.toFixed(1),
  };
}

export const clock = gameSeconds => {
  const h = Math.floor(gameSeconds / 3600), m = Math.floor((gameSeconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};
