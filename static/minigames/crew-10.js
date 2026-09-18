import { createFlood, step, go, move, act, station, closure, atStation, available, summary, result, labClock, STATIONS, LINE_FLOW, AREA_M2 } from './crew-10-model.js';

const stylesheet = new URL('./crew-10.css', import.meta.url).href;
const seawaterUrl = new URL('../data/crew-10-seawater.json', import.meta.url).href;
const DECK_Y = 380;               // scene y of the deck
const UNITS_PER_M = 500;          // 50 cm of water fills the ruler
const BENCH_Y = 150;
const levelY = m => DECK_Y - m * UNITS_PER_M;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '–';

const ITEM_ART = {
  laptop: '<rect x="-22" y="-14" width="44" height="12" rx="2" class="flood-laptop-lid"/><rect x="-24" y="-3" width="48" height="4" rx="1" class="flood-laptop-base"/><circle cx="0" cy="-8" r="1.6" class="flood-led"/>',
  power: '<rect x="-26" y="-7" width="52" height="8" rx="2" class="flood-powerbar"/><rect x="-20" y="-5" width="6" height="4"/><rect x="-8" y="-5" width="6" height="4"/><rect x="4" y="-5" width="6" height="4"/><rect x="16" y="-5" width="6" height="4"/><path d="M26 -3 h14 v-30" class="flood-cord"/>',
  crate: '<rect x="-30" y="-36" width="60" height="36" rx="3" class="flood-crate"/><path d="M-30 -24 h60 M-22 -36 v36 M-8 -36 v36 M8 -36 v36 M22 -36 v36" class="flood-crate-lines"/><text x="0" y="-27" text-anchor="middle" class="flood-crate-label">NISKIN</text>',
  pelican: '<rect x="-24" y="-20" width="48" height="20" rx="4" class="flood-pelican"/><rect x="-10" y="-25" width="20" height="6" rx="2" class="flood-pelican"/><path d="M-16 -20 v20 M16 -20 v20" class="flood-pelican-latch"/>',
};

export const game = {
  title: 'Flood the aft lab',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    let active = true, frame = 0, last = 0, awarded = false, state = null, seawater = null, seed = 0;
    const seedBase = expedition?.seed ?? expedition?.id ?? `${expedition?.x ?? 0}:${expedition?.y ?? 0}:${expedition?.operations ?? 0}`;
    root.innerHTML = `
      <section class="flood-game" aria-label="Flood the aft lab">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="flood-heading"><div><p class="flood-kicker">AFT LAB / DAMAGE CONTROL</p>
          <h3>The seawater loop let go.</h3></div><div class="flood-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="flood-instructions">A fitting on the flow-through line has blown off and the deck is filling. Walk with <kbd>←</kbd> <kbd>→</kbd> or <kbd>1</kbd>–<kbd>7</kbd>, act with <kbd>Space</kbd>. Shut the loop valve, get what matters onto the bench, then drain the deck.</p>
        <div class="flood-layout">
          <div class="flood-scene-wrap">
            <svg class="flood-scene" viewBox="0 0 1000 440" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <defs>
                <linearGradient id="flood-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef0"/><stop offset="1" stop-color="#cdd8dc"/></linearGradient>
                <linearGradient id="flood-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8ea6" stop-opacity=".78"/><stop offset="1" stop-color="#173f52" stop-opacity=".9"/></linearGradient>
                <radialGradient id="flood-emergency" cx=".5" cy="0" r=".8"><stop offset="0" stop-color="#ff5a3c" stop-opacity=".5"/><stop offset="1" stop-color="#050b12" stop-opacity=".85"/></radialGradient>
              </defs>
              <rect x="0" y="0" width="1000" height="440" fill="url(#flood-wall)"/>
              <rect x="0" y="0" width="1000" height="24" class="flood-deckhead"/>
              <g class="flood-lamps" data-lamps>${[160, 420, 680, 900].map(x => `<rect x="${x - 40}" y="24" width="80" height="6" rx="2"/>`).join('')}</g>
              <rect x="466" y="70" width="70" height="310" rx="6" class="flood-door"/><circle cx="522" cy="230" r="4" class="flood-handle"/>
              <text x="501" y="58" text-anchor="middle" class="flood-sign">AFT LAB</text>
              <circle cx="310" cy="105" r="26" class="flood-porthole"/><circle cx="310" cy="105" r="19" class="flood-porthole-glass"/>
              <circle cx="760" cy="105" r="26" class="flood-porthole"/><circle cx="760" cy="105" r="19" class="flood-porthole-glass"/>
              <rect x="330" y="${BENCH_Y}" width="130" height="10" class="flood-bench"/><rect x="540" y="${BENCH_Y}" width="320" height="10" class="flood-bench"/>
              <path d="M340 ${BENCH_Y + 10} v40 M450 ${BENCH_Y + 10} v40 M550 ${BENCH_Y + 10} v40 M850 ${BENCH_Y + 10} v40" class="flood-bench-legs"/>
              <text x="395" y="${BENCH_Y - 6}" text-anchor="middle" class="flood-label">BENCH</text><text x="700" y="${BENCH_Y - 6}" text-anchor="middle" class="flood-label">BENCH</text>
              <g class="flood-pipe"><path d="M0 60 H60 V${DECK_Y - 60}" /><path d="M60 ${DECK_Y - 60} h46" data-fitting/><rect x="52" y="${DECK_Y - 140}" width="16" height="30" rx="2" class="flood-valve-body"/></g>
              <g data-wheel transform="translate(95 ${DECK_Y - 125})"><circle r="26" class="flood-wheel"/><path d="M-26 0 H26 M0 -26 V26 M-18 -18 L18 18 M-18 18 L18 -18" class="flood-spokes"/><circle r="5" class="flood-hub"/></g>
              <text x="95" y="${DECK_Y - 160}" text-anchor="middle" class="flood-label">LOOP VALVE</text>
              <g data-spray class="flood-spray"></g>
              <g transform="translate(235 ${DECK_Y})"><rect x="-22" y="-40" width="44" height="40" rx="4" class="flood-pump"/><rect x="-14" y="-62" width="28" height="22" rx="3" class="flood-pump-switch"/><circle cx="0" cy="-51" r="5" data-pump-lamp class="flood-lamp-off"/><path d="M22 -30 h20 v-60 h-8" class="flood-hose"/><text x="0" y="14" text-anchor="middle" class="flood-label flood-deck-label">SUMP PUMP</text></g>
              <g transform="translate(925 ${DECK_Y})"><rect x="-28" y="-4" width="56" height="8" rx="3" class="flood-grate"/><path d="M-20 -4 v8 M-10 -4 v8 M0 -4 v8 M10 -4 v8 M20 -4 v8" class="flood-grate-bars"/><g data-clog class="flood-clog"><path d="M-14 -6 l6 -8 l8 6 l6 -9 M-4 -4 l10 -6"/><rect x="-18" y="-8" width="34" height="6" rx="2"/></g><text x="0" y="14" text-anchor="middle" class="flood-label flood-deck-label">SCUPPER</text></g>
              <g data-items>${STATIONS.filter(s => s.item).map(s => `<g data-item="${s.id}" transform="translate(${s.x} ${DECK_Y})">${ITEM_ART[s.id]}</g>`).join('')}</g>
              <g data-player transform="translate(500 ${DECK_Y})"><path class="flood-legs" data-legs d="M-8 -34 L-10 0 M8 -34 L10 0"/><rect x="-13" y="-80" width="26" height="48" rx="6" class="flood-jacket"/><rect x="-13" y="-58" width="26" height="4" class="flood-stripe"/><circle cx="0" cy="-92" r="11" class="flood-head"/><rect x="-12" y="-104" width="24" height="9" rx="4" class="flood-toque"/><path class="flood-arms" data-arms d="M-13 -74 L-26 -48 M13 -74 L26 -48"/></g>
              <g data-progress class="flood-progress flood-off"><rect x="-30" y="0" width="60" height="7" rx="3" class="flood-progress-track"/><rect x="-30" y="0" width="0" height="7" rx="3" class="flood-progress-fill" data-progress-fill/></g>
              <path data-water class="flood-water" d=""/>
              <rect x="0" y="0" width="1000" height="440" data-dark class="flood-dark flood-off"/>
              <g class="flood-ruler">${[0, 10, 20, 30, 40, 50].map(cm => `<path d="M0 ${levelY(cm / 100)} h14"/><text x="18" y="${levelY(cm / 100) + 4}">${cm}</text>`).join('')}<text x="18" y="${levelY(0.5) - 12}" class="flood-ruler-unit">cm</text></g>
              <rect x="0" y="${DECK_Y}" width="1000" height="60" class="flood-deck"/>
              <text x="500" y="${DECK_Y + 38}" text-anchor="middle" class="flood-deck-text">MAIN DECK · ${AREA_M2} m² OF IT</text>
            </svg>
            <div class="flood-readouts">
              <div><span>Water</span><strong data-level>0.0 cm</strong></div>
              <div><span>In</span><strong data-inflow>0 L/s</strong></div>
              <div><span>Out</span><strong data-outflow>0 L/s</strong></div>
              <div><span>Lab clock</span><strong data-clock>00:00</strong></div>
              <div class="flood-water-read"><span>Loop water</span><strong data-seawater>–</strong></div>
            </div>
          </div>
          <div class="flood-panel">
            <div class="flood-here"><span>You are at</span><strong data-here>the door</strong><em data-next></em></div>
            <div class="flood-controls" role="group" aria-label="Move and act">
              <button type="button" data-left aria-label="Walk left, left arrow">◀ <kbd>←</kbd></button>
              <button type="button" class="flood-act" data-act>Act <kbd>Space</kbd></button>
              <button type="button" data-right aria-label="Walk right, right arrow"><kbd>→</kbd> ▶</button>
            </div>
            <ol class="flood-stations" aria-label="Stations along the lab">${STATIONS.map((s, i) => `<li><button type="button" data-station="${i}"><kbd>${s.key}</kbd><b>${escape(s.name)}</b><small data-station-note="${s.id}"></small></button></li>`).join('')}</ol>
            <p class="flood-status" role="status" aria-live="polite" data-status>Loading the seawater loop…</p>
            <ul class="flood-log" data-log aria-label="Damage control log"></ul>
            <div class="flood-result flood-off" data-result></div>
            <div class="flood-footer"><button type="button" data-restart>Run it again <kbd>R</kbd></button><span class="flood-reward">40 valve · 30 laptop · 40 samples · 15 power · 25 drained · 25 under 10 cm</span></div>
          </div>
        </div>
      </section>`;
    const gameEl = root.querySelector('.flood-game');
    const find = selector => gameEl.querySelector(selector);
    const dialog = root.closest('dialog');
    const status = find('[data-status]');
    const log = find('[data-log]');
    const stationButtons = [...gameEl.querySelectorAll('[data-station]')];
    const actButton = find('[data-act]');
    const items = Object.fromEntries(STATIONS.filter(s => s.item).map(s => [s.id, find(`[data-item="${s.id}"]`)]));
    let stride = 0, logged = 0;

    function waterPath(level, t) {
      if (level <= 0) return '';
      const y = levelY(level);
      const amp = Math.min(4, 1 + state.inflow * 60);
      let d = `M0 ${DECK_Y} L0 ${y}`;
      for (let x = 0; x <= 1000; x += 50) d += ` L${x} ${(y + Math.sin(x / 80 + t * 4) * amp).toFixed(1)}`;
      return `${d} L1000 ${DECK_Y} Z`;
    }

    function renderScene() {
      const player = state.player;
      const level = state.level;
      find('[data-water]').setAttribute('d', waterPath(level, state.t));
      // The handwheel turns a quarter turn per press-worth of work; spray shortens as the gate closes.
      const c = closure(state);
      find('[data-wheel]').setAttribute('transform', `translate(95 ${DECK_Y - 125}) rotate(${(c * station(state, 'valve').turns * 90).toFixed(0)})`);
      const spray = find('[data-spray]');
      const strength = state.inflow / LINE_FLOW;
      spray.replaceChildren();
      if (strength > 0) {
        for (let i = 0; i < 7; i++) {
          const phase = (state.t * 9 + i * 0.9) % 1;
          const reach = 40 + strength * 220;
          const x = 106 + phase * reach;
          const y = DECK_Y - 60 + phase * phase * (DECK_Y - 60 - levelY(level)) - Math.sin(phase * Math.PI) * 30 * strength;
          const drop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          drop.setAttribute('cx', x.toFixed(1)); drop.setAttribute('cy', Math.min(y, DECK_Y - 2).toFixed(1)); drop.setAttribute('r', (2 + strength * 3).toFixed(1));
          spray.append(drop);
        }
        const jet = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        jet.setAttribute('d', `M106 ${DECK_Y - 60} q${60 * strength + 20} ${10} ${80 * strength + 30} ${(DECK_Y - 60 - levelY(level)) * 0.6 + 10}`);
        jet.setAttribute('class', 'flood-jet');
        jet.style.strokeWidth = `${3 + strength * 8}`;
        spray.append(jet);
      }
      find('[data-pump-lamp]').setAttribute('class', station(state, 'pump').done ? 'flood-lamp-on' : 'flood-lamp-off');
      find('[data-clog]').classList.toggle('flood-off', station(state, 'scupper').done);
      find('[data-dark]').classList.toggle('flood-off', state.lights);
      find('[data-lamps]').classList.toggle('flood-lamps-off', !state.lights);
      for (const s of state.stations) {
        if (!s.item) continue;
        const node = items[s.id];
        let x = s.x, y = DECK_Y, rot = 0;
        if (s.place === 'bench') y = BENCH_Y;
        else if (s.place === 'lost' && s.lost === 'tipped') { x = s.x + s.drift; y = levelY(level) + 8; rot = 78; }
        else if (s.place === 'lost') y = DECK_Y;
        else if (level >= s.draft) { x = s.x + s.drift; y = levelY(level) + s.draft * UNITS_PER_M * 0.9; rot = Math.sin(s.afloat * 2.1) * 8; }
        node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`);
        node.classList.toggle('flood-lost', s.place === 'lost');
        node.classList.toggle('flood-wet', s.place !== 'bench' && level > 0.005);
      }
      const walking = player.target && !atStation(state, station(state, player.target));
      if (walking) stride += 1;
      const swing = walking ? Math.sin(stride * 0.45) * 9 : 0;
      find('[data-legs]').setAttribute('d', `M-8 -34 L${-10 - swing} 0 M8 -34 L${10 + swing} 0`);
      const working = player.working ? station(state, player.working) : null;
      find('[data-arms]').setAttribute('d', working ? `M-13 -74 L-30 -${working.id === 'valve' ? 96 : 66} M13 -74 L30 -${working.id === 'valve' ? 96 : 66}` : `M-13 -74 L${-26 + swing} -48 M13 -74 L${26 - swing} -48`);
      const bob = level > 0.2 ? -(level - 0.2) * UNITS_PER_M * 0.3 : 0;
      find('[data-player]').setAttribute('transform', `translate(${player.x.toFixed(1)} ${(DECK_Y + bob).toFixed(1)}) scale(${player.target && station(state, player.target).x < player.x ? -1 : 1} 1)`);
      const progress = find('[data-progress]');
      progress.classList.toggle('flood-off', !working);
      if (working) {
        progress.setAttribute('transform', `translate(${player.x.toFixed(1)} ${DECK_Y - 125})`);
        find('[data-progress-fill]').setAttribute('width', (60 * Math.min(1, working.progress / working.work)).toFixed(1));
      }
    }

    function note(s) {
      if (s.id === 'valve') return closure(state) >= 1 ? 'shut' : s.progress > 0 ? `${Math.floor(closure(state) * s.turns)}/${s.turns} turns` : 'open';
      if (s.id === 'pump') return s.done ? (state.level >= 0.01 ? 'pumping' : 'no prime') : 'off';
      if (s.id === 'scupper') return s.done ? 'draining' : 'clogged';
      if (s.place === 'bench') return 'on bench';
      if (s.place === 'lost') return s.lost === 'tipped' ? 'tipped' : 'flooded';
      if (state.level >= s.draft) return 'afloat';
      return s.dieAt ? `dies at ${(s.dieAt * 100).toFixed(0)} cm` : `floats at ${(s.draft * 100).toFixed(0)} cm`;
    }

    function render() {
      const player = state.player;
      const here = player.target ? station(state, player.target) : null;
      find('[data-level]').textContent = `${fmt(state.level * 100)} cm`;
      find('[data-inflow]').textContent = `${fmt(state.inflow * 1000, 0)} L/s`;
      find('[data-outflow]').textContent = `${fmt(state.outflow * 1000, 0)} L/s`;
      find('[data-clock]').textContent = labClock(state.t);
      find('[data-score]').textContent = summary(state).points;
      const arrived = here && atStation(state, here);
      find('[data-here]').textContent = here ? (arrived ? here.name : `walking to the ${here.name.toLowerCase()}`) : 'the door';
      const working = player.working ? station(state, player.working) : null;
      find('[data-next]').textContent = working ? `${working.verb}…` : here && arrived ? (available(state, here) ? here.verb : 'Nothing more to do here') : here ? (player.pending ? 'will act on arrival' : '') : '';
      actButton.disabled = Boolean(state.over) || (here && arrived && !available(state, here));
      actButton.innerHTML = state.over ? 'Run over' : working ? `Working… <kbd>Space</kbd>` : `${here && arrived ? escape(here.verb) : 'Act'} <kbd>Space</kbd>`;
      actButton.classList.toggle('flood-busy', Boolean(working));
      find('[data-left]').disabled = Boolean(state.over);
      find('[data-right]').disabled = Boolean(state.over);
      stationButtons.forEach((button, i) => {
        const s = state.stations[i];
        button.disabled = Boolean(state.over);
        button.setAttribute('aria-pressed', String(here?.id === s.id));
        button.classList.toggle('flood-done', s.done || s.place === 'bench');
        button.classList.toggle('flood-gone', s.place === 'lost');
        find(`[data-station-note="${s.id}"]`).textContent = note(s);
      });
      // The log is append-only; only new events get written.
      for (; logged < state.events.length; logged++) {
        const event = state.events[logged];
        const li = document.createElement('li');
        li.textContent = `${labClock(state.t)} ${event.text}`;
        li.className = `flood-event-${event.type}`;
        log.prepend(li);
        status.textContent = event.text;
        while (log.children.length > 6) log.lastElementChild.remove();
      }
      renderScene();
    }

    function finish() {
      const outcome = result(state);
      const s = summary(state);
      const box = find('[data-result]');
      box.classList.remove('flood-off');
      box.innerHTML = `<h4>${escape(outcome.detail.title)}</h4>
        <table><tbody>${s.lines.map(line => `<tr><th scope="row">${escape(line.label)}</th><td>${escape(line.note)}</td><td>${line.points ? `+${line.points}` : '0'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>${awarded ? 'already logged this launch' : 'logged to the chart'}</td><td>${outcome.points}</td></tr></tfoot></table>
        <p>Water in the loop: ${fmt(state.water.sst, 2)} °C at ${fmt(state.water.salinity, 2)} PSU, ${fmt(state.water.density)} kg/m³, ${fmt(state.water.sst - state.water.freezing, 2)} °C above its freezing point.</p>`;
      find('[data-restart]').focus({ preventScroll: true });
      if (!awarded) { awarded = true; complete(outcome.points, outcome.detail); }
    }

    function loop(now) {
      if (!active) return;
      frame = requestAnimationFrame(loop);
      if (!state) return;
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      if (state.over) { renderScene(); return; }
      step(state, dt);
      render();
      if (state.over) finish();
    }

    function start() {
      seed += 1;
      state = createFlood(`${seedBase}:${seed}`, seawater);
      logged = 0;
      log.replaceChildren();
      find('[data-result]').classList.add('flood-off');
      const w = state.water;
      find('[data-seawater]').textContent = `${fmt(w.sst, 2)} °C · ${fmt(w.salinity, 2)} PSU · ${fmt(w.density)} kg/m³`;
      const when = w.time ? w.time.replace('T', ' ').replace('Z', ' UTC') : '';
      find('[data-seawater]').title = w.time ? `Thermosalinograph, ${when}` : 'Typical loop water; the snapshot did not load';
      status.textContent = `${w.assumed ? 'Loop water near' : `Loop water at ${when}:`} ${fmt(w.sst, 2)} °C and ${fmt(w.salinity, 2)} PSU. The fitting is spraying at ${Math.round(LINE_FLOW * 1000)} L/s. Go.`;
      render();
    }

    async function load() {
      try {
        const response = await fetch(seawaterUrl, { signal: events.signal });
        if (!response.ok) throw new Error(`Seawater snapshot ${response.status}`);
        const data = await response.json();
        const samples = (data.samples || []).filter(x => Number.isFinite(x.sst) && Number.isFinite(x.salinity));
        if (samples.length) {
          const pick = samples[Math.floor(Math.random() * samples.length)];
          seawater = { sst: pick.sst, salinity: pick.salinity, time: pick.time, source: data.source };
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.warn('Seawater snapshot unavailable, using typical loop water', error);
      }
      if (!active) return;
      start();
    }

    function press(action) {
      if (!active || !state) return;
      action();
      render();
    }

    find('[data-left]').addEventListener('click', () => press(() => move(state, -1)), { signal: events.signal });
    find('[data-right]').addEventListener('click', () => press(() => move(state, 1)), { signal: events.signal });
    actButton.addEventListener('click', () => press(() => act(state)), { signal: events.signal });
    find('[data-restart]').addEventListener('click', () => { if (active && state) start(); }, { signal: events.signal });
    stationButtons.forEach((button, i) => button.addEventListener('click', () => press(() => go(state, i, true)), { signal: events.signal }));
    window.addEventListener('keydown', event => {
      if (!active || !gameEl.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const index = STATIONS.findIndex(s => s.key === key);
      const handled = index >= 0 || ['arrowleft', 'arrowright', 'a', 'd', ' ', 'enter', 'e', 'r'].includes(key);
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || !state) return;
      if (key === 'r') { if (state) start(); return; }
      if (index >= 0) press(() => go(state, index, true));
      else if (key === 'arrowleft' || key === 'a') press(() => move(state, -1));
      else if (key === 'arrowright' || key === 'd') press(() => move(state, 1));
      else press(() => act(state));
    }, { capture: true, signal: events.signal });
    frame = requestAnimationFrame(loop);
    load();
    return () => {
      active = false;
      events.abort();
      cancelAnimationFrame(frame);
    };
  },
};
