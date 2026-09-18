import { COLS, ROWS, FUEL_SECONDS, KM_PER_BAND, SIGHTING_POINTS, FALSE_SIGHTING_PENALTY, FORMS, stageInfo, createGame, spawn, move, rotate, step, drop, burnFuel, speedMs, distanceKm, logSighting, falseSighting, finish } from './crew-4-ice.js';

const stylesheet = new URL('./crew-4.css', import.meta.url).href;
const chartUrl = new URL('../data/crew-4-ice-chart.json', import.meta.url).href;

// Canvas layout in logical pixels: the chart grid on the left, a strip of coast on the right.
const CELL = 32;
const FIELD_X = 12;
const FIELD_Y = 60;
const FIELD_W = COLS * CELL;
const FIELD_H = ROWS * CELL;
const W = 424;
const H = FIELD_Y + FIELD_H + 24;
const COAST_X = FIELD_X + FIELD_W + 10;
// Pixels per second the sea and shore slide past while airborne; charted bands add a jump.
const DRIFT = 6;
const LOOKS = {
  old: { fill: '#eef6fa', edge: '#a9c8d6', pond: '#63a9cf' },
  firstYear: { fill: '#dfe8ea', edge: '#a2b6bc' },
  young: { fill: '#b8c4cb', edge: '#8c9ba3' },
  new: { fill: '#5f6f7a', edge: '#3f4c55' },
};
const ANIMALS = { bear: 'Polar bear', muskox: 'Musk ox herd' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function eggSVG(ct, partials) {
  const rows = [
    partials.map(p => p.c === '–' || p.c === undefined ? '' : p.c),
    partials.map(p => p.s),
    partials.map(p => p.f ?? ''),
  ];
  const line = (values, y) => values.some(Boolean) ? `<text x="45" y="${y}" text-anchor="middle">${escape(values.join(' '))}</text>` : '';
  return `<svg viewBox="0 0 90 108" class="patrol-egg" aria-hidden="true"><ellipse cx="45" cy="54" rx="42" ry="50"/><path d="M8 34 H82 M9 60 H81 M14 82 H76"/><text x="45" y="26" text-anchor="middle" class="patrol-egg-ct">${escape(ct)}</text>${line(rows[0], 52)}${line(rows[1], 74)}${line(rows[2], 96)}</svg>`;
}

function tenthsBar(partials) {
  return `<span class="patrol-tenths" aria-hidden="true">${partials.map(p => `<i style="flex:${p.c};background:${stageInfo(p.s).chart}"></i>`).join('')}</span>`;
}

export const game = {
  title: 'Ice Patrol',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let active = true;
    let chart = null;
    let state = null;
    let completed = false;
    root.innerHTML = `
      <section class="patrol-game" aria-label="Ice Patrol">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="patrol-heading"><div><p class="patrol-kicker">HELICOPTER / ICE RECONNAISSANCE</p>
          <h3>Chart the pack ahead of the ship.</h3></div><div class="patrol-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="patrol-instructions">Floes drift in under the helicopter as egg codes from the ice chart. Steer with <kbd>←</kbd><kbd>→</kbd>, turn with <kbd>↑</kbd>, drop with <kbd>Space</kbd>. Ten tenths across is a charted band, and the patrol flies on. Bears and musk ox will cross your view: press <kbd>L</kbd> while one is in sight to log it.</p>
        <div class="patrol-layout">
          <div class="patrol-cockpit">
            <div class="patrol-hud"><span data-distance>0 km</span><span data-bands>0 bands</span><span class="patrol-fuel" role="meter" aria-label="Fuel" aria-valuemin="0" aria-valuemax="${FUEL_SECONDS}" aria-valuenow="${FUEL_SECONDS}"><i data-fuel></i></span></div>
            <div class="patrol-stage">
              <canvas class="patrol-scene" width="${W}" height="${H}" aria-label="Ice field seen from the helicopter. The status line below reports what happens."></canvas>
              <div class="patrol-overlay" data-overlay><p data-overlay-text>Loading ice chart…</p><button type="button" data-start hidden>Lift off <kbd>Enter</kbd></button></div>
            </div>
            <div class="patrol-pad" role="group" aria-label="Flight controls">
              <button type="button" data-act="left" aria-label="Move left">◀</button>
              <button type="button" data-act="rotate" aria-label="Rotate">↻</button>
              <button type="button" data-act="right" aria-label="Move right">▶</button>
              <button type="button" data-act="down" aria-label="Soft drop">▼</button>
              <button type="button" data-act="drop" aria-label="Hard drop">Drop</button>
            </div>
            <button type="button" class="patrol-log" data-act="log">Log sighting <kbd>L</kbd></button>
          </div>
          <div class="patrol-notebook">
            <div class="patrol-next"><h4>Next zone</h4><div class="patrol-next-body"><div data-egg></div><p data-next-text>Waiting for the chart.</p></div></div>
            <div class="patrol-bands"><div class="patrol-bands-heading"><h4>Charted bands</h4><span data-band-count>0 / 10 tenths each</span></div><ol data-band-log></ol><p class="patrol-empty" data-bands-empty>Your first full band starts the chart.</p></div>
            <div class="patrol-sightings"><h4>Wildlife log</h4><ul data-sightings></ul><p class="patrol-empty" data-sightings-empty>Nothing logged yet. Bears cross the pack; musk ox keep to the shore.</p></div>
            <p class="patrol-reward">Band 100 · two at once 250 · bear ${SIGHTING_POINTS.bear} · musk ox ${SIGHTING_POINTS.muskox} · unconfirmed sighting −${FALSE_SIGHTING_PENALTY}</p>
            <p class="patrol-source" data-source></p>
          </div>
        </div>
        <div class="patrol-footer"><p role="status" aria-live="polite" data-status>Reading the regional ice chart.</p><button type="button" class="patrol-finish" data-finish disabled>Return to ship</button></div>
      </section>`;
    const section = root.querySelector('.patrol-game');
    const find = selector => section.querySelector(selector);
    const canvas = find('canvas');
    const ctx = canvas.getContext('2d');
    const overlay = find('[data-overlay]');
    const overlayText = find('[data-overlay-text]');
    const startButton = find('[data-start]');
    const status = find('[data-status]');
    const finishButton = find('[data-finish]');
    const dialog = root.closest('dialog');

    // Presentation state: scrolling pack, wildlife, helicopter position and row flashes.
    let running = false;
    let paused = false;
    let raf = 0;
    let last = 0;
    let gravity = 0;
    let softDrop = false;
    let scroll = 0;
    let targetScroll = 0;
    let heliX = FIELD_X + FIELD_W / 2;
    let flashes = [];
    let animals = [];
    let nextAnimal = 7;
    let clock = 0;
    const random = () => Math.random();
    const blobs = Array.from({ length: 34 }, () => ({ x: FIELD_X + random() * FIELD_W, y: random() * (H + 80), rx: 10 + random() * 26, ry: 8 + random() * 18, a: 0.05 + random() * 0.08 }));
    const tundra = Array.from({ length: 40 }, () => ({ x: COAST_X + 12 + random() * (W - COAST_X - 20), y: random() * (H + 80), r: 4 + random() * 9, g: random() > 0.5 }));

    function say(text) { status.textContent = text; }

    function fitCanvas() {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = Math.round(width * H / W);
      }
    }
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(canvas);

    function renderHud() {
      find('[data-score]').textContent = state?.points ?? 0;
      find('[data-distance]').textContent = `${state ? distanceKm(state) : 0} km`;
      find('[data-bands]').textContent = `${state?.bands.length ?? 0} band${state?.bands.length === 1 ? '' : 's'}`;
      const fuel = state?.fuel ?? FUEL_SECONDS;
      find('[data-fuel]').style.width = `${fuel / FUEL_SECONDS * 100}%`;
      find('[data-fuel]').classList.toggle('patrol-low', fuel < 30);
      find('.patrol-fuel').setAttribute('aria-valuenow', Math.round(fuel));
      find('.patrol-fuel').setAttribute('aria-valuetext', `${Math.round(fuel)} seconds of fuel`);
      finishButton.disabled = !state || !state.started || state.finished;
    }

    function renderNext() {
      if (!state) return;
      const zone = state.next.zone;
      find('[data-egg]').innerHTML = eggSVG(zone.ct, zone.partials);
      const parts = zone.partials.map(p => `${p.c === '–' ? '' : `${p.c} tenths `}${stageInfo(p.s).name.toLowerCase()} <b style="color:${stageInfo(p.s).chart}">${p.s}</b>${FORMS[p.f] ? `, ${FORMS[p.f].toLowerCase()}` : ''}`);
      find('[data-next-text]').innerHTML = `<b>${escape(zone.ct)}/10</b> · ${parts.join(' · ')}${zone.trace ? ` · trace of ${escape(zone.trace.toLowerCase())}` : ''}<br><small>${zone.distanceKm} km from the ship · ${state.next.cells.length} cell${state.next.cells.length === 1 ? '' : 's'}</small>`;
    }

    function renderBands() {
      const list = find('[data-band-log]');
      const bands = state?.bands ?? [];
      list.innerHTML = bands.slice(-6).reverse().map(band => `<li>${tenthsBar(band.partials)}<span><b>Band ${band.index}</b> · ${band.km} km · ${band.partials.map(p => `${p.c}·${escape(p.s)}`).join(' ')}</span></li>`).join('');
      find('[data-bands-empty]').hidden = bands.length > 0;
      find('[data-band-count]').textContent = bands.length ? `${bands.length} charted` : '10 tenths each';
    }

    function renderSightings() {
      const list = find('[data-sightings]');
      const sightings = state?.sightings ?? [];
      list.innerHTML = sightings.slice(-6).reverse().map(s => `<li><b>${ANIMALS[s.kind]}</b> · ${s.km} km</li>`).join('');
      find('[data-sightings-empty]').hidden = sightings.length > 0;
    }

    function showOverlay(text, button = null) {
      overlay.hidden = false;
      overlayText.innerHTML = text;
      startButton.hidden = !button;
      if (button) startButton.innerHTML = button;
    }

    // Wildlife appears once the previous animal has left; bears walk the pack, musk ox the shore.
    function spawnAnimal() {
      if (random() < 0.6) {
        const fromLeft = random() < 0.5;
        animals.push({ kind: 'bear', x: fromLeft ? FIELD_X - 30 : FIELD_X + FIELD_W + 30, y: FIELD_Y + 40 + random() * (FIELD_H - 120), vx: (fromLeft ? 1 : -1) * (20 + random() * 10), logged: false, born: clock });
        say('Polar bear on the pack. L to log it while it is in view.');
      } else {
        const members = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({ dx: (random() - 0.5) * 34, dy: (random() - 0.5) * 30 }));
        animals.push({ kind: 'muskox', x: COAST_X + 30 + random() * (W - COAST_X - 52), y: -40, vy: 9 + random() * 5, members, logged: false, born: clock });
        say('Musk ox on the shore. L to log the herd.');
      }
      nextAnimal = 10 + random() * 8;
    }

    function visibleAnimals() {
      return animals.filter(a => !a.logged && a.x > -10 && a.x < W + 10 && a.y > -10 && a.y < H + 10);
    }

    function record(animal) {
      animal.logged = true;
      const points = logSighting(state, animal.kind);
      say(`${ANIMALS[animal.kind]} logged at ${distanceKm(state)} km · +${points}.`);
      renderSightings();
      renderHud();
    }

    function log() {
      if (!running) return;
      const seen = visibleAnimals();
      if (seen.length) return record(seen[0]);
      const penalty = falseSighting(state);
      say(`Nothing in sight${penalty ? ` · −${penalty}` : ''}. Eyes on the ice.`);
      renderHud();
    }

    function settle(result) {
      if (!result.locked) return;
      if (result.cleared.length) {
        flashes.push(...result.cleared.map(y => ({ y, until: clock + 0.4 })));
        targetScroll += result.cleared.length * CELL;
        const band = result.bands[result.bands.length - 1];
        const egg = band.partials.map(p => `${p.c} tenths ${stageInfo(p.s).name.toLowerCase()}`).join(', ');
        say(`${result.cleared.length > 1 ? `${result.cleared.length} bands` : `Band ${band.index}`} charted at ${distanceKm(state)} km: ${egg}.`);
        renderBands();
      }
      if (!spawn(state)) return end('pack');
      renderNext();
      renderHud();
    }

    function act(name) {
      if (!state || state.finished) return;
      if (name === 'log') return log();
      if (!running) return;
      if (name === 'left') move(state, -1);
      else if (name === 'right') move(state, 1);
      else if (name === 'rotate') rotate(state, 1);
      else if (name === 'unrotate') rotate(state, -1);
      else if (name === 'down') { const result = step(state); if (result.locked) settle(result); else gravity = 0; }
      else if (name === 'drop') settle(drop(state));
    }

    function start() {
      if (!state || state.started) return;
      state.started = true;
      running = true;
      overlay.hidden = true;
      spawn(state);
      renderNext();
      renderHud();
      say('Airborne. Fit the floes ten tenths across to chart a band.');
      canvas.focus?.();
    }

    function togglePause() {
      if (!state?.started || state.finished) return;
      paused = !paused;
      running = !paused;
      if (paused) showOverlay('Hovering. <kbd>P</kbd> to fly on.', 'Resume <kbd>P</kbd>');
      else overlay.hidden = true;
    }

    function end(reason) {
      if (!state || state.finished) return;
      running = false;
      const result = finish(state, reason, chart);
      renderHud();
      const why = { fuel: 'Bingo fuel.', pack: 'The pack closed under you.', return: 'Returning to the ship.' }[reason];
      const bears = result.detail.sightings.polarBear;
      const ox = result.detail.sightings.muskOx;
      const summary = `${result.detail.bandsCharted} band${result.detail.bandsCharted === 1 ? '' : 's'} charted over ${result.detail.distanceKm} km, ${bears} bear${bears === 1 ? '' : 's'} and ${ox} musk ox herd${ox === 1 ? '' : 's'} logged.`;
      showOverlay(`<b>${why}</b><br>${summary}<br>${result.points} points.`);
      say(`${why} ${summary} ${result.points} points logged.`);
      finishButton.textContent = 'Patrol logged ✓';
      if (!completed) {
        completed = true;
        complete(result.points, result.detail);
      }
    }

    function update(dt) {
      clock += dt;
      targetScroll += DRIFT * dt;
      burnFuel(state, dt);
      renderHud();
      if (state.fuel <= 0) return end('fuel');
      gravity += dt * 1000 * (softDrop ? 10 : 1);
      const interval = speedMs(state);
      while (gravity >= interval && running) {
        gravity -= interval;
        settle(step(state));
      }
      nextAnimal -= dt;
      if (nextAnimal <= 0 && !animals.some(a => !a.logged)) spawnAnimal();
    }

    function animate(dt) {
      const before = scroll;
      scroll += (targetScroll - scroll) * Math.min(1, dt * 5);
      const shift = scroll - before;
      for (const a of animals) {
        a.y += shift;
        if (a.kind === 'bear') a.x += a.vx * dt;
        else a.y += a.vy * dt;
      }
      animals = animals.filter(a => a.y < H + 60 && a.x > -60 && a.x < W + 60 && (!a.logged || clock - a.born < 20));
      flashes = flashes.filter(f => f.until > clock);
      if (state?.piece) {
        const centre = FIELD_X + (state.piece.x + state.piece.width / 2) * CELL;
        heliX += (centre - heliX) * Math.min(1, dt * 6);
      }
    }

    function frame(now) {
      if (!active) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      if (running) update(dt);
      animate(dt);
      draw(now);
    }

    function cell(x, y, stage, alpha = 1) {
      const look = LOOKS[stageInfo(stage).look];
      const px = FIELD_X + x * CELL;
      const py = FIELD_Y + y * CELL;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = look.fill;
      ctx.strokeStyle = look.edge;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3, 5);
      ctx.fill();
      ctx.stroke();
      if (look.pond) {
        ctx.fillStyle = look.pond;
        const seed = ((x * 7 + y * 13) % 5) / 5;
        ctx.beginPath();
        ctx.ellipse(px + 9 + seed * 12, py + 10 + (1 - seed) * 10, 3.5, 2.5, 0, 0, Math.PI * 2);
        ctx.ellipse(px + 22 - seed * 6, py + 22, 2.5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (stageInfo(stage).look === 'firstYear') {
        ctx.strokeStyle = '#c4d2d6';
        ctx.beginPath();
        ctx.moveTo(px + 7, py + 22);
        ctx.lineTo(px + 24, py + 9);
        ctx.stroke();
      }
      ctx.fillStyle = stageInfo(stage).chart;
      ctx.fillRect(px + 6, py + CELL - 6, CELL - 12, 2.5);
      ctx.globalAlpha = 1;
    }

    function drawBear(a) {
      const dir = Math.sign(a.vx) || 1;
      const wobble = Math.sin(clock * 9) * 0.06;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.fillStyle = '#00000030';
      ctx.beginPath();
      ctx.ellipse(4, 5, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(wobble);
      ctx.fillStyle = '#f4efe1';
      ctx.strokeStyle = '#c9c0a6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dir * 15, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(dir * 19, 0, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!a.logged) label(a.x, a.y - 16, 'Polar bear');
      else tick(a.x, a.y - 16);
    }

    function drawHerd(a) {
      for (const m of a.members) {
        const x = a.x + m.dx;
        const y = a.y + m.dy;
        ctx.fillStyle = '#00000030';
        ctx.beginPath();
        ctx.ellipse(x + 3, y + 4, 11, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a3524';
        ctx.beginPath();
        ctx.ellipse(x, y, 11, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8a6a48';
        ctx.beginPath();
        ctx.ellipse(x - 1, y, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d9cfb4';
        ctx.beginPath();
        ctx.ellipse(x, y + 7, 3.5, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!a.logged) label(a.x, a.y - 24, 'Musk ox');
      else tick(a.x, a.y - 24);
    }

    function label(x, y, text) {
      ctx.font = '600 10px system-ui, sans-serif';
      const width = ctx.measureText(text).width + 12;
      const left = Math.min(W - width - 2, Math.max(2, x - width / 2));
      ctx.fillStyle = '#173f4ce6';
      ctx.beginPath();
      ctx.roundRect(left, y - 8, width, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, left + 6, y);
    }

    function tick(x, y) {
      ctx.strokeStyle = '#2f8f5b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x - 2, y + 4);
      ctx.lineTo(x + 6, y - 5);
      ctx.stroke();
    }

    function drawHelicopter(now) {
      const x = heliX;
      const y = FIELD_Y - 18 + Math.sin(clock * 2.1) * 2;
      const spin = (now / 18) % (Math.PI * 2);
      const body = () => {
        ctx.beginPath();
        ctx.roundRect(-8, -22, 16, 34, 8);
        ctx.fill();
        ctx.fillRect(-2.5, 8, 5, 30);
        ctx.fillRect(-8, 36, 16, 3);
      };
      ctx.save();
      ctx.translate(x + 14, y + 26);
      ctx.fillStyle = '#0a2a3550';
      body();
      ctx.beginPath();
      ctx.ellipse(0, -4, 34, 34, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0a2a3518';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -14); ctx.lineTo(-12, 8);
      ctx.moveTo(12, -14); ctx.lineTo(12, 8);
      ctx.stroke();
      ctx.fillStyle = '#d32f2f';
      body();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.roundRect(-6, -19, 12, 12, 5);
      ctx.fill();
      ctx.fillStyle = '#ffffff30';
      ctx.beginPath();
      ctx.arc(0, -4, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 3;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-36 * Math.cos(spin + i * Math.PI / 2), -4 - 36 * Math.sin(spin + i * Math.PI / 2));
        ctx.lineTo(36 * Math.cos(spin + i * Math.PI / 2), -4 + 36 * Math.sin(spin + i * Math.PI / 2));
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8 * Math.cos(spin * 3), 37 - 8 * Math.sin(spin * 3));
      ctx.lineTo(8 * Math.cos(spin * 3), 37 + 8 * Math.sin(spin * 3));
      ctx.stroke();
      ctx.restore();
    }

    function draw(now) {
      const scale = canvas.width / W;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#25506a';
      ctx.fillRect(0, 0, W, H);
      const tile = H + 80;
      ctx.fillStyle = '#ffffff';
      for (const b of blobs) {
        const y = ((b.y + scroll) % tile + tile) % tile - 40;
        ctx.globalAlpha = b.a;
        ctx.beginPath();
        ctx.ellipse(b.x, y, b.rx, b.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Coast: tundra on the right with a ragged shoreline that scrolls with the pack.
      ctx.beginPath();
      ctx.moveTo(W, 0);
      for (let y = 0; y <= H; y += 6) ctx.lineTo(COAST_X + 8 * Math.sin((y + scroll) / 37) + 4 * Math.sin((y + scroll) / 11), y);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = '#8b7d5e';
      ctx.fill();
      ctx.strokeStyle = '#d6cdb2';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      for (const t of tundra) {
        const y = ((t.y + scroll) % tile + tile) % tile - 40;
        ctx.fillStyle = t.g ? '#6f7d4c' : '#7a6b50';
        ctx.beginPath();
        ctx.ellipse(t.x, y, t.r, t.r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // Chart grid.
      ctx.strokeStyle = '#ffffff14';
      ctx.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(FIELD_X + x * CELL, FIELD_Y); ctx.lineTo(FIELD_X + x * CELL, FIELD_Y + FIELD_H); ctx.stroke(); }
      for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(FIELD_X, FIELD_Y + y * CELL); ctx.lineTo(FIELD_X + FIELD_W, FIELD_Y + y * CELL); ctx.stroke(); }
      ctx.strokeStyle = '#ffffff40';
      ctx.strokeRect(FIELD_X - 0.5, FIELD_Y - 0.5, FIELD_W + 1, FIELD_H + 1);
      if (state) {
        state.grid.forEach((row, y) => row.forEach((stage, x) => { if (stage) cell(x, y, stage); }));
        const piece = state.piece;
        if (piece && running) {
          let ghost = 0;
          while (!piece.cells.some(({ x, y }) => piece.y + y + ghost + 1 >= ROWS || (piece.y + y + ghost + 1 >= 0 && state.grid[piece.y + y + ghost + 1][piece.x + x]))) ghost += 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = '#ffffff70';
          for (const c of piece.cells) ctx.strokeRect(FIELD_X + (piece.x + c.x) * CELL + 3, FIELD_Y + (piece.y + c.y + ghost) * CELL + 3, CELL - 6, CELL - 6);
          ctx.setLineDash([]);
          for (const c of piece.cells) if (piece.y + c.y >= 0) cell(piece.x + c.x, piece.y + c.y, c.stage);
        }
      }
      for (const f of flashes) {
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, (f.until - clock) / 0.4) * 0.85})`;
        ctx.fillRect(FIELD_X, FIELD_Y + f.y * CELL, FIELD_W, CELL);
      }
      for (const a of animals) (a.kind === 'bear' ? drawBear : drawHerd)(a);
      if (state?.started) drawHelicopter(now);
      ctx.fillStyle = '#ffffffb0';
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('SHORE', COAST_X + 14, H - 8);
      ctx.fillText('PACK AHEAD', FIELD_X + 2, FIELD_Y - 6);
    }

    // Held touch buttons repeat like a held key.
    function holdable(button, name) {
      let timer = 0;
      const release = () => { clearInterval(timer); timer = 0; if (name === 'down') softDrop = false; };
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        act(name);
        if (name === 'down') softDrop = true;
        clearInterval(timer);
        timer = setInterval(() => act(name), 120);
      }, { signal });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, release, { signal });
      signal.addEventListener('abort', release);
    }
    section.querySelectorAll('[data-act]').forEach(button => {
      const name = button.dataset.act;
      if (name === 'left' || name === 'right' || name === 'down') holdable(button, name);
      else button.addEventListener('click', () => act(name), { signal });
    });
    startButton.addEventListener('click', () => (paused ? togglePause() : start()), { signal });
    finishButton.addEventListener('click', () => end('return'), { signal });
    canvas.addEventListener('pointerdown', event => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * W;
      const y = (event.clientY - rect.top) / rect.height * H;
      const hit = visibleAnimals().find(a => Math.hypot(a.x - x, a.y - y) < 36);
      if (hit) record(hit);
    }, { signal });
    window.addEventListener('keydown', event => {
      if (!active || !section.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const name = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'rotate', w: 'rotate', x: 'rotate', z: 'unrotate', arrowdown: 'down', s: 'down', ' ': 'drop', l: 'log', p: 'pause', enter: 'start' }[key];
      if (!name) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const repeatable = name === 'left' || name === 'right' || name === 'down';
      if (event.repeat && !repeatable) return;
      if (name === 'pause') return togglePause();
      if (name === 'start') return state?.started ? (paused ? togglePause() : undefined) : start();
      if (name === 'down') softDrop = true;
      act(name);
    }, { capture: true, signal });
    window.addEventListener('keyup', event => {
      const key = event.key.toLowerCase();
      if (key === 'arrowdown' || key === 's') softDrop = false;
    }, { capture: true, signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden && running) togglePause(); }, { signal });

    fetch(chartUrl, { signal }).then(response => {
      if (!response.ok) throw new Error(`Ice chart request failed (${response.status})`);
      return response.json();
    }).then(data => {
      if (!active) return;
      chart = data.chart;
      const seed = `${expedition?.seed ?? expedition?.id ?? ''}:${Date.now()}`;
      state = createGame(data.zones, seed);
      find('[data-source]').textContent = `Egg codes: ${chart.attribution}, ${chart.region} chart of ${chart.date} · ${data.zones.length} ice polygons, nearest first from ${Math.abs(data.origin.lat).toFixed(1)}°${data.origin.lat < 0 ? 'S' : 'N'} ${Math.abs(data.origin.lon).toFixed(1)}°${data.origin.lon < 0 ? 'W' : 'E'}`;
      renderNext();
      renderBands();
      renderSightings();
      renderHud();
      showOverlay(`${FUEL_SECONDS / 60} minutes of fuel. Each charted band is ${KM_PER_BAND} km of route for the bridge.`, 'Lift off <kbd>Enter</kbd>');
      say('Chart loaded. Lift off when ready.');
    }).catch(error => {
      if (!active || error.name === 'AbortError') return;
      showOverlay(`Ice chart unavailable: ${escape(error.message)}. Close and reopen to try again.`);
      say('The ice chart could not be read.');
    });
    raf = requestAnimationFrame(frame);
    return () => {
      active = false;
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      events.abort();
    };
  },
};
