import { CREW, TARGET, commitDiscard, createMatch, dealRound, legalPegCards, choosePegCard, nextRound, playPeg, rank, sayGo, scoreHand } from './cribbage-model.js';

const stylesheet = new URL('./cribbage.css', import.meta.url).href;
const suits = { C: '♣', D: '♦', S: '♠', H: '♥' };
const faces = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const cardLabel = card => `${faces[rank(card)] || rank(card)}${suits[card[0]]}`;
const red = card => 'DH'.includes(card[0]);
const cardButton = (card, index, options = {}) => `<button type="button" class="crib-card ${red(card) ? 'red' : ''} ${options.selected ? 'selected' : ''}" data-card="${card}" ${options.disabled ? 'disabled' : ''} aria-pressed="${options.selected ? 'true' : 'false'}" aria-label="${cardLabel(card)}${options.disabled ? ', cannot play' : ''}"><span>${cardLabel(card)}</span><kbd>${index + 1}</kbd></button>`;
const cardsText = cards => cards.map(cardLabel).join(' ');
const partsText = result => result.parts.length ? result.parts.map(part => `${part.label} ${part.points}`).join(' + ') : 'No scoring combinations';

function scoreTrack(game) {
  const lanes = [{ name: 'You', score: game.scores[0] }, { name: CREW[game.opponent].name, score: game.scores[1] }];
  return `<section class="crib-board" aria-label="Score track to 121"><div class="crib-board-scale"><span>0</span><span>30</span><span>60</span><span>90</span><span>121</span></div>${lanes.map((lane, player) => `<div class="crib-lane"><strong>${lane.name}</strong><div class="crib-track" role="progressbar" aria-label="${lane.name} score" aria-valuemin="0" aria-valuemax="121" aria-valuenow="${lane.score}"><span class="crib-fill p${player}" style="width:${lane.score / TARGET * 100}%"></span><i class="crib-peg p${player}" style="left:${lane.score / TARGET * 100}%"></i></div><b>${lane.score}</b></div>`).join('')}</section>`;
}

function resultLine(result) {
  return `<span>${result.parts.length ? result.parts.map(part => `${part.label} <b>${part.points}</b>`).join(' · ') : 'No points'}</span><strong>${result.points}</strong>`;
}

export const game = {
  title: 'Cribbage',
  multiplayerOnly: true,
  mount(root) {
    const dialog = root.closest('dialog');
    dialog?.classList.add('cribbage-modal');
    if (!document.querySelector('link[data-cribbage]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = stylesheet; css.dataset.cribbage = ''; document.head.append(css);
    }
    let state = null, selected = new Set(), opponent = 'ada', disposed = false, botTimer = null, seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    root.innerHTML = '<section class="cribbage" aria-label="Two-player Cribbage"></section>';
    const table = root.firstElementChild;

    function start() {
      state = createMatch(opponent, seed += 0x9e3779b9); selected = new Set(); dealRound(state); render(); scheduleBot();
    }

    function statusText() {
      if (!state) return 'Choose who has the other pegs.';
      if (state.phase === 'discard') return selected.size === 2 ? 'Two for the crib. Ready to cut.' : `Choose two cards for the ${state.dealer === 0 ? 'crib' : "dealer's crib"}.`;
      if (state.phase === 'pegging') {
        if (state.pegging.turn === 1) return `${CREW[state.opponent].name} is pegging…`;
        return legalPegCards(state, 0).length ? 'Your play. Keep the count at 31 or less.' : 'Nothing fits. Call go.';
      }
      if (state.phase === 'roundEnd') return `Round ${state.round} counted. The crib crosses the table.`;
      if (state.phase === 'gameOver') return state.winner === 0 ? 'You reached 121!' : `${CREW[state.opponent].name} reached 121.`;
      return 'Counting the hands…';
    }

    function renderSetup() {
      const hadFocus = table.contains(document.activeElement) || document.activeElement === root;
      table.innerHTML = `<div class="crib-intro"><p class="crib-kicker">WARDROOM · TWO PLAYERS</p><h3>First peg to 121</h3><p>Choose an Amundsen shipmate. Their play is local, repeatable from the cards on the table, and needs no connection.</p><form class="crib-setup"><fieldset><legend>Across the board</legend>${Object.entries(CREW).map(([id, crew]) => `<label class="crib-opponent ${id === opponent ? 'chosen' : ''}"><input type="radio" name="opponent" value="${id}" ${id === opponent ? 'checked' : ''}><span><b>${crew.name}</b><small>${crew.note}</small></span></label>`).join('')}</fieldset><button type="submit">Deal six <kbd>Enter</kbd></button></form></div>${rules()}`;
      if (hadFocus) table.querySelector('input:checked')?.focus({ preventScroll: true });
    }

    function handArea() {
      if (state.phase === 'discard') return `<section class="crib-hand-zone"><h4>Your six cards <span>${selected.size}/2 to crib</span></h4><div class="crib-hand">${state.dealt[0].map((card, index) => cardButton(card, index, { selected: selected.has(card) })).join('')}</div><button type="button" class="crib-primary" data-action="discard" ${selected.size !== 2 ? 'disabled' : ''}>Send two to crib <kbd>Enter</kbd></button></section>`;
      if (state.phase === 'pegging') {
        const hand = state.pegging.hands[0], legal = new Set(legalPegCards(state, 0)), ownTurn = state.pegging.turn === 0;
        return `<section class="crib-hand-zone"><h4>Your cards <span>${hand.length} remain</span></h4><div class="crib-hand">${hand.map((card, index) => cardButton(card, index, { disabled: !ownTurn || !legal.has(card) })).join('') || '<p class="crib-empty">Hand played out.</p>'}</div>${ownTurn && !legal.size ? '<button type="button" class="crib-primary" data-action="go">Call go <kbd>G</kbd></button>' : ''}</section>`;
      }
      const own = scoreHand(state.hands[0], state.starter);
      return `<section class="crib-hand-zone crib-reveal"><h4>Your hand</h4><div class="crib-small-cards">${state.hands[0].map(card => `<span class="${red(card) ? 'red' : ''}">${cardLabel(card)}</span>`).join('')}</div><p>${partsText(own)} · <b>${own.points}</b></p></section>`;
    }

    function playTable() {
      const peg = state.pegging;
      if (!peg) return `<div class="crib-felt"><div><small>Starter</small><strong>${state.starter ? cardLabel(state.starter) : '—'}</strong></div><p>The deck is cut after both players discard.</p><div><small>Crib</small><strong>${state.crib?.length || 0}/4</strong></div></div>`;
      const current = peg.sequence.map(card => `<span class="${red(card) ? 'red' : ''}">${cardLabel(card)}</span>`).join('');
      return `<div class="crib-felt"><div class="crib-starter"><small>Starter</small><strong class="${red(state.starter) ? 'red' : ''}">${cardLabel(state.starter)}</strong></div><div class="crib-count"><strong>${peg.total}</strong><small>running count</small><div class="crib-played">${current || '<em>New count</em>'}</div></div><div class="crib-crib"><small>${state.dealer === 0 ? 'Your crib' : `${CREW[state.opponent].name}'s crib`}</small><strong>4 cards</strong></div></div>`;
    }

    function countSheet() {
      if (!state.counts?.length) return '';
      return `<section class="crib-counts"><h4>Counting board · starter ${cardLabel(state.starter)}</h4>${state.counts.map(count => `<article><div><b>${count.label}</b><small>${cardsText(count.cards)} + ${cardLabel(state.starter)}</small></div>${resultLine(count)}</article>`).join('')}</section>`;
    }

    function ledger() {
      const entries = state.ledger.filter(entry => entry.points).slice(-12).reverse();
      return `<details class="crib-ledger" ${['roundEnd', 'gameOver'].includes(state.phase) ? 'open' : ''}><summary>Score log · every point</summary>${entries.length ? `<ol>${entries.map(entry => `<li><span><b>${entry.player === 0 ? 'You' : CREW[state.opponent].name}</b> · ${entry.label}${entry.details?.length ? `<small>${entry.details.map(part => `${part.label} ${part.points}`).join(' · ')}</small>` : ''}</span><strong>+${entry.points}</strong></li>`).join('')}</ol>` : '<p>No points pegged yet.</p>'}</details>`;
    }

    function render() {
      if (disposed) return;
      if (!state) { renderSetup(); return; }
      const hadFocus = table.contains(document.activeElement) || document.activeElement === root;
      const focusedCard = document.activeElement?.dataset?.card;
      const action = state.phase === 'roundEnd' ? '<button type="button" class="crib-primary" data-action="next">Deal next round <kbd>Enter</kbd></button>' : state.phase === 'gameOver' ? '<button type="button" class="crib-primary" data-action="replay">Play another match <kbd>R</kbd></button>' : '';
      const playHistory = state.pegging?.plays?.length ? `<details class="crib-plays"><summary>Pegging plays</summary><ol>${state.pegging.plays.map(play => `<li><span>${play.player === 0 ? 'You' : CREW[state.opponent].name} · ${cardLabel(play.card)} → ${play.total}</span>${play.points ? `<b>+${play.points} ${play.label}</b>` : ''}</li>`).join('')}</ol></details>` : '';
      table.innerHTML = `<header class="crib-header"><div><p class="crib-kicker">ROUND ${state.round} · ${state.dealer === 0 ? 'YOUR CRIB' : `${CREW[state.opponent].name.toUpperCase()}'S CRIB`}</p><h3>${state.winner === null ? `You vs ${CREW[state.opponent].name}` : state.winner === 0 ? 'Match won' : `${CREW[state.opponent].name} wins`}</h3></div><button type="button" data-action="new">Change opponent</button></header>${scoreTrack(state)}<p class="crib-status" role="status" aria-live="polite">${statusText()}</p><div class="crib-layout"><main>${playTable()}${handArea()}${action}</main><aside>${countSheet()}${playHistory}${ledger()}</aside></div>${rules()}`;
      const preferred = (focusedCard && table.querySelector(`[data-card="${focusedCard}"]:not(:disabled)`)) || table.querySelector('[data-card]:not(:disabled), [data-action="go"], [data-action="next"], [data-action="replay"]');
      if (hadFocus) preferred?.focus({ preventScroll: true });
    }

    function rules() {
      return '<details class="crib-rules"><summary>How to play · controls and counting</summary><p>Each player discards two of six cards to the dealer’s crib. The non-dealer pegs first; alternate cards without taking the running count above 31. Score 2 for 15 or 31, 2/6/12 for two/three/four of a rank, and the length of the longest run. Go or the last card scores 1.</p><p>After pegging: non-dealer hand, dealer hand, then crib. Every distinct fifteen scores 2; every pair scores 2; duplicate ranks multiply runs; flushes score 4 (or 5 with the starter), while a crib flush requires all 5. A jack matching the starter suit scores 1 for nobs. A jack starter gives the dealer 2 for heels. First to 121 wins immediately.</p><p><kbd>1–6</kbd> choose or play cards · <kbd>Enter</kbd> confirms · <kbd>G</kbd> calls go · <kbd>R</kbd> replays after a match.</p></details>';
    }

    function scheduleBot() {
      clearTimeout(botTimer);
      if (disposed || !state || state.phase !== 'pegging' || state.pegging.turn !== 1) return;
      botTimer = setTimeout(() => {
        if (disposed || state.phase !== 'pegging' || state.pegging.turn !== 1) return;
        const card = choosePegCard(state, 1);
        try { if (card) playPeg(state, 1, card); else sayGo(state, 1); } catch (error) { console.error(error); }
        render(); scheduleBot();
      }, 520);
    }

    function cardAction(card) {
      if (!state) return;
      if (state.phase === 'discard') {
        if (selected.has(card)) selected.delete(card); else if (selected.size < 2) selected.add(card);
        render(); return;
      }
      if (state.phase === 'pegging' && state.pegging.turn === 0 && legalPegCards(state, 0).includes(card)) {
        playPeg(state, 0, card); render(); scheduleBot();
      }
    }

    function action(name) {
      try {
        if (name === 'discard' && state.phase === 'discard') { commitDiscard(state, [...selected]); selected.clear(); render(); scheduleBot(); }
        else if (name === 'go' && state.phase === 'pegging') { sayGo(state, 0); render(); scheduleBot(); }
        else if (name === 'next' && state.phase === 'roundEnd') { nextRound(state); selected.clear(); render(); scheduleBot(); }
        else if (name === 'replay') start();
        else if (name === 'new') { clearTimeout(botTimer); state = null; selected.clear(); render(); }
      } catch (error) { console.error(error); }
    }

    function click(event) {
      const card = event.target.closest('[data-card]'); if (card && !card.disabled) { cardAction(card.dataset.card); return; }
      const button = event.target.closest('[data-action]'); if (button && !button.disabled) action(button.dataset.action);
    }
    function submit(event) { event.preventDefault(); opponent = new FormData(event.target).get('opponent') || opponent; start(); }
    function change(event) { if (event.target.name === 'opponent') { opponent = event.target.value; render(); } }
    function keydown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const number = +event.key;
      if (number >= 1 && number <= 6) {
        const cards = state?.phase === 'discard' ? state.dealt[0] : state?.phase === 'pegging' ? state.pegging.hands[0] : [];
        const card = cards[number - 1]; if (card) { event.preventDefault(); cardAction(card); }
      } else if (event.key.toLowerCase() === 'g' && state?.phase === 'pegging' && state.pegging.turn === 0 && !legalPegCards(state, 0).length) { event.preventDefault(); action('go'); }
      else if (event.key.toLowerCase() === 'r' && state?.phase === 'gameOver') { event.preventDefault(); action('replay'); }
      else if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') {
        if (!state) { event.preventDefault(); start(); return; }
        if (state.phase === 'discard' && selected.size === 2) { event.preventDefault(); action('discard'); }
        else if (state.phase === 'roundEnd') { event.preventDefault(); action('next'); }
      }
    }
    table.addEventListener('click', click); table.addEventListener('submit', submit); table.addEventListener('change', change); root.addEventListener('keydown', keydown);
    render();
    return () => { disposed = true; clearTimeout(botTimer); dialog?.classList.remove('cribbage-modal'); table.removeEventListener('click', click); table.removeEventListener('submit', submit); table.removeEventListener('change', change); root.removeEventListener('keydown', keydown); };
  },
};
