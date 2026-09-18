// Pure search-and-recovery model for "Find Clement's stuff": a seeded field of old floes, the Ice
// Team's transects across them, Clement's lost gear beside those transects, and a helicopter that flies
// out from the Amundsen's deck to recover it. Nothing in here touches the DOM.

export const WORLD = { width: 1000, height: 700 };
export const SHIP = { x: 500, y: 640, heading: -Math.PI / 2 };
export const ENDURANCE_S = 100;
export const LOW_FUEL_S = 25;
export const SPOT_RADIUS = 60;
export const GRAB_RADIUS = 16;
export const GRAB_SPEED = 30;
export const SEARCH_SPEED = 55;
export const DECK_RADIUS = 30;
export const MAX_SPEED = 135;
export const RETURN_BONUS = 25;
export const SWEEP_BONUS = 50;

// Everything Clement has left behind on a floe so far this leg. Points follow how much the item matters
// to the next station, not what it cost. Buried items only show up to a slow, low search.
export const CATALOGUE = [
  { id: 'sunglasses', name: 'Sunglasses', code: 'SG', points: 10, colour: '#3f3f46' },
  { id: 'neck-warmer', name: 'Neck warmer', code: 'NW', points: 15, colour: '#b91c1c' },
  { id: 'camera', name: 'Camera', code: 'CA', points: 40, colour: '#1e293b' },
  { id: 'toque', name: 'Toque', code: 'TQ', points: 15, colour: '#7c3aed' },
  { id: 'mitts', name: 'Mitts', code: 'MI', points: 10, colour: '#c2410c' },
  { id: 'thermos', name: 'Thermos', code: 'TH', points: 20, colour: '#0f766e' },
  { id: 'gps', name: 'Handheld GPS', code: 'GP', points: 35, colour: '#ca8a04' },
  { id: 'tape', name: 'Thickness tape', code: 'TT', points: 25, colour: '#2563eb' },
  { id: 'notebook', name: 'Field notebook', code: 'FN', points: 50, colour: '#166534' },
  { id: 'radio', name: 'VHF radio', code: 'VH', points: 45, colour: '#0369a1' },
];

export function seededRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const LETTERS = 'ABCDEFGH';

function polygon(cx, cy, radius, random) {
  const n = 9 + Math.floor(random() * 4);
  const points = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + random() * 0.25;
    const r = radius * (0.72 + random() * 0.36);
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

// Old floes keep clear of each other and of the ship; the leads between them are open water.
function placeFloes(random, count) {
  const floes = [];
  let attempts = 0;
  while (floes.length < count && attempts < 400) {
    attempts += 1;
    const radius = 62 + random() * 58;
    const x = 90 + radius + random() * (WORLD.width - 180 - radius * 2);
    const y = 70 + radius + random() * (WORLD.height - 300 - radius * 2);
    const shipGap = Math.hypot(x - SHIP.x, y - SHIP.y);
    if (shipGap < radius + 110) continue;
    if (floes.some(f => Math.hypot(f.x - x, f.y - y) < f.radius + radius + 30)) continue;
    const bearing = random() * Math.PI;
    floes.push({ id: LETTERS[floes.length], x, y, radius, bearing, points: polygon(x, y, radius, random), items: [], ponds: [] });
  }
  return floes;
}

function scatterItems(random, floes, total) {
  const pool = [...CATALOGUE].sort(() => random() - 0.5).slice(0, total);
  // Spread the gear across floes so every transect is worth a look, then let the rest fall where it may.
  pool.forEach((entry, index) => {
    const floe = index < floes.length ? floes[index] : floes[Math.floor(random() * floes.length)];
    const along = (random() - 0.5) * floe.radius * 0.95;
    const off = (random() - 0.5) * floe.radius * 0.4;
    const dx = Math.cos(floe.bearing), dy = Math.sin(floe.bearing);
    const item = {
      ...entry,
      floe: floe.id,
      x: floe.x + dx * along - dy * off,
      y: floe.y + dy * along + dx * off,
      buried: random() < 0.4,
      spotted: false,
      found: false,
    };
    floe.items.push(item);
  });
  return floes.flatMap(f => f.items);
}

// Builds a fresh search. `chartPolygons` is the array of old-ice polygons from the Canadian Ice Service
// snapshot, used to give each floe its egg code; without it the floes carry no chart line.
export function createSearch(seed = 'clement', chartPolygons = []) {
  const random = seededRandom(seed);
  const floes = placeFloes(random, 5 + Math.floor(random() * 2));
  floes.forEach(floe => {
    const n = 2 + Math.floor(random() * 4);
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2, d = random() * floe.radius * 0.55;
      floe.ponds.push({ x: floe.x + Math.cos(a) * d, y: floe.y + Math.sin(a) * d, r: 5 + random() * floe.radius * 0.12 });
    }
    if (chartPolygons.length) floe.chart = chartPolygons[Math.floor(random() * chartPolygons.length)];
  });
  const items = scatterItems(random, floes, 8 + Math.floor(random() * 3));
  const windFrom = random() * Math.PI * 2;
  const windSpeed = 3 + random() * 5;
  return {
    seed,
    floes,
    items,
    wind: { from: windFrom, speed: windSpeed, dx: -Math.cos(windFrom) * windSpeed, dy: -Math.sin(windFrom) * windSpeed },
    heli: { x: SHIP.x, y: SHIP.y, heading: SHIP.heading, speed: 0, airborne: false, fuel: ENDURANCE_S, distance: 0 },
    floesVisited: new Set(),
    elapsed: 0,
    finished: false,
    outcome: null,
    result: null,
    events: [],
  };
}

export const speed = heli => Math.abs(heli.speed);
export const distanceToDeck = heli => Math.hypot(heli.x - SHIP.x, heli.y - SHIP.y);
export const onDeck = heli => distanceToDeck(heli) <= DECK_RADIUS && speed(heli) <= GRAB_SPEED;
export const canLand = state => !state.finished && state.heli.airborne && onDeck(state.heli);

// The nearest recoverable item, if the helicopter is hovering right over one.
export function grabbable(state) {
  if (state.finished || !state.heli.airborne || speed(state.heli) > GRAB_SPEED) return null;
  let best = null, bestDistance = GRAB_RADIUS;
  for (const item of state.items) {
    if (item.found) continue;
    const d = Math.hypot(item.x - state.heli.x, item.y - state.heli.y);
    if (d <= bestDistance) { best = item; bestDistance = d; }
  }
  return best;
}

// Advances the flight by dt seconds. `input` = { throttle: -1..1, yaw: -1..1 }.
export function step(state, input, dt) {
  if (state.finished) return;
  const heli = state.heli;
  const throttle = Math.max(-1, Math.min(1, input.throttle ?? 0));
  const yaw = Math.max(-1, Math.min(1, input.yaw ?? 0));
  if (!heli.airborne && (throttle !== 0 || yaw !== 0)) {
    heli.airborne = true;
    state.events.push({ t: state.elapsed, kind: 'takeoff' });
  }
  if (!heli.airborne) return;
  state.elapsed += dt;
  heli.fuel = Math.max(0, heli.fuel - dt);
  heli.heading += yaw * 2.4 * dt;
  // Forward thrust against drag: cruising settles near MAX_SPEED, hovering bleeds off in about a second.
  heli.speed += throttle * 175 * dt;
  heli.speed -= heli.speed * 1.3 * dt;
  heli.speed = Math.max(-MAX_SPEED * 0.4, Math.min(MAX_SPEED, heli.speed));
  const vx = Math.cos(heli.heading) * heli.speed + state.wind.dx;
  const vy = Math.sin(heli.heading) * heli.speed + state.wind.dy;
  const nx = Math.min(WORLD.width - 12, Math.max(12, heli.x + vx * dt));
  const ny = Math.min(WORLD.height - 12, Math.max(12, heli.y + vy * dt));
  heli.distance += Math.hypot(nx - heli.x, ny - heli.y);
  heli.x = nx;
  heli.y = ny;
  const searching = speed(heli) <= SEARCH_SPEED;
  for (const item of state.items) {
    if (item.spotted || item.found) continue;
    const d = Math.hypot(item.x - heli.x, item.y - heli.y);
    if (d <= SPOT_RADIUS * (item.buried ? 0.6 : 1) && (searching || !item.buried)) {
      item.spotted = true;
      state.events.push({ t: state.elapsed, kind: 'spotted', item: item.id });
    }
  }
  for (const floe of state.floes) {
    if (Math.hypot(floe.x - heli.x, floe.y - heli.y) <= floe.radius) state.floesVisited.add(floe.id);
  }
  if (heli.fuel <= 0) finish(state, 'ditched');
}

export function grab(state) {
  const item = grabbable(state);
  if (!item) return null;
  item.found = true;
  state.events.push({ t: state.elapsed, kind: 'found', item: item.id });
  return item;
}

export function found(state) { return state.items.filter(i => i.found); }

export function score(state) {
  let total = found(state).reduce((sum, i) => sum + i.points, 0);
  if (state.outcome === 'landed') total += RETURN_BONUS;
  if (state.outcome === 'landed' && found(state).length === state.items.length) total += SWEEP_BONUS;
  return total;
}

export function land(state) {
  if (!canLand(state)) return null;
  return finish(state, 'landed');
}

// Ends the search once. Landing on the deck banks the return bonus; running dry on the ice keeps the gear
// already aboard but nothing more.
export function finish(state, outcome) {
  if (state.finished) return null;
  state.finished = true;
  state.outcome = outcome;
  state.heli.speed = 0;
  state.heli.airborne = false;
  const recovered = found(state);
  const points = score(state);
  const floe = state.floes[0];
  state.result = {
    points,
    detail: {
      title: `Clement's stuff: ${recovered.length} of ${state.items.length} items recovered`,
      outcome,
      items: recovered.map(i => i.name),
      missing: state.items.filter(i => !i.found).map(i => i.name),
      floesVisited: [...state.floesVisited].sort(),
      floes: state.floes.length,
      flightSeconds: Math.round(state.elapsed),
      fuelLeftSeconds: Math.round(state.heli.fuel),
      iceChart: floe?.chart ? `${floe.chart.region} ${floe.chart.date}` : null,
    },
  };
  return state.result;
}
