// Crazy Net: pure tow model. No DOM, no timers; the view calls step(state, input, dt).

export const TOW_SECONDS = 40;
export const TOW_BUDGET = 10;
export const TOW_SPEED = 14;          // metres of water per second past the net mouth
export const WINCH_SPEED = 9;         // vertical metres per second at full winch
export const WIRE_SLEW = 18;          // horizontal metres per second of net lead/lag
export const WIRE_RANGE = 55;         // metres the net can lead or lag its towing point
export const VIEW_WIDTH = 240;        // metres of water across the canvas
export const VIEW_HEIGHT = 60;        // metres of depth down the canvas
export const NET_X = 70;              // towing point, metres from the left edge of the view
export const HITS_TO_TEAR = 3;
export const SPECIES_POINTS = 20;
export const COLLECTION_BONUS = 150;

// Sampling gear. `minMm` is the smallest body length the mesh retains, `mouth` is the opening in
// metres (large evasive animals see a small net coming), `benthic` gear rides the seabed.
export const NETS = [
  { id: 'ring', name: 'Ring net', mesh: '200 µm', minMm: 2, mouth: 0.5, benthic: false, cost: 0, height: 4.5, note: 'Half-metre ring, 200 µm mesh. Copepods and pteropods.' },
  { id: 'wp2', name: 'WP-2', mesh: '63 µm', minMm: 0.5, mouth: 0.57, benthic: false, cost: 50, height: 4.5, note: 'Fine 63 µm mesh keeps the small copepods the ring net extrudes.' },
  { id: 'tucker', name: 'Tucker trawl', mesh: '500 µm', minMm: 5, mouth: 1, benthic: false, cost: 120, height: 7, note: '1 m² opening. Fast enough for amphipods, jellies and juvenile fish.' },
  { id: 'agassiz', name: 'Agassiz trawl', mesh: '1 mm', minMm: 10, mouth: 1.5, benthic: true, cost: 170, height: 5, note: 'Skids along the seabed. Lift it over boulders or it snags.' },
  { id: 'beam', name: 'Beam trawl', mesh: '2 mm', minMm: 20, mouth: 3, benthic: true, cost: 240, height: 6.5, note: '3 m beam. Wide enough for crabs and flatfish that dodge the Agassiz.' },
];

// Habitat keys: 'chl' hugs the fluorescence maximum, 'ice' hangs under keels, 'bottom' sits on the seabed.
// `evade` is the mouth width (m) a net needs before the animal fails to dodge it.
export const SPECIES = [
  { id: 'chyp', name: 'Calanus hyperboreus', common: 'Large Arctic copepod', mm: 7, value: 8, habitat: 'deep', rate: 1.6, shape: 'copepod', color: '#e8a04a', size: 12 },
  { id: 'cgla', name: 'Calanus glacialis', common: 'Shelf copepod', mm: 4, value: 6, habitat: 'chl', rate: 2.2, shape: 'copepod', color: '#f0c070', size: 10 },
  { id: 'metr', name: 'Metridia longa', common: 'Bioluminescent copepod', mm: 3.5, value: 7, habitat: 'deep', rate: 1.2, shape: 'copepod', color: '#9fd3ff', size: 9 },
  { id: 'pseu', name: 'Pseudocalanus spp.', common: 'Small copepod', mm: 1.2, value: 5, habitat: 'chl', rate: 2.4, shape: 'copepod', color: '#d9e6a3', size: 7 },
  { id: 'oith', name: 'Oithona similis', common: 'Cyclopoid copepod', mm: 0.7, value: 5, habitat: 'upper', rate: 2.6, shape: 'copepod', color: '#c8f5e6', size: 6 },
  { id: 'lima', name: 'Limacina helicina', common: 'Sea butterfly', mm: 4, value: 9, habitat: 'chl', rate: 1.3, shape: 'pteropod', color: '#f6d9f0', size: 10 },
  { id: 'clio', name: 'Clione limacina', common: 'Sea angel', mm: 20, value: 12, habitat: 'upper', rate: 0.9, shape: 'angel', color: '#ffb4c8', size: 14 },
  { id: 'agla', name: 'Aglantha digitale', common: 'Hydromedusa', mm: 20, value: 8, habitat: 'upper', rate: 1.0, shape: 'jelly', color: '#d7e8ff', size: 13 },
  { id: 'mert', name: 'Mertensia ovum', common: 'Arctic comb jelly', mm: 40, value: 10, habitat: 'upper', rate: 0.7, shape: 'ctenophore', color: '#cdfaf8', size: 15 },
  { id: 'them', name: 'Themisto libellula', common: 'Hyperiid amphipod', mm: 30, value: 14, habitat: 'mid', rate: 1.1, evade: 1, shape: 'amphipod', color: '#f28d5c', size: 14 },
  { id: 'cod', name: 'Boreogadus saida', common: 'Polar cod, juvenile', mm: 60, value: 20, habitat: 'ice', rate: 0.8, evade: 1, shape: 'fish', color: '#b8c9d6', size: 20 },
  { id: 'gamm', name: 'Gammarus wilkitzkii', common: 'Ice amphipod', mm: 40, value: 18, habitat: 'ice', rate: 0.9, shape: 'amphipod', color: '#8fb96a', size: 14 },
  { id: 'aphe', name: 'Apherusa glacialis', common: 'Ice amphipod', mm: 10, value: 12, habitat: 'ice', rate: 1.1, shape: 'amphipod', color: '#e6efc2', size: 10 },
  { id: 'ophi', name: 'Ophiura sarsii', common: 'Brittle star', mm: 60, value: 10, habitat: 'bottom', rate: 1.6, benthic: true, shape: 'star', color: '#c99a6b', size: 15 },
  { id: 'urch', name: 'Strongylocentrotus pallidus', common: 'Pale sea urchin', mm: 40, value: 10, habitat: 'bottom', rate: 1.0, benthic: true, shape: 'urchin', color: '#b9c49a', size: 13 },
  { id: 'neph', name: 'Nephtys ciliata', common: 'Catworm', mm: 80, value: 8, habitat: 'bottom', rate: 1.2, benthic: true, shape: 'worm', color: '#f0c9a0', size: 14 },
  { id: 'bucc', name: 'Buccinum glaciale', common: 'Glacial whelk', mm: 50, value: 12, habitat: 'bottom', rate: 0.8, benthic: true, shape: 'whelk', color: '#d8b48c', size: 12 },
  { id: 'scul', name: 'Myoxocephalus scorpius', common: 'Shorthorn sculpin', mm: 150, value: 16, habitat: 'bottom', rate: 0.7, benthic: true, evade: 1, shape: 'sculpin', color: '#a48a63', size: 20 },
  { id: 'crab', name: 'Chionoecetes opilio', common: 'Snow crab', mm: 90, value: 22, habitat: 'bottom', rate: 0.6, benthic: true, evade: 1.5, shape: 'crab', color: '#d9835b', size: 18 },
  { id: 'hali', name: 'Reinhardtius hippoglossoides', common: 'Greenland halibut', mm: 300, value: 40, habitat: 'bottom', rate: 0.35, benthic: true, evade: 3, shape: 'flatfish', color: '#7a8a7a', size: 26 },
];

export const speciesById = Object.fromEntries(SPECIES.map(s => [s.id, s]));
export const netById = Object.fromEntries(NETS.map(n => [n.id, n]));

export function makeRandom(seed = 'crazy-net') {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// Why a net does or does not take a species. Returns null when the catch succeeds.
export function catchProblem(net, species) {
  if (Boolean(species.benthic) !== net.benthic) return net.benthic ? 'above the trawl' : 'on the seabed';
  if (species.mm < net.minMm) return `through ${net.mesh} mesh`;
  if (species.evade && net.mouth < species.evade) return 'dodged the net';
  return null;
}

export function canCatch(net, species) { return catchProblem(net, species) === null; }

// Depth of the subsurface fluorescence maximum from a real profile: a 5 dbar running mean over the
// upper 100 m (or the upper 60 % of a shallow column), skipping the top 4 dbar of surface noise.
export function chlorophyllMaximum(profile, bottom) {
  const p = profile?.p, f = profile?.vars?.Fluorescence;
  if (!Array.isArray(p) || !Array.isArray(f)) return { depth: Math.min(25, bottom * 0.3), value: null };
  const limit = Math.min(100, bottom * 0.6);
  let best = -Infinity, depth = 20;
  for (let i = 0; i < p.length && i < f.length; i++) {
    if (!Number.isFinite(p[i]) || p[i] < 4 || p[i] > limit) continue;
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(f.length - 1, i + 2); k++) if (Number.isFinite(f[k])) { sum += f[k]; n += 1; }
    if (!n) continue;
    const mean = sum / n;
    if (mean > best) { best = mean; depth = p[i]; }
  }
  return { depth: Math.round(Math.min(depth, Math.max(5, bottom - 8))), value: best > -Infinity ? best : null };
}

// Station geometry. `cast` is a published CTD cast (bottom_m, p, vars) and `ice` a 0–1 concentration.
export function createStation(seed, cast = null, ice = null) {
  const random = makeRandom(seed);
  const bottom = Number.isFinite(cast?.bottom_m) ? Math.max(40, Math.round(cast.bottom_m)) : Number.isFinite(cast?.max_p) ? Math.round(cast.max_p) + 6 : 120 + Math.round(random() * 280);
  const chl = chlorophyllMaximum(cast, bottom);
  // Floes always drift through: sympagic animals must be reachable at every launch.
  const iceCover = Math.min(0.9, Math.max(0.5, Number.isFinite(ice) ? ice : 0.5 + random() * 0.4));
  return {
    seed: String(seed),
    bottom,
    chlDepth: chl.depth,
    chlValue: chl.value,
    iceCover,
    station: cast?.station || null,
    castId: cast?.id || null,
    temperatureSurface: firstFinite(cast?.vars?.Temperature),
    temperatureBottom: lastFinite(cast?.vars?.Temperature),
  };
}

const firstFinite = list => Array.isArray(list) ? list.find(Number.isFinite) ?? null : null;
const lastFinite = list => Array.isArray(list) ? [...list].reverse().find(Number.isFinite) ?? null : null;

export function createGame(seed, cast = null, ice = null) {
  const station = createStation(seed, cast, ice);
  return {
    station,
    random: makeRandom(`${seed}:tows`),
    credits: 0,
    earned: 0,
    net: 'ring',
    owned: ['ring'],
    collection: {},        // species id -> count in hand (unsold)
    discovered: {},        // species id -> total ever caught
    samples: 0,            // unsold specimens
    towsUsed: 0,
    finished: false,
    tow: null,
    log: [],
  };
}

export function deepLayerTop(station) { return Math.min(station.bottom - 8, Math.max(60, station.bottom * 0.45)); }

export function towsLeft(state) { return TOW_BUDGET - state.towsUsed; }

export function sampleValue(state) {
  return Object.entries(state.collection).reduce((sum, [id, n]) => sum + speciesById[id].value * n, 0);
}

export function speciesCount(state) { return Object.keys(state.discovered).length; }

// Half a point per credit ever caught, plus a bonus per species and one for the full collection.
export function score(state) {
  const species = speciesCount(state);
  return Math.round((state.earned + sampleValue(state)) / 2) + species * SPECIES_POINTS + (species === SPECIES.length ? COLLECTION_BONUS : 0);
}

export function sell(state) {
  const value = sampleValue(state);
  if (!value) return 0;
  state.credits += value;
  state.earned += value;
  state.collection = {};
  state.samples = 0;
  return value;
}

export function buy(state, id) {
  const net = netById[id];
  if (!net || state.owned.includes(id) || state.credits < net.cost || state.tow) return false;
  state.credits -= net.cost;
  state.owned.push(id);
  state.net = id;
  return true;
}

export function select(state, id) {
  if (!state.owned.includes(id) || state.tow) return false;
  state.net = id;
  return true;
}

// Depth range a species occupies at this station.
export function habitatRange(species, station) {
  const b = station.bottom;
  switch (species.habitat) {
    case 'chl': return [Math.max(3, station.chlDepth - 12), Math.min(b - 6, station.chlDepth + 14)];
    case 'upper': return [3, Math.min(b - 6, 90)];
    case 'mid': return [5, Math.min(b - 6, 180)];
    case 'deep': { const top = deepLayerTop(station); return [top, Math.min(b - 6, top + 80)]; }
    case 'ice': return [4, 30];
    case 'bottom': return [b - 1.5, b - 1.5];
    default: return [3, b - 6];
  }
}

// Starts a tow with the net already at `startDepth`; deployment takes no station time.
export function startTow(state, startDepth) {
  if (state.finished || state.tow || towsLeft(state) <= 0) return null;
  const station = state.station;
  const net = netById[state.net];
  const random = state.random;
  const depth = Math.min(station.bottom - 2, Math.max(2, startDepth));
  const length = TOW_SECONDS * TOW_SPEED + VIEW_WIDTH * 2;
  const floes = [];
  // Ice keels hang from the surface; a 1 in 3 keel is a pressure ridge.
  for (let x = VIEW_WIDTH * 0.8; x < length; x += 30 + random() * 80) {
    if (random() > station.iceCover) continue;
    const ridge = random() < 0.33;
    const width = 16 + random() * (ridge ? 50 : 34);
    const keel = Math.min(station.bottom * 0.4, ridge ? 14 + random() * 14 : 4 + random() * 8);
    floes.push({ x, width, keel, ridge });
    x += width;
  }
  const rocks = [];
  for (let x = VIEW_WIDTH; x < length; x += 35 + random() * 110) {
    const outcrop = random() < 0.12;
    const width = outcrop ? 18 + random() * 26 : 5 + random() * 14;
    const height = Math.min(station.bottom * 0.4, outcrop ? 10 + random() * 12 : 2 + random() * 4);
    rocks.push({ x, width, height, outcrop });
    x += width;
  }
  const animals = [];
  const shallowIce = floes.length ? 1 : 0;
  SPECIES.forEach(species => {
    const [top, bottomZ] = habitatRange(species, station);
    if (bottomZ < top) return;
    let count = Math.round(species.rate * (TOW_SECONDS / 10) * (0.7 + random() * 0.6));
    if (species.habitat === 'ice') count = Math.round(count * shallowIce);
    for (let i = 0; i < count; i++) {
      const x = VIEW_WIDTH * 0.6 + random() * (length - VIEW_WIDTH);
      let z = top + random() * (bottomZ - top);
      if (species.habitat === 'ice') {
        const floe = floes[Math.floor(random() * floes.length)];
        if (!floe) continue;
        z = floe.keel + 0.8 + random() * 3.2;
        animals.push({ species: species.id, x: floe.x + random() * floe.width, z, phase: random() * 6.28, taken: false, drift: species.evade ? 4 : 1.2 });
        continue;
      }
      if (species.habitat === 'bottom') {
        const rock = rocks.find(r => x > r.x - 2 && x < r.x + r.width + 2);
        if (rock) continue;
      }
      animals.push({ species: species.id, x, z, phase: random() * 6.28, taken: false, drift: species.evade ? 3 : 0.8 });
    }
  });
  state.tow = {
    net: state.net,
    elapsed: 0,
    distance: 0,
    x: 0,                      // metres of water already towed past the towing point
    netZ: depth,
    netLead: 0,                // metres ahead (+) or behind (−) the towing point
    vz: 0,
    vx: 0,
    floes,
    rocks,
    animals,
    bag: [],                   // specimens in the cod end this tow
    hits: 0,
    torn: false,
    events: [],                // transient labels for the view
    onBottom: false,
    stun: 0,
    done: false,
  };
  return state.tow;
}

function netBox(tow, net) {
  const mouth = net.benthic ? 1.4 : 1;
  const h = net.height;
  const w = 6 * mouth;
  const x = NET_X + tow.netLead;
  return { left: x - w * 0.55, right: x + w * 0.45, top: tow.netZ - h / 2, bottom: tow.netZ + h / 2 };
}

function keelAt(tow, worldX) {
  for (const floe of tow.floes) {
    if (worldX >= floe.x && worldX <= floe.x + floe.width) {
      // Keels taper to their ends; the midpoint is deepest.
      const t = (worldX - floe.x) / floe.width;
      return floe.keel * (0.35 + 0.65 * Math.sin(t * Math.PI));
    }
  }
  return 0;
}

function rockTop(tow, worldX, bottom) {
  let top = bottom;
  for (const rock of tow.rocks) {
    if (worldX >= rock.x && worldX <= rock.x + rock.width) {
      const t = (worldX - rock.x) / rock.width;
      const h = rock.height * (rock.outcrop ? 0.6 + 0.4 * Math.sin(t * Math.PI) : Math.sin(t * Math.PI));
      top = Math.min(top, bottom - h);
    }
  }
  return top;
}

export function keelDepth(tow, worldX) { return keelAt(tow, worldX); }
export function seabedAt(tow, worldX, bottom) { return rockTop(tow, worldX, bottom); }

// Advances the tow. `input` = { up, down, left, right } booleans. Returns the list of events raised.
export function step(state, input, dt) {
  const tow = state.tow;
  if (!tow || tow.done) return [];
  const net = netById[tow.net];
  const station = state.station;
  const raised = [];
  tow.elapsed += dt;
  tow.x += TOW_SPEED * dt;
  tow.distance = tow.x;
  const wantZ = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const wantX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (tow.stun > 0) tow.stun = Math.max(0, tow.stun - dt);
  const control = tow.stun > 0 ? 0.25 : 1;
  tow.vz += (wantZ * WINCH_SPEED * control - tow.vz) * Math.min(1, dt * 6);
  tow.vx += (wantX * WIRE_SLEW * control - tow.vx) * Math.min(1, dt * 5);
  tow.netZ += tow.vz * dt;
  tow.netLead = Math.max(-WIRE_RANGE, Math.min(WIRE_RANGE, tow.netLead + tow.vx * dt));
  const box = netBox(tow, net);
  const worldLeft = tow.x + box.left, worldRight = tow.x + box.right;
  // Benthic gear settles onto the seabed and skids; pelagic gear stops short of it.
  const bed = Math.min(rockTop(tow, worldLeft, station.bottom), rockTop(tow, worldRight, station.bottom), rockTop(tow, tow.x + NET_X + tow.netLead, station.bottom));
  const flat = station.bottom;
  const floor = net.benthic ? flat - net.height / 2 + 0.6 : flat - net.height / 2 - 1;
  if (tow.netZ > floor) { tow.netZ = floor; tow.vz = Math.min(0, tow.vz); }
  if (tow.netZ < 1.5 + net.height / 2) { tow.netZ = 1.5 + net.height / 2; tow.vz = Math.max(0, tow.vz); }
  tow.onBottom = net.benthic && tow.netZ >= floor - 0.3;
  // Collisions: a rock rising into the mouth, or an ice keel reaching down into it. Benthic skids ride over stones under 2 m.
  const boxNow = netBox(tow, net);
  let hit = null;
  if (bed < flat - (net.benthic ? 2 : 0) && boxNow.bottom > bed + (net.benthic ? 0.9 : 0.2)) hit = 'rock';
  const keel = Math.max(keelAt(tow, tow.x + boxNow.left), keelAt(tow, tow.x + boxNow.right), keelAt(tow, tow.x + NET_X + tow.netLead));
  if (keel > 0 && boxNow.top < keel) hit = 'ice';
  if (hit && tow.stun <= 0) {
    tow.hits += 1;
    tow.stun = 1.1;
    const spilled = tow.bag.length;
    tow.bag = [];
    if (hit === 'rock') { tow.netZ = bed - net.height / 2 - 1.5; tow.vz = -4; }
    else { tow.netZ = keel + net.height / 2 + 1.5; tow.vz = 4; }
    const torn = tow.hits >= HITS_TO_TEAR;
    raised.push({ type: 'hit', hit, spilled, torn });
    if (torn) { tow.torn = true; tow.done = true; }
  }
  // Animals drift and small-scale swim; those inside the mouth are tested against the gear.
  const t = tow.elapsed;
  for (const a of tow.animals) {
    if (a.taken) continue;
    const species = speciesById[a.species];
    const sx = a.x - tow.x;
    if (sx < -30) { a.taken = true; continue; }
    if (sx > VIEW_WIDTH + 30) continue;
    a.zNow = species.habitat === 'bottom' ? a.z : a.z + Math.sin(t * 1.3 + a.phase) * a.drift;
    a.xNow = a.x + (species.evade ? Math.sin(t * 0.9 + a.phase) * 3 : 0);
    const inside = a.xNow - tow.x >= boxNow.left && a.xNow - tow.x <= boxNow.right && a.zNow >= boxNow.top && a.zNow <= boxNow.bottom;
    if (!inside || tow.stun > 0) continue;
    a.taken = true;
    const problem = catchProblem(net, species);
    if (problem) { raised.push({ type: 'miss', species: species.id, reason: problem, x: a.xNow - tow.x, z: a.zNow }); continue; }
    tow.bag.push(species.id);
    raised.push({ type: 'catch', species: species.id, x: a.xNow - tow.x, z: a.zNow, first: !state.discovered[species.id] && !tow.bag.slice(0, -1).includes(species.id) });
  }
  if (tow.elapsed >= TOW_SECONDS) { tow.done = true; raised.push({ type: 'end' }); }
  return raised;
}

// Hauls the net: the cod end empties into the collection unless the net tore.
export function haul(state) {
  const tow = state.tow;
  if (!tow) return null;
  const counts = {};
  if (!tow.torn) {
    for (const id of tow.bag) {
      counts[id] = (counts[id] || 0) + 1;
      state.collection[id] = (state.collection[id] || 0) + 1;
      state.discovered[id] = (state.discovered[id] || 0) + 1;
      state.samples += 1;
    }
  }
  state.towsUsed += 1;
  const result = { net: tow.net, seconds: Math.round(tow.elapsed), torn: tow.torn, hits: tow.hits, counts, specimens: tow.torn ? 0 : tow.bag.length, value: Object.entries(counts).reduce((s, [id, n]) => s + speciesById[id].value * n, 0) };
  state.log.push(result);
  state.tow = null;
  return result;
}

export function finish(state) {
  if (state.finished) return null;
  if (state.tow) haul(state);
  state.finished = true;
  const species = speciesCount(state);
  const points = score(state);
  return {
    points,
    detail: {
      title: `Crazy Net · ${species}/${SPECIES.length} species · ${points} pts`,
      station: state.station.station,
      castId: state.station.castId,
      bottomM: state.station.bottom,
      tows: state.towsUsed,
      credits: state.earned,
      species,
      nets: state.owned,
      catches: Object.fromEntries(Object.entries(state.discovered).map(([id, n]) => [speciesById[id].name, n])),
    },
  };
}
