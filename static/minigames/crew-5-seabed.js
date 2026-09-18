// Seep-Seeker seabed: a survey grid over a pockmarked Arctic shelf. Every site owns a layered
// sediment column with finds hidden at depth; one pockmark vents methane, and the survey is won
// by coring straight down into its gas hydrate. Depths are centimetres below the seafloor.
export const COLUMNS = 9;
export const ROWS = 6;
export const SHIP_HOURS = 40;
export const SEEP_BONUS = 500;
const LETTERS = 'ABCDEFGHI';

// Unlock thresholds are cumulative science points; ship time is what each deployment costs.
export const CORERS = [
  { id: 'spoon', name: 'Spoon', reachCm: 10, hours: 1, unlock: 0, glyph: 'S', note: 'A dessert spoon lashed to the hydro wire. It skims the surface fluff.' },
  { id: 'box', name: 'Box core', reachCm: 50, hours: 2, unlock: 40, glyph: 'B', note: 'A 50 cm box of undisturbed seafloor and whatever lives in it. Lands on carbonate crust.' },
  { id: 'gravity', name: 'Gravity core', reachCm: 300, hours: 3, unlock: 120, glyph: 'G', note: 'A weighted 3 m barrel dropped from the A-frame. Bounces off sand, crust and till.' },
  { id: 'piston', name: 'Piston core', reachCm: 1200, hours: 5, unlock: 300, glyph: 'P', note: 'A 12 m barrel fired into the mud behind a piston. Punches thin sand; refuses in till.' },
  { id: 'drill', name: 'Drillship', reachCm: 40000, hours: 12, unlock: 600, glyph: 'D', note: 'A drilling vessel alongside for a day: 400 m, through the till and into bedrock.' },
];

// How far each corer gets into a layer it cannot pass; undefined means it passes through.
const STOPS = {
  box: { carbonate: 0 },
  gravity: { sand: 10, carbonate: 5, till: 20 },
  piston: { sand: (layer) => layer.bottom - layer.top > 40 ? 40 : undefined, till: 20 },
};

export const LAYERS = {
  fluff: { name: 'Oxidised surface mud', ka: [0, 0.3] },
  mud: { name: 'Holocene marine mud', ka: [0.3, 11.7] },
  sand: { name: 'Sand lens', ka: null },
  carbonate: { name: 'Authigenic carbonate crust', ka: null },
  laminated: { name: 'Deglacial laminated silty clay', ka: [11.7, 14.5] },
  pink: { name: 'Detrital carbonate bed', ka: null },
  ird: { name: 'Ice-rafted sandy mud', ka: [14.5, 18] },
  till: { name: 'Diamicton (till)', ka: [18, 30] },
  glaciomarine: { name: 'Older glaciomarine mud', ka: [30, 75] },
  interglacial: { name: 'Interglacial marine mud', ka: [75, 130] },
  shale: { name: 'Palaeogene–Cretaceous shale', ka: [56000, 72000] },
  sandstone: { name: 'Cretaceous sandstone with coal', ka: [72000, 95000] },
};

export const ITEMS = {
  brittle: { name: 'Brittle star', value: 5, note: 'Ophiocten sericeum, alive and indignant.' },
  tubes: { name: 'Polychaete tubes', value: 5, note: 'Maldanid worms, heads down, building the sediment they eat.' },
  portlandia: { name: 'Portlandia arctica', value: 8, note: 'Thin-shelled bivalves of cold, turbid water.' },
  pebble: { name: 'Dropstone pebble', value: 6, note: 'Faceted and striated: rafted in by ice from somewhere with granite.' },
  thyasira: { name: 'Living Thyasira clams', value: 30, hint: true, note: 'Chemosymbiotic bivalves. Something below is feeding their bacteria.' },
  deadThyasira: { name: 'Empty Thyasira valves', value: 12, note: 'A clam bed that outlived its methane.' },
  forams: { name: 'Foraminifera', value: 10, note: 'Nonionellina labradorica: Atlantic water on the shelf.' },
  otolith: { name: 'Fish otolith', value: 12, note: 'Arctic cod ear stone, annual rings legible.' },
  bathyarca: { name: 'Bathyarca glacialis', value: 10, note: 'A small ark shell from the deep, cold basin fauna.' },
  whale: { name: 'Bowhead vertebra', value: 40, note: 'Whale fall. The bone is still greasy.' },
  timber: { name: 'Ship’s timber', value: 60, note: 'Oak, adze-marked, with a copper nail. Nobody is missing a ship here, officially.' },
  button: { name: 'Brass button', value: 80, note: 'Royal Navy pattern, 1830s. The anchor is still crisp.' },
  tephra: { name: 'Tephra layer', value: 25, note: 'A finger of volcanic ash: an instant time line across the basin.' },
  pinkbed: { name: 'Detrital carbonate bed', value: 20, note: 'Pink outwash from a Laurentide meltwater pulse.' },
  dropstone: { name: 'Dropstone', value: 10, note: 'A fist-sized gneiss cobble dropped from a melting berg.' },
  hiatella: { name: 'Hiatella arctica', value: 12, note: 'Nestling clams that colonised the deglacial seafloor first.' },
  striated: { name: 'Striated clast', value: 15, note: 'Grooved while bedded in the sole of a grounded glacier.' },
  carbonate: { name: 'Authigenic carbonate', value: 35, hint: true, note: 'Cement precipitated where methane once met sulfate.' },
  cracks: { name: 'Gas-expansion cracks', value: 20, hint: true, note: 'The core degassed on deck and pulled itself apart.' },
  hydrate: { name: 'Gas hydrate', value: 0, hint: true, note: 'White ice that fizzes and burns. Straight into the seep.' },
  oldForams: { name: 'Interglacial foraminifera', value: 20, note: 'Cassidulina teretis: an assemblage that vanished before the last glaciation.' },
  astarte: { name: 'Astarte shell bed', value: 30, note: 'Thick-shelled clams from a warmer interglacial shelf.' },
  placer: { name: 'Placer gold flecks', value: 100, note: 'Heavy-mineral sand in a Cretaceous channel: colour in the pan.' },
  pyrite: { name: 'Pyrite nodule', value: 60, note: 'Fool’s gold the size of a fist, grown in anoxic mud.' },
  ironstone: { name: 'Ironstone band', value: 30, note: 'Siderite-cemented and rust-red where it met the drill fluid.' },
  coal: { name: 'Coal seam', value: 40, note: 'A Cretaceous peat swamp, compressed to a hand’s width.' },
  ammonite: { name: 'Ammonite', value: 120, note: 'Scaphites, a coiled shell with its living chamber intact.' },
  belemnite: { name: 'Belemnite rostrum', value: 50, note: 'The bullet-shaped guard of a Cretaceous squid.' },
  leaf: { name: 'Fossil leaf', value: 70, note: 'Metasequoia. This was a swamp forest at 75°N.' },
  ejecta: { name: 'K–Pg ejecta layer', value: 150, note: 'Shocked quartz and an iridium spike: the end of the Cretaceous in a centimetre.' },
};

function rngFrom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export const label = (col, row) => `${LETTERS[col]}${row + 1}`;
const between = (random, low, high) => low + random() * (high - low);

// Builds the layer stack for one site; each layer records its top and bottom in centimetres.
function buildLayers(random, { basin, pockmark, seepSite, seepDepthCm }) {
  const layers = [];
  let depth = 0;
  const add = (kind, thickness) => {
    const layer = { kind, top: depth, bottom: depth + thickness };
    layers.push(layer);
    depth += thickness;
    return layer;
  };
  add('fluff', Math.round(between(random, 2, 4)));
  // Basins and pockmarks trap mud; the seep site keeps its conduit above the till.
  let mud = Math.round(between(random, 60, 200) + basin * 150 + (pockmark ? 40 : 0));
  if (seepSite) mud = Math.max(mud, seepDepthCm - 100);
  let sandAt = !seepSite && random() < 0.22 ? Math.round(between(random, 40, Math.max(60, mud - 40))) : null;
  const crustAt = pockmark ? Math.round(between(random, 30, 90)) : null;
  let cursor = 0;
  const events = [sandAt !== null && { at: sandAt, kind: 'sand', thickness: Math.round(between(random, 15, 60)) }, crustAt !== null && { at: crustAt, kind: 'carbonate', thickness: Math.round(between(random, 5, 15)) }]
    .filter(Boolean).sort((a, b) => a.at - b.at);
  for (const event of events) {
    if (event.at - cursor > 0) add('mud', event.at - cursor);
    add(event.kind, event.thickness);
    cursor = event.at;
  }
  if (mud - cursor > 0) add('mud', mud - cursor);
  const laminated = Math.round(between(random, 80, 250));
  const pinkBeds = 1 + Math.floor(random() * 2);
  let done = 0;
  for (let i = 0; i < pinkBeds; i++) {
    const at = Math.round(laminated * (i + 0.6) / (pinkBeds + 0.4));
    add('laminated', at - done);
    const bed = Math.round(between(random, 5, 15));
    add('pink', bed);
    done = at + bed;
  }
  if (laminated - done > 0) add('laminated', laminated - done);
  add('ird', Math.round(between(random, 40, 150)));
  add('till', Math.round(between(random, 150, 400)));
  add('glaciomarine', Math.round(between(random, 800, 2500)));
  add('interglacial', Math.round(between(random, 300, 900)));
  add('shale', Math.round(between(random, 4000, 12000)));
  add('sandstone', CORERS[4].reachCm - depth);
  return layers;
}

// Age at depth: linear within dated layers, undated beds take the age at their top.
export function ageKa(layers, depthCm) {
  let age = 0;
  for (const layer of layers) {
    const dated = LAYERS[layer.kind].ka;
    if (dated) {
      if (depthCm <= layer.bottom) return dated[0] + (dated[1] - dated[0]) * Math.max(0, depthCm - layer.top) / (layer.bottom - layer.top);
      age = dated[1];
    } else if (depthCm <= layer.bottom) return age;
  }
  return age;
}

export const formatAge = ka => ka >= 1000 ? `${(ka / 1000).toFixed(ka >= 10000 ? 0 : 1)} Ma` : ka >= 10 ? `${ka.toFixed(1)} ka` : ka >= 1 ? `${ka.toFixed(2)} ka` : `${Math.round(ka * 1000)} a`;

const POOLS = {
  mud: [['forams', 0.5], ['otolith', 0.25], ['bathyarca', 0.3], ['whale', 0.06], ['tephra', 0.15]],
  laminated: [['dropstone', 0.5], ['hiatella', 0.3]],
  ird: [['dropstone', 0.7], ['striated', 0.3]],
  glaciomarine: [['oldForams', 0.7], ['dropstone', 0.3]],
  interglacial: [['astarte', 0.8], ['oldForams', 0.5]],
  shale: [['ammonite', 0.4], ['belemnite', 0.5], ['pyrite', 0.4], ['ironstone', 0.5], ['ejecta', 0.35]],
  sandstone: [['coal', 0.7], ['leaf', 0.5], ['placer', 0.3]],
};

function buildFinds(random, layers, site) {
  const finds = [];
  const place = (item, depthCm) => finds.push({ item, depthCm: Math.round(depthCm) });
  const roll = (item, chance, low, high) => { if (random() < chance) place(item, between(random, low, high)); };
  // The top ten centimetres are spoon country.
  roll('brittle', 0.5, 1, 9);
  roll('tubes', 0.4, 1, 9);
  roll('portlandia', 0.35, 1, 9);
  roll('pebble', 0.3, 2, 9);
  if (site.seepDistance === 0) roll('thyasira', 1, 1, 6);
  else if (site.seepDistance === 1) roll('thyasira', 0.5, 1, 8);
  else if (site.pockmark) roll('deadThyasira', 0.7, 1, 9);
  for (const layer of layers) {
    if (layer.kind === 'pink') place('pinkbed', layer.top + 1);
    if (layer.kind === 'carbonate') place('carbonate', layer.top + 1);
    if (layer.kind === 'till') roll('striated', 0.8, layer.top + 2, layer.top + 18);
    const pool = POOLS[layer.kind];
    if (!pool) continue;
    const low = layer.kind === 'mud' ? Math.max(layer.top + 1, 12) : layer.top + 2;
    if (low >= layer.bottom - 2) continue;
    for (const [item, chance] of pool) roll(item, chance, low, layer.bottom - 2);
  }
  if (site.seepDistance <= 1) roll('cracks', site.seepDistance ? 0.5 : 0.85, site.smtzCm + 20, site.smtzCm + 100);
  if (site.seepDistance === 0) place('hydrate', site.seepDepthCm);
  finds.sort((a, b) => a.depthCm - b.depthCm);
  return finds.map((find, index) => ({ ...find, index }));
}

// A seeded survey: same seed, same seafloor.
export function createSurvey(seed = 'seep-seeker') {
  const random = rngFrom(seed);
  const pockmarks = [];
  while (pockmarks.length < 4) {
    const col = 1 + Math.floor(random() * (COLUMNS - 2));
    const row = 1 + Math.floor(random() * (ROWS - 2));
    if (pockmarks.every(p => Math.abs(p.col - col) > 1 || Math.abs(p.row - row) > 1)) pockmarks.push({ col, row, reliefM: between(random, 4, 9) });
  }
  const seep = pockmarks[Math.floor(random() * pockmarks.length)];
  const slope = between(random, 10, 22), tilt = between(random, -8, 8), base = between(random, 220, 420);
  const seepDepthCm = Math.round(between(random, 330, 800));
  const sites = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const pockmark = pockmarks.find(p => Math.abs(p.col - col) <= 1 && Math.abs(p.row - row) <= 1) ?? null;
      const centre = pockmark && pockmark.col === col && pockmark.row === row;
      const seepDistance = Math.max(Math.abs(seep.col - col), Math.abs(seep.row - row));
      const relief = pockmark ? pockmark.reliefM * (centre ? 1 : 0.45) : 0;
      const waterDepthM = Math.round(base + col * slope + row * tilt + between(random, -6, 6) + relief);
      const basin = Math.min(1, Math.max(0, (col + random() * 2) / COLUMNS));
      // Sulfate runs out where methane from below meets it; near the vent that is barely below the surface.
      const smtzCm = Math.round(seepDistance === 0 ? between(random, 15, 35) : seepDistance === 1 ? between(random, 90, 190) : seepDistance === 2 ? between(random, 300, 550) : seepDistance === 3 ? between(random, 700, 1000) : between(random, 1500, 3000));
      const site = { col, row, label: label(col, row), waterDepthM, pockmark: Boolean(pockmark), centre: Boolean(centre), seepDistance, smtzCm, seepDepthCm: seepDistance === 0 ? seepDepthCm : null, collected: new Set(), cores: 0 };
      site.layers = buildLayers(random, { basin, pockmark, seepSite: seepDistance === 0, seepDepthCm });
      site.finds = buildFinds(random, site.layers, site);
      sites.push(site);
    }
  }
  // Two shallowest sites keep a wreck between them.
  const shallow = [...sites].sort((a, b) => a.waterDepthM - b.waterDepthM).slice(0, 2);
  shallow.forEach((site, i) => {
    const mud = site.layers.find(l => l.kind === 'mud' && l.bottom - l.top > 60) ?? site.layers.find(l => l.kind === 'laminated');
    site.finds.push({ item: i ? 'button' : 'timber', depthCm: Math.round(between(random, mud.top + 20, mud.bottom - 10)), index: site.finds.length });
    site.finds.sort((a, b) => a.depthCm - b.depthCm);
  });
  return {
    seed, sites, pockmarks, seepIndex: seep.row * COLUMNS + seep.col,
    selected: Math.floor(ROWS / 2) * COLUMNS + Math.floor(COLUMNS / 2),
    hours: SHIP_HOURS, corer: 'spoon', cores: [], findPoints: 0, longest: null, won: false, finished: false,
  };
}

export const recordPoints = cm => cm ? Math.round(5 * Math.sqrt(cm)) : 0;
export const score = state => state.findPoints + recordPoints(state.longest?.cm ?? 0) + (state.won ? SEEP_BONUS : 0);
export const unlocked = (state, corer) => corer.unlock <= score(state);
export const affordable = (state, corer) => corer.hours <= state.hours;
export const site = state => state.sites[state.selected];

// How deep a corer gets at a site, and which layer stopped it short of its reach.
export function penetration(layers, corer) {
  let depth = 0;
  for (const layer of layers) {
    if (layer.top >= corer.reachCm) break;
    let stop = STOPS[corer.id]?.[layer.kind];
    if (typeof stop === 'function') stop = stop(layer);
    if (stop !== undefined) return { cm: Math.min(corer.reachCm, layer.top + stop), refusal: layer.kind };
    depth = Math.min(corer.reachCm, layer.bottom);
  }
  return { cm: depth, refusal: null };
}

export function select(state, col, row) {
  if (state.finished || col < 0 || row < 0 || col >= COLUMNS || row >= ROWS) return false;
  state.selected = row * COLUMNS + col;
  return true;
}

export function chooseCorer(state, id) {
  const corer = CORERS.find(c => c.id === id);
  if (!corer || state.finished || !unlocked(state, corer)) return false;
  state.corer = id;
  return true;
}

// Takes one core at the selected site with the chosen corer. New finds are those below any earlier core here.
export function core(state) {
  const corer = CORERS.find(c => c.id === state.corer);
  const here = site(state);
  if (state.finished || !unlocked(state, corer) || !affordable(state, corer)) return null;
  state.hours -= corer.hours;
  const reach = penetration(here.layers, corer);
  const finds = here.finds.filter(f => f.depthCm <= reach.cm && !here.collected.has(f.index));
  finds.forEach(f => here.collected.add(f.index));
  const points = finds.reduce((sum, f) => sum + ITEMS[f.item].value, 0);
  state.findPoints += points;
  here.cores += 1;
  const record = { cm: reach.cm, ka: ageKa(here.layers, reach.cm), site: here.label, corer: corer.id };
  const longer = !state.longest || record.cm > state.longest.cm;
  if (longer) state.longest = record;
  const entry = { site: here, corer, cm: reach.cm, ka: record.ka, refusal: reach.refusal, finds, points, smtz: reach.cm >= here.smtzCm ? here.smtzCm : null, longer, number: state.cores.length + 1 };
  state.cores.push(entry);
  if (finds.some(f => f.item === 'hydrate')) state.won = true;
  if (state.won || state.hours < CORERS[0].hours) state.finished = true;
  return entry;
}

export function finish(state) {
  if (state.reported) return null;
  state.finished = true;
  state.reported = true;
  const points = score(state);
  const seep = state.sites[state.seepIndex];
  return {
    points,
    detail: {
      title: state.won ? `Methane seep found at ${seep.label}` : state.longest ? `${state.longest.cm} cm record from ${state.longest.site}` : 'Seep-Seeker: no cores taken',
      score: points, seepFound: state.won, seep: seep.label, seepDepthCm: seep.seepDepthCm,
      longestCm: state.longest?.cm ?? 0, longestAge: state.longest ? formatAge(state.longest.ka) : null,
      cores: state.cores.length, hoursUsed: SHIP_HOURS - state.hours,
      finds: state.cores.flatMap(c => c.finds.map(f => `${ITEMS[f.item].name} · ${c.site.label} · ${f.depthCm} cm`)),
    },
  };
}
