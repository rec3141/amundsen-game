export const TARGET = 121;

export const CREW = {
  capn: { name: "Cap'n Barnacle", note: 'Steady at the helm', style: 'steady' },
  doc: { name: 'Doc', note: 'Counts every combination aloud', style: 'careful' },
  ada: { name: 'Ada', note: 'Plays the percentages', style: 'sharp' },
  polly: { name: 'Polly', note: 'Quick cards and quicker patter', style: 'bold' },
};

export const SUITS = ['C', 'D', 'S', 'H'];
export const RANKS = Array.from({ length: 13 }, (_, index) => index + 1);
export const deck = () => SUITS.flatMap(suit => RANKS.map(rank => `${suit}${rank}`));
export const rank = card => +card.slice(1);
export const value = card => Math.min(rank(card), 10);

const choose = (items, size, start = 0, prefix = [], result = []) => {
  if (!size) { result.push(prefix); return result; }
  for (let index = start; index <= items.length - size; index += 1) choose(items, size - 1, index + 1, [...prefix, items[index]], result);
  return result;
};

export function scoreHand(hand, starter, crib = false) {
  const cards = [...hand, starter], parts = [];
  let fifteenCount = 0;
  for (let size = 2; size <= cards.length; size += 1) fifteenCount += choose(cards, size).filter(group => group.reduce((sum, card) => sum + value(card), 0) === 15).length;
  if (fifteenCount) parts.push({ label: `${fifteenCount} fifteen${fifteenCount === 1 ? '' : 's'}`, points: fifteenCount * 2 });

  const pairCount = choose(cards, 2).filter(([a, b]) => rank(a) === rank(b)).length;
  if (pairCount) parts.push({ label: `${pairCount} pair${pairCount === 1 ? '' : 's'}`, points: pairCount * 2 });

  let runSize = 0, runCount = 0;
  for (let size = 5; size >= 3; size -= 1) {
    const runs = choose(cards, size).filter(group => {
      const ranks = group.map(rank).sort((a, b) => a - b);
      return new Set(ranks).size === size && ranks[size - 1] - ranks[0] === size - 1;
    });
    if (runs.length) { runSize = size; runCount = runs.length; break; }
  }
  if (runCount) parts.push({ label: `${runCount > 1 ? `${runCount} × ` : ''}run of ${runSize}`, points: runCount * runSize });

  const handFlush = hand.every(card => card[0] === hand[0][0]);
  if (handFlush && starter[0] === hand[0][0]) parts.push({ label: '5-card flush', points: 5 });
  else if (handFlush && !crib) parts.push({ label: '4-card flush', points: 4 });
  if (hand.some(card => rank(card) === 11 && card[0] === starter[0])) parts.push({ label: 'His nobs', points: 1 });
  return { points: parts.reduce((sum, part) => sum + part.points, 0), parts };
}

export function scorePeg(sequence, total) {
  const parts = [], last = sequence.at(-1);
  if (total === 15) parts.push({ label: '15', points: 2 });
  if (total === 31) parts.push({ label: '31', points: 2 });
  let same = 1;
  while (same < sequence.length && rank(sequence.at(-same - 1)) === rank(last)) same += 1;
  if (same >= 2) parts.push({ label: same === 2 ? 'Pair' : same === 3 ? 'Pair royal' : 'Double pair royal', points: same === 2 ? 2 : same === 3 ? 6 : 12 });
  for (let size = Math.min(sequence.length, 7); size >= 3; size -= 1) {
    const ranks = sequence.slice(-size).map(rank), unique = new Set(ranks);
    if (unique.size === size && Math.max(...ranks) - Math.min(...ranks) === size - 1) { parts.push({ label: `Run of ${size}`, points: size }); break; }
  }
  return { points: parts.reduce((sum, part) => sum + part.points, 0), parts };
}

export function makeRng(seed = Date.now()) {
  let state = seed >>> 0 || 0x51f15e;
  return () => ((state = Math.imul(state ^ state >>> 15, 1 | state), state ^= state + Math.imul(state ^ state >>> 7, 61 | state), ((state ^ state >>> 14) >>> 0) / 4294967296));
}

function shuffled(seed) {
  const cards = deck(), random = makeRng(seed);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

const discardValue = cards => {
  const vals = cards.map(value), ranks = cards.map(rank);
  let score = vals.reduce((sum, a, i) => sum + vals.slice(i + 1).filter(b => a + b === 15).length * 2, 0);
  if (ranks[0] === ranks[1]) score += 2;
  if (vals.includes(5)) score += 2;
  if (cards[0][0] === cards[1][0]) score += .35;
  return score;
};

export function chooseDiscard(cards, ownsCrib, style = 'steady') {
  const weight = { careful: .75, steady: 1, sharp: 1.2, bold: 1.45 }[style] || 1;
  return choose(cards, 2).map(thrown => {
    const kept = cards.filter(card => !thrown.includes(card));
    const expected = deck().filter(card => !cards.includes(card)).reduce((sum, starter) => sum + scoreHand(kept, starter).points, 0) / 46;
    const cribEffect = discardValue(thrown) * (ownsCrib ? weight : -weight);
    return { thrown, value: expected + cribEffect };
  }).sort((a, b) => b.value - a.value || a.thrown.join('').localeCompare(b.thrown.join('')))[0].thrown;
}

export function legalPegCards(game, player = game.pegging.turn) {
  if (game.phase !== 'pegging') return [];
  return game.pegging.hands[player].filter(card => value(card) + game.pegging.total <= 31);
}

export function choosePegCard(game, player = 1) {
  const legal = legalPegCards(game, player), style = CREW[game.opponent].style;
  return legal.map(card => {
    const total = game.pegging.total + value(card), scored = scorePeg([...game.pegging.sequence, card], total).points;
    const safe = total === 5 || total === 10 || total === 21 ? -({ careful: 2, steady: 1.4, sharp: 2.4, bold: .5 }[style]) : 0;
    const pairRisk = game.pegging.sequence.length && rank(game.pegging.sequence.at(-1)) === rank(card) ? -.25 : 0;
    return { card, merit: scored * 10 + safe + pairRisk - total / 100 };
  }).sort((a, b) => b.merit - a.merit || rank(a.card) - rank(b.card) || a.card.localeCompare(b.card))[0]?.card;
}

function log(game, kind, player, label, points = 0, details = []) {
  game.ledger.push({ round: game.round, kind, player, label, points, details, score: [...game.scores] });
}

function award(game, player, points, label, kind = 'pegging', details = []) {
  if (!points || game.phase === 'gameOver') return;
  game.scores[player] = Math.min(TARGET, game.scores[player] + points);
  log(game, kind, player, label, points, details);
  if (game.scores[player] >= TARGET) { game.phase = 'gameOver'; game.winner = player; }
}

export function createMatch(opponent = 'ada', seed = Date.now()) {
  return { opponent: CREW[opponent] ? opponent : 'ada', seed: seed >>> 0, scores: [0, 0], dealer: (seed >>> 0) % 2, round: 0, phase: 'new', winner: null, ledger: [], counts: [] };
}

export function dealRound(game) {
  if (game.phase === 'gameOver') return game;
  game.round += 1; game.phase = 'discard'; game.counts = []; game.selected = [];
  const cards = shuffled(game.seed + Math.imul(game.round, 0x9e3779b1));
  game.dealt = [cards.slice(0, 6), cards.slice(6, 12)]; game.deck = cards.slice(12); game.starter = null; game.crib = [];
  game.hands = [[], []]; game.pegging = null;
  log(game, 'deal', null, `Round ${game.round}: ${game.dealer === 0 ? 'you deal' : `${CREW[game.opponent].name} deals`}`);
  return game;
}

export function commitDiscard(game, selected) {
  if (game.phase !== 'discard' || selected.length !== 2 || selected.some(card => !game.dealt[0].includes(card)) || new Set(selected).size !== 2) throw new Error('Choose exactly two cards for the crib.');
  const theirs = chooseDiscard(game.dealt[1], game.dealer === 1, CREW[game.opponent].style);
  game.crib = [...selected, ...theirs];
  game.hands = [game.dealt[0].filter(card => !selected.includes(card)), game.dealt[1].filter(card => !theirs.includes(card))];
  game.starter = game.deck.shift();
  log(game, 'discard', null, `${game.dealer === 0 ? 'Your' : `${CREW[game.opponent].name}'s`} crib · starter ${game.starter}`);
  if (rank(game.starter) === 11) award(game, game.dealer, 2, 'His heels', 'starter');
  if (game.phase === 'gameOver') return game;
  game.phase = 'pegging';
  game.pegging = { hands: game.hands.map(cards => [...cards]), sequence: [], total: 0, turn: 1 - game.dealer, passed: [false, false], lastPlayer: null, plays: [] };
  return game;
}

function finishPegging(game) {
  if (game.phase === 'gameOver') return;
  game.phase = 'counting'; game.counts = [];
  for (const player of [1 - game.dealer, game.dealer]) {
    const scored = scoreHand(game.hands[player], game.starter);
    const name = player === 0 ? 'Your hand' : `${CREW[game.opponent].name}'s hand`;
    game.counts.push({ player, label: name, cards: [...game.hands[player]], ...scored });
    award(game, player, scored.points, name, 'counting', scored.parts);
    if (game.phase === 'gameOver') return;
  }
  const scored = scoreHand(game.crib, game.starter, true), name = `${game.dealer === 0 ? 'Your' : `${CREW[game.opponent].name}'s`} crib`;
  game.counts.push({ player: game.dealer, label: name, cards: [...game.crib], ...scored });
  award(game, game.dealer, scored.points, name, 'counting', scored.parts);
  if (game.phase !== 'gameOver') game.phase = 'roundEnd';
}

function resetPeg(game, next) {
  const peg = game.pegging;
  peg.sequence = []; peg.total = 0; peg.passed = [false, false]; peg.turn = next;
}

export function playPeg(game, player, card) {
  if (game.phase !== 'pegging' || game.pegging.turn !== player || !legalPegCards(game, player).includes(card)) throw new Error('That card cannot be played now.');
  const peg = game.pegging;
  peg.hands[player].splice(peg.hands[player].indexOf(card), 1); peg.sequence.push(card); peg.total += value(card); peg.lastPlayer = player; peg.passed[player] = false;
  const scored = scorePeg(peg.sequence, peg.total);
  peg.plays.push({ player, card, total: peg.total, points: scored.points, label: scored.parts.map(part => part.label).join(' + ') });
  if (scored.points) award(game, player, scored.points, scored.parts.map(part => part.label).join(' + '), 'pegging', scored.parts);
  if (game.phase === 'gameOver') return game;
  const empty = peg.hands[0].length + peg.hands[1].length === 0;
  if (peg.total === 31) {
    if (empty) finishPegging(game); else resetPeg(game, 1 - player);
  } else if (empty) {
    award(game, player, 1, 'Last card', 'pegging');
    finishPegging(game);
  } else peg.turn = 1 - player;
  return game;
}

export function sayGo(game, player) {
  if (game.phase !== 'pegging' || game.pegging.turn !== player || legalPegCards(game, player).length) throw new Error('Go is only available when no card fits.');
  const peg = game.pegging; peg.passed[player] = true;
  const other = 1 - player;
  if (peg.passed[other] || !legalPegCards(game, other).length) {
    if (peg.lastPlayer !== null && peg.total !== 31) award(game, peg.lastPlayer, 1, 'Go', 'pegging');
    if (game.phase === 'gameOver') return game;
    if (!peg.hands[0].length && !peg.hands[1].length) finishPegging(game);
    else resetPeg(game, peg.lastPlayer === null ? other : 1 - peg.lastPlayer);
  } else peg.turn = other;
  return game;
}

export function nextRound(game) {
  if (game.phase !== 'roundEnd') throw new Error('Finish this round first.');
  game.dealer = 1 - game.dealer;
  return dealRound(game);
}
