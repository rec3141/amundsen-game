// Pure game model for the Inuktitut minigame: deterministic decks for three legs (syllabics, words, chart),
// answer checking with one retry per missed card, hints that halve a card's points, and the final score.
import { VOWELS, SERIES, SOUNDS, WORDS, SUFFIXES, BUILDS, ROOTS, PLACES } from './crew-22-lexicon.js';

export const LEGS = [
  { id: 'syllabics', name: 'Syllabics', inuk: 'ᖃᓂᐅᔮᖅᐸᐃᑦ', roman: 'qaniujaaqpait', cards: 8, points: 4,
    brief: 'Each shape is a consonant. Turn it and the vowel changes: ᐱ pi, ᐳ pu, ᐸ pa. A dot above makes the vowel long; a small raised shape is a consonant with no vowel. Name the sound, or find the glyph.' },
  { id: 'words', name: 'Words', inuk: 'ᐅᖃᐅᓰᑦ', roman: 'uqausiit', cards: 8, points: 6,
    brief: 'Ice, sea, weather, animals, gear and greetings from a working coast. A doubled letter is held twice as long, and length changes meaning: imaq is the sea, imiq drinking water.' },
  { id: 'chart', name: 'The chart', inuk: 'ᓄᓇᙳᐊᖅ', roman: 'nunannguaq', cards: 8, points: 8,
    brief: 'Inuktitut builds words by stacking suffixes on a root: umiaq, boat, plus -rjuaq, big, is umiarjuaq, a ship. The names on the chart are built the same way. Read them, then build a few.' },
];
const STREAK_EVERY = 5, STREAK_BONUS = 10;

// Deterministic RNG (mulberry32) so a seed replays the same deck.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, random) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (list, random) => list[Math.floor(random() * list.length)];

// Romanized Inuktitut to syllabics. Consonant digraphs first (nng, ng), doubled vowels are long, a consonant
// with no vowel after it becomes a final. Used to write built words and to keep the lexicon honest.
const BY_C = Object.fromEntries(SERIES.map(row => [row.c, row]));
export function toSyllabics(roman) {
  const text = roman.toLowerCase().replace(/[^a-zł&]/g, ch => ch === '&' ? 'ł' : ch === '’' ? '' : ch === ' ' ? ' ' : '');
  let out = '', i = 0;
  const isVowel = ch => ch === 'a' || ch === 'i' || ch === 'u';
  while (i < text.length) {
    if (text[i] === ' ') { out += ' '; i++; continue; }
    let c = '';
    if (text.startsWith('nng', i)) { c = 'nng'; i += 3; }
    else if (text.startsWith('ng', i)) { c = 'ng'; i += 2; }
    else if (!isVowel(text[i])) { c = text[i]; i++; }
    const row = BY_C[c];
    if (!row) { out += c; continue; }
    if (i < text.length && isVowel(text[i])) {
      const v = text[i]; i++;
      const long = text[i] === v; if (long) i++;
      out += row.glyphs[VOWELS.indexOf(v + (long ? v : ''))];
    } else out += row.final;
  }
  return out;
}

// Great-circle distance in km, for naming the nearest community.
export function kmBetween(lat0, lon0, lat1, lon1) {
  const r = Math.PI / 180, dLat = (lat1 - lat0) * r, dLon = (lon1 - lon0) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat0 * r) * Math.cos(lat1 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function nearestPlace(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const place of PLACES) {
    if (place.lat === undefined) continue;
    const km = kmBetween(lat, lon, place.lat, place.lon);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

// ---------- decks ----------
const romanOf = (row, vi) => row.c + VOWELS[vi];
function syllabicsCard(random, used) {
  // Rows with a real final; the bare-vowel row only supplies vowel glyphs.
  const common = SERIES.filter(row => ['', 'p', 't', 'k', 'g', 'm', 'n', 's', 'l', 'j', 'v', 'r', 'q', 'ng'].includes(row.c));
  for (let tries = 0; tries < 40; tries++) {
    const row = pick(common, random);
    const finalCard = row.final && random() < 0.15;
    const vi = Math.floor(random() * 6);
    const glyph = finalCard ? row.final : row.glyphs[vi];
    if (used.has(glyph)) continue;
    used.add(glyph);
    const roman = finalCard ? row.c : romanOf(row, vi);
    const reverse = random() < 0.4;
    let distractors;
    if (finalCard) {
      const others = shuffle(common.filter(r => r.final && r !== row), random).slice(0, 3);
      distractors = others.map(r => ({ label: r.final, sub: r.c }));
    } else {
      // Same consonant with other vowels teaches orientation; same vowel with another consonant teaches shape.
      const sameRow = shuffle([0, 1, 2, 3, 4, 5].filter(k => k !== vi), random).slice(0, 2).map(k => ({ label: row.glyphs[k], sub: romanOf(row, k) }));
      const otherRow = pick(common.filter(r => r !== row), random);
      distractors = [...sameRow, { label: otherRow.glyphs[vi], sub: romanOf(otherRow, vi) }];
    }
    const correct = { label: glyph, sub: roman };
    const options = shuffle([correct, ...distractors], random);
    const answer = options.indexOf(correct);
    const long = !finalCard && VOWELS[vi].length === 2;
    const note = finalCard
      ? `${glyph} is a final ${row.c}: a small raised ${row.glyphs[4]} with no vowel, as in ${row.c === 'q' ? 'nanuq ᓇᓄᖅ' : row.c === 'k' ? 'inuk ᐃᓄᒃ' : row.c === 't' ? 'aput ᐊᐳᑦ' : `-${row.c}`}.`
      : `${glyph} is ${roman}: ${row.c ? `the ${row.c} shape (${SOUNDS[row.c]})` : 'a bare vowel'} turned for ${VOWELS[vi][0]}${long ? ', with the dot for a long vowel' : ''}. The row reads ${row.glyphs.join(' ')}: ${VOWELS.map(v => row.c + v).join(', ')}.`;
    return reverse
      ? { kind: 'sound', prompt: roman, promptSub: 'Which glyph writes this sound?', options: options.map(o => ({ label: o.label, sub: '' })), answer, note, glyph, roman, row: row.c, vi: finalCard ? -1 : vi }
      : { kind: 'glyph', prompt: glyph, promptSub: 'What sound is this?', options: options.map(o => ({ label: o.sub, sub: '' })), answer, note, glyph, roman, row: row.c, vi: finalCard ? -1 : vi };
  }
  return null;
}
export function syllabicsDeck(random, n) {
  const used = new Set(), deck = [];
  while (deck.length < n) { const card = syllabicsCard(random, used); if (!card) break; deck.push(card); }
  return deck;
}

export function wordDeck(random, n, exclude = new Set()) {
  // Spread the cards over domains so a deck is not all animals.
  const domains = shuffle([...new Set(WORDS.map(w => w.d))], random);
  const chosen = [];
  let k = 0;
  while (chosen.length < n && k < 200) {
    const pool = WORDS.filter(w => w.d === domains[k % domains.length] && !chosen.includes(w) && !exclude.has(w.w));
    if (pool.length) chosen.push(pick(pool, random));
    k++;
  }
  return chosen.map(word => {
    const same = WORDS.filter(w => w.d === word.d && w !== word && w.en !== word.en);
    const others = WORDS.filter(w => w.d !== word.d && w.en !== word.en);
    const distractors = [...shuffle(same, random).slice(0, 3)];
    while (distractors.length < 3) distractors.push(pick(others.filter(w => !distractors.includes(w)), random));
    const reverse = random() < 0.45;
    const items = shuffle([word, ...distractors], random);
    const answer = items.indexOf(word);
    return reverse
      ? { kind: 'gloss', prompt: word.en, promptSub: 'Which word is this?', options: items.map(w => ({ label: w.s, sub: w.w })), answer, note: word.note, word }
      : { kind: 'word', prompt: word.s, promptSub: word.w, options: items.map(w => ({ label: w.en, sub: '' })), answer, note: word.note, word };
  });
}

export function chartDeck(random, n, near) {
  const deck = [];
  // Place names: the nearest community first when the ship has a position, then a spread of the rest.
  const placePool = shuffle(PLACES.filter(p => p !== near), random);
  const places = near ? [near, ...placePool] : placePool;
  const nPlaces = Math.ceil(n / 2), nBuilds = n - nPlaces;
  for (const place of places.slice(0, nPlaces)) {
    const distractors = shuffle(PLACES.filter(p => p !== place && p.en !== place.en), random).slice(0, 3);
    const items = shuffle([place, ...distractors], random);
    deck.push({ kind: 'place', prompt: place.s || place.name, roman: !place.s, promptSub: `${place.name}${place.english && place.english !== place.name ? ` · ${place.english}` : ''} · ${place.region}`,
      options: items.map(p => ({ label: p.en, sub: '' })), answer: items.indexOf(place), note: `${place.name}: ${place.parts}.`, place });
  }
  for (const build of shuffle(BUILDS, random).slice(0, nBuilds)) {
    const rootOptions = shuffle([build.root, ...shuffle(ROOTS.filter(r => r !== build.root), random).slice(0, 3)], random);
    const suffixOptions = shuffle([build.suffix, ...shuffle(SUFFIXES.map(s => s.m).filter(m => m !== build.suffix), random).slice(0, 3)], random);
    const suffix = SUFFIXES.find(s => s.m === build.suffix);
    deck.push({ kind: 'build', prompt: build.en, promptSub: 'Build it: pick a root, then a suffix',
      roots: rootOptions.map(r => ({ label: r, sub: toSyllabics(r), gloss: WORDS.find(w => w.w === r)?.en ?? (r === 'tuugaaq' ? 'tusk' : r === 'iqaluit' ? 'Iqaluit' : '') })),
      suffixes: suffixOptions.map(m => ({ label: m, sub: SUFFIXES.find(s => s.m === m).gloss })),
      answerRoot: rootOptions.indexOf(build.root), answerSuffix: suffixOptions.indexOf(build.suffix),
      note: `${build.root} + ${build.suffix} → ${build.result} ${toSyllabics(build.result)}. ${suffix.note}`, build });
  }
  return shuffle(deck, random);
}

// ---------- session ----------
export function createSession(expedition, seed) {
  const random = rng(seed);
  const near = nearestPlace(expedition?.lat, expedition?.lon);
  const decks = [syllabicsDeck(random, LEGS[0].cards), wordDeck(random, LEGS[1].cards), chartDeck(random, LEGS[2].cards, near?.place)];
  return {
    seed, near, decks, leg: -1, queue: [], card: null, phase: 'intro',
    score: 0, streak: 0, bestStreak: 0, correct: 0, firstTry: 0, asked: 0, hints: 0,
    legStats: LEGS.map(() => ({ correct: 0, asked: 0, points: 0 })), learned: [], last: null,
  };
}
// Points a card is worth right now: the leg's value, halved once for a retry and once for a hint.
export function worth(state) {
  const base = LEGS[state.leg].points;
  return Math.max(1, Math.round(base / (state.card.retry ? 2 : 1) / (state.card.hinted ? 2 : 1)));
}
export function startLeg(state) {
  state.leg++;
  if (state.leg >= LEGS.length) { state.phase = 'end'; state.card = null; return state; }
  state.queue = state.decks[state.leg].map(card => ({ ...card, retry: false, hinted: false }));
  state.phase = 'brief';
  state.card = null;
  return state;
}
export function draw(state) {
  if (!state.queue.length) return startLeg(state);
  state.card = state.queue.shift();
  state.phase = 'ask';
  state.last = null;
  return state;
}
export function hint(state) {
  if (state.phase !== 'ask' || state.card.hinted) return false;
  state.card.hinted = true; state.hints++;
  return true;
}
// `choice` is an option index, or { root, suffix } for a build card.
export function answer(state, choice) {
  if (state.phase !== 'ask') return null;
  const card = state.card;
  const ok = card.kind === 'build' ? choice.root === card.answerRoot && choice.suffix === card.answerSuffix : choice === card.answer;
  const stats = state.legStats[state.leg];
  state.asked++; stats.asked++;
  let points = 0, bonus = 0;
  if (ok) {
    points = worth(state);
    state.correct++; stats.correct++;
    if (!card.retry) state.firstTry++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    if (state.streak % STREAK_EVERY === 0) bonus = STREAK_BONUS;
    state.score += points + bonus; stats.points += points + bonus;
    const learned = card.word ? { s: card.word.s, w: card.word.w, en: card.word.en }
      : card.place ? { s: card.place.s || card.place.name, w: card.place.name, en: card.place.en }
      : card.build ? { s: toSyllabics(card.build.result), w: card.build.result, en: card.build.en } : null;
    if (learned && !state.learned.some(l => l.w === learned.w)) state.learned.push(learned);
  } else {
    state.streak = 0;
    if (!card.retry) state.queue.push({ ...card, retry: true, hinted: false });
  }
  state.last = { ok, points, bonus, choice, retry: card.retry, remaining: state.queue.length };
  state.phase = 'feedback';
  return state.last;
}
export function summary(state) {
  const total = state.decks.reduce((n, d) => n + d.length, 0);
  return { points: state.score, correct: state.correct, firstTry: state.firstTry, cards: total, asked: state.asked, bestStreak: state.bestStreak, hints: state.hints,
    legs: LEGS.map((leg, i) => ({ id: leg.id, ...state.legStats[i] })), learned: state.learned.map(l => l.w) };
}
export function accuracyLabel(firstTry, total) {
  const f = total ? firstTry / total : 0;
  return f >= 0.95 ? 'Uqaalasuuq: a speaker' : f >= 0.8 ? 'Ilinniaqtuq: a fast learner' : f >= 0.6 ? 'Tusaajuq: an attentive listener' : 'Ilisaqsijuq: getting acquainted';
}
