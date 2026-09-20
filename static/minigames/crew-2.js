import {
  MAX_MARKS, SHIP_HOURS, STATION_HOURS, HOLES_PER_FLOE, MAX_DEPTH_CM,
  createScene, lonLat, sample, floeAt, speedKnots, travelField, routeTo, floeMean, floeDone, scoreSurvey,
} from './crew-2-model.js';
import { t } from '../i18n-text.js';

const stylesheet = new URL('./crew-2.css', import.meta.url).href;
const sceneUrl = new URL('../data/crew-2-scene.json', import.meta.url);

const LETTERS = 'ABCDE';
const SHIP_START = [1200, 1130];
const MARK_SPACING_PX = 30;
const DRILL_CM_PER_S = 45;
const BURST_CM = 25;
const CALLS = { 'first-year': 'first-year', old: 'old ice' };
const COLORS = { 'first-year': '#7fe3f2', old: '#ffb25e' };

const degrees = (value, positive, negative) => `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
const hoursText = hours => `${hours.toFixed(1)} h`;

export const crew2 = {
  get title() { return t('crew2.title'); },
  mount(root, { complete }) {
    const events = new AbortController();
    const signal = events.signal;
    let active = true;
    let frame = 0;
    let scene = null;
    let image = null;
    let reported = false;
    const state = {
      phase: 'loading',
      cursor: { x: 760, y: 560 },
      marks: [],
      ship: { x: SHIP_START[0], y: SHIP_START[1], heading: -Math.PI / 2 },
      track: [[...SHIP_START]],
      hoursUsed: 0,
      selected: 0,
      current: -1,
      hole: 0,
      field: null,
      voyage: null,
      drilling: false,
      last: 0,
      spin: 0,
    };

    root.innerHTML = `
      <section class="crew2" aria-label="Old ice survey">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="crew2-heading"><div><p class="crew2-kicker">ICE TEAM / SENTINEL-1 C-BAND</p>
          <h3>Read the radar, then go and drill it.</h3></div>
          <div class="crew2-clock"><strong data-hours>${SHIP_HOURS.toFixed(1)}</strong><span>ship hours left</span></div></div>
        <p class="crew2-instructions" data-instructions></p>
        <div class="crew2-layout">
          <div class="crew2-chart">
            <div class="crew2-map" data-map tabindex="0" role="application" aria-label="Sentinel-1 radar scene. Arrow keys move the cursor.">
              <canvas data-canvas></canvas>
            </div>
            <div class="crew2-readout" aria-live="off"><span data-position></span><span data-radar></span></div>
            <p class="crew2-credit" data-credit></p>
          </div>
          <div class="crew2-panel">
            <div data-panel="plan">
              <div class="crew2-loupe-row"><canvas class="crew2-loupe" data-loupe width="180" height="180" aria-hidden="true"></canvas>
                <dl class="crew2-stats"><dt>Backscatter</dt><dd data-dn>–</dd><dt>Texture σ</dt><dd data-sd>–</dd><dt>Hull speed</dt><dd data-speed>–</dd></dl></div>
              <div class="crew2-actions" role="group" aria-label="Mark the floe under the cursor">
                <button type="button" data-mark="first-year" disabled>First-year <kbd>F</kbd></button>
                <button type="button" data-mark="old" disabled>Old ice <kbd>O</kbd></button>
                <button type="button" data-remove disabled>Remove <kbd>Del</kbd></button></div>
            </div>
            <div data-panel="drill" hidden>
              <div class="crew2-hole-heading"><strong data-hole-title></strong><span data-hole-note></span></div>
              <canvas class="crew2-bore" data-bore width="300" height="330" role="img" aria-label="Auger hole cross-section"></canvas>
              <button type="button" class="crew2-drill" data-drill>Hold to drill <kbd>D</kbd></button>
              <button type="button" class="crew2-next" data-next disabled>Next hole <kbd>N</kbd></button>
            </div>
            <div data-panel="done" hidden><h4>Survey log</h4><div data-summary></div></div>
            <div class="crew2-marks"><h4>Survey marks <span data-mark-count></span></h4><ol data-marks></ol></div>
            <div class="crew2-phase-actions">
              <button type="button" class="crew2-primary" data-go disabled>Begin survey <kbd>Enter</kbd></button>
              <button type="button" data-more hidden>Back to the image <kbd>M</kbd></button>
            </div>
          </div>
        </div>
        <div class="crew2-footer"><p role="status" aria-live="polite" data-status>Loading the radar scene…</p>
          <button type="button" class="crew2-finish" data-finish disabled>End survey</button></div>
      </section>`;

    const game = root.querySelector('.crew2');
    const find = selector => game.querySelector(selector);
    const dialog = root.closest('dialog');
    const map = find('[data-map]');
    const canvas = find('[data-canvas]');
    const context = canvas.getContext('2d');
    const loupe = find('[data-loupe]');
    const bore = find('[data-bore]');
    const status = find('[data-status]');
    const goButton = find('[data-go]');
    const moreButton = find('[data-more]');
    const finishButton = find('[data-finish]');
    const drillButton = find('[data-drill]');
    const nextButton = find('[data-next]');
    const removeButton = find('[data-remove]');
    const markButtons = [...game.querySelectorAll('[data-mark]')];
    const panels = Object.fromEntries([...game.querySelectorAll('[data-panel]')].map(node => [node.dataset.panel, node]));

    const say = text => { status.textContent = text; };
    const hoursLeft = () => Math.max(0, SHIP_HOURS - state.hoursUsed);
    const pending = () => state.marks.filter(mark => !mark.visited);
    const markNear = (x, y) => state.marks.find(mark => Math.hypot(mark.x - x, mark.y - y) < MARK_SPACING_PX);

    function schedule() {
      if (!active || frame) return;
      frame = requestAnimationFrame(time => { frame = 0; tick(time); });
    }

    // ---------- drawing ----------

    function fitCanvas() {
      const width = map.clientWidth;
      if (!width || !scene) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const height = width * scene.height / scene.width;
      if (canvas.width !== Math.round(width * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
    }

    function drawMap() {
      if (!scene || !canvas.width) return;
      const k = canvas.width / scene.width;
      const ctx = context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const px = 1 / k;
      const line = (points, color, width, dash = []) => {
        if (points.length < 2) return;
        ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.setLineDash(dash.map(n => n * px));
        ctx.strokeStyle = color; ctx.lineWidth = width * px; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.setLineDash([]);
      };
      line(state.track, '#ffe27acc', 2);
      if (state.phase === 'sail') {
        const target = pending()[state.selected];
        if (target?.route) line(target.route.path, '#ffffffd0', 1.6, [5, 4]);
      }
      // 10 km scale bar
      const bar = 10 / scene.kmPerPx;
      ctx.fillStyle = '#0b2530b8'; ctx.fillRect(14 * px, scene.height - 34 * px, bar + 16 * px, 24 * px);
      ctx.fillStyle = '#fff'; ctx.fillRect(22 * px, scene.height - 17 * px, bar, 2 * px);
      ctx.font = `${10 * px}px system-ui, sans-serif`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText('10 km', 22 * px, scene.height - 21 * px);
      for (const mark of state.marks) {
        const r = 11 * px;
        ctx.beginPath(); ctx.arc(mark.x, mark.y, r, 0, Math.PI * 2);
        ctx.fillStyle = mark.visited ? '#0b2530d9' : '#0b253080'; ctx.fill();
        ctx.lineWidth = 2 * px; ctx.strokeStyle = COLORS[mark.call]; ctx.stroke();
        ctx.fillStyle = COLORS[mark.call]; ctx.font = `700 ${12 * px}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(mark.id, mark.x, mark.y + px);
        if (mark.visited && mark.floe?.kind === 'floe' && floeMean(mark.floe) !== null) {
          const label = `${Math.round(floeMean(mark.floe))} cm`;
          ctx.font = `600 ${11 * px}px system-ui, sans-serif`;
          const w = ctx.measureText(label).width + 8 * px;
          ctx.fillStyle = '#0b2530d9'; ctx.fillRect(mark.x - w / 2, mark.y + 14 * px, w, 16 * px);
          ctx.fillStyle = '#fff'; ctx.fillText(label, mark.x, mark.y + 22.5 * px);
        }
      }
      // ship
      ctx.save();
      ctx.translate(state.ship.x, state.ship.y); ctx.rotate(state.ship.heading);
      ctx.beginPath(); ctx.moveTo(11 * px, 0); ctx.lineTo(-7 * px, 5.5 * px); ctx.lineTo(-4 * px, 0); ctx.lineTo(-7 * px, -5.5 * px); ctx.closePath();
      ctx.fillStyle = '#e8402a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * px; ctx.fill(); ctx.stroke();
      ctx.restore();
      if (state.phase === 'plan') {
        const { x, y } = state.cursor;
        const gap = 9 * px, arm = 22 * px;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(x - arm, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, y + arm);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, gap, 0, Math.PI * 2); ctx.strokeStyle = '#ffe27a'; ctx.stroke();
      }
    }

    // Native-resolution view of the pixels under the cursor, with the 400 m sampling disc.
    function drawLoupe() {
      if (!scene) return;
      const ctx = loupe.getContext('2d');
      const span = 60, zoom = loupe.width / span;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0b2530'; ctx.fillRect(0, 0, loupe.width, loupe.height);
      ctx.drawImage(image, state.cursor.x - span / 2, state.cursor.y - span / 2, span, span, 0, 0, loupe.width, loupe.height);
      ctx.beginPath(); ctx.arc(loupe.width / 2, loupe.height / 2, 8 * zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    function drawBore() {
      const mark = state.marks[state.current];
      const hole = mark?.floe?.holes?.[state.hole];
      if (!hole) return;
      const ctx = bore.getContext('2d');
      const W = bore.width, H = bore.height, top = 46, scale = (H - top - 6) / MAX_DEPTH_CM;
      const y = cm => top + cm * scale;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#cfe3ea'; ctx.fillRect(0, 0, W, top);
      const ice = ctx.createLinearGradient(0, top, 0, H);
      ice.addColorStop(0, '#e3f4f6'); ice.addColorStop(1, '#8fc2d1');
      ctx.fillStyle = ice; ctx.fillRect(0, top, W, H - top);
      if (hole.measured) { ctx.fillStyle = '#1d596e'; ctx.fillRect(0, y(hole.thicknessCm), W, H); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, top - 4, W, 6);
      ctx.font = '11px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (let cm = 0; cm <= MAX_DEPTH_CM; cm += 50) {
        ctx.fillStyle = '#8fb4bf'; ctx.fillRect(8, y(cm) - 1, cm % 100 ? 6 : 12, 2);
        if (cm % 100 === 0) { ctx.fillStyle = hole.measured && cm > hole.thicknessCm ? '#cfe6ee' : '#2c5361'; ctx.fillText(String(cm), 24, y(cm)); }
      }
      const x = W / 2;
      ctx.fillStyle = '#b9d3dc'; ctx.fillRect(x - 9, top, 18, hole.depthCm * scale);
      if (hole.measured) {
        ctx.fillStyle = '#1b526c';
        ctx.fillRect(x - 9, y(Math.max(0, hole.freeboardCm)), 18, (hole.thicknessCm - Math.max(0, hole.freeboardCm)) * scale);
      }
      // auger: shaft, flights with a joint every metre, brace on top
      const tip = y(hole.depthCm), head = Math.min(tip - 40, top - 26);
      ctx.strokeStyle = '#4d5d64'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, head); ctx.lineTo(x, tip); ctx.stroke();
      ctx.strokeStyle = '#27343a'; ctx.lineWidth = 2; ctx.beginPath();
      for (let fy = tip - (state.spin % 8); fy > Math.max(top - 8, head + 10); fy -= 8) { ctx.moveTo(x - 8, fy - 3); ctx.lineTo(x + 8, fy + 3); }
      ctx.stroke();
      ctx.fillStyle = '#7f8e95';
      for (let cm = 100; cm < hole.depthCm; cm += 100) ctx.fillRect(x - 5, tip - cm * scale - 3, 10, 6);
      ctx.fillStyle = '#e59f59'; ctx.fillRect(x - 22, head - 6, 44, 8);
      ctx.fillStyle = '#8e9ba1'; ctx.beginPath(); ctx.moveTo(x - 9, tip - 4); ctx.lineTo(x + 9, tip - 4); ctx.lineTo(x, tip + 4); ctx.closePath(); ctx.fill();
      ctx.font = '700 13px monospace'; ctx.textAlign = 'left';
      const label = hole.measured ? `${hole.thicknessCm} cm` : `${Math.round(hole.depthCm)} cm`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#173f4c'; ctx.fillStyle = '#fff';
      ctx.strokeText(label, x + 20, Math.max(top + 10, tip)); ctx.fillText(label, x + 20, Math.max(top + 10, tip));
    }

    // ---------- panels ----------

    const instructions = {
      loading: '',
      plan: 'Read the radar before burning fuel. Move the cursor with the <kbd>arrow keys</kbd> (<kbd>Shift</kbd> for long steps) or tap the image, then mark up to five floes with your call: <kbd>F</kbd> first-year or <kbd>O</kbd> old ice. <kbd>Enter</kbd> sends the ship.',
      sail: 'Pick the next floe by letter with <kbd>1</kbd>–<kbd>5</kbd>, or <kbd>↑</kbd><kbd>↓</kbd> and <kbd>Enter</kbd>. The bridge routes through dark leads where the hull runs fast; every station costs 3 h alongside.',
      moving: 'Under way.',
      drill: 'On the floe. Hold <kbd>D</kbd> or <kbd>Space</kbd> to turn the auger until it breaks through, then <kbd>N</kbd> for the next hole, 25 m along the line.',
      done: 'Survey closed. Relaunch the operation to work the scene again.',
    };

    function describe(mark) {
      const floe = mark.floe;
      if (!mark.visited) return mark.route ? `${hoursText(mark.route.hours)} · ${Math.round(mark.route.km)} km` : `DN ${Math.round(mark.radar.mean)} · σ ${mark.radar.sd.toFixed(0)}`;
      if (floe.kind === 'water') return 'open water';
      if (floe.kind === 'thin') return 'young ice, no landing';
      const mean = floeMean(floe);
      return mean === null ? 'on station' : `${Math.round(mean)} cm · ${floe.stage}`;
    }

    function renderMarks() {
      const list = find('[data-marks]');
      const waiting = pending();
      list.innerHTML = state.marks.length ? state.marks.map((mark, i) => {
        const order = waiting.indexOf(mark);
        const chosen = state.phase === 'sail' && order === state.selected;
        const verdict = mark.visited && mark.floe.kind === 'floe' && floeDone(mark.floe) ? (mark.call === (mark.floe.old ? 'old' : 'first-year') ? ' ✓' : ' ✗') : '';
        return `<li><button type="button" data-row="${i}" class="${mark.visited ? 'crew2-visited' : ''}" aria-pressed="${chosen}" ${state.phase === 'moving' || state.phase === 'drill' || state.phase === 'done' ? 'disabled' : ''}>
          <b style="color:${COLORS[mark.call]}">${mark.id}</b><span>called ${CALLS[mark.call]}${verdict}</span><em>${describe(mark)}</em></button></li>`;
      }).join('') : '<li class="crew2-empty">No marks yet.</li>';
      find('[data-mark-count]').textContent = `${state.marks.length} / ${MAX_MARKS}`;
    }

    function renderReadout() {
      if (!scene) return;
      const { x, y } = state.phase === 'plan' ? state.cursor : state.ship;
      const where = lonLat(scene, x, y);
      find('[data-position]').textContent = `${degrees(where.lat, 'N', 'S')}  ${degrees(where.lon, 'E', 'W')}`;
      const radar = sample(scene, x, y);
      find('[data-radar]').textContent = `DN ${Math.round(radar.mean)} · σ ${radar.sd.toFixed(1)}`;
      if (state.phase !== 'plan') return;
      find('[data-dn]').textContent = `${Math.round(radar.mean)} / 255`;
      find('[data-sd]').textContent = radar.sd.toFixed(1);
      find('[data-speed]').textContent = radar.land ? 'aground' : `${speedKnots(radar.mean).toFixed(0)} kn`;
    }

    function render() {
      if (!active) return;
      const phase = state.phase;
      game.dataset.phase = phase;
      find('[data-instructions]').innerHTML = instructions[phase];
      find('[data-hours]').textContent = hoursLeft().toFixed(1);
      panels.plan.hidden = phase !== 'plan';
      panels.drill.hidden = phase !== 'drill';
      panels.done.hidden = phase !== 'done';
      const planning = phase === 'plan';
      const here = planning && markNear(state.cursor.x, state.cursor.y);
      markButtons.forEach(button => { button.disabled = !planning || (!here && state.marks.length >= MAX_MARKS) || Boolean(here?.visited); });
      removeButton.disabled = !here || here.visited;
      goButton.hidden = phase === 'drill' || phase === 'done';
      goButton.disabled = !(planning && pending().length) && !(phase === 'sail' && pending().length);
      goButton.innerHTML = planning ? `${state.hoursUsed ? 'Resume' : 'Begin'} survey <kbd>Enter</kbd>` : 'Sail to mark <kbd>Enter</kbd>';
      moreButton.hidden = phase !== 'sail';
      moreButton.disabled = state.marks.length >= MAX_MARKS;
      finishButton.disabled = !(phase === 'sail' || (planning && state.hoursUsed > 0));
      finishButton.textContent = phase === 'done' ? 'Survey logged ✓' : `End survey · ${scoreSurvey(state.marks).points} pts`;
      if (phase === 'drill') {
        const mark = state.marks[state.current];
        const hole = mark.floe.holes[state.hole];
        find('[data-hole-title]').textContent = `Floe ${mark.id} · hole ${state.hole + 1} / ${HOLES_PER_FLOE}`;
        find('[data-hole-note]').textContent = hole.measured ? `freeboard ${hole.freeboardCm} cm · snow ${mark.floe.snowCm} cm` : `${hole.distanceM} m along the line`;
        drillButton.disabled = hole.measured;
        drillButton.innerHTML = hole.measured ? 'Through ✓' : 'Hold to drill <kbd>D</kbd>';
        nextButton.disabled = !hole.measured;
        nextButton.innerHTML = state.hole === HOLES_PER_FLOE - 1 ? 'Back aboard <kbd>N</kbd>' : 'Next hole <kbd>N</kbd>';
        drawBore();
      }
      renderMarks();
      renderReadout();
      drawMap();
      if (planning) drawLoupe();
    }

    // ---------- planning ----------

    function moveCursor(x, y) {
      if (state.phase !== 'plan' || !scene) return;
      state.cursor.x = Math.min(scene.width - 1, Math.max(0, x));
      state.cursor.y = Math.min(scene.height - 1, Math.max(0, y));
      render();
    }

    function addMark(call) {
      if (state.phase !== 'plan') return;
      const { x, y } = state.cursor;
      const existing = markNear(x, y);
      if (existing) {
        if (existing.visited) return;
        existing.call = call;
        say(`Mark ${existing.id} is now called ${CALLS[call]}.`);
        return render();
      }
      if (state.marks.length >= MAX_MARKS) return say('Five marks is all the ship time will stretch to. Remove one first.');
      const radar = sample(scene, x, y);
      if (radar.land) return say('Layover streaks and shadow: that is terrain, not ice. Mark something afloat.');
      const id = [...LETTERS].find(letter => !state.marks.some(mark => mark.id === letter));
      state.marks.push({ id, x, y, call, radar, floe: null, visited: false, route: null });
      state.marks.sort((a, b) => a.id.localeCompare(b.id));
      say(`Mark ${id}: called ${CALLS[call]} on DN ${Math.round(radar.mean)}, texture σ ${radar.sd.toFixed(1)}.`);
      render();
    }

    function removeMark() {
      if (state.phase !== 'plan') return;
      const mark = markNear(state.cursor.x, state.cursor.y);
      if (!mark || mark.visited) return;
      state.marks.splice(state.marks.indexOf(mark), 1);
      say(`Mark ${mark.id} removed.`);
      render();
    }

    // ---------- sailing ----------

    function openSail(message) {
      state.phase = 'sail';
      state.field = travelField(scene, state.ship.x, state.ship.y);
      for (const mark of pending()) mark.route = routeTo(scene, state.field, mark.x, mark.y);
      state.selected = Math.min(state.selected, Math.max(0, pending().length - 1));
      const reachable = pending().some(mark => mark.route && state.hoursUsed + mark.route.hours + STATION_HOURS <= SHIP_HOURS);
      say(message ?? (pending().length ? 'Choose the next floe.' : 'Every mark is worked. End the survey or go back to the image.'));
      if (pending().length && !reachable) say(`${message ? `${message} ` : ''}No mark left within the remaining ship time. End the survey.`);
      render();
    }

    function select(delta) {
      const count = pending().length;
      if (state.phase !== 'sail' || !count) return;
      state.selected = (state.selected + delta + count) % count;
      render();
    }

    function sail(mark = pending()[state.selected]) {
      if (state.phase !== 'sail' || !mark || mark.visited) return;
      state.selected = pending().indexOf(mark);
      if (!mark.route) { say(`No water route to mark ${mark.id}.`); return render(); }
      if (state.hoursUsed + mark.route.hours + STATION_HOURS > SHIP_HOURS) {
        say(`Mark ${mark.id} needs ${hoursText(mark.route.hours + STATION_HOURS)} with the station; ${hoursText(hoursLeft())} remain.`);
        return render();
      }
      state.phase = 'moving';
      state.voyage = { mark, path: mark.route.path, hours: mark.route.hours, from: state.hoursUsed, started: 0, duration: Math.min(4200, 1300 + mark.route.hours * 500) };
      say(`Under way to mark ${mark.id}: ${Math.round(mark.route.km)} km, ${hoursText(mark.route.hours)}.`);
      render();
      schedule();
    }

    function arrive() {
      const { mark } = state.voyage;
      state.voyage = null;
      mark.visited = true;
      mark.floe = floeAt(scene, mark.x, mark.y);
      state.current = state.marks.indexOf(mark);
      if (mark.floe.kind !== 'floe') {
        return openSail(mark.floe.kind === 'water'
          ? `Mark ${mark.id}: open water under the bow. That grey was wind on the sea surface, nothing to stand on.`
          : `Mark ${mark.id}: dark young ice flexing in the swell. Nobody goes over the side here.`);
      }
      state.hoursUsed += STATION_HOURS;
      state.phase = 'drill';
      state.hole = 0;
      say(`Alongside floe ${mark.id}. Gangway down, auger on the sled. Drill hole 1.`);
      render();
      drillButton.focus({ preventScroll: true });
    }

    // ---------- drilling ----------

    function advanceDrill(cm) {
      const mark = state.marks[state.current];
      const hole = mark?.floe?.holes?.[state.hole];
      if (state.phase !== 'drill' || !hole || hole.measured) return;
      hole.depthCm = Math.min(hole.thicknessCm, hole.depthCm + cm);
      state.spin += cm;
      if (hole.depthCm >= hole.thicknessCm) {
        hole.measured = true;
        state.drilling = false;
        say(`Through at ${hole.thicknessCm} cm. Water rises to ${hole.freeboardCm} cm below the surface${hole.freeboardCm < 0 ? ': flooded, negative freeboard' : ''}.`);
        render();
        nextButton.focus({ preventScroll: true });
        return;
      }
      drawBore();
    }

    function setDrilling(on) {
      if (state.phase !== 'drill') on = false;
      if (state.drilling === on) return;
      state.drilling = on;
      state.last = 0;
      if (on) schedule();
    }

    function nextHole() {
      if (state.phase !== 'drill') return;
      const mark = state.marks[state.current];
      if (!mark.floe.holes[state.hole].measured) return;
      if (state.hole < HOLES_PER_FLOE - 1) {
        state.hole += 1;
        say(`Hole ${state.hole + 1}, ${mark.floe.holes[state.hole].distanceM} m along the line.`);
        render();
        drillButton.focus({ preventScroll: true });
        return;
      }
      const mean = Math.round(floeMean(mark.floe));
      const right = mark.call === (mark.floe.old ? 'old' : 'first-year');
      openSail(`Floe ${mark.id}: mean ${mean} cm, ${mark.floe.stage}. Your radar call of ${CALLS[mark.call]} ${right ? 'holds' : 'does not hold'}.`);
      goButton.focus({ preventScroll: true });
    }

    // ---------- finish ----------

    function finish() {
      if (!(state.phase === 'sail' || (state.phase === 'plan' && state.hoursUsed > 0))) return;
      const { points, best } = scoreSurvey(state.marks);
      state.phase = 'done';
      const rows = state.marks.filter(mark => mark.visited).map(mark => {
        const where = lonLat(scene, mark.x, mark.y);
        const floe = mark.floe;
        const mean = floe.kind === 'floe' ? floeMean(floe) : null;
        return {
          mark: mark.id, lat: Number(where.lat.toFixed(4)), lon: Number(where.lon.toFixed(4)),
          dn: Math.round(mark.radar.mean), texture: Number(mark.radar.sd.toFixed(1)), call: CALLS[mark.call],
          found: floe.kind === 'floe' ? floe.stage : floe.kind === 'water' ? 'open water' : 'young ice',
          meanCm: mean === null ? null : Math.round(mean),
        };
      });
      find('[data-summary]').innerHTML = rows.length ? `
        <table><thead><tr><th scope="col">Mark</th><th scope="col">DN</th><th scope="col">σ</th><th scope="col">Call</th><th scope="col">Found</th><th scope="col">Mean (cm)</th></tr></thead>
        <tbody>${rows.map(row => `<tr><th scope="row">${row.mark}</th><td>${row.dn}</td><td>${row.texture}</td><td>${row.call}</td><td>${row.found}</td><td>${row.meanCm ?? '–'}</td></tr>`).join('')}</tbody></table>
        <p>${best ? `Oldest ice: floe ${best.id}, ${best.floe.stage}, ${Math.round(floeMean(best.floe))} cm.` : 'No old ice on the books this time. The brightest smooth floes are the ones to chase.'}</p>` : '<p>No floes visited.</p>';
      say(`Survey closed after ${hoursText(state.hoursUsed)}: ${points} points.`);
      render();
      if (reported) return;
      reported = true;
      complete(points, {
        title: best ? `Old ice found: ${best.floe.stage} floe, ${Math.round(floeMean(best.floe))} cm` : 'Ice survey: no old ice found',
        scene: scene.meta.scene_utc,
        shipHours: Number(state.hoursUsed.toFixed(1)),
        floes: rows,
      });
    }

    // ---------- loop ----------

    function tick(time) {
      if (!active) return;
      if (state.phase === 'moving' && state.voyage) {
        const voyage = state.voyage;
        voyage.started ||= time;
        const t = Math.min(1, (time - voyage.started) / voyage.duration);
        const at = t * (voyage.path.length - 1);
        const i = Math.min(voyage.path.length - 2, Math.floor(at));
        if (voyage.path.length > 1) {
          const [ax, ay] = voyage.path[i], [bx, by] = voyage.path[i + 1];
          state.ship.x = ax + (bx - ax) * (at - i);
          state.ship.y = ay + (by - ay) * (at - i);
          state.ship.heading = Math.atan2(by - ay, bx - ax);
        }
        const last = state.track.at(-1);
        if (Math.hypot(last[0] - state.ship.x, last[1] - state.ship.y) > 6) state.track.push([state.ship.x, state.ship.y]);
        state.hoursUsed = voyage.from + voyage.hours * t;
        find('[data-hours]').textContent = hoursLeft().toFixed(1);
        renderReadout();
        drawMap();
        if (t >= 1) arrive(); else schedule();
        return;
      }
      if (state.phase === 'drill' && state.drilling) {
        const dt = state.last ? Math.min(100, time - state.last) : 16;
        state.last = time;
        advanceDrill(DRILL_CM_PER_S * dt / 1000);
        if (state.drilling) schedule();
      }
    }

    // ---------- input ----------

    const on = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal });

    on(map, 'pointerdown', event => {
      if (!scene) return;
      const box = canvas.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width * scene.width;
      const y = (event.clientY - box.top) / box.height * scene.height;
      if (state.phase === 'plan') return moveCursor(x, y);
      if (state.phase === 'sail') {
        const index = pending().findIndex(mark => Math.hypot(mark.x - x, mark.y - y) < 40);
        if (index < 0) return;
        if (index === state.selected) sail();
        else { state.selected = index; render(); }
      }
    });
    markButtons.forEach(button => on(button, 'click', () => addMark(button.dataset.mark)));
    on(removeButton, 'click', removeMark);
    on(goButton, 'click', () => (state.phase === 'plan' ? pending().length && openSail() : sail()));
    on(moreButton, 'click', backToImage);
    on(finishButton, 'click', finish);
    on(nextButton, 'click', nextHole);
    on(find('[data-marks]'), 'click', event => {
      const row = event.target.closest('[data-row]');
      if (!row) return;
      const mark = state.marks[Number(row.dataset.row)];
      if (state.phase === 'plan') return moveCursor(mark.x, mark.y);
      if (state.phase === 'sail') sail(mark);
    });
    on(drillButton, 'pointerdown', event => { event.preventDefault(); setDrilling(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => on(drillButton, type, () => setDrilling(false)));
    // A click with no pointer behind it is a keyboard or switch activation: one short burst.
    on(drillButton, 'click', event => { if (event.detail === 0) advanceDrill(BURST_CM); });

    function backToImage() {
      if (state.phase !== 'sail' || state.marks.length >= MAX_MARKS) return;
      state.phase = 'plan';
      say('Back on the image. Add marks, then resume.');
      render();
    }

    on(window, 'keydown', event => {
      if (!active || !game.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const onButton = Boolean(event.target?.closest?.('button'));
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      const phase = state.phase;
      let handled = true;
      if (phase === 'plan') {
        if (arrows[key]) {
          const step = event.shiftKey ? 50 : 10;
          moveCursor(state.cursor.x + arrows[key][0] * step, state.cursor.y + arrows[key][1] * step);
        } else if (key === 'f' && !event.repeat) addMark('first-year');
        else if (key === 'o' && !event.repeat) addMark('old');
        else if ((key === 'delete' || key === 'backspace') && !event.repeat) removeMark();
        else if (key === 'enter' && !onButton && !event.repeat) { if (pending().length) openSail(); }
        else handled = false;
      } else if (phase === 'sail') {
        if (arrows[key]) select(arrows[key][0] + arrows[key][1]);
        else if (/^[1-5]$/.test(key) && !event.repeat) sail(state.marks.find(mark => mark.id === LETTERS[Number(key) - 1]));
        else if (key === 'enter' && !onButton && !event.repeat) sail();
        else if (key === 'm' && !event.repeat) backToImage();
        else handled = false;
      } else if (phase === 'drill') {
        if (key === 'd' || (key === ' ' && event.target !== nextButton)) setDrilling(true);
        else if (key === 'n' && !event.repeat) nextHole();
        else if (key === 'enter' && !onButton && !event.repeat) nextHole();
        else handled = Boolean(arrows[key]);
      } else handled = Boolean(arrows[key]) && phase === 'moving';
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
    on(window, 'keyup', event => {
      const key = event.key.toLowerCase();
      if (key === 'd' || key === ' ') setDrilling(false);
    }, { capture: true });
    on(window, 'blur', () => setDrilling(false));

    const resize = new ResizeObserver(() => { fitCanvas(); drawMap(); });
    resize.observe(map);

    // ---------- load ----------

    (async () => {
      try {
        const meta = await (await fetch(sceneUrl, { signal })).json();
        const picture = new Image();
        picture.src = new URL(meta.image, sceneUrl).href;
        await picture.decode();
        if (!active) return;
        const [width, height] = meta.size;
        const buffer = document.createElement('canvas');
        buffer.width = width; buffer.height = height;
        const pixels = buffer.getContext('2d', { willReadFrequently: true });
        pixels.drawImage(picture, 0, 0, width, height);
        const rgba = pixels.getImageData(0, 0, width, height).data;
        const gray = new Uint8Array(width * height);
        for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
        image = picture;
        scene = createScene(meta, gray);
        const when = new Date(meta.scene_utc);
        find('[data-credit]').textContent = `Sentinel-1 C-band SAR · ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${meta.ground_m_per_px} m pixels · ${Math.round(width * scene.kmPerPx)} × ${Math.round(height * scene.kmPerPx)} km`;
        state.phase = 'plan';
        say('Scene loaded. Smooth and bright, or rough and bright? Mark your floes.');
        fitCanvas();
        render();
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        console.error(error);
        say('The radar scene could not be loaded. Close and reopen the operation.');
      }
    })();

    game.dataset.phase = 'loading';
    find('[data-instructions]').innerHTML = instructions.plan;
    globalThis.addEventListener?.('uw:localechange', () => { game.lang = globalThis.UWI18n?.locale || 'en'; render(); drawMap(); }, { signal: events.signal });

    return () => {
      active = false;
      events.abort();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  },
};

export const game = crew2;
