// The internal logic of qaniujaaqpait, the syllabics Nunavut writes Inuktitut in, as a walkthrough the game shows
// on request: one page per rule, each demonstrated with the glyphs themselves. Two pages are interactive: the
// turner (one shape in every attitude) and the workbench (Roman letters written out glyph by glyph).
import { SERIES, VOWELS, SOUNDS } from './crew-22-lexicon.js';

const esc = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const BY_C = Object.fromEntries(SERIES.map(row => [row.c, row]));
// Rows a learner meets on the chart; the rare ł row and nng appear on the marks page only.
export const TURNER_ROWS = SERIES.filter(row => !['nng', 'ł'].includes(row.c));

// A glyph broken into its parts, for the workbench and the turner. `token` comes from the model's syllables().
export function describe(token) {
  if (token.space) return '';
  if (token.raw) return `${token.raw}: not an Inuktitut sound, so no glyph. The vowels are i, u and a; there is no b, c, d, e, f, h, o, w, x, y or z (y is written j, w is v).`;
  const shape = token.c ? `the ${token.c} shape (${SOUNDS[token.c]})` : 'the bare-vowel shape';
  if (token.final) return `${token.glyph}: a small raised ${token.c}, a consonant with no vowel after it.`;
  return `${token.glyph}: ${shape} turned for ${token.v}${token.long ? ', with the dot for a long vowel' : ''}: ${token.roman}.`;
}
// Text for the turner's current setting.
export function turnerText(c, vi, final) {
  const row = BY_C[c];
  if (final) return c ? `${row.final} is a bare ${c}: ${row.glyphs[4]} ${c}a shrunk and raised, with no vowel. It closes a syllable: ${c === 'q' ? 'ᓇᓄᖅ nanuq' : c === 'k' ? 'ᐃᓄᒃ inuk' : c === 't' ? 'ᐊᐳᑦ aput' : c === 'ng' ? 'ᐅᒥᖕᒪᒃ umingmak' : `ᐊ${row.final}ᐸ a${c}pa`}.` : 'A vowel cannot be a final: a syllable with no vowel has no vowel to drop.';
  const v = VOWELS[vi];
  return `${row.glyphs[vi]} is ${c + v}: ${c ? `the ${c} shape (${SOUNDS[c]})` : 'the bare-vowel shape'} turned for ${v[0]}${v.length === 2 ? ', with the dot that makes it long' : ''}.`;
}

const glyphRow = (items, cls = '') => `<div class="ik-glyphrow ${cls}">${items.map(([g, label, title]) => `<span${title ? ` title="${esc(title)}"` : ''}><b class="ik-syl">${g}</b><small>${esc(label)}</small></span>`).join('')}</div>`;
const word = (glyphs, roman, gloss) => `<span class="ik-word"><b class="ik-syl">${glyphs}</b> ${esc(roman)}<small>${esc(gloss)}</small></span>`;

export const PAGES = [
  {
    id: 'syllable', title: 'One glyph is one syllable', inuk: 'ᖃᓂᐅᔮᖅᐸᐃᑦ',
    lead: 'Qaniujaaqpait is a syllabary, or strictly an abugida: every character is a consonant and the vowel after it, sounded together. Inuktitut syllables are (C)V(C) with three vowels, i, u and a, each short or long, and about fifteen consonants, so a small chart covers the whole language.',
    html: glyphRow([['ᐃ', 'i'], ['ᓄ', 'nu'], ['ᒃ', 'k'], ['ᑎ', 'ti'], ['ᑐ', 'tu'], ['ᑦ', 't']], 'ik-glyphrow-word') + '<p class="ik-caption">ᐃᓄᒃᑎᑐᑦ Inuktitut: six glyphs for nine Roman letters.</p>',
    body: ['An alphabet spells each sound on its own. Syllabics packs a consonant and its vowel into one shape, and writes the consonants that close a syllable as small raised marks. Reading runs left to right, one syllable a glyph, so a word has as many full glyphs as it has vowels.'],
  },
  {
    id: 'shape', title: 'The shape is the consonant',
    lead: 'Each consonant has one shape, and the shape never changes with the vowel. Learn the a-column and you know every shape on the chart; the rest of the chart is those shapes turned.',
    html: glyphRow(TURNER_ROWS.map(row => [row.glyphs[4], row.c ? row.c + 'a' : 'a', SOUNDS[row.c]])) + '<p class="ik-caption">The a-column: one shape for a bare vowel, one for each consonant. Hover for the sound.</p>',
    body: ['Fifteen shapes carry the language because Inuktitut has few consonants and nothing like English clusters such as "str". The two sounds English lacks, q and ng, get their own shapes; the pairs English keeps apart, b and p, d and t, g and k, are not distinguished in Inuktitut and share a glyph.'],
  },
  {
    id: 'turn', title: 'The turn is the vowel', demo: 'turner',
    lead: 'The vowel is written by turning the consonant\'s shape. ᐱ pi, ᐳ pu, ᐸ pa: one shape in three attitudes. Every row turns the same way, so once you can read the p row you can read them all.',
    body: ['The Cree chart this grew from has a fourth attitude for a fourth vowel, ᐯ pai. Nunavut\'s 1976 standard writes ai as two glyphs, ᐸᐃ, while Nunavik keeps the ᐯ column; a chart with four columns is from Quebec or from before 1976.'],
    keys: 'W/S or ↑↓ consonant · A/D vowel · Space long · F final · ←→ pages',
  },
  {
    id: 'dot', title: 'The dot is length',
    lead: 'A dot above the glyph makes the vowel long: ᐱ pi, ᐲ pii. Length is a phoneme, not decoration. ᐄ ii is yes; ᐋᒃᑲ aakka is no, with a long first vowel.',
    html: glyphRow([['ᐃ', 'i'], ['ᐄ', 'ii'], ['ᐅ', 'u'], ['ᐆ', 'uu'], ['ᐊ', 'a'], ['ᐋ', 'aa'], ['ᑐ', 'tu'], ['ᑑ', 'tuu'], ['ᓇ', 'na'], ['ᓈ', 'naa']]) + `<p class="ik-caption">${word('ᓯᑯ', 'siku', 'sea ice')} ${word('ᓯᓈᖅ', 'sinaaq', 'floe edge')} ${word('ᓇᑦᑎᖅ', 'nattiq', 'ringed seal')}</p>`,
    body: ['In Roman letters the long vowel is doubled: siku but sinaaq. A long consonant is doubled too, and in syllabics that takes a final in front of the full glyph: ᓇᑦᑎᖅ nattiq is na, a small t, ti, a small q. Both lengths change meaning, which is why the dot and the small glyphs matter as much as the shapes.'],
  },
  {
    id: 'final', title: 'The small glyph is a bare consonant',
    lead: 'A consonant with no vowel after it, at the end of a word or in front of another consonant, is written as its final: the a-form shrunk and raised. ᐸ pa, ᑉ p; ᑕ ta, ᑦ t; ᑲ ka, ᒃ k.',
    html: glyphRow(TURNER_ROWS.filter(row => row.c).map(row => [`${row.glyphs[4]}${row.final}`, `${row.c}a · ${row.c}`])) + `<p class="ik-caption">${word('ᑐᒃᑐ', 'tuktu', 'caribou')} ${word('ᐃᓄᒃᓱᒃ', 'inuksuk', 'stone marker')} ${word('ᐃᓄᒃ', 'inuk', 'a person')} ${word('ᐃᓄᐃᑦ', 'inuit', 'people')}</p>`,
    body: ['Because every full glyph carries a vowel, a consonant cluster is always a final followed by a full syllable: ᑐᒃᑐ tu-k-tu. A word can end on a final too, and the grammar lives there: ᐃᓄᒃ inuk is one person, ᐃᓅᒃ inuuk two, ᐃᓄᐃᑦ inuit three or more.'],
  },
  {
    id: 'marks', title: 'Marks make new rows',
    lead: 'Inuktitut has sounds Cree does not, and the chart grew by marking existing shapes rather than inventing new ones. q is the r shape with a dot. ng is a small n fused to the g shape. The rare ł, a breathy l, is the l shape with a stroke.',
    html: '<div class="ik-glyphgroup">' + ['r', 'q', 'g', 'ng', 'nng', 'l', 'ł'].map(c => glyphRow([[BY_C[c].glyphs[0], c + 'i'], [BY_C[c].glyphs[2], c + 'u'], [BY_C[c].glyphs[4], c + 'a'], [BY_C[c].final, c]], 'ik-glyphrow-tight')).join('') + '</div><p class="ik-caption">r and q; g, ng and the doubled nng; l and ł.</p>',
    body: ['Two dots can sit on one glyph and mean different things: the q dot is part of the shape, the length dot sits above it. ᖃ qa, ᖄ qaa. In ᐅᒥᖕᒪᒃ umingmak, muskox, the ᖕ is a final ng before the m: a small n and a small g together.'],
  },
  {
    id: 'origin', title: 'Where the chart came from',
    lead: 'James Evans, a Methodist missionary at Norway House, cut the first syllabics for Cree in 1840, taking the turned shape from Pitman-style shorthand and the consonant-plus-vowel principle from Devanagari. Anglican missionaries carried it to Inuktitut at Little Whale River in 1855, and Edmund Peck took it up the Hudson Bay and Baffin coasts from 1876.',
    html: `<p class="ik-caption">${word('ᓄᓇᕗᑦ', 'Nunavut', 'our land, 1999')} ${word('ᓄᓇᕕᒃ', 'Nunavik', 'four-column chart')} ${word('ᖃᓂᐅᔮᖅᐸᐃᑦ', 'qaniujaaqpait', 'syllabics')} ${word('ᖃᓕᐅᔮᖅᐸᐃᑦ', 'qaliujaaqpait', 'Roman letters')}</p>`,
    body: ['It spread from camp to camp faster than any school, because a reader could teach it in an afternoon: fifteen shapes, three turns, a dot and a small form. The Inuit Cultural Institute standardised the chart in 1976, dropping the ai column and fixing the dual orthography, syllabics and Roman, that Nunavut still uses. The block has been in Unicode as Unified Canadian Aboriginal Syllabics since 1999, which is why the names on the game\'s chart are text rather than pictures.'],
    small: 'West of the Kitikmeot, Inuinnaqtun and Inuvialuktun are written in Roman letters only, as is Greenlandic. Inuit Tapiriit Kanatami adopted a single Roman orthography, Inuktut Qaliujaaqpait, in 2019 for use across Inuit Nunangat alongside syllabics.',
  },
  {
    id: 'workbench', title: 'Try it', demo: 'workbench',
    lead: 'Type a word in Roman letters and watch the rules write it: a shape for each consonant, a turn for each vowel, a dot for a doubled vowel, a small glyph for a consonant with nothing after it.',
    body: [],
    keys: 'type in the box · Tab to the buttons',
  },
];
