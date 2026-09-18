// Shipwrecks, in two steps. Launched at sea, the game is a target picker: the archive's wrecks by range and
// bearing from the ship, and choosing one hands the ship to the shell (expedition.steamTo) to steam there.
// Launched on station (expedition.wreck names the wreck the ship is over), it opens straight on the search:
// plan sonar lines over the box against the ship-time budget, spot the contact in the mosaic and the
// waterfall, then drop the ROV to identify it. Without steamTo the search is run from wherever the ship is.
import { GRID, createGame, clampBox, planLegs, planCost, startSurvey, advanceSurvey, dive, endDive, score, isCovered, contactAt, diveHours, distanceKm, bearingDeg, compass, formatPosition, siteBudget, SURVEY_KN, named } from './crew-18-model.js';

const stylesheet = new URL('./crew-18.css', import.meta.url).href;
const archive = new URL('../data/crew-18-wrecks.json', import.meta.url);
const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const MOSAIC_PX = 22;              // offscreen pixels per search-box cell
const SURVEY_SECONDS = 75;         // real seconds to spend the whole budget at normal speed
const FAST = 4;
const RINGS = [10, 25, 50, 100, 250, 500, 1000, 2000, 3000];   // candidate range rings, km
const BEACH_KM = 3;                // a datum further than this from charted water gets a note in the picker
const esc = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const hours = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const km = v => v >= 10 ? `${v.toFixed(0)} km` : `${v.toFixed(1)} km`;

export const game = {
  title: 'Shipwrecks',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let active = true, awarded = false, frame = 0, last = 0;
    const ship = { lon: Number.isFinite(expedition?.lon) ? expedition.lon : -70.56, lat: Number.isFinite(expedition?.lat) ? expedition.lat : 76.51 };
    const seed = `${ship.lon.toFixed(2)}:${ship.lat.toFixed(2)}:${Date.now()}`;
    let phase = 'loading', wrecks = [], selected = 0, state = null, mode = 'box', fast = false;
    let mosaic = null, waterfall = null, diveAnim = null, hover = -1;
    let width = 0, height = 0, dpr = 1;
    const plot = { cx: 0, cy: 0, radius: 1, maxKm: 1, rings: [], markers: [] };
    const canSteam = typeof expedition?.steamTo === 'function';
    const picking = () => phase === 'loading' || phase === 'pick' || phase === 'steaming';

    root.innerHTML = `
      <section class="c18-game" data-phase="loading" aria-label="Shipwrecks">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="c18-heading">
          <div><p class="c18-kicker">SEABED / SHIPWRECKS</p><h3 data-title>Shipwrecks of the archive</h3></div>
          <div class="c18-meters">
            <div class="c18-clock"><strong data-clock>—</strong><span>ship time left</span></div>
            <div class="c18-score"><strong data-points>0</strong><span data-points-label>points</span></div>
          </div>
        </div>
        <div class="c18-layout">
          <div class="c18-stage">
            <canvas class="c18-canvas" data-canvas tabindex="-1" aria-label="Range plot and sonar display"></canvas>
            <div class="c18-legend" data-legend aria-hidden="true"></div>
          </div>
          <aside class="c18-panel" data-panel></aside>
        </div>
        <div class="c18-debrief" data-debrief hidden></div>
      </section>`;
    const gameEl = root.querySelector('.c18-game');
    const find = selector => gameEl.querySelector(selector);
    const canvas = find('[data-canvas]'), ctx = canvas.getContext('2d');
    const panel = find('[data-panel]');
    const say = text => { const el = find('[data-status]'); if (el) el.textContent = text; };
    const setPhase = next => { phase = next; gameEl.dataset.phase = next; };

    // ---- data ------------------------------------------------------------------------------
    fetch(archive).then(r => { if (!r.ok) throw Error('archive missing'); return r.json(); }).then(data => {
      if (!active) return;
      wrecks = data.wrecks.map(w => ({ ...w, distanceKm: distanceKm(ship.lat, ship.lon, w.lat, w.lon), bearing: bearingDeg(ship.lat, ship.lon, w.lat, w.lon), budget: siteBudget(w) }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
      // The shell names the wreck when the ship launches the game on its datum: straight to the search.
      const station = wrecks.findIndex(w => w.id === expedition?.wreck);
      if (station >= 0) { selected = station; begin(wrecks[station], true); return; }
      selected = 0;
      setPhase('pick');
      layoutPlot();
      renderPanel();
    }).catch(error => { console.error(error); panel.innerHTML = '<p class="c18-status">The wreck archive did not load. Close and try again.</p>'; });

    // ---- range and bearing plot ------------------------------------------------------------
    // The ship at the centre, each wreck at its great-circle range and initial bearing. The range scale is
    // square-root so the near wrecks do not pile onto the ship; the labelled rings say what it is.
    function layoutPlot() {
      if (!wrecks.length) return;
      // The caption runs along the bottom edge; the compass letters sit just outside the outer ring.
      plot.cx = width / 2; plot.cy = (height - 18) / 2; plot.radius = Math.min(width, height - 18) / 2 - 18;
      plot.maxKm = Math.max(50, ...wrecks.map(w => w.distanceKm)) * 1.06;
      plot.rings = []; let lastR = 0;
      for (const d of RINGS) { const r = plotRadius(d); if (d < plot.maxKm && r - lastR >= 22) { plot.rings.push(d); lastR = r; } }
      plot.markers = wrecks.map(w => plotPoint(w.distanceKm, w.bearing));
    }
    const plotRadius = d => plot.radius * Math.sqrt(Math.min(1, d / plot.maxKm));
    const plotPoint = (d, bearing) => { const r = plotRadius(d), a = (bearing - 90) * Math.PI / 180; return { x: plot.cx + Math.cos(a) * r, y: plot.cy + Math.sin(a) * r }; };

    function drawPlot(now) {
      ctx.fillStyle = '#183b4a'; ctx.fillRect(0, 0, width, height);
      const s = { x: plot.cx, y: plot.cy }, sel = plot.markers[selected];
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)';
      for (const d of plot.rings) { const r = plotRadius(d); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${d} km`, s.x + 3, s.y - r + 11); }
      ctx.beginPath(); ctx.arc(s.x, s.y, plot.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x, s.y - plot.radius); ctx.lineTo(s.x, s.y + plot.radius); ctx.moveTo(s.x - plot.radius, s.y); ctx.lineTo(s.x + plot.radius, s.y); ctx.stroke();
      ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.textAlign = 'center';
      ctx.fillText('N', s.x, s.y - plot.radius - 5); ctx.fillText('S', s.x, s.y + plot.radius + 13); ctx.fillText('E', s.x + plot.radius + 9, s.y + 4); ctx.fillText('W', s.x - plot.radius - 9, s.y + 4);
      ctx.textAlign = 'start';
      // Bearing line from the ship to the chosen wreck.
      if (sel) {
        ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(245,190,90,.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sel.x, sel.y); ctx.stroke(); ctx.restore();
      }
      wrecks.forEach((w, i) => {
        const m = plot.markers[i], isSel = i === selected;
        ctx.save(); ctx.translate(m.x, m.y);
        const r = isSel ? 7 : 5;
        if (isSel) { ctx.strokeStyle = `rgba(245,190,90,${0.5 + 0.4 * Math.sin(now / 250)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke(); }
        ctx.fillStyle = w.found ? '#ffd27a' : '#f4f1e6'; ctx.strokeStyle = '#1d2f38'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#1d2f38'; ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.6); ctx.lineTo(r * 0.6, r * 0.6); ctx.moveTo(r * 0.6, -r * 0.6); ctx.lineTo(-r * 0.6, r * 0.6); ctx.stroke();
        ctx.restore();
      });
      // The Amundsen.
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.fillStyle = '#ff6b4a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 4); ctx.lineTo(0, 7); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // Labels: the ship first, then the chosen wreck, then the rest, each in the first free slot around its mark.
      const placed = [];
      const free = rect => rect.x >= 0 && rect.x + rect.w <= width && rect.y >= 0 && rect.y + rect.h <= height - 14 && !placed.some(p => rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y);
      const label = (x, y, text, font, colour, force) => {
        ctx.font = font;
        const tw = ctx.measureText(text).width, w = tw + 6, h = 15;
        const slots = [[10, -8], [-w - 10, -8], [10, -22], [-w - 10, -22], [10, 6], [-w - 10, 6], [-w / 2, -26], [-w / 2, 10]];
        let rect = null;
        for (const [dx, dy] of slots) { const r = { x: x + dx, y: y + dy, w, h }; if (free(r)) { rect = r; break; } }
        if (!rect) { if (!force && width <= 640) return; rect = { x: x + 10, y: y - 8, w, h }; }
        placed.push(rect);
        ctx.fillStyle = 'rgba(12,30,40,.72)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = colour; ctx.fillText(text, rect.x + 3, rect.y + 12);
      };
      placed.push({ x: s.x - 8, y: s.y - 10, w: 16, h: 18 });
      plot.markers.forEach(m => placed.push({ x: m.x - 6, y: m.y - 6, w: 12, h: 12 }));
      // Compass letters and ring labels are already on the plot; wreck labels keep off them.
      placed.push({ x: s.x - 6, y: s.y - plot.radius - 15, w: 12, h: 12 }, { x: s.x - 6, y: s.y + plot.radius + 2, w: 12, h: 13 }, { x: s.x + plot.radius + 3, y: s.y - 6, w: 12, h: 12 }, { x: s.x - plot.radius - 15, y: s.y - 6, w: 12, h: 12 });
      for (const d of plot.rings) placed.push({ x: s.x + 2, y: s.y - plotRadius(d) + 1, w: 44, h: 12 });
      label(s.x, s.y, 'Amundsen', '700 11px system-ui, sans-serif', '#fff', true);
      const order = [selected, ...wrecks.map((_, i) => i).filter(i => i !== selected)];
      for (const i of order) { const w = wrecks[i], m = plot.markers[i]; label(m.x, m.y, `${w.ship} ${w.year}`, `${i === selected ? '700 ' : ''}11px system-ui, sans-serif`, i === selected ? '#ffe4a8' : i === hover ? '#fff' : '#e6eef0', i === selected || i === hover); }
      ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(width < 640 ? 'Range and bearing from the ship · ⊗ wreck  ● located' : 'Range and bearing from the ship · datum positions from the underway history archive · ⊗ wreck  ● located', 8, height - 6);
    }

    // ---- mosaic (the full seabed image, revealed cell by cell) ------------------------------
    function buildMosaic(site) {
      const size = GRID * MOSAIC_PX, off = document.createElement('canvas');
      off.width = size; off.height = size;
      const c = off.getContext('2d'), img = c.createImageData(size, size), px = img.data, sidescan = site.sonar.mode === 'side-scan';
      const seabedAt = (x, y) => { const cx = Math.min(GRID - 1, Math.max(0, Math.floor(x))), cy = Math.min(GRID - 1, Math.max(0, Math.floor(y))); return site.seabed[cy * GRID + cx]; };
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const x = i / MOSAIC_PX, y = j / MOSAIC_PX, k = (j * size + i) * 4;
        if (site.land[Math.floor(y) * GRID + Math.floor(x)]) { px[k] = 206; px[k + 1] = 196; px[k + 2] = 168; px[k + 3] = 255; continue; }
        const t = site.texture(x * 4, y * 4), d = seabedAt(x, y), rel = Math.min(1, d / (site.depth * 1.3));
        const grain = ((i * 7 + j * 13) % 11) / 11 * 0.14, band = 0.05 * Math.sin(i * 0.9 + t * 6);   // speckle and along-track striping
        const v = 0.2 + (t - 0.5) * 0.9 + 0.35 + grain + band - rel * 0.2;
        if (sidescan) { px[k] = 60 + v * 190; px[k + 1] = 40 + v * 140; px[k + 2] = 18 + v * 60; }
        else { px[k] = 30 + v * 110; px[k + 1] = 60 + v * 140; px[k + 2] = 70 + v * 120; }
        px[k + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      const bright = sidescan ? '#ffe9b0' : '#e8fbff', shadow = sidescan ? 'rgba(30,14,4,.85)' : 'rgba(5,20,30,.85)';
      for (const f of site.contacts) drawFeature(c, f.x * MOSAIC_PX, f.y * MOSAIC_PX, f.kind, f.size * MOSAIC_PX, f.heading, bright, shadow);
      const L = Math.min(3, Math.max(1.6, site.target.lengthM / site.cellM)) * MOSAIC_PX;
      drawFeature(c, site.target.x * MOSAIC_PX, site.target.y * MOSAIC_PX, 'wreck', L, site.target.heading, bright, shadow);
      // Cell outlines faint enough to read as a survey grid, not a fence.
      c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 1;
      for (let i = 0; i <= GRID; i += 4) { c.beginPath(); c.moveTo(i * MOSAIC_PX, 0); c.lineTo(i * MOSAIC_PX, size); c.moveTo(0, i * MOSAIC_PX); c.lineTo(size, i * MOSAIC_PX); c.stroke(); }
      return off;
    }
    function drawFeature(c, x, y, kind, size, heading, bright, shadow) {
      c.save(); c.translate(x, y); c.rotate(heading);
      if (kind === 'wreck') {
        const w = size * 0.28;
        // The acoustic shadow: a soft-edged wedge the length of the hull, cast to one side.
        for (let k = 3; k >= 1; k--) { c.fillStyle = shadow.replace(/[\d.]+\)$/, `${0.3 * k})`); c.beginPath(); c.ellipse(size * 0.05, w * 0.6 + size * 0.22 * k / 3, size * 0.55 + k, size * 0.16 * k, 0, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = bright; c.beginPath(); c.moveTo(-size / 2, 0); c.lineTo(-size * 0.3, -w / 2); c.lineTo(size * 0.45, -w / 2); c.lineTo(size / 2, 0); c.lineTo(size * 0.45, w / 2); c.lineTo(-size * 0.3, w / 2); c.closePath(); c.fill();
        c.strokeStyle = shadow; c.lineWidth = 1; for (let i = -0.3; i < 0.45; i += 0.12) { c.beginPath(); c.moveTo(size * i, -w / 2); c.lineTo(size * i, w / 2); c.stroke(); }
      } else if (kind === 'boulder') {
        c.fillStyle = shadow; c.beginPath(); c.ellipse(size * 0.4, size * 0.6, size * 0.7, size * 0.35, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = bright; c.beginPath(); c.ellipse(0, 0, size * 0.5, size * 0.38, 0, 0, Math.PI * 2); c.fill();
      } else if (kind === 'scour') {
        c.strokeStyle = shadow; c.lineWidth = size * 0.12; c.beginPath(); c.moveTo(-size / 2, 0); c.quadraticCurveTo(0, size * 0.1, size / 2, 0); c.stroke();
        c.strokeStyle = bright; c.lineWidth = size * 0.04; c.beginPath(); c.moveTo(-size / 2, -size * 0.07); c.quadraticCurveTo(0, size * 0.03, size / 2, -size * 0.07); c.stroke();
      } else {
        c.fillStyle = shadow; c.beginPath(); c.ellipse(size * 0.3, size * 0.7, size * 0.9, size * 0.5, 0.3, 0, Math.PI * 2); c.fill();
        c.fillStyle = bright; c.beginPath();
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, r = size * (0.5 + ((i * 5) % 3) * 0.12); i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.closePath(); c.fill();
      }
      c.restore();
    }

    // ---- search display ----------------------------------------------------------------------
    const box = () => ({ size: Math.min(height, width * 0.74) - 8, x: 4, y: 4 });
    const cellPx = () => box().size / GRID;
    const toCell = (px, py) => { const b = box(); return { x: (px - b.x) / cellPx(), y: (py - b.y) / cellPx() }; };

    function drawSearch(now) {
      const { site } = state, b = box(), cp = cellPx();
      ctx.fillStyle = '#0d1f27'; ctx.fillRect(0, 0, width, height);
      // Unsurveyed seabed is charted only by its GEBCO depth; the mosaic fills in as lines are run.
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c, x = b.x + c * cp, y = b.y + r * cp;
        if (state.covered[i]) ctx.drawImage(mosaic, c * MOSAIC_PX, r * MOSAIC_PX, MOSAIC_PX, MOSAIC_PX, x, y, cp + 0.5, cp + 0.5);
        else if (site.land[i]) { ctx.fillStyle = '#5a5648'; ctx.fillRect(x, y, cp + 0.5, cp + 0.5); }
        else { ctx.fillStyle = `rgba(52,78,90,${0.55 + 0.35 * (1 - Math.min(1, site.seabed[i] / (site.depth * 1.3)))})`; ctx.fillRect(x, y, cp + 0.5, cp + 0.5); }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      for (let i = 0; i <= GRID; i += 4) { ctx.beginPath(); ctx.moveTo(b.x + i * cp, b.y); ctx.lineTo(b.x + i * cp, b.y + b.size); ctx.moveTo(b.x, b.y + i * cp); ctx.lineTo(b.x + b.size, b.y + i * cp); ctx.stroke(); }
      // Datum.
      const dx = b.x + b.size / 2, dy = b.y + b.size / 2;
      ctx.strokeStyle = '#ff8c6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(dx, dy, 7, 0, Math.PI * 2); ctx.moveTo(dx - 12, dy); ctx.lineTo(dx + 12, dy); ctx.moveTo(dx, dy - 12); ctx.lineTo(dx, dy + 12); ctx.stroke();
      ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#ffb59f'; ctx.fillText('datum', dx + 14, dy - 12);
      // Dives so far.
      for (const d of state.dives) {
        const x = b.x + d.x * cp, y = b.y + d.y * cp;
        ctx.strokeStyle = d.hit ? '#7dffb0' : '#ff8080'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
      }
      // Planned box and its lines.
      const showBox = state.phase === 'survey' ? state.box : (mode === 'box' && state.phase === 'plan') ? state.box : null;
      if (showBox) {
        const legs = state.phase === 'survey' ? state.survey.legs : planLegs(site, showBox);
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        for (const l of legs) { ctx.beginPath(); ctx.moveTo(b.x + l.x0 * cp, b.y + l.y * cp); ctx.lineTo(b.x + l.x1 * cp, b.y + l.y * cp); ctx.stroke(); }
        ctx.setLineDash([]); ctx.strokeStyle = state.phase === 'survey' ? '#ffd27a' : `rgba(255,210,122,${0.7 + 0.3 * Math.sin(now / 300)})`; ctx.lineWidth = 2;
        ctx.strokeRect(b.x + showBox.x * cp, b.y + showBox.y * cp, showBox.w * cp, showBox.h * cp);
        ctx.restore();
      }
      // The ship on her line, with the swath she is painting.
      if (state.ship && (state.phase === 'survey' || state.survey)) {
        const x = b.x + state.ship.x * cp, y = b.y + state.ship.y * cp, hw = site.swathCells / 2 * cp;
        if (state.phase === 'survey') { ctx.fillStyle = 'rgba(125,255,176,.18)'; ctx.fillRect(x - 3, y - hw, 6, hw * 2); }
        ctx.save(); ctx.translate(x, y); ctx.rotate(state.ship.heading);
        ctx.fillStyle = '#ff6b4a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -5); ctx.lineTo(-7, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // Inspect cursor.
      if (state.phase === 'plan' && mode === 'inspect') {
        const x = b.x + state.cursor.x * cp, y = b.y + state.cursor.y * cp, r = Math.max(8, cp * 0.9);
        ctx.strokeStyle = isCovered(state, state.cursor.x, state.cursor.y) ? '#7dffb0' : '#ff9d7d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x - r - 5, y); ctx.lineTo(x - r + 4, y); ctx.moveTo(x + r - 4, y); ctx.lineTo(x + r + 5, y); ctx.moveTo(x, y - r - 5); ctx.lineTo(x, y - r + 4); ctx.moveTo(x, y + r - 4); ctx.lineTo(x, y + r + 5); ctx.stroke();
      }
      // Scale bar.
      const barKm = site.wreck.boxKm >= 6 ? 2 : site.wreck.boxKm >= 3 ? 1 : 0.5, barPx = barKm * 1000 / site.cellM * cp;
      ctx.fillStyle = '#fff'; ctx.fillRect(b.x + 8, b.y + b.size - 12, barPx, 3); ctx.font = '10px system-ui, sans-serif'; ctx.fillText(`${barKm} km`, b.x + 8, b.y + b.size - 16);
      ctx.fillText('N ↑', b.x + b.size - 28, b.y + 14);
      drawWaterfall(b);
      if (state.phase === 'dive' && diveAnim) drawDive(now, b);
    }

    // The waterfall: the latest pings of the current line, newest at the top.
    function drawWaterfall(b) {
      const wx = b.x + b.size + 8, ww = width - wx - 4, wh = b.size;
      ctx.fillStyle = '#05100f'; ctx.fillRect(wx, b.y, ww, wh);
      if (waterfall) ctx.drawImage(waterfall, wx, b.y, ww, wh);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(wx + ww * 0.47, b.y, ww * 0.06, wh);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.strokeRect(wx + 0.5, b.y + 0.5, ww - 1, wh - 1);
      ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText(state.site.sonar.mode === 'side-scan' ? 'side-scan waterfall' : 'multibeam waterfall', wx + 4, b.y + 12);
      ctx.fillText('port', wx + 4, b.y + wh - 6); ctx.fillText('stbd', wx + ww - 26, b.y + wh - 6);
      if (!state.survey) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillText('no pings yet', wx + 4, b.y + 26); }
    }
    function pushPing(cellsMoved) {
      if (!waterfall || !state.ship) return;
      const c = waterfall.getContext('2d'), rows = Math.max(1, Math.round(cellsMoved * MOSAIC_PX)), hw = state.site.swathCells / 2;
      c.drawImage(waterfall, 0, 0, waterfall.width, waterfall.height - rows, 0, rows, waterfall.width, waterfall.height - rows);
      const sx = Math.min(GRID * MOSAIC_PX - 1, Math.max(0, state.ship.x * MOSAIC_PX)), sy = (state.ship.y - hw) * MOSAIC_PX, sh = Math.max(1, hw * 2 * MOSAIC_PX);
      c.save();
      if (state.ship.heading > 1) { c.translate(waterfall.width, 0); c.scale(-1, 1); }   // port stays on the left whichever way she runs
      c.drawImage(mosaic, sx, sy, 1, sh, 0, 0, waterfall.width, rows);
      c.restore();
    }

    // ROV descent: the water column darkens with depth, then the lights find the contact.
    function drawDive(now, b) {
      const a = diveAnim, t = Math.min(1, (now - a.start) / a.duration);
      const wx = b.x + b.size * 0.15, wy = b.y + b.size * 0.1, ws = b.size * 0.7;
      ctx.fillStyle = 'rgba(3,12,20,.9)'; ctx.fillRect(b.x, b.y, b.size, b.size);
      const descent = Math.min(1, t / 0.7), bottom = t > 0.7;
      const grad = ctx.createLinearGradient(0, wy, 0, wy + ws);
      grad.addColorStop(0, '#2a7f9a'); grad.addColorStop(0.5, '#0f3d52'); grad.addColorStop(1, '#03111a');
      ctx.fillStyle = grad; ctx.fillRect(wx, wy, ws, ws);
      const rovY = wy + 14 + descent * (ws - 60);
      if (bottom) {
        const reveal = Math.min(1, (t - 0.7) / 0.3);
        ctx.save(); ctx.beginPath(); ctx.arc(wx + ws / 2, wy + ws - 40, 24 + reveal * ws * 0.4, 0, Math.PI * 2); ctx.clip();
        drawSeabedView(wx, wy + ws * 0.5, ws, ws * 0.5, a.hit ? 'wreck' : a.what, state.site.sonar.mode === 'side-scan');
        ctx.restore();
      }
      ctx.fillStyle = '#ffd27a'; ctx.fillRect(wx + ws / 2 - 10, rovY, 20, 12); ctx.fillStyle = '#fff'; ctx.fillRect(wx + ws / 2 - 6, rovY + 3, 4, 4); ctx.fillRect(wx + ws / 2 + 2, rovY + 3, 4, 4);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(wx + ws / 2, wy); ctx.lineTo(wx + ws / 2, rovY); ctx.stroke();
      ctx.font = '700 13px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(bottom ? (a.hit ? `On the bottom · ${state.site.wreck.ship}` : `On the bottom · ${a.what === 'seabed' ? 'nothing but seabed' : a.what}`) : `ROV descending · ${Math.round(descent * state.site.depth)} m`, wx + 8, wy + 18);
      if (t >= 1) { ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#ffe4a8'; ctx.fillText(a.hit ? 'Enter logs the discovery' : 'Enter recovers the ROV', wx + 8, wy + ws - 8); }
    }

    // What the ROV camera sees on the bottom: sediment, then the contact in its lights.
    function drawSeabedView(x, y, w, h, kind, shallow) {
      ctx.fillStyle = shallow ? '#6b5a3c' : '#4c5a55'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (let i = 0; i < 40; i++) { const px = x + ((i * 97) % 100) / 100 * w, py = y + h * 0.35 + ((i * 53) % 100) / 100 * h * 0.6; ctx.beginPath(); ctx.ellipse(px, py, 3 + (i % 3), 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
      const cx = x + w / 2, floor = y + h * 0.78;
      ctx.save(); ctx.translate(cx, floor);
      if (kind === 'wreck') {
        // A hull on her side: keel, frames standing like ribs, a stump of mast and the planking gone between them.
        const L = w * 0.62, H = h * 0.42;
        ctx.strokeStyle = '#d9c39c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.quadraticCurveTo(-L * 0.45, -H * 0.15, -L * 0.3, -H * 0.2); ctx.lineTo(L * 0.42, -H * 0.2); ctx.quadraticCurveTo(L * 0.5, -H * 0.4, L * 0.52, -H * 0.9); ctx.stroke();
        ctx.lineWidth = 3;
        for (let i = -0.28; i <= 0.4; i += 0.08) { const fx = i * L, fh = H * (0.7 + 0.3 * Math.sin((i + 0.3) * 4)); ctx.beginPath(); ctx.moveTo(fx, -H * 0.2); ctx.quadraticCurveTo(fx + L * 0.03, -H * 0.2 - fh * 0.6, fx + L * 0.02, -H * 0.2 - fh); ctx.stroke(); }
        ctx.fillStyle = '#c9b48f'; ctx.fillRect(-L * 0.1, -H * 0.2 - H * 0.05, L * 0.42, H * 0.06);
        ctx.strokeStyle = '#b39e78'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(L * 0.05, -H * 0.2); ctx.lineTo(L * 0.3, -H * 1.05); ctx.stroke();
        ctx.fillStyle = 'rgba(120,180,150,.35)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-L * 0.25 + i * L * 0.1, -H * 0.25 - (i % 2) * 6, 5, 0, Math.PI * 2); ctx.fill(); }
      } else if (kind === 'boulder') {
        ctx.fillStyle = '#7d8478'; ctx.beginPath(); ctx.moveTo(-w * 0.18, 0); ctx.quadraticCurveTo(-w * 0.2, -h * 0.5, -w * 0.02, -h * 0.55); ctx.quadraticCurveTo(w * 0.18, -h * 0.5, w * 0.2, -h * 0.1); ctx.quadraticCurveTo(w * 0.1, h * 0.02, -w * 0.18, 0); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(-w * 0.04, -h * 0.35, w * 0.08, h * 0.1, -0.5, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'outcrop') {
        ctx.fillStyle = '#6f6a62'; ctx.beginPath(); ctx.moveTo(-w * 0.4, 0); ctx.lineTo(-w * 0.3, -h * 0.3); ctx.lineTo(-w * 0.1, -h * 0.25); ctx.lineTo(0, -h * 0.55); ctx.lineTo(w * 0.15, -h * 0.35); ctx.lineTo(w * 0.35, -h * 0.4); ctx.lineTo(w * 0.42, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.1); ctx.lineTo(w * 0.3, -h * 0.2); ctx.stroke();
      } else {
        // An iceberg scour or bare sediment: a groove with berms, and nothing else.
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, -h * 0.05, w * 0.42, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.ellipse(0, -h * 0.2, w * 0.45, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ---- sizing ----------------------------------------------------------------------------
    function fit() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(240, Math.round(rect.width)), h = Math.round(picking() ? w * (w < 520 ? 0.95 : 0.62) : Math.min(w * 0.76, Math.max(320, w * 0.74)));   // the plot gets taller on a phone
      const d = Math.min(3, window.devicePixelRatio || 1);
      if (w === width && h === height && d === dpr) return;
      width = w; height = h; dpr = d;
      canvas.style.height = `${h}px`; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layoutPlot();
    }

    // ---- panel -----------------------------------------------------------------------------
    // Where the ship can actually get to: a datum on a beach or in a bay narrower than a chart cell is
    // further from charted water than the shell's on-station radius allows for.
    const chartNote = w => w.chart?.cell === 'off' ? 'The datum lies off the edge of the game\'s chart.'
      : w.chart?.nearestWaterKm > BEACH_KM ? `Charted water is ${km(w.chart.nearestWaterKm)} from the datum${w.chart.cell === 'land' ? ', which the chart holds as land' : ''}.` : null;
    const summary = w => `${km(w.distanceKm)} ${compass(w.bearing)} · ${w.depth.m} m · difficulty ${w.budget.difficulty} of 6 · ${w.found ? `located ${w.found}` : 'never found'}`;
    function renderPanel() {
      if (phase === 'pick') {
        const w = wrecks[selected];
        panel.innerHTML = `
          <h4>Choose a target</h4>
          <ol class="c18-list" data-list>${wrecks.map((x, i) => `<li><button type="button" data-pick="${i}" class="${i === selected ? 'c18-picked' : ''}" aria-pressed="${i === selected}"><b>${esc(x.ship)}</b> <span>${x.year}</span><small>${summary(x)}</small>${chartNote(x) ? `<small class="c18-warn">${esc(chartNote(x))}</small>` : ''}</button></li>`).join('')}</ol>
          <div class="c18-story" data-story></div>
          <p class="c18-status" role="status" aria-live="polite" data-status></p>
          <button type="button" class="c18-primary" data-go></button>
          <p class="c18-help"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> ${canSteam ? 'steam to the datum' : 'survey from here'} · click a mark on the plot</p>`;
        find('[data-legend]').innerHTML = `<span><i style="background:#f4f1e6"></i>never found</span><span><i style="background:#ffd27a"></i>located</span><span><i style="background:#ff6b4a"></i>Amundsen</span><span>rings: great-circle range, square-root scale</span>`;
        panel.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { select(Number(b.dataset.pick)); }, { signal }));
        find('[data-go]').addEventListener('click', choose, { signal });
        select(selected);
        return;
      }
      if (phase === 'steaming') {
        const w = wrecks[selected];
        panel.innerHTML = `
          <h4>Under way</h4>
          <p class="c18-status" role="status" aria-live="polite" data-status>Steaming to ${esc(w.ship)} · the survey begins when the ship is on the datum</p>
          <dl class="c18-readouts">
            <div><dt>Datum</dt><dd>${esc(formatPosition(w.lat, w.lon))}</dd></div>
            <div><dt>Range</dt><dd>${km(w.distanceKm)} ${compass(w.bearing)} (${Math.round(w.bearing).toString().padStart(3, '0')}°)</dd></div>
          </dl>
          <button type="button" data-back>Choose another <kbd>Backspace</kbd></button>`;
        find('[data-back]').addEventListener('click', backToPick, { signal });
        return;
      }
      if (phase === 'plan' || phase === 'survey' || phase === 'dive') {
        const { site } = state, w = site.wreck;
        panel.innerHTML = `
          <div class="c18-clue"><b>FROM THE RECORD · ${esc(w.ship)}, ${w.year}</b>${esc(w.clue)}</div>
          <dl class="c18-readouts">
            <div><dt>Seabed</dt><dd>${site.depth} m${w.depth.source === 'gebco' ? ' (GEBCO)' : w.depth.source === 'archive' ? ' (record)' : ' (estimate)'}</dd></div>
            <div><dt>Sonar</dt><dd>${site.sonar.label}, ${site.sonar.swathM} m swath</dd></div>
            <div><dt>Box</dt><dd data-box>—</dd></div>
            <div><dt>Lines</dt><dd data-lines>—</dd></div>
            <div><dt>ROV dive</dt><dd>${hours(diveHours(site.depth))} to ${site.depth} m and back</dd></div>
            <div><dt>Surveyed</dt><dd data-coverage>0 %</dd></div>
          </dl>
          <p class="c18-status" role="status" aria-live="polite" data-status></p>
          <div class="c18-modes" role="group" aria-label="Mode">
            <button type="button" data-mode="box" aria-pressed="true">Plan box <kbd>P</kbd></button>
            <button type="button" data-mode="inspect" aria-pressed="false">Inspect <kbd>I</kbd></button>
          </div>
          <div class="c18-controls">
            <div class="c18-dpad" role="group" aria-label="Move">
              <button type="button" data-dir="0,-1" aria-label="Up">▲</button>
              <button type="button" data-dir="-1,0" aria-label="Left">◀</button>
              <button type="button" data-dir="1,0" aria-label="Right">▶</button>
              <button type="button" data-dir="0,1" aria-label="Down">▼</button>
            </div>
            <div class="c18-actions">
              <button type="button" class="c18-primary" data-run>Run survey <kbd>Enter</kbd><small data-run-note></small></button>
              <button type="button" data-dive>Drop ROV <kbd>Enter</kbd><small>on the cursor</small></button>
              <div class="c18-row"><button type="button" data-grow aria-label="Bigger box">Bigger <kbd>+</kbd></button><button type="button" data-shrink aria-label="Smaller box">Smaller <kbd>−</kbd></button><button type="button" data-fast aria-pressed="false">×${FAST} <kbd>F</kbd></button></div>
            </div>
          </div>
          <p class="c18-help">Arrows or <kbd>WASD</kbd> move the box; <kbd>Shift</kbd>+arrows resize it. Drag on the seabed to draw a box, click to place the cursor. Surveying runs at ${SURVEY_KN} kn; the clock is ship time.</p>`;
        find('[data-legend]').innerHTML = `<span><i style="background:#3f6572"></i>unsurveyed</span><span><i style="background:${site.sonar.mode === 'side-scan' ? '#b58a3c' : '#5a8c9a'}"></i>sonar mosaic</span><span><i style="background:#5a5648"></i>shore</span><span><i style="border:2px solid #ffd27a;background:none"></i>planned box</span><span><i style="background:#ff8c6b"></i>datum</span><span><i style="background:#ff6b4a"></i>ship</span>`;
        panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode), { signal }));
        panel.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => move(...b.dataset.dir.split(',').map(Number), false), { signal }));
        find('[data-run]').addEventListener('click', run, { signal });
        find('[data-dive]').addEventListener('click', drop, { signal });
        find('[data-grow]').addEventListener('click', () => resize(1, 1), { signal });
        find('[data-shrink]').addEventListener('click', () => resize(-1, -1), { signal });
        find('[data-fast]').addEventListener('click', () => { fast = !fast; readouts(); }, { signal });
        readouts();
      }
    }
    function readouts() {
      if (!state) return;
      const { site } = state;
      find('[data-clock]').textContent = hours(Math.max(0, state.hoursLeft));
      find('[data-clock]').parentElement.classList.toggle('c18-late', state.hoursLeft < site.budgetH * 0.2);
      const s = score(state);
      find('[data-points]').textContent = state.result ? state.result.points : s.points;
      find('[data-points-label]').textContent = state.result ? 'points' : 'if found now';
      const cost = planCost(site, state.box);
      const boxEl = find('[data-box]'); if (!boxEl) return;
      boxEl.textContent = `${(state.box.w * site.cellM / 1000).toFixed(1)} × ${(state.box.h * site.cellM / 1000).toFixed(1)} km`;
      find('[data-lines]').textContent = `${cost.lines} × ${km(state.box.w * site.cellM / 1000)} · ${hours(cost.hours)}`;
      find('[data-coverage]').textContent = `${Math.round(state.covered.reduce((a, b) => a + b, 0) / (GRID * GRID) * 100)} % of the box · ${km(state.kmRun)} run`;
      const over = cost.hours > state.hoursLeft, runBtn = find('[data-run]'), diveBtn = find('[data-dive]');
      runBtn.disabled = state.phase !== 'plan' || over; runBtn.querySelector('small').textContent = over ? `needs ${hours(cost.hours)}, ${hours(state.hoursLeft)} left` : `${hours(cost.hours)} of ship time`;
      runBtn.hidden = mode !== 'box'; diveBtn.hidden = mode !== 'inspect';
      const covered = isCovered(state, state.cursor.x, state.cursor.y);
      diveBtn.disabled = state.phase !== 'plan' || !covered || diveHours(site.depth) > state.hoursLeft;
      diveBtn.querySelector('small').textContent = covered ? `${hours(diveHours(site.depth))} of ship time` : 'move onto surveyed seabed';
      panel.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      find('[data-fast]').setAttribute('aria-pressed', String(fast));
      find('[data-grow]').hidden = find('[data-shrink]').hidden = mode !== 'box';
    }

    // ---- actions ---------------------------------------------------------------------------
    function select(i) {
      if (phase !== 'pick') return;
      selected = (i + wrecks.length) % wrecks.length;
      panel.querySelectorAll('[data-pick]').forEach((b, k) => { b.classList.toggle('c18-picked', k === selected); b.setAttribute('aria-pressed', String(k === selected)); });
      const w = wrecks[selected], note = chartNote(w);
      find('[data-story]').innerHTML = `<b>${esc(w.place)} · ${esc(w.date)}</b><p>${esc(w.story)}</p>
        <div class="c18-clue"><b>FROM THE RECORD</b>${esc(w.clue)}</div>
        <small>${esc(w.positionNote)}</small>${note ? `<small class="c18-warn">${esc(note)}</small>` : ''}`;
      find('[data-go]').innerHTML = canSteam
        ? `Steam to ${esc(w.ship)} <kbd>Enter</kbd><small>${km(w.distanceKm)} ${compass(w.bearing)} · ${w.budget.sonar.label}, ${hours(w.budget.budgetH)} of ship time on site</small>`
        : `Survey ${esc(named(w.ship))} <kbd>Enter</kbd><small>${w.budget.sonar.label}, ${hours(w.budget.budgetH)} of ship time</small>`;
      panel.querySelector(`[data-pick="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }
    function backToPick() { setPhase('pick'); find('[data-title]').textContent = 'Shipwrecks of the archive'; renderPanel(); }
    // Enter on the picker: hand the ship to the shell if it can steam, otherwise search from here.
    function choose() {
      if (phase !== 'pick') return;
      const w = wrecks[selected];
      if (!canSteam) return begin(w, false);
      setPhase('steaming'); find('[data-title]').textContent = `Steaming to ${w.ship}`; renderPanel();
      // The shell closes the dialog (running cleanup) inside steamTo, so nothing here may touch the DOM after it.
      try { expedition.steamTo({ id: w.id, ship: w.ship, year: w.year, lon: w.lon, lat: w.lat, place: w.place }); }
      catch (error) { console.error(error); if (active) { backToPick(); say('The bridge could not lay the course. Choose again.'); } }
    }
    function begin(w, onStation) {
      state = createGame(w, seed);
      mosaic = buildMosaic(state.site);
      waterfall = document.createElement('canvas'); waterfall.width = 160; waterfall.height = GRID * MOSAIC_PX;
      mode = 'box'; fast = false;
      find('[data-title]').textContent = `${w.ship}, ${w.year} · ${w.place}`;
      setPhase('plan'); fit(); renderPanel();
      say(`${onStation ? `On station over the ${w.short} datum, ${formatPosition(w.lat, w.lon)}` : `${formatPosition(w.lat, w.lon)}, ${km(w.distanceKm)} ${compass(w.bearing)} of the ship`}. ${hours(state.site.budgetH)} of ship time. Read the record, box the likely water, run the lines.`);
    }
    function setMode(next) {
      if (!state || state.phase === 'done') return;
      mode = next; readouts();
      say(mode === 'box' ? 'Planning: move and size the box, then run the lines.' : 'Inspecting: move the cursor onto a contact in the mosaic and drop the ROV.');
    }
    function move(dx, dy, resizing) {
      if (!state || state.phase !== 'plan') return;
      if (mode === 'box') { if (resizing) resize(dx, dy); else state.box = clampBox({ ...state.box, x: state.box.x + dx, y: state.box.y + dy }); }
      else {
        state.cursor = { x: Math.max(0.5, Math.min(GRID - 0.5, state.cursor.x + dx)), y: Math.max(0.5, Math.min(GRID - 0.5, state.cursor.y + dy)) };
        const what = isCovered(state, state.cursor.x, state.cursor.y) ? contactAt(state.site, state.cursor.x, state.cursor.y, 0.9) : null;
        say(!isCovered(state, state.cursor.x, state.cursor.y) ? 'Unsurveyed seabed under the cursor.' : what ? 'A contact under the cursor. Drop the ROV to identify it.' : 'Surveyed seabed under the cursor, no contact.');
      }
      readouts();
    }
    function resize(dw, dh) { if (!state || state.phase !== 'plan') return; state.box = clampBox({ ...state.box, w: state.box.w + dw, h: state.box.h + dh }); readouts(); }
    function run() {
      if (!state || state.phase !== 'plan') return;
      const r = startSurvey(state, state.box);
      if (!r.ok) { say(r.reason === 'over budget' ? `Those lines need ${hours(r.cost.hours)}; only ${hours(state.hoursLeft)} of ship time is left. Shrink the box.` : 'Not now.'); return; }
      const c = waterfall.getContext('2d'); c.fillStyle = '#05100f'; c.fillRect(0, 0, waterfall.width, waterfall.height);
      setPhase('survey');
      say(`Running ${r.cost.lines} line${r.cost.lines === 1 ? '' : 's'} at ${SURVEY_KN} kn. Watch the waterfall for a hard return with a shadow.`);
      readouts();
    }
    function drop() {
      if (!state || state.phase !== 'plan') return;
      const r = dive(state);
      if (!r.ok) { say(r.reason === 'unsurveyed' ? 'The ROV goes where the sonar has been: move the cursor onto surveyed seabed.' : r.reason === 'over budget' ? 'Not enough ship time left for a dive.' : 'Not now.'); return; }
      diveAnim = { start: performance.now(), duration: Math.min(8000, 3500 + state.site.depth * 6), hit: r.hit, what: r.what };
      setPhase('dive');
      say('The ROV is on its way down.');
      readouts();
    }
    function afterDive() {
      if (!state || state.phase !== 'dive' || !diveAnim || performance.now() - diveAnim.start < diveAnim.duration) return;
      const last = state.dives.at(-1);
      endDive(state); diveAnim = null;
      if (state.result) return finishGame();
      mode = 'inspect'; setPhase('plan'); readouts();
      say(last.what === 'seabed' ? 'Nothing down there but seabed. The ROV is back aboard.' : `That was ${last.what === 'boulder' ? 'a boulder' : last.what === 'scour' ? 'an iceberg scour' : 'a rock outcrop'}, not a hull. The ROV is back aboard.`);
    }
    function finishGame() {
      if (awarded || !state?.result) return;
      awarded = true;
      const r = state.result, w = state.site.wreck, debrief = find('[data-debrief]');
      setPhase('done'); readouts();
      debrief.hidden = false;
      debrief.innerHTML = r.found
        ? `<h4>${esc(r.title)}</h4>
           <ul>
             <li>Identified in ${r.depthM} m by ${r.sonar}: ${r.surveys} survey${r.surveys === 1 ? '' : 's'}, ${r.kmRun} km of lines, ${r.dives} dive${r.dives === 1 ? '' : 's'} (${r.falseDives} on false contacts)</li>
             <li>${hours(r.hoursUsed)} of the ${hours(r.budgetH)} of ship time; difficulty ${r.difficulty} of 6</li>
             <li>${esc(w.positionNote)}</li>
           </ul>
           <p><b>${r.points} points.</b> Close this window to return to the bridge; launch again (<kbd>V</kbd>) for another wreck.</p>`
        : `<h4>${esc(r.title)}</h4>
           <ul>
             <li>${hours(r.budgetH)} of ship time spent on ${r.surveys} survey${r.surveys === 1 ? '' : 's'}, ${r.kmRun} km of lines and ${r.dives} dive${r.dives === 1 ? '' : 's'}; too little left for another dive</li>
             <li>The record said: ${esc(w.clue)}</li>
           </ul>
           <p><b>0 points.</b> Close and launch again to try this or another wreck.</p>`;
      panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
      say(r.found ? `${w.ship} logged.` : 'Search called off: not enough ship time left for another dive.');
      complete(r.points, r);
    }

    // ---- loop ------------------------------------------------------------------------------
    function loop(now) {
      frame = 0;
      if (!active) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      fit();
      if (picking()) { if (wrecks.length) drawPlot(now); else { ctx.fillStyle = '#183b4a'; ctx.fillRect(0, 0, width, height); } }
      else if (state) {
        if (state.phase === 'survey') {
          const before = state.ship ? { ...state.ship } : null;
          const ev = advanceSurvey(state, dt * state.site.budgetH / SURVEY_SECONDS * (fast ? FAST : 1));
          if (before && state.ship && state.ship.y === before.y) pushPing(Math.abs(state.ship.x - before.x));
          if (ev === 'done') { mode = 'inspect'; setPhase('plan'); say('Lines complete. Inspect the mosaic: a hull is long with a hard return and a shadow; boulders are round and small.'); }
          else if (ev === 'timeout') finishGame();
          readouts();
        } else if (state.phase === 'dive') afterDive();
        drawSearch(now);
      }
      frame = requestAnimationFrame(loop);
    }

    // ---- input -----------------------------------------------------------------------------
    const isTyping = target => target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    document.addEventListener('keydown', event => {
      if (!active || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if ((key === ' ' || key === 'Enter') && event.target?.closest?.('button')) return;
      let handled = true;
      if (phase === 'pick') {
        if (key === 'ArrowDown' || key === 's' || key === 'ArrowRight' || key === 'd') select(selected + 1);
        else if (key === 'ArrowUp' || key === 'w' || key === 'ArrowLeft' || key === 'a') select(selected - 1);
        else if (key === 'Enter' || key === ' ') choose();
        else handled = false;
      } else if (phase === 'steaming') {
        if (key === 'Backspace') backToPick();
        else handled = false;
      } else if (state && state.phase === 'plan') {
        if (ARROWS[key]) move(...ARROWS[key], event.shiftKey);
        else if (key === 'Enter' || key === ' ') mode === 'box' ? run() : drop();
        else if (key === 'p') setMode('box');
        else if (key === 'i') setMode('inspect');
        else if (key === '+' || key === '=') resize(1, 1);
        else if (key === '-' || key === '_') resize(-1, -1);
        else handled = false;
      } else if (state && state.phase === 'survey') {
        if (key === 'f' || key === ' ' || key === 'Enter') { fast = !fast; readouts(); }
        else handled = false;
      } else if (state && state.phase === 'dive') {
        if (key === 'Enter' || key === ' ' || key === 'f') { if (diveAnim) diveAnim.start = Math.min(diveAnim.start, performance.now() - diveAnim.duration); }
        else handled = false;
      } else handled = false;
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    }, { capture: true, signal });

    // Pointer: pick a wreck on the plot; drag a box or click a cursor on the seabed.
    let drag = null;
    const canvasPoint = event => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * width / r.width, y: (event.clientY - r.top) * height / r.height }; };
    const nearestMarker = p => { let best = -1, bd = 18; plot.markers.forEach((m, i) => { const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; best = i; } }); return best; };
    canvas.addEventListener('pointerdown', event => {
      if (!active) return;
      const p = canvasPoint(event);
      if (phase === 'pick') { const i = nearestMarker(p); if (i >= 0) { if (i === selected && event.detail > 1) choose(); else select(i); } return; }
      if (picking()) return;
      if (!state || state.phase !== 'plan') return;
      event.preventDefault(); canvas.setPointerCapture?.(event.pointerId);
      drag = { start: p, cell: toCell(p.x, p.y), moved: false };
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      const p = canvasPoint(event);
      if (picking()) { hover = nearestMarker(p); return; }
      if (!drag || !state || state.phase !== 'plan') return;
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 5) return;
      drag.moved = true; if (mode !== 'box') { mode = 'box'; }
      const c = toCell(p.x, p.y), x0 = Math.floor(Math.min(drag.cell.x, c.x)), y0 = Math.floor(Math.min(drag.cell.y, c.y));
      state.box = clampBox({ x: x0, y: y0, w: Math.ceil(Math.max(drag.cell.x, c.x)) - x0, h: Math.ceil(Math.max(drag.cell.y, c.y)) - y0 });
      readouts();
    }, { signal });
    const endDrag = event => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!state || state.phase !== 'plan') return;
      if (!d.moved) { const c = toCell(canvasPoint(event).x, canvasPoint(event).y); if (c.x >= 0 && c.y >= 0 && c.x < GRID && c.y < GRID) { mode = 'inspect'; state.cursor = { x: Math.floor(c.x) + 0.5, y: Math.floor(c.y) + 0.5 }; move(0, 0, false); } }
      else say(`Box drawn: ${planCost(state.site, state.box).lines} lines. Enter runs them.`);
      readouts();
    };
    canvas.addEventListener('pointerup', endDrag, { signal });
    canvas.addEventListener('pointercancel', () => { drag = null; }, { signal });
    canvas.addEventListener('dblclick', event => { if (state?.phase === 'plan' && mode === 'inspect') { event.preventDefault(); drop(); } }, { signal });
    canvas.addEventListener('pointerleave', () => { hover = -1; }, { signal });

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fit(); }) : null;
    observer?.observe(canvas);
    frame = requestAnimationFrame(loop);

    return () => {
      active = false;
      events.abort();
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      root.innerHTML = '';
    };
  },
};
