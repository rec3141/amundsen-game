// Pure rules for Neptune's Wrath: the purse ledger, the seeded RNG and the trial physics.
// No DOM here, so a harness can shadow a run step for step.

export const TRIBUTE = 30;        // points Neptune lends when he boards
export const PASS_AWARD = 20;     // purse change for a passed trial, before excellence bonus
export const FAIL_TAKE = 15;      // purse change for a failed trial
export const WRATH_FAILS = 3;     // failures that end the court early
export const WRATH_TAKE = 10;     // extra he sweeps off the table when his patience runs out
export const BLUE_NOSE = 25;      // bonus for clearing every trial
export const TRIALS_PER_COURT = 5;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function shuffle(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Ledger: purse after each verdict, and whether the court is still sitting.
export function applyVerdict(ledger, verdict) {
  const change = verdict.passed ? PASS_AWARD + (verdict.bonus || 0) : -FAIL_TAKE;
  const fails = ledger.fails + (verdict.passed ? 0 : 1);
  let purse = ledger.purse + change;
  let wrath = false;
  if (fails >= WRATH_FAILS) { purse -= WRATH_TAKE; wrath = true; }
  return { purse, fails, passes: ledger.passes + (verdict.passed ? 1 : 0), change, wrath };
}

export function mood(ledger) {
  // 0 calm .. 1 furious. Each failure darkens the sea; passes lighten it a little.
  return clamp(0.15 + ledger.fails * 0.35 - ledger.passes * 0.05, 0, 1);
}

// Sounding: the player's call is judged on a log scale, so 30 % is 30 % at 40 m and at 2000 m.
export function judgeSounding(call, truth) {
  const ratio = Math.abs(Math.log(call / truth));
  if (ratio <= Math.log(1.1)) return { passed: true, bonus: 8, grade: 'within a tenth' };
  if (ratio <= Math.log(1.3)) return { passed: true, bonus: 0, grade: 'within a third' };
  return { passed: false, bonus: 0, grade: ratio <= Math.log(2) ? 'off by half or more' : 'nowhere near' };
}

// Sounding slider maps 0..1 to 5..3000 m on a log scale.
export const SOUNDING_MIN = 5, SOUNDING_MAX = 3000;
export const sliderToDepth = s => Math.round(SOUNDING_MIN * Math.pow(SOUNDING_MAX / SOUNDING_MIN, clamp(s, 0, 1)));
export const depthToSlider = z => clamp(Math.log(z / SOUNDING_MIN) / Math.log(SOUNDING_MAX / SOUNDING_MIN), 0, 1);

// Trident: the marker sweeps a triangle wave across the bar; the band is a window in [0,1].
export function tridentMarker(t, period) {
  const phase = (t / period) % 1;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}
export function judgeStrike(marker, band) {
  const centre = band.at + band.width / 2;
  const off = Math.abs(marker - centre) / (band.width / 2);
  if (off > 1) return { hit: false, points: 0 };
  return { hit: true, points: off < 0.35 ? 10 : 7 };
}

// Swell sequence: directions Neptune shows, one round longer each time.
export const DIRECTIONS = ['up', 'right', 'down', 'left'];
export function makeSequence(rng, length) {
  const seq = [];
  for (let i = 0; i < length; i++) {
    let next = DIRECTIONS[Math.floor(rng() * 4)];
    // Three of the same in a row reads as a stutter, not a swell.
    if (seq.length >= 2 && seq.at(-1) === next && seq.at(-2) === next) next = DIRECTIONS[(DIRECTIONS.indexOf(next) + 1) % 4];
    seq.push(next);
  }
  return seq;
}

// Wardroom mug on a rolling table. Roll is a sum of three seeded sines; the mug slides
// with tilt, is damped by the cloth, and is pushed by the player's hands.
export const MUG = { half: 0.5, push: 1.1, damping: 1.4, gravity: 1.9, duration: 12 };
export function makeSea(rng, severity) {
  return [0, 1, 2].map(i => ({
    amp: (0.4 + rng() * 0.5) * severity / (i + 1),
    period: 2.4 + rng() * 3.2 - i * 0.5,
    phase: rng() * Math.PI * 2,
  }));
}
export function rollAt(sea, t) {
  // Radians. Grows over the trial so the last seconds are the hard ones.
  const grow = 0.55 + 0.45 * clamp(t / MUG.duration, 0, 1);
  return sea.reduce((s, w) => s + w.amp * Math.sin((t / w.period) * Math.PI * 2 + w.phase), 0) * grow;
}
export function stepMug(mug, roll, push, dt) {
  const accel = MUG.gravity * Math.sin(roll) + push * MUG.push - mug.v * MUG.damping;
  const v = mug.v + accel * dt;
  const x = mug.x + v * dt;
  return { x, v, fallen: Math.abs(x) > MUG.half };
}

// Riddles. Facts drawn from the leg record are built by riddlesFrom(data); the rest are sea physics.
export const LORE_RIDDLES = [
  { q: 'At 30 salinity, my water freezes near what temperature?', options: ['0.0 °C', '−1.6 °C', '−4.0 °C'], answer: 1, why: 'Freezing point falls about 0.054 °C per unit of salinity; at 30 it sits near −1.6 °C.' },
  { q: 'Which parcel sinks beneath the other?', options: ['−1 °C at 32 salinity', '+2 °C at 30 salinity', '0 °C at 28 salinity'], answer: 0, why: 'Near freezing, salt sets density; the saltiest, coldest parcel is the heaviest.' },
  { q: 'Salt rejected from growing sea ice goes where?', options: ['Into the atmosphere', 'Into the brine beneath the ice', 'It stays in the ice for good'], answer: 1, why: 'Brine drains from young ice into the water below, one reason winter shelf water is dense.' },
  { q: 'Why does the seawater loop read warmer than the sea?', options: ['The pump warms the sample', 'The hull is heated', 'Salinity raises temperature'], answer: 0, why: 'Line warming between intake and sensor adds a few tenths; the record tracks it as excess heat.' },
  { q: 'Sound travels fastest in which water?', options: ['Warm, salty, deep', 'Cold, fresh, shallow', 'Cold, fresh, deep'], answer: 0, why: 'Sound speed rises with temperature, salinity and pressure.' },
  { q: 'A 4σ heave of 1.7 m means, roughly:', options: ['The mean wave height', 'Nearly all heave stays within ±1.7 m', 'The largest wave was 1.7 m'], answer: 1, why: 'Four standard deviations brackets almost the whole vertical motion of the hull.' },
  { q: 'Fresh surface water in my Arctic realm comes mostly from:', options: ['Rain', 'Rivers and melting ice', 'Upwelling'], answer: 1, why: 'Rivers and summer melt cap the Arctic with a fresh, light layer.' },
];

const fmt = (v, digits = 1) => Number(v).toFixed(digits);
export function riddlesFrom(data) {
  if (!data?.extremes) return [];
  const e = data.extremes;
  const near = (v, f) => fmt(v * f, 0);
  return [
    { q: 'How deep was the deepest sounding of this leg?', options: [`${near(e.depthMax.value, 0.55)} m`, `${fmt(e.depthMax.value, 0)} m`, `${near(e.depthMax.value, 1.6)} m`], answer: 1, why: `${fmt(e.depthMax.value, 0)} m under the keel on ${e.depthMax.time.slice(0, 10)} at ${fmt(e.depthMax.lat, 1)}°N ${fmt(-e.depthMax.lon, 1)}°W.` },
    { q: 'The coldest sea surface my realm showed you this leg?', options: [`${fmt(e.sstMin.value, 2)} °C`, '−4.5 °C', '0.3 °C'], answer: 0, why: `${fmt(e.sstMin.value, 2)} °C on ${e.sstMin.time.slice(0, 10)} near ${fmt(e.sstMin.lat, 1)}°N; seawater cannot get much colder without freezing.` },
    { q: 'The strongest relative wind logged this leg?', options: [`${near(e.windMax.value, 0.5)} kn`, `${fmt(e.windMax.value, 0)} kn`, `${near(e.windMax.value, 1.8)} kn`], answer: 1, why: `${fmt(e.windMax.value, 0)} kn over the deck on ${e.windMax.time.slice(0, 10)}.` },
    { q: 'How far has the ship steamed this leg?', options: [`${near(data.distanceKm, 0.6)} km`, `${near(data.distanceKm, 1.5)} km`, `${fmt(data.distanceKm, 0)} km`], answer: 2, why: `${fmt(data.distanceKm, 0)} km in ${fmt(data.hours, 0)} hours of record.` },
    { q: 'The freshest surface water this leg had a salinity of about:', options: [`${fmt(e.salinityMin.value, 1)}`, `${fmt(e.salinityMin.value + 6, 1)}`, `${fmt(e.salinityMin.value + 12, 1)}`], answer: 0, why: `${fmt(e.salinityMin.value, 1)} on ${e.salinityMin.time.slice(0, 10)}: meltwater and river water riding on top.` },
    { q: 'The biggest 4σ heave the hull felt this leg?', options: [`${fmt(e.heaveMax.value, 1)} m`, `${fmt(e.heaveMax.value * 2.5, 1)} m`, `${fmt(e.heaveMax.value * 0.3, 1)} m`], answer: 0, why: `${fmt(e.heaveMax.value, 2)} m on ${e.heaveMax.time.slice(0, 10)}, with roll and pitch RMS of ${fmt(e.rollMax.value, 1)}°.` },
  ];
}

export function dealRiddles(rng, data, count = 3) {
  const fromData = shuffle(rng, riddlesFrom(data));
  const lore = shuffle(rng, LORE_RIDDLES);
  // Prefer the ship's own record; fill the rest with lore.
  const picked = [...fromData.slice(0, Math.min(2, fromData.length)), ...lore].slice(0, count);
  return shuffle(rng, picked).map(r => {
    // Shuffle the options so the answer index is not a tell.
    const order = shuffle(rng, [0, 1, 2]);
    return { q: r.q, why: r.why, options: order.map(i => r.options[i]), answer: order.indexOf(r.answer) };
  });
}
