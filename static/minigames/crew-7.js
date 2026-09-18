import {
  WORLD, SHIP, ENDURANCE_S, LOW_FUEL_S, SPOT_RADIUS, SEARCH_SPEED, DECK_RADIUS, RETURN_BONUS, SWEEP_BONUS,
  createSearch, seededRandom, step, grab, grabbable, land, canLand, found, score, speed, distanceToDeck,
} from './crew-7-world.js';

const stylesheet = new URL('./crew-7.css', import.meta.url).href;
const chartData = new URL('../data/crew-7-old-ice.json', import.meta.url).href;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = radians => COMPASS[Math.round((((radians + Math.PI / 2) / (Math.PI * 2)) * 16 + 16) % 16) % 16];
const degrees = radians => `${String(Math.round((((radians + Math.PI / 2) * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°`;

// Old-ice polygons from the Canadian Ice Service snapshot, loaded once and shared between replays.
let chartPolygons = null;
async function loadChart() {
  if (chartPolygons) return chartPolygons;
  const response = await fetch(chartData);
  if (!response.ok) throw new Error(`Ice chart snapshot ${response.status}`);
  const doc = await response.json();
  const all = doc.polygons ?? [];
  // The Ice Team works the Queen Elizabeth Islands this leg; chart lines from there first.
  const local = all.filter(p => p.lat >= 74 && p.lat <= 82 && p.lon >= -105 && p.lon <= -75);
  chartPolygons = local.length >= 10 ? local : all;
  return chartPolygons;
}

export const game = {
  title: "Find Clement's stuff",
  mount(root, { complete, expedition }) {
    const position = Number.isFinite(expedition?.x) && Number.isFinite(expedition?.y) ? `search:${Math.round(expedition.x * 1000)}:${Math.round(expedition.y * 1000)}` : null;
    const seed = `${expedition?.seed ?? expedition?.id ?? position ?? 'clement'}:${expedition?.operations ?? 0}:${Date.now() % 100000}`;
    const state = createSearch(seed);
    const events = new AbortController();
    const { signal } = events;
    let active = true;
    let frame = 0;
    let last = 0;
    let rotor = 0;
    let completed = false;
    const held = { up: false, down: false, left: false, right: false };
    root.innerHTML = `
      <section class="clem-game" aria-label="Helicopter search for Clement's lost gear">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="clem-heading"><div><p class="clem-kicker">FLIGHT DECK / ICE TEAM SUPPORT</p>
          <h3>Find Clement's stuff.</h3></div><div class="clem-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="clem-instructions">Clement has left gear along the Ice Team's transects on the old floes again. Fly out, slow down over the flagged lines to spot it, hover and grab <kbd>Space</kbd>, and be back on deck before the fuel runs out. Buried items only show to a slow, low search.</p>
        <div class="clem-layout">
          <div class="clem-map">
            <canvas class="clem-canvas" width="1000" height="700" role="img" aria-label="Chart of the pack: the Amundsen at the bottom, old floes with flagged transects above, and the helicopter."></canvas>
            <div class="clem-hud" aria-hidden="true"><span data-hud-speed></span><span data-hud-wind></span><span data-hud-fuel></span></div>
          </div>
          <div class="clem-panel">
            <div class="clem-fuel"><div class="clem-fuel-heading"><span>Fuel</span><strong data-fuel></strong></div><div class="clem-fuel-bar" role="meter" aria-label="Fuel remaining, seconds of flight" aria-valuemin="0" aria-valuemax="${ENDURANCE_S}"><div></div></div></div>
            <div class="clem-controls" role="group" aria-label="Flight controls">
              <button type="button" data-hold="up" aria-label="Nose down, forward (up arrow or W)">▲</button>
              <button type="button" data-hold="left" aria-label="Yaw left (left arrow or A)">◀</button>
              <button type="button" class="clem-action" data-action aria-keyshortcuts="Space">Take off</button>
              <button type="button" data-hold="right" aria-label="Yaw right (right arrow or D)">▶</button>
              <button type="button" data-hold="down" aria-label="Flare, slow down (down arrow or S)">▼</button>
            </div>
            <div class="clem-floe" data-floe><p class="clem-floe-empty">Cross a floe to read its chart line.</p></div>
            <div class="clem-list-heading"><h4>Clement's list</h4><span data-count></span></div>
            <ul class="clem-items" data-items></ul>
            <p class="clem-reward">Points per item as listed · +${RETURN_BONUS} for landing back on deck · +${SWEEP_BONUS} for a clean sweep</p>
          </div>
        </div>
        <div class="clem-footer"><p role="status" aria-live="polite" data-status>Rotors turning on the flight deck. Push forward to lift off.</p><button type="button" class="clem-finish" data-finish disabled>Land on deck</button></div>
      </section>`;
    const gameEl = root.querySelector('.clem-game');
    const find = selector => gameEl.querySelector(selector);
    const canvas = find('.clem-canvas');
    const ctx = canvas.getContext('2d');
    const status = find('[data-status]');
    const actionButton = find('[data-action]');
    const finishButton = find('[data-finish]');
    const floeCard = find('[data-floe]');
    const list = find('[data-items]');
    const dialog = root.closest('dialog');
    const scenery = seededRandom(`${seed}:scenery`);
    // Leads of open water through the first-year pack, purely scenery: the helicopter flies over everything.
    const leads = Array.from({ length: 4 }, () => {
      const x0 = scenery() * WORLD.width, y0 = scenery() * (WORLD.height - 200);
      const angle = scenery() * Math.PI;
      return { x0, y0, x1: x0 + Math.cos(angle) * 500, y1: y0 + Math.sin(angle) * 500, cx: x0 + (scenery() - 0.5) * 300, cy: y0 + (scenery() - 0.5) * 300, width: 6 + scenery() * 14 };
    });
    const hummocks = state.floes.map(floe => Array.from({ length: 7 }, () => {
      const a = scenery() * Math.PI * 2, d = scenery() * floe.radius * 0.7;
      return { x: floe.x + Math.cos(a) * d, y: floe.y + Math.sin(a) * d, a: scenery() * Math.PI, l: 8 + scenery() * floe.radius * 0.25 };
    }));
    let chartReady = false;
    loadChart().then(polygons => {
      if (!active || !polygons.length) return;
      const pick = seededRandom(`${seed}:chart`);
      state.floes.forEach(floe => { floe.chart = polygons[Math.floor(pick() * polygons.length)]; });
      chartReady = true;
      renderPanel();
    }).catch(error => console.warn('Ice chart snapshot unavailable; floes carry no egg code.', error));

    function fit() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.width * WORLD.height / WORLD.width * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', fit, { signal });

    function nearestFloe() {
      const heli = state.heli;
      let best = null;
      for (const floe of state.floes) {
        const d = Math.hypot(floe.x - heli.x, floe.y - heli.y);
        if (d <= floe.radius + 20 && (!best || d < best.d)) best = { floe, d };
      }
      return best?.floe ?? null;
    }

    function drawFloe(floe, index) {
      ctx.beginPath();
      floe.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = state.floesVisited.has(floe.id) ? '#f7fbfc' : '#eef5f7';
      ctx.fill();
      ctx.strokeStyle = '#8fb3bd';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#9ed0e6';
      floe.ponds.forEach(p => { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.4, p.r, 0.4, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = '#c3d9df';
      ctx.lineWidth = 2;
      hummocks[index].forEach(h => { ctx.beginPath(); ctx.moveTo(h.x - Math.cos(h.a) * h.l, h.y - Math.sin(h.a) * h.l); ctx.quadraticCurveTo(h.x, h.y - 6, h.x + Math.cos(h.a) * h.l, h.y + Math.sin(h.a) * h.l); ctx.stroke(); });
      ctx.restore();
      // The Ice Team's transect: flagged at both ends, pickets every 5 m in between.
      const dx = Math.cos(floe.bearing), dy = Math.sin(floe.bearing);
      const half = floe.radius * 0.62;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(floe.x - dx * half, floe.y - dy * half);
      ctx.lineTo(floe.x + dx * half, floe.y + dy * half);
      ctx.stroke();
      ctx.setLineDash([]);
      [-1, 1].forEach(sign => {
        const fx = floe.x + dx * half * sign, fy = floe.y + dy * half * sign;
        ctx.strokeStyle = '#7a3410';
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 12); ctx.stroke();
        ctx.fillStyle = '#e04a1a';
        ctx.beginPath(); ctx.moveTo(fx, fy - 12); ctx.lineTo(fx + 8, fy - 9); ctx.lineTo(fx, fy - 6); ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = '#2f5a66';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Floe ${floe.id}`, floe.x, floe.y - floe.radius * 0.75);
      const listed = floe.items.filter(i => !i.found).length;
      if (listed) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = '#5e7f89';
        ctx.fillText(`${listed} on the list`, floe.x, floe.y - floe.radius * 0.75 + 14);
      }
    }

    function drawItem(item) {
      if (item.found) {
        ctx.strokeStyle = '#4b8a5c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(item.x - 5, item.y); ctx.lineTo(item.x - 1, item.y + 4); ctx.lineTo(item.x + 6, item.y - 5); ctx.stroke();
        return;
      }
      if (!item.spotted) return;
      ctx.fillStyle = item.colour;
      ctx.beginPath(); ctx.arc(item.x, item.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.code, item.x, item.y + 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#173b43';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(item.name, item.x, item.y - 11);
    }

    function drawShip() {
      ctx.save();
      ctx.translate(SHIP.x, SHIP.y);
      ctx.rotate(SHIP.heading);
      ctx.fillStyle = '#ca5342';
      ctx.beginPath();
      ctx.moveTo(52, 0); ctx.lineTo(30, -12); ctx.lineTo(-48, -12); ctx.lineTo(-52, 0); ctx.lineTo(-48, 12); ctx.lineTo(30, 12); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f6f4e6';
      ctx.fillRect(-10, -8, 30, 16);
      ctx.fillStyle = '#2b5660';
      ctx.fillRect(12, -3, 5, 6);
      ctx.fillStyle = '#5a6d72';
      ctx.beginPath(); ctx.arc(-32, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-32, 0, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.rotate(-SHIP.heading);
      ctx.fillText('H', -0.5, -32);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
      if (state.heli.airborne && !state.finished) {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = canLand(state) ? '#2f9e5a' : '#7f9aa1';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(SHIP.x, SHIP.y, DECK_RADIUS, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function drawHelicopter() {
      const heli = state.heli;
      const slow = speed(heli) <= SEARCH_SPEED;
      if (heli.airborne && !state.finished) {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = slow ? '#2f6f8f' : '#9db7c1';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(heli.x, heli.y, SPOT_RADIUS, 0, Math.PI * 2); ctx.stroke();
        if (slow) { ctx.beginPath(); ctx.arc(heli.x, heli.y, SPOT_RADIUS * 0.6, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(heli.x, heli.y);
      if (heli.airborne) { ctx.shadowColor = '#0b2c3a66'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 8; }
      ctx.rotate(heli.heading);
      ctx.fillStyle = '#e9b13d';
      ctx.beginPath(); ctx.ellipse(2, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c4901f';
      ctx.fillRect(-24, -1.5, 16, 3);
      ctx.fillRect(-25, -6, 3, 12);
      ctx.fillStyle = '#213640';
      ctx.beginPath(); ctx.ellipse(7, 0, 4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.rotate(rotor);
      ctx.strokeStyle = '#1f2a2e99';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.moveTo(0, -17); ctx.lineTo(0, 17);
      ctx.stroke();
      ctx.restore();
    }

    function drawWind() {
      const { wind } = state;
      ctx.save();
      ctx.translate(WORLD.width - 46, 46);
      ctx.fillStyle = '#ffffffcc';
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(wind.from + Math.PI);
      ctx.strokeStyle = '#2f5a66';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.moveTo(6, -7); ctx.lineTo(14, 0); ctx.lineTo(6, 7); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#2f5a66';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WIND', WORLD.width - 46, 84);
      ctx.fillStyle = '#6a5d42';
      ctx.font = '11px Georgia, serif';
      ctx.fillText('N', 30, 24);
      ctx.strokeStyle = '#6a5d42';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(30, 30); ctx.lineTo(30, 54); ctx.moveTo(24, 38); ctx.lineTo(30, 30); ctx.lineTo(36, 38); ctx.stroke();
    }

    function draw() {
      const scale = canvas.width / WORLD.width;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#d9e6e8';
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.lineCap = 'round';
      leads.forEach(lead => {
        ctx.strokeStyle = '#1d596e';
        ctx.lineWidth = lead.width;
        ctx.beginPath(); ctx.moveTo(lead.x0, lead.y0); ctx.quadraticCurveTo(lead.cx, lead.cy, lead.x1, lead.y1); ctx.stroke();
      });
      // The ship sits in the lead it broke on the way in.
      ctx.strokeStyle = '#1d596e';
      ctx.lineWidth = 34;
      ctx.beginPath(); ctx.moveTo(SHIP.x, WORLD.height + 20); ctx.lineTo(SHIP.x, SHIP.y - 70); ctx.stroke();
      ctx.lineCap = 'butt';
      state.floes.forEach(drawFloe);
      state.items.forEach(drawItem);
      drawShip();
      drawHelicopter();
      drawWind();
    }

    function renderList() {
      const total = state.items.length;
      const recovered = found(state).length;
      find('[data-count]').textContent = `${recovered} / ${total} recovered`;
      // The list is in the order the gear was logged missing; positions stay unknown until spotted.
      list.innerHTML = state.items.map(item => `<li class="${item.found ? 'clem-found' : item.spotted ? 'clem-spotted' : ''}"><span class="clem-swatch" style="--clem-colour:${item.colour}">${item.code}</span><span class="clem-item-name">${item.name}</span><span class="clem-item-where">${item.found ? 'aboard' : item.spotted ? `floe ${item.floe}` : '?'}</span><strong>${item.points}</strong></li>`).join('');
    }

    function renderFloe() {
      const floe = nearestFloe();
      if (!floe) { floeCard.innerHTML = '<p class="clem-floe-empty">Cross a floe to read its chart line.</p>'; return; }
      const chart = floe.chart;
      const listed = floe.items.filter(i => !i.found).length;
      const partials = chart ? chart.partials.map(p => `${p.stage}${p.tenths !== '–' ? ` ${p.tenths}/10` : ''} · ${p.form}`).join('<br>') : chartReady ? '' : 'Chart line loading…';
      floeCard.innerHTML = `<div class="clem-floe-title"><strong>Floe ${floe.id}</strong><span>${listed ? `${listed} item${listed === 1 ? '' : 's'} on the list` : 'cleared'}</span></div>
        ${chart ? `<p class="clem-egg"><span>${chart.ct} total</span><code>${chart.egg}</code></p><p class="clem-partials">${partials}</p><p class="clem-source">CIS ${chart.region} chart, ${chart.date} · polygon near ${chart.lat}°N ${Math.abs(chart.lon)}°W</p>` : `<p class="clem-partials">${partials}</p>`}`;
    }

    function renderPanel() {
      const heli = state.heli;
      find('[data-score]').textContent = score(state);
      find('[data-fuel]').textContent = `${Math.ceil(heli.fuel)} s`;
      const bar = find('.clem-fuel-bar');
      bar.setAttribute('aria-valuenow', Math.ceil(heli.fuel));
      bar.firstElementChild.style.width = `${heli.fuel / ENDURANCE_S * 100}%`;
      bar.classList.toggle('clem-low', heli.fuel <= LOW_FUEL_S && !state.finished);
      find('[data-hud-speed]').textContent = `${Math.round(speed(heli))} kn · hdg ${degrees(heli.heading)}`;
      find('[data-hud-wind]').textContent = `wind from ${compass(state.wind.from)}`;
      find('[data-hud-fuel]').textContent = `fuel ${Math.ceil(heli.fuel)} s`;
      const target = grabbable(state);
      if (state.finished) { actionButton.textContent = state.outcome === 'landed' ? 'On deck ✓' : 'Ditched'; actionButton.disabled = true; }
      else if (!heli.airborne) { actionButton.textContent = 'Take off'; actionButton.disabled = false; }
      else if (target) { actionButton.textContent = `Grab ${target.name.toLowerCase()}`; actionButton.disabled = false; }
      else if (canLand(state)) { actionButton.textContent = 'Land on deck'; actionButton.disabled = false; }
      else { actionButton.textContent = speed(heli) > SEARCH_SPEED ? 'Slow down to search' : 'Hover over gear'; actionButton.disabled = true; }
      actionButton.classList.toggle('clem-ready', Boolean(target) || canLand(state));
      finishButton.disabled = !canLand(state);
      finishButton.textContent = state.finished ? (state.outcome === 'landed' ? 'Search logged ✓' : 'Search over') : `Land on deck${found(state).length ? ` · ${score(state) + RETURN_BONUS + (found(state).length === state.items.length ? SWEEP_BONUS : 0)} pts` : ''}`;
      renderFloe();
      renderList();
    }

    function announce(text) { status.textContent = text; }

    function act() {
      if (!active || state.finished) return;
      if (!state.heli.airborne) {
        step(state, { throttle: 0.01, yaw: 0 }, 0.001);
        announce('Airborne. The wind sets you sideways; keep an eye on the deck.');
        return;
      }
      const item = grab(state);
      if (item) {
        const left = state.items.length - found(state).length;
        announce(left ? `${item.name} aboard, +${item.points}. ${left} still on the list.` : `${item.name} aboard, +${item.points}. That is everything. Bring it home.`);
        renderPanel();
        return;
      }
      const result = land(state);
      if (result) { settle(result); return; }
      announce(speed(state.heli) > SEARCH_SPEED ? 'Too fast to pick anything up. Flare and hover over the item.' : 'Nothing under the skids. Spotted gear shows on the chart once you fly near it slowly.');
    }

    function settle(result) {
      renderPanel();
      const missing = result.detail.missing.length;
      announce(state.outcome === 'landed'
        ? `Landed on deck with ${result.detail.items.length} of ${state.items.length} items · ${result.points} points.${missing ? ` Clement still needs ${missing}.` : ' Clean sweep.'}`
        : `Fuel exhausted over the ice. Autorotation onto the floe; ${result.detail.items.length} items aboard for ${result.points} points. The Zodiac will fetch you.`);
      if (!completed) { completed = true; complete(result.points, result.detail); }
    }

    let warnedFuel = false;
    function loop(now) {
      if (!active) return;
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      if (!state.finished && !(dialog && !dialog.open)) {
        const throttle = (held.up ? 1 : 0) - (held.down ? 1 : 0);
        const yaw = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        const before = state.events.length;
        step(state, { throttle, yaw }, dt);
        for (const event of state.events.slice(before)) {
          if (event.kind === 'takeoff') announce('Airborne. The wind sets you sideways; keep an eye on the deck.');
          if (event.kind === 'spotted') { const item = state.items.find(i => i.id === event.item); announce(`${item.name} spotted on floe ${item.floe}${item.buried ? ', half under the snow' : ''}. Hover and grab it.`); }
        }
        if (!warnedFuel && state.heli.fuel <= LOW_FUEL_S && state.heli.airborne) {
          warnedFuel = true;
          announce(`Low fuel: ${LOW_FUEL_S} seconds left. The deck bears ${compass(Math.atan2(SHIP.y - state.heli.y, SHIP.x - state.heli.x))}${distanceToDeck(state.heli) > 400 ? ', a long way off' : ''}.`);
        }
        if (state.finished) settle(state.result);
      }
      rotor += dt * (state.heli.airborne ? 24 : 6);
      draw();
      renderPanel();
    }

    gameEl.querySelectorAll('[data-hold]').forEach(button => {
      const key = button.dataset.hold;
      const press = event => { event.preventDefault(); held[key] = true; button.classList.add('clem-held'); try { button.setPointerCapture(event.pointerId); } catch {} };
      const release = () => { held[key] = false; button.classList.remove('clem-held'); };
      button.addEventListener('pointerdown', press, { signal });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, release, { signal }));
      button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); held[key] = true; button.classList.add('clem-held'); } }, { signal });
      button.addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') release(); }, { signal });
      button.addEventListener('blur', release, { signal });
    });
    actionButton.addEventListener('click', act, { signal });
    finishButton.addEventListener('click', () => { const result = land(state); if (result) settle(result); }, { signal });
    const keyMap = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    const editing = target => target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    window.addEventListener('keydown', event => {
      if (!active || !gameEl.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
      const key = event.key.toLowerCase();
      const hold = keyMap[key];
      if (hold) { event.preventDefault(); event.stopImmediatePropagation(); held[hold] = true; return; }
      if (key === ' ' || key === 'enter') {
        if (event.target?.closest?.('button') && event.target !== actionButton) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) act();
      }
    }, { capture: true, signal });
    window.addEventListener('keyup', event => {
      const hold = keyMap[event.key.toLowerCase()];
      if (hold) held[hold] = false;
    }, { capture: true, signal });
    window.addEventListener('blur', () => Object.keys(held).forEach(k => { held[k] = false; }), { signal });
    fit();
    renderPanel();
    draw();
    frame = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      events.abort();
    };
  },
};
