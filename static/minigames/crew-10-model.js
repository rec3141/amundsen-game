// Flooding model for the aft lab. Each launch draws a cause (a blown loop fitting, a hose left in a
// sink, a scupper blocked with bubble wrap, a rosette tote tipped by a roll, a cracked incubation
// tank), seven pieces of gear from a pool, and a deck layout, all from one seed. The deck fills like
// a tank; a scientist walks, wades, shuts the water off, clears the drain, starts the pump and lifts
// gear onto the bench. Pure functions over a plain state object; the UI drives it with step(state, dt).

export const AREA_M2 = 40;          // deck area that the water spreads over
export const TIME_SCALE = 20;       // lab seconds per real second
export const PUMP_FLOW = 0.005;     // m³/s from the sump pump once it has water to pull
export const PUMP_MIN_M = 0.01;     // the pump loses prime below this depth
export const SCUPPER_AREA = 0.005;  // m², one 8 cm deck drain
export const DISCHARGE = 0.6;       // orifice coefficient for the scupper and for a tank crack
export const ABANDON_M = 0.5;       // the watch shuts the watertight door at this depth
export const DRAINED_M = 0.01;      // below this the deck is squeegee work, not flooding
export const TIME_LIMIT = 120;      // real seconds before the deck watch takes over
export const G = 9.81;
export const ROLL_PEAK_DEG = 7;     // the opening roll, when the cause is a roll
export const ROLL_SETTLE_S = 1.6;   // real seconds for the hard roll to ring down
export const ROLL_AMBIENT_DEG = 1.4;// the ship keeps rolling gently underneath everything
export const ROLL_PERIOD_S = 7;     // real seconds per ambient roll, a visual cadence
export const LAPTOP_FALL_S = 0.32;  // real seconds from bench edge to deck
export const ITEMS_PER_RUN = 7;
export const KEYS = '1234567890';   // station hotkeys, left to right along the lab

const BASE_SPEED = 620;             // scene units per second on a dry deck (scene is 1000 wide)
const TURN_SECONDS = 0.45;          // one quarter turn on a handwheel
const SLOT_LEFT = 80, SLOT_RIGHT = 930;

// Gear that can be on the deck when the water arrives. mass in kg, footprint in m², dieAt is the depth
// in metres that finishes electronics, tipAfter is seconds afloat before a top-heavy load goes over.
// `safe` gear keeps its points wherever it is; `herring` gear is worth nothing to anyone. `sinks`
// gear is too dense to float on this deck. The laptop is the one thing that falls in the opening roll.
export const ITEM_POOL = [
  { id: 'laptop', name: 'Field laptop', verb: 'Put it back on the bench', work: 0.5, mass: 2, footprint: 0.09, dieAt: 0.02, points: 30, falls: true, owner: 'Runs the CTD deck unit; it was living at the bench edge.' },
  { id: 'power', name: 'Power bar', verb: 'Hang it up', work: 0.5, mass: 1.5, footprint: 0.02, dieAt: 0.05, points: 15, kills: 'lights', owner: 'Feeds the whole port bench from one outlet.' },
  { id: 'crate', name: 'Niskin sample crate', verb: 'Heave onto the bench', work: 2.0, mass: 30, footprint: 0.24, tipAfter: 2.5, points: 40, owner: "This morning's cast: twelve bottles, not yet filtered.", spill: 'Twelve Niskin samples gone into the flood.' },
  { id: 'filtration', name: 'Chlorophyll filtration rig', verb: 'Lift the manifold up', work: 1.2, mass: 6, footprint: 0.12, dieAt: 0.08, points: 25, owner: 'Vacuum pump and six-place manifold; the pump motor sits at the bottom.' },
  { id: 'dewar', name: 'Liquid nitrogen dewar', verb: 'Walk it to the bench', work: 1.8, mass: 12, footprint: 0.07, tipAfter: 1.8, points: 35, owner: 'The only thing aboard cold enough for the RNA samples.', spill: 'The dewar rolls over. Ten litres of nitrogen boil off across the water.' },
  { id: 'shipper', name: 'Dry-ice shipper', verb: 'Lift it up', work: 0.8, mass: 4, footprint: 0.15, tipAfter: 2.0, points: 35, owner: 'Foam box: two weeks of frozen filters under five kilos of dry ice.', spill: 'The foam shipper capsizes; the lid comes off and the sample bags go swimming.' },
  { id: 'microscope', name: 'Stereo microscope', verb: 'Carry it up', work: 1.0, mass: 9, footprint: 0.06, dieAt: 0.10, points: 30, owner: 'The illuminator transformer is in the base.' },
  { id: 'cordreel', name: 'Extension cord reel', verb: 'Reel it in and hang it', work: 0.7, mass: 3, footprint: 0.06, dieAt: 0.04, points: 10, owner: 'Live, and running to the incubator.' },
  { id: 'formalin', name: 'Formalin carboy', verb: 'Lift the carboy', work: 1.0, mass: 4.5, footprint: 0.03, tipAfter: 1.5, points: 20, owner: 'Four per cent, for the zooplankton splits.', spill: 'Four litres of formalin go into the flood. The lab will smell of it for a week.' },
  { id: 'filters', name: 'Box of GF/F filters', verb: 'Grab the box', work: 0.4, mass: 0.5, footprint: 0.04, dieAt: 0.015, points: 20, owner: 'Pre-combusted at 450 °C for four hours: a week of muffle-furnace time.' },
  { id: 'printer', name: 'Label printer', verb: 'Lift it', work: 0.5, mass: 1.2, footprint: 0.03, dieAt: 0.04, points: 10, owner: 'Every vial label on the cruise comes out of it.' },
  { id: 'cooler', name: 'Live zooplankton cooler', verb: 'Drag it onto the bench', work: 2.2, mass: 15, footprint: 0.2, tipAfter: 3.0, points: 30, owner: 'Fresh from the net tow, waiting for the incubator.', spill: "The cooler goes over. Tonight's copepods are in the flood with everything else." },
  { id: 'peristaltic', name: 'Peristaltic pump', verb: 'Lift the pump', work: 0.8, mass: 5, footprint: 0.05, dieAt: 0.07, points: 20, owner: 'Draws the incubation water; motor on the bottom.' },
  { id: 'battery', name: 'CTD battery pack', verb: 'Lift the pack', work: 0.6, mass: 3, footprint: 0.04, dieAt: 0.06, points: 25, owner: 'Spare lithium pack for the rosette. Salt water and lithium: no.' },
  { id: 'iapso', name: 'IAPSO standard seawater', verb: 'Lift the case', work: 0.6, mass: 2, footprint: 0.06, tipAfter: 2.0, points: 25, owner: 'The salinometer calibrates against it.', spill: 'The case tips: ampoules everywhere, half of them broken.' },
  { id: 'drive', name: 'External hard drive', verb: 'Grab the drive', work: 0.3, mass: 0.2, footprint: 0.01, dieAt: 0.02, points: 40, owner: 'Labelled CTD PROCESSING, DO NOT UNPLUG. The only copy, allegedly.' },
  { id: 'ups', name: 'UPS', verb: 'Heave it up', work: 1.6, mass: 14, footprint: 0.1, dieAt: 0.06, points: 20, owner: 'Backs up the salinometer; vents along the bottom.' },
  { id: 'fluorometer', name: 'Benchtop fluorometer', verb: 'Lift it up', work: 1.0, mass: 7, footprint: 0.05, dieAt: 0.09, points: 30, owner: 'Reads the chlorophyll extracts. Borrowed from another lab.' },
  { id: 'pelican', name: 'Pelican case', verb: 'Lift to the bench', work: 1.5, mass: 8, footprint: 0.2, points: 20, safe: true, owner: 'Sealed and latched. Built to float.' },
  { id: 'rbr', name: 'RBR logger', verb: 'Pick it up', work: 0.4, mass: 1.2, footprint: 0.01, points: 15, safe: true, sinks: true, owner: 'Rated to 750 m. It is fine on the deck.' },
  { id: 'notebook', name: 'Field notebook', verb: 'Pick it up', work: 0.3, mass: 0.3, footprint: 0.02, points: 15, safe: true, owner: 'Rite in the Rain. That was the whole idea.' },
  { id: 'weights', name: 'Dive weight belt', verb: 'Heave it up', work: 1.4, mass: 12, footprint: 0.03, points: 0, herring: true, sinks: true, owner: 'Lead. It does not care.' },
  { id: 'recycling', name: 'Box marked RECYCLING', verb: 'Lift it', work: 0.5, mass: 0.8, footprint: 0.2, dieAt: 0.01, points: 0, herring: true, owner: 'Flattened cardboard, headed for the bin anyway.' },
  { id: 'bubblewrap', name: 'Bag of bubble wrap', verb: 'Grab the bag', work: 0.3, mass: 0.4, footprint: 0.15, points: 0, herring: true, owner: 'Packing from the last mobilisation.' },
  { id: 'mop', name: 'Mop bucket', verb: 'Lift the bucket', work: 0.5, mass: 2, footprint: 0.08, points: 0, herring: true, owner: 'Yellow, on wheels, already full of the flood.' },
  { id: 'lunchcooler', name: 'Empty cooler', verb: 'Lift it', work: 0.6, mass: 3, footprint: 0.18, points: 0, herring: true, owner: "Somebody's lunch cooler. Empty since Resolute." },
];

// How the water gets in, where it is stopped, and what is over the drain. `flow` is the full-open rate
// in m³/s; a gate fix is a handwheel with several turns and a quick-opening characteristic, a ball fix
// is one quarter-turn lever. `start` is water already on the deck when the alarm goes. A slug is a
// volume dumped over the first seconds; a tank keeps leaking through its crack after the feed is shut.
export const CAUSES = [
  {
    id: 'fitting', name: 'blown loop fitting', roll: true, flow: 0.040, start: 0,
    headline: 'One hard roll, and the seawater loop let go.',
    blurb: 'The roll blew a fitting off the flow-through line.',
    opening: 'Hard roll to starboard. The loop fitting lets go',
    fix: { id: 'valve', name: 'Loop valve', verb: 'Turn the handwheel', kind: 'gate', turns: [7, 10], done: 'The line is quiet; now get the water off the deck.' },
    clog: { name: 'Scupper', verb: 'Clear the drain', what: 'cable ties and tape', work: [0.8, 1.6], done: 'Scupper clear: cable ties and tape out. It drains faster the deeper the water.' },
  },
  {
    id: 'hose', name: 'hose in the sink', roll: false, flow: 0.014, start: 0.03,
    headline: 'Somebody left the wash-down hose running in the sink.',
    blurb: 'The sink overflowed a while ago and the deck has been filling quietly since.',
    opening: 'Water over the sink rim and across the deck: the wash-down hose is still running',
    fix: { id: 'tap', name: 'Wash-down tap', verb: 'Shut the tap', kind: 'ball', work: 0.9, done: 'Tap shut. The sink gurgles down; the deck is yours.' },
    clog: { name: 'Scupper', verb: 'Pull the mat off', what: 'a deck mat washed over the grate', work: [1.0, 1.6], done: 'Deck mat off the grate. It drains faster the deeper the water.' },
  },
  {
    id: 'scupper', name: 'scupper blocked with bubble wrap', roll: false, flow: 0.005, start: 0.04,
    headline: 'The loop discharge is backing up over a blocked scupper.',
    blurb: 'Bubble wrap from the last mobilisation is over the grate, and the flow-through discharge has nowhere to go but the deck.',
    opening: 'The discharge is welling up out of a scupper packed with bubble wrap',
    fix: { id: 'discharge', name: 'Discharge valve', verb: 'Shut the discharge', kind: 'ball', work: 0.9, done: 'Discharge shut. Nothing more comes up the drain, and the TSG has stopped logging until it opens again.' },
    clog: { name: 'Scupper', verb: 'Dig the wrap out', what: 'bubble wrap', work: [2.4, 3.2], stops: true, done: 'Bubble wrap out. The discharge goes back down the drain and the deck with it.' },
  },
  {
    id: 'rosette', name: 'rosette tote tipped in a roll', roll: true, flow: 0.008, start: 0, slug: { volume: 1.0, seconds: 1.5 },
    headline: 'A roll put the rosette rinse tote on its side.',
    blurb: 'A thousand litres went across the deck at once, and the tote feed is still running.',
    opening: 'Hard roll to port. The rinse tote goes over and a thousand litres comes with it',
    fix: { id: 'feed', name: 'Tote feed tap', verb: 'Shut the feed', kind: 'ball', work: 1.0, done: 'Feed shut. What is on the deck is all there will be.' },
    clog: { name: 'Tote on the drain', verb: 'Shift the tote off', what: 'the tote itself', work: [2.0, 2.6], done: 'Tote dragged clear of the scupper. It drains faster the deeper the water.' },
  },
  {
    id: 'aquarium', name: 'cracked incubation tank', roll: false, flow: 0.006, start: 0, tank: { volume: 0.6, area: 1.0, crack: 0.002 },
    headline: 'The incubation tank has split along a seam.',
    blurb: 'Six hundred litres of loop water is leaving through the crack, and the feed keeps topping it up.',
    opening: 'The incubation tank splits along its seam and starts emptying across the deck',
    fix: { id: 'tankvalve', name: 'Tank feed valve', verb: 'Turn the handwheel', kind: 'gate', turns: [4, 6], done: 'Feed shut. The tank still has to empty through the crack before the deck can dry.' },
    clog: { name: 'Scupper', verb: 'Rake the weed off', what: 'weed out of the tank', work: [1.0, 1.6], done: 'Weed off the grate. It drains faster the deeper the water.' },
  },
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

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
const between = (random, [lo, hi]) => lo + random() * (hi - lo);

// Seven pieces of gear: one red herring, one thing that is safe where it is, five worth saving.
// Gear that the water already on the deck would have finished, or set afloat, is not dealt.
export function drawItems(random, start = 0) {
  const doomed = i => (i.dieAt && i.dieAt <= start + 0.01) || (!i.sinks && i.mass / (1020 * i.footprint) <= start + 0.005);
  const valued = shuffle(ITEM_POOL.filter(i => !i.safe && !i.herring && !doomed(i)), random);
  const safe = shuffle(ITEM_POOL.filter(i => i.safe), random);
  const herring = shuffle(ITEM_POOL.filter(i => i.herring), random);
  return shuffle([herring[0], safe[0], ...valued.slice(0, ITEMS_PER_RUN - 2)], random);
}

// Ten evenly spaced slots across the lab, jittered and dealt out in random order. The two benches
// run along the wall behind the gear; the door and its bulkhead sit in the widest gap between them.
export function layout(random, count) {
  const pitch = (SLOT_RIGHT - SLOT_LEFT) / (count - 1);
  const slots = Array.from({ length: count }, (_, i) => Math.round(SLOT_LEFT + i * pitch + (random() - 0.5) * pitch * 0.35));
  return shuffle(slots, random);
}

// The door goes in the widest gap between stations (or at an end of the room); a bench runs behind
// the gear on each side of it, stopping short of the door frame.
export function furnish(stations) {
  const xs = stations.map(s => s.x);
  const gaps = [[0, xs[0]], ...xs.slice(1).map((x, i) => [xs[i], x]), [xs[xs.length - 1], 1000]];
  const widest = gaps.reduce((best, g) => g[1] - g[0] > best[1] - best[0] ? g : best);
  const doorX = Math.max(40, Math.min(960, Math.round((widest[0] + widest[1]) / 2)));
  const benches = [];
  const left = stations.filter(s => s.item && s.x < doorX), right = stations.filter(s => s.item && s.x > doorX);
  if (left.length) benches.push([Math.max(0, left[0].x - 45), Math.min(left[left.length - 1].x + 45, doorX - 38)]);
  if (right.length) benches.push([Math.max(right[0].x - 45, doorX + 38), Math.min(1000, right[right.length - 1].x + 45)]);
  return { doorX, benches };
}

export function createFlood(seed, seawater, options = {}) {
  const random = mulberry(seed ?? 1);
  const water = seawater && Number.isFinite(seawater.sst) && Number.isFinite(seawater.salinity)
    ? { ...seawater }
    : { sst: -0.9, salinity: 27.7, time: null, assumed: true };
  water.density = density(water.salinity, water.sst);
  water.freezing = freezingPoint(water.salinity);
  const choices = CAUSES.filter(c => c.id !== options.avoid);
  const cause = choices[Math.floor(random() * choices.length)];
  const items = drawItems(random, cause.start);
  const stations = [];
  const fix = { id: cause.fix.id, name: cause.fix.name, verb: cause.fix.verb, fix: true, kind: cause.fix.kind, progress: 0, done: false };
  if (cause.fix.kind === 'gate') { fix.turns = Math.round(between(random, cause.fix.turns)); fix.work = fix.turns * TURN_SECONDS; }
  else { fix.turns = 1; fix.work = cause.fix.work; }
  stations.push(fix);
  stations.push({ id: 'pump', name: 'Sump pump', verb: 'Start the pump', work: 0.4, progress: 0, done: false });
  stations.push({ id: 'scupper', name: cause.clog.name, verb: cause.clog.verb, scupper: true, work: Math.round(between(random, cause.clog.work) / 0.2) * 0.2, progress: 0, done: false });
  for (const i of items) {
    stations.push({
      ...i, item: true, progress: 0, done: false, place: 'deck', afloat: 0, drift: 0, lost: null,
      // Archimedes: a box lifts off the deck once the water it displaces weighs as much as it does.
      draft: i.sinks ? Infinity : i.mass / (water.density * i.footprint),
      fell: Boolean(i.falls && cause.roll),
    });
  }
  const slots = layout(random, stations.length);
  stations.forEach((s, i) => { s.x = slots[i]; });
  stations.sort((a, b) => a.x - b.x);
  stations.forEach((s, i) => { s.key = KEYS[i]; });
  const { doorX, benches } = furnish(stations);
  const fell = stations.find(s => s.fell);
  const opening = `${cause.opening}${fell ? `, and somebody's ${fell.name.toLowerCase()} goes off the bench with it.` : '.'}`;
  return {
    seed, water, cause, stations, benches, doorX,
    alarm: Boolean(options.alarm),
    t: 0, level: cause.start, peak: cause.start, inflow: 0, outflow: 0,
    tank: cause.tank ? { volume: cause.tank.volume } : null,
    slugLeft: cause.slug ? cause.slug.volume : 0,
    player: { x: doorX, target: null, pending: false, working: null },
    lights: true, fixedAt: null, drainedAt: null,
    over: null,
    events: [{ type: 'roll', text: opening }],
  };
}

// Roll angle of the ship in degrees at real time t: the opening lurch ringing down when the cause was
// a roll, then a gentle ambient roll. Positive tilts the deck down to the right of the scene.
export function rollAt(t, hard = true) {
  const ring = hard ? ROLL_PEAK_DEG * Math.exp(-t / (ROLL_SETTLE_S / 3)) * Math.cos((t / ROLL_SETTLE_S) * Math.PI * 2.5) : 0;
  return ring + ROLL_AMBIENT_DEG * Math.sin((t / ROLL_PERIOD_S) * Math.PI * 2);
}

export const station = (state, id) => state.stations.find(s => s.id === id);
export const fixStation = state => state.stations.find(s => s.fix);
export const closure = state => Math.min(1, fixStation(state).progress / fixStation(state).work);
// A gate valve passes most of its flow until the last turns; a ball valve is nearly as blunt.
export const opening = state => fixStation(state).kind === 'gate' ? Math.sqrt(Math.max(0, 1 - closure(state))) : 1 - closure(state) ** 2;
export const wadingFactor = level => 1 / (1 + (level / 0.25) ** 1.5);
export const nearest = state => state.stations.reduce((best, s) => Math.abs(s.x - state.player.x) < Math.abs(best.x - state.player.x) ? s : best);
export const atStation = (state, s) => Math.abs(s.x - state.player.x) < 3;
export const scupperClear = state => station(state, 'scupper').done;

// Water arriving on the deck right now, m³/s, before any drain. The tank's crack and a tipped tote's
// slug are added by step(), which owns their volumes.
export function inflowAt(state) {
  const c = state.cause;
  if (c.id === 'scupper') return scupperClear(state) ? 0 : c.flow * opening(state);
  if (c.tank) return 0;
  return c.flow * opening(state);
}

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
  const c = state.cause;
  if (s.fix) {
    state.fixedAt = state.t;
    state.events.push({ type: 'valve', text: `${s.kind === 'gate' ? `Valve shut after ${s.turns} turns.` : `${s.name} shut.`} ${c.fix.done}` });
  } else if (s.id === 'pump') state.events.push({ type: 'pump', text: state.level >= PUMP_MIN_M ? 'Sump pump running.' : 'Sump pump switched on. It needs a centimetre of water to pull.' });
  else if (s.scupper) {
    if (c.clog.stops && state.fixedAt == null) state.fixedAt = state.t;
    state.events.push({ type: c.clog.stops ? 'valve' : 'scupper', text: c.clog.done });
  }
  else if (s.item) {
    s.place = 'bench';
    const text = s.herring ? `${s.name} on the bench. ${s.owner}` : s.safe ? `${s.name} on the bench. ${s.owner}` : s.fell ? `${s.name} back on the bench, dry. Its owner need never know it was on the floor.` : `${s.name} on the bench, dry.`;
    state.events.push({ type: 'saved', text });
  }
}

export function step(state, dt) {
  if (state.over || !(dt > 0)) return state.events;
  dt = Math.min(dt, 0.1);
  state.t += dt;
  const player = state.player;
  const level = state.level;
  const c = state.cause;
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
  let inflow = inflowAt(state);
  if (state.slugLeft > 0) {
    // A tipped tote empties over the first seconds of the run.
    const rate = c.slug.volume / (c.slug.seconds * TIME_SCALE);
    const dumped = Math.min(state.slugLeft, rate * labDt);
    state.slugLeft -= dumped;
    inflow += dumped / labDt;
  }
  if (state.tank) {
    // Torricelli through the crack; the feed refills the tank and the surplus runs over its rim.
    const tank = state.tank;
    const head = tank.volume / c.tank.area;
    const leak = tank.volume > 0 ? DISCHARGE * c.tank.crack * Math.sqrt(2 * G * head) : 0;
    const feed = c.flow * opening(state);
    let volume = tank.volume + (feed - leak) * labDt;
    let overflow = 0;
    if (volume > c.tank.volume) { overflow = (volume - c.tank.volume) / labDt; volume = c.tank.volume; }
    if (volume < 0) volume = 0;
    // Everything that left the tank, through the crack or over the rim, is on the deck.
    inflow += (tank.volume + feed * labDt - volume) / labDt;
    tank.volume = volume;
  }
  const pumpOn = station(state, 'pump').done;
  let outflow = 0;
  if (scupperClear(state) && state.level > 0) outflow += DISCHARGE * SCUPPER_AREA * Math.sqrt(2 * G * state.level);
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
      if (s.kills === 'lights') { state.lights = false; state.events.push({ type: 'lost', text: 'Power bar under water: the breaker trips. Emergency lighting only.' }); }
      else if (s.herring) state.events.push({ type: 'afloat', text: `${s.name} is soaked through. Nobody will miss it.` });
      else state.events.push({ type: 'lost', text: s.fell ? `${s.name} is under water. Its owner is going to ask why it was on the floor.` : `${s.name} is under water. ${s.owner}` });
      if (player.working === s.id) player.working = null;
      continue;
    }
    if (state.level >= s.draft) {
      if (s.afloat === 0) state.events.push({ type: 'afloat', text: s.safe ? `The ${s.name.toLowerCase()} is floating. ${s.owner}` : `${s.name} is afloat at ${cm(s.draft)} cm and drifting.` });
      s.afloat += dt;
      s.drift = Math.sin(s.afloat * 1.3) * 25;
      if (s.tipAfter && s.afloat >= s.tipAfter) {
        s.place = 'lost'; s.lost = 'tipped';
        state.events.push({ type: 'lost', text: `${s.name} tipped over. ${s.spill}` });
        if (player.working === s.id) player.working = null;
      }
    }
  }
  if (state.level >= ABANDON_M) end(state, 'abandoned', 'Half a metre on the deck. The watch dogs the watertight door with you on the dry side.');
  else if (contained(state) && state.level < DRAINED_M) end(state, 'drained', 'Deck down to a film. Squeegees from here.');
  else if (state.t >= TIME_LIMIT) end(state, 'relieved', 'The deck watch takes over the lab.');
  return state.events;
}

// No more water is coming: the fix is done (or the blocked scupper is clear), the tote has emptied
// and the cracked tank has run dry.
export function contained(state) {
  const stopped = fixStation(state).done || (state.cause.clog.stops && scupperClear(state));
  return stopped && state.slugLeft <= 0 && (!state.tank || state.tank.volume <= 0);
}

function end(state, reason, text) {
  state.over = reason;
  state.player.working = null;
  state.player.target = null;
  if (reason === 'drained') state.drainedAt = state.t;
  state.events.push({ type: 'end', text });
}

// An item counts as saved when it is dry on the bench, or when it never needed lifting and is not lost.
export const isSaved = s => s.place === 'bench' || (s.safe && s.place !== 'lost');

export function summary(state) {
  const items = state.stations.filter(s => s.item);
  const saved = items.filter(s => isSaved(s) && s.points > 0);
  const lost = items.filter(s => s.place === 'lost' || (s.place === 'deck' && !s.safe && s.points > 0 && state.over));
  const fix = fixStation(state);
  const stopped = fix.done || (state.cause.clog.stops && scupperClear(state));
  const peakCm = Math.round(state.peak * 1000) / 10;
  const lines = [
    { label: 'Water stopped', points: stopped ? 40 : 0, note: stopped ? `${fix.done ? (fix.kind === 'gate' ? `${fix.turns} turns` : `${fix.name.toLowerCase()} shut`) : 'scupper cleared'}, ${labClock(state.fixedAt)} on the lab clock` : 'still running' },
    ...items.map(s => ({
      label: s.name,
      points: isSaved(s) ? s.points : 0,
      note: s.herring ? (s.place === 'bench' ? 'lifted, for what it was worth' : s.place === 'lost' ? 'soaked, no loss' : 'left where it lay, rightly')
        : s.safe ? (s.place === 'bench' ? 'lifted; it did not need to be' : s.afloat > 0 ? 'floated, unharmed' : 'fine where it was')
        : s.place === 'bench' ? (s.fell ? 'back on the bench, dry' : 'dry on the bench')
        : s.lost === 'tipped' ? 'tipped while afloat, contents lost'
        : s.lost === 'wet' ? (s.fell ? 'flooded where the roll left it' : 'flooded on the deck')
        : 'left on the deck',
    })),
    { label: 'Deck drained', points: state.over === 'drained' ? 25 : 0, note: state.over === 'drained' ? `${labClock(state.drainedAt)} on the lab clock` : 'not before the watch arrived' },
    { label: 'Peak depth', points: peakCm < 10 ? 25 : peakCm < 20 ? 10 : 0, note: `${peakCm.toFixed(1)} cm` },
  ];
  const points = lines.reduce((sum, line) => sum + line.points, 0);
  const savedCount = items.filter(isSaved).length;
  return { points, lines, saved, lost, stopped, peakCm, savedCount, total: items.length };
}

export function result(state) {
  const s = summary(state);
  const prefix = state.alarm ? 'Aft lab flood' : 'Aft lab flood drill';
  const outcome = state.over === 'abandoned' ? 'abandoned' : s.stopped ? `saved ${s.savedCount} of ${s.total}` : `water still running, saved ${s.savedCount} of ${s.total}`;
  return {
    points: s.points,
    detail: {
      title: `${prefix}: ${state.cause.name} · ${outcome}`,
      cause: state.cause.id,
      alarm: state.alarm,
      outcome: state.over,
      peakCm: Number(s.peakCm.toFixed(1)),
      stoppedLabSeconds: state.fixedAt == null ? null : Math.round(state.fixedAt * TIME_SCALE),
      drainedLabSeconds: state.drainedAt == null ? null : Math.round(state.drainedAt * TIME_SCALE),
      saved: s.saved.map(x => x.name),
      lost: s.lost.map(x => x.name),
      seawater: { time: state.water.time ?? null, sst: state.water.sst, salinity: state.water.salinity, density: Number(state.water.density.toFixed(1)), assumed: Boolean(state.water.assumed) },
    },
  };
}

// Centimetres for a depth in metres: one decimal below a centimetre, whole above.
export const cm = m => (m * 100).toFixed(m < 0.01 ? 1 : 0);

export function labClock(seconds) {
  const total = Math.max(0, Math.round((seconds ?? 0) * TIME_SCALE));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
