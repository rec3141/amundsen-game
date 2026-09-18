// Rival Researchers: the duel itself. Pure functions over a plain state object; crew-19.js only renders
// and paces the events this module returns. All randomness goes through the seeded generator in state.rng
// so a scripted run with the same seed replays identically.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const TYPES = {
  field: { name: 'Field', colour: '#1f8a66', blurb: 'in-situ measurement' },
  remote: { name: 'Remote', colour: '#3f6fd0', blurb: 'remote sensing' },
  model: { name: 'Model', colour: '#9b4fc4', blurb: 'numerical modelling' },
  review: { name: 'Review', colour: '#c76a2a', blurb: 'peer review and data' },
};
// Attack type (row) against defender type (column). Field checks Remote, Remote checks Model, Model checks Field;
// Review bites anything that rests on assumptions and bounces off a measurement.
export const CHART = {
  field: { field: 1, remote: 1.5, model: 0.7, review: 1.25 },
  remote: { field: 0.7, remote: 1, model: 1.5, review: 0.75 },
  model: { field: 1.5, remote: 0.7, model: 1, review: 0.6 },
  review: { field: 0.7, remote: 1.3, model: 1.5, review: 1 },
};
export const REASONS = {
  'field>remote': 'Ground truth: the retrieval has to match the bottle.',
  'field>model': 'One cast is one grid cell. The run barely notices.',
  'field>review': 'Hard to argue with a measurement.',
  'remote>model': 'The scene shows what the run left out.',
  'remote>field': 'Wide swath, coarse against a station.',
  'remote>review': 'A retrieval is not a measurement; the referee wants validation.',
  'model>field': 'Context: they show the eddy you sampled the edge of.',
  'model>remote': 'The model is already assimilating their scenes.',
  'model>review': 'Every parameterisation is an open question.',
  'review>model': 'Assumptions, forcing, tuning: all fair game.',
  'review>remote': 'Which algorithm version, validated against what?',
  'review>field': 'The data are the data.',
};

// hours: ship time the move burns (desk work is free). speed: higher acts first. fog: blind in fog.
// iceNoise: accuracy suffers with ice under the hull. deep: extra power in water deeper than 500 m.
// needs: arena conditions ('ship', 'heli', 'ice', 'water', 'depth100'). edge: per-defender-type multiplier.
// effect: applied to the target on a hit. self: applied to the user. crit: crit chance (default 0.08).
export const MOVES = {
  ctd: { name: 'CTD cast', type: 'field', power: 55, acc: 0.95, hours: 3, speed: 1, needs: ['ship'], deep: 15, desc: 'Lower the rosette through the whole column. Reliable; one point in space.' },
  multibeam: { name: 'Multibeam survey', type: 'field', power: 60, acc: 0.85, hours: 5, speed: 0, needs: ['ship'], deep: 20, iceNoise: true, desc: 'Map a swath of seabed. Wider in deep water, noisy with ice under the hull.' },
  icecore: { name: 'Ice core', type: 'field', power: 70, acc: 0.9, hours: 6, speed: 0, needs: ['ice'], edge: { remote: 1.2 }, desc: 'Drill a floe for salinity, texture and age. Orbit only guesses at this.' },
  trap: { name: 'Sediment trap', type: 'field', power: 30, acc: 1, hours: 4, speed: 0, needs: ['ship', 'depth100'], effect: { trap: 2 }, desc: 'Moor a trap. Little now; it keeps collecting for two more turns.' },
  edna: { name: 'eDNA sample', type: 'field', power: 45, acc: 0.8, hours: 2, speed: 2, crit: 0.35, needs: ['ship'], desc: 'Filter a litre for whatever swam past. Fast, sensitive, easily contaminated.' },
  rov: { name: 'ROV dive', type: 'field', power: 85, acc: 0.75, hours: 8, speed: 0, needs: ['ship', 'water'], selfRisk: 0.25, desc: 'Cameras and a slurp gun to the bottom. The tether hates ice.' },
  em: { name: 'EM thickness line', type: 'remote', power: 60, acc: 0.9, hours: 2, speed: 1, needs: ['heli'], fog: true, desc: 'Fly the EM bird along the floes. Thickness along the line, blind in fog.' },
  photo: { name: 'Floe photogrammetry', type: 'remote', power: 45, acc: 0.9, hours: 1, speed: 2, needs: ['heli'], fog: true, desc: 'Camera runs over the pack: floe sizes and melt ponds at a glance. Useless in fog.' },
  float: { name: 'Air-drop a profiler', type: 'field', power: 55, acc: 0.85, hours: 2, speed: 1, needs: ['heli', 'water'], desc: 'A float out of the cabin door. A profile where the ship cannot go.' },
  landcore: { name: 'Land and core', type: 'field', power: 65, acc: 0.85, hours: 3, speed: 0, needs: ['heli', 'ice'], edge: { remote: 1.2 }, desc: 'Set down on a floe with the hand auger. A real thickness, not a freeboard.' },
  optical: { name: 'Optical satellite pass', type: 'remote', power: 55, acc: 0.9, hours: 0, speed: 2, fog: true, desc: 'Task a sharp optical scene. Everything on a clear day, nothing under cloud.' },
  sar: { name: 'SAR pass', type: 'remote', power: 45, acc: 0.95, hours: 0, speed: 2, desc: 'Radar through cloud and dark: ridges and leads, but no thickness.' },
  model: { name: 'Model run', type: 'model', power: 40, acc: 0.9, hours: 0, speed: 1, assimilate: 12, desc: 'Run the ocean model overnight. Stronger with every field observation you have fed it.' },
  review: { name: 'Peer review', type: 'review', power: 40, acc: 0.9, hours: 0, speed: 2, effect: { curse: 2, chance: 0.5 }, desc: 'Send their preprint to a careful reader. Half the time it comes back as Reviewer 2.' },
  request: { name: 'Data request', type: 'review', power: 25, acc: 1, hours: 0, speed: 3, effect: { defence: -1 }, desc: 'Ask for the raw files and the scripts. Whatever comes back weakens their defence.' },
  recalibrate: { name: 'Recalibrate', type: 'review', power: 0, acc: 1, hours: 2, speed: 3, self: { heal: 30, cure: true }, desc: 'Post-calibrate the sensors and clean the frame. Restores credibility, clears fouling and curses.' },
  opendata: { name: 'Open data release', type: 'review', power: 0, acc: 1, hours: 0, speed: 3, self: { defence: 1, heal: 10 }, desc: 'Publish the dataset with a DOI. Hard to attack what everyone can check.' },
  // Rival-only moves.
  altimetry: { name: 'Altimeter freeboard', type: 'remote', power: 60, acc: 0.85, hours: 0, speed: 1, desc: 'Thickness from orbit, with a snow assumption.' },
  pressrelease: { name: 'Press release', type: 'review', power: 30, acc: 0.9, hours: 0, speed: 3, effect: { defence: -1 }, desc: 'A map of everything, in the news before the paper.' },
  ensemble: { name: 'Ensemble run', type: 'model', power: 60, acc: 0.8, hours: 0, speed: 0, desc: 'Fifty members, one figure.' },
  tune: { name: 'Tune the parameterisation', type: 'model', power: 0, acc: 1, hours: 0, speed: 3, self: { defence: 1, heal: 10 }, desc: 'The mixing scheme now matches last week.' },
  hindcast: { name: 'Hindcast', type: 'model', power: 45, acc: 1, hours: 0, speed: 2, desc: 'They had already reproduced your section.' },
  uls: { name: 'Upward-looking sonar', type: 'field', power: 55, acc: 0.95, hours: 0, speed: 1, desc: 'Ice draft along the whole track, from underneath.' },
  underice: { name: 'Under-ice multibeam', type: 'field', power: 60, acc: 0.8, hours: 0, speed: 0, desc: 'The keels you cannot see from the bridge.' },
  xbt: { name: 'XBT from the tube', type: 'field', power: 40, acc: 0.95, hours: 0, speed: 2, desc: 'A temperature profile fired out of the launcher.' },
  classified: { name: 'Classified dataset', type: 'review', power: 0, acc: 1, hours: 0, speed: 3, self: { defence: 1, heal: 15 }, desc: 'Nobody can check what nobody can see.' },
  gliderline: { name: 'Glider section', type: 'field', power: 55, acc: 0.9, hours: 0, speed: 1, desc: 'Weeks of profiles for the price of a battery.' },
  floatarray: { name: 'Float array', type: 'field', power: 30, acc: 1, hours: 0, speed: 1, effect: { trap: 2 }, desc: 'The floats keep reporting for two more turns.' },
  emflight: { name: 'EM flight line', type: 'remote', power: 70, acc: 0.9, hours: 0, speed: 1, fog: true, desc: 'A hundred kilometres of thickness before lunch.' },
  laser: { name: 'Laser scanner', type: 'remote', power: 55, acc: 0.9, hours: 0, speed: 2, fog: true, desc: 'Surface roughness at centimetre scale.' },
  majorrevision: { name: 'Major revision', type: 'review', power: 60, acc: 0.85, hours: 0, speed: 1, desc: 'Please address the following 47 points.' },
  citeme: { name: 'Cite my paper', type: 'review', power: 25, acc: 1, hours: 0, speed: 2, self: { heal: 20 }, desc: 'The authors appear unaware of Reviewer (2019).' },
  reject: { name: 'Reject without review', type: 'review', power: 90, acc: 0.5, hours: 0, speed: 0, desc: 'Not of sufficient interest to the readership.' },
  moredata: { name: 'Request more data', type: 'review', power: 20, acc: 1, hours: 0, speed: 3, effect: { curse: 2, chance: 1 }, desc: 'One more season would settle it.' },
};

// tier sets the points on offer and how sharp the rival plays. arenas lists where the rival turns up:
// 'pack' (ice 6+ tenths), 'marginal' (1 to 5), 'open' (no ice), 'air' (you are in the helicopter).
export const RIVALS = [
  { id: 'icebreaker', article: 'the ', name: 'Borealis Star science party', short: 'Borealis Star', type: 'field', hp: 115, atk: 0.95, def: 1, tier: 2, hours: 48, sprite: 'ship',
    moves: ['ctd', 'multibeam', 'icecore', 'review'], fallback: { icecore: 'trap' }, arenas: ['pack', 'marginal', 'open'],
    blurb: 'A rival icebreaker steams over the horizon with a full rosette and a chief scientist who wants your station.' },
  { id: 'satellite', article: 'the ', name: 'Orbital Cryosphere Consortium', short: 'Orbital Consortium', type: 'remote', hp: 130, atk: 1, def: 1, tier: 1, hours: Infinity, sprite: 'satellite',
    moves: ['optical', 'sar', 'altimetry', 'pressrelease'], arenas: ['pack', 'marginal', 'open', 'air'],
    blurb: 'A well-funded satellite group. They have never been cold, and they have a map of everything.' },
  { id: 'lab', article: 'the ', name: 'Basin-Scale Modelling Lab', short: 'Modelling Lab', type: 'model', hp: 110, atk: 1, def: 1, tier: 3, hours: Infinity, sprite: 'grid',
    moves: ['ensemble', 'model', 'tune', 'hindcast'], arenas: ['pack', 'marginal', 'open', 'air'],
    blurb: 'A modelling lab with a new cluster. Your station is one grid cell to them, and they have the other four million.' },
  { id: 'sub', article: 'the ', name: 'submarine survey crew', short: 'submarine crew', type: 'field', hp: 125, atk: 1, def: 1, tier: 3, hours: Infinity, sprite: 'sub', immune: ['fog', 'ice'],
    moves: ['uls', 'underice', 'xbt', 'classified'], arenas: ['pack', 'marginal'],
    blurb: 'A sail breaks the floe alongside. The submarine has been under this ice for a month and has the draft profile to prove it.' },
  { id: 'gliders', article: 'the ', name: 'autonomous glider fleet', short: 'glider fleet', type: 'field', hp: 110, atk: 1, def: 0.95, tier: 2, hours: Infinity, sprite: 'gliders', quick: 1,
    moves: ['gliderline', 'floatarray', 'sar', 'model'], arenas: ['open', 'marginal'],
    blurb: 'Yellow gliders surface around the ship. Their operators are ashore with coffee and six months of sections.' },
  { id: 'airborne', article: 'the ', name: 'airborne EM survey team', short: 'airborne team', type: 'remote', hp: 140, atk: 1.1, def: 1, tier: 2, hours: Infinity, sprite: 'plane',
    moves: ['emflight', 'laser', 'photo', 'pressrelease'], arenas: ['air', 'pack'],
    blurb: 'A twin-engine survey aircraft crosses your track with an EM bird on a cable. They fly your whole week in an afternoon.' },
  { id: 'reviewer', article: '', name: 'Reviewer 2', short: 'Reviewer 2', type: 'review', hp: 105, atk: 1, def: 1, tier: 3, hours: Infinity, sprite: 'reviewer',
    moves: ['majorrevision', 'citeme', 'reject', 'moredata'], arenas: ['pack', 'marginal', 'open', 'air'], rare: true,
    blurb: 'The satellite phone rings. Reviewer 2 has read your preprint. They have a few comments.' },
];

export const TELLS = {
  field: ['Their deck crew is rigging something heavy.', 'A winch starts to turn on their side.', 'They are lowering an instrument.'],
  remote: ['They are waiting on a pass.', 'Someone is checking the overflight schedule.', 'A dish swings to the horizon.'],
  model: ['The cluster fans spin up.', 'Their queue shows a new job.', 'They are staring at a forcing file.'],
  review: ['Someone is drafting a letter.', 'Their editor is copied in.', 'A polite email is on its way.'],
};

const PLAYER_HOURS = 48, PLAYER_HP = 130;
const STAGE = 1.3, SCALE = 0.4; // damage per point of move power, so a duel runs six to nine turns
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function arenaKind(vehicle, ice) { return vehicle === 'helicopter' ? 'air' : ice >= 6 ? 'pack' : ice >= 1 ? 'marginal' : 'open'; }

function chooseRival(rng, kind, avoid) {
  const pool = RIVALS.filter(r => r.arenas.includes(kind) && r.id !== avoid);
  const rare = pool.filter(r => r.rare), common = pool.filter(r => !r.rare);
  if (rare.length && rng() < 0.12) return pick(rng, rare);
  return pick(rng, common.length ? common : pool);
}

function makeSide(base, moves, hours) {
  return { id: base.id, name: base.name, short: base.short, article: base.article, type: base.type, hp: base.hp, maxHp: base.hp,
    atk: base.atk, def: base.def, hours, maxHours: hours, moves, stages: { defence: 0 }, status: { fouled: 0, curse: 0, trap: 0 },
    quick: base.quick || 0, immune: base.immune || [], sprite: base.sprite, obs: 0, tier: base.tier };
}

// The kit is four moves drawn for the arena: a heavy field method, a light one, something remote or numerical,
// and something from the review desk. Ship and helicopter carry different kit.
function playerKit(rng, arena) {
  const heli = arena.vehicle === 'helicopter';
  const heavy = heli ? ['em', arena.ice >= 3 ? 'landcore' : 'float'] : [arena.ice >= 3 ? 'icecore' : 'rov', 'multibeam', arena.depth >= 100 ? 'trap' : 'rov'];
  const light = heli ? ['photo', 'float'] : ['ctd', 'edna'];
  const desk = ['model', 'optical', 'sar'];
  const support = ['review', 'request', 'recalibrate', 'opendata'];
  const kit = [pick(rng, heavy), pick(rng, light), pick(rng, desk), pick(rng, support)];
  if (kit[1] === kit[0]) kit[1] = heli ? 'photo' : 'ctd';
  return kit;
}

export function createDuel(expedition = {}, seed = Date.now(), avoid = null) {
  const rng = mulberry32(hashSeed(`${expedition.lon}:${expedition.lat}:${seed}`));
  const tenths = Number.isFinite(expedition.ice?.tenths) ? expedition.ice.tenths : Number.isFinite(expedition.ice?.concentration) ? expedition.ice.concentration : 0;
  const arena = {
    lon: Number.isFinite(expedition.lon) ? expedition.lon : null, lat: Number.isFinite(expedition.lat) ? expedition.lat : null,
    depth: Number.isFinite(expedition.depth) ? Math.max(0, expedition.depth) : 300,
    ice: clamp(Math.round(tenths), 0, 10), vehicle: expedition.vehicle === 'helicopter' ? 'helicopter' : 'ship',
    fog: rng() < 0.3, seed: Math.floor(rng() * 1e9),
  };
  arena.kind = arenaKind(arena.vehicle, arena.ice);
  const base = chooseRival(rng, arena.kind, avoid);
  const rivalMoves = base.moves.map(id => (base.fallback?.[id] && arena.ice < 3) ? base.fallback[id] : id);
  const state = {
    rng, seed, arena, turn: 0, phase: 'intro', log: [], completed: false,
    player: makeSide({ id: 'amundsen', name: 'Amundsen science party', short: 'Amundsen party', article: 'the ', type: 'field', hp: PLAYER_HP, atk: 1, def: 1, tier: 0, sprite: arena.vehicle }, playerKit(rng, arena), PLAYER_HOURS),
    rival: makeSide(base, rivalMoves, base.hours),
    blurb: base.blurb,
  };
  state.rival.next = chooseRivalMove(state);
  return state;
}

// Why a move cannot be used right now, or null when it can.
export function blocked(state, side, id) {
  const move = MOVES[id], a = state.arena, needs = move.needs || [];
  if (side.hours < move.hours) return 'No ship time left for this.';
  if (needs.includes('ship') && a.vehicle !== 'ship') return 'Needs the ship.';
  if (needs.includes('heli') && a.vehicle !== 'helicopter') return 'Needs the helicopter.';
  if (needs.includes('ice') && a.ice < 3) return 'No floe alongside to core.';
  if (needs.includes('water') && a.ice >= 8) return 'The pack is too tight to work through.';
  if (needs.includes('depth100') && a.depth < 100) return 'Too shallow to moor a trap.';
  return null;
}
export function moveOptions(state, side = state.player) {
  return side.moves.map(id => ({ id, move: MOVES[id], why: blocked(state, side, id) }));
}

function effectiveness(move, target) { return CHART[move.type][target.type] * (move.edge?.[target.type] ?? 1); }
function stageMult(n) { return STAGE ** n; }
function accuracy(state, user, move) {
  let acc = move.acc;
  if (user.status.fouled && move.type === 'field') acc *= 0.75;
  if (move.fog && state.arena.fog && !user.immune.includes('fog')) acc *= 0.35;
  if (move.iceNoise && state.arena.ice >= 6 && !user.immune.includes('ice')) acc *= 0.7;
  return acc;
}
function expectedDamage(state, user, target, move) {
  if (!move.power) return 0;
  const power = move.power + (move.deep && state.arena.depth > 500 ? move.deep : 0) + (move.assimilate ? move.assimilate * Math.min(user.obs, 4) : 0);
  return power * SCALE * effectiveness(move, target) * (user.atk / (target.def * stageMult(target.stages.defence))) * (user.status.curse ? 0.6 : 1) * accuracy(state, user, move);
}

// The rival weighs each usable move by expected damage, with a taste for status moves it has not yet landed and
// for recovery when hurt. Higher tiers pick the best option more often; lower tiers wander.
export function chooseRivalMove(state) {
  const { rival, player, rng } = state;
  const usable = moveOptions(state, rival).filter(o => !o.why);
  if (!usable.length) return rival.moves[0];
  const weights = usable.map(({ id, move }) => {
    let w = expectedDamage(state, rival, player, move) + 5;
    if (move.self?.heal) w += move.self.heal * (1 - rival.hp / rival.maxHp) * 2 + (move.self.defence && rival.stages.defence < 1 ? 15 : 0);
    if (move.self?.defence && rival.stages.defence >= 2) w = 2;
    if (move.effect?.trap && player.status.trap) w *= 0.3;
    if (move.effect?.curse && player.status.curse) w *= 0.4;
    if (move.effect?.defence && player.stages.defence <= -2) w *= 0.3;
    return w;
  });
  const sharpness = [0, 1, 2, 3.5][rival.tier] ?? 2;
  const scaled = weights.map(w => w ** sharpness);
  let roll = rng() * scaled.reduce((a, b) => a + b, 0);
  for (let i = 0; i < usable.length; i++) { roll -= scaled[i]; if (roll <= 0) return usable[i].id; }
  return usable[usable.length - 1].id;
}
export function tell(state) {
  const move = MOVES[state.rival.next];
  return TELLS[move.type][Math.floor(state.rng() * TELLS[move.type].length)];
}

function snapshot(state) {
  const side = s => ({ hp: s.hp, maxHp: s.maxHp, hours: s.hours, maxHours: s.maxHours, stages: { ...s.stages }, status: { ...s.status }, obs: s.obs });
  return { player: side(state.player), rival: side(state.rival), arena: { ice: state.arena.ice, fog: state.arena.fog } };
}
function push(events, state, event) { events.push({ ...event, snap: snapshot(state) }); return event; }
function fainted(state) { return state.player.hp <= 0 || state.rival.hp <= 0; }

function useMove(state, events, user, target, id) {
  const move = MOVES[id], who = user === state.player ? 'player' : 'rival', them = who === 'player' ? 'rival' : 'player';
  const why = blocked(state, user, id);
  push(events, state, { kind: 'use', side: who, move: id, text: `${cap(user.article + user.short)} uses ${move.name}.` });
  if (why) { push(events, state, { kind: 'blocked', side: who, text: why }); return; }
  if (Number.isFinite(user.hours)) user.hours -= move.hours;
  if (move.type === 'field' && move.power && who === 'player') user.obs += 1;
  if (move.self) {
    if (move.self.cure && (user.status.fouled || user.status.curse)) { user.status.fouled = 0; user.status.curse = 0; push(events, state, { kind: 'status', side: who, text: 'Sensors clean, curse lifted.' }); }
    if (move.self.heal) { const before = user.hp; user.hp = Math.min(user.maxHp, user.hp + move.self.heal); push(events, state, { kind: 'heal', side: who, amount: user.hp - before, text: `Credibility +${user.hp - before}.` }); }
    if (move.self.defence) { user.stages.defence = clamp(user.stages.defence + move.self.defence, -3, 3); push(events, state, { kind: 'stage', side: who, text: `${cap(user.article + user.short)}'s defence rises.` }); }
  }
  if (!move.power) return;
  const acc = accuracy(state, user, move);
  if (state.rng() >= acc) {
    const reason = move.fog && state.arena.fog && !user.immune.includes('fog') ? 'Fog. Nothing but grey in the frame.' : move.iceNoise && state.arena.ice >= 6 ? 'Ice under the hull: the swath is mostly noise.' : user.status.fouled && move.type === 'field' ? 'The fouled sensor drifts. Nobody trusts the numbers.' : 'It misses the mark.';
    push(events, state, { kind: 'miss', side: who, text: reason });
    return;
  }
  const power = move.power + (move.deep && state.arena.depth > 500 ? move.deep : 0) + (move.assimilate ? move.assimilate * Math.min(user.obs, 4) : 0);
  const eff = effectiveness(move, target);
  const crit = state.rng() < (move.crit ?? 0.08);
  const roll = 0.88 + state.rng() * 0.12;
  let mult = user.atk / (target.def * stageMult(target.stages.defence));
  if (user.status.curse) mult *= 0.6;
  const damage = Math.max(1, Math.round(power * SCALE * eff * mult * roll * (crit ? 1.5 : 1)));
  target.hp = Math.max(0, target.hp - damage);
  const key = `${move.type}>${target.type}`;
  const grade = eff >= 1.25 ? 'super' : eff <= 0.8 ? 'weak' : 'plain';
  let text = grade === 'super' ? `Decisive. ${REASONS[key] || ''}` : grade === 'weak' ? `Not much. ${REASONS[key] || ''}` : 'A solid result.';
  if (move.deep && state.arena.depth > 500) text += ' Deep water: a long profile.';
  if (move.assimilate && user.obs) text += ` Assimilating ${Math.min(user.obs, 4)} observation${user.obs === 1 ? '' : 's'}.`;
  if (crit) text = `Critical finding! ${text}`;
  push(events, state, { kind: 'hit', side: who, target: them, damage, eff, crit, text: `${text.trim()} −${damage}.` });
  if (target.hp <= 0) return;
  if (move.effect) {
    if (move.effect.trap && !target.status.trap) { target.status.trap = move.effect.trap; push(events, state, { kind: 'status', side: them, status: 'trap', text: `${cap(target.article + target.short)} is being sampled. It keeps collecting.` }); }
    if (move.effect.curse && state.rng() < (move.effect.chance ?? 1)) { target.status.curse = Math.max(target.status.curse, move.effect.curse); push(events, state, { kind: 'status', side: them, status: 'curse', text: `Reviewer 2 has opinions. ${cap(target.article + target.short)} must revise: attacks weakened, credibility bleeding.` }); }
    if (move.effect.defence) { target.stages.defence = clamp(target.stages.defence + move.effect.defence, -3, 3); push(events, state, { kind: 'stage', side: them, text: `${cap(target.article + target.short)}'s defence falls.` }); }
  }
  if (move.selfRisk && state.rng() < move.selfRisk && !user.status.fouled) { user.status.fouled = 3; push(events, state, { kind: 'status', side: who, status: 'fouled', text: `The tether comes up wrapped in weed and slush. ${cap(user.article + user.short)}'s instruments are fouled.` }); }
}

function endOfTurn(state, events) {
  for (const who of ['player', 'rival']) {
    const side = state[who];
    if (side.status.trap) { side.status.trap -= 1; const d = 8; side.hp = Math.max(0, side.hp - d); push(events, state, { kind: 'tick', side: who, damage: d, text: `The trap keeps collecting on ${side.article}${side.short}. −${d}.` }); if (fainted(state)) return; }
    if (side.status.curse) { side.status.curse -= 1; const d = 4; side.hp = Math.max(0, side.hp - d); push(events, state, { kind: 'tick', side: who, damage: d, text: `${cap(side.article + side.short)} revises under the curse. −${d}.${side.status.curse ? '' : ' The referee is satisfied.'}` }); if (fainted(state)) return; }
    if (side.status.fouled) { side.status.fouled -= 1; if (!side.status.fouled) push(events, state, { kind: 'status', side: who, text: `${cap(side.article + side.short)}'s sensors have cleared.` }); }
  }
  const a = state.arena;
  if (state.rng() < 0.22) { a.fog = !a.fog; push(events, state, { kind: 'weather', text: a.fog ? 'Fog rolls in over the floes.' : 'The fog lifts.' }); }
  if (a.vehicle === 'ship' || a.ice > 0) {
    const drift = state.rng() < 0.35 ? (state.rng() < 0.5 ? -1 : 1) : 0;
    const next = clamp(a.ice + drift, 0, 10);
    if (next !== a.ice) { const closing = next > a.ice; a.ice = next; push(events, state, { kind: 'weather', text: closing ? `The pack closes in: ${next} tenths.` : `The ice opens up: ${next} tenths.` }); }
  }
}

// One full turn: both moves in speed order, then the end-of-turn ticks. Returns the events for the UI to pace.
export function playTurn(state, playerMoveId) {
  if (state.phase !== 'choose' || !state.player.moves.includes(playerMoveId)) return [];
  const events = [];
  state.phase = 'resolving';
  state.turn += 1;
  const rivalMoveId = state.rival.next;
  const order = MOVES[playerMoveId].speed >= MOVES[rivalMoveId].speed + state.rival.quick
    ? [['player', playerMoveId], ['rival', rivalMoveId]] : [['rival', rivalMoveId], ['player', playerMoveId]];
  for (const [who, id] of order) {
    if (fainted(state)) break;
    useMove(state, events, state[who], state[who === 'player' ? 'rival' : 'player'], id);
  }
  if (!fainted(state)) endOfTurn(state, events);
  if (state.rival.hp <= 0) { state.phase = 'won'; push(events, state, { kind: 'end', won: true, text: `${cap(state.rival.article + state.rival.short)} concedes the station.` }); }
  else if (state.player.hp <= 0) { state.phase = 'lost'; push(events, state, { kind: 'end', won: false, text: 'The Amundsen party withdraws to the lab to regroup.' }); }
  else { state.phase = 'choose'; state.rival.next = chooseRivalMove(state); push(events, state, { kind: 'tell', text: tell(state) }); }
  for (const e of events) state.log.push(e.text);
  return events;
}

// Points scale with the rival's tier and how cleanly the station was held: credibility left, turns taken, ship time saved.
export function score(state) {
  const base = 50 * state.rival.tier;
  const health = state.player.hp / state.player.maxHp;
  const clean = 0.5 + 0.5 * health;
  const brisk = state.turn <= 5 ? 1.2 : state.turn <= 8 ? 1 : 0.85;
  const thrift = 1 + 0.2 * Math.max(0, state.player.hours) / state.player.maxHours;
  const points = state.phase === 'won' ? Math.round(base * clean * brisk * thrift) : 0;
  return { points, base, health, clean, brisk, thrift, turns: state.turn, hoursLeft: Math.max(0, state.player.hours) };
}

export function cap(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
