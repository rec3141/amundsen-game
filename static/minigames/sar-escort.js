import { WIDTH, HEIGHT, BREAKER_SIZE, BOW_HALF_ANGLE, RAM_REACH, createEscort, stepEscort, escortScore, escortPosition, iceDrift } from './sar-escort-model.js';

export const game = {
  title: 'SAR: Ice Escort',
  mount(root, { complete, close, expedition }) {
    const events = new AbortController(), { signal } = events;
    let state = createEscort(expedition?.sar);
    let frame, last = 0, target = null, ram = false, awarded = false;
    const keys = new Set();
    root.innerHTML = `<section class="escort">
      <link rel="stylesheet" href="${new URL('./sar-escort.css', import.meta.url).href}">
      <header><div><p class="escort-kicker">SAR / ICE ESCORT</p><h3>Bring them through.</h3></div>
      <strong data-vessel></strong></header><p data-call></p><p data-profile></p>
      <div class="escort-meters"><label>HULL <span data-health></span><meter data-hull min="0" max="1" value="1"></meter></label>
      <label>A → B <span data-distance></span><progress data-route max="65" value="0"></progress></label></div>
      <canvas data-sea tabindex="0" aria-label="Escort ice field. Steer with arrows or WASD, or drag on the chart. Space triggers a ram burst."></canvas>
      <div class="escort-bottom"><button data-start>Begin escort</button><button data-ram disabled>Ram · Space</button><button data-result hidden></button><p data-status role="status"></p></div>
      <p class="escort-help">Steer the red Amundsen with WASD / arrows, or hold and drag on the water. Your front half breaks ice: turn towards incoming floes. Space or Ram sweeps the forward half-circle every 2.6 seconds. Keep clear of the other ship and watch the current arrows. Break amber floes until they turn blue, small enough for this ship to pass safely. Ice keeps drifting after a hull impact. Get the white ship from A to B.</p>
    </section>`;
    const find = selector => root.querySelector(selector), canvas = find('[data-sea]'), ctx = canvas.getContext('2d');
    function readouts() {
      find('[data-health]').textContent = `${Math.ceil(state.health)} / ${state.maxHealth}`;
      find('[data-hull]').value = state.health / state.maxHealth;
      find('[data-route]').value = state.time;
      find('[data-distance]').textContent = `${Math.min(100, Math.floor(state.time / 65 * 100))}%`;
      find('[data-ram]').disabled = state.phase !== 'running' || state.cooldown > 0;
      find('[data-ram]').textContent = state.cooldown > 0 ? `Ram · ${state.cooldown.toFixed(1)}s` : 'Ram · Space';
    }
    function brief() {
      find('[data-profile]').textContent = `${state.vessel.iceClass} · safe floes ≤ ${state.vessel.tolerance * 2} m across`;
      find('[data-status]').textContent = '65 seconds to shelter. Ready to answer the call.';
      readouts();
    }
    find('[data-vessel]').textContent = `${state.vessel.name} · ${state.vessel.kind}`;
    find('[data-call]').textContent = `MAYDAY RELAY · ${state.vessel.trouble}.${state.vessel.lat !== null && state.vessel.lon !== null ? ` Last fix ${state.vessel.lat.toFixed(3)}°, ${state.vessel.lon.toFixed(3)}°.` : ''}${state.vessel.distanceKm !== null ? ` Amundsen is ${state.vessel.distanceKm} km off.` : ''}`;
    function start() {
      clearInput();
      state.phase = 'running'; find('[data-start]').hidden = true;
      find('[data-result]').hidden = true; find('[data-ram]').hidden = false;
      find('[data-status]').textContent = 'Pack on the move. Clear a passage through the drift!'; canvas.focus();
      readouts();
    }
    find('[data-start]').addEventListener('click', start, { signal });
    find('[data-result]').addEventListener('click', () => {
      if (state.phase === 'won') { close(); return; }
      if (state.phase !== 'lost') return;
      state = createEscort(expedition?.sar); awarded = false;
      start();
    }, { signal });
    find('[data-ram]').addEventListener('click', () => { ram = true; canvas.focus(); }, { signal });
    const controls = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '];
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase(); if (!controls.includes(key)) return;
      e.preventDefault(); keys.add(key); if (key === ' ' && !e.repeat) ram = true;
    }, { signal });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), { signal });
    function clearInput() { keys.clear(); target = null; ram = false; last = 0; }
    window.addEventListener('blur', clearInput, { signal });
    document.addEventListener('visibilitychange', clearInput, { signal });
    function point(e) {
      const rect = canvas.getBoundingClientRect();
      target = { x: (e.clientX - rect.left) / rect.width * WIDTH, y: (e.clientY - rect.top) / rect.height * HEIGHT };
    }
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); point(e); canvas.focus(); }, { signal });
    canvas.addEventListener('pointermove', e => { if (canvas.hasPointerCapture(e.pointerId)) point(e); }, { signal });
    canvas.addEventListener('pointerup', () => { target = null; }, { signal });
    canvas.addEventListener('pointercancel', clearInput, { signal });
    function ship(x, y, size, heading, colour) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(heading);
      ctx.fillStyle = colour; ctx.strokeStyle = '#071822'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(size * .35, -size * .4); ctx.lineTo(-size, -size * .4); ctx.lineTo(-size, size * .4); ctx.lineTo(size * .35, size * .4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#254859'; ctx.fillRect(-size * .55, -size * .24, size * .65, size * .48); ctx.restore();
    }
    function draw() {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(w / WIDTH, 0, 0, h / HEIGHT, 0, 0);
      ctx.fillStyle = '#0b2331'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = '#173746'; ctx.lineWidth = 1;
      for (let x = 0; x < WIDTH; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke(); }
      for (let y = 0; y < HEIGHT; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke(); }
      for (let x = 70; x < WIDTH; x += 150) for (let y = 60; y < HEIGHT; y += 130) {
        const flow = iceDrift(state, x, y);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(flow.y, flow.x));
        ctx.strokeStyle = '#376371'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.lineTo(7, -5); ctx.moveTo(14, 0); ctx.lineTo(7, 5); ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = '#558f98'; ctx.setLineDash([5, 9]); ctx.beginPath();
      for (let i = 0; i <= 100; i++) { const { x, y } = escortPosition(state.route, i / 100); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
      for (const [point, label] of [[state.route.a, 'A'], [state.route.b, 'B · SHELTER']]) {
        ctx.strokeStyle = '#78d7bc'; ctx.beginPath(); ctx.arc(point.x, point.y, 53, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#a5e9d8'; ctx.fillText(label, point.x, point.y + 75);
      }
      for (const f of state.floes) {
        const danger = f.r > state.vessel.tolerance;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.angle); ctx.beginPath();
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, r = f.r * (i % 2 ? .86 : 1); if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fillStyle = danger ? '#c8e1e6' : '#4d9fb4'; ctx.fill(); ctx.strokeStyle = danger ? '#f2b45e' : '#8ad5df'; ctx.lineWidth = danger ? 2.5 : 1; ctx.stroke();
        if (danger) { ctx.beginPath(); ctx.moveTo(-f.r * .5, 0); ctx.lineTo(0, f.r * .2); ctx.lineTo(f.r * .35, -f.r * .35); ctx.strokeStyle = '#7497a5'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.restore();
      }
      for (const p of state.particles) { ctx.globalAlpha = p.life / .45; ctx.fillStyle = '#fff'; ctx.fillRect(p.x, p.y, 4, 4); } ctx.globalAlpha = 1;
      ship(state.ship.x, state.ship.y, state.vessel.size, state.ship.heading, state.flash ? '#ff706d' : '#fff2d7');
      ctx.fillStyle = '#243d46'; ctx.fillRect(state.ship.x - 30, state.ship.y - state.vessel.size - 14, 60, 5);
      ctx.fillStyle = state.health / state.maxHealth > .3 ? '#79e0b5' : '#ff706d'; ctx.fillRect(state.ship.x - 30, state.ship.y - state.vessel.size - 14, 60 * state.health / state.maxHealth, 5);
      ship(state.breaker.x, state.breaker.y, BREAKER_SIZE, state.breaker.heading, '#f26451');
      ctx.save(); ctx.translate(state.breaker.x, state.breaker.y); ctx.rotate(state.breaker.heading);
      ctx.strokeStyle = '#fff1af'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(BREAKER_SIZE * .6, -5); ctx.lineTo(BREAKER_SIZE, 0); ctx.lineTo(BREAKER_SIZE * .6, 5); ctx.stroke();
      if (state.pulse) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, RAM_REACH * (1 - state.pulse / .4), -BOW_HALF_ANGLE, BOW_HALF_ANGLE); ctx.closePath(); ctx.stroke(); }
      ctx.restore();
      if (state.phase !== 'running') {
        ctx.fillStyle = '#08212bc9'; ctx.fillRect(180, 170, 540, 100); ctx.fillStyle = '#fff'; ctx.font = 'bold 25px system-ui';
        ctx.fillText(state.phase === 'ready' ? 'A ship. A passage. Ice everywhere.' : state.phase === 'won' ? 'SAFE IN SHELTER' : 'HULL LOST', WIDTH / 2, 215);
        ctx.font = '16px system-ui'; ctx.fillText(state.phase === 'ready' ? 'Answer the call. Bring them to shelter.' : `${state.broken} fractures · ${state.hits} damaging impacts`, WIDTH / 2, 247);
      }
    }
    function tick(now) {
      const dt = last ? (now - last) / 1000 : 0; last = now;
      if (!document.hidden) stepEscort(state, dt, { x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')), target, ram });
      ram = false;
      if (!awarded && ['won', 'lost'].includes(state.phase)) {
        awarded = true;
        clearInput();
        find('[data-status]').textContent = state.phase === 'won' ? `Rescued! ${Math.ceil(state.health)} hull remaining · ${escortScore(state)} points.` : 'The ice crushed their hull. Retry to answer the same call again.';
        find('[data-ram]').hidden = true;
        const result = find('[data-result]');
        result.textContent = state.phase === 'won' ? 'Complete' : 'Retry'; result.hidden = false; result.focus();
        if (state.phase === 'won') complete(escortScore(state), { title: 'SAR: Ice Escort', summary: `${state.vessel.name} · safe in shelter · ${state.hits} impacts`, won: true });
      }
      readouts(); draw(); frame = requestAnimationFrame(tick);
    }
    brief(); frame = requestAnimationFrame(tick);
    return () => { events.abort(); cancelAnimationFrame(frame); };
  },
};
