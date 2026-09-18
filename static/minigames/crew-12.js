import { COLS, ROWS, CELL_NMI, RADAR_CELLS, SEARCH_LIMIT_S, HOURS_SINCE_FIX, RAM_S, RAM_COOLDOWN_S, BEARING_COOLDOWN_S, BEARING_ERROR_DEG, VESSEL, createGame, step, index, cellOf, stageOf, ctColour, ctBand, clock } from './crew-12-model.js';

const stylesheet = new URL('./crew-12.css', import.meta.url).href;
const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const deg = rad => `${String(Math.round(((rad * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°`;
const compass = d => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

export const game = {
  title: 'Search and Rescue',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let active = true, awarded = false, frame = 0, last = 0;
    const held = new Set();
    let ramQueued = false, bearingQueued = false;
    const state = createGame(expedition?.seed ?? `${expedition?.x ?? ''}:${expedition?.y ?? ''}:${Date.now()}:${Math.random()}`);
    const driftText = `${String(state.driftDeg).padStart(3, '0')}° (${compass(state.driftDeg)}) at ${state.driftKn.toFixed(1)} kn`;
    root.innerHTML = `
      <section class="c12-game" aria-label="Search and Rescue">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="c12-heading">
          <div><p class="c12-kicker">BRIDGE / SEARCH AND RESCUE</p><h3>Search and Rescue</h3></div>
          <div class="c12-meters">
            <div class="c12-clock"><strong data-clock>0h 00m</strong><span data-clock-label>since the call</span></div>
            <div class="c12-score"><strong data-points>0</strong><span>points</span></div>
          </div>
        </div>
        <div class="c12-signal" data-signal>
          <b>MAYDAY RELAY · MCTS IQALUIT</b> ${VESSEL}, 162 passengers, beset and taking water forward. Last AIS fix ${HOURS_SINCE_FIX} h ago at the marked position; pack drifting ${driftText}. CCGS Amundsen is the closest responder. Reach them within ${Math.round(SEARCH_LIMIT_S / 3600)} hours of the call, cut them free, then lead them to open water.
        </div>
        <div class="c12-layout">
          <div class="c12-chart-wrap">
            <canvas class="c12-chart" data-chart aria-label="Ice chart: your ship, the search datum and the pack"></canvas>
            <div class="c12-legend" aria-hidden="true">
              <span><i style="background:${ctColour(0)}"></i>&lt;1</span><span><i style="background:${ctColour(2)}"></i>1–3</span><span><i style="background:${ctColour(5)}"></i>4–6</span><span><i style="background:${ctColour(7)}"></i>7–8</span><span><i style="background:${ctColour(10)}"></i>9–10</span><span><i class="c12-legend-channel"></i>channel</span><span><i class="c12-legend-fog"></i>beyond radar</span><span class="c12-legend-scale"><i data-scale></i>1 nmi</span>
            </div>
          </div>
          <aside class="c12-panel">
            <dl class="c12-readouts">
              <div><dt>Speed</dt><dd data-speed>0.0 kn</dd></div>
              <div><dt>Heading</dt><dd data-heading>000°</dd></div>
              <div><dt>Under the hull</dt><dd data-ice>open water</dd></div>
              <div><dt>${VESSEL}</dt><dd data-cruise>no contact</dd></div>
              <div><dt>Radar</dt><dd data-radar>no targets</dd></div>
            </dl>
            <p class="c12-status" role="status" aria-live="polite" data-status>Head for the datum and let the radar do the looking. Contacts inside ${RADAR_CELLS * CELL_NMI} nmi paint as blips; you identify one by closing to ${CELL_NMI * 2} nmi.</p>
            <div class="c12-controls">
              <div class="c12-dpad" role="group" aria-label="Steer">
                <button type="button" data-dir="0,-1" aria-label="Steer north">▲</button>
                <button type="button" data-dir="-1,0" aria-label="Steer west">◀</button>
                <button type="button" data-dir="1,0" aria-label="Steer east">▶</button>
                <button type="button" data-dir="0,1" aria-label="Steer south">▼</button>
              </div>
              <div class="c12-actions">
                <button type="button" class="c12-ram" data-ram>Ram <kbd>Space</kbd><small data-ram-note>back and charge</small></button>
                <button type="button" class="c12-bearing" data-bearing>Radio bearing <kbd>B</kbd><small data-bearing-note>±${BEARING_ERROR_DEG}° on their VHF</small></button>
              </div>
            </div>
            <p class="c12-help">Arrow keys or <kbd>WASD</kbd> steer; hold two for a diagonal. Speed follows the chart: 13 kn in open water, about 3 kn breaking a metre of first-year ice, a crawl in old ice.</p>
          </aside>
        </div>
        <div class="c12-debrief" data-debrief hidden></div>
      </section>`;
    const game = root.querySelector('.c12-game');
    const find = selector => game.querySelector(selector);
    const canvas = find('[data-chart]');
    const ctx = canvas.getContext('2d');
    const status = find('[data-status]');
    const say = text => { status.textContent = text; };
    let width = 0, height = 0, cellPx = 8;

    function fit() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(200, Math.round(rect.width)), h = Math.round(w * ROWS / COLS);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (w === width && h === height && canvas.width === Math.round(w * dpr)) return;
      width = w; height = h; cellPx = w / COLS;
      find('[data-scale]').style.width = `${cellPx / CELL_NMI}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawShip(x, y, heading, length, colour, deck) {
      ctx.save();
      ctx.translate(x * cellPx, y * cellPx);
      ctx.rotate(heading);
      const L = length * cellPx, W = L * 0.34;
      ctx.beginPath();
      ctx.moveTo(0, -L / 2); ctx.lineTo(W / 2, -L / 6); ctx.lineTo(W / 2, L / 2); ctx.lineTo(-W / 2, L / 2); ctx.lineTo(-W / 2, -L / 6); ctx.closePath();
      ctx.fillStyle = colour; ctx.fill();
      ctx.lineWidth = Math.max(1, cellPx * 0.08); ctx.strokeStyle = '#122b33'; ctx.stroke();
      ctx.fillStyle = deck; ctx.fillRect(-W / 4, -L / 10, W / 2, L / 2.6);
      ctx.restore();
    }
    function drawBlip(x, y, t) {
      ctx.save();
      ctx.translate(x * cellPx, y * cellPx);
      const pulse = 0.6 + 0.4 * Math.sin(t * 5);
      ctx.strokeStyle = `rgba(112,255,140,${pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, cellPx * 0.45, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9dffb5'; ctx.beginPath(); ctx.arc(0, 0, cellPx * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function drawBerg(x, y) {
      ctx.save();
      ctx.translate(x * cellPx, y * cellPx);
      const s = cellPx * 0.55;
      ctx.beginPath(); ctx.moveTo(-s, s * 0.6); ctx.lineTo(-s * 0.35, -s * 0.7); ctx.lineTo(s * 0.2, -s * 0.2); ctx.lineTo(s, s * 0.6); ctx.closePath();
      ctx.fillStyle = '#f6fbff'; ctx.fill(); ctx.strokeStyle = '#4b6f86'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }

    function draw(now) {
      fit();
      const t = now / 1000;
      const { ship, cruise } = state;
      ctx.clearRect(0, 0, width, height);
      for (const cell of state.cells) {
        const x = cell.c * cellPx, y = cell.r * cellPx;
        if (!cell.seen) { ctx.fillStyle = '#233a45'; ctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5); continue; }
        ctx.fillStyle = ctColour(cell.ct);
        ctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5);
        if (cell.ct > 0 && cell.cm >= 160) { ctx.fillStyle = cell.cm >= 260 ? 'rgba(70,20,60,.28)' : 'rgba(80,30,20,.14)'; ctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5); }
        if (cell.channel) {
          const life = Number.isFinite(cell.closesAt) ? Math.max(0.25, Math.min(1, (cell.closesAt - state.time) / 3600)) : 1;
          ctx.fillStyle = `rgba(190,228,246,${0.55 + 0.4 * life})`;
          ctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5);
          ctx.fillStyle = 'rgba(255,255,255,.7)';
          ctx.fillRect(x + cellPx * 0.2, y + cellPx * 0.3, cellPx * 0.18, cellPx * 0.18);
          ctx.fillRect(x + cellPx * 0.6, y + cellPx * 0.6, cellPx * 0.16, cellPx * 0.16);
        }
      }
      // Grid every 2 nmi keeps distances readable.
      ctx.strokeStyle = 'rgba(20,40,50,.14)'; ctx.lineWidth = 1;
      for (let c = 0; c <= COLS; c += 4) { ctx.beginPath(); ctx.moveTo(c * cellPx, 0); ctx.lineTo(c * cellPx, height); ctx.stroke(); }
      for (let r = 0; r <= ROWS; r += 4) { ctx.beginPath(); ctx.moveTo(0, r * cellPx); ctx.lineTo(width, r * cellPx); ctx.stroke(); }
      // Radar horizon.
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(112,255,140,.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(ship.x * cellPx, ship.y * cellPx, RADAR_CELLS * cellPx, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // Datum: the last AIS fix with the drift since.
      if (state.phase === 'search') {
        ctx.save();
        const dx = state.datum.x * cellPx, dy = state.datum.y * cellPx;
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.shadowColor = '#12222a'; ctx.shadowBlur = 3;
        ctx.beginPath(); ctx.arc(dx, dy, 2.2 * cellPx, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(dx - cellPx * 0.7, dy); ctx.lineTo(dx + cellPx * 0.7, dy); ctx.moveTo(dx, dy - cellPx * 0.7); ctx.lineTo(dx, dy + cellPx * 0.7); ctx.stroke();
        const ax = Math.sin(state.driftDeg * Math.PI / 180), ay = -Math.cos(state.driftDeg * Math.PI / 180), al = 2.2 * cellPx;
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + ax * al, dy + ay * al); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx + ax * al, dy + ay * al); ctx.lineTo(dx + ax * al * 0.75 - ay * cellPx * 0.35, dy + ay * al * 0.75 + ax * cellPx * 0.35); ctx.lineTo(dx + ax * al * 0.75 + ay * cellPx * 0.35, dy + ay * al * 0.75 - ax * cellPx * 0.35); ctx.closePath(); ctx.fillStyle = '#ffd166'; ctx.fill();
        ctx.font = `600 ${Math.max(10, cellPx * 1.1)}px system-ui, sans-serif`; ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center';
        ctx.fillText(`AIS fix −${HOURS_SINCE_FIX} h`, dx, dy - 2.6 * cellPx);
        ctx.restore();
        for (const b of state.bearings) {
          ctx.save();
          ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,120,220,.85)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(b.x * cellPx, b.y * cellPx); ctx.lineTo((b.x + Math.sin(b.bearing) * 14) * cellPx, (b.y - Math.cos(b.bearing) * 14) * cellPx); ctx.stroke();
          ctx.restore();
        }
      }
      // Targets: blips inside radar range, icons once identified.
      const inRange = p => Math.hypot(p.x - ship.x, p.y - ship.y) <= RADAR_CELLS;
      for (const berg of state.bergs) { if (berg.known) drawBerg(berg.x, berg.y); else if (inRange(berg)) drawBlip(berg.x, berg.y, t); }
      if (state.phase === 'escort') {
        drawShip(cruise.x, cruise.y, cruise.path?.length ? Math.atan2(cruise.path[0].c + .5 - cruise.x, -(cruise.path[0].r + .5 - cruise.y)) : ship.heading, 2.4, '#f7f9fb', '#3d6fa8');
        if (cruise.beset) {
          ctx.save(); ctx.strokeStyle = '#c8203a'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(cruise.x * cellPx, cruise.y * cellPx, 1.3 * cellPx, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      } else if (inRange(cruise)) drawBlip(cruise.x, cruise.y, t);
      drawShip(ship.x, ship.y, ship.heading, 2, '#d8332a', '#f4efe3');
      if (state.ram > 0) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ship.x * cellPx, ship.y * cellPx, (1.1 + (RAM_S - state.ram) * 0.5) * cellPx, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      // Compass.
      ctx.save();
      ctx.font = `700 ${Math.max(11, cellPx * 1.2)}px system-ui, sans-serif`; ctx.fillStyle = '#eef6f8'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('N', width - 2 * cellPx, 1.7 * cellPx);
      ctx.strokeStyle = '#eef6f8'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(width - 2 * cellPx, 2 * cellPx); ctx.lineTo(width - 2 * cellPx, 4 * cellPx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(width - 2 * cellPx, 1.9 * cellPx); ctx.lineTo(width - 2.5 * cellPx, 2.8 * cellPx); ctx.lineTo(width - 1.5 * cellPx, 2.8 * cellPx); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function readouts() {
      const { ship, cruise } = state;
      const at = cellOf(ship), here = state.cells[index(at.c, at.r)];
      find('[data-speed]').textContent = `${ship.kn.toFixed(1)} kn`;
      find('[data-heading]').textContent = deg(ship.heading);
      find('[data-ice]').textContent = here.channel ? `own channel through ${ctBand(here.ct)}` : here.ct > 0 ? `${ctBand(here.ct)}, ${stageOf(here.cm).label} (${stageOf(here.cm).range})` : 'open water';
      const remaining = Math.max(0, SEARCH_LIMIT_S - state.searchTime);
      if (state.phase === 'search') {
        find('[data-clock]').textContent = clock(remaining);
        find('[data-clock-label]').textContent = 'left to reach them';
        find('[data-clock]').parentElement.classList.toggle('c12-late', remaining < 3600);
      } else {
        find('[data-clock]').textContent = clock(state.escortTime);
        find('[data-clock-label]').textContent = 'escort under way';
        find('[data-clock]').parentElement.classList.remove('c12-late');
      }
      const gap = Math.hypot(cruise.x - ship.x, cruise.y - ship.y) * CELL_NMI;
      find('[data-cruise]').textContent = state.phase === 'search' ? 'no contact' : cruise.beset ? `beset, ${gap.toFixed(1)} nmi off` : cruise.moving ? `following, ${gap.toFixed(1)} nmi astern` : `holding, ${gap.toFixed(1)} nmi off`;
      const targets = [...state.bergs.filter(b => !b.known), ...(state.phase === 'search' ? [cruise] : [])].filter(p => Math.hypot(p.x - ship.x, p.y - ship.y) <= RADAR_CELLS).length;
      find('[data-radar]').textContent = targets ? `${targets} unidentified target${targets > 1 ? 's' : ''}` : 'no targets';
      const ram = find('[data-ram]');
      ram.disabled = state.finished || state.ramCooldown > 0 || here.channel || here.ct <= 0;
      find('[data-ram-note]').textContent = state.ram > 0 ? 'charging' : state.ramCooldown > 0 ? `backing up, ${Math.ceil(state.ramCooldown)} s` : here.channel || here.ct <= 0 ? 'nothing to ram' : `×3 for ${RAM_S} s, then ${RAM_COOLDOWN_S} s astern`;
      const bearing = find('[data-bearing]');
      bearing.disabled = state.finished || state.phase !== 'search' || state.bearingCooldown > 0;
      find('[data-bearing-note]').textContent = state.phase !== 'search' ? 'in contact' : state.bearingCooldown > 0 ? `retuning, ${Math.ceil(state.bearingCooldown)} s` : `±${BEARING_ERROR_DEG}° on their VHF, ${BEARING_COOLDOWN_S} s to retune`;
      find('[data-points]').textContent = state.result ? state.result.points : state.phase === 'escort' ? Math.round(10 + 30 * Math.max(0, 1 - state.searchTime / SEARCH_LIMIT_S)) : 0;
    }

    function report(list) {
      for (const event of list) {
        if (event.type === 'contact') { const at = cellOf(state.cruise); say(`Contact. ${VESSEL} in sight, beset in ${ctBand(state.cells[index(at.c, at.r)].ct)}. Come alongside to cut them free, then lead them west; they can only follow a channel you have broken.`); }
        else if (event.type === 'cut') say(`${VESSEL} is free of the ice and will follow in your wake at up to 6 kn. Pressure closes a channel in close pack within a few hours, so do not run too far ahead.`);
        else if (event.type === 'beset') say(`${VESSEL} is beset again: the channel closed behind you. Go back and pass within a cable of their hull.`);
        else if (event.type === 'freed' && !list.some(e => e.type === 'cut')) say(`${VESSEL} is moving again.`);
        else if (event.type === 'bearing') say(`Radio bearing ${String(event.deg).padStart(3, '0')}° (${compass(event.deg)}), give or take ${BEARING_ERROR_DEG}°. A second bearing from somewhere else crosses it.`);
        else if (event.type === 'berg') say('Identified: an iceberg. Not them.');
        else if (event.type === 'ram') say('Backing and ramming.');
        else if (event.type === 'timeout') say(`${Math.round(SEARCH_LIMIT_S / 3600)} hours gone. The tasking passes to a helicopter out of Resolute.`);
        else if (event.type === 'delivered') say(`${VESSEL} is in open water and under her own power.`);
      }
    }

    function finishGame() {
      if (awarded || !state.result) return;
      awarded = true;
      const r = state.result;
      const debrief = find('[data-debrief]');
      debrief.hidden = false;
      debrief.innerHTML = r.found
        ? `<h4>${r.delivered ? `${VESSEL} delivered to open water` : `${VESSEL} found`}</h4>
           <ul>
             <li>Search: contact ${r.searchHours} h after the call, ${r.bearingsTaken} radio bearing${r.bearingsTaken === 1 ? '' : 's'}, ${r.bergsIdentified} iceberg${r.bergsIdentified === 1 ? '' : 's'} identified · <b>${r.searchPoints}</b> points</li>
             <li>Escort: ${r.escortHours} h in the channel, beset ${r.besets} time${r.besets === 1 ? '' : 's'} · <b>${r.escortPoints}</b> points</li>
             <li>Pack drift over the ${HOURS_SINCE_FIX} h since the fix: ${driftText}, about ${(r.driftKn * HOURS_SINCE_FIX).toFixed(1)} nmi</li>
           </ul>
           <p><b>${r.points} points.</b> Close this window to return to the bridge.</p>`
        : `<h4>Search called off</h4>
           <ul>
             <li>${Math.round(SEARCH_LIMIT_S / 3600)} h without contact; ${r.bearingsTaken} radio bearing${r.bearingsTaken === 1 ? '' : 's'}, ${r.bergsIdentified} iceberg${r.bergsIdentified === 1 ? '' : 's'} identified</li>
             <li>The pack was drifting ${driftText}: about ${(r.driftKn * HOURS_SINCE_FIX).toFixed(1)} nmi from the fix before you even left</li>
           </ul>
           <p><b>0 points.</b> Close and relaunch to take the call again.</p>`;
      complete(r.points, r);
    }

    function input() {
      let dx = 0, dy = 0;
      for (const dir of held) { const [x, y] = dir.split(',').map(Number); dx += x; dy += y; }
      const out = { dx: Math.sign(dx), dy: Math.sign(dy), ram: ramQueued, bearing: bearingQueued };
      ramQueued = false; bearingQueued = false;
      return out;
    }

    function loop(now) {
      frame = 0;
      if (!active) return;
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const list = step(state, input(), dt);
      if (list.length) report(list);
      draw(now);
      readouts();
      if (state.finished) { finishGame(); return; }
      frame = requestAnimationFrame(loop);
    }

    // Keyboard: arrows and WASD steer, Space rams, B takes a bearing.
    const isTyping = target => target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    document.addEventListener('keydown', event => {
      if (!active || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if ((key === ' ' || key === 'Enter') && event.target?.closest?.('button')) return;
      if (KEYS[key]) { held.add(KEYS[key].join(',')); event.preventDefault(); event.stopPropagation(); }
      else if (key === ' ') { ramQueued = true; event.preventDefault(); event.stopPropagation(); }
      else if (key === 'b') { bearingQueued = true; event.preventDefault(); event.stopPropagation(); }
    }, { capture: true, signal });
    document.addEventListener('keyup', event => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (KEYS[key]) held.delete(KEYS[key].join(','));
    }, { capture: true, signal });
    window.addEventListener('blur', () => held.clear(), { signal });

    for (const button of game.querySelectorAll('[data-dir]')) {
      const dir = button.dataset.dir;
      button.addEventListener('pointerdown', event => { event.preventDefault(); held.add(dir); button.setPointerCapture?.(event.pointerId); }, { signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => held.delete(dir), { signal });
      button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { held.add(dir); event.preventDefault(); event.stopPropagation(); } }, { signal });
      button.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') held.delete(dir); }, { signal });
      button.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    }
    find('[data-ram]').addEventListener('click', () => { ramQueued = true; }, { signal });
    find('[data-bearing]').addEventListener('click', () => { bearingQueued = true; }, { signal });

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fit(); draw(performance.now()); }) : null;
    observer?.observe(find('.c12-chart-wrap'));
    fit();
    draw(performance.now());
    readouts();
    frame = requestAnimationFrame(loop);

    return () => {
      active = false;
      events.abort();
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      held.clear();
    };
  },
};
