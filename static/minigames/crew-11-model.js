// Planning model for "What's next?": a week of 8-hour watches, team requests, crew obligations and
// watch-by-watch conditions taken from the ship's own record. Pure functions over a plain state object.
export const DAYS = 7;
export const WATCHES = 3;
export const SLOTS = DAYS * WATCHES;
export const MUTINY_AT = 6;
export const LEAD_BONUS = 0.25;
export const WATCH_LABELS = ['00–08', '08–16', '16–24'];
// A watch counts as daylight when its mean short-wave radiation clears this level.
export const LIGHT_WM2 = 25;
export const FOG_RH = 94;

export const TEAMS = {
  oceanography: { name: 'Physical oceanography', short: 'Ocean', color: '#2f7fb8' },
  plankton: { name: 'Plankton ecology', short: 'Plankton', color: '#3f9a5c' },
  geology: { name: 'Marine geology', short: 'Geology', color: '#a3672a' },
  moorings: { name: 'Mooring team', short: 'Moorings', color: '#6b5ab8' },
  ice: { name: 'Sea-ice team', short: 'Sea ice', color: '#2a9aa3' },
  retroseep: { name: 'RetroSeep', short: 'RetroSeep', color: '#c04f6d' },
  crew: { name: 'Ship’s crew', short: 'Crew', color: '#4d5a61' },
};

// needs: wind/gust (kn, watch mean and peak), heave (m), air (°C, at most), fog (RH % below), light (daylight watch).
export const OPS = {
  ctd: { label: 'CTD-Rosette', short: 'CTD', team: 'oceanography', base: 10, kind: 'winch', needs: { wind: 30, heave: 1.0 } },
  nets: { label: 'Plankton nets', short: 'Nets', team: 'plankton', base: 9, kind: 'winch', needs: { wind: 22, heave: 0.8 } },
  box: { label: 'Box core', short: 'Box core', team: 'geology', base: 12, kind: 'winch', needs: { wind: 25, heave: 0.6 } },
  piston: { label: 'Piston core', short: 'Piston', team: 'geology', base: 16, kind: 'winch', needs: { gust: 30, heave: 0.4, light: true } },
  mooring: { label: 'Mooring recovery', short: 'Mooring', team: 'moorings', base: 20, kind: 'winch', needs: { gust: 25, heave: 0.3, light: true } },
  ice: { label: 'Ice station', short: 'Ice station', team: 'ice', base: 18, kind: 'ice', needs: { gust: 25, air: -1, light: true } },
  helo: { label: 'Helicopter land sampling', short: 'Helicopter', team: 'retroseep', base: 14, kind: 'helo', needs: { gust: 25, fog: FOG_RH, light: true } },
  seep: { label: 'Seep box core', short: 'Seep core', team: 'retroseep', base: 12, kind: 'winch', needs: { wind: 25, heave: 0.6 } },
  transit: { label: 'Transit', short: 'Transit', team: 'crew', base: 0, kind: 'transit', slots: 2, needs: {} },
  drill: { label: 'Boat drill & muster', short: 'Boat drill', team: 'crew', base: 0, kind: 'fixed', needs: {} },
};

// Deck crew run two winch operations a day; the pilot flies one sortie a day.
export const DAILY_LIMITS = { winch: 2, helo: 1 };

const HELO_ROLES = { geo: 'bedrock', lake: 'lake core', glacier: 'glacier' };

export function makeRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function normal(random) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// Draws distinct stations of one role from an area; fewer come back when the area is short of them.
function draw(random, stations, role, count) {
  const pool = stations.filter(s => s.role === role);
  const out = [];
  while (pool.length && out.length < count) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}

export function dayOf(slot) { return Math.floor(slot / WATCHES) + 1; }
export function watchOf(slot) { return slot % WATCHES; }

// Forecast spread grows with lead time in days; the record itself is exact once a watch has passed.
export function sigma(lead) {
  const l = Math.max(0, lead);
  return { wind: 1.5 + 2.4 * l, gust: 2.5 + 3.5 * l, air: 0.4 + 0.6 * l, heave: 0.03 + 0.08 * l, rh: 2 + 3 * l };
}

export function createGame(seed, weather, stations) {
  const random = makeRandom(seed);
  const days = [];
  for (const w of weather.watches) {
    if (!days.length || days[days.length - 1].date !== w.date) days.push({ date: w.date, watches: [] });
    days[days.length - 1].watches.push(w);
  }
  const complete = days.filter(d => d.watches.length === WATCHES);
  if (complete.length < DAYS) throw new Error('The watch record is shorter than a week');
  const start = Math.floor(random() * (complete.length - DAYS + 1));
  const watches = complete.slice(start, start + DAYS).flatMap(d => d.watches.map(w => ({ ...w, light: w.sw >= LIGHT_WM2 })));
  const noise = watches.map(() => ({ wind: normal(random), gust: normal(random), air: normal(random), heave: normal(random), rh: normal(random) }));

  const areaStart = Math.floor(random() * (stations.areas.length - 2));
  const areas = stations.areas.slice(areaStart, areaStart + 3).map(a => ({ area: a.area, lat: a.lat, lon: a.lon, stations: a.stations }));

  const cards = [];
  let id = 0;
  const add = (op, station, area, extra = {}) => cards.push({ id: ++id, op, team: OPS[op].team, station, area, slots: OPS[op].slots ?? 1, placed: null, placedDay: null, status: 'open', ...extra });
  areas.forEach((a, index) => {
    const pool = a.stations.map(s => ({ ...s }));
    const water = draw(random, pool, 'water', 3);
    const seepArea = pool.some(s => /^(Strand|GoodFri)-\d/.test(s.name));
    if (water[0]) add('ctd', water[0].name, index);
    if (water[1]) add('nets', water[1].name, index);
    if (water[2]) add(seepArea ? 'seep' : random() < 0.5 ? 'box' : 'piston', water[2].name, index);
    draw(random, pool, 'mooring', 1).forEach(s => add('mooring', s.name, index));
    draw(random, pool, 'ice', 1).forEach(s => add('ice', s.name, index));
    const land = pool.filter(s => HELO_ROLES[s.role]);
    if (land.length) {
      const site = pick(random, land);
      add('helo', site.name, index, { detail: HELO_ROLES[site.role] });
    }
  });
  add('transit', `${areas[0].area} → ${areas[1].area}`, 1, { leg: 1 });
  add('transit', `${areas[1].area} → ${areas[2].area}`, 2, { leg: 2 });
  const grid = Array(SLOTS).fill(null);
  // A weekly boat drill is fixed on the plan before anyone else asks for the deck.
  const drillSlot = (1 + Math.floor(random() * 5)) * WATCHES + 1;
  add('drill', 'All hands', -1, { placed: drillSlot, placedDay: 1, status: 'fixed' });
  grid[drillSlot] = id;

  return { seed: String(seed), day: 1, finished: false, mutiny: false, points: 0, areas, watches, noise, cards, grid, grievances: [], log: [], bumped: [] };
}

export function cardById(state, id) { return state.cards.find(c => c.id === id) ?? null; }

// Area the ship is in during a slot according to the planned transits: 0–2, or -1 while under way.
export function shipArea(state, slot) {
  let area = 0;
  for (const leg of [1, 2]) {
    const transit = state.cards.find(c => c.op === 'transit' && c.leg === leg && c.placed !== null);
    if (!transit) break;
    if (slot >= transit.placed && slot < transit.placed + 2) return -1;
    if (slot >= transit.placed + 2) area = leg;
    else break;
  }
  return area;
}

export function lead(state, slot) { return dayOf(slot) - state.day; }

export function forecast(state, slot) {
  const actual = state.watches[slot];
  if (slot < (state.day - 1) * WATCHES) return { ...actual, sigma: sigma(-1), past: true };
  const s = sigma(lead(state, slot));
  const n = state.noise[slot];
  return {
    wind: Math.max(0, actual.wind + n.wind * s.wind),
    gust: Math.max(0, actual.gust + n.gust * s.gust),
    air: actual.air + n.air * s.air,
    heave: Math.max(0.04, actual.heave + n.heave * s.heave),
    rh: Math.min(100, Math.max(40, actual.rh + n.rh * s.rh)),
    light: actual.light,
    sigma: s,
    past: false,
  };
}

function cdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - 0.3989422804 * Math.exp(-z * z / 2) * poly;
  return z >= 0 ? p : 1 - p;
}

// Probability, from the current forecast, that a watch meets an operation's needs.
export function chance(state, op, slot) {
  const needs = OPS[op].needs;
  const f = forecast(state, slot);
  let p = 1;
  if (needs.light && !f.light) return 0;
  if (needs.wind !== undefined) p *= cdf((needs.wind - f.wind) / f.sigma.wind);
  if (needs.gust !== undefined) p *= cdf((needs.gust - f.gust) / f.sigma.gust);
  if (needs.heave !== undefined) p *= cdf((needs.heave - f.heave) / f.sigma.heave);
  if (needs.air !== undefined) p *= cdf((needs.air - f.air) / f.sigma.air);
  if (needs.fog !== undefined) p *= cdf((needs.fog - f.rh) / f.sigma.rh);
  return p;
}

// Why a watch's recorded conditions refuse an operation; empty when it goes ahead.
export function refusals(op, w) {
  const needs = OPS[op].needs;
  const out = [];
  if (needs.light && !w.light) out.push('dark');
  if (needs.wind !== undefined && w.wind > needs.wind) out.push(`wind ${Math.round(w.wind)} kn`);
  if (needs.gust !== undefined && w.gust > needs.gust) out.push(`gusts ${Math.round(w.gust)} kn`);
  if (needs.heave !== undefined && w.heave > needs.heave) out.push(`heave ${w.heave.toFixed(2)} m`);
  if (needs.air !== undefined && w.air > needs.air) out.push(`air ${w.air > 0 ? '+' : ''}${w.air.toFixed(1)} °C, floe too soft`);
  if (needs.fog !== undefined && w.rh >= needs.fog) out.push('fog');
  return out;
}

export function needsText(op) {
  const n = OPS[op].needs;
  const parts = [];
  if (n.wind !== undefined) parts.push(`wind ≤ ${n.wind} kn`);
  if (n.gust !== undefined) parts.push(`gusts ≤ ${n.gust} kn`);
  if (n.heave !== undefined) parts.push(`heave ≤ ${n.heave} m`);
  if (n.air !== undefined) parts.push(`air ≤ ${n.air} °C`);
  if (n.fog !== undefined) parts.push('no fog');
  if (n.light) parts.push('daylight');
  return parts.join(' · ');
}

export function multiplier(leadDays) { return 1 + LEAD_BONUS * Math.max(0, leadDays); }

function slotsOf(card) { return card.placed === null ? [] : Array.from({ length: card.slots }, (_, i) => card.placed + i); }

function dayLoad(state, day, kind, ignoreId) {
  let n = 0;
  for (let w = 0; w < WATCHES; w++) {
    const c = cardById(state, state.grid[(day - 1) * WATCHES + w]);
    if (c && c.id !== ignoreId && OPS[c.op].kind === kind && slotsOf(c)[0] === (day - 1) * WATCHES + w) n++;
  }
  return n;
}

// Whether a card may go on a slot now. Returns { ok, reason }.
export function canPlace(state, cardId, slot) {
  const card = cardById(state, cardId);
  if (!card || state.finished) return { ok: false, reason: 'Nothing to plan.' };
  if (card.status === 'fixed' || card.status === 'done' || card.status === 'missed') return { ok: false, reason: 'That item is settled.' };
  if (slot < (state.day - 1) * WATCHES) return { ok: false, reason: 'That watch has passed.' };
  const slots = Array.from({ length: card.slots }, (_, i) => slot + i);
  if (slots[slots.length - 1] >= SLOTS) return { ok: false, reason: 'A transit needs two watches before the week ends.' };
  for (const s of slots) {
    const occupant = state.grid[s];
    if (occupant !== null && occupant !== card.id) return { ok: false, reason: `${OPS[cardById(state, occupant).op].label} already holds that watch.` };
  }
  const kind = OPS[card.op].kind;
  if (card.op === 'transit') {
    if (card.leg === 2) {
      const first = state.cards.find(c => c.op === 'transit' && c.leg === 1);
      if (first.placed === null) return { ok: false, reason: `Plan the ${first.station} transit first.` };
      if (slot < first.placed + 2) return { ok: false, reason: `The ship reaches ${state.areas[1].area} only after the first transit.` };
    }
    if (card.leg === 1) {
      const second = state.cards.find(c => c.op === 'transit' && c.leg === 2);
      if (second.placed !== null && second.placed < slot + 2 && second.id !== card.id) return { ok: false, reason: 'The second transit is planned before this one; clear it first.' };
    }
    return { ok: true };
  }
  const area = shipArea(state, slot);
  if (area === -1) return { ok: false, reason: 'The ship is under way on that watch.' };
  if (area !== card.area) {
    return { ok: false, reason: area < card.area ? `The ship is still in ${state.areas[area].area} on that watch. Plan the transit first.` : `The ship has left ${state.areas[card.area].area} by then.` };
  }
  if (DAILY_LIMITS[kind] !== undefined && dayLoad(state, dayOf(slot), kind, card.id) >= DAILY_LIMITS[kind]) {
    return { ok: false, reason: kind === 'winch' ? 'Deck crew can run two winch operations a day.' : 'The pilot flies one sortie a day.' };
  }
  return { ok: true };
}

function lift(state, card) {
  for (const s of slotsOf(card)) if (state.grid[s] === card.id) state.grid[s] = null;
  card.placed = null;
  card.placedDay = null;
  if (card.status === 'planned') card.status = 'open';
}

// Cards whose watch no longer fits the planned transits come back to the board.
function settle(state) {
  const bumped = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of state.cards) {
      if (card.placed === null || card.status !== 'planned') continue;
      if (card.op === 'transit') {
        if (card.leg === 2) {
          const first = state.cards.find(c => c.op === 'transit' && c.leg === 1);
          if (first.placed === null || card.placed < first.placed + 2) { lift(state, card); bumped.push(card); changed = true; }
        }
        continue;
      }
      if (shipArea(state, card.placed) !== card.area) { lift(state, card); bumped.push(card); changed = true; }
    }
  }
  state.bumped = bumped;
  return bumped;
}

// Placing resets the lead clock: the bonus rewards a plan that held, not one that was shuffled.
export function place(state, cardId, slot) {
  const check = canPlace(state, cardId, slot);
  if (!check.ok) return check;
  const card = cardById(state, cardId);
  if (card.placed === slot) return { ok: true, moved: false, bumped: [], unchanged: true };
  const moved = card.placed !== null;
  lift(state, card);
  card.placed = slot;
  card.placedDay = state.day;
  card.status = 'planned';
  for (const s of slotsOf(card)) state.grid[s] = card.id;
  const bumped = card.op === 'transit' ? settle(state) : [];
  return { ok: true, moved, bumped };
}

export function remove(state, slot) {
  const card = cardById(state, state.grid[slot]);
  if (!card || state.finished) return { ok: false, reason: 'Nothing planned on that watch.' };
  if (slot < (state.day - 1) * WATCHES) return { ok: false, reason: 'That watch has passed.' };
  if (card.status === 'fixed') return { ok: false, reason: 'The boat drill stays where it is.' };
  lift(state, card);
  const bumped = card.op === 'transit' ? settle(state) : [];
  return { ok: true, card, bumped };
}

function grieve(state, team, text) {
  state.grievances.push({ team, text, day: state.day });
}

function miss(state, card, text) {
  card.status = 'missed';
  grieve(state, card.team, text);
}

// Executes the current day's plan against the recorded watches and advances the calendar.
export function issue(state) {
  if (state.finished) return null;
  const day = state.day;
  const report = { day, entries: [], missed: [], mutiny: false, finished: false };
  for (let w = 0; w < WATCHES; w++) {
    const slot = (day - 1) * WATCHES + w;
    const card = cardById(state, state.grid[slot]);
    const actual = state.watches[slot];
    if (!card) { report.entries.push({ slot, idle: true }); continue; }
    if (card.status === 'fixed') { card.status = 'done'; report.entries.push({ slot, card, ok: true, points: 0 }); continue; }
    if (card.op === 'transit') {
      if (slot !== card.placed + 1) { report.entries.push({ slot, card, ok: true, underway: true }); continue; }
      card.status = 'done';
      const left = card.area - 1;
      for (const other of state.cards) {
        if (other.area === left && (other.status === 'open' || other.status === 'planned')) {
          lift(state, other);
          miss(state, other, `${OPS[other.op].label} at ${other.station} never happened before the ship left ${state.areas[left].area}.`);
          report.missed.push(other);
        }
      }
      report.entries.push({ slot, card, ok: true, points: 0, arrived: state.areas[card.area].area });
      continue;
    }
    if (card.status !== 'planned') continue;
    const reasons = refusals(card.op, actual);
    if (reasons.length) {
      lift(state, card);
      card.attempts = (card.attempts ?? 0) + 1;
      grieve(state, card.team, `${OPS[card.op].label} at ${card.station} lost its window: ${reasons.join(', ')}.`);
      report.entries.push({ slot, card, ok: false, reasons });
      continue;
    }
    const leadDays = day - card.placedDay;
    let points = OPS[card.op].base * multiplier(leadDays);
    let note = null;
    // Zooplankton rise towards the surface after dark; a night tow fills the nets.
    if (card.op === 'nets' && !actual.light) { points *= 1.5; note = 'night tow'; }
    points = Math.round(points);
    card.status = 'done';
    card.points = points;
    card.lead = leadDays;
    state.points += points;
    report.entries.push({ slot, card, ok: true, points, lead: leadDays, note });
  }
  state.log.push(report);
  if (day === DAYS) {
    for (const card of state.cards) {
      if (card.op === 'transit' && card.status !== 'done') {
        lift(state, card);
        card.status = 'missed';
        grieve(state, 'crew', `The ship never made the ${card.station} passage; the leg schedule slips.`);
        grieve(state, 'crew', 'Crew change waits on a ship that is not there.');
        report.missed.push(card);
      } else if (card.status === 'open' || card.status === 'planned') {
        lift(state, card);
        miss(state, card, `${OPS[card.op].label} at ${card.station} was still on the board when the week ended.`);
        report.missed.push(card);
      }
    }
  }
  if (state.grievances.length >= MUTINY_AT) {
    state.mutiny = true;
    state.finished = true;
    report.mutiny = true;
    report.finished = true;
  } else if (day === DAYS) {
    const content = Object.keys(TEAMS).filter(t => t !== 'crew' && state.cards.some(c => c.team === t) && !state.grievances.some(g => g.team === t));
    report.contentTeams = content;
    report.bonus = content.length * 10;
    state.points += report.bonus;
    state.finished = true;
    report.finished = true;
  } else {
    state.day += 1;
  }
  return report;
}

export function summary(state) {
  const done = state.cards.filter(c => c.status === 'done' && OPS[c.op].base > 0);
  const longest = done.reduce((m, c) => Math.max(m, c.lead ?? 0), 0);
  return {
    title: state.mutiny ? 'Mutiny in the mess' : 'Plan of the day',
    points: state.mutiny ? 0 : state.points,
    mutiny: state.mutiny,
    daysIssued: state.log.length,
    operations: done.length,
    requests: state.cards.filter(c => OPS[c.op].base > 0).length,
    grievances: state.grievances.length,
    longestLeadDays: longest,
    areas: state.areas.map(a => a.area),
    watchDates: [state.watches[0].date, state.watches[SLOTS - 1].date],
    seed: state.seed,
  };
}
