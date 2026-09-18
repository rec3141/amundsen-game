import { WATCH_SECONDS, FOV, POINTS, WRONG_PENALTY, HABITATS, suggestHabitat, createWatch, tick, toggleGlass, target, beginLog, cancelLog, identify, finish, poolFor, angleDiff, wrap, apparentDeg, waterElev, isUp, upFor, cuesRevealed, oclock } from './crew-14-model.js';

const stylesheet = new URL('./crew-14.css', import.meta.url).href;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad3 = n => String(wrap(Math.round(n))).padStart(3, '0');
const formatPosition = (lon, lat) => {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return '';
  const dm = (v, pos, neg) => { const a = Math.abs(v); const d = Math.floor(a); return `${d}°${((a - d) * 60).toFixed(1)}′${v >= 0 ? pos : neg}`; };
  return `${dm(lat, 'N', 'S')} ${dm(lon, 'E', 'W')}`;
};

// Palette per species for the drawn forms.
const LOOK = {
  fulmar: { up: '#8e9aa5', down: '#f4f4f0', tip: '#8e9aa5' },
  kittiwake: { up: '#a9b5bf', down: '#ffffff', tip: '#15181b' },
  glaucous: { up: '#d8dee3', down: '#ffffff', tip: '#f8f8f8' },
  ivory: { up: '#ffffff', down: '#ffffff', tip: '#ffffff' },
  ross: { up: '#c4ccd4', down: '#f3d9db', tip: '#15181b', wedge: true },
  sabine: { up: '#7d8994', down: '#ffffff', tip: '#15181b', tri: true, fork: true },
  murre: { up: '#1c1c1e', down: '#ffffff' },
  guillemot: { up: '#161616', down: '#161616', patch: '#ffffff', feet: '#d63b2c' },
  tern: { up: '#c9d1d8', down: '#ffffff', cap: '#111', bill: '#d63b2c' },
  jaeger: { up: '#4a3b2e', down: '#5a4a3b', flash: '#f0ece4' },
  phalarope: { up: '#8d97a1', down: '#ffffff' },
  eider: { up: '#f4f2ea', down: '#151515' },
  bunting: { up: '#c9b48c', down: '#ffffff', flash: '#ffffff' },
  raven: { up: '#141414', down: '#141414' },
  gyr: { up: '#8a949c', down: '#e8e9e6' },
  ringed: { body: '#4b4f52' },
  bearded: { body: '#6f665b' },
  harp: { body: '#c9cdd0', saddle: '#1a1a1a' },
  walrus: { body: '#8b5e4a', tusk: '#f6f1e2' },
  bear: { body: '#f1ead6' },
  bowhead: { body: '#1f2426', chin: '#f2f2ee' },
  minke: { body: '#3d4649', fin: true },
  orca: { body: '#101214', patch: '#ffffff', tall: true },
  beluga: { body: '#f7f7f4' },
  narwhal: { body: '#7c7a74', mottle: '#3f3d39', tusk: '#f2ecdc' },
  muskox: { body: '#3b2f28', saddle: '#c9b68e' },
  fox: { body: '#b9b2a6' },
  hare: { body: '#ffffff' },
};

export const game = {
  title: 'Wildlife observer',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let active = true;
    let frame = 0;
    let state = null;
    let awarded = false;
    let last = 0;
    let pickCursor = HABITATS.findIndex(h => h.id === suggestHabitat(expedition));
    let menuCursor = 0;
    let menuPool = [];
    const held = { left: false, right: false };
    const suggested = HABITATS[pickCursor].id;
    const iceTenths = Number(expedition?.ice?.concentration ?? expedition?.ice?.tenths);
    const readout = [formatPosition(expedition?.lon, expedition?.lat), Number.isFinite(expedition?.depth) ? `${Math.round(expedition.depth)} m` : '', Number.isFinite(iceTenths) ? (iceTenths > 0 ? `ice ${iceTenths}/10` : 'open water') : ''].filter(Boolean).join(' · ');

    root.innerHTML = `
      <section class="c14-game" aria-label="Wildlife observer">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="c14-heading">
          <div><p class="c14-kicker">BRIDGE WING / WILDLIFE WATCH</p><h3>Wildlife observer</h3></div>
          <div class="c14-meters">
            <div class="c14-meter"><strong data-clock>${WATCH_SECONDS}</strong><span>seconds</span></div>
            <div class="c14-meter c14-score"><strong data-points>0</strong><span>points</span></div>
          </div>
        </div>
        <div data-pick>
          <p class="c14-instructions">Choose where the ship holds for a ${WATCH_SECONDS}-second watch, then scan the horizon. Anything that moves is a shape until the binoculars <kbd>B</kbd> are on it and held steady; holding steady reveals field marks. Log it <kbd>Enter</kbd> and name the species. A correct name pays by rarity, ${POINTS[1]} for a fulmar up to ${POINTS[5]} for the animals a whole career can miss; a wrong name costs ${WRONG_PENALTY}.</p>
          <p class="c14-bridge">${readout ? `Ship now: ${escape(readout)}. ` : ''}Choose any lookout for this watch.</p>
          <div class="c14-lookouts" role="listbox" aria-label="Choose a lookout" data-lookouts>
            ${HABITATS.map((h, i) => `<button type="button" role="option" class="c14-lookout c14-habitat-${h.id}" data-habitat="${h.id}" aria-selected="${i === pickCursor}">
              <span class="c14-lookout-key">${i + 1}</span>
              <span class="c14-lookout-body"><b>${escape(h.name)}${h.id === suggested ? ' <em>suggested</em>' : ''}</b><i>${escape(h.where)}</i><small>${escape(h.life)}</small></span>
            </button>`).join('')}
          </div>
          <div class="c14-pick-actions"><button type="button" data-start>Start the watch <kbd>Enter</kbd></button></div>
        </div>
        <div data-watch hidden>
          <div class="c14-layout">
            <div class="c14-stage">
              <div class="c14-viewport">
                <canvas class="c14-canvas" aria-label="View from the bridge wing"></canvas>
                <div class="c14-idmenu" data-idmenu hidden role="listbox" aria-label="Name the species"></div>
              </div>
              <p class="c14-glass" data-glass aria-live="polite"></p>
              <p class="c14-status" role="status" aria-live="polite" data-status></p>
              <div class="c14-controls" role="group" aria-label="Bridge controls">
                <button type="button" data-pan="left" aria-label="Pan left">◂ <kbd>←</kbd></button>
                <button type="button" data-pan="right" aria-label="Pan right"><kbd>→</kbd> ▸</button>
                <button type="button" data-glass-btn aria-pressed="false">Binoculars <kbd>B</kbd></button>
                <button type="button" class="c14-log-btn" data-log>Log sighting <kbd>Enter</kbd></button>
                <button type="button" data-end>End watch <kbd>E</kbd></button>
              </div>
            </div>
            <aside class="c14-side" aria-label="Sighting log">
              <div class="c14-side-heading"><h4>Sighting log</h4><span data-side-note></span></div>
              <ol class="c14-log" data-log-list></ol>
            </aside>
          </div>
        </div>
        <div data-done hidden class="c14-done"></div>
      </section>`;

    const gameEl = root.querySelector('.c14-game');
    const find = selector => gameEl.querySelector(selector);
    const dialog = root.closest('dialog');
    const pickEl = find('[data-pick]');
    const watchEl = find('[data-watch]');
    const doneEl = find('[data-done]');
    const canvas = find('.c14-canvas');
    const ctx = canvas.getContext('2d');
    const status = find('[data-status]');
    const glassLine = find('[data-glass]');
    const idMenu = find('[data-idmenu]');
    const logList = find('[data-log-list]');
    const say = text => { status.textContent = text; };

    // ---------- lookout choice ----------
    function renderPick() {
      find('[data-lookouts]').querySelectorAll('.c14-lookout').forEach((button, i) => button.setAttribute('aria-selected', String(i === pickCursor)));
    }
    function start(habitatId) {
      cancelAnimationFrame(frame);
      held.left = held.right = false;
      tiltNow = -0.6;
      closeMenu();
      state = createWatch(habitatId, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
      pickEl.hidden = true;
      watchEl.hidden = false;
      doneEl.hidden = true;
      logList.innerHTML = '';
      find('[data-side-note]').textContent = state.habitat.name;
      say(`On the bridge wing, ${state.habitat.name.toLowerCase()}. Bearings are relative to the bow: 000 ahead, 090 to starboard.`);
      glassLine.textContent = '';
      fit();
      last = 0;
      renderHud();
      render();
      frame = requestAnimationFrame(loop);
    }

    // ---------- canvas ----------
    let W = 0, H = 0, dpr = 1;
    function fit() {
      const width = Math.max(280, Math.floor(canvas.parentElement.clientWidth || 640));
      const height = Math.round(Math.min(440, Math.max(210, width / 2.4)));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width !== W || height !== H) {
        W = width; H = height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.height = `${H}px`;
      }
    }

    // Projection: relative bearing and elevation (degrees) to canvas pixels. The glass narrows the field and
    // tilts a little below the horizon so a seal at 400 m is inside the circle.
    const view = { fov: FOV.eye, pxPerDeg: 1, horizon: 0, jitterB: 0, jitterE: 0, tilt: 0 };
    function setView() {
      view.fov = state.glass ? FOV.glass : FOV.eye;
      view.pxPerDeg = W / view.fov;
      view.horizon = H * 0.46;
      const t = state.t;
      view.jitterB = state.glass ? 0.22 * Math.sin(t * 1.35) + 0.08 * Math.sin(t * 4.1) : 0;
      view.jitterE = state.glass ? 0.16 * Math.sin(t * 0.9 + 1) : 0.4 * Math.sin(t * 0.7);
      view.tilt = state.glass ? tiltNow : 0;
    }
    // Where the glass points vertically: it follows the animal nearest the reticle, else settles just below
    // the horizon where the water is.
    let tiltNow = -0.6;
    function aimGlass(dt) {
      let want = -0.6;
      if (state.glass) {
        let best = null, bestDiff = FOV.glass / 2;
        for (const animal of state.animals) {
          if (animal.gone || animal.logged || !isUp(animal)) continue;
          const diff = Math.abs(angleDiff(state.view, animal.bearing));
          if (diff < bestDiff) { best = animal; bestDiff = diff; }
        }
        if (best) want = best.kind === 'fly' ? best.elev : best.kind === 'shore' ? waterElev(best.sector.dist) + skyline(best.sector, best.bearing) * (0.28 + 0.25 * best.seed) : waterElev(best.dist);
      }
      tiltNow += (want - tiltNow) * Math.min(1, dt * 6);
    }
    const project = (bearing, elev) => ({
      x: W / 2 + angleDiff(state.view + view.jitterB, bearing) * view.pxPerDeg,
      y: view.horizon - (elev - view.tilt - view.jitterE) * view.pxPerDeg,
    });

    function render() {
      setView();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawSky();
      drawSea();
      const things = [];
      for (const sector of state.habitat.land) things.push({ dist: sector.dist + 5000, draw: () => drawLand(sector) });
      for (const floe of state.floes) things.push({ dist: floe.dist, draw: () => drawFloe(floe.bearing, floe.dist, floe.width, floe.tone) });
      for (const animal of state.animals) if (!animal.gone && !animal.logged && isUp(animal)) things.push({ dist: animal.dist, draw: () => drawAnimal(animal) });
      things.sort((a, b) => b.dist - a.dist);
      for (const thing of things) thing.draw();
      if (state.glass) drawGlassMask();
      drawCompass();
    }

    function drawSky() {
      const sky = ctx.createLinearGradient(0, 0, 0, view.horizon);
      sky.addColorStop(0, '#5f7789');
      sky.addColorStop(0.7, '#9fb0bc');
      sky.addColorStop(1, '#c9d3d8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, Math.max(0, view.horizon) + 1);
    }
    function drawSea() {
      const top = view.horizon;
      const sea = ctx.createLinearGradient(0, top, 0, H);
      sea.addColorStop(0, '#7d95a2');
      sea.addColorStop(0.25, '#4f6f80');
      sea.addColorStop(1, '#2b4655');
      ctx.fillStyle = sea;
      ctx.fillRect(0, top, W, H - top);
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 1;
      for (let dist = 250; dist < 4000; dist *= 1.35) {
        const y = project(state.view, waterElev(dist) + 0.05 * Math.sin(state.t * 0.8 + dist)).y;
        if (y < top || y > H) continue;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 24) ctx.lineTo(x, y + Math.sin(x / 37 + state.t + dist) * Math.min(3, view.pxPerDeg * 0.08));
        ctx.stroke();
      }
    }
    // Land profile per sector: a repeatable rough skyline from the bearing alone.
    const skyline = (sector, bearing) => {
      const b = bearing * Math.PI / 180;
      const noise = Math.sin(b * 7.3) * 0.5 + Math.sin(b * 17.1 + 1) * 0.25 + Math.sin(b * 41 + 2) * 0.12;
      if (sector.kind === 'cliff') return 5.2 + noise * 1.6;
      if (sector.kind === 'glacier') return 1.9 + Math.abs(Math.sin(b * 60)) * 0.25 + noise * 0.15;
      return 1.3 + noise * 0.6;
    };
    function drawLand(sector) {
      const base = waterElev(sector.dist);
      const span = wrap(sector.to - sector.from) || 360;
      // Unwrapped offsets from the view centre keep the polygon contiguous even when the sector straddles the
      // bearing directly behind the observer.
      let startOff = angleDiff(state.view + view.jitterB, sector.from);
      if (startOff > view.fov / 2 && startOff + span > 360 - view.fov / 2) startOff -= 360;
      if (startOff > view.fov / 2 + 2 && startOff + span - 360 < -view.fov / 2 - 2) return;
      if (startOff + span < -view.fov / 2 - 2) return;
      const px = off => W / 2 + off * view.pxPerDeg;
      const py = elev => view.horizon - (elev - view.tilt - view.jitterE) * view.pxPerDeg;
      const points = [];
      for (let d = 0; d <= span; d += 0.5) {
        const bearing = wrap(sector.from + d);
        const edge = Math.min(d, span - d);
        const fade = Math.min(1, edge / 12);
        points.push({ x: px(startOff + d), y: py(base + skyline(sector, bearing) * (0.2 + 0.8 * fade)) });
      }
      const x0 = px(startOff), x1 = px(startOff + span), y0 = py(base);
      if (x1 < -50 || x0 > W + 50) return;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(x1, y0);
      ctx.closePath();
      ctx.fillStyle = sector.kind === 'glacier' ? '#e4ecf0' : sector.kind === 'cliff' ? '#4d4842' : '#6d6a5c';
      ctx.fill();
      if (sector.kind === 'glacier') {
        ctx.fillStyle = '#9fc3d6';
        ctx.fillRect(x0, y0 - view.pxPerDeg * 0.35, x1 - x0, view.pxPerDeg * 0.35);
      } else {
        // Snow on the ledges, scree at the foot.
        ctx.strokeStyle = sector.kind === 'cliff' ? 'rgba(240,240,236,0.35)' : 'rgba(220,214,200,0.35)';
        ctx.lineWidth = Math.max(1, view.pxPerDeg * 0.08);
        ctx.beginPath();
        for (let i = 2; i < points.length - 2; i += 3) { const p = points[i]; if (p.x < -20 || p.x > W + 20) continue; ctx.moveTo(p.x, p.y + view.pxPerDeg * 0.4); ctx.lineTo(p.x + view.pxPerDeg * 0.6, p.y + view.pxPerDeg * 0.7); }
        ctx.stroke();
      }
    }
    function drawFloe(bearing, dist, width, tone) {
      const halfDeg = Math.atan2(width / 2, dist) * 180 / Math.PI * 2.2;
      const free = Math.max(0.05, apparentDeg(1.4, dist) * 0.35);
      const base = waterElev(dist);
      const l = project(bearing - halfDeg, base), r = project(bearing + halfDeg, base), top = project(bearing, base + free);
      if (r.x < -20 || l.x > W + 20) return;
      ctx.fillStyle = `rgba(${Math.round(255 * tone)},${Math.round(252 * tone)},${Math.round(248 * tone)},0.96)`;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.x + (r.x - l.x) * 0.12, top.y);
      ctx.lineTo(l.x + (r.x - l.x) * 0.55, top.y - (top.y - l.y) * 0.25);
      ctx.lineTo(r.x - (r.x - l.x) * 0.1, top.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(120,160,180,0.45)';
      ctx.fillRect(l.x, l.y - 1, r.x - l.x, Math.max(1, (l.y - top.y) * 0.18));
    }

    // ---------- animals ----------
    function drawAnimal(animal) {
      const species = animal.species;
      const look = LOOK[species.id];
      const px = view.pxPerDeg * apparentDeg(species.size, animal.dist);
      const haze = Math.max(0.55, 1 - animal.dist / 5000);
      ctx.globalAlpha = haze;
      const members = animal.count;
      for (let m = 0; m < members; m++) {
        const spread = members > 1 ? (m - (members - 1) / 2) : 0;
        const offB = spread * (animal.kind === 'fly' ? 0.7 : 0.3) * apparentDeg(species.size, animal.dist) * (0.8 + 0.4 * Math.sin(animal.seed * 9 + m));
        const phase = animal.seed * 20 + m * 1.7;
        if (animal.kind === 'fly') drawBird(animal, look, px, offB, phase, m);
        else if (animal.kind === 'shore') drawShoreAnimal(animal, look, px, offB);
        else if (animal.kind === 'haul') drawHauled(animal, look, px, offB, m);
        else if (animal.kind === 'sit') drawSitting(animal, look, px);
        else drawSurfacing(animal, look, px, offB, phase, m);
      }
      ctx.globalAlpha = 1;
    }

    function drawBird(animal, look, px, offB, phase, m) {
      const form = animal.species.form;
      const t = state.t;
      const bounce = form === 'passerine' ? Math.abs(Math.sin(t * 2.4 + phase)) * 0.35 : Math.sin(t * animal.bob + phase) * 0.12;
      const { x, y } = project(animal.bearing + offB, animal.elev + bounce + (m ? Math.sin(phase) * 0.08 : 0));
      if (x < -px || x > W + px) return;
      const facing = Math.sign(animal.vel) || 1;
      const rate = { fulmar: 1.2, gull: 2.2, auk: 9, tern: 3.2, jaeger: 3, duck: 6, passerine: 7, raven: 2, falcon: 2.4 }[form] || 2.5;
      const amp = { fulmar: 0.12, gull: 0.55, auk: 0.8, tern: 0.7, jaeger: 0.6, duck: 0.7, passerine: 0.8, raven: 0.5, falcon: 0.45 }[form] || 0.5;
      const flap = Math.sin(t * rate * Math.PI * 2 + phase) * amp;
      const glide = form === 'fulmar' && Math.sin(t * 0.5 + phase) > -0.2;
      const lift = glide ? 0.15 : flap;
      const half = px / 2;
      const bodyLen = px * ({ auk: 0.42, duck: 0.45, fulmar: 0.36, passerine: 0.4, raven: 0.4, gull: 0.34, tern: 0.36, jaeger: 0.38, falcon: 0.38 }[form] || 0.35);
      const bodyH = bodyLen * ({ auk: 0.42, duck: 0.4, fulmar: 0.36, passerine: 0.4 }[form] || 0.3);
      const lw = Math.max(1, px * 0.05);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing, 1);
      // Wings: shoulder to wrist rises with the beat, wrist to tip falls; gulls carry a bend, fulmars none.
      const bend = { gull: 0.28, jaeger: 0.3, tern: 0.25, falcon: 0.2, raven: 0.12 }[form] ?? 0.05;
      const wingW = form === 'auk' || form === 'duck' ? half * 0.7 : half;
      const chord = px * ({ raven: 0.16, falcon: 0.14, gull: 0.12, fulmar: 0.11, auk: 0.12 }[form] || 0.09);
      for (const side of [-1, 1]) {
        const wx = side * wingW * 0.45, wy = -lift * px * 0.22 - bend * px * 0.06;
        const tx = side * wingW, ty = wy + lift * px * 0.1 + bend * px * 0.12 + (form === 'jaeger' || form === 'falcon' || form === 'tern' ? px * 0.08 : 0);
        ctx.beginPath();
        ctx.moveTo(0, -chord * 0.3);
        ctx.quadraticCurveTo(wx, wy - chord * 0.4, tx, ty);
        ctx.quadraticCurveTo(wx, wy + chord * 0.6, 0, chord * 0.5);
        ctx.closePath();
        ctx.fillStyle = look.up;
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,28,32,0.55)';
        ctx.lineWidth = Math.max(0.6, px * 0.012);
        ctx.stroke();
        if (look.tip && look.tip !== look.up) {
          ctx.beginPath();
          ctx.moveTo(wx + (tx - wx) * 0.62, wy + (ty - wy) * 0.62 - chord * 0.35);
          ctx.lineTo(tx, ty);
          ctx.lineTo(wx + (tx - wx) * 0.62, wy + (ty - wy) * 0.62 + chord * 0.4);
          ctx.closePath();
          ctx.fillStyle = look.tip;
          ctx.fill();
        }
        if (look.tri) { ctx.beginPath(); ctx.moveTo(wx * 0.3, chord * 0.4); ctx.lineTo(wx + (tx - wx) * 0.55, wy + (ty - wy) * 0.55 + chord * 0.3); ctx.lineTo(wx * 0.9, wy + chord * 0.1); ctx.closePath(); ctx.fillStyle = look.down; ctx.fill(); }
        if (look.flash) { ctx.fillStyle = look.flash; ctx.beginPath(); ctx.ellipse(wx + (tx - wx) * 0.35, wy + (ty - wy) * 0.35, chord * 0.5, chord * 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
        if (look.patch) { ctx.fillStyle = look.patch; ctx.beginPath(); ctx.ellipse(wx * 0.8, wy + chord * 0.1, wingW * 0.22, chord * 0.28, 0, 0, Math.PI * 2); ctx.fill(); }
        if (form === 'raven') { ctx.strokeStyle = look.up; ctx.lineWidth = lw; ctx.beginPath(); for (let f = 0; f < 4; f++) { ctx.moveTo(tx - side * chord * 0.2 * f, ty - chord * 0.2); ctx.lineTo(tx + side * chord * 0.6, ty + chord * (0.15 * f - 0.3)); } ctx.stroke(); }
      }
      // Body, belly, head, tail.
      ctx.beginPath();
      ctx.ellipse(0, 0, bodyLen / 2, bodyH / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = look.up;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,28,32,0.55)';
      ctx.lineWidth = Math.max(0.6, px * 0.012);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, bodyH * 0.12, bodyLen / 2, bodyH * 0.36, 0, 0, Math.PI);
      ctx.fillStyle = look.down;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bodyLen * 0.5, -bodyH * 0.1, bodyH * (form === 'fulmar' || form === 'auk' ? 0.42 : 0.32), 0, Math.PI * 2);
      ctx.fillStyle = look.cap || look.up;
      ctx.fill();
      ctx.strokeStyle = look.bill || (form === 'raven' ? '#222' : '#555');
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(bodyLen * 0.62, -bodyH * 0.08); ctx.lineTo(bodyLen * (form === 'auk' ? 0.72 : 0.8), -bodyH * 0.05); ctx.stroke();
      ctx.fillStyle = look.up;
      ctx.beginPath();
      const tailL = bodyLen * (form === 'tern' ? 0.7 : form === 'jaeger' ? 0.6 : 0.35);
      if (look.fork || form === 'tern') { ctx.moveTo(-bodyLen * 0.4, -bodyH * 0.15); ctx.lineTo(-bodyLen * 0.4 - tailL, -bodyH * 0.6); ctx.lineTo(-bodyLen * 0.4 - tailL * 0.45, 0); ctx.lineTo(-bodyLen * 0.4 - tailL, bodyH * 0.6); ctx.lineTo(-bodyLen * 0.4, bodyH * 0.15); }
      else if (form === 'jaeger') { ctx.moveTo(-bodyLen * 0.4, -bodyH * 0.2); ctx.lineTo(-bodyLen * 0.4 - tailL, 0); ctx.lineTo(-bodyLen * 0.4, bodyH * 0.2); }
      else if (look.wedge || form === 'raven') { ctx.moveTo(-bodyLen * 0.4, -bodyH * 0.25); ctx.lineTo(-bodyLen * 0.4 - tailL, -bodyH * 0.1); ctx.lineTo(-bodyLen * 0.4 - tailL * 1.15, 0); ctx.lineTo(-bodyLen * 0.4 - tailL, bodyH * 0.1); ctx.lineTo(-bodyLen * 0.4, bodyH * 0.25); }
      else { ctx.moveTo(-bodyLen * 0.4, -bodyH * 0.25); ctx.lineTo(-bodyLen * 0.4 - tailL, -bodyH * 0.25); ctx.lineTo(-bodyLen * 0.4 - tailL, bodyH * 0.25); ctx.lineTo(-bodyLen * 0.4, bodyH * 0.25); }
      ctx.closePath();
      ctx.fill();
      if (look.feet) { ctx.strokeStyle = look.feet; ctx.lineWidth = lw * 1.3; ctx.beginPath(); ctx.moveTo(-bodyLen * 0.3, bodyH * 0.35); ctx.lineTo(-bodyLen * 0.5, bodyH * 0.55); ctx.stroke(); }
      ctx.restore();
    }

    function drawSurfacing(animal, look, px, offB, phase, m) {
      const form = animal.species.form;
      const since = upFor(animal) + m * 0.35;
      const roll = Math.min(1, since / (animal.up * 0.95));
      // The back rises, rides at the surface, and slips under only at the very end of the surfacing.
      const arc = roll < 0.9 ? Math.max(0.4, Math.sin(roll * Math.PI)) : Math.max(0, (1 - roll) / 0.1) * 0.4;
      if (arc <= 0.02) return;
      const elev = waterElev(animal.dist);
      const { x, y } = project(animal.bearing + offB, elev);
      if (x < -px || x > W + px) return;
      const facing = Math.sign(animal.vel) || 1;
      const lw = Math.max(1, px * 0.03);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing, 1);
      if (form === 'seal') {
        const r = px * 0.22 * (0.7 + 0.3 * arc);
        ctx.fillStyle = look.body;
        ctx.beginPath(); ctx.arc(0, -r * 0.6, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.9, -r * 0.45, r * 0.55, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e9edf0'; ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.8, Math.max(1, r * 0.13), 0, Math.PI * 2); ctx.fill();
        if (animal.species.id === 'bearded') { ctx.strokeStyle = '#efe9dc'; ctx.lineWidth = lw; ctx.beginPath(); for (let w = -2; w <= 2; w++) { ctx.moveTo(r * 1.1, -r * 0.4); ctx.lineTo(r * 1.9, -r * 0.4 + w * r * 0.22); } ctx.stroke(); }
      } else if (form === 'porpoise') {
        const leap = Math.sin(((since * 1.6) % 1) * Math.PI);
        const len = px * 0.9;
        ctx.fillStyle = look.body;
        ctx.beginPath(); ctx.ellipse(0, -len * 0.18 * leap, len / 2, len * 0.16, -0.25 * leap, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = look.saddle;
        ctx.beginPath(); ctx.ellipse(-len * 0.05, -len * 0.18 * leap - len * 0.07, len * 0.28, len * 0.06, -0.25 * leap, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(len * 0.42, -len * 0.18 * leap - len * 0.02, len * 0.08, 0, Math.PI * 2); ctx.fill();
      } else {
        // Whales: a back arching through the surface; blow at the start, fin or tusk by species.
        const len = px * 0.95;
        const h = len * (look.tall ? 0.16 : animal.species.id === 'bowhead' ? 0.2 : 0.13) * arc;
        ctx.fillStyle = look.body;
        ctx.beginPath();
        ctx.moveTo(-len / 2, 0);
        ctx.quadraticCurveTo(-len * 0.2, -h * 1.9, len * 0.15, -h * 1.5);
        ctx.quadraticCurveTo(len * 0.4, -h * 1.2, len / 2, 0);
        ctx.closePath();
        ctx.fill();
        if (look.mottle) { ctx.fillStyle = look.mottle; for (let i = 0; i < 6; i++) { const sx = -len * 0.35 + i * len * 0.12, sy = -h * (1.2 - Math.abs(i - 2.5) * 0.25); ctx.beginPath(); ctx.ellipse(sx, sy, len * 0.035, h * 0.28, 0, 0, Math.PI * 2); ctx.fill(); } }
        if (look.fin) { ctx.beginPath(); ctx.moveTo(-len * 0.12, -h * 1.5); ctx.quadraticCurveTo(-len * 0.05, -h * 3.2, len * 0.06, -h * 3.1); ctx.lineTo(len * 0.12, -h * 1.4); ctx.closePath(); ctx.fill(); }
        if (look.tall) { ctx.beginPath(); ctx.moveTo(-len * 0.12, -h * 1.6); ctx.lineTo(-len * 0.02, -h * 6.5 * arc); ctx.lineTo(len * 0.14, -h * 1.4); ctx.closePath(); ctx.fill(); ctx.fillStyle = look.patch; ctx.beginPath(); ctx.ellipse(len * 0.25, -h * 1.05, len * 0.07, h * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8b9296'; ctx.beginPath(); ctx.ellipse(-len * 0.15, -h * 1.2, len * 0.1, h * 0.25, 0, 0, Math.PI * 2); ctx.fill(); }
        if (look.chin && roll < 0.5) { ctx.fillStyle = look.chin; ctx.beginPath(); ctx.ellipse(len * 0.44, -h * 0.2, len * 0.06, h * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
        if (look.tusk && m === Math.round((animal.count - 1) / 2) && since < 2.4) {
          const lift = Math.sin(Math.min(1, since / 2.4) * Math.PI);
          ctx.strokeStyle = look.tusk; ctx.lineWidth = Math.max(1, px * 0.02);
          ctx.beginPath(); ctx.moveTo(len * 0.45, -h * 0.6); ctx.lineTo(len * 0.45 + len * 0.42 * lift, -h * 0.6 - len * 0.32 * lift); ctx.stroke();
        }
        if (since < 1.6 && animal.species.id !== 'minke' && m === Math.round((animal.count - 1) / 2)) {
          const s = since / 1.6;
          ctx.strokeStyle = `rgba(235,240,242,${0.8 * (1 - s)})`;
          ctx.lineWidth = Math.max(1, px * 0.03);
          ctx.beginPath();
          const bh = len * (animal.species.id === 'bowhead' ? 0.45 : 0.2) * (0.3 + s);
          if (animal.species.id === 'bowhead') { ctx.moveTo(len * 0.3, -h * 1.3); ctx.lineTo(len * 0.18, -h * 1.3 - bh); ctx.moveTo(len * 0.3, -h * 1.3); ctx.lineTo(len * 0.42, -h * 1.3 - bh); }
          else { ctx.moveTo(len * 0.3, -h * 1.3); ctx.lineTo(len * 0.3, -h * 1.3 - bh); }
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    function drawHauled(animal, look, px, offB, m) {
      const elev = waterElev(animal.dist);
      const free = Math.max(0.05, apparentDeg(1.4, animal.dist) * 0.35);
      if (m === 0) drawFloe(animal.bearing, animal.dist, 40 + animal.count * 8, 0.97);
      const { x, y } = project(animal.bearing + offB, elev + free * 0.9);
      if (x < -px || x > W + px) return;
      const len = px * 0.7;
      ctx.save();
      ctx.translate(x, y);
      if (animal.species.form === 'bear') {
        const step = Math.sin(state.t * 2.2 + animal.seed * 10);
        const walk = Math.sin(state.t * 0.4 + animal.seed) * len * 0.6;
        ctx.translate(walk, 0);
        ctx.fillStyle = look.body;
        ctx.beginPath(); ctx.ellipse(0, -len * 0.28, len * 0.5, len * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(len * 0.35, -len * 0.4); ctx.lineTo(len * 0.72, -len * 0.55); ctx.lineTo(len * 0.8, -len * 0.42); ctx.lineTo(len * 0.5, -len * 0.2); ctx.closePath(); ctx.fill();
        ctx.lineWidth = Math.max(1.5, len * 0.11); ctx.strokeStyle = look.body; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-len * 0.3, -len * 0.2); ctx.lineTo(-len * 0.3 + step * len * 0.1, 0);
        ctx.moveTo(len * 0.3, -len * 0.2); ctx.lineTo(len * 0.3 - step * len * 0.1, 0);
        ctx.moveTo(-len * 0.15, -len * 0.2); ctx.lineTo(-len * 0.15 - step * len * 0.08, 0);
        ctx.moveTo(len * 0.15, -len * 0.2); ctx.lineTo(len * 0.15 + step * len * 0.08, 0);
        ctx.stroke();
      } else if (animal.species.form === 'walrus') {
        ctx.fillStyle = look.body;
        ctx.beginPath(); ctx.ellipse(0, -len * 0.18, len * 0.5, len * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(len * 0.42, -len * 0.3, len * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = look.tusk; ctx.lineWidth = Math.max(1, len * 0.05);
        ctx.beginPath(); ctx.moveTo(len * 0.5, -len * 0.22); ctx.lineTo(len * 0.47, len * 0.02); ctx.moveTo(len * 0.56, -len * 0.22); ctx.lineTo(len * 0.55, len * 0.02); ctx.stroke();
      } else {
        // A seal lying on the floe, head lifted.
        ctx.fillStyle = look.body;
        ctx.beginPath(); ctx.ellipse(0, -len * 0.14, len * 0.5, len * 0.14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(len * 0.42, -len * 0.26, len * 0.14, len * 0.12, -0.4, 0, Math.PI * 2); ctx.fill();
        if (animal.species.id === 'bearded') { ctx.fillStyle = look.body; ctx.fillRect(-len * 0.1, -len * 0.16, len * 0.14, len * 0.16); ctx.strokeStyle = '#efe9dc'; ctx.lineWidth = Math.max(1, len * 0.02); ctx.beginPath(); for (let w = -1; w <= 1; w++) { ctx.moveTo(len * 0.5, -len * 0.26); ctx.lineTo(len * 0.72, -len * 0.26 + w * len * 0.08); } ctx.stroke(); }
      }
      ctx.restore();
    }

    function drawSitting(animal, look, px) {
      const { x, y } = project(animal.bearing, waterElev(animal.dist));
      if (x < -px || x > W + px) return;
      const spin = Math.cos(state.t * 3 + animal.seed * 7);
      const len = px * 0.6;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(spin < 0 ? -1 : 1, 1);
      ctx.fillStyle = look.up;
      ctx.beginPath(); ctx.ellipse(0, -len * 0.15, len * 0.5 * (0.5 + 0.5 * Math.abs(spin)), len * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.down;
      ctx.beginPath(); ctx.ellipse(0, -len * 0.08, len * 0.45 * (0.5 + 0.5 * Math.abs(spin)), len * 0.1, 0, 0, Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(len * 0.4 * Math.abs(spin), -len * 0.35, len * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(len * 0.4 * Math.abs(spin) + len * 0.05, -len * 0.37, Math.max(0.8, len * 0.04), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function drawShoreAnimal(animal, look, px, offB) {
      const sector = animal.sector;
      const base = waterElev(sector.dist);
      const elev = base + skyline(sector, animal.bearing) * (0.28 + 0.25 * animal.seed);
      const { x, y } = project(animal.bearing + offB, elev);
      if (x < -px || x > W + px) return;
      const len = px * 0.8;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = look.body;
      if (animal.species.form === 'muskox') {
        ctx.fillRect(-len * 0.5, -len * 0.55, len, len * 0.5);
        ctx.fillRect(-len * 0.42, -len * 0.1, len * 0.14, len * 0.12); ctx.fillRect(len * 0.28, -len * 0.1, len * 0.14, len * 0.12);
        ctx.beginPath(); ctx.arc(len * 0.5, -len * 0.35, len * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = look.saddle; ctx.fillRect(-len * 0.3, -len * 0.55, len * 0.5, len * 0.12);
        ctx.strokeStyle = '#d8cfb8'; ctx.lineWidth = Math.max(1, len * 0.04); ctx.beginPath(); ctx.moveTo(len * 0.5, -len * 0.5); ctx.quadraticCurveTo(len * 0.75, -len * 0.55, len * 0.7, -len * 0.3); ctx.stroke();
      } else if (animal.species.form === 'fox') {
        const trot = Math.sin(state.t * 0.9 + animal.seed * 5) * len * 0.8;
        ctx.translate(trot, 0);
        ctx.beginPath(); ctx.ellipse(0, -len * 0.25, len * 0.45, len * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(len * 0.45, -len * 0.38, len * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-len * 0.55, -len * 0.2, len * 0.28, len * 0.12, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5b554c'; ctx.beginPath(); ctx.ellipse(-len * 0.05, -len * 0.3, len * 0.22, len * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.ellipse(0, -len * 0.3, len * 0.3, len * 0.36, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(len * 0.05, -len * 0.7, len * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = look.body; ctx.lineWidth = Math.max(1, len * 0.09); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-len * 0.02, -len * 0.82); ctx.lineTo(-len * 0.1, -len * 1.2); ctx.moveTo(len * 0.12, -len * 0.82); ctx.lineTo(len * 0.18, -len * 1.2); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-len * 0.1, -len * 1.2, Math.max(0.8, len * 0.05), 0, Math.PI * 2); ctx.arc(len * 0.18, -len * 1.2, Math.max(0.8, len * 0.05), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    function drawGlassMask() {
      const r = Math.min(W * 0.34, H * 0.62);
      const cx = W / 2, cy = H * 0.5;
      // Keep the scene only inside the two overlapping lenses; the canvas background shows through elsewhere.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42 + r, cy);
      ctx.arc(cx - r * 0.42, cy, r, 0, Math.PI * 2);
      ctx.moveTo(cx + r * 0.42 + r, cy);
      ctx.arc(cx + r * 0.42, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(cx - r * 0.42, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + r * 0.42, cy, r, 0, Math.PI * 2); ctx.stroke();
      // Reticle and the quarter-field capture zone.
      const zone = FOV.glass / 4 * view.pxPerDeg;
      ctx.strokeStyle = 'rgba(255,230,180,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - zone, cy - 12); ctx.lineTo(cx - zone, cy + 12); ctx.moveTo(cx + zone, cy - 12); ctx.lineTo(cx + zone, cy + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14); ctx.stroke();
      const focus = state.focus;
      if (focus) {
        const n = cuesRevealed(focus);
        ctx.fillStyle = 'rgba(255,230,180,0.85)';
        for (let i = 0; i < 4; i++) { ctx.globalAlpha = i < n ? 0.9 : 0.25; ctx.fillRect(cx - 22 + i * 12, cy + r * 0.78, 8, 4); }
        ctx.globalAlpha = 1;
      }
    }

    function drawCompass() {
      const h = 18;
      ctx.fillStyle = 'rgba(10,20,26,0.55)';
      ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = '#e8eef0';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const step = state.glass ? 1 : 10;
      const labelEvery = state.glass ? 5 : 30;
      const startB = Math.floor((state.view - view.fov / 2) / step) * step;
      for (let b = startB; b <= state.view + view.fov / 2 + step; b += step) {
        const x = project(wrap(b), 0).x;
        if (x < -10 || x > W + 10) continue;
        const major = wrap(b) % labelEvery === 0;
        ctx.fillRect(x - 0.5, major ? 0 : h - 6, 1, major ? h : 6);
        if (major) ctx.fillText(wrap(b) === 0 ? 'BOW' : wrap(b) === 180 ? 'STERN' : pad3(b), x, h / 2 - 1);
      }
      ctx.fillStyle = '#ffd88a';
      ctx.beginPath(); ctx.moveTo(W / 2 - 5, h); ctx.lineTo(W / 2 + 5, h); ctx.lineTo(W / 2, h - 6); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(10,20,26,0.55)';
      ctx.fillRect(0, H - 18, 46, 18);
      ctx.fillStyle = '#e8eef0';
      ctx.fillText(state.glass ? '7×50' : 'eye', 6, H - 9);
    }

    // ---------- loop ----------
    function loop(now) {
      if (!active || !state || state.finished) return;
      fit();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      const pan = state.pending ? 0 : (held.right ? 1 : 0) - (held.left ? 1 : 0);
      tick(state, dt, pan);
      aimGlass(dt);
      for (const event of state.events) {
        if (event.type === 'sighting') say(sightingText(event.animal));
        else if (event.type === 'gone' && event.animal.species.rarity >= 4) say(`Whatever that was at ${oclock(event.animal.bearing)} is gone.`);
      }
      renderHud();
      render();
      if (state.finished) end();
      else frame = requestAnimationFrame(loop);
    }

    const sightingText = animal => {
      const s = animal.species;
      const what = s.group === 'bird' ? (animal.count > 1 ? 'Birds' : 'A bird') : animal.kind === 'shore' ? 'Movement' : animal.kind === 'haul' ? 'Something' : 'Something';
      const where = animal.kind === 'fly' ? (animal.elev > 1.5 ? ', high' : ', low over the water') : animal.kind === 'surface' ? ' at the surface' : animal.kind === 'haul' ? ' on a floe' : animal.kind === 'shore' ? ' on the slope' : ' on the water';
      return `${what}${where}, ${oclock(animal.bearing)}.`;
    };

    function renderHud() {
      find('[data-clock]').textContent = Math.max(0, Math.ceil(WATCH_SECONDS - state.t));
      find('[data-points]').textContent = state.points;
      const glassBtn = find('[data-glass-btn]');
      glassBtn.setAttribute('aria-pressed', String(state.glass));
      const focused = target(state);
      let line = state.glass ? `Bearing ${pad3(state.view)} · 7×50` : `Bearing ${pad3(state.view)} · eye`;
      if (focused && !state.pending) {
        const n = cuesRevealed(state.focus);
        const cues = focused.species.cues.slice(0, n);
        line += ` · ${focused.count > 1 ? `${focused.count} animals` : focused.species.group === 'bird' ? 'a bird' : 'an animal'}, ${Math.round(focused.dist / 50) * 50} m`;
        line += cues.length ? `: ${cues.join(' · ')}` : ' — hold steady…';
      }
      if (glassLine.textContent !== line) glassLine.textContent = line;
      find('[data-log]').disabled = !!state.pending;
    }

    // ---------- identification ----------
    function openMenu() {
      const result = beginLog(state);
      if (!result.animal) { if (result.reason) say(result.reason); return; }
      const animal = result.animal;
      menuPool = poolFor(state.habitat.id, animal.species.group);
      menuCursor = 0;
      const cues = animal.species.cues.slice(0, state.pending.cues);
      idMenu.innerHTML = `<p class="c14-idmenu-head"><b>${animal.count > 1 ? `${animal.count} ${animal.species.group === 'bird' ? 'birds' : 'animals'}` : animal.species.group === 'bird' ? 'One bird' : 'One animal'} at ${pad3(animal.bearing)}</b> ${cues.length ? escape(cues.join(' · ')) : 'no marks made out'}</p>
        <div class="c14-idmenu-list">${menuPool.map((s, i) => `<button type="button" role="option" data-species="${s.id}" aria-selected="${i === 0}"><span class="c14-idmenu-key">${i < 9 ? i + 1 : ''}</span><span><b>${escape(s.name)}</b><small>${escape(s.cues[2])} · ${escape(s.cues[3])}</small></span><span class="c14-idmenu-pts">${POINTS[s.rarity]}</span></button>`).join('')}</div>
        <button type="button" data-cancel>Keep watching</button><p class="c14-idmenu-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> name it · <kbd>Esc</kbd> keep watching</p>`;
      idMenu.hidden = false;
      renderMenu();
      say(`Name the ${animal.species.group === 'bird' ? 'bird' : 'animal'}.`);
    }
    function renderMenu() {
      idMenu.querySelectorAll('[data-species]').forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === menuCursor));
        if (i === menuCursor) button.scrollIntoView?.({ block: 'nearest' });
      });
    }
    function closeMenu() {
      idMenu.hidden = true;
      idMenu.innerHTML = '';
    }
    function choose(speciesId) {
      const entry = identify(state, speciesId);
      closeMenu();
      if (!entry) return;
      const li = document.createElement('li');
      li.className = entry.ok ? 'c14-ok' : 'c14-bad';
      const count = entry.count > 1 ? ` ×${entry.count}` : '';
      li.innerHTML = entry.ok
        ? `<span>${pad3(entry.bearing)}</span><b>${escape(entry.actual.name)}${count}</b><i>+${entry.points}</i>`
        : `<span>${pad3(entry.bearing)}</span><b><s>${escape(entry.guess.name)}</s> ${escape(entry.actual.name)}${count}</b><i>−${WRONG_PENALTY}</i>`;
      logList.prepend(li);
      if (entry.ok) say(entry.actual.id === 'narwhal' ? `Narwhal. ${entry.count} of them, logged at ${pad3(entry.bearing)}. +${entry.points}.` : `${entry.actual.name}${count}, logged. +${entry.points}.`);
      else say(`Not a ${entry.guess.name.toLowerCase()}: ${entry.actual.name.toLowerCase()}, ${entry.actual.cues[3]}. −${WRONG_PENALTY}.`);
    }

    // ---------- end ----------
    function end() {
      cancelAnimationFrame(frame);
      held.left = held.right = false;
      const summary = finish(state);
      closeMenu();
      watchEl.hidden = true;
      doneEl.hidden = false;
      const rare = summary.rarest && summary.rarest !== 'Northern fulmar' ? `Best of the watch: ${summary.rarest}.` : '';
      doneEl.innerHTML = `
        <div class="c14-summary">
          <p class="c14-kicker">WATCH COMPLETE · ${escape(summary.habitat.toUpperCase())}</p>
          <p class="c14-big"><strong>${summary.points}</strong> points</p>
          <p>${summary.correct} named, ${summary.wrong} wrong, ${summary.missed} passed unlogged. ${summary.speciesCount} species. ${escape(rare)}</p>
          ${summary.narwhal ? '<p class="c14-narwhal">Narwhal in the log. A tusk in the glass is a sighting to be spoken of at dinner.</p>' : `<p class="c14-quiet">${state.habitat.id === 'sound' ? 'No narwhal this watch; the fjord keeps them for another day.' : 'No narwhal; they keep to the deep sounds and fjords in summer.'}</p>`}
          ${summary.species.length ? `<ul class="c14-species">${summary.species.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : ''}
          <div class="c14-pick-actions"><button type="button" data-again>Watch again <kbd>Enter</kbd></button></div>
        </div>`;
      if (!awarded) {
        awarded = true;
        try { complete(summary.points, summary); } catch (error) { console.error(error); }
      }
    }
    function again() {
      state = null;
      doneEl.hidden = true;
      pickEl.hidden = false;
      renderPick();
      find('[data-clock]').textContent = WATCH_SECONDS;
      find('[data-points]').textContent = '0';
      find('[data-lookouts] [aria-selected="true"]')?.focus?.();
    }

    // ---------- input ----------
    gameEl.addEventListener('click', event => {
      if (!active) return;
      const lookout = event.target.closest('[data-habitat]');
      if (lookout) { pickCursor = HABITATS.findIndex(h => h.id === lookout.dataset.habitat); renderPick(); start(lookout.dataset.habitat); return; }
      if (event.target.closest('[data-start]')) { start(HABITATS[pickCursor].id); return; }
      if (event.target.closest('[data-again]')) { again(); return; }
      if (!state || state.finished) return;
      if (event.target.closest('[data-glass-btn]')) { toggleGlass(state); if (state.pending) { cancelLog(state); closeMenu(); } return; }
      if (event.target.closest('[data-cancel]')) { cancelLog(state); closeMenu(); say('Kept watching.'); return; }
      if (event.target.closest('[data-log]')) { openMenu(); return; }
      if (event.target.closest('[data-end]')) { finish(state); end(); return; }
      const option = event.target.closest('[data-species]');
      if (option) { choose(option.dataset.species); return; }
    }, { signal });
    // Pan buttons pan while pressed.
    for (const button of gameEl.querySelectorAll('[data-pan]')) {
      const dir = button.dataset.pan;
      const down = event => { event.preventDefault(); held[dir] = true; button.setPointerCapture?.(event.pointerId); };
      const up = () => { held[dir] = false; };
      button.addEventListener('pointerdown', down, { signal });
      button.addEventListener('pointerup', up, { signal });
      button.addEventListener('pointercancel', up, { signal });
      button.addEventListener('lostpointercapture', up, { signal });
    }
    window.addEventListener('blur', () => { held.left = held.right = false; }, { signal });

    window.addEventListener('keydown', event => {
      if (!active || !gameEl.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      if (event.repeat && !['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd'].includes(key)) { event.preventDefault(); return; }
      if (!pickEl.hidden) {
        if (key >= '1' && key <= '4') { pickCursor = Number(key) - 1; renderPick(); start(HABITATS[pickCursor].id); }
        else if (key === 'arrowright' || key === 'arrowdown') { pickCursor = (pickCursor + 1) % HABITATS.length; renderPick(); }
        else if (key === 'arrowleft' || key === 'arrowup') { pickCursor = (pickCursor + HABITATS.length - 1) % HABITATS.length; renderPick(); }
        else if (key === 'enter' || key === ' ') start(HABITATS[pickCursor].id);
        else return;
        event.preventDefault();
        return;
      }
      if (!doneEl.hidden) {
        if (key === 'enter' || key === ' ') { event.preventDefault(); again(); }
        return;
      }
      if (!state || state.finished) return;
      if (state.pending) {
        if (key === 'arrowdown') menuCursor = (menuCursor + 1) % menuPool.length;
        else if (key === 'arrowup') menuCursor = (menuCursor + menuPool.length - 1) % menuPool.length;
        else if (key === 'enter' || key === ' ') { event.preventDefault(); choose(menuPool[menuCursor].id); return; }
        else if (key === 'escape') { cancelLog(state); closeMenu(); say('Kept watching.'); event.preventDefault(); return; }
        else if (key >= '1' && key <= '9' && menuPool[Number(key) - 1]) { choose(menuPool[Number(key) - 1].id); event.preventDefault(); return; }
        else return;
        event.preventDefault();
        renderMenu();
        return;
      }
      if (key === 'arrowleft' || key === 'a') held.left = true;
      else if (key === 'arrowright' || key === 'd') held.right = true;
      else if (key === 'b' || key === ' ') { if (!event.repeat) toggleGlass(state); }
      else if (key === 'enter' || key === 'l') { if (!event.repeat) openMenu(); }
      else if (key === 'e') { if (!event.repeat) { finish(state); end(); } }
      else return;
      event.preventDefault();
    }, { signal });
    window.addEventListener('keyup', event => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') held.left = false;
      if (key === 'arrowright' || key === 'd') held.right = false;
    }, { signal });

    renderPick();
    find('[data-lookouts] [aria-selected="true"]')?.focus?.();

    return () => {
      active = false;
      events.abort();
      cancelAnimationFrame(frame);
      root.innerHTML = '';
    };
  },
};
