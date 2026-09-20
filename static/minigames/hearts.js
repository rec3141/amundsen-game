const endpoint = new URL('../api/hearts', import.meta.url);
const stylesheet = new URL('./hearts.css', import.meta.url);
const STORE = 'amundsen-hearts-seat';
const suits = { C: '♣', D: '♦', S: '♠', H: '♥' };
const label = card => `${({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[+card.slice(1)] || card.slice(1)}${suits[card[0]]}`;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sorted = cards => [...cards].sort((a, b) => 'CDSH'.indexOf(a[0]) - 'CDSH'.indexOf(b[0]) || +a.slice(1) - +b.slice(1));

export const game = {
  title: 'Wardroom Hearts',
  multiplayerOnly: true,
  mount(root) {
    const dialog = root.closest('dialog');
    dialog?.classList.add('hearts-modal');
    if (!document.querySelector('link[data-hearts]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = stylesheet; css.dataset.hearts = ''; document.head.append(css);
    }
    let credentials = null, table = null, disposed = false, busy = false, selected = new Set();
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
      let name = ''; try { name = localStorage.getItem('amundsen-crew-name') || ''; } catch {}
      body.innerHTML = `<p class="hearts-intro">Pull up a chair. Invite three shipmates using your table code.</p><form class="hearts-lobby"><label>Your name<input name="name" maxlength="40" required value="${escape(name)}" autocomplete="nickname"></label><label>Table code<input name="code" maxlength="5" placeholder="ABCDE" autocomplete="off" autocapitalize="characters"></label><div class="hearts-actions"><button type="submit" name="action" value="create">Create table</button><button type="submit" name="action" value="join">Join table</button></div></form>`;
    }
    function render() {
      const t = table, s = t.state;
      const players = t.players.map((p, seat) => `<li class="${seat === t.seat ? 'self' : ''} ${s && !s.passing && !s.handOver && s.turn === seat ? 'turn' : ''}"><strong>${p ? escape(p.name) : 'Open seat'}${seat === t.seat ? ' · you' : ''}</strong><span>${p ? `${t.scores[seat]} points${!p.online ? ' · reconnecting' : ''}` : 'Waiting for a shipmate'}</span></li>`).join('');
      let content = '';
      if (!s) {
        content = `<p>Share code <strong>${t.code}</strong> with your shipmates. ${t.players.filter(Boolean).length}/4 seated.</p><div class="hearts-actions"><button data-action="start" ${t.players.some(p => !p) ? 'disabled' : ''}>Deal cards</button><button data-action="leave">Leave table</button></div>`;
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
      body.innerHTML = `<div class="hearts-heading"><strong>TABLE ${t.code}</strong><span>Four shipmates · first to 100 ends the match</span></div><ul class="hearts-players">${players}</ul>${content}<p class="hearts-footnote">Your seat stays here when you close the table or reload this tab.</p>`;
      if (focus) body.querySelector(`[data-card="${focus}"]`)?.focus();
    }
    function send(action, extra = {}) {
      if (disposed || (action === 'poll' ? busy : pendingAction)) return;
      if (action !== 'poll') pendingAction = true;
      busy = true;
      requests = requests.then(() => perform(action, extra));
      return requests;
    }
    async function perform(action, extra) {
      if (disposed) return;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...credentials, action, revision: table?.revision, ...extra }), signal: abort.signal });
        const result = await response.json();
        if (!response.ok) {
          if ([403, 404].includes(response.status) && credentials) { credentials = null; table = null; remember(); lobby(); }
          throw new Error(result.error || 'Could not reach the table.');
        }
        if (disposed) return;
        if (action !== 'poll' || connectionLost) say('');
        connectionLost = false;
        if (result.left) { credentials = null; table = null; remember(); lobby(); return; }
        if (result.token) { credentials = { code: result.code, token: result.token }; remember(); }
        const changed = table?.revision !== result.revision || JSON.stringify(table?.players) !== JSON.stringify(result.players);
        table = result;
        if (changed || action !== 'poll') render();
      } catch (error) {
        connectionLost = error instanceof TypeError;
        if (!disposed) say(connectionLost ? 'Connection lost. Reconnecting to your table…' : error.message);
      } finally { busy = false; if (action !== 'poll') pendingAction = false; }
    }
    function click(event) {
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
      if (button.dataset.action === 'pass') send('move', { move: 'passCards', payload: { cards: [...selected] } });
      else send(button.dataset.action);
    }
    function submit(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      send(event.submitter?.value || 'join', { name: form.get('name'), code: String(form.get('code')).trim().toUpperCase() });
    }
    root.addEventListener('click', click); root.addEventListener('submit', submit);
    if (credentials) { body.textContent = 'Returning to your table…'; send('poll'); } else lobby();
    const timer = setInterval(() => { if (credentials) send('poll'); }, 1000);
    return () => { dialog?.classList.remove('hearts-modal'); disposed = true; abort.abort(); clearInterval(timer); root.removeEventListener('click', click); root.removeEventListener('submit', submit); };
  },
};
