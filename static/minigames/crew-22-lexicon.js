// Inuktitut content for the language minigame: the syllabary, a working vocabulary for a ship in the
// Canadian Arctic, place names from the charts with their meanings, and the suffixes that build them.
// Spellings follow the Inuit Cultural Institute standard orthography used in Nunavut; Inuvialuktun to the
// west and Nunavik forms differ, and the notes say so where a name comes from those regions.

// Syllabary series: one row per consonant, columns i, ii, u, uu, a, aa and the small final consonant.
// Within a row the vowel is the orientation of one shape; a dot above marks the long vowel.
export const VOWELS = ['i', 'ii', 'u', 'uu', 'a', 'aa'];
export const SERIES = [
  { c: '', glyphs: ['ᐃ', 'ᐄ', 'ᐅ', 'ᐆ', 'ᐊ', 'ᐋ'], final: '' },
  { c: 'p', glyphs: ['ᐱ', 'ᐲ', 'ᐳ', 'ᐴ', 'ᐸ', 'ᐹ'], final: 'ᑉ' },
  { c: 't', glyphs: ['ᑎ', 'ᑏ', 'ᑐ', 'ᑑ', 'ᑕ', 'ᑖ'], final: 'ᑦ' },
  { c: 'k', glyphs: ['ᑭ', 'ᑮ', 'ᑯ', 'ᑰ', 'ᑲ', 'ᑳ'], final: 'ᒃ' },
  { c: 'g', glyphs: ['ᒋ', 'ᒌ', 'ᒍ', 'ᒎ', 'ᒐ', 'ᒑ'], final: 'ᒡ' },
  { c: 'm', glyphs: ['ᒥ', 'ᒦ', 'ᒧ', 'ᒨ', 'ᒪ', 'ᒫ'], final: 'ᒻ' },
  { c: 'n', glyphs: ['ᓂ', 'ᓃ', 'ᓄ', 'ᓅ', 'ᓇ', 'ᓈ'], final: 'ᓐ' },
  { c: 's', glyphs: ['ᓯ', 'ᓰ', 'ᓱ', 'ᓲ', 'ᓴ', 'ᓵ'], final: 'ᔅ' },
  { c: 'l', glyphs: ['ᓕ', 'ᓖ', 'ᓗ', 'ᓘ', 'ᓚ', 'ᓛ'], final: 'ᓪ' },
  { c: 'j', glyphs: ['ᔨ', 'ᔩ', 'ᔪ', 'ᔫ', 'ᔭ', 'ᔮ'], final: 'ᔾ' },
  { c: 'v', glyphs: ['ᕕ', 'ᕖ', 'ᕗ', 'ᕘ', 'ᕙ', 'ᕚ'], final: 'ᕝ' },
  { c: 'r', glyphs: ['ᕆ', 'ᕇ', 'ᕈ', 'ᕉ', 'ᕋ', 'ᕌ'], final: 'ᕐ' },
  { c: 'q', glyphs: ['ᕿ', 'ᖀ', 'ᖁ', 'ᖂ', 'ᖃ', 'ᖄ'], final: 'ᖅ' },
  { c: 'ng', glyphs: ['ᖏ', 'ᖐ', 'ᖑ', 'ᖒ', 'ᖓ', 'ᖔ'], final: 'ᖕ' },
  { c: 'nng', glyphs: ['ᙱ', 'ᙲ', 'ᙳ', 'ᙴ', 'ᙵ', 'ᙶ'], final: 'ᖖ' },
  { c: 'ł', glyphs: ['ᖠ', 'ᖡ', 'ᖢ', 'ᖣ', 'ᖤ', 'ᖥ'], final: 'ᖦ' },
];
// How each consonant sounds, for the syllabics leg's feedback line.
export const SOUNDS = {
  '': 'a bare vowel', p: 'p as in "pack"', t: 't as in "tusk"', k: 'k, at the front of the mouth', g: 'a soft g, like the Spanish "agua"',
  m: 'm', n: 'n', s: 's', l: 'l', j: 'y as in "yes"', v: 'v, between v and w', r: 'a French-style r, in the throat',
  q: 'q: a k made far back, against the uvula', ng: 'ng as in "singer"', nng: 'a long, held ng', ł: 'a breathy l, like Welsh "ll"',
};

// Vocabulary. Each entry: romanized word, syllabics, English gloss, domain, and a note that says something true
// about the word or the thing it names. Domains keep quiz distractors plausible.
export const WORDS = [
  // ice and sea
  { w: 'siku', s: 'ᓯᑯ', en: 'sea ice', d: 'ice', note: 'Siku is the general word for sea ice. The Nunavut ice glossary runs to dozens of finer terms; the ice chart’s "tenths" flatten most of them.' },
  { w: 'sikuaq', s: 'ᓯᑯᐊᖅ', en: 'thin new ice', d: 'ice', note: 'Siku plus -aq: young ice a few centimetres thick, still dark, that bends under the ship’s bow wave rather than breaking.' },
  { w: 'tuvaq', s: 'ᑐᕙᖅ', en: 'landfast ice', d: 'ice', note: 'Ice frozen to the shore and held still. Travel routes and seal hunting follow the tuvaq; the ship cannot follow it far.' },
  { w: 'sinaaq', s: 'ᓯᓈᖅ', en: 'floe edge', d: 'ice', note: 'The edge where landfast ice meets open water. Seals, birds and hunters gather there; so do polar bears.' },
  { w: 'aukkarniq', s: 'ᐊᐅᒃᑲᕐᓂᖅ', en: 'polynya', d: 'ice', note: 'Open water that stays open in winter, kept clear by currents or wind. The oceanographer’s "polynya" is a Russian loan; this is the local name.' },
  { w: 'qinu', s: 'ᕿᓄ', en: 'slush ice', d: 'ice', note: 'Ice crystals thick in the water before they knit into a sheet. Brash and slush foul intakes and slow a CTD wire.' },
  { w: 'ivuniq', s: 'ᐃᕗᓂᖅ', en: 'pressure ridge', d: 'ice', note: 'Ice piled up where floes collide. The verb ivu-, to pile up, names the community of Ivujivik, where currents heap the ice.' },
  { w: 'imaq', s: 'ᐃᒪᖅ', en: 'sea, open water', d: 'sea', note: 'Imaq is the sea as a body of water; imiq, one vowel different, is fresh water to drink.' },
  { w: 'tariuq', s: 'ᑕᕆᐅᖅ', en: 'salt water, the ocean', d: 'sea', note: 'The root tariuq is salt; the same word names the ocean and the salinity your CTD measures.' },
  { w: 'imiq', s: 'ᐃᒥᖅ', en: 'fresh water', d: 'sea', note: 'Drinking water. Meltwater pools on old floes are imiq; the sea beneath them is imaq.' },
  { w: 'kuuk', s: 'ᑰᒃ', en: 'river', d: 'land', note: 'Kuuk plus -juaq, big, gives Kuujjuaq, the great river of Ungava Bay.' },
  { w: 'tasiq', s: 'ᑕᓯᖅ', en: 'lake', d: 'land', note: 'Tasiujaq, a Nunavik community, means "resembles a lake": a bay so enclosed it might be one.' },
  { w: 'qikiqtaq', s: 'ᕿᑭᖅᑕᖅ', en: 'island', d: 'land', note: 'Qikiqtaaluk, the big island, is Baffin Island. Qikiqtarjuaq, another big island, is a community off its east coast.' },
  { w: 'nuna', s: 'ᓄᓇ', en: 'land', d: 'land', note: 'Nuna plus -vut, our, gives Nunavut. Nunavik and Nunatsiavut carry the same root across Quebec and Labrador.' },
  { w: 'nuvuk', s: 'ᓄᕗᒃ', en: 'point of land', d: 'land', note: 'A headland. Charts across the Arctic carry the name Nuvuk where a point juts into the current.' },
  { w: 'kangiq', s: 'ᑲᖏᖅ', en: 'bay, inlet', d: 'land', note: 'Kangiqsujuaq, Kangirsuk, Kangiqliniq (Rankin Inlet): the same root in bays from Ungava to Hudson Bay.' },
  // weather and sky
  { w: 'sila', s: 'ᓯᓚ', en: 'weather, the outside', d: 'sky', note: 'Sila is weather, air and the world outside at once; in older thought it is the breath and intelligence of the world.' },
  { w: 'anuri', s: 'ᐊᓄᕆ', en: 'wind', d: 'sky', note: 'Wind direction names differ by community, because they describe where a wind comes from across local land.' },
  { w: 'piqsiq', s: 'ᐱᖅᓯᖅ', en: 'blizzard', d: 'sky', note: 'Drifting snow driven by wind. A piqsiq erases the horizon; the bridge relies on radar and the ice pilot waits.' },
  { w: 'aput', s: 'ᐊᐳᑦ', en: 'snow on the ground', d: 'sky', note: 'Aput is snow lying on the ground; qanik is snow falling. Snow depth on a floe controls how fast the ice below it grows.' },
  { w: 'qanik', s: 'ᖃᓂᒃ', en: 'falling snow', d: 'sky', note: 'Falling snowflakes. Once settled the snow is aput; wind-packed it is another word again.' },
  { w: 'siqiniq', s: 'ᓯᕿᓂᖅ', en: 'sun', d: 'sky', note: 'Qausuittuq, Resolute, means "the place with no dawn": the sun stays down there for about three months.' },
  { w: 'taqqiq', s: 'ᑕᖅᕿᖅ', en: 'moon', d: 'sky', note: 'Taqqiq is also the month. The traditional calendar follows the moon and the animals’ seasons together.' },
  { w: 'ulluriaq', s: 'ᐅᓪᓗᕆᐊᖅ', en: 'star', d: 'sky', note: 'Stars gave direction in the dark months; the snow ridges left by the prevailing wind gave it by day.' },
  { w: 'aqsarniit', s: 'ᐊᖅᓴᕐᓃᑦ', en: 'northern lights', d: 'sky', note: 'The aurora, plural. Under the auroral oval the display is more often overhead than to the north.' },
  { w: 'ukiuq', s: 'ᐅᑭᐅᖅ', en: 'winter, year', d: 'sky', note: 'Winter and year share one word; a life is counted in winters.' },
  { w: 'aujaq', s: 'ᐊᐅᔭᖅ', en: 'summer', d: 'sky', note: 'The open-water season, when the ship can reach the coast. The root au- is melting.' },
  // animals
  { w: 'nanuq', s: 'ᓇᓄᖅ', en: 'polar bear', d: 'animal', note: 'Nanuq hunts ringed seals at the floe edge and at breathing holes; ice stations post a bear watch for the same reason.' },
  { w: 'nattiq', s: 'ᓇᑦᑎᖅ', en: 'ringed seal', d: 'animal', note: 'The most common Arctic seal. It keeps breathing holes open through the ice all winter with its claws.' },
  { w: 'ugjuk', s: 'ᐅᒡᔪᒃ', en: 'bearded seal', d: 'animal', note: 'A large seal that feeds on the bottom; its skin makes boot soles and boat covers.' },
  { w: 'aiviq', s: 'ᐊᐃᕕᖅ', en: 'walrus', d: 'animal', note: 'Walrus haul out on ice over shallow clam beds; they rarely feed deeper than 80 m.' },
  { w: 'arviq', s: 'ᐊᕐᕕᖅ', en: 'bowhead whale', d: 'animal', note: 'Arviat, on Hudson Bay, is the place of bowheads. Bowheads live longer than any other mammal, past 200 years.' },
  { w: 'qilalugaq', s: 'ᕿᓚᓗᒐᖅ', en: 'beluga', d: 'animal', note: 'The white whale of the estuaries. In some dialects the same word, qualified, covers the narwhal.' },
  { w: 'tuugaalik', s: 'ᑑᒑᓕᒃ', en: 'narwhal', d: 'animal', note: 'Literally "the one with a tusk": tuugaaq, tusk, plus -lik, having.' },
  { w: 'tuktu', s: 'ᑐᒃᑐ', en: 'caribou', d: 'animal', note: 'Tuktoyaktuk, in Inuvialuktun, means "it looks like a caribou": the reef there resembles one.' },
  { w: 'umingmak', s: 'ᐅᒥᖕᒪᒃ', en: 'muskox', d: 'animal', note: '"The bearded one." Its underwool, qiviut, is warmer than sheep’s wool by weight.' },
  { w: 'amaruq', s: 'ᐊᒪᕈᖅ', en: 'wolf', d: 'animal', note: 'Arctic wolves follow the caribou herds; the Tuktu and Amaruq of stories hold the tundra in balance.' },
  { w: 'tiriganniaq', s: 'ᑎᕆᒐᓐᓂᐊᖅ', en: 'Arctic fox', d: 'animal', note: 'Foxes range far onto the sea ice in winter, trailing polar bears for leftovers.' },
  { w: 'ukaliq', s: 'ᐅᑲᓕᖅ', en: 'Arctic hare', d: 'animal', note: 'Hares stay white all year in the High Arctic and turn grey-brown in summer further south.' },
  { w: 'qimmiq', s: 'ᕿᒻᒥᖅ', en: 'dog', d: 'animal', note: 'The Canadian Inuit dog pulls the qamutiik; a team is a qimuksiq.' },
  { w: 'iqaluk', s: 'ᐃᖃᓗᒃ', en: 'fish, Arctic char', d: 'animal', note: 'Iqaluit means "many fish": char run up the Sylvia Grinnell River there each summer.' },
  { w: 'mitiq', s: 'ᒥᑎᖅ', en: 'eider duck', d: 'animal', note: 'Eiders winter in polynyas and at the floe edge, diving for mussels and urchins.' },
  { w: 'naujaq', s: 'ᓇᐅᔭᖅ', en: 'gull', d: 'animal', note: 'Naujaat, "gull nesting place", is the community at Repulse Bay on the Arctic Circle.' },
  // people, gear, travel
  { w: 'inuk', s: 'ᐃᓄᒃ', en: 'a person', d: 'people', note: 'Inuk is one person; Inuuk two; Inuit three or more. Inuktitut means "in the manner of an Inuk".' },
  { w: 'umiaq', s: 'ᐅᒥᐊᖅ', en: 'boat', d: 'gear', note: 'The open skin boat; umiarjuaq, big boat, is any ship, including this one.' },
  { w: 'umiarjuaq', s: 'ᐅᒥᐊᕐᔪᐊᖅ', en: 'ship', d: 'gear', note: 'Umiaq plus -rjuaq, big. The icebreaker is an umiarjuaq to everyone watching from shore.' },
  { w: 'qajaq', s: 'ᖃᔭᖅ', en: 'kayak', d: 'gear', note: 'The word entered English through Greenland and Denmark; the design is the Inuit hunter’s.' },
  { w: 'qamutiik', s: 'ᖃᒧᑏᒃ', en: 'sled', d: 'gear', note: 'The long runner sled, lashed rather than nailed so it flexes over rough ice. The word is dual: two runners.' },
  { w: 'iglu', s: 'ᐃᒡᓗ', en: 'house', d: 'gear', note: 'Any house, snow or otherwise. Iglulik is "the place with houses"; sod-and-whalebone houses stood there for a thousand years.' },
  { w: 'inuksuk', s: 'ᐃᓄᒃᓱᒃ', en: 'stone marker', d: 'gear', note: '"Something that acts as a person": stone cairns that mark routes, caches and caribou drives. Plural inuksuit.' },
  { w: 'ulu', s: 'ᐅᓗ', en: 'woman’s knife', d: 'gear', note: 'The crescent knife. Ulukhaktok, in the west, is the place where ulu blade stone is found.' },
  { w: 'kamik', s: 'ᑲᒥᒃ', en: 'boot', d: 'gear', note: 'Skin boots; sealskin for wet ice, caribou for dry cold. Plural kamiik, a pair.' },
  { w: 'amauti', s: 'ᐊᒪᐅᑎ', en: 'mother’s parka', d: 'gear', note: 'A parka with a pouch at the back for carrying a baby against the skin.' },
  { w: 'uqsuq', s: 'ᐅᖅᓱᖅ', en: 'blubber, oil', d: 'gear', note: 'Seal fat, and the lamp oil rendered from it. Uqsuqtuuq, Gjoa Haven, is "the place of much blubber".' },
  // phrases
  { w: 'ai', s: 'ᐊᐃ', en: 'hello', d: 'phrase', note: 'A short greeting. Tunngasugit, "welcome", is the formal one you hear at the airport.' },
  { w: 'tunngasugit', s: 'ᑐᙵᓱᒋᑦ', en: 'welcome', d: 'phrase', note: 'Said to one person; tunngasugitsi to several. The root is "feel at home".' },
  { w: 'qujannamiik', s: 'ᖁᔭᓐᓇᒦᒃ', en: 'thank you', d: 'phrase', note: 'The South Baffin form; nakurmiik in Nunavik, quana in Inuinnaqtun, koana in the west.' },
  { w: 'ii', s: 'ᐄ', en: 'yes', d: 'phrase', note: 'A long vowel. Raised eyebrows mean the same thing; a wrinkled nose means no.' },
  { w: 'aakka', s: 'ᐋᒃᑲ', en: 'no', d: 'phrase', note: 'A long first vowel and a held k. Both length contrasts change meaning in Inuktitut.' },
  { w: 'qanuippit', s: 'ᖃᓄᐃᑉᐱᑦ', en: 'how are you?', d: 'phrase', note: 'The answer is qanuinngittunga, "I am fine", literally "I am not in any way".' },
  { w: 'ullaakkut', s: 'ᐅᓪᓛᒃᑯᑦ', en: 'good morning', d: 'phrase', note: 'From ullaaq, morning. Unnusakkut is good afternoon; unnukkut good evening.' },
  { w: 'tavvauvutit', s: 'ᑕᕝᕙᐅᕗᑎᑦ', en: 'goodbye', d: 'phrase', note: 'Said to one person leaving; tavvauvusi to several.' },
  { w: 'atii', s: 'ᐊᑏ', en: 'let’s go', d: 'phrase', note: 'Come on, go ahead. Heard when the helicopter is turning and the science party is still zipping suits.' },
  { w: 'nami', s: 'ᓇᒥ', en: 'where?', d: 'phrase', note: 'Question words come first. Nami umiarjuaq: where is the ship?' },
  { w: 'atausiq', s: 'ᐊᑕᐅᓯᖅ', en: 'one', d: 'number', note: 'Counting in Inuktitut is base 20 on fingers and toes: tallimat, five, is one hand.' },
  { w: 'marruuk', s: 'ᒪᕐᕉᒃ', en: 'two', d: 'number', note: 'Dual endings: marruuk itself is dual, and nouns for two things end in -k.' },
  { w: 'pingasut', s: 'ᐱᖓᓱᑦ', en: 'three', d: 'number', note: 'From three upward the noun takes the plural -t.' },
  { w: 'sitamat', s: 'ᓯᑕᒪᑦ', en: 'four', d: 'number', note: 'Four days of station work is sitamat ullut.' },
  { w: 'tallimat', s: 'ᑕᓪᓕᒪᑦ', en: 'five', d: 'number', note: 'One hand. Ten is qulit; twenty, avatit, is a whole person of digits.' },
];

// Suffixes that build words and place names. `gloss` is the meaning; `note` how it attaches.
export const SUFFIXES = [
  { m: '-juaq', gloss: 'big, great', note: 'Often -rjuaq after a vowel: umiaq, boat, gives umiarjuaq, ship.' },
  { m: '-aluk', gloss: 'huge', note: 'Qikiqtaaluk, Baffin Island, is the huge island.' },
  { m: '-lik', gloss: 'having, with', note: 'Iglulik is the place with houses; tuugaalik, the one with a tusk, is the narwhal.' },
  { m: '-vik', gloss: 'place or time of', note: 'Ivujivik: the place where the ice piles up.' },
  { m: '-ujaq', gloss: 'resembling', note: 'Tasiujaq looks like a lake; Umiujaq looks like a boat.' },
  { m: '-it', gloss: 'plural, many', note: 'Iqaluit: many fish. Inuit: many people.' },
  { m: '-miut', gloss: 'people of', note: 'Iqalummiut are the people of Iqaluit.' },
  { m: '-vut', gloss: 'our', note: 'Nunavut: our land.' },
  { m: '-tuuq', gloss: 'having much', note: 'Uqsuqtuuq has much blubber; Panniqtuuq many bull caribou.' },
  { m: '-kuluk', gloss: 'little, dear', note: 'An affectionate diminutive: nunakuluk, dear little land.' },
  { m: '-ksaq', gloss: 'material for', note: 'Uluksaq is stone for an ulu; Uluksaqtuuq the place with much of it.' },
];

// Word-building rounds: meaning, the root and suffix that make it, and the surface form as written.
export const BUILDS = [
  { en: 'ship (big boat)', root: 'umiaq', suffix: '-juaq', result: 'umiarjuaq' },
  { en: 'big island', root: 'qikiqtaq', suffix: '-juaq', result: 'qikiqtarjuaq' },
  { en: 'great river', root: 'kuuk', suffix: '-juaq', result: 'kuujjuaq' },
  { en: 'a giant (big person)', root: 'inuk', suffix: '-juaq', result: 'inukjuaq' },
  { en: 'place with houses', root: 'iglu', suffix: '-lik', result: 'iglulik' },
  { en: 'the one with a tusk (narwhal)', root: 'tuugaaq', suffix: '-lik', result: 'tuugaalik' },
  { en: 'resembles a lake', root: 'tasiq', suffix: '-ujaq', result: 'tasiujaq' },
  { en: 'resembles a boat', root: 'umiaq', suffix: '-ujaq', result: 'umiujaq' },
  { en: 'many fish', root: 'iqaluk', suffix: '-it', result: 'iqaluit' },
  { en: 'people (many persons)', root: 'inuk', suffix: '-it', result: 'inuit' },
  { en: 'our land', root: 'nuna', suffix: '-vut', result: 'nunavut' },
  { en: 'people of Iqaluit', root: 'iqaluit', suffix: '-miut', result: 'iqalummiut' },
  { en: 'place of much blubber', root: 'uqsuq', suffix: '-tuuq', result: 'uqsuqtuuq' },
  { en: 'huge island (Baffin)', root: 'qikiqtaq', suffix: '-aluk', result: 'qikiqtaaluk' },
  { en: 'stone for an ulu', root: 'ulu', suffix: '-ksaq', result: 'uluksaq' },
  { en: 'many gulls', root: 'naujaq', suffix: '-it', result: 'naujaat' },
];
export const ROOTS = ['umiaq', 'qikiqtaq', 'kuuk', 'inuk', 'iglu', 'tuugaaq', 'tasiq', 'iqaluk', 'nuna', 'uqsuq', 'ulu', 'naujaq', 'siku', 'nanuq', 'tuktu', 'kangiq'];

// Communities and named waters, with the meaning of the name. Entries without `s` come from Inuinnaqtun and
// Inuvialuktun, which are written in Roman letters, so the name itself is shown. Coordinates are gazetteer positions to about
// a tenth of a degree, used only to name the nearest community to the ship. `region` says which
// orthography the name comes from.
export const PLACES = [
  { name: 'Iqaluit', s: 'ᐃᖃᓗᐃᑦ', en: 'place of many fish', parts: 'iqaluk fish + -it many', lat: 63.75, lon: -68.52, region: 'Nunavut', english: 'Iqaluit' },
  { name: 'Mittimatalik', s: 'ᒥᑦᑎᒪᑕᓕᒃ', en: 'the place where Mittima is buried', parts: 'Mittima, a name + -talik having', lat: 72.70, lon: -77.96, region: 'Nunavut', english: 'Pond Inlet' },
  { name: 'Qausuittuq', s: 'ᖃᐅᓱᐃᑦᑐᖅ', en: 'the place with no dawn', parts: 'qau- dawn + -suit- lacking + -tuq it is', lat: 74.70, lon: -94.83, region: 'Nunavut', english: 'Resolute' },
  { name: 'Ausuittuq', s: 'ᐊᐅᓱᐃᑦᑐᖅ', en: 'the place that never thaws', parts: 'au- melt + -suit- never + -tuq it is', lat: 76.42, lon: -82.90, region: 'Nunavut', english: 'Grise Fiord' },
  { name: 'Ikpiarjuk', s: 'ᐃᒃᐱᐊᕐᔪᒃ', en: 'the pocket', parts: 'ikpiaq pocket + -rjuk little', lat: 73.04, lon: -85.15, region: 'Nunavut', english: 'Arctic Bay' },
  { name: 'Kangiqtugaapik', s: 'ᑲᖏᖅᑐᒑᐱᒃ', en: 'nice little inlet', parts: 'kangiq inlet + -tugaapik nice little', lat: 70.47, lon: -68.59, region: 'Nunavut', english: 'Clyde River' },
  { name: 'Qikiqtarjuaq', s: 'ᕿᑭᖅᑕᕐᔪᐊᖅ', en: 'big island', parts: 'qikiqtaq island + -rjuaq big', lat: 67.56, lon: -64.03, region: 'Nunavut', english: 'Qikiqtarjuaq' },
  { name: 'Pangniqtuuq', s: 'ᐸᖕᓂᖅᑑᖅ', en: 'place of many bull caribou', parts: 'pangniq bull caribou + -tuuq having much', lat: 66.15, lon: -65.71, region: 'Nunavut', english: 'Pangnirtung' },
  { name: 'Kinngait', s: 'ᑭᙵᐃᑦ', en: 'mountains', parts: 'kinngaq mountain + -it many', lat: 64.23, lon: -76.54, region: 'Nunavut', english: 'Cape Dorset' },
  { name: 'Kimmirut', s: 'ᑭᒻᒥᕈᑦ', en: 'the heel', parts: 'kimmik heel + -rut', lat: 62.85, lon: -69.87, region: 'Nunavut', english: 'Kimmirut' },
  { name: 'Iglulik', s: 'ᐃᒡᓗᓕᒃ', en: 'place with houses', parts: 'iglu house + -lik having', lat: 69.38, lon: -81.80, region: 'Nunavut', english: 'Igloolik' },
  { name: 'Sanirajak', s: 'ᓴᓂᕋᔭᒃ', en: 'the one along the coast', parts: 'sani- beside + -rajak', lat: 68.78, lon: -81.24, region: 'Nunavut', english: 'Hall Beach' },
  { name: 'Naujaat', s: 'ᓇᐅᔮᑦ', en: 'gull nesting place', parts: 'naujaq gull + -at many', lat: 66.53, lon: -86.23, region: 'Nunavut', english: 'Naujaat' },
  { name: 'Salliq', s: 'ᓴᓪᓕᖅ', en: 'the island in front of the mainland', parts: 'salliq the one furthest out', lat: 64.14, lon: -83.17, region: 'Nunavut', english: 'Coral Harbour' },
  { name: 'Kangiqliniq', s: 'ᑲᖏᖅᖠᓂᖅ', en: 'deep inlet', parts: 'kangiq inlet + -liniq deep', lat: 62.81, lon: -92.08, region: 'Nunavut', english: 'Rankin Inlet' },
  { name: 'Arviat', s: 'ᐊᕐᕕᐊᑦ', en: 'place of bowhead whales', parts: 'arviq bowhead + -at many', lat: 61.11, lon: -94.06, region: 'Nunavut', english: 'Arviat' },
  { name: 'Tikirarjuaq', s: 'ᑎᑭᕋᕐᔪᐊᖅ', en: 'long point', parts: 'tikiraq point + -rjuaq big', lat: 62.18, lon: -92.58, region: 'Nunavut', english: 'Whale Cove' },
  { name: 'Igluligaarjuk', s: 'ᐃᒡᓗᓕᒑᕐᔪᒃ', en: 'place with few houses', parts: 'iglu house + -lik having + -gaarjuk few, small', lat: 63.35, lon: -90.70, region: 'Nunavut', english: 'Chesterfield Inlet' },
  { name: 'Qamani’tuaq', s: 'ᖃᒪᓂᑦᑐᐊᖅ', en: 'where the river widens into a lake', parts: 'qamaniq river widening + -tuaq big', lat: 64.32, lon: -96.02, region: 'Nunavut', english: 'Baker Lake' },
  { name: 'Uqsuqtuuq', s: 'ᐅᖅᓱᖅᑑᖅ', en: 'place of much blubber', parts: 'uqsuq blubber + -tuuq having much', lat: 68.63, lon: -95.88, region: 'Nunavut', english: 'Gjoa Haven' },
  { name: 'Talurjuaq', s: 'ᑕᓗᕐᔪᐊᖅ', en: 'large caribou hunting blind', parts: 'talu blind, screen + -rjuaq big', lat: 69.54, lon: -93.53, region: 'Nunavut', english: 'Taloyoak' },
  { name: 'Kuugaarjuk', s: 'ᑰᒑᕐᔪᒃ', en: 'little stream', parts: 'kuuk river + -gaarjuk little', lat: 68.53, lon: -89.82, region: 'Nunavut', english: 'Kugaaruk' },
  { name: 'Iqaluktuuttiaq', en: 'good fishing place', parts: 'iqaluk fish + -tuuq having much + -tsiaq good', lat: 69.12, lon: -105.06, region: 'Inuinnaqtun', english: 'Cambridge Bay' },
  { name: 'Qurluqtuq', en: 'place of moving water', parts: 'qurluq rapids + -tuq it is', lat: 67.83, lon: -115.10, region: 'Inuinnaqtun', english: 'Kugluktuk' },
  { name: 'Uluksaqtuuq', en: 'place with much ulu stone', parts: 'ulu knife + -ksaq material for + -tuuq having much', lat: 70.74, lon: -117.77, region: 'Inuinnaqtun', english: 'Ulukhaktok' },
  { name: 'Tuktuujaqtuuq', en: 'it looks like a caribou', parts: 'tuktu caribou + -ujaq resembling + -tuuq', lat: 69.45, lon: -133.04, region: 'Inuvialuktun', english: 'Tuktoyaktuk' },
  { name: 'Paulatuuq', en: 'place of coal and soot', parts: 'paulaq soot + -tuuq having much', lat: 69.35, lon: -124.07, region: 'Inuvialuktun', english: 'Paulatuk' },
  { name: 'Ikaahuk', en: 'where you cross over to', parts: 'ikaaq- cross + -huk', lat: 71.99, lon: -125.25, region: 'Inuvialuktun', english: 'Sachs Harbour' },
  { name: 'Kuujjuaq', s: 'ᑰᔾᔪᐊᖅ', en: 'great river', parts: 'kuuk river + -juaq great', lat: 58.10, lon: -68.40, region: 'Nunavik', english: 'Kuujjuaq' },
  { name: 'Inukjuak', s: 'ᐃᓄᒃᔪᐊᖅ', en: 'the giant', parts: 'inuk person + -juaq big', lat: 58.45, lon: -78.10, region: 'Nunavik', english: 'Inukjuak' },
  { name: 'Tasiujaq', s: 'ᑕᓯᐅᔭᖅ', en: 'resembles a lake', parts: 'tasiq lake + -ujaq resembling', lat: 58.70, lon: -69.94, region: 'Nunavik', english: 'Tasiujaq' },
  { name: 'Umiujaq', s: 'ᐅᒥᐅᔭᖅ', en: 'resembles a boat', parts: 'umiaq boat + -ujaq resembling', lat: 56.55, lon: -76.55, region: 'Nunavik', english: 'Umiujaq' },
  { name: 'Aupaluk', s: 'ᐊᐅᐸᓗᒃ', en: 'where the earth is red', parts: 'aupaq red + -luk', lat: 59.30, lon: -69.60, region: 'Nunavik', english: 'Aupaluk' },
  { name: 'Kangiqsujuaq', s: 'ᑲᖏᖅᓱᔪᐊᖅ', en: 'the large bay', parts: 'kangiq bay + -su- + -juaq large', lat: 61.60, lon: -71.96, region: 'Nunavik', english: 'Kangiqsujuaq' },
  { name: 'Kangiqsualujjuaq', s: 'ᑲᖏᖅᓱᐊᓗᔾᔪᐊᖅ', en: 'the very large bay', parts: 'kangiq bay + -aluk huge + -juaq great', lat: 58.69, lon: -65.95, region: 'Nunavik', english: 'Kangiqsualujjuaq' },
  { name: 'Salluit', s: 'ᓴᓪᓗᐃᑦ', en: 'the thin ones', parts: 'salluq thin + -it plural', lat: 62.20, lon: -75.65, region: 'Nunavik', english: 'Salluit' },
  { name: 'Ivujivik', s: 'ᐃᕗᔨᕕᒃ', en: 'where the ice piles up in the current', parts: 'ivu- pile up + -ji- + -vik place of', lat: 62.42, lon: -77.91, region: 'Nunavik', english: 'Ivujivik' },
  { name: 'Kuujjuaraapik', s: 'ᑰᔾᔪᐊᕌᐱᒃ', en: 'little great river', parts: 'kuuk river + -juaq great + -raapik little', lat: 55.28, lon: -77.76, region: 'Nunavik', english: 'Kuujjuarapik' },
  { name: 'Sanikiluaq', s: 'ᓴᓂᑭᓗᐊᖅ', en: 'named for Sanikiluaq, a fast runner', parts: 'a personal name', lat: 56.54, lon: -79.22, region: 'Nunavut', english: 'Sanikiluaq' },
  { name: 'Nunavut', s: 'ᓄᓇᕗᑦ', en: 'our land', parts: 'nuna land + -vut our', region: 'Nunavut' },
  { name: 'Qikiqtaaluk', s: 'ᕿᑭᖅᑖᓗᒃ', en: 'huge island', parts: 'qikiqtaq island + -aluk huge', region: 'Nunavut', english: 'Baffin Island' },
  { name: 'Tallurutiup Imanga', s: 'ᑕᓪᓗᕈᑎᐅᑉ ᐃᒪᖓ', en: 'the waters of Tallurutit (Devon Island)', parts: 'tallurutit chin tattoo lines + -up of + imaq sea + -nga its', region: 'Nunavut', english: 'Lancaster Sound' },
];
