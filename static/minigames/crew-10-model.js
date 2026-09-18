// Flooding model for the aft lab: one burst seawater-loop fitting, a deck that fills like a tank,
// and a scientist who can walk, wade, turn a valve, clear a drain and lift gear onto the bench.
// Pure functions over a plain state object; the UI drives it with step(state, dt).

export const AREA_M2 = 40;          // deck area that the water spreads over
export const TIME_SCALE = 20;       // lab seconds per real second
export const LINE_FLOW = 0.040;     // m³/s through the open fitting with the valve fully open
export const PUMP_FLOW = 0.005;     // m³/s from the sump pump once it has water to pull
export const PUMP_MIN_M = 0.01;     // the pump loses prime below this depth
export const SCUPPER_AREA = 0.005;  // m², one 8 cm deck drain
export const DISCHARGE = 0.6;       // orifice coefficient for the scupper
export const ABANDON_M = 0.5;       // the watch shuts the watertight door at this depth
export const DRAINED_M = 0.01;      // below this the deck is squeegee work, not flooding
export const TIME_LIMIT = 120;      // real seconds before the deck watch takes over
export const G = 9.81;

const BASE_SPEED = 620;             // scene units per second on a dry deck (scene is 1000 wide)
const TURN_SECONDS = 0.45;          // one quarter turn on the valve handwheel

export const STATIONS = [
  { id: 'valve', x: 95, name: 'Loop valve', key: '1', verb: 'Turn the handwheel' },
  { id: 'pump', x: 235, name: 'Sump pump', key: '2', verb: 'Start the pump' },
  { id: 'laptop', x: 395, name: 'Laptop', key: '3', verb: 'Lift to the bench', work: 0.5, item: true, dieAt: 0.02, mass: 2, footprint: 0.09, points: 30 },
  { id: 'power', x: 540, name: 'Power bar', key: '4', verb: 'Hang it up', work: 0.5, item: true, dieAt: 0.05, mass: 1.5, footprint: 0.02, points: 15 },
  { id: 'crate', x: 680, name: 'Sample crate', key: '5', verb: 'Heave onto the bench', work: 2.0, item: true, mass: 30, footprint: 0.24, tipAfter: 2.5, points: 40 },
  { id: 'pelican', x: 800, name: 'Pelican case', key: '6', verb: 'Lift to the bench', work: 1.5, item: true, mass: 8, footprint: 0.2, points: 0 },
  { id: 'scupper', x: 925, name: 'Scupper', key: '7', verb: 'Clear the drain' },
];

export function mulberry(seed) {
  let a = (typeof seed === 'number' ? seed : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// EOS-80 density at atmospheric pressure, kg/m³.
export function density(salinity, temperature) {
  const T = temperature, S = salinity;
  const rhoW = 999.842594 + 6.793952e-2 * T - 9.095290e-3 * T ** 2 + 1.001685e-4 * T ** 3 - 1.120083e-6 * T ** 4 + 6.536332e-9 * T ** 5;
  const A = 8.24493e-1 - 4.0899e-3 * T + 7.6438e-5 * T ** 2 - 8.2467e-7 * T ** 3 + 5.3875e-9 * T ** 4;
  const B = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T ** 2;
  return rhoW + A * S + B * S ** 1.5 + 4.8314e-4 * S ** 2;
}

// Freezing point of seawater at the surface, °C (UNESCO 1983).
export function freezingPoint(salinity) {
  return -0.0575 * salinity + 1.710523e-3 * salinity ** 1.5 - 2.154996e-4 * salinity ** 2;
}

export function createFlood(seed, seawater) {
  const random = mulberry(seed ?? 1);
  const water = seawater && Number.isFinite(seawater.sst) && Number.isFinite(seawater.salinity)
    ? { ...seawater }
    : { sst: -0.9, salinity: 27.7, time: null, assumed: true };
  water.density = density(water.salinity, water.sst);
  water.freezing = freezingPoint(water.salinity);
  const turns = 7 + Math.floor(random() * 4);
  const stations = STATIONS.map(s => {
    const station = { ...s, progress: 0, done: false };
    if (s.id === 'valve') { station.turns = turns; station.work = turns * TURN_SECONDS; }
    if (s.id === 'pump') station.work = 0.4;
    if (s.id === 'scupper') station.work = 0.8 + Math.round(random() * 4) * 0.2;
    if (s.item) {
      // Archimedes: a box lifts off the deck once the water it displaces weighs as much as it does.
      station.draft = s.mass / (water.density * s.footprint);
      station.place = 'deck';
      station.afloat = 0;
      station.drift = 0;
      station.lost = null;
    }
    return station;
  });
  return {
    seed, water, stations, turns,
    t: 0, level: 0, peak: 0, inflow: LINE_FLOW, outflow: 0,
    player: { x: 500, target: null, pending: false, working: null },
    lights: true, valveClosedAt: null, drainedAt: null,
    over: null, events: [],
  };
}

export const station = (state, id) => state.stations.find(s => s.id === id);
export const closure = state => Math.min(1, station(state, 'valve').progress / station(state, 'valve').work);
// A gate valve passes most of its flow until the last turns: quick-opening characteristic.
export const inflowAt = state => LINE_FLOW * Math.sqrt(Math.max(0, 1 - closure(state)));
export const wadingFactor = level => 1 / (1 + (level / 0.25) ** 1.5);
export const nearest = state => state.stations.reduce((best, s) => Math.abs(s.x - state.player.x) < Math.abs(best.x - state.player.x) ? s : best);
export const atStation = (state, s) => Math.abs(s.x - state.player.x) < 3;

export function available(state, s) {
  if (state.over || s.done) return false;
  if (s.item) return s.place === 'deck';
  return true;
}

// Walk toward a station; acting on arrival is remembered when `act` is set.
export function go(state, index, act = false) {
  if (state.over) return false;
  const target = state.stations[(index + state.stations.length) % state.stations.length];
  if (!target) return false;
  state.player.target = target.id;
  state.player.pending = act;
  if (state.player.working && state.player.working !== target.id) state.player.working = null;
  return true;
}

export function move(state, direction) {
  const current = state.player.target ? state.stations.findIndex(s => s.id === state.player.target) : state.stations.indexOf(nearest(state));
  const next = current + direction;
  if (next < 0 || next >= state.stations.length) return false;
  return go(state, next, false);
}

// Start (or resume) the work at the station under the player; walking there first when needed.
export function act(state) {
  if (state.over) return false;
  const target = state.player.target ? station(state, state.player.target) : nearest(state);
  if (!atStation(state, target)) { state.player.target = target.id; state.player.pending = true; return true; }
  if (!available(state, target)) return false;
  state.player.working = target.id;
  state.player.pending = false;
  return true;
}

function finishWork(state, s) {
  s.done = true;
  s.progress = s.work;
  state.player.working = null;
  if (s.id === 'valve') { state.valveClosedAt = state.t; state.events.push({ type: 'valve', text: `Valve shut after ${s.turns} turns. The line is quiet; now get the water off the deck.` }); }
  else if (s.id === 'pump') state.events.push({ type: 'pump', text: state.level >= PUMP_MIN_M ? 'Sump pump running.' : 'Sump pump switched on. It needs a centimetre of water to pull.' });
  else if (s.id === 'scupper') state.events.push({ type: 'scupper', text: 'Scupper clear: cable ties and tape out. It drains faster the deeper the water.' });
  else if (s.item) {
    s.place = 'bench';
    state.events.push({ type: 'saved', text: s.id === 'pelican' ? 'Pelican case on the bench. It was sealed anyway.' : `${s.name} on the bench, dry.` });
  }
}

export function step(state, dt) {
  if (state.over || !(dt > 0)) return state.events;
  dt = Math.min(dt, 0.1);
  state.t += dt;
  const player = state.player;
  const level = state.level;
  // Walking, and wading once the water is deep.
  if (player.target) {
    const target = station(state, player.target);
    const speed = BASE_SPEED * wadingFactor(level);
    const gap = target.x - player.x;
    const stride = speed * dt;
    if (Math.abs(gap) <= stride) {
      player.x = target.x;
      if (player.pending) { player.pending = false; if (available(state, target)) player.working = target.id; }
    } else player.x += Math.sign(gap) * stride;
  }
  // Work only progresses with the player standing at the station.
  if (player.working) {
    const s = station(state, player.working);
    if (!atStation(state, s) || !available(state, s)) player.working = null;
    else {
      s.progress += dt;
      if (s.progress >= s.work) finishWork(state, s);
    }
  }
  // Tank balance in lab time.
  const labDt = dt * TIME_SCALE;
  const inflow = inflowAt(state);
  const scupperOpen = station(state, 'scupper').done;
  const pumpOn = station(state, 'pump').done;
  let outflow = 0;
  if (scupperOpen && state.level > 0) outflow += DISCHARGE * SCUPPER_AREA * Math.sqrt(2 * G * state.level);
  if (pumpOn && state.level >= PUMP_MIN_M) outflow += PUMP_FLOW;
  outflow = Math.min(outflow, inflow + state.level * AREA_M2 / labDt);
  state.inflow = inflow;
  state.outflow = outflow;
  state.level = Math.max(0, state.level + (inflow - outflow) * labDt / AREA_M2);
  state.peak = Math.max(state.peak, state.level);
  // Gear on the deck.
  for (const s of state.stations) {
    if (!s.item || s.place !== 'deck') continue;
    if (s.dieAt && state.level >= s.dieAt) {
      s.place = 'lost'; s.lost = 'wet';
      if (s.id === 'power') { state.lights = false; state.events.push({ type: 'lost', text: 'Power bar under water: the breaker trips. Emergency lighting only.' }); }
      else state.events.push({ type: 'lost', text: `${s.name} is under water. Salt water and a live board do not mix.` });
      if (player.working === s.id) player.working = null;
      continue;
    }
    if (state.level >= s.draft) {
      if (s.afloat === 0) state.events.push({ type: 'afloat', text: s.id === 'pelican' ? 'The Pelican case is floating. Sealed, it will be fine.' : `${s.name} is afloat at ${(s.draft * 100).toFixed(0)} cm and drifting.` });
      s.afloat += dt;
      s.drift = Math.sin(s.afloat * 1.3) * 25;
      if (s.tipAfter && s.afloat >= s.tipAfter) {
        s.place = 'lost'; s.lost = 'tipped';
        state.events.push({ type: 'lost', text: `${s.name} tipped over. Twelve Niskin samples gone into the flood.` });
        if (player.working === s.id) player.working = null;
      }
    }
  }
  if (state.level >= ABANDON_M) end(state, 'abandoned', 'Half a metre on the deck. The watch dogs the watertight door with you on the dry side.');
  else if (closure(state) >= 1 && state.level < DRAINED_M) end(state, 'drained', 'Deck down to a film. Squeegees from here.');
  else if (state.t >= TIME_LIMIT) end(state, 'relieved', 'The deck watch takes over the lab.');
  return state.events;
}

function end(state, reason, text) {
  state.over = reason;
  state.player.working = null;
  state.player.target = null;
  if (reason === 'drained') state.drainedAt = state.t;
  state.events.push({ type: 'end', text });
}

export function summary(state) {
  const items = state.stations.filter(s => s.item);
  const saved = items.filter(s => s.place === 'bench' && s.points > 0);
  const lost = items.filter(s => s.place === 'lost' || (s.place === 'deck' && s.points > 0 && state.over));
  const valve = closure(state) >= 1;
  const peakCm = Math.round(state.peak * 1000) / 10;
  const lines = [
    { label: 'Loop valve shut', points: valve ? 40 : 0, note: valve ? `${station(state, 'valve').turns} turns, ${labClock(state.valveClosedAt)} on the lab clock` : 'still open' },
    ...items.map(s => ({
      label: s.name,
      points: s.place === 'bench' ? s.points : 0,
      note: s.place === 'bench' ? (s.id === 'pelican' ? 'sealed case, did not need lifting' : 'dry on the bench')
        : s.lost === 'tipped' ? 'tipped while afloat, samples lost'
        : s.lost === 'wet' ? 'flooded on the deck'
        : s.id === 'pelican' ? 'floated, sealed, unharmed' : 'left on the deck',
    })),
    { label: 'Deck drained', points: state.over === 'drained' ? 25 : 0, note: state.over === 'drained' ? `${labClock(state.drainedAt)} on the lab clock` : 'not before the watch arrived' },
    { label: 'Peak depth', points: peakCm < 10 ? 25 : peakCm < 20 ? 10 : 0, note: `${peakCm.toFixed(1)} cm` },
  ];
  const points = lines.reduce((sum, line) => sum + line.points, 0);
  return { points, lines, saved, lost, valve, peakCm };
}

export function result(state) {
  const s = summary(state);
  return {
    points: s.points,
    detail: {
      title: state.over === 'abandoned' ? 'Aft lab abandoned to the flood' : s.valve ? 'Aft lab flood contained' : 'Aft lab flood, valve still open',
      outcome: state.over,
      peakCm: Number(s.peakCm.toFixed(1)),
      valveClosedLabSeconds: state.valveClosedAt == null ? null : Math.round(state.valveClosedAt * TIME_SCALE),
      drainedLabSeconds: state.drainedAt == null ? null : Math.round(state.drainedAt * TIME_SCALE),
      saved: s.saved.map(x => x.name),
      lost: s.lost.map(x => x.name),
      seawater: { time: state.water.time ?? null, sst: state.water.sst, salinity: state.water.salinity, density: Number(state.water.density.toFixed(1)), assumed: Boolean(state.water.assumed) },
    },
  };
}

export function labClock(seconds) {
  const total = Math.max(0, Math.round((seconds ?? 0) * TIME_SCALE));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
