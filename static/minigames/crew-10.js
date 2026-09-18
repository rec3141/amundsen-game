import { createFlood, step, go, move, act, station, fixStation, closure, atStation, available, summary, result, labClock, rollAt, scupperClear, KEYS, AREA_M2, LAPTOP_FALL_S } from './crew-10-model.js';

const stylesheet = new URL('./crew-10.css', import.meta.url).href;
const seawaterUrl = new URL('../data/crew-10-seawater.json', import.meta.url).href;
const DECK_Y = 380;               // scene y of the deck
const UNITS_PER_M = 500;          // 50 cm of water fills the ruler
const BENCH_Y = 150;
const ROLL_GAIN = 0.45;           // scene degrees per degree of ship roll; the room leans, the water stays level
const SVG = 'http://www.w3.org/2000/svg';
const levelY = m => DECK_Y - m * UNITS_PER_M;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '–';
let lastCause = null;             // the previous launch's cause, so the next one differs

// Gear art, drawn with the item's deck position at the origin and the deck at y = 0.
const label = (text, y = -6, size = 8) => `<text x="0" y="${y}" text-anchor="middle" class="flood-i-text" style="font-size:${size}px">${text}</text>`;
const ITEM_ART = {
  laptop: '<rect x="-22" y="-14" width="44" height="12" rx="2" class="flood-i-dark"/><rect x="-24" y="-3" width="48" height="4" rx="1" class="flood-i-steel"/><circle cx="0" cy="-8" r="1.6" class="flood-led"/>',
  power: '<rect x="-26" y="-7" width="52" height="8" rx="2" class="flood-i-white"/><rect x="-20" y="-5" width="6" height="4" class="flood-i-dark"/><rect x="-8" y="-5" width="6" height="4" class="flood-i-dark"/><rect x="4" y="-5" width="6" height="4" class="flood-i-dark"/><rect x="16" y="-5" width="6" height="4" class="flood-i-dark"/><path d="M26 -3 h14 v-30" class="flood-cord"/>',
  crate: `<rect x="-30" y="-36" width="60" height="36" rx="3" class="flood-i-crate"/><path d="M-30 -24 h60 M-22 -36 v36 M-8 -36 v36 M8 -36 v36 M22 -36 v36" class="flood-i-lines"/>${label('NISKIN', -27)}`,
  pelican: '<rect x="-24" y="-20" width="48" height="20" rx="4" class="flood-i-orange"/><rect x="-10" y="-25" width="20" height="6" rx="2" class="flood-i-orange"/><path d="M-16 -20 v20 M16 -20 v20" class="flood-i-latch"/>',
  filtration: '<rect x="-28" y="-12" width="40" height="12" rx="2" class="flood-i-steel"/><path d="M-24 -12 v-8 M-16 -12 v-8 M-8 -12 v-8 M0 -12 v-8 M8 -12 v-8" class="flood-i-lines"/><path d="M-27 -20 l3 -8 h4 l3 8 M-19 -20 l3 -8 h4 l3 8 M-11 -20 l3 -8 h4 l3 8 M-3 -20 l3 -8 h4 l3 8 M5 -20 l3 -8 h4 l3 8" class="flood-i-glass"/><rect x="14" y="-18" width="16" height="18" rx="2" class="flood-i-dark"/><path d="M12 -8 h-4" class="flood-cord"/>',
  dewar: `<rect x="-12" y="-46" width="24" height="46" rx="6" class="flood-i-blue"/><rect x="-8" y="-52" width="16" height="8" rx="2" class="flood-i-steel"/><path d="M-12 -30 h24" class="flood-i-lines"/>${label('LN₂', -14, 7)}`,
  shipper: `<rect x="-24" y="-30" width="48" height="30" rx="2" class="flood-i-foam"/><path d="M-24 -22 h48" class="flood-i-lines"/>${label('DRY ICE', -8, 7)}`,
  microscope: '<rect x="-18" y="-6" width="36" height="6" rx="2" class="flood-i-dark"/><path d="M-10 -6 v-30 q0 -8 8 -8 h10" class="flood-i-arm"/><rect x="-2" y="-24" width="20" height="4" class="flood-i-steel"/><rect x="4" y="-50" width="8" height="14" rx="2" transform="rotate(20 8 -43)" class="flood-i-dark"/><path d="M4 -37 l3 6 M12 -37 l-3 6" class="flood-i-lines"/>',
  cordreel: '<circle cx="0" cy="-16" r="14" class="flood-i-orange"/><circle cx="0" cy="-16" r="5" class="flood-i-dark"/><path d="M-14 -16 h28 M0 -30 v28" class="flood-i-lines"/><path d="M-4 -2 h-8 v2 M4 -2 h8 v2" class="flood-i-arm"/><path d="M14 -18 q20 -4 30 -30" class="flood-cord"/>',
  formalin: `<rect x="-12" y="-32" width="24" height="32" rx="4" class="flood-i-white"/><rect x="-5" y="-38" width="10" height="6" rx="1" class="flood-i-red"/>${label('4%', -12, 8)}`,
  filters: `<rect x="-14" y="-10" width="28" height="10" rx="1" class="flood-i-card"/>${label('GF/F', -3, 6)}`,
  printer: '<rect x="-16" y="-14" width="32" height="14" rx="3" class="flood-i-dark"/><rect x="-10" y="-13" width="20" height="3" class="flood-i-white"/><path d="M16 -6 h14 v-4" class="flood-i-white-line"/>',
  cooler: '<rect x="-30" y="-28" width="60" height="28" rx="4" class="flood-i-blue"/><rect x="-30" y="-34" width="60" height="8" rx="3" class="flood-i-white"/><path d="M-8 -34 q8 -8 16 0" class="flood-i-arm"/>',
  peristaltic: '<rect x="-18" y="-20" width="36" height="20" rx="2" class="flood-i-white"/><circle cx="0" cy="-11" r="6" class="flood-i-dark"/><path d="M-6 -11 h12 M0 -17 v12" class="flood-i-white-line"/><path d="M-18 -8 q-8 -14 0 -20 M18 -8 q8 -14 0 -20" class="flood-i-tube"/>',
  battery: `<rect x="-16" y="-12" width="32" height="12" rx="2" class="flood-i-dark"/><rect x="-14" y="-10" width="6" height="8" class="flood-i-orange"/>${label('Li', -3, 7)}`,
  iapso: `<rect x="-18" y="-12" width="36" height="12" rx="1" class="flood-i-card"/><path d="M-12 -12 v-6 M-4 -12 v-6 M4 -12 v-6 M12 -12 v-6" class="flood-i-glass"/>${label('IAPSO', -3, 6)}`,
  drive: '<rect x="-12" y="-6" width="24" height="6" rx="1" class="flood-i-dark"/><circle cx="8" cy="-3" r="1.2" class="flood-led"/><path d="M-12 -3 h-10 v-20" class="flood-cord"/>',
  ups: '<rect x="-20" y="-30" width="40" height="30" rx="2" class="flood-i-dark"/><path d="M-16 -4 h32 M-16 -8 h32" class="flood-i-lines"/><circle cx="12" cy="-24" r="2" class="flood-led"/>',
  fluorometer: '<rect x="-20" y="-18" width="40" height="18" rx="3" class="flood-i-white"/><rect x="-16" y="-14" width="14" height="8" class="flood-i-dark"/><path d="M4 -18 q8 -10 14 0" class="flood-i-arm"/>',
  rbr: '<rect x="-5" y="-24" width="10" height="24" rx="4" class="flood-i-dark"/><rect x="-5" y="-14" width="10" height="4" class="flood-i-orange"/>',
  notebook: '<rect x="-10" y="-14" width="20" height="14" rx="1" class="flood-i-yellow"/><path d="M-6 -10 h12 M-6 -7 h12 M-6 -4 h8" class="flood-i-lines"/>',
  weights: '<rect x="-26" y="-6" width="52" height="6" rx="1" class="flood-i-dark"/><rect x="-22" y="-10" width="10" height="10" class="flood-i-steel"/><rect x="-6" y="-10" width="10" height="10" class="flood-i-steel"/><rect x="10" y="-10" width="10" height="10" class="flood-i-steel"/>',
  recycling: `<rect x="-22" y="-20" width="44" height="20" rx="1" class="flood-i-card"/><path d="M-22 -14 h44" class="flood-i-lines"/>${label('RECYCLING', -4, 6)}`,
  bubblewrap: '<path d="M-20 0 q-8 -20 6 -26 q16 -6 22 8 q4 12 -6 18 z" class="flood-i-glass"/><circle cx="-8" cy="-10" r="3" class="flood-i-bubble"/><circle cx="2" cy="-16" r="3" class="flood-i-bubble"/><circle cx="6" cy="-6" r="3" class="flood-i-bubble"/>',
  mop: '<rect x="-14" y="-22" width="28" height="22" rx="2" class="flood-i-yellow"/><path d="M8 -22 l14 -40" class="flood-i-arm"/><path d="M-10 -22 h20" class="flood-i-lines"/>',
  lunchcooler: '<rect x="-18" y="-18" width="36" height="18" rx="4" class="flood-i-blue"/><rect x="-18" y="-22" width="36" height="6" rx="2" class="flood-i-white"/><path d="M-6 -22 q6 -6 12 0" class="flood-i-arm"/>',
};

// What is over the scupper before it is cleared, drawn with the grate at the origin.
const CLOG_ART = {
  fitting: '<path d="M-14 -6 l6 -8 l8 6 l6 -9 M-4 -4 l10 -6" class="flood-clog-ties"/><rect x="-18" y="-8" width="34" height="6" rx="2" class="flood-clog-tape"/>',
  hose: '<rect x="-34" y="-7" width="68" height="7" rx="2" class="flood-i-dark"/><path d="M-28 -3 h56" class="flood-i-lines"/>',
  scupper: '<path d="M-24 0 q-6 -24 12 -26 q22 -4 26 14 q2 12 -14 12 z" class="flood-i-glass"/><circle cx="-10" cy="-10" r="3" class="flood-i-bubble"/><circle cx="2" cy="-16" r="3" class="flood-i-bubble"/><circle cx="6" cy="-6" r="3" class="flood-i-bubble"/><circle cx="-2" cy="-4" r="3" class="flood-i-bubble"/>',
  rosette: '<g class="flood-tote" transform="rotate(80 0 0)"><rect x="-30" y="-70" width="60" height="70" rx="4" class="flood-i-white"/><path d="M-30 -50 h60 M-30 -30 h60" class="flood-i-lines"/><rect x="-30" y="-74" width="60" height="6" rx="2" class="flood-i-blue"/></g>',
  aquarium: '<path d="M-26 -2 q10 -18 22 -4 q10 -14 24 -2 M-20 -4 q6 -12 16 -8 M4 -3 q8 -14 20 -6" class="flood-weed"/>',
};

function playKlaxon() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      osc.frequency.setValueAtTime(420, t0 + i * 0.7);
      osc.frequency.linearRampToValueAtTime(760, t0 + i * 0.7 + 0.5);
      osc.frequency.setValueAtTime(420, t0 + i * 0.7 + 0.5);
    }
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + 2.1);
    osc.onended = () => ctx.close().catch(() => {});
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

export const game = {
  title: 'Flood the aft lab',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    let active = true, frame = 0, last = 0, awarded = false, state = null, seawater = null, seed = 0;
    const alarm = expedition?.alarm === true;
    const seedBase = expedition?.seed ?? expedition?.id ?? `${expedition?.x ?? 0}:${expedition?.y ?? 0}:${expedition?.operations ?? 0}`;
    root.innerHTML = `
      <section class="flood-game" aria-label="Flood the aft lab">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="flood-heading"><div><p class="flood-kicker" data-kicker>AFT LAB / DAMAGE CONTROL</p>
          <h3 data-headline>Aft lab</h3></div><div class="flood-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="flood-alarm-line" data-alarm-line role="alert"></p>
        <p class="flood-instructions"><span data-blurb></span> Walk with <kbd>←</kbd> <kbd>→</kbd> or <kbd>1</kbd>–<kbd>9</kbd> <kbd>0</kbd>, act with <kbd>Space</kbd>. Stop the water, get what matters onto the bench, then drain the deck.</p>
        <div class="flood-layout">
          <div class="flood-scene-wrap">
            <svg class="flood-scene" viewBox="0 0 1000 440" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <defs>
                <linearGradient id="flood-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef0"/><stop offset="1" stop-color="#cdd8dc"/></linearGradient>
                <linearGradient id="flood-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8ea6" stop-opacity=".78"/><stop offset="1" stop-color="#173f52" stop-opacity=".9"/></linearGradient>
                <radialGradient id="flood-emergency" cx=".5" cy="0" r=".8"><stop offset="0" stop-color="#ff5a3c" stop-opacity=".5"/><stop offset="1" stop-color="#050b12" stop-opacity=".85"/></radialGradient>
              </defs>
              <rect x="-100" y="-100" width="1200" height="640" fill="url(#flood-wall)"/>
              <g data-ship>
              <rect x="-100" y="-100" width="1200" height="124" class="flood-deckhead"/>
              <g class="flood-lamps" data-lamps>${[160, 420, 680, 900].map(x => `<rect x="${x - 40}" y="24" width="80" height="6" rx="2"/>`).join('')}</g>
              <g data-room></g>
              <g data-player transform="translate(500 ${DECK_Y})"><path class="flood-legs" data-legs d="M-8 -34 L-10 0 M8 -34 L10 0"/><rect x="-13" y="-80" width="26" height="48" rx="6" class="flood-jacket"/><rect x="-13" y="-58" width="26" height="4" class="flood-stripe"/><circle cx="0" cy="-92" r="11" class="flood-head"/><rect x="-12" y="-104" width="24" height="9" rx="4" class="flood-toque"/><path class="flood-arms" data-arms d="M-13 -74 L-26 -48 M13 -74 L26 -48"/></g>
              <g data-progress class="flood-progress flood-off"><rect x="-30" y="0" width="60" height="7" rx="3" class="flood-progress-track"/><rect x="-30" y="0" width="0" height="7" rx="3" class="flood-progress-fill" data-progress-fill/></g>
              <path data-water class="flood-water" d=""/>
              <g class="flood-ruler">${[0, 10, 20, 30, 40, 50].map(cm => `<path d="M0 ${levelY(cm / 100)} h14"/><text x="18" y="${levelY(cm / 100) + 4}">${cm}</text>`).join('')}<text x="18" y="${levelY(0.5) - 12}" class="flood-ruler-unit">cm</text></g>
              <rect x="-100" y="${DECK_Y}" width="1200" height="160" class="flood-deck"/>
              <text x="500" y="${DECK_Y + 38}" text-anchor="middle" class="flood-deck-text">MAIN DECK · ${AREA_M2} m² OF IT</text>
              </g>
              <rect x="0" y="0" width="1000" height="440" data-dark class="flood-dark flood-off"/>
              <rect x="0" y="0" width="1000" height="440" data-beacon class="flood-beacon flood-off"/>
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
            <ol class="flood-stations" data-stations aria-label="Stations along the lab"></ol>
            <p class="flood-status" role="status" aria-live="polite" data-status>Loading the seawater loop…</p>
            <ul class="flood-log" data-log aria-label="Damage control log"></ul>
            <div class="flood-result flood-off" data-result></div>
            <div class="flood-footer"><button type="button" data-restart>Another one <kbd>R</kbd></button><span class="flood-reward" data-reward></span></div>
          </div>
        </div>
      </section>`;
    const gameEl = root.querySelector('.flood-game');
    const find = selector => gameEl.querySelector(selector);
    const dialog = root.closest('dialog');
    const status = find('[data-status]');
    const log = find('[data-log]');
    const actButton = find('[data-act]');
    const room = find('[data-room]');
    let stationButtons = [], items = {}, stride = 0, logged = 0, klaxon = null;

    // The room leans with the ship; the water keeps its own level, so its surface tilts the other way in the scene.
    const roll = () => rollAt(state.t, state.cause.roll);
    const surfaceY = (level, x) => Math.min(DECK_Y, levelY(level) - (x - 500) * Math.tan(roll() * ROLL_GAIN * Math.PI / 180));

    function waterPath(level, t) {
      if (level <= 0) return '';
      const amp = Math.min(4, 1 + state.inflow * 60);
      let d = `M-100 ${DECK_Y + 40} L-100 ${surfaceY(level, -100).toFixed(1)}`;
      for (let x = -100; x <= 1100; x += 50) d += ` L${x} ${Math.min(DECK_Y, surfaceY(level, x) + Math.sin(x / 80 + t * 4) * amp).toFixed(1)}`;
      return `${d} L1100 ${DECK_Y + 40} Z`;
    }

    // The laptop tumbles off the bench edge in the opening roll, bounces once and lies where it lands.
    function laptopFall(t) {
      if (t >= LAPTOP_FALL_S + 0.3) return null;
      if (t < LAPTOP_FALL_S) {
        const p = t / LAPTOP_FALL_S;
        return { y: BENCH_Y - 4 + (DECK_Y - BENCH_Y + 4) * p * p, rot: -30 * Math.sin(p * Math.PI * 0.5) };
      }
      const b = (t - LAPTOP_FALL_S) / 0.3;
      return { y: DECK_Y - 12 * Math.sin(b * Math.PI) * (1 - b), rot: -30 * (1 - b) * (1 - b) };
    }

    // Where the water comes from, per cause: the art around the fix station and the point the spray
    // leaves. Supply pipes run along the deckhead, above the door and portholes; the spray and the
    // pipe drop face the middle of the room so nothing plays off the edge of the scene.
    function sourceArt() {
      const c = state.cause;
      const fx = fixStation(state).x, sx = station(state, 'scupper').x;
      const dir = fx > 500 ? -1 : 1, edge = dir > 0 ? -100 : 1100;
      const wheel = (x, y) => `<rect x="${x - 8}" y="${y - 15}" width="16" height="30" rx="2" class="flood-valve-body"/><g data-wheel transform="translate(${x} ${y})"><circle r="26" class="flood-wheel"/><path d="M-26 0 H26 M0 -26 V26 M-18 -18 L18 18 M-18 18 L18 -18" class="flood-spokes"/><circle r="5" class="flood-hub"/></g>`;
      const lever = (x, y, base = 0) => `<circle cx="${x}" cy="${y}" r="9" class="flood-valve-body"/><g data-lever data-base="${base}" transform="translate(${x} ${y}) rotate(${base})"><path d="M0 0 h34" class="flood-lever"/><circle r="4" class="flood-hub"/></g>`;
      const caption = (x, y, text) => `<text x="${x}" y="${y}" text-anchor="middle" class="flood-label">${text}</text>`;
      if (c.id === 'fitting') {
        return { spray: { x: fx + 11 * dir, y: DECK_Y - 60, mode: 'arc', dir }, art: `<g class="flood-pipe"><path d="M${edge} 48 H${fx - 35 * dir} V${DECK_Y - 60}"/><path d="M${fx - 35 * dir} ${DECK_Y - 60} h${46 * dir}"/></g>${wheel(fx, DECK_Y - 125)}${caption(fx, DECK_Y - 160, 'LOOP VALVE')}` };
      }
      if (c.id === 'aquarium') {
        const tx = dir > 0 ? fx + 18 : fx - 78, crackX = dir > 0 ? tx + 2 : tx + 58;
        return { spray: { x: crackX + 2 * dir, y: DECK_Y - 36, mode: 'dribble', dir: -dir }, art: `<g class="flood-pipe"><path d="M${edge} 48 H${fx} V${DECK_Y - 200} M${fx} ${DECK_Y - 175} V${DECK_Y - 150} H${tx + 30} V${DECK_Y - 142}"/></g>${wheel(fx, DECK_Y - 187)}${caption(fx, DECK_Y - 222, 'TANK FEED')}<path d="M${tx + 4} ${DECK_Y - 30} v30 M${tx + 56} ${DECK_Y - 30} v30" class="flood-bench-legs"/><rect x="${tx}" y="${DECK_Y - 140}" width="60" height="110" rx="3" class="flood-tank"/><rect data-tank-water x="${tx + 3}" y="${DECK_Y - 137}" width="54" height="104" class="flood-tank-water"/><path d="M${crackX} ${DECK_Y - 40} l${8 * dir} -12 l${-5 * dir} -10 l${7 * dir} -14" class="flood-crack"/>${caption(tx + 30, DECK_Y - 146, 'TANK')}` };
      }
      if (c.id === 'hose') {
        return { spray: { x: fx + 44 * dir, y: DECK_Y - 100, mode: 'sheet', dir }, art: `<rect x="${fx - 42}" y="${DECK_Y - 100}" width="84" height="100" rx="2" class="flood-cabinet"/><rect x="${fx - 46}" y="${DECK_Y - 126}" width="92" height="28" rx="4" class="flood-sink"/><rect x="${fx - 40}" y="${DECK_Y - 122}" width="80" height="20" rx="3" class="flood-sink-water"/><g class="flood-pipe"><path d="M${fx - 24 * dir} ${DECK_Y - 200} V${DECK_Y - 160} h${14 * dir}"/></g>${lever(fx - 24 * dir, DECK_Y - 172, dir > 0 ? 0 : 180)}<path d="M${fx - 10 * dir} ${DECK_Y - 160} q${30 * dir} 0 ${30 * dir} 40 q0 12 ${-14 * dir} 14" class="flood-hose"/>${caption(fx, DECK_Y - 208, 'WASH-DOWN TAP')}` };
      }
      if (c.id === 'scupper') {
        return { spray: { x: sx, y: DECK_Y - 2, mode: 'well', dir }, art: `<g class="flood-pipe"><path d="M${fx} ${DECK_Y - 80} V48 H${sx} V${DECK_Y}"/></g>${lever(fx, DECK_Y - 100, -90)}${caption(fx, DECK_Y - 124, 'DISCHARGE')}` };
      }
      // rosette: the feed tap on a stub from the deckhead; the tote lies over the scupper.
      return { spray: { x: fx + 16 * dir, y: DECK_Y - 100, mode: 'arc', gain: 0.6, dir }, art: `<g class="flood-pipe"><path d="M${fx} -100 V${DECK_Y - 128}"/></g>${lever(fx, DECK_Y - 140, dir > 0 ? 0 : 180)}<path d="M${fx} ${DECK_Y - 128} v18 q0 10 ${14 * dir} 10" class="flood-hose"/>${caption(fx, DECK_Y - 162, 'TOTE FEED')}` };
    }

    // Everything that moves between launches: benches, door, the water source, pump, scupper and gear.
    function buildRoom() {
      const c = state.cause;
      const src = sourceArt();
      state.spray = src.spray;
      const px = station(state, 'pump').x, sx = station(state, 'scupper').x;
      const bench = (a, b) => `<rect x="${a}" y="${BENCH_Y}" width="${b - a}" height="10" class="flood-bench"/><path d="M${a + 10} ${BENCH_Y + 10} v40 M${b - 10} ${BENCH_Y + 10} v40" class="flood-bench-legs"/><text x="${(a + b) / 2}" y="${BENCH_Y - 6}" text-anchor="middle" class="flood-label">BENCH</text><circle cx="${(a + b) / 2}" cy="95" r="26" class="flood-porthole"/><circle cx="${(a + b) / 2}" cy="95" r="19" class="flood-porthole-glass"/>`;
      room.innerHTML = `
        ${src.art}
        ${state.benches.map(([a, b]) => bench(a, b)).join('')}
        <rect x="${state.doorX - 35}" y="70" width="70" height="310" rx="6" class="flood-door"/><circle cx="${state.doorX + 22}" cy="230" r="4" class="flood-handle"/>
        <text x="${state.doorX}" y="65" text-anchor="middle" class="flood-sign">AFT LAB</text>
        <g data-spray class="flood-spray"></g>
        <g transform="translate(${px} ${DECK_Y})"><rect x="-22" y="-40" width="44" height="40" rx="4" class="flood-pump"/><rect x="-14" y="-62" width="28" height="22" rx="3" class="flood-pump-switch"/><circle cx="0" cy="-51" r="5" data-pump-lamp class="flood-lamp-off"/><path d="M22 -30 h20 v-60 h-8" class="flood-hose"/><text x="0" y="14" text-anchor="middle" class="flood-label flood-deck-label">SUMP PUMP</text></g>
        <g transform="translate(${sx} ${DECK_Y})"><rect x="-28" y="-4" width="56" height="8" rx="3" class="flood-grate"/><path d="M-20 -4 v8 M-10 -4 v8 M0 -4 v8 M10 -4 v8 M20 -4 v8" class="flood-grate-bars"/><g data-clog class="flood-clog">${CLOG_ART[c.id]}</g><text x="0" y="14" text-anchor="middle" class="flood-label flood-deck-label">SCUPPER</text></g>
        <g data-items>${state.stations.filter(s => s.item).map(s => `<g data-item="${s.id}" transform="translate(${s.x} ${DECK_Y})">${ITEM_ART[s.id] || ITEM_ART.recycling}</g>`).join('')}</g>`;
      items = Object.fromEntries(state.stations.filter(s => s.item).map(s => [s.id, room.querySelector(`[data-item="${s.id}"]`)]));
      const list = find('[data-stations]');
      list.innerHTML = state.stations.map((s, i) => `<li><button type="button" data-station="${i}" title="${escape(s.item ? s.owner : s.verb)}"><kbd>${s.key}</kbd><b>${escape(s.name)}</b><small data-station-note="${s.id}"></small></button></li>`).join('');
      stationButtons = [...list.querySelectorAll('[data-station]')];
      stationButtons.forEach((button, i) => button.addEventListener('click', () => press(() => go(state, i, true)), { signal: events.signal }));
      const gear = state.stations.filter(s => s.item && s.points > 0).reduce((sum, s) => sum + s.points, 0);
      find('[data-reward]').textContent = `40 water stopped · ${gear} for the gear on the deck · 25 drained · 25 under 10 cm`;
    }

    function drawSpray(strength) {
      const spray = room.querySelector('[data-spray]');
      const { x: ox, y: oy, mode, gain = 1, dir = 1 } = state.spray;
      spray.replaceChildren();
      if (strength <= 0) return;
      const s = Math.min(1.2, strength * gain);
      const surface = levelY(state.level);
      const drop = (x, y, r) => { const el = document.createElementNS(SVG, 'circle'); el.setAttribute('cx', x.toFixed(1)); el.setAttribute('cy', Math.min(y, DECK_Y - 2).toFixed(1)); el.setAttribute('r', r.toFixed(1)); spray.append(el); };
      const jet = (d, width) => { const el = document.createElementNS(SVG, 'path'); el.setAttribute('d', d); el.setAttribute('class', 'flood-jet'); el.style.strokeWidth = `${width}`; spray.append(el); };
      if (mode === 'arc' || mode === 'dribble') {
        const reach = mode === 'arc' ? 40 + s * 220 : 10 + s * 40;
        for (let i = 0; i < 7; i++) {
          const phase = (state.t * 9 + i * 0.9) % 1;
          drop(ox + phase * reach * dir, oy + phase * phase * (oy > surface ? 0 : surface - oy) - Math.sin(phase * Math.PI) * 30 * s, 2 + s * 3);
        }
        const dropHeight = Math.max(0, surface - oy);
        jet(`M${ox} ${oy} q${reach * 0.45 * dir} ${10} ${reach * 0.6 * dir} ${dropHeight * 0.6 + 10}`, 3 + s * 8);
      } else if (mode === 'sheet') {
        const bottom = Math.max(oy + 4, surface);
        jet(`M${ox} ${oy} L${ox + 2} ${bottom}`, 4 + s * 10);
        for (let i = 0; i < 5; i++) { const phase = (state.t * 6 + i * 0.7) % 1; drop(ox + (8 + Math.sin(i * 2.1) * 10 * s) * dir, oy + phase * (bottom - oy), 1.5 + s * 2); }
      } else if (mode === 'well') {
        const height = 12 + s * 40;
        jet(`M${ox - 8} ${oy} q8 -${height} 16 0`, 4 + s * 6);
        for (let i = 0; i < 6; i++) { const phase = (state.t * 7 + i * 0.6) % 1; drop(ox - 14 + i * 5.5, oy - Math.sin(phase * Math.PI) * height * 1.1, 1.5 + s * 2); }
      }
    }

    function renderScene() {
      const player = state.player;
      const level = state.level;
      const c = state.cause;
      find('[data-ship]').setAttribute('transform', `rotate(${(roll() * ROLL_GAIN).toFixed(2)} 500 ${DECK_Y - 120})`);
      find('[data-water]').setAttribute('d', waterPath(level, state.t));
      // A handwheel turns a quarter turn per press-worth of work; a ball-valve lever swings through a right angle.
      const fix = fixStation(state), cl = closure(state);
      const wheel = room.querySelector('[data-wheel]'), lever = room.querySelector('[data-lever]');
      if (wheel) wheel.setAttribute('transform', `${wheel.getAttribute('transform').split(' rotate')[0]} rotate(${(cl * fix.turns * 90).toFixed(0)})`);
      if (lever) lever.setAttribute('transform', `${lever.getAttribute('transform').split(' rotate')[0]} rotate(${(Number(lever.dataset.base) - cl * 90).toFixed(0)})`);
      drawSpray(state.inflow / c.flow);
      const tankWater = room.querySelector('[data-tank-water]');
      if (tankWater && state.tank) { const h = 104 * state.tank.volume / c.tank.volume; tankWater.setAttribute('height', h.toFixed(1)); tankWater.setAttribute('y', (DECK_Y - 33 - h).toFixed(1)); }
      room.querySelector('[data-pump-lamp]').setAttribute('class', station(state, 'pump').done ? 'flood-lamp-on' : 'flood-lamp-off');
      const clog = room.querySelector('[data-clog]');
      if (c.id === 'rosette') clog.setAttribute('transform', scupperClear(state) ? 'translate(70 0)' : '');
      else clog.classList.toggle('flood-off', scupperClear(state));
      find('[data-dark]').classList.toggle('flood-off', state.lights);
      find('[data-lamps]').classList.toggle('flood-lamps-off', !state.lights);
      for (const s of state.stations) {
        if (!s.item) continue;
        const node = items[s.id];
        let x = s.x, y = DECK_Y, rot = 0;
        const fall = s.fell && s.place === 'deck' ? laptopFall(state.t) : null;
        if (s.place === 'bench') y = BENCH_Y;
        else if (fall) ({ y, rot } = fall);
        else if (s.place === 'lost' && s.lost === 'tipped') { x = s.x + s.drift; y = surfaceY(level, x) + 8; rot = 78; }
        else if (s.place === 'lost') y = DECK_Y;
        else if (level >= s.draft) { x = s.x + s.drift; y = surfaceY(level, x) + s.draft * UNITS_PER_M * 0.9; rot = Math.sin(s.afloat * 2.1) * 8; }
        node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`);
        node.classList.toggle('flood-falling', Boolean(fall));
        node.classList.toggle('flood-lost', s.place === 'lost' && !s.herring);
      }
      const walking = player.target && !atStation(state, station(state, player.target));
      if (walking) stride += 1;
      const swing = walking ? Math.sin(stride * 0.45) * 9 : 0;
      find('[data-legs]').setAttribute('d', `M-8 -34 L${-10 - swing} 0 M8 -34 L${10 + swing} 0`);
      const working = player.working ? station(state, player.working) : null;
      const reach = working?.fix && working.kind === 'gate' ? 96 : 66;
      find('[data-arms]').setAttribute('d', working ? `M-13 -74 L-30 -${reach} M13 -74 L30 -${reach}` : `M-13 -74 L${-26 + swing} -48 M13 -74 L${26 - swing} -48`);
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
      if (s.fix) return s.kind === 'gate' ? (closure(state) >= 1 ? 'shut' : s.progress > 0 ? `${Math.floor(closure(state) * s.turns)}/${s.turns} turns` : 'open') : (s.done ? 'shut' : 'open');
      if (s.id === 'pump') return s.done ? (state.level >= 0.01 ? 'pumping' : 'no prime') : 'off';
      if (s.scupper) return s.done ? 'draining' : state.cause.clog.what;
      if (s.place === 'bench') return 'on bench';
      if (s.place === 'lost') return s.lost === 'tipped' ? 'tipped' : s.herring ? 'soaked' : 'flooded';
      if (s.herring) return 'worth nothing';
      if (s.safe) return 'safe where it is';
      if (state.level >= s.draft) return 'afloat';
      if (s.fell) return `on the floor, dies at ${(s.dieAt * 100).toFixed(0)} cm`;
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
      find('[data-next]').textContent = working ? `${working.verb}…` : here && arrived ? (available(state, here) ? (here.item ? `${here.verb} · ${here.owner}` : here.verb) : 'Nothing more to do here') : here ? (player.pending ? 'will act on arrival' : '') : '';
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
        button.classList.toggle('flood-gone', s.place === 'lost' && !s.herring);
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
        <p>Water on the deck: ${fmt(state.water.sst, 2)} °C at ${fmt(state.water.salinity, 2)} PSU, ${fmt(state.water.density)} kg/m³, ${fmt(state.water.sst - state.water.freezing, 2)} °C above its freezing point.</p>`;
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
      // The first launch after an alarm is the alarm; a replay from the same dialog is a drill.
      const isAlarm = alarm && seed === 1;
      state = createFlood(`${seedBase}:${Date.now()}:${seed}`, seawater, { avoid: lastCause, alarm: isAlarm });
      lastCause = state.cause.id;
      logged = 0;
      log.replaceChildren();
      find('[data-result]').classList.add('flood-off');
      find('[data-kicker]').textContent = isAlarm ? 'AFT LAB / FLOODING ALARM' : 'AFT LAB / DAMAGE CONTROL DRILL';
      find('[data-headline]').textContent = state.cause.headline;
      find('[data-blurb]').textContent = state.cause.blurb;
      const alarmLine = find('[data-alarm-line]');
      alarmLine.textContent = isAlarm ? 'Flooding, flooding, flooding. Aft lab. Damage control party to the aft lab.' : 'Damage control drill, aft lab. This is a drill.';
      alarmLine.classList.toggle('flood-alarm-live', isAlarm);
      const beacon = find('[data-beacon]');
      beacon.classList.toggle('flood-off', !isAlarm);
      if (isAlarm) { beacon.classList.remove('flood-beacon-run'); void beacon.getBoundingClientRect(); beacon.classList.add('flood-beacon-run'); klaxon = playKlaxon(); }
      buildRoom();
      const w = state.water;
      find('[data-seawater]').textContent = `${fmt(w.sst, 2)} °C · ${fmt(w.salinity, 2)} PSU · ${fmt(w.density)} kg/m³`;
      const when = w.time ? w.time.replace('T', ' ').replace('Z', ' UTC') : '';
      find('[data-seawater]').title = w.time ? `Thermosalinograph, ${when}` : 'Typical loop water; the snapshot did not load';
      const rate = state.cause.slug ? `${Math.round(state.cause.slug.volume * 1000)} L already across the deck and ${Math.round(state.cause.flow * 1000)} L/s still coming` : state.cause.start ? `${Math.round(state.cause.start * 100)} cm on the deck already, ${Math.round(state.cause.flow * 1000)} L/s more arriving` : `${Math.round(state.cause.flow * 1000)} L/s onto the deck`;
      status.textContent = `${w.assumed ? 'Loop water near' : `Loop water at ${when}:`} ${fmt(w.sst, 2)} °C and ${fmt(w.salinity, 2)} PSU. ${rate}. Go.`;
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
    window.addEventListener('keydown', event => {
      if (!active || !gameEl.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const index = KEYS.indexOf(key);
      const handled = index >= 0 || ['arrowleft', 'arrowright', 'a', 'd', ' ', 'enter', 'e', 'r'].includes(key);
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || !state) return;
      // A browser that held the klaxon back until a gesture lets it through now.
      if (klaxon?.state === 'suspended') klaxon.resume().catch(() => {});
      if (key === 'r') { if (state) start(); return; }
      if (index >= 0 && index < state.stations.length) press(() => go(state, index, true));
      else if (key === 'arrowleft' || key === 'a') press(() => move(state, -1));
      else if (key === 'arrowright' || key === 'd') press(() => move(state, 1));
      else if (index < 0) press(() => act(state));
    }, { capture: true, signal: events.signal });
    frame = requestAnimationFrame(loop);
    load();
    return () => {
      active = false;
      events.abort();
      cancelAnimationFrame(frame);
      klaxon?.close?.().catch(() => {});
    };
  },
};
