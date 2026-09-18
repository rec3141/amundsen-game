import {
  NETS, SPECIES, netById, speciesById, createGame, startTow, step, haul, sell, buy, select, finish, score, towsLeft, sampleValue,
  speciesCount, keelDepth, seabedAt, canCatch, deepLayerTop, TOW_SECONDS, TOW_BUDGET, TOW_SPEED, WINCH_SPEED, VIEW_WIDTH, VIEW_HEIGHT, NET_X, HITS_TO_TEAR, SPECIES_POINTS, COLLECTION_BONUS,
} from './crew-9-model.js';
import { createAudio } from './crew-9-audio.js';

const stylesheet = new URL('./crew-9.css', import.meta.url).href;
const W = 960, H = 540;
const SX = W / VIEW_WIDTH, SZ = H / VIEW_HEIGHT;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HABITAT_HINT = { chl: 'around the fluorescence maximum', upper: 'upper water column', mid: 'mid-water, quick', deep: 'deep, below the pycnocline', ice: 'right under the ice', bottom: 'on the seabed' };
const REASON_HINT = { mesh: 'finer mesh', dodged: 'a wider mouth', seabed: 'benthic gear', above: 'a pelagic net' };

function hintFor(reason) {
  if (reason.startsWith('through')) return REASON_HINT.mesh;
  if (reason.startsWith('dodged')) return REASON_HINT.dodged;
  if (reason.startsWith('on the')) return REASON_HINT.seabed;
  return REASON_HINT.above;
}

// Vector animals, drawn centred on (0, 0) in a `size`-pixel box. Also used for the collection icons.
function drawAnimal(ctx, species, t = 0, wobble = 1) {
  const s = species.size, c = species.color;
  ctx.save();
  ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  switch (species.shape) {
    case 'copepod': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.28, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.1); ctx.lineTo(-s * 1.1, -s * 0.55 * wobble); ctx.moveTo(-s * 0.3, s * 0.1); ctx.lineTo(-s * 1.1, s * 0.55 * wobble); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.45, 0); ctx.lineTo(s * 0.9, -s * 0.2); ctx.moveTo(s * 0.45, 0); ctx.lineTo(s * 0.9, s * 0.2); ctx.stroke();
      ctx.fillStyle = '#c33'; ctx.beginPath(); ctx.arc(-s * 0.3, 0, s * 0.07, 0, 6.29); ctx.fill();
      break;
    }
    case 'pteropod': {
      const flap = 0.6 + 0.4 * Math.sin(t * 6) * wobble;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-s * 0.9, -s * 0.9 * flap, -s * 0.9, 0); ctx.quadraticCurveTo(-s * 0.4, s * 0.1, 0, 0);
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.9, -s * 0.9 * flap, s * 0.9, 0); ctx.quadraticCurveTo(s * 0.4, s * 0.1, 0, 0); ctx.fill();
      ctx.strokeStyle = '#8a6c8a'; ctx.beginPath(); ctx.arc(0, s * 0.3, s * 0.3, 0, 5); ctx.stroke();
      break;
    }
    case 'angel': {
      const flap = Math.sin(t * 5) * 0.3 * wobble;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.25, s * 0.6, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 0.5, -s * 0.05, s * 0.4, s * 0.16, -0.6 + flap, 0, 6.29); ctx.ellipse(s * 0.5, -s * 0.05, s * 0.4, s * 0.16, 0.6 - flap, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#e3405f'; ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.12, 0, 6.29); ctx.fill();
      break;
    }
    case 'jelly': {
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.45, s * 0.5, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); for (let i = -2; i <= 2; i++) { ctx.moveTo(i * s * 0.18, -s * 0.12); ctx.lineTo(i * s * 0.18 + Math.sin(t * 3 + i) * 2 * wobble, s * 0.7); } ctx.stroke();
      break;
    }
    case 'ctenophore': {
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.35, s * 0.55, 0, 0, 6.29); ctx.fill();
      ctx.strokeStyle = '#4fd0c9'; ctx.beginPath(); for (let i = -1; i <= 1; i++) { ctx.moveTo(i * s * 0.2, -s * 0.5); ctx.lineTo(i * s * 0.2, s * 0.5); } ctx.stroke();
      break;
    }
    case 'amphipod': {
      ctx.lineWidth = s * 0.28; ctx.beginPath(); ctx.arc(0, s * 0.15, s * 0.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = Math.PI * (1.15 + i * 0.16); ctx.moveTo(Math.cos(a) * s * 0.4, s * 0.15 + Math.sin(a) * s * 0.4); ctx.lineTo(Math.cos(a) * s * 0.4, s * 0.15 + Math.sin(a) * s * 0.4 + s * 0.35 + Math.sin(t * 8 + i) * wobble); } ctx.stroke();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.45, s * 0.05, s * 0.08, 0, 6.29); ctx.fill();
      break;
    }
    case 'fish': case 'sculpin': {
      const tail = Math.sin(t * 7) * 0.25 * wobble;
      const head = species.shape === 'sculpin' ? 0.42 : 0.28;
      ctx.beginPath(); ctx.moveTo(-s * 0.55, 0); ctx.quadraticCurveTo(-s * 0.2, -s * head, s * 0.35, -s * 0.08); ctx.lineTo(s * 0.5, -s * 0.22 + tail * s); ctx.lineTo(s * 0.5, s * 0.22 + tail * s); ctx.lineTo(s * 0.35, s * 0.08); ctx.quadraticCurveTo(-s * 0.2, s * head, -s * 0.55, 0); ctx.fill();
      if (species.shape === 'sculpin') { ctx.beginPath(); ctx.moveTo(-s * 0.25, -s * 0.3); ctx.lineTo(-s * 0.15, -s * 0.5); ctx.moveTo(-s * 0.1, -s * 0.33); ctx.lineTo(0, -s * 0.5); ctx.stroke(); }
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-s * 0.38, -s * 0.05, s * 0.06, 0, 6.29); ctx.fill();
      break;
    }
    case 'flatfish': {
      ctx.beginPath(); ctx.ellipse(-s * 0.05, 0, s * 0.5, s * 0.22, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.42, 0); ctx.lineTo(s * 0.58, -s * 0.15); ctx.lineTo(s * 0.58, s * 0.15); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-s * 0.32, -s * 0.06, s * 0.05, 0, 6.29); ctx.arc(-s * 0.24, -s * 0.1, s * 0.05, 0, 6.29); ctx.fill();
      break;
    }
    case 'star': {
      ctx.lineWidth = 1.6; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = i * 1.257 - 1.57; ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a + 0.3) * s * 0.35, Math.sin(a + 0.3) * s * 0.35, Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6); } ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, 6.29); ctx.fill();
      break;
    }
    case 'urchin': {
      ctx.beginPath(); for (let i = 0; i < 14; i++) { const a = i * 0.449; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55); } ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, 6.29); ctx.fill();
      break;
    }
    case 'worm': {
      ctx.lineWidth = s * 0.16; ctx.beginPath(); ctx.moveTo(-s * 0.6, 0); for (let i = 1; i <= 6; i++) ctx.lineTo(-s * 0.6 + i * s * 0.2, Math.sin(i * 1.6 + t * 4) * s * 0.15 * wobble); ctx.stroke();
      break;
    }
    case 'whelk': {
      ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.25); ctx.lineTo(s * 0.5, -s * 0.05); ctx.lineTo(s * 0.1, s * 0.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a6a48'; ctx.beginPath(); ctx.arc(-s * 0.15, s * 0.15, s * 0.22, 0, 5); ctx.stroke();
      break;
    }
    case 'crab': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.3, s * 0.22, 0, 0, 6.29); ctx.fill();
      ctx.lineWidth = 1.4; ctx.beginPath(); for (let i = -1; i <= 1; i += 2) for (let k = 0; k < 4; k++) { const y = -s * 0.15 + k * s * 0.1; ctx.moveTo(i * s * 0.25, y); ctx.lineTo(i * s * 0.6, y - s * 0.15 + Math.sin(t * 6 + k) * wobble); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.2); ctx.lineTo(-s * 0.35, -s * 0.45); ctx.moveTo(s * 0.15, -s * 0.2); ctx.lineTo(s * 0.35, -s * 0.45); ctx.stroke();
      break;
    }
    default: ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, 6.29); ctx.fill();
  }
  ctx.restore();
}

function iconFor(species) {
  const canvas = document.createElement('canvas');
  canvas.width = 44; canvas.height = 44; canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  ctx.translate(22, 22); ctx.scale(1.4, 1.4);
  drawAnimal(ctx, species, 0, 0);
  return canvas;
}

export const game = {
  title: 'Crazy Net',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const signal = events.signal;
    const position = Number.isFinite(expedition?.x) && Number.isFinite(expedition?.y) ? `net:${Math.round(expedition.x * 1000)}:${Math.round(expedition.y * 1000)}` : `net:${Date.now()}`;
    const seed = `${expedition?.seed ?? position}:${expedition?.operations?.length ?? 0}`;
    const iceCover = Number.isFinite(expedition?.ice?.concentration) ? expedition.ice.concentration : Number.isFinite(expedition?.ice?.percent) ? expedition.ice.percent / 100 : null;
    let state = createGame(seed, null, iceCover);
    let active = true, loaded = false, awarded = false, frame = 0, previous = 0, hauling = 0;
    const audio = createAudio();
    const keys = new Set();
    const held = { up: false, down: false, left: false, right: false };
    const labels = [];
    let startDepth = 10;

    root.innerHTML = `
      <section class="net-game" aria-label="Crazy Net plankton tow">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="net-heading"><div><p class="net-kicker">FIELD NOTEBOOK / NET TOWS</p>
          <h3>Tow the net. Miss the ice. Miss the rocks.</h3></div><div class="net-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="net-intro">Steer the towed net with the arrow keys or <kbd>WASD</kbd>. Keels reach down from the floes and boulders rise off the seabed; a bump spills the cod end and three bumps tear the net. Sell samples to the lab for the next net: finer mesh, wider mouth or benthic skids each open new species.</p>
        <div class="net-layout">
          <div class="net-main">
            <div class="net-stage">
              <canvas width="${W}" height="${H}" role="img" aria-label="Side view of the water column with the towed net"></canvas>
              <div class="net-hud" aria-hidden="true"><div class="net-depth" data-hud-depth></div><div class="net-gear" data-hud-gear></div><div class="net-hits" data-hud-hits></div><div class="net-bag" data-hud-bag></div><div class="net-timer" data-hud-timer><span data-hud-time></span><i><b data-hud-bar></b></i></div></div>
            </div>
            <div class="net-controls">
              <div class="net-pad" role="group" aria-label="Net winch and wire">
                <button type="button" data-move="up" aria-label="Haul in, up arrow">▲</button>
                <button type="button" data-move="left" aria-label="Lag behind, left arrow">◀</button>
                <button type="button" data-move="down" aria-label="Veer out, down arrow">▼</button>
                <button type="button" data-move="right" aria-label="Lead ahead, right arrow">▶</button>
              </div>
              <div class="net-actions">
                <button type="button" class="net-start" data-start disabled>Reading station…</button>
                <div class="net-depth-pick"><label for="net-depth-range">Start depth</label><input id="net-depth-range" type="range" min="2" max="100" step="1" value="10"><output data-depth-out>10 m</output></div>
                <div class="net-presets" role="group" aria-label="Start depth presets"><button type="button" data-preset="surface">Surface</button><button type="button" data-preset="chl">Fluorescence max</button><button type="button" data-preset="deep">Deep</button><button type="button" data-preset="bottom">Seabed</button></div>
              </div>
              <div class="net-side-buttons">
                <button type="button" data-music aria-pressed="false">♪ Theme <kbd>M</kbd></button>
                <button type="button" data-sell disabled>Sell samples <kbd>V</kbd></button>
              </div>
            </div>
          </div>
          <div class="net-panel">
            <div class="net-till"><div>Credits<strong data-credits>0</strong></div><div>Tows left<strong data-tows>${TOW_BUDGET}</strong></div><div>Samples in hand<strong data-samples>0</strong></div><div>Species<strong data-species>0 / ${SPECIES.length}</strong></div></div>
            <div class="net-shop"><h4>Gear locker <small>· keys 1–${NETS.length}</small></h4><ul data-shop></ul></div>
            <div class="net-collection"><h4>Collection</h4><ul data-collection></ul></div>
            <p class="net-source" data-source>Reading the station's CTD cast…</p>
          </div>
        </div>
        <div class="net-footer"><p role="status" aria-live="polite" data-status>Pick a start depth and a net, then tow.</p><button type="button" class="net-finish" data-finish>Finish station <kbd>F</kbd></button></div>
      </section>`;

    const section = root.querySelector('.net-game');
    const find = selector => section.querySelector(selector);
    const canvas = find('canvas');
    const ctx = canvas.getContext('2d');
    const dialog = root.closest('dialog');
    const startButton = find('[data-start]');
    const sellButton = find('[data-sell]');
    const finishButton = find('[data-finish]');
    const musicButton = find('[data-music]');
    const range = find('#net-depth-range');
    const status = find('[data-status]');
    const icons = Object.fromEntries(SPECIES.map(s => [s.id, iconFor(s)]));

    function say(text) { status.textContent = text; }

    function setDepth(value) {
      const max = state.station.bottom - 2;
      startDepth = Math.round(Math.min(max, Math.max(2, value)));
      range.max = String(max);
      range.value = String(startDepth);
      find('[data-depth-out]').textContent = `${startDepth} m`;
    }

    function preset(name) {
      const b = state.station.bottom;
      setDepth({ surface: 5, chl: state.station.chlDepth, deep: deepLayerTop(state.station) + 25, bottom: b - 3 }[name] ?? startDepth);
    }

    function renderShop() {
      const towing = Boolean(state.tow) || state.finished;
      find('[data-shop]').innerHTML = NETS.map((net, i) => {
        const owned = state.owned.includes(net.id);
        const current = state.net === net.id;
        const button = current ? `<button type="button" data-net="${net.id}" aria-pressed="true" disabled>In use</button>`
          : owned ? `<button type="button" data-net="${net.id}" ${towing ? 'disabled' : ''}>Use</button>`
          : `<button type="button" data-net="${net.id}" ${towing || state.credits < net.cost ? 'disabled' : ''}>Buy · ${net.cost} cr</button>`;
        return `<li class="${current ? 'net-current' : ''}"><div><strong>${i + 1}. ${escape(net.name)}</strong> <span>${net.benthic ? 'benthic' : 'pelagic'} · ${net.mesh} · ${net.mouth} m</span><small>${escape(net.note)}</small></div>${button}</li>`;
      }).join('');
    }

    function renderCollection() {
      const list = find('[data-collection]');
      list.replaceChildren(...SPECIES.map(s => {
        const li = document.createElement('li');
        const known = state.discovered[s.id] > 0;
        li.className = known ? '' : 'net-unknown';
        li.append(cloneIcon(s));
        const text = document.createElement('div');
        const inHand = state.collection[s.id] || 0;
        text.innerHTML = known
          ? `<i>${escape(s.name)}</i><small>${escape(s.common)} · ${s.value} cr each · ${HABITAT_HINT[s.habitat]}</small>`
          : `<i>Unknown</i><small>${HABITAT_HINT[s.habitat]} · ${s.mm >= 1 ? `${s.mm} mm` : `${s.mm * 1000} µm`}${canCatch(netById[state.net], s) ? '' : ' · not with this net'}</small>`;
        const count = document.createElement('b');
        count.textContent = known ? `${inHand ? `×${inHand} in hand` : `${state.discovered[s.id]} logged`}` : '?';
        li.append(text, count);
        return li;
      }));
    }

    function cloneIcon(species) {
      const canvas = document.createElement('canvas');
      canvas.width = 44; canvas.height = 44; canvas.setAttribute('aria-hidden', 'true');
      canvas.getContext('2d').drawImage(icons[species.id], 0, 0);
      return canvas;
    }

    function renderPanel() {
      find('[data-score]').textContent = score(state);
      find('[data-credits]').textContent = state.credits;
      find('[data-tows]').textContent = towsLeft(state);
      find('[data-samples]').textContent = state.samples;
      find('[data-species]').textContent = `${speciesCount(state)} / ${SPECIES.length}`;
      const value = sampleValue(state);
      sellButton.disabled = !value || state.finished;
      sellButton.innerHTML = `Sell samples${value ? ` · ${value} cr` : ''} <kbd>V</kbd>`;
      const towing = Boolean(state.tow);
      startButton.disabled = !loaded || state.finished || (!towing && towsLeft(state) <= 0);
      startButton.classList.toggle('net-hauling', towing);
      startButton.innerHTML = towing ? 'Haul now <kbd>Enter</kbd>' : state.finished ? 'Station logged' : towsLeft(state) <= 0 ? 'No ship time left' : !loaded ? 'Reading station…' : `Tow ${netById[state.net].name} <kbd>Enter</kbd>`;
      range.disabled = towing || state.finished;
      section.querySelectorAll('[data-preset]').forEach(b => { b.disabled = towing || state.finished; });
      finishButton.disabled = state.finished;
      finishButton.classList.toggle('net-due', !state.finished && towsLeft(state) <= 0);
      finishButton.innerHTML = state.finished ? 'Station logged ✓' : `Finish station · ${score(state)} pts <kbd>F</kbd>`;
      renderShop();
      renderCollection();
    }

    function renderSource() {
      const st = state.station;
      const parts = [];
      if (st.castId) parts.push(`${st.castId}${st.station ? ` · ${st.station}` : ''}`);
      parts.push(`bottom ${st.bottom} m`);
      if (st.chlValue != null) parts.push(`fluorescence max ${st.chlValue.toFixed(2)} µg/L at ${st.chlDepth} m`);
      if (st.temperatureSurface != null && st.temperatureBottom != null) parts.push(`${st.temperatureSurface.toFixed(1)} °C at the surface, ${st.temperatureBottom.toFixed(1)} °C at depth`);
      parts.push(`ice ${Math.round(st.iceCover * 10)}/10`);
      find('[data-source]').textContent = `${st.castId ? 'Water column from the underway archive: ' : 'No cast on file; column drawn from the seed: '}${parts.join(' · ')}.`;
    }

    // ---- scene ----
    function cameraTop(netZ) {
      const bottom = state.station.bottom;
      return Math.max(-6, Math.min(netZ - VIEW_HEIGHT / 2, bottom + 8 - VIEW_HEIGHT));
    }

    function drawNet(net, x, z, vz, t, onBottom) {
      ctx.save();
      ctx.translate(x, z);
      const h = net.height * SZ;
      // Wire runs up and to the right toward the ship's block.
      ctx.strokeStyle = '#d9e4e8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(8, -h / 2); ctx.lineTo(W, -H * 2); ctx.stroke();
      if (net.benthic) {
        // Beam or Agassiz frame with a short bag trailing behind.
        const w = net.mouth * 8 + 14;
        ctx.strokeStyle = '#c8c1a8'; ctx.lineWidth = 3; ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#b9cfd3'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.quadraticCurveTo(-w * 1.6, -h * 0.1 + Math.sin(t * 5) * 3, -w * 2.1, h * 0.25); ctx.lineTo(-w * 2.1, h * 0.35); ctx.quadraticCurveTo(-w * 1.6, h * 0.5, -w / 2, h / 2); ctx.stroke();
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-w / 2 - i * w * 0.4, -h / 2 + i * h * 0.16 + Math.sin(t * 5 + i) * 2); ctx.lineTo(-w / 2 - i * w * 0.4, h / 2 - i * h * 0.05); ctx.stroke(); }
        if (onBottom) { ctx.fillStyle = '#c9b89a66'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-w / 2 - i * 9 - (t * 40 % 30), h / 2 - 2 - i * 3, 3 + i, 0, 6.29); ctx.fill(); } }
      } else {
        const r = h / 2;
        const len = 42 + net.mouth * 40;
        ctx.strokeStyle = '#cfe6ea'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(-len * 0.5, -r * 0.7 + Math.sin(t * 6) * 3, -len, -3); ctx.lineTo(-len, 3); ctx.quadraticCurveTo(-len * 0.5, r * 0.7 + Math.sin(t * 6 + 1) * 3, 0, r); ctx.stroke();
        for (let i = 1; i <= 4; i++) { const k = i / 5; ctx.beginPath(); ctx.ellipse(-len * k, Math.sin(t * 6 + i) * 2, 3, r * (1 - k * 0.85), 0, 0, 6.29); ctx.stroke(); }
        ctx.strokeStyle = '#f2c15a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 5, r, 0, 0, 6.29); ctx.stroke();
        ctx.fillStyle = '#e8eef0'; ctx.fillRect(-len - 8, -4, 8, 8);
        // Bridle to the towing point.
        ctx.strokeStyle = '#d9e4e8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(8, -r - 8); ctx.moveTo(0, r); ctx.lineTo(8, -r - 8); ctx.stroke();
      }
      if (vz) { ctx.fillStyle = '#ffffff55'; ctx.beginPath(); ctx.arc(-6, vz > 0 ? -h / 2 - 6 : h / 2 + 6, 3, 0, 6.29); ctx.fill(); }
      ctx.restore();
    }

    function render(t) {
      const tow = state.tow;
      const station = state.station;
      const net = netById[tow ? tow.net : state.net];
      const netZ = tow ? tow.netZ : startDepth;
      const lead = tow ? tow.netLead : 0;
      const top = cameraTop(netZ);
      const zPx = z => (z - top) * SZ;
      const xPx = x => x * SX;
      // Water darkens with depth; the fluorescence maximum shows as a faint green band.
      const gradient = ctx.createLinearGradient(0, 0, 0, H);
      const shade = k => { const d = top + k * VIEW_HEIGHT; const f = Math.min(1, Math.max(0, d / Math.max(120, station.bottom))); return `rgb(${Math.round(36 - 26 * f)}, ${Math.round(110 - 80 * f)}, ${Math.round(140 - 90 * f)})`; };
      gradient.addColorStop(0, shade(0)); gradient.addColorStop(1, shade(1));
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
      const chlTop = zPx(station.chlDepth - 12), chlBottom = zPx(station.chlDepth + 14);
      if (chlBottom > 0 && chlTop < H) {
        const g = ctx.createLinearGradient(0, chlTop, 0, chlBottom);
        g.addColorStop(0, '#5fbf6a00'); g.addColorStop(0.5, '#5fbf6a33'); g.addColorStop(1, '#5fbf6a00');
        ctx.fillStyle = g; ctx.fillRect(0, chlTop, W, chlBottom - chlTop);
      }
      // Marine snow drifting past with the tow.
      ctx.fillStyle = '#ffffff22';
      const offset = tow ? tow.x : t * 2;
      for (let i = 0; i < 60; i++) { const x = ((i * 137.5 - offset * SX * 0.6) % W + W) % W; const y = ((i * 91.3 + t * 6 - top * SZ * 0.3) % H + H) % H; ctx.fillRect(x, y, 2, 2); }
      // Surface and ice.
      if (top < 0) {
        ctx.fillStyle = '#bfd6de'; ctx.fillRect(0, 0, W, zPx(0));
        ctx.fillStyle = '#e9f3f6'; ctx.fillRect(0, zPx(-0.6), W, 4);
      }
      if (tow) {
        for (const floe of tow.floes) {
          const x0 = xPx(floe.x - tow.x), x1 = xPx(floe.x + floe.width - tow.x);
          if (x1 < 0 || x0 > W) continue;
          ctx.fillStyle = floe.ridge ? '#e6f0f3' : '#f4f9fb';
          ctx.beginPath(); ctx.moveTo(x0, zPx(-1.2)); ctx.lineTo(x1, zPx(-1.2));
          const n = 8;
          for (let i = n; i >= 0; i--) { const wx = floe.x + floe.width * i / n; ctx.lineTo(xPx(wx - tow.x), zPx(keelDepth(tow, wx) + (i % 2 ? 0.6 : 0))); }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#9fc4d0'; ctx.lineWidth = 1; ctx.stroke();
        }
        // Seabed and rocks.
        const bedY = zPx(station.bottom);
        if (bedY < H + 40) {
          ctx.fillStyle = '#5a4a3a';
          ctx.beginPath(); ctx.moveTo(0, H + 10);
          for (let px = 0; px <= W; px += 6) ctx.lineTo(px, zPx(seabedAt(tow, tow.x + px / SX, station.bottom)));
          ctx.lineTo(W, H + 10); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#8b7a62'; ctx.lineWidth = 2; ctx.beginPath();
          for (let px = 0; px <= W; px += 6) { const y = zPx(seabedAt(tow, tow.x + px / SX, station.bottom)); if (px) ctx.lineTo(px, y); else ctx.moveTo(px, y); }
          ctx.stroke();
        }
        for (const a of tow.animals) {
          if (a.taken || a.xNow == null) continue;
          const sx = xPx(a.xNow - tow.x), sy = zPx(a.zNow);
          if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
          const species = speciesById[a.species];
          ctx.save(); ctx.translate(sx, sy); ctx.scale(1.7, 1.7); drawAnimal(ctx, species, t + a.phase, 1); ctx.restore();
        }
      } else {
        const bedY = zPx(station.bottom);
        if (bedY < H + 40) { ctx.fillStyle = '#5a4a3a'; ctx.fillRect(0, bedY, W, H - bedY + 10); ctx.fillStyle = '#8b7a62'; ctx.fillRect(0, bedY, W, 2); }
      }
      drawNet(net, xPx(NET_X + lead), zPx(netZ), tow ? tow.vz : 0, t, tow?.onBottom);
      // Floating labels.
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const label of labels) {
        ctx.globalAlpha = Math.max(0, 1 - label.age / 1.6);
        ctx.fillStyle = label.color;
        ctx.fillText(label.text, xPx(label.x), zPx(label.z) - label.age * 18);
      }
      ctx.globalAlpha = 1;
      if (tow?.stun > 0) { ctx.fillStyle = `rgba(255, 120, 60, ${tow.stun * 0.25})`; ctx.fillRect(0, 0, W, H); }
      // Depth ruler down the right edge.
      ctx.fillStyle = '#ffffff99'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
      const first = Math.ceil(top / 10) * 10;
      for (let d = first; d <= top + VIEW_HEIGHT; d += 10) { if (d < 0 || d > station.bottom) continue; ctx.fillRect(W - 14, zPx(d), 8, 1); ctx.fillText(`${d}`, W - 18, zPx(d) + 4); }
      // HUD text.
      find('[data-hud-depth]').textContent = `${netZ.toFixed(0)} m${tow?.onBottom ? ' · on the seabed' : ''}`;
      find('[data-hud-gear]').textContent = `${net.name} · ${net.mesh}`;
      find('[data-hud-bag]').textContent = tow ? `${tow.bag.length} in the cod end` : `${state.samples} samples in hand`;
      find('[data-hud-hits]').textContent = tow?.hits ? `${'●'.repeat(tow.hits)}${'○'.repeat(HITS_TO_TEAR - tow.hits)} ${tow.torn ? 'net torn' : 'bumps'}` : '';
      find('[data-hud-time]').textContent = tow ? `${Math.max(0, TOW_SECONDS - tow.elapsed).toFixed(0)} s · ${Math.round(tow.distance)} m` : `${towsLeft(state)} tows left`;
      find('[data-hud-bar]').style.width = tow ? `${Math.min(100, tow.elapsed / TOW_SECONDS * 100)}%` : '0%';
    }

    // ---- game flow ----
    function beginTow() {
      if (!active || !loaded || state.finished || state.tow) return;
      const tow = startTow(state, startDepth);
      if (!tow) return;
      labels.length = 0;
      say(`Towing the ${netById[tow.net].name} from ${Math.round(tow.netZ)} m. ${netById[tow.net].benthic ? 'Lift over the boulders and settle back down between them.' : 'Keep clear of the keels.'}`);
      renderPanel();
    }

    function endTow(reason) {
      const tow = state.tow;
      if (!tow) return;
      const result = haul(state);
      const names = Object.entries(result.counts).map(([id, n]) => `${n} ${speciesById[id].common}`).join(', ');
      if (result.torn) say(`Net torn after ${HITS_TO_TEAR} bumps. The cod end came up empty. ${towsLeft(state)} tows left.`);
      else if (!result.specimens) say(`Empty cod end. ${reason === 'early' ? 'Hauled early. ' : ''}${towsLeft(state)} tows left.`);
      else say(`On deck: ${names} · worth ${result.value} cr. ${towsLeft(state) ? `${towsLeft(state)} tows left.` : 'That was the last tow: sell up and finish the station.'}`);
      if (!towsLeft(state) && !state.finished) finishButton.focus();
      renderPanel();
    }

    function handle(event) {
      const tow = state.tow;
      if (event.type === 'catch') {
        const species = speciesById[event.species];
        labels.push({ text: `+${species.value} ${species.common}`, x: event.x, z: event.z, age: 0, color: event.first ? '#ffe28a' : '#d8f7e2' });
        audio.catchSound(event.first);
        if (event.first) say(`New for the collection: ${species.name}, ${species.common.toLowerCase()}.`);
      } else if (event.type === 'miss') {
        const species = speciesById[event.species];
        labels.push({ text: `${species.common}: ${event.reason}`, x: event.x, z: event.z, age: 0, color: '#ffc8a8' });
        audio.missSound();
        say(`${species.name} ${event.reason}. Needs ${hintFor(event.reason)}.`);
      } else if (event.type === 'hit') {
        audio.bumpSound();
        labels.push({ text: event.torn ? 'Net torn!' : event.spilled ? `Bumped ${event.hit}: ${event.spilled} spilled` : `Bumped ${event.hit}`, x: NET_X + (tow?.netLead ?? 0), z: tow?.netZ ?? 0, age: 0, color: '#ff9a7a' });
        say(event.torn ? `Snagged on the ${event.hit} a third time: the net is torn.` : `Bumped the ${event.hit}: ${event.spilled} specimen${event.spilled === 1 ? '' : 's'} spilled. ${HITS_TO_TEAR - event.hits} more and the net tears.`);
      }
    }

    function tick(time) {
      if (!active) return;
      const dt = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      const t = time / 1000;
      const tow = state.tow;
      if (tow && !tow.done) {
        const input = { up: keys.has('up') || held.up, down: keys.has('down') || held.down, left: keys.has('left') || held.left, right: keys.has('right') || held.right };
        const raised = step(state, input, dt);
        raised.forEach(e => handle({ ...e, hits: state.tow?.hits }));
        audio.rev(-tow.vz / WINCH_SPEED);
        if (tow.done) hauling = 0.9;
      } else if (tow && tow.done) {
        hauling -= dt;
        if (hauling <= 0) endTow('time');
      }
      for (const label of labels) { label.age += dt; if (state.tow) label.x -= TOW_SPEED * dt; }
      while (labels.length && labels[0].age > 1.6) labels.shift();
      render(t);
      frame = requestAnimationFrame(tick);
    }

    function doSell() {
      if (!active || state.finished) return;
      const value = sell(state);
      if (!value) return;
      audio.tillSound();
      say(`Samples shipped to the lab: ${value} cr. Credits ${state.credits}.`);
      renderPanel();
    }

    function chooseNet(id) {
      if (!active || state.finished || state.tow) return;
      const net = netById[id];
      if (!net) return;
      if (state.owned.includes(id)) { if (select(state, id)) say(`${net.name} on the wire. ${net.note}`); }
      else if (buy(state, id)) { say(`Bought the ${net.name} for ${net.cost} cr. ${net.note}`); if (net.benthic) preset('bottom'); }
      else say(`${net.name} costs ${net.cost} cr; you have ${state.credits}. Sell samples first.`);
      renderPanel();
    }

    function doFinish() {
      if (!active || state.finished || awarded) return;
      const result = finish(state);
      if (!result) return;
      awarded = true;
      const species = speciesCount(state);
      say(`Station logged: ${species} species, ${state.earned} cr earned, ${result.points} points (half a point per credit, ${SPECIES_POINTS} per species${species === SPECIES.length ? `, +${COLLECTION_BONUS} full collection` : ''}).`);
      renderPanel();
      complete(result.points, result.detail);
    }

    // ---- input ----
    const KEYMAP = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    window.addEventListener('keydown', event => {
      if (!active || !section.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const move = KEYMAP[key];
      if (move) { event.preventDefault(); event.stopImmediatePropagation(); keys.add(move); return; }
      if (key === 'enter' || key === ' ') {
        // A focused button keeps its native activation; the tow key only fires elsewhere in the game.
        const control = event.target?.closest?.('button, a');
        if (control && control !== startButton) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat) return;
        if (state.tow) { if (!state.tow.done) { state.tow.done = true; hauling = 0; endTow('early'); } } else beginTow();
        return;
      }
      if (event.repeat) return;
      if (key === 'v') { event.preventDefault(); event.stopImmediatePropagation(); doSell(); }
      else if (key === 'm') { event.preventDefault(); event.stopImmediatePropagation(); toggleMusic(); }
      else if (key === 'f') { event.preventDefault(); event.stopImmediatePropagation(); doFinish(); }
      else if (/^[1-9]$/.test(key) && NETS[Number(key) - 1]) { event.preventDefault(); event.stopImmediatePropagation(); chooseNet(NETS[Number(key) - 1].id); }
    }, { capture: true, signal });
    window.addEventListener('keyup', event => {
      const key = event.key.toLowerCase();
      const move = KEYMAP[key];
      if (move) keys.delete(move);
      const control = event.target?.closest?.('button, a, input, textarea, select');
      if ((key === 'enter' || key === ' ') && active && section.isConnected && (!dialog || dialog.open) && (!control || control === startButton)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true, signal });
    window.addEventListener('blur', () => { keys.clear(); Object.keys(held).forEach(k => { held[k] = false; }); }, { signal });

    section.querySelectorAll('[data-move]').forEach(button => {
      const dir = button.dataset.move;
      const press = event => { event.preventDefault(); held[dir] = true; button.classList.add('net-held'); button.setPointerCapture?.(event.pointerId); };
      const release = () => { held[dir] = false; button.classList.remove('net-held'); };
      button.addEventListener('pointerdown', press, { signal });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, release, { signal }));
      button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') event.preventDefault(); }, { signal });
    });
    startButton.addEventListener('click', () => { if (state.tow) { if (!state.tow.done) { state.tow.done = true; hauling = 0; endTow('early'); } } else beginTow(); }, { signal });
    sellButton.addEventListener('click', doSell, { signal });
    finishButton.addEventListener('click', doFinish, { signal });
    range.addEventListener('input', () => setDepth(Number(range.value)), { signal });
    section.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => preset(button.dataset.preset), { signal }));
    find('[data-shop]').addEventListener('click', event => { const button = event.target.closest('[data-net]'); if (button) chooseNet(button.dataset.net); }, { signal });
    function toggleMusic() {
      const on = audio.toggle();
      musicButton.setAttribute('aria-pressed', String(on));
      musicButton.innerHTML = `${on ? '♫ Theme on' : '♪ Theme'} <kbd>M</kbd>`;
    }
    musicButton.addEventListener('click', toggleMusic, { signal });

    // ---- station data: a published CTD cast sets the seabed and the fluorescence maximum ----
    async function json(url) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Cast request failed (${response.status})`);
      return response.json();
    }
    (async () => {
      let cast = null;
      try {
        const manifest = await json(new URL('../data/ctd/index.json', import.meta.url));
        const casts = (manifest.casts || []).filter(c => c.file);
        if (casts.length) {
          const pick = Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % casts.length;
          let entry = casts[pick];
          // When the chart knows the depth under the ship, use the cast whose bottom is closest to it.
          if (Number.isFinite(expedition?.depth) && expedition.depth > 0) {
            const depths = await Promise.all(casts.map(c => json(new URL(`../data/ctd/${c.file}`, import.meta.url)).then(d => ({ c, d })).catch(() => null)));
            const best = depths.filter(Boolean).filter(x => Number.isFinite(x.d.bottom_m)).sort((a, b) => Math.abs(a.d.bottom_m - expedition.depth) - Math.abs(b.d.bottom_m - expedition.depth))[0];
            if (best) { entry = best.c; cast = best.d; }
          }
          if (!cast) cast = await json(new URL(`../data/ctd/${entry.file}`, import.meta.url));
        }
      } catch (error) {
        if (!active) return;
        console.warn('Crazy Net: no local cast, drawing the column from the seed', error);
      }
      if (!active || state.tow || state.towsUsed) return;
      state = createGame(seed, cast, iceCover);
      loaded = true;
      setDepth(state.station.chlDepth);
      renderSource();
      renderPanel();
      say(`${state.station.station ? `${state.station.station}: ` : ''}${state.station.bottom} m of water. Pick a start depth and tow the ring net.`);
    })();

    setDepth(startDepth);
    renderSource();
    renderPanel();
    frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      events.abort();
      cancelAnimationFrame(frame);
      audio.dispose();
    };
  },
};
