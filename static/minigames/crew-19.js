const stylesheet = new URL('./crew-19.css', import.meta.url).href;
const disciplines = ['Observation', 'Model', 'Review'];
const moves = [
  { name: 'Observe', text: 'Collect a decisive sample', kind: 0 },
  { name: 'Model', text: 'Predict the unseen pattern', kind: 1 },
  { name: 'Review', text: 'Probe the assumptions', kind: 2 },
];
// Observation answers Review; Model answers Observation; Review answers Model.
const rivals = [
  { name: 'Dr. Floe', field: 'Ice physicist', icon: '❄', sequence: [1, 0, 2],
    tells: ['“Let’s inspect that brine channel.”', '“My ice-growth forecast is ready.”', '“What about the boundary conditions?”'] },
  { name: 'Prof. Bloom', field: 'Plankton ecologist', icon: '✳', sequence: [0, 2, 1, 2],
    tells: ['“The bottle has something to say.”', '“Watch my bloom prediction.”', '“Did you account for grazing?”'] },
  { name: 'Dr. Eddy', field: 'Physical oceanographer', icon: '≈', sequence: [2, 1, 0, 1, 2],
    tells: ['“Another transect across the front.”', '“The circulation closes like this…”', '“Show me your mixing assumptions.”'] },
];

export const game = {
  title: 'Rival Researchers',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    let active = true, submitted = false;
    let phase, index, turn, hp, rivalHp, focus, wins, counters, rounds, message;
    const location = Number.isFinite(expedition?.lat) && Number.isFinite(expedition?.lon)
      ? `Encounter at ${expedition.lat.toFixed(2)}°, ${expedition.lon.toFixed(2)}°`
      : 'An unexpected hail alongside Amundsen';
    root.innerHTML = `<section class="rr19" tabindex="-1" aria-label="Rival Researchers">
      <link rel="stylesheet" href="${stylesheet}">
      <header><p class="rr19-eyebrow">UNDERWAY ENCOUNTER</p><h2>Rival Researchers</h2><p data-location></p></header>
      <div class="rr19-route" data-route></div>
      <div class="rr19-arena">
        <article class="rr19-card"><span class="rr19-avatar" aria-hidden="true">⚓</span><h3>Amundsen crew</h3><p>Your scientific resolve</p><meter data-hp min="0" max="100" aria-label="Crew resolve"></meter><p data-crew></p></article>
        <span class="rr19-vs" aria-hidden="true">VS</span>
        <article class="rr19-card rr19-rival"><span class="rr19-avatar" data-icon aria-hidden="true"></span><h3 data-name></h3><p data-field></p><meter data-rival min="0" max="80" aria-label="Rival resolve"></meter><p data-rival-hp></p></article>
      </div>
      <div class="rr19-tell"><strong data-intent></strong><p data-tell></p></div>
      <p class="rr19-status" role="status" aria-live="polite" data-status></p>
      <div class="rr19-moves">${moves.map((m, i) => `<button type="button" data-action="${i}"><b>${i + 1} · ${m.name}</b><span>${m.text}</span><small>1 focus</small></button>`).join('')}
        <button type="button" data-action="3"><b>4 · Regroup</b><span>Brace for the reply</span><small>Restore 2 focus · halve incoming damage</small></button></div>
      <div class="rr19-actions"><button type="button" data-next></button><button type="button" data-replay>R · New encounter</button></div>
      <details open><summary>Field notes & controls</summary><p>Observation beats Review. Model beats Observation. Review beats Model. A counter deals 30 damage and takes 6; a tie deals 16 and takes 12; a weak move deals 8 and takes 20. Regroup takes 10 damage.</p><p>Read the rival’s announced move before each turn. Start with 5 focus (maximum 5). Defeat a rival to restore 25 resolve and refill focus. Each duel lasts at most 10 turns; if both are still standing, the rival holds the floor.</p><p>1–4: choose a move · Enter: begin / continue / log · R: replay after the result. Buttons also work with Tab and Space. Defeat all three to win. Score: 100 per rival + 10 per counter + remaining resolve on victory.</p></details>
    </section>`;
    const view = root.querySelector('.rr19');
    const find = selector => view.querySelector(selector);
    find('[data-location]').textContent = location;
    const buttons = [...view.querySelectorAll('[data-action]')];
    const next = find('[data-next]');
    const replay = find('[data-replay]');
    const intent = () => rivals[index].sequence[turn % rivals[index].sequence.length];
    const points = () => wins * 100 + counters * 10 + (wins === rivals.length ? hp : 0);

    function reset() {
      phase = 'intro'; index = 0; turn = 0; hp = 100; rivalHp = 80;
      focus = 5; wins = 0; counters = 0; rounds = [];
      message = 'A rival launch draws alongside. Three researchers want the last word at tonight’s seminar. Accept the challenge?';
      render();
    }
    function render() {
      const rival = rivals[index];
      find('[data-route]').textContent = rivals.map((r, i) => `${i < wins ? '✓ ' : ''}${r.name}`).join('  /  ');
      find('[data-icon]').textContent = rival.icon;
      find('[data-name]').textContent = rival.name;
      find('[data-field]').textContent = rival.field;
      find('[data-hp]').value = hp;
      find('[data-rival]').value = rivalHp;
      find('[data-crew]').textContent = `${hp} / 100 resolve · ${focus} / 5 focus`;
      find('[data-rival-hp]').textContent = `${rivalHp} / 80 resolve`;
      find('[data-intent]').textContent = phase === 'battle'
        ? `Turn ${turn + 1} / 10 · Incoming: ${disciplines[intent()]}`
        : phase === 'result' ? `${wins === 3 ? 'Seminar champions' : 'The debate is over'} · ${points()} points` : 'A challenge over the radio';
      find('[data-tell]').textContent = phase === 'battle' ? rival.tells[intent()]
        : phase === 'between' ? 'Fresh coffee, a new rival. Restore 25 resolve and refill focus before the next duel.'
          : 'Read the evidence. Anticipate the reply. Hold your ground.';
      find('[data-status]').textContent = message;
      buttons.forEach((b, i) => { b.disabled = phase !== 'battle' || (i < 3 && focus === 0); });
      next.hidden = phase === 'battle' || phase === 'logged';
      next.textContent = phase === 'intro' ? 'Enter · Accept challenge' : phase === 'between' ? 'Enter · Next rival' : `Enter · Log ${points()} points`;
      replay.hidden = phase !== 'result';
    }
    function act(choice) {
      if (!active || submitted || phase !== 'battle' || (choice < 3 && focus === 0)) return;
      const incoming = intent();
      let damage = 0, taken = 10, effect = 'You regroup and brace for the reply.';
      if (choice === 3) focus = Math.min(5, focus + 2);
      else {
        focus--;
        const counter = choice === (incoming + 1) % 3;
        const tied = choice === incoming;
        damage = counter ? 30 : tied ? 16 : 8;
        taken = counter ? 6 : tied ? 12 : 20;
        if (counter) counters++;
        effect = `${moves[choice].name}: ${counter ? 'decisive counter' : tied ? 'an even exchange' : 'the rival finds an opening'}.`;
      }
      rivalHp = Math.max(0, rivalHp - damage);
      // A decisive finishing move prevents the rival's reply.
      if (rivalHp === 0) taken = 0;
      hp = Math.max(0, hp - taken);
      turn++;
      message = `${effect} Rival −${damage} resolve; crew −${taken}.`;
      if (rivalHp === 0 || hp === 0 || turn === 10) {
        const won = rivalHp === 0;
        rounds.push({ rival: rivals[index].name, won, turns: turn, resolve: hp });
        if (won) wins++;
        phase = won && wins < 3 ? 'between' : 'result';
        message += won ? ` ${rivals[index].name} concedes the floor.` : hp === 0 ? ' Your crew is out of resolve.' : ' Ten turns: the rival holds the floor.';
        if (wins === 3) message += ' The crew takes the seminar pennant!';
      }
      render();
      if (phase !== 'battle') next.focus();
      else if (buttons[choice].disabled) buttons[3].focus();
    }
    function proceed() {
      if (!active || submitted) return;
      if (phase === 'result') {
        submitted = true; phase = 'logged';
        message = `Logged ${points()} points. ${wins} of 3 rivals defeated.`;
        render();
        complete(points(), { title: wins === 3 ? 'Rival Researchers: seminar champions' : `Rival Researchers: ${wins} rivals defeated`, wins, counters, resolve: hp, rounds });
        return;
      }
      if (phase === 'intro' || phase === 'between') {
        if (phase === 'between') { index++; hp = Math.min(100, hp + 25); focus = 5; rivalHp = 80; turn = 0; }
        phase = 'battle'; message = 'The rival commits first. Choose your response.';
        render(); buttons[0].focus();
      }
    }
    buttons.forEach((b, i) => b.addEventListener('click', () => act(i), { signal: events.signal }));
    next.addEventListener('click', proceed, { signal: events.signal });
    replay.addEventListener('click', () => { if (phase === 'result' && !submitted) { reset(); next.focus(); } }, { signal: events.signal });
    window.addEventListener('keydown', e => {
      if (!active || submitted || !view.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (root.closest('dialog') && !root.closest('dialog').open) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (!['1', '2', '3', '4', 'enter', 'r'].includes(key)) return;
      // Let focused buttons keep their native Enter activation.
      if (key === 'enter' && view.contains(e.target) && e.target.closest('button, summary')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (key === 'enter') proceed();
      else if (key === 'r' && phase === 'result') { reset(); next.focus(); }
      else if (/^[1-4]$/.test(key)) act(Number(key) - 1);
    }, { capture: true, signal: events.signal });
    reset(); view.focus();
    return () => { active = false; events.abort(); view.remove(); };
  },
};
