// Wildlife observer: the pure model of a bridge watch. Species and habitats are the eastern Canadian Arctic in
// late summer; the field marks are what a bridge observer can pick out through 7×50 binoculars. The UI in
// crew-14.js only draws state produced here, so a script can drive a watch without a browser.

export const WATCH_SECONDS = 90;
export const FOV = { eye: 90, glass: 12 }; // degrees of horizon across the viewport
export const PAN = { eye: 55, glass: 14 }; // degrees per second while a pan key is held
export const BRIDGE_HEIGHT = 12; // metres, eye height on the bridge wing above the waterline
export const MAX_ACTIVE = 3;
export const POINTS = [0, 10, 15, 25, 40, 60]; // by rarity 1..5
export const WRONG_PENALTY = 10;
export const CUE_TIMES = [0.5, 1.6, 2.9, 4.4]; // seconds steady on the animal before each cue is legible

// Rarity, encounter weights and watch timing tune gameplay; zero weights exclude a species from a lookout.
// cues: four field marks in the order a steadying glass reveals them, coarse to diagnostic.
export const SPECIES = [
  { id: 'fulmar', name: 'Northern fulmar', group: 'bird', rarity: 1, form: 'fulmar', size: 1.05, weights: { open: 3, ice: 2, coast: 1.5, sound: 1.5 }, cues: ['stiff, straight wings', 'thick neck, no black wingtip', 'shearing low over the swell', 'tube on the bill, grey above and white below'] },
  { id: 'kittiwake', name: 'Black-legged kittiwake', group: 'bird', rarity: 1, form: 'gull', size: 0.95, weights: { open: 3, ice: 1, coast: 3, sound: 2 }, cues: ['buoyant, light flight', 'grey mantle, white body', 'wingtips solid black, as if dipped in ink', 'small yellow bill, black legs'] },
  { id: 'glaucous', name: 'Glaucous gull', group: 'bird', rarity: 1, form: 'gull', size: 1.55, weights: { open: 2, ice: 2, coast: 2, sound: 2 }, cues: ['big, heavy gull', 'very pale mantle', 'wingtips white, no black at all', 'pink legs, heavy pale bill'] },
  { id: 'murre', name: 'Thick-billed murre', group: 'bird', rarity: 1, form: 'auk', size: 0.7, weights: { open: 2, ice: 0.5, coast: 4, sound: 1.5 }, cues: ['whirring, fast wingbeats', 'chunky, flying low and straight', 'black above, white below', 'short pointed bill, white line on the gape'] },
  { id: 'guillemot', name: 'Black guillemot', group: 'bird', rarity: 1, form: 'auk', size: 0.55, weights: { open: 0.5, ice: 2.5, coast: 2.5, sound: 2 }, cues: ['small auk, whirring low', 'all dark', 'bold white patch on the wing', 'bright red feet trailing'] },
  { id: 'ivory', name: 'Ivory gull', group: 'bird', rarity: 4, form: 'gull', size: 1.1, weights: { open: 0.15, ice: 1.2, coast: 0, sound: 0.1 }, cues: ['pigeon-like gull', 'entirely white, no grey mantle', 'black legs', 'working the ice edge, dropping to floes'] },
  { id: 'ross', name: "Ross's gull", group: 'bird', rarity: 5, form: 'gull', size: 0.85, weights: { open: 0.1, ice: 0.35, coast: 0, sound: 0 }, cues: ['small, fast, tern-like gull', 'pale grey mantle', 'wedge-shaped tail', 'rosy flush on the breast'] },
  { id: 'sabine', name: "Sabine's gull", group: 'bird', rarity: 4, form: 'gull', size: 0.9, weights: { open: 0.4, ice: 0.1, coast: 0, sound: 0 }, cues: ['small, buoyant gull', 'striking wing pattern', 'three triangles: grey, white, black', 'shallow forked tail'] },
  { id: 'tern', name: 'Arctic tern', group: 'bird', rarity: 2, form: 'tern', size: 0.78, weights: { open: 1.2, ice: 0.2, coast: 1.5, sound: 1.5 }, cues: ['slim, narrow-winged', 'buoyant, dipping to the surface', 'deeply forked tail', 'black cap, red bill'] },
  { id: 'jaeger', name: 'Parasitic jaeger', group: 'bird', rarity: 3, form: 'jaeger', size: 1.15, weights: { open: 0.9, ice: 0.1, coast: 0.6, sound: 0.4 }, cues: ['falcon-like, pointed wings', 'dark, powerful flight', 'white flash at the base of the primaries', 'pointed central tail feathers'] },
  { id: 'phalarope', name: 'Red phalarope', group: 'bird', rarity: 3, form: 'sit', size: 0.4, weights: { open: 0.8, ice: 0.3, coast: 0, sound: 0.1 }, cues: ['tiny, sitting on the water', 'spinning on the spot', 'grey above, white below', 'thick straight bill, dark eye patch'] },
  { id: 'eider', name: 'Common eider', group: 'bird', rarity: 2, form: 'duck', size: 0.95, weights: { open: 0, ice: 0, coast: 1.5, sound: 1 }, cues: ['heavy ducks in a low line', 'fast, shallow wingbeats', 'wedge-shaped head and bill', 'drakes white above, black below'] },
  { id: 'bunting', name: 'Snow bunting', group: 'bird', rarity: 2, form: 'passerine', size: 0.32, weights: { open: 0.3, ice: 0.3, coast: 1.5, sound: 0.8 }, cues: ['small songbird', 'bounding flight', 'large white flashes in the wing', 'buff and white, heading for the deck'] },
  { id: 'raven', name: 'Common raven', group: 'bird', rarity: 1, form: 'raven', size: 1.2, weights: { open: 0, ice: 0, coast: 1.5, sound: 0.5 }, cues: ['all black, broad wings', 'fingered wingtips', 'wedge-shaped tail', 'rolling in the cliff updraught'] },
  { id: 'gyr', name: 'Gyrfalcon', group: 'bird', rarity: 5, form: 'falcon', size: 1.25, weights: { open: 0, ice: 0, coast: 0.3, sound: 0 }, cues: ['big falcon along the cliff', 'broad pointed wings', 'slow, powerful wingbeats', 'pale grey, barred below'] },
  { id: 'ringed', name: 'Ringed seal', group: 'mammal', rarity: 1, form: 'seal', size: 1.3, weights: { open: 1, ice: 3, coast: 2, sound: 2 }, cues: ['a head in the water', 'small, round head', 'big dark eyes, short muzzle', 'slips under with no splash'] },
  { id: 'bearded', name: 'Bearded seal', group: 'mammal', rarity: 2, form: 'seal', size: 2.3, weights: { open: 0, ice: 1.5, coast: 1.5, sound: 0.7 }, cues: ['a large seal', 'long, heavy body', 'square fore-flippers', 'burst of pale whiskers'] },
  { id: 'harp', name: 'Harp seal', group: 'mammal', rarity: 3, form: 'porpoise', size: 1.7, weights: { open: 0.8, ice: 0.4, coast: 0, sound: 0 }, cues: ['a pod porpoising', 'fast, travelling together', 'black face', 'black harp-shaped saddle on a silver back'] },
  { id: 'walrus', name: 'Walrus', group: 'mammal', rarity: 3, form: 'walrus', size: 3, weights: { open: 0, ice: 0.7, coast: 0.7, sound: 0 }, cues: ['a heap on the ice', 'pink-brown, wrinkled', 'two white tusks', 'over shallow water, a clam bed below'] },
  { id: 'bear', name: 'Polar bear', group: 'mammal', rarity: 4, form: 'bear', size: 2.4, weights: { open: 0, ice: 0.7, coast: 0.2, sound: 0 }, cues: ['walking the floe', 'cream-yellow against the ice', 'long neck, small head', 'pigeon-toed, unhurried'] },
  { id: 'bowhead', name: 'Bowhead whale', group: 'mammal', rarity: 4, form: 'whale', size: 16, weights: { open: 0.4, ice: 0.45, coast: 0, sound: 0.5 }, cues: ['a blow, a big back', 'no dorsal fin at all', 'V-shaped bushy blow', 'huge arched jawline, white chin'] },
  { id: 'beluga', name: 'Beluga', group: 'mammal', rarity: 3, form: 'beluga', size: 4.5, weights: { open: 0, ice: 0.3, coast: 0.6, sound: 1.2 }, cues: ['backs rolling in a pod', 'no dorsal fin', 'pure white', 'grey calves alongside'] },
  { id: 'narwhal', name: 'Narwhal', group: 'mammal', rarity: 5, form: 'narwhal', size: 4.5, weights: { open: 0.15, ice: 0.25, coast: 0.05, sound: 0.5 }, cues: ['backs rolling in a pod', 'no dorsal fin', 'mottled grey-brown, small bulbous head', 'a spiral tusk lifted on surfacing'] },
  { id: 'minke', name: 'Minke whale', group: 'mammal', rarity: 3, form: 'whale', size: 8, weights: { open: 0.6, ice: 0, coast: 0, sound: 0.3 }, cues: ['a small, quick back', 'sleek, dark', 'sharply pointed snout', 'falcate dorsal fin late in the roll'] },
  { id: 'orca', name: 'Killer whale', group: 'mammal', rarity: 4, form: 'orca', size: 7, weights: { open: 0.3, ice: 0, coast: 0, sound: 0.3 }, cues: ['tall fins in a pod', 'black and white', 'tall triangular dorsal fin', 'white eye patch, grey saddle'] },
  { id: 'muskox', name: 'Muskox', group: 'mammal', rarity: 3, form: 'muskox', size: 2.3, weights: { open: 0, ice: 0, coast: 0.6, sound: 0 }, cues: ['a dark shape on the slope', 'shaggy, block-like', 'pale saddle on the back', 'down-curved horns'] },
  { id: 'fox', name: 'Arctic fox', group: 'mammal', rarity: 3, form: 'fox', size: 0.9, weights: { open: 0, ice: 0, coast: 0.5, sound: 0.2 }, cues: ['small, on the tideline', 'trotting, short legs', 'bushy tail', 'patchy, turning white for winter'] },
  { id: 'hare', name: 'Arctic hare', group: 'mammal', rarity: 2, form: 'hare', size: 0.65, weights: { open: 0, ice: 0, coast: 0.6, sound: 0.2 }, cues: ['a white spot on the slope', 'sitting upright', 'big ears', 'black ear tips'] },
];
export const speciesById = id => SPECIES.find(s => s.id === id);

// Land sectors are relative bearings (000 = bow); animals on the shore stand inside them, water animals stay out.
export const HABITATS = [
  { id: 'open', name: 'Open water', where: 'Offshore, deep water, a long swell and nothing between the ship and the horizon.', life: 'Tube-noses and kittiwakes work the swell; whales, harp seals and the odd pod of narwhal pass through.', land: [], floes: 0, narwhal: 0.22 },
  { id: 'ice', name: 'Pack edge', where: 'Drift ice, 4 to 7 tenths, leads opening and closing between the floes.', life: 'Seals haul out on the floes, bears walk the edge, ivory gulls follow both.', land: [], floes: 26, narwhal: 0.32 },
  { id: 'coast', name: 'Bird cliffs', where: 'Close under a headland in shallow water, a colony on the ledges above.', life: 'Murres and kittiwakes stream off the cliff, eiders and walrus work the shallows, and things move on the tundra.', land: [{ from: 300, to: 60, kind: 'cliff', dist: 1400 }], floes: 3, narwhal: 0.06 },
  { id: 'sound', name: 'Fjord head', where: 'Deep water in a sound, a glacier front at the head and steep land on both sides.', life: 'Beluga and narwhal summer in the deep sounds and fjords; watch for pale backs and a tusk between the waves.', land: [{ from: 335, to: 25, kind: 'glacier', dist: 2600 }, { from: 60, to: 120, kind: 'low', dist: 3000 }, { from: 240, to: 300, kind: 'low', dist: 3000 }], floes: 5, narwhal: 0.68 },
];
export const habitatById = id => HABITATS.find(h => h.id === id);

// The lookout the ship's own position suggests: ice under the hull, shallow water, or open sea.
export function suggestHabitat(expedition) {
  const tenths = Number(expedition?.ice?.concentration ?? expedition?.ice?.tenths);
  if (Number.isFinite(tenths) && tenths >= 4) return 'ice';
  const depth = Number(expedition?.depth);
  if (Number.isFinite(depth) && depth > 0 && depth < 120) return 'coast';
  return 'open';
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const wrap = deg => ((deg % 360) + 360) % 360;
// Signed difference b − a in (−180, 180].
export const angleDiff = (a, b) => { const d = wrap(b - a); return d > 180 ? d - 360 : d; };
const inSector = (bearing, sector) => sector.from <= sector.to ? bearing >= sector.from && bearing <= sector.to : bearing >= sector.from || bearing <= sector.to;
export const onLand = (habitat, bearing) => habitat.land.find(s => inSector(bearing, s)) || null;
export const poolFor = (habitatId, group) => SPECIES.filter(s => (s.weights[habitatId] || 0) > 0 && (!group || s.group === group));

// Apparent size in degrees, opened up from the true angle so a fulmar at 500 m fills a fair part of the glass
// (about 2°) while a distant seal's head stays a dot to the naked eye.
export const apparentDeg = (size, dist) => 2.2 * Math.sqrt((size / dist) * (180 / Math.PI) * 7);
// Angle below the horizon of the water surface at a distance, from the bridge wing.
export const waterElev = dist => -Math.atan2(BRIDGE_HEIGHT, dist) * (180 / Math.PI);

export function createWatch(habitatId, seed = 1) {
  const habitat = habitatById(habitatId);
  const random = mulberry32(seed);
  const floes = [];
  for (let i = 0; i < habitat.floes; i++) floes.push({ bearing: random() * 360, dist: 350 + random() * 1600, width: 25 + random() * 90, tone: 0.85 + random() * 0.15 });
  const state = {
    habitat, seed, random, floes, t: 0, view: 0, glass: false, animals: [], nextId: 1, nextSpawn: 2.5,
    points: 0, log: [], correct: 0, wrong: 0, missed: 0, seen: new Set(), finished: false,
    focus: null, pending: null, message: null, events: [],
    narwhalAt: random() < habitat.narwhal ? 18 + random() * 55 : null, narwhalSeen: false,
  };
  return state;
}

const pick = (random, list, weight) => {
  const total = list.reduce((sum, item) => sum + weight(item), 0);
  let r = random() * total;
  for (const item of list) { r -= weight(item); if (r <= 0) return item; }
  return list[list.length - 1];
};
const between = (random, lo, hi) => lo + random() * (hi - lo);

const ALOFT = new Set(['fulmar', 'gull', 'auk', 'tern', 'jaeger', 'duck', 'passerine', 'raven', 'falcon']);
const PODS = { porpoise: [3, 6], beluga: [3, 6], narwhal: [2, 4], orca: [2, 4], duck: [3, 6], whale: [1, 1] };

// A water bearing outside every land sector, or a shore bearing inside one.
function bearingFor(state, wantLand) {
  const { habitat, random } = state;
  if (wantLand) {
    const sector = habitat.land[Math.floor(random() * habitat.land.length)];
    const span = wrap(sector.to - sector.from);
    return { bearing: wrap(sector.from + between(random, 0.1, 0.9) * span), sector };
  }
  for (let i = 0; i < 40; i++) {
    const bearing = random() * 360;
    const sector = onLand(habitat, bearing);
    if (!sector) return { bearing, sector: null };
  }
  return { bearing: 180, sector: null };
}

function spawn(state, species) {
  const { habitat, random } = state;
  const shore = ['muskox', 'fox', 'hare'].includes(species.form);
  const haul = (species.form === 'walrus' || species.form === 'bear' || (species.form === 'seal' && habitat.floes > 3 && random() < 0.6));
  const fly = ALOFT.has(species.form);
  const sit = species.form === 'sit';
  const [podLo, podHi] = PODS[species.form] || [1, 1];
  const count = Math.round(between(random, podLo, podHi));
  const { bearing, sector } = bearingFor(state, shore);
  const animal = { id: state.nextId++, species, kind: fly ? 'fly' : shore ? 'shore' : haul ? 'haul' : sit ? 'sit' : 'surface', bearing, t: 0, logged: false, gone: false, count, seed: random() };
  if (shore) {
    animal.dist = sector.dist * between(random, 0.75, 1);
    animal.life = between(random, 18, 30);
    animal.sector = sector;
  } else if (fly) {
    const large = species.size > 1;
    animal.dist = between(random, 160, large ? 700 : 480);
    animal.vel = (random() < 0.5 ? -1 : 1) * between(random, 2.5, 7) * (300 / animal.dist);
    animal.elev = between(random, species.form === 'auk' || species.form === 'duck' ? 0.05 : 0.2, species.form === 'raven' || species.form === 'falcon' ? 3 : 1.4);
    animal.bob = between(random, 0.6, 1.8);
    animal.life = between(random, 9, 16);
  } else if (haul) {
    animal.dist = between(random, 380, 1300);
    animal.life = between(random, 16, 26);
  } else if (sit) {
    animal.dist = between(random, 300, 600);
    animal.life = between(random, 12, 20);
  } else {
    const big = species.size >= 6;
    animal.dist = between(random, big ? 550 : 330, big ? 1700 : 1000);
    animal.vel = (random() < 0.5 ? -1 : 1) * between(random, 0.15, 0.6);
    // Surfacing rhythm: up for a few seconds, down for longer, three times.
    animal.up = species.form === 'seal' ? between(random, 2.5, 4.5) : between(random, 3, 5);
    animal.down = species.form === 'seal' ? between(random, 4, 7) : between(random, 5, 9);
    animal.cycles = 3;
    animal.life = animal.cycles * (animal.up + animal.down) - animal.down;
  }
  state.animals.push(animal);
  state.events.push({ type: 'sighting', animal });
  return animal;
}

export function isUp(animal) {
  if (animal.kind !== 'surface') return true;
  const period = animal.up + animal.down;
  return animal.t % period < animal.up;
}
// Seconds since this surfacing began (surface kind) or since arrival.
export const upFor = animal => (animal.kind === 'surface' ? animal.t % (animal.up + animal.down) : animal.t);

export function toggleGlass(state) {
  state.glass = !state.glass;
  state.focus = null;
}

export function inView(state, animal) {
  const diff = angleDiff(state.view, animal.bearing);
  const half = (state.glass ? FOV.glass : FOV.eye) / 2;
  return Math.abs(diff) <= half ? diff : null;
}

// The animal the glass is on: visible, centred within a quarter of the field, nearest the reticle.
export function target(state) {
  if (!state.glass) return null;
  let best = null, bestDiff = FOV.glass / 4;
  for (const animal of state.animals) {
    if (animal.gone || animal.logged || !isUp(animal)) continue;
    const diff = Math.abs(angleDiff(state.view, animal.bearing));
    if (diff < bestDiff) { best = animal; bestDiff = diff; }
  }
  return best;
}

export const cuesRevealed = focus => (focus ? CUE_TIMES.filter(t => focus.time >= t).length : 0);

export function tick(state, dt, pan = 0) {
  if (state.finished) return;
  state.events.length = 0;
  state.t += dt;
  if (pan) state.view = wrap(state.view + pan * (state.glass ? PAN.glass : PAN.eye) * dt);
  for (const animal of state.animals) {
    if (animal.gone) continue;
    if (state.pending?.animal === animal) continue;
    animal.t += dt;
    if (animal.vel) animal.bearing = wrap(animal.bearing + animal.vel * dt);
    if (animal.t >= animal.life) {
      animal.gone = true;
      if (!animal.logged) { state.missed++; state.events.push({ type: 'gone', animal }); }
    }
  }
  const active = state.animals.filter(a => !a.gone);
  if (state.narwhalAt !== null && state.t >= state.narwhalAt) {
    state.narwhalAt = null;
    spawn(state, speciesById('narwhal'));
  }
  state.nextSpawn -= dt;
  if (state.nextSpawn <= 0 && active.length < MAX_ACTIVE) {
    const pool = poolFor(state.habitat.id).filter(s => s.id !== 'narwhal');
    spawn(state, pick(state.random, pool, s => s.weights[state.habitat.id] / Math.sqrt(s.rarity)));
    state.nextSpawn = between(state.random, 3.5, 7.5);
  }
  const focused = target(state);
  if (!focused) state.focus = null;
  else if (state.focus?.id === focused.id) state.focus.time += dt;
  else state.focus = { id: focused.id, time: 0 };
  if (state.t >= WATCH_SECONDS) finish(state);
}

// Lock the centred animal for identification. Returns the animal, or a reason nothing can be logged.
export function beginLog(state) {
  if (state.finished || state.pending) return { reason: null };
  if (!state.glass) return { reason: 'Raise the binoculars first.' };
  const animal = target(state);
  if (!animal) return { reason: 'Nothing centred in the glass.' };
  state.pending = { animal, cues: cuesRevealed(state.focus) };
  return { animal };
}
export function cancelLog(state) { state.pending = null; }

export function identify(state, speciesId) {
  const pending = state.pending;
  if (!pending || state.finished) return null;
  const { animal } = pending;
  const guess = speciesById(speciesId);
  if (!guess) return null;
  const ok = guess.id === animal.species.id;
  const points = ok ? POINTS[animal.species.rarity] : -WRONG_PENALTY;
  animal.logged = true;
  state.pending = null;
  state.points = Math.max(0, state.points + points);
  if (ok) { state.correct++; state.seen.add(animal.species.id); if (animal.species.id === 'narwhal') state.narwhalSeen = true; } else state.wrong++;
  const entry = { t: state.t, bearing: Math.round(animal.bearing), guess, actual: animal.species, ok, points, count: animal.count, cues: pending.cues };
  state.log.push(entry);
  return entry;
}

export function finish(state) {
  if (state.finished) return state.summary;
  state.finished = true;
  state.pending = null;
  const tally = new Map();
  for (const entry of state.log) if (entry.ok) tally.set(entry.actual.name, (tally.get(entry.actual.name) || 0) + 1);
  state.summary = {
    title: 'Wildlife observer',
    points: state.points,
    habitat: state.habitat.name,
    seconds: Math.round(Math.min(state.t, WATCH_SECONDS)),
    correct: state.correct,
    wrong: state.wrong,
    missed: state.missed + state.animals.filter(a => !a.gone && !a.logged).length,
    speciesCount: state.seen.size,
    species: [...tally].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)),
    narwhal: state.narwhalSeen,
    rarest: [...state.seen].map(speciesById).sort((a, b) => b.rarity - a.rarity)[0]?.name ?? null,
  };
  return state.summary;
}

// "2 o'clock" for a relative bearing.
export const oclock = bearing => { const h = Math.round(wrap(bearing) / 30) % 12; return `${h === 0 ? 12 : h} o’clock`; };
