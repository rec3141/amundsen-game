const stylesheet = new URL('./crew-17.css', import.meta.url).href;
const SIZE = 9;
const LIMIT = 60;
const moves = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

export const game = {
  title: 'Fuel for Discovery',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    let state, closed = false, submitted = false;
    root.innerHTML = `<section class="c17" tabindex="-1" aria-label="Fuel for Discovery">
      <link rel="stylesheet" href="${stylesheet}">
      <header><div><p class="c17-eyebrow">EXPEDITION LOGISTICS</p><h3>Fuel for Discovery</h3></div><button type="button" data-action="finish">End voyage · Enter</button></header>
      <p>Chart new water, rendezvous for fuel, and spend your earnings on the next discovery. You have ${LIMIT} watches. Fuel exhaustion brings a rescue back south and costs 50 credits.</p>
      <div class="c17-meters" data-meters></div>
      <div class="c17-layout"><div><div class="c17-board" data-board role="group" aria-label="Expedition route board, north at top"></div>
      <p class="c17-legend">▲ You · ◆ Supply ship · ⚓ Fuel depot · · Surveyed<br>Route board: north ↑ · blue = open water (1 fuel), pale = pack (2 fuel). Each action advances one watch; supply ship moves every two watches.</p></div>
      <aside><p role="status" aria-live="polite" data-status></p>
      <div class="c17-pad" aria-label="Helm"><button type="button" data-action="north" aria-label="Sail north">↑</button><button type="button" data-action="west" aria-label="Sail west">←</button><button type="button" data-action="south" aria-label="Sail south">↓</button><button type="button" data-action="east" aria-label="Sail east">→</button></div>
      <div class="c17-actions">
      <button type="button" data-action="survey">Survey · Space <small>New cell: +35 credits; northern rows: +50</small></button>
      <button type="button" data-action="refuel">Refuel · F <small>At depot / beside supply ship: 20 credits</small></button>
      <button type="button" data-action="wait">Wait · R <small>Hold position for the supply ship</small></button>
      <button type="button" data-action="upgrade">Efficient propulsion · U <small>60 credits · pack passage costs 1 fuel</small></button>
      <button type="button" data-action="heli">Hire helicopter · H <small>40 credits · survey 3 new cells, radius 3</small></button>
      <button type="button" data-action="zodiac">Hire Zodiac · Z <small>20 credits · survey 2 new open-water cells, radius 1</small></button>
      <button type="button" data-action="auv">Hire AUV · V <small>35 credits · survey 3 new cells in your column, radius 2</small></button>
      </div><p class="c17-legend">Arrows / WASD sail. Survey anywhere new. Sampling and vehicle operations use 1 ship fuel. Hiring pays for one sortie. Invalid actions cost nothing.</p></aside></div>
      <div class="c17-result" data-result hidden></div>
    </section>`;
    const panel = root.querySelector('.c17');
    const find = s => panel.querySelector(s);
    const key = (x, y) => `${x},${y}`;
    const pack = (x, y) => y < 3 && (x + y) % 4 !== 0;
    const tanker = () => { const phase = Math.floor(state.turn / 2) % 16; return [phase <= 8 ? phase : 16 - phase, 4]; };
    const atDepot = () => (state.x === 4 && state.y === 8) || (state.x === 8 && state.y === 0);
    const canRefuel = () => { const [x, y] = tanker(); return atDepot() || Math.abs(x - state.x) + Math.abs(y - state.y) <= 1; };
    const say = message => { find('[data-status]').textContent = message; };
    const score = () => Math.max(0, state.credits - 60);
    function reset() {
      state = { x: 4, y: 8, fuel: 20, credits: 60, turn: 0, surveyed: new Set(), trail: new Set(['4,8']), upgraded: false, rescues: 0, sorties: 0, done: false };
      find('[data-result]').hidden = true;
      say('South depot. Your 60-credit supply grant funds this voyage; only earnings above that grant become expedition points. Survey a new cell, then follow the supply ship north.');
      render();
      panel.focus();
    }
    function render() {
      find('[data-meters]').textContent = `Fuel ${state.fuel}/20 · Credits ${state.credits} · Watch ${state.turn}/${LIMIT} · Cells ${state.surveyed.size} · Net points ${score()}`;
      const [tx, ty] = tanker();
      find('[data-board]').innerHTML = Array.from({ length: SIZE * SIZE }, (_, i) => {
        const x = i % SIZE, y = Math.floor(i / SIZE), here = state.x === x && state.y === y;
        const depot = (x === 4 && y === 8) || (x === 8 && y === 0);
        const ship = x === tx && y === ty;
        const sampled = state.surveyed.has(key(x, y));
        const label = `${x + 1},${SIZE - y}: ${here ? 'your ship, ' : ''}${depot ? 'fuel depot, ' : ''}${ship ? 'supply ship, ' : ''}${pack(x, y) ? 'pack' : 'open water'}${sampled ? ', surveyed' : ''}`;
        return `<span class="c17-cell ${pack(x, y) ? 'c17-pack' : ''} ${here ? 'c17-here' : ''} ${state.trail.has(key(x, y)) ? 'c17-trail' : ''}" title="${label}" aria-label="${label}" role="img">${here ? '▲' : depot ? '⚓' : ship ? '◆' : sampled ? '·' : ''}</span>`;
      }).join('');
      panel.querySelectorAll('[data-action]').forEach(button => { button.disabled = state.done; });
      find('[data-action="upgrade"]').disabled = state.done || state.upgraded;
      if (state.upgraded) find('[data-action="upgrade"]').innerHTML = 'Efficient propulsion installed';
      else find('[data-action="upgrade"]').innerHTML = 'Efficient propulsion · U <small>60 credits · pack passage costs 1 fuel</small>';
    }
    function finish() {
      state.done = true;
      render();
      const result = find('[data-result]');
      result.hidden = false;
      result.innerHTML = `<h4>Voyage ledger: ${score()} points</h4><p>${state.surveyed.size} cells charted · ${state.sorties} vehicle sorties · ${state.rescues} rescues · ${state.credits} credits left after fuel and equipment. The 60-credit grant is deducted from your award.</p><button type="button" data-bank>Bank points · Enter</button> <button type="button" data-replay>Replay · R</button>`;
      result.querySelector('[data-bank]').focus();
    }
    function tick(fuel, message) {
      state.fuel -= fuel;
      state.turn += 1;
      if (state.fuel <= 0) {
        state.x = 4; state.y = 8; state.fuel = 20;
        state.credits = Math.max(0, state.credits - 50); state.rescues += 1;
        message += ' Fuel exhausted: rescue to the south depot, −50 credits; tank replenished.';
      }
      state.trail.add(key(state.x, state.y));
      say(message);
      if (state.turn >= LIMIT) finish(); else render();
    }
    function sample(cells) {
      let gain = 0;
      for (const [x, y] of cells) { state.surveyed.add(key(x, y)); gain += y < 3 ? 50 : 35; }
      state.credits += gain;
      return gain;
    }
    function act(action) {
      if (closed || submitted || state.done) return;
      const direction = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[action];
      if (direction) {
        const x = state.x + direction[0], y = state.y + direction[1];
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return say('Edge of the route board. Choose another heading.');
        state.x = x; state.y = y;
        return tick(pack(x, y) && !state.upgraded ? 2 : 1, `Underway: column ${x + 1}, row ${SIZE - y}. ${pack(x, y) ? 'Working through pack.' : 'Open water.'}`);
      }
      if (action === 'finish') return finish();
      if (action === 'wait') return tick(0, 'Holding position; supply ship continues its east–west run on row 5.');
      if (action === 'refuel') {
        if (!canRefuel()) return say('Refuel at either anchor, or on / beside the supply ship (◆).');
        if (state.fuel === 20) return say('Tank is full.');
        if (state.credits < 20) return say('Refueling needs 20 credits. Survey new water to earn more.');
        state.credits -= 20; state.fuel = 20;
        return tick(0, 'Fuel transfer complete. −20 credits, tank full.');
      }
      if (action === 'survey') {
        if (state.surveyed.has(key(state.x, state.y))) return say('This cell is charted. Move to new water or launch a vehicle.');
        return tick(1, `Water-column station logged. +${sample([[state.x, state.y]])} credits.`);
      }
      if (action === 'upgrade') {
        if (state.upgraded) return say('Efficient propulsion is already installed.');
        if (state.credits < 60) return say('Propulsion upgrade needs 60 credits.');
        state.credits -= 60; state.upgraded = true;
        return tick(0, 'Propulsion tuned: every passage now costs 1 fuel. −60 credits.');
      }
      const gear = { heli: [40, 3, 3, 'Helicopter ice reconnaissance'], zodiac: [20, 1, 2, 'Zodiac surface transect'], auv: [35, 2, 3, 'AUV under-ice section'] }[action];
      if (!gear) return;
      if (state.credits < gear[0]) return say(`This sortie needs ${gear[0]} credits.`);
      const cells = [];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const distance = Math.abs(x - state.x) + Math.abs(y - state.y);
        if (distance > 0 && distance <= gear[1] && !state.surveyed.has(key(x, y)) && (action !== 'zodiac' || !pack(x, y)) && (action !== 'auv' || x === state.x)) cells.push([x, y]);
      }
      cells.sort((a, b) => (Math.abs(a[0] - state.x) + Math.abs(a[1] - state.y)) - (Math.abs(b[0] - state.x) + Math.abs(b[1] - state.y)) || a[1] - b[1]);
      const chosen = cells.slice(0, gear[2]);
      if (!chosen.length) return say('No new cells within this vehicle’s reach. Reposition before hiring.');
      state.credits -= gear[0]; state.sorties += 1;
      const earned = sample(chosen);
      tick(1, `${gear[3]}: ${chosen.length} cells charted, +${earned} credits; hire −${gear[0]}.`);
    }
    function bank() {
      if (closed || submitted || !state.done) return;
      submitted = true;
      panel.querySelectorAll('button').forEach(button => { button.disabled = true; });
      complete(score(), { title: 'Fuel for Discovery', cells: state.surveyed.size, watches: state.turn, credits: state.credits, rescues: state.rescues, sorties: state.sorties, efficientPropulsion: state.upgraded });
    }
    panel.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || closed || submitted) return;
      if (button.hasAttribute('data-bank')) bank();
      else if (button.hasAttribute('data-replay')) reset();
      else act(button.dataset.action);
    }, { signal: events.signal });
    window.addEventListener('keydown', event => {
      if (closed || submitted || event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = { ' ': 'survey', f: 'refuel', r: 'wait', u: 'upgrade', h: 'heli', z: 'zodiac', v: 'auv', Enter: 'finish' }[k];
      if (!moves[k] && !action) return;
      // Focused buttons retain native Space/Enter activation for keyboard users.
      if (event.target.closest('button') && (k === ' ' || k === 'Enter')) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (state.done) { if (k === 'Enter') bank(); else if (k === 'r') reset(); return; }
      if (moves[k]) { const [x, y] = moves[k]; act(x < 0 ? 'west' : x > 0 ? 'east' : y < 0 ? 'north' : 'south'); }
      else act(action);
    }, { signal: events.signal });
    reset();
    return () => { closed = true; events.abort(); panel.remove(); };
  },
};
