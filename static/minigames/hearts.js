const endpoint = new URL('../api/hearts', import.meta.url);
const stylesheet = new URL('./hearts.css', import.meta.url);
const CARD_GAMES = { hearts: 'Hearts', cribbage: 'Cribbage', euchre: 'Euchre', 'gin-rummy': 'Gin Rummy', spades: 'Spades', poker: 'Poker', solitaire: 'Solitaire' };
const CREW = { capn: "Cap'n Barnacle", doc: 'Doc', ada: 'Ada', polly: 'Polly' };
const STORE = 'amundsen-hearts-seat';
const suits = { C: '♣', D: '♦', S: '♠', H: '♥' };
const label = card => `${({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[+card.slice(1)] || card.slice(1)}${suits[card[0]]}`;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sorted = cards => [...cards].sort((a, b) => 'CDSH'.indexOf(a[0]) - 'CDSH'.indexOf(b[0]) || +a.slice(1) - +b.slice(1));

export const game = {
  title: 'Wardroom Hearts',
  multiplayerOnly: true,
  mount(root, options = {}) {
    const dialog = root.closest('dialog');
    dialog?.classList.add('hearts-modal');
    if (!document.querySelector('link[data-hearts]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = stylesheet; css.dataset.hearts = ''; document.head.append(css);
    }
    let credentials = null, table = null, disposed = false, busy = false, selected = new Set();
    let selectedGame = options.cardGame || 'hearts', listing = { tables: [], games: [{ id: 'hearts', title: 'Hearts' }] }, browsing = true, chatDraft = '';
    let requests = Promise.resolve(), pendingAction = false, connectionLost = false;
    const abort = new AbortController();
    try { credentials = JSON.parse(sessionStorage.getItem(STORE)); } catch {}
    root.innerHTML = `<section class="hearts-table"><div class="hearts-notice" role="status" aria-live="polite"></div><div class="hearts-body"></div><details class="hearts-rules"><summary>How to play · Hearts</summary><p>Four players. Pass three cards left, right, across, then keep your hand on every fourth deal. The 2♣ leads. Follow suit when you can; hearts cannot lead until broken unless you have only hearts. No penalty cards on the first trick unless you have no alternative.</p><p>Each heart costs 1; Q♠ costs 13. Take all 26 and everyone else receives 26. Lowest total wins when someone reaches 100. All four players confirm before the next deal.</p><small>Rules powered by Parlour · MIT license</small></details></section>`;
    const body = root.querySelector('.hearts-body'), notice = root.querySelector('.hearts-notice');
    const say = text => { notice.textContent = text; };
    function remember() {
      try { if (credentials) sessionStorage.setItem(STORE, JSON.stringify(credentials)); else sessionStorage.removeItem(STORE); } catch {}
    }
    function lobby() {
      browsing = true;
      let name = ''; try { name = localStorage.getItem('amundsen-crew-name') || ''; } catch {}
      body.innerHTML = `<p class="hearts-intro">Pull up a chair. Join a shipmate or start a table with the crew.</p><form class="hearts-lobby"><label>Your name<input name="name" maxlength="40" required value="${escape(name)}" autocomplete="nickname"></label><label>Game<select name="game">${Object.entries(CARD_GAMES).filter(([id]) => id === selectedGame || listing.games.some(g => g.id === id)).map(([id, title]) => `<option value="${id}" ${id === selectedGame ? 'selected' : ''}>${title}</option>`).join('')}</select></label><div class="hearts-actions"><button type="submit" value="create" ${selectedGame !== 'hearts' || credentials ? 'disabled' : ''}>Create ${CARD_GAMES[selectedGame]} table</button>${credentials ? '<button type="button" data-action="resume">Return to your table</button>' : ''}</div></form><div class="hearts-tables"></div>`;
      renderListing();
    }
    function renderListing() {
      const target = body.querySelector('.hearts-tables'); if (!target) return;
      target.innerHTML = `<h3>Open tables</h3>${selectedGame !== 'hearts' ? `<p>${CARD_GAMES[selectedGame]} is coming soon. You can join another game below.</p>` : ''}${listing.tables.length ? listing.tables.map(t => `<article class="hearts-table-listing"><div><strong>${escape(t.name)}</strong><small>${escape(CARD_GAMES[t.game] || t.game)} · ${t.players.filter(Boolean).map(p => escape(p.name)).join(', ')} · ${t.started ? 'Playing' : `${t.openSeats} seats available`}</small></div><button type="button" data-join="${escape(t.id)}" ${credentials || !t.openSeats ? 'disabled' : ''}>Join ${escape(CARD_GAMES[t.game] || t.game)}</button></article>`).join('') : '<p>No tables yet. Start one and invite the crew.</p>'}`;
    }
    function renderChat() {
      const chat = root.querySelector('.hearts-conversation'); if (!chat || !table || browsing) return;
      const log = chat.querySelector('.hearts-messages');
      const stamp = JSON.stringify(table.chat);
      if (log.dataset.stamp !== stamp) {
        log.innerHTML = table.chat.map(m => `<p><strong>${escape(m.name)}</strong> ${escape(m.text)}</p>`).join('');
        log.dataset.stamp = stamp; log.scrollTop = log.scrollHeight;
      }
      chat.querySelector('.hearts-typing').textContent = table.aiPending ? 'The crew are answering…' : '';
      chat.querySelector('button').disabled = table.aiPending;
    }

    function render() {
      browsing = false;
      const t = table, s = t.state;
      const title = dialog?.querySelector('#mission-title span');
      if (title) title.textContent = CARD_GAMES[t.game] || 'Hearts';
      const players = t.players.map((p, seat) => {
        const points = s?.taken?.[seat]?.filter(card => card[0] === 'H' || card === 'S12') || [];
        const captured = points.length ? `<span class="hearts-captured" aria-label="Penalty cards captured">${points.map(card => `<i class="hearts-point-card ${'HD'.includes(card[0]) ? 'red' : ''}">${label(card)}</i>`).join('')}</span>` : '';
        return `<li class="${seat === t.seat ? 'self' : ''} ${s && !s.passing && !s.handOver && s.turn === seat ? 'turn' : ''}"><strong>${p ? escape(p.name) : 'Open seat'}${seat === t.seat ? ' · you' : ''}</strong><span>${p ? `${t.scores[seat]} points${p.crew ? ' · @' + p.crew : !p.online ? ' · reconnecting' : ''}` : 'Waiting for a shipmate'}</span>${captured}${!s && (!p || p.crew) ? `<select aria-label="Seat ${seat + 1} opponent" data-seat="${seat}"><option value="">Human shipmate</option>${Object.entries(CREW).map(([id, name]) => `<option value="${id}" ${p?.crew === id ? 'selected' : ''}>${name}</option>`).join('')}</select>` : ''}</li>`;
      }).join('');
      let content = '';
      if (!s) {
        content = `<p>Your shipmates can join this table from the open-table list. ${t.players.filter(Boolean).length}/4 seated.</p><div class="hearts-actions"><button data-action="inviteCrew" ${t.players.every(Boolean) ? 'disabled' : ''}>Invite @crew</button><button data-action="start" ${t.players.some(p => !p) ? 'disabled' : ''}>Deal cards</button><button data-action="leave">Leave table</button></div>`;
      } else {
        const canPass = t.legal.some(m => m.id === 'passCards');
        const legal = new Set(t.legal.filter(m => m.id === 'playCard').map(m => m.payload.card));
        const cards = sorted(s.hands[t.seat]);
        selected = new Set([...selected].filter(c => cards.includes(c)));
        const current = s.trick?.plays || [];
        const last = s.plays.slice(Math.max(0, Math.floor(s.plays.length / 4) * 4 - 4), Math.floor(s.plays.length / 4) * 4);
        const shown = current.length ? current : last;
        const status = s.handOver ? (t.finished ? 'Match complete' : 'Hand complete') : s.passing ? (canPass ? `Choose 3 cards to pass ${s.rules.passDirection}` : 'Waiting for the other players to pass') : legal.size ? 'Your turn — choose a card' : `${t.players[s.turn].name} is playing`;
        const trick = shown.map(p => `<div class="hearts-play"><span>${escape(t.players[p.seat].name)}</span><span class="hearts-card ${'HD'.includes(p.card[0]) ? 'red' : ''}">${label(p.card)}</span></div>`).join('');
        const hand = cards.map(c => `<button class="hearts-card ${'HD'.includes(c[0]) ? 'red' : ''} ${selected.has(c) ? 'picked' : ''}" data-card="${c}" aria-label="${label(c)}" ${canPass ? `aria-pressed="${selected.has(c)}"` : ''} ${!canPass && !legal.has(c) ? 'disabled' : ''}>${label(c)}</button>`).join('');
        content = `<h3 class="hearts-status" aria-live="polite">${escape(status)}</h3><p class="hearts-meta">Hand ${t.hand} · ${s.tricksPlayed}/13 tricks · ${s.heartsBroken ? 'Hearts broken' : 'Hearts unbroken'}</p><div class="hearts-felt" aria-label="${current.length ? 'Current trick' : 'Last trick'}">${trick || '<span>The table is ready.</span>'}</div>${!current.length && last.length ? `<p class="hearts-meta">Last trick · taken by ${escape(t.players[s.leader].name)}</p>` : ''}<div class="hearts-hand" aria-label="Your hand">${hand}</div>${canPass ? `<button data-action="pass" ${selected.size !== 3 ? 'disabled' : ''}>Pass ${selected.size}/3 cards</button>` : ''}`;
        if (s.handOver) {
          const low = Math.min(...t.scores);
          content += `<p>${t.players.map((p, i) => `${escape(p.name)}: +${s.handPoints[i]}`).join(' · ')}</p>${t.finished ? `<p class="hearts-winner">${t.players.filter((_, i) => t.scores[i] === low).map(p => escape(p.name)).join(' & ')} wins!</p>` : ''}<button data-action="ready" ${t.ready.includes(t.seat) ? 'disabled' : ''}>${t.ready.includes(t.seat) ? 'Ready — waiting for shipmates' : t.finished ? 'Play another match' : 'Ready for next hand'}</button><p class="hearts-meta">${t.ready.length}/4 ready</p>`;
        }
      }
      const focus = document.activeElement?.dataset.card;
      const chat = root.querySelector('.hearts-conversation');
      if (chat) chatDraft = chat.querySelector('input').value;
      const chatFocused = chat?.contains(document.activeElement);
      body.innerHTML = `<div class="hearts-heading"><strong>Hearts · ${escape(t.players.find(p => p && !p.crew)?.name || 'Shipmates')}'s table</strong><span class="hearts-heading-actions"><button data-action="browse">All tables</button>${s ? '<button data-action="leave">Quit game</button>' : ''}</span></div><ul class="hearts-players">${players}</ul>${content}<p class="hearts-footnote">Your seat stays here when you close the table or reload this tab.</p>`;
      if (chat) body.append(chat);
      else {
        const section = document.createElement('section'); section.className = 'hearts-conversation';
        section.innerHTML = `<h3>At the table</h3><div class="hearts-messages" role="log" aria-live="polite"></div><p class="hearts-typing" role="status"></p><form class="hearts-chat"><input name="message" aria-label="Table message" maxlength="1000" placeholder="Talk to @crew, @capn, @doc, @ada or @polly" required value="${escape(chatDraft)}"><button>Send</button></form>`;
        body.append(section);
      }
      renderChat();
      if (chatFocused) body.querySelector('.hearts-chat input').focus();
      if (focus) body.querySelector(`[data-card="${focus}"]`)?.focus();
    }
    function send(action, extra = {}) {
      if (disposed || (['poll', 'list'].includes(action) ? busy : pendingAction)) return;
      if (!['poll', 'list'].includes(action)) pendingAction = true;
      busy = true;
      requests = requests.then(() => perform(action, extra));
      return requests;
    }
    async function perform(action, extra) {
      if (disposed) return;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...credentials, action, revision: table?.revision, hand: table?.hand, ...extra }), signal: abort.signal });
        const result = await response.json();
        if (!response.ok) {
          if ([403, 404].includes(response.status) && credentials) { credentials = null; table = null; remember(); lobby(); }
          throw new Error(result.error || 'Could not reach the table.');
        }
        if (disposed) return;
        if (action !== 'poll' || connectionLost) say('');
        connectionLost = false;
        if (action === 'list') { listing = result; renderListing(); return; }
        if (action === 'chat') { chatDraft = ''; const input = body.querySelector('.hearts-chat input'); if (input) input.value = ''; }
        if (result.left) { credentials = null; table = null; remember(); lobby(); return; }
        if (result.token) { credentials = { code: result.code, token: result.token }; remember(); }
        const changed = table?.revision !== result.revision || JSON.stringify(table?.players) !== JSON.stringify(result.players);
        table = result;
        if (changed || action !== 'poll' || browsing) render();
        else renderChat();
      } catch (error) {
        connectionLost = error instanceof TypeError;
        if (!disposed) say(connectionLost ? 'Connection lost. Reconnecting to your table…' : error.message);
      } finally { busy = false; if (!['poll', 'list'].includes(action)) pendingAction = false; }
    }
    function click(event) {
      const join = event.target.closest('[data-join]');
      if (join && !join.disabled) {
        const form = body.querySelector('.hearts-lobby'); if (!form.reportValidity()) return;
        const target = listing.tables.find(t => t.id === join.dataset.join); selectedGame = target.game;
        send('join', { name: form.elements.name.value, code: target.id }); return;
      }
      const card = event.target.closest('[data-card]');
      if (card && !card.disabled && !pendingAction) {
        const value = card.dataset.card;
        if (table.legal.some(m => m.id === 'passCards')) {
          if (selected.has(value)) selected.delete(value); else if (selected.size < 3) selected.add(value);
          render();
        } else send('move', { move: 'playCard', payload: { card: value } });
        return;
      }
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      if (button.dataset.action === 'browse') { lobby(); send('list'); return; }
      if (button.dataset.action === 'resume') { send('poll'); return; }
      if (button.dataset.action === 'pass') send('move', { move: 'passCards', payload: { cards: [...selected] } });
      else send(button.dataset.action);
    }
    function submit(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      if (event.target.matches('.hearts-chat')) { send('chat', { text: form.get('message') }); return; }
      send('create', { name: form.get('name'), game: selectedGame });
    }
    function change(event) {
      if (event.target.name === 'game') {
        selectedGame = event.target.value;
        body.querySelector('.hearts-lobby button[type=submit]').disabled = selectedGame !== 'hearts' || !!credentials;
        body.querySelector('.hearts-lobby button[type=submit]').textContent = `Create ${CARD_GAMES[selectedGame]} table`;
        renderListing();
      }
      if (event.target.matches('[data-seat]')) send('setCrew', { seatIndex: +event.target.dataset.seat, crew: event.target.value });
    }
    root.addEventListener('click', click); root.addEventListener('submit', submit); root.addEventListener('change', change);
    lobby(); send('list');
    const timer = setInterval(() => send(browsing ? 'list' : 'poll'), 1000);
    return () => { dialog?.classList.remove('hearts-modal'); disposed = true; abort.abort(); clearInterval(timer); root.removeEventListener('click', click); root.removeEventListener('submit', submit); root.removeEventListener('change', change); };
  },
};

export const cardLobbies = Object.fromEntries(Object.entries(CARD_GAMES).filter(([id]) => id !== 'hearts').map(([id, title]) => [id, { title, multiplayerOnly: true, mount: (root, options) => game.mount(root, { ...options, cardGame: id }) }]));
