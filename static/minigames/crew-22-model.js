// Guided Inuktitut practice: a fixed syllabics progression, free help, and unlimited same-card retries.
import { VOWELS, SERIES, SOUNDS, WORDS, SUFFIXES, BUILDS, ROOTS, PLACES } from './crew-22-lexicon.js';

export const LEGS = [
  { id: 'syllabics', name: 'Syllabics', inuk: 'ᖃᓂᐅᔮᖅᐸᐃᑦ', roman: 'qaniujaaqpait', cards: 6, points: 4,
    brief: 'Each shape is a consonant. Turn it and the vowel changes: ᐱ pi, ᐳ pu, ᐸ pa. A dot above makes the vowel long; a small raised shape is a consonant with no vowel. Follow the p shape through three vowels, add a length dot, then meet a final and spell aput. Each example stays visible while you practise.' },
  { id: 'words', name: 'Words', inuk: 'ᐅᖃᐅᓰᑦ', roman: 'uqausiit', cards: 4, points: 6,
    brief: 'Ice, sea, weather, animals, gear and greetings from a working coast. A doubled letter is held twice as long, and length changes meaning: imaq is the sea, imiq drinking water.' },
  { id: 'chart', name: 'The chart', inuk: 'ᓄᓇᙳᐊᖅ', roman: 'nunannguaq', cards: 4, points: 8,
    brief: 'Inuktitut builds words by stacking suffixes on a root: umiaq, boat, plus -rjuaq, big, is umiarjuaq, a ship. The names on the chart are built the same way. Read them, then build a few.' },
];


// Deterministic RNG (mulberry32) so a seed replays the same deck.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, random) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (list, random) => list[Math.floor(random() * list.length)];

// Romanized Inuktitut to syllabics, one token per glyph. Consonant digraphs first (nng, ng), a doubled vowel is
// long, a consonant with no vowel after it becomes a final. Letters outside the Inuktitut inventory (e, o, h, b,
// c...) pass through as `raw` so the workbench can point at them. Used to write built words, to deal the spelling
// cards and to keep the lexicon honest.
const BY_C = Object.fromEntries(SERIES.map(row => [row.c, row]));
const isVowel = ch => ch === 'a' || ch === 'i' || ch === 'u';
export function syllables(roman) {
  const text = String(roman).toLowerCase().replace(/&/g, 'ł').replace(/[^a-zł ]/g, '');
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') { tokens.push({ space: true, glyph: ' ', roman: ' ' }); i++; continue; }
    let c = '';
    if (text.startsWith('nng', i)) { c = 'nng'; i += 3; }
    else if (text.startsWith('ng', i)) { c = 'ng'; i += 2; }
    else if (!isVowel(text[i])) { c = text[i]; i++; }
    const row = BY_C[c];
    if (!row) { tokens.push({ raw: c, glyph: c, roman: c }); continue; }
    if (i < text.length && isVowel(text[i])) {
      const v = text[i]; i++;
      const long = text[i] === v; if (long) i++;
      const vi = VOWELS.indexOf(v + (long ? v : ''));
      tokens.push({ c, v, long, vi, glyph: row.glyphs[vi], roman: c + VOWELS[vi] });
    } else tokens.push({ c, final: true, vi: -1, glyph: row.final, roman: c });
  }
  return tokens;
}
export const toSyllabics = roman => syllables(roman).map(t => t.glyph).join('');

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
// Spelling cards: a short word in Roman letters, four syllabic spellings, one right. Each wrong one breaks a single
// rule of the system (a glyph turned for the wrong vowel, a length dot added or dropped, a full syllable where a
// final belongs or the reverse, another consonant's shape) so the feedback can name the rule.
export function spellable(word) {
  if (/[ \-']/.test(word.w)) return false;
  const tokens = syllables(word.w);
  return tokens.length >= 2 && tokens.length <= 4 && tokens.every(t => !t.raw) && toSyllabics(word.w) === word.s;
}
function mutations(tokens) {
  const out = [];
  const write = (list, k, token) => list.map((t, j) => j === k ? token : t);
  const form = list => ({ glyph: list.map(t => t.glyph).join(''), roman: list.map(t => t.roman).join('') });
  tokens.forEach((t, k) => {
    const row = BY_C[t.c];
    if (t.final) {
      for (const vi of [4, 0]) out.push({ ...form(write(tokens, k, { glyph: row.glyphs[vi], roman: t.c + VOWELS[vi] })), why: `${row.glyphs[vi]} is a full syllable ${t.c + VOWELS[vi]}; a bare ${t.c} is the small raised ${row.final}` });
      return;
    }
    for (const v of ['i', 'u', 'a'].filter(v => v !== t.v)) {
      const vi = VOWELS.indexOf(v + (t.long ? v : ''));
      out.push({ ...form(write(tokens, k, { glyph: row.glyphs[vi], roman: t.c + VOWELS[vi] })), why: `${row.glyphs[vi]} is the ${t.c || 'vowel'} shape turned for ${v}` });
    }
    const vi = t.long ? t.vi - 1 : t.vi + 1;
    out.push({ ...form(write(tokens, k, { glyph: row.glyphs[vi], roman: t.c + VOWELS[vi] })), why: t.long ? `${row.glyphs[vi]} has no dot, so its vowel is short` : `the dot over ${row.glyphs[vi]} makes the vowel long` });
    if (k === tokens.length - 1 && row.final) out.push({ ...form(write(tokens, k, { glyph: row.final, roman: t.c })), why: `${row.final} is a bare ${t.c} with no vowel` });
    for (const other of ['p', 't', 'k', 'g', 'm', 'n', 's', 'l', 'j', 'v', 'r', 'q'].filter(c => c !== t.c && c)) {
      const g = BY_C[other].glyphs[t.vi];
      out.push({ ...form(write(tokens, k, { glyph: g, roman: other + VOWELS[t.vi] })), why: `${g} is the ${other} shape, not ${t.c || 'a bare vowel'}`, shape: true });
    }
  });
  return out;
}
export function spellCard(word, random) {
  const tokens = syllables(word.w);
  const pool = shuffle(mutations(tokens), random);
  const chosen = [];
  // Rule breaks first, one look-alike shape at most, no two spellings that read the same, and only spellings whose
  // Roman reading writes back to the same glyphs (ᐅᒥᐃᖅ would romanise as umiiq, which is ᐅᒦᖅ).
  for (const m of [...pool.filter(m => !m.shape), ...pool.filter(m => m.shape)]) {
    if (m.glyph === word.s || toSyllabics(m.roman) !== m.glyph || chosen.some(c => c.glyph === m.glyph) || (m.shape && chosen.some(c => c.shape))) continue;
    chosen.push(m);
    if (chosen.length === 3) break;
  }
  const correct = { glyph: word.s, roman: word.w };
  const options = shuffle([correct, ...chosen], random);
  const parts = tokens.map(t => t.final ? `${t.glyph} a small final ${t.c}` : `${t.glyph} ${t.roman}${t.long ? ' with the length dot' : ''}`).join(', ');
  const note = `${word.s} is ${word.w}, ${word.en}: ${parts}. ${chosen.map(m => `${m.glyph} reads ${m.roman}: ${m.why}`).join('. ')}.`;
  return { kind: 'spell', prompt: word.w, roman: true, promptSub: `Spell it in syllabics · ${word.en}`, options: options.map(o => ({ label: o.glyph, sub: '' })), answer: options.indexOf(correct), note, word, tokens, rows: [...new Set(tokens.map(t => t.c))] };
}
export function spellDeck(random, n) {
  const pool = shuffle(WORDS.filter(spellable), random);
  return pool.slice(0, n).map(w => spellCard(w, random));
}
export function syllabicsDeck(random, n, spellings = 2) {
  const used = new Set(), deck = [];
  while (deck.length < n - spellings) { const card = syllabicsCard(random, used); if (!card) break; deck.push(card); }
  return [...deck, ...spellDeck(random, spellings)];
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
  const p = BY_C.p;
  const syllabics = [0, 2, 4, 1].map(vi => {
    const options = shuffle([0, 2, 4, 1], random);
    return { kind: 'sound', prompt: romanOf(p, vi), promptSub: 'Find the glyph from the example',
      options: options.map(k => ({ label: p.glyphs[k], sub: romanOf(p, k) })), answer: options.indexOf(vi),
      glyph: p.glyphs[vi], roman: romanOf(p, vi), row: 'p', vi,
      note: `${p.glyphs[vi]} writes ${romanOf(p, vi)}. The same p shape turns for i, u and a: ᐱ pi, ᐳ pu, ᐸ pa. A dot makes the vowel long: ᐲ pii.` };
  });
  syllabics.push({ kind: 'glyph', prompt: 'ᑦ', promptSub: 'Match this small final to its sound',
    options: [{ label: 't' }, { label: 'ta' }], answer: 0, glyph: 'ᑦ', roman: 't', row: 't', vi: -1,
    note: 'ᑦ is final t, with no vowel. Compare ᑕ ta, a full syllable. Aput ends with ᑦ: ᐊ a + ᐳ pu + ᑦ t.' });
  syllabics.push(spellCard(WORDS.find(w => w.w === 'aput'), random));
  const vocabulary = ['aput', 'siku', 'nanuq', 'umiaq'].map(w => WORDS.find(word => word.w === w));
  const words = vocabulary.map(word => {
    const items = shuffle(vocabulary, random);
    return { kind: 'word', prompt: word.s, promptSub: word.w,
      options: items.map(w => ({ label: w.en })), answer: items.indexOf(word), word, note: word.note };
  });
  const decks = [syllabics, words, chartDeck(random, LEGS[2].cards, near?.place)];
  return {
    seed, near, decks, leg: -1, queue: [], card: null, phase: 'intro',
    score: 0, streak: 0, bestStreak: 0, correct: 0, firstTry: 0, asked: 0, hints: 0,
    legStats: LEGS.map(() => ({ correct: 0, asked: 0, points: 0 })), learned: [], last: null,
  };
}
// Help and repeated attempts carry the full completion value.
export function worth(state) { return LEGS[state.leg].points; }
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
    if (!card.attempts) state.firstTry++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);

    state.score += points + bonus; stats.points += points + bonus;
    const learned = card.word ? { s: card.word.s, w: card.word.w, en: card.word.en }
      : card.place ? { s: card.place.s || card.place.name, w: card.place.name, en: card.place.en }
      : card.build ? { s: toSyllabics(card.build.result), w: card.build.result, en: card.build.en } : null;
    if (learned && !state.learned.some(l => l.w === learned.w)) state.learned.push(learned);
  } else {
    card.attempts = (card.attempts || 0) + 1;
  }
  state.last = { ok, points, bonus, choice, retry: card.retry, remaining: state.queue.length };
  state.phase = ok ? 'feedback' : 'ask';
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
