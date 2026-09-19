import { createTransect, nextAction, drill, pull, empty, extend, move, measurements, score, finish, BARREL_CM } from './ice-model.js';
import { text } from '../i18n-text.js';

const stylesheet = new URL('./ice.css', import.meta.url).href;
const svgNS = 'http://www.w3.org/2000/svg';

export const ice = {
  get title() { return text('Ice thickness'); },
  mount(root, { complete, expedition }) {
    // The same spot on the chart is the same floe; without a position every launch finds a new one.
    const position = Number.isFinite(expedition?.x) && Number.isFinite(expedition?.y) ? `floe:${Math.round(expedition.x)}:${Math.round(expedition.y)}` : null;
    const state = createTransect(expedition?.seed ?? expedition?.id ?? position ?? Date.now(), expedition?.ice ?? null);
    const scale = state.scaleCm;
    const tick = scale > 250 ? 100 : 50;
    const ticks = Array.from({ length: Math.floor(scale / tick) + 1 }, (_, i) => i * tick);
    const chartY = cm => 242 - cm / scale * 204;
    const labels = () => ({
      drill: `${text('Drill')} <kbd>D</kbd>`,
      pull: `${text('Pull corer')} <kbd>P</kbd>`,
      empty: `${text('Empty core')} <kbd>E</kbd>`,
      extend: `${text('Add extension')} <kbd>X</kbd>`,
    });
    const events = new AbortController();
    let active = true;
    root.innerHTML = `
      <section class="ice-game" aria-label="Ice thickness transect">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="ice-heading"><div><p class="ice-kicker">FIELD NOTEBOOK / ICE TRANSECT</p>
          <h3>Core the floe a metre at a time.</h3></div><div class="ice-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="ice-instructions">Press <kbd>D</kbd> or tap to turn the Kovacs corer. Its barrel holds 1 m of core: when it fills, pull <kbd>P</kbd>, empty <kbd>E</kbd>, add an extension <kbd>X</kbd> and go back down until you break through.</p>
        <div class="ice-layout">
          <div class="ice-workstation">
            <div class="ice-location"><strong data-hole></strong><span data-distance></span></div>
            <div class="ice-section" aria-hidden="true">
              <svg class="ice-scene" viewBox="-150 -150 300 ${scale + 170}" preserveAspectRatio="xMidYMin meet">
                <defs>
                  <linearGradient id="ice-floe-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3f4f6"/><stop offset="1" stop-color="#8fc2d1"/></linearGradient>
                  <clipPath id="ice-barrel-clip"><rect x="-16" y="-100" width="32" height="93"/></clipPath>
                </defs>
                <rect class="ice-floe" x="-1000" y="0" width="2000" height="${scale + 40}" fill="url(#ice-floe-fill)"/>
                <rect class="ice-water ice-off" data-water x="-1000" y="0" width="2000" height="${scale + 40}"/>
                <rect class="ice-snow" x="-1000" y="-5" width="2000" height="7"/>
                <g class="ice-ruler" font-size="${Math.round(scale / 18)}">${ticks.map(n => `<path d="M-122 ${n} h10"/><text x="-108" y="${n}" dominant-baseline="middle">${n}</text>`).join('')}</g>
                <rect class="ice-bore" data-bore x="-18" y="0" width="36" height="0"/>
                <rect class="ice-flood ice-off" data-flood x="-18" y="0" width="36" height="0"/>
                <g class="ice-cores">${[0, 1, 2].map(i => `<g class="ice-off" data-core="${i}"><rect x="32" y="${-19 - i * 16}" width="${BARREL_CM}" height="14" rx="7"/><path d="M57 ${-19 - i * 16} v14 M82 ${-19 - i * 16} v14 M107 ${-19 - i * 16} v14"/></g>`).join('')}</g>
                <g class="ice-corer" data-corer>
                  ${[1, 2, 3].map(i => `<g class="ice-rod ice-off" data-rod="${i}"><rect x="-3.5" y="${-108 - i * 100}" width="7" height="100"/><rect class="ice-coupling" x="-6" y="${-113 - (i - 1) * 100}" width="12" height="10" rx="2"/></g>`).join('')}
                  <g class="ice-handle" data-handle><rect x="-3.5" y="-24" width="7" height="24"/><rect x="-27" y="-31" width="54" height="9" rx="4.5"/></g>
                  <rect class="ice-barrel" x="-12" y="-100" width="24" height="93" rx="1"/>
                  <rect class="ice-core" data-core-fill x="-6" y="0" width="12" height="0"/>
                  <g clip-path="url(#ice-barrel-clip)"><g class="ice-flights">${Array.from({ length: 12 }, (_, i) => `<path d="M-16 ${-137.5 + i * 12.5} l32 8"/>`).join('')}</g></g>
                  <rect class="ice-driver" x="-13" y="-109" width="26" height="10" rx="2"/><circle class="ice-pin" cx="0" cy="-104" r="2.2"/>
                  <path class="ice-cutter" d="M-16 -8 h32 v5 l-5 3 l-5 -4 h-12 l-5 4 l-5 -3 z"/>
                </g>
                <text class="ice-tape ice-off" data-tape x="30" y="0" font-size="${Math.round(scale / 16)}" dominant-baseline="middle"></text>
              </svg>
              <div class="ice-snow-label">FLOE SURFACE</div>
              <div class="ice-depth" data-depth></div>
            </div>
            <div class="ice-drilling"><span data-reading></span><span data-barrel></span></div>
            <div class="ice-progress" role="meter" aria-label="Core in the 1 metre barrel, centimetres" aria-valuemin="0" aria-valuemax="${BARREL_CM}"><div></div></div>
            <button type="button" class="ice-drill" data-drill>Drill <kbd>D</kbd></button>
            <div class="ice-corer-actions" role="group" aria-label="Core barrel handling"><button type="button" data-pull>Pull <kbd>P</kbd></button><button type="button" data-empty>Empty <kbd>E</kbd></button><button type="button" data-extend>Extend <kbd>X</kbd></button></div>
            <div class="ice-navigation"><button type="button" data-prev aria-label="Previous hole, left arrow">← Previous</button><button type="button" data-next aria-label="Next hole, right arrow">Next hole →</button></div>
          </div>
          <div class="ice-notebook">
            <div class="ice-chart-heading"><h4>Thickness along transect</h4><span data-count></span></div>
            <svg class="ice-chart" viewBox="0 0 490 295" role="img" aria-label="Ice thickness chart. Measurements are listed below.">
              <text x="53" y="18">Ice thickness (cm)</text>
              <g class="ice-grid">${ticks.map(n => {
                const y = chartY(n);
                return `<path d="M53 ${y} H463"/><text x="44" y="${y + 4}" text-anchor="end">${n}</text>`;
              }).join('')}</g>
              <g class="ice-ticks">${state.holes.map(h => `<text x="${53 + h.distanceM / 45 * 410}" y="260" text-anchor="middle">${h.distanceM}</text>`).join('')}</g>
              <text x="258" y="286" text-anchor="middle">Distance along transect (m)</text>
              <g data-chart></g>
            </svg>
            <p class="ice-chart-empty">Your first breakthrough starts the chart.</p>
            <div class="ice-hole-strip" role="group" aria-label="Transect holes">${state.holes.map((_, i) => `<button type="button" data-select="${i}">${i + 1}</button>`).join('')}</div>
            <details class="ice-log"><summary>Measurement notebook <span data-log-count></span></summary>
              <table><caption>Completed holes</caption><thead><tr><th scope="col">Hole</th><th scope="col">Distance (m)</th><th scope="col">Thickness (cm)</th><th scope="col">Core runs</th></tr></thead><tbody data-log></tbody></table>
            </details>
            <p class="ice-reward">25 points per measured hole · +50 for the full transect</p>
          </div>
        </div>
        <div class="ice-footer"><p role="status" aria-live="polite" data-status>Hole 1 is ready. Each press turns the corer deeper.</p><button type="button" class="ice-finish" data-finish disabled>Finish transect</button></div>
      </section>`;
    const game = root.querySelector('.ice-game');
    const find = selector => game.querySelector(selector);
    const drillButton = find('[data-drill]');
    const stepButtons = { pull: find('[data-pull]'), empty: find('[data-empty]'), extend: find('[data-extend]') };
    const nextButton = find('[data-next]');
    const previousButton = find('[data-prev]');
    const finishButton = find('[data-finish]');
    const status = find('[data-status]');
    const section = find('.ice-section');
    const holeButtons = [...game.querySelectorAll('[data-select]')];
    const dialog = root.closest('dialog');
    const steps = { drill, pull, empty, extend };
    let turns = 0;
    let statusSource = 'Hole 1 is ready. Each press turns the corer deeper.';
    let statusValues = {};
    const say = (source, values = {}) => {
      statusSource = source;
      statusValues = values;
      status.textContent = text(source, values.actionSource ? { ...values, action: text(values.actionSource) } : values);
    };
    const localizeInstructions = () => {
      find('.ice-instructions').innerHTML = text(
        'Press {drill} or tap to turn the Kovacs corer. Its barrel holds 1 m of core: when it fills, pull {pull}, empty {empty}, add an extension {extend} and go back down until you break through.',
        { drill: '<kbd>D</kbd>', pull: '<kbd>P</kbd>', empty: '<kbd>E</kbd>', extend: '<kbd>X</kbd>' },
      );
    };

    function renderScene(hole) {
      const onSurface = !hole.measured && (hole.stage === 'pulled' || hole.stage === 'emptied');
      const rods = onSurface ? 0 : hole.extensions;
      // The cutting head sits at the bottom of the hole, or hangs just above the snow once the corer is pulled.
      section.style.setProperty('--ice-head', onSurface ? -12 : hole.depthCm);
      section.classList.toggle('ice-breakthrough', hole.measured);
      section.classList.toggle('ice-hauling', hole.stage !== 'drilling' && !hole.measured);
      find('[data-bore]').setAttribute('height', hole.depthCm);
      find('[data-core-fill]').setAttribute('y', -hole.coreCm);
      find('[data-core-fill]').setAttribute('height', hole.coreCm);
      find('[data-handle]').setAttribute('transform', `translate(0 ${-108 - rods * 100})`);
      [1, 2, 3].forEach(i => find(`[data-rod="${i}"]`).classList.toggle('ice-off', i > rods));
      const cores = hole.extensions + (hole.stage === 'emptied' ? 1 : 0);
      [0, 1, 2].forEach(i => find(`[data-core="${i}"]`).classList.toggle('ice-off', i >= cores));
      // Sea water floods the finished hole up to the freeboard level, about a tenth of the thickness below the surface.
      const water = find('[data-water]');
      const flood = find('[data-flood]');
      const tape = find('[data-tape]');
      [water, flood, tape].forEach(node => node.classList.toggle('ice-off', !hole.measured));
      if (hole.measured) {
        const freeboard = Math.round(hole.thicknessCm * 0.1);
        water.setAttribute('y', hole.thicknessCm);
        flood.setAttribute('y', freeboard);
        flood.setAttribute('height', hole.thicknessCm - freeboard);
        tape.setAttribute('y', hole.thicknessCm);
        tape.textContent = `${hole.thicknessCm} cm`;
      }
    }

    function render() {
      const hole = state.holes[state.current];
      const records = measurements(state);
      const action = nextAction(state);
      find('[data-score]').textContent = score(state);
      game.lang = globalThis.UWI18n?.locale || 'en';
      find('[data-hole]').textContent = text('Hole {number} / {total}', { number: state.current + 1, total: state.holes.length });
      find('[data-distance]').textContent = text('{distance} m along transect', { distance: hole.distanceM });
      find('[data-depth]').textContent = `${hole.depthCm} cm`;
      find('[data-reading]').textContent = hole.measured
        ? text('Thickness: {thickness} cm', { thickness: hole.thicknessCm })
        : text('Drilled: {depth} cm', { depth: hole.depthCm });
      find('[data-barrel]').textContent = hole.measured
        ? text(hole.runs === 1 ? '{runs} core run' : '{runs} core runs', { runs: hole.runs })
        : text('Barrel {core} / {capacity} cm · {extensions} ext', { core: hole.coreCm, capacity: BARREL_CM, extensions: hole.extensions });
      find('[data-count]').textContent = text('{count} / {total} logged', { count: records.length, total: state.holes.length });
      find('[data-log-count]').textContent = `(${records.length})`;
      renderScene(hole);
      const meter = find('.ice-progress');
      meter.setAttribute('aria-valuenow', hole.coreCm);
      meter.setAttribute('aria-valuetext', text(hole.measured
        ? '{core} of {capacity} centimetres of core, hole {depth} centimetres deep, breakthrough'
        : '{core} of {capacity} centimetres of core, hole {depth} centimetres deep',
      { core: hole.coreCm, capacity: BARREL_CM, depth: hole.depthCm }));
      meter.firstElementChild.style.width = `${hole.coreCm / BARREL_CM * 100}%`;
      meter.classList.toggle('ice-full', hole.coreCm === BARREL_CM && !hole.measured);
      // The large button always performs the step the hole needs next, so one thumb can run the whole cycle.
      drillButton.disabled = !action;
      drillButton.innerHTML = hole.measured ? text('Breakthrough ✓') : labels()[action ?? 'drill'];
      drillButton.classList.toggle('ice-handling', Boolean(action) && action !== 'drill');
      Object.entries(stepButtons).forEach(([name, button]) => {
        button.disabled = action !== name;
        button.classList.toggle('ice-due', action === name);
      });
      previousButton.disabled = state.finished || state.current === 0;
      nextButton.disabled = state.finished || state.current === state.holes.length - 1;
      finishButton.disabled = state.finished || records.length === 0;
      finishButton.textContent = state.finished ? text('Transect saved ✓') : records.length
        ? text('Finish transect · {points} pts', { points: score(state) })
        : text('Finish transect');
      holeButtons.forEach((button, i) => {
        const h = state.holes[i];
        button.setAttribute('aria-pressed', String(i === state.current));
        button.setAttribute('aria-label', text(h.measured
          ? 'Hole {number}, {distance} metres, {thickness} centimetres measured'
          : h.depthCm ? 'Hole {number}, {distance} metres, in progress' : 'Hole {number}, {distance} metres, undrilled',
        { number: i + 1, distance: h.distanceM, thickness: h.thicknessCm }));
        button.classList.toggle('ice-measured', h.measured);
        button.disabled = state.finished;
      });
      find('.ice-chart-empty').hidden = records.length > 0;
      // Connect adjacent measured holes; gaps stay open until sampled.
      const chart = find('[data-chart]');
      chart.replaceChildren();
      state.holes.forEach((h, i) => {
        if (!h.measured) return;
        const x = 53 + h.distanceM / 45 * 410;
        const y = chartY(h.thicknessCm);
        if (i && state.holes[i - 1].measured) {
          const previous = state.holes[i - 1];
          const line = document.createElementNS(svgNS, 'line');
          Object.entries({ x1: 53 + previous.distanceM / 45 * 410, y1: chartY(previous.thicknessCm), x2: x, y2: y }).forEach(([key, value]) => line.setAttribute(key, value));
          chart.append(line);
        }
        const point = document.createElementNS(svgNS, 'circle');
        Object.entries({ cx: x, cy: y, r: 5 }).forEach(([key, value]) => point.setAttribute(key, value));
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = text('{distance} m: {thickness} cm', { distance: h.distanceM, thickness: h.thicknessCm });
        point.append(title);
        chart.append(point);
      });
      find('[data-log]').innerHTML = state.holes.map((h, i) => h.measured ? `<tr><th scope="row">${i + 1}</th><td>${h.distanceM}</td><td>${h.thicknessCm}</td><td>${h.runs}</td></tr>` : '').join('');
    }

    function report(step, hole) {
      if (hole.measured) {
        const count = measurements(state).length;
        return count === state.holes.length
          ? ['All {count} holes logged. Finish to save {points} points.', { count, points: score(state) }]
          : [hole.runs === 1
            ? 'Breakthrough! {thickness} cm at {distance} m in {runs} core run. Choose another hole or finish your transect.'
            : 'Breakthrough! {thickness} cm at {distance} m in {runs} core runs. Choose another hole or finish your transect.',
          { thickness: hole.thicknessCm, distance: hole.distanceM, runs: hole.runs }];
      }
      if (hole.stage === 'full') return ['Barrel full at {depth} cm and still in ice. Pull the corer (P).', { depth: hole.depthCm }];
      if (step === 'pull') return ['Corer on the surface with {capacity} cm of core. Empty the barrel (E).', { capacity: BARREL_CM }];
      if (step === 'empty') return ['Core {number} laid out on the snow. Add a 1 m extension (X) to reach {depth} cm.', { number: hole.extensions + 1, depth: hole.depthCm }];
      if (step === 'extend') return ['Extension {number} pinned. Cutting head back at {depth} cm. Keep drilling.', { number: hole.extensions, depth: hole.depthCm }];
      return null;
    }

    // Runs one step of the coring cycle; with no step named it runs whichever the hole needs next.
    function act(step = nextAction(state)) {
      if (!active || !step) return;
      const hole = state.holes[state.current];
      if (!steps[step](state)) {
        const due = nextAction(state);
        if (due && due !== 'drill') say({
          pull: 'Barrel full. Pull the corer (P) before drilling on.',
          empty: 'Empty the core barrel (E) before drilling on.',
          extend: 'Add a 1 m extension (X) before drilling on.',
        }[due]);
        return;
      }
      if (step === 'drill') {
        turns += 1;
        game.classList.toggle('ice-stroke-a', turns % 2 === 1);
        game.classList.toggle('ice-stroke-b', turns % 2 === 0);
      }
      const message = report(step, hole);
      if (message) say(...message);
      render();
      if (hole.measured && document.activeElement === drillButton) {
        (measurements(state).length === state.holes.length ? finishButton : !nextButton.disabled ? nextButton : previousButton).focus();
      }
    }

    function go(direction) {
      if (!active || !move(state, direction)) return;
      const hole = state.holes[state.current];
      if (hole.measured) say('Hole {number}: {thickness} cm logged at {distance} m.', { number: state.current + 1, thickness: hole.thicknessCm, distance: hole.distanceM });
      else if (!hole.depthCm) say('Hole {number}, {distance} m. Ready to drill.', { number: state.current + 1, distance: hole.distanceM });
      else {
        const actionSource = { drill: 'drill on', pull: 'pull the corer', empty: 'empty the barrel', extend: 'add an extension' }[nextAction(state)];
        say('Hole {number}, {distance} m. Resume at {depth} cm: {action}.', { number: state.current + 1, distance: hole.distanceM, depth: hole.depthCm, actionSource });
      }
      render();
    }

    function save() {
      if (!active) return;
      const result = finish(state);
      if (!result) return;
      render();
      say('Transect saved: {holes} holes measured · {points} points.', { holes: result.detail.holes, points: result.points });
      complete(result.points, { ...result.detail, title: text(result.detail.title) });
    }

    drillButton.addEventListener('click', () => act(), { signal: events.signal });
    Object.entries(stepButtons).forEach(([name, button]) => button.addEventListener('click', () => act(name), { signal: events.signal }));
    nextButton.addEventListener('click', () => go(1), { signal: events.signal });
    previousButton.addEventListener('click', () => go(-1), { signal: events.signal });
    finishButton.addEventListener('click', save, { signal: events.signal });
    holeButtons.forEach((button, i) => button.addEventListener('click', () => go(i - state.current), { signal: events.signal }));
    window.addEventListener('keydown', event => {
      if (!active || !game.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const step = { d: 'drill', p: 'pull', e: 'empty', x: 'extend' }[key];
      if (!step && key !== 'arrowleft' && key !== 'arrowright') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || state.finished) return;
      if (step) act(step);
      else go(key === 'arrowleft' ? -1 : 1);
    }, { capture: true, signal: events.signal });
    window.addEventListener('uw:localechange', () => { localizeInstructions(); render(); say(statusSource, statusValues); }, { signal: events.signal });
    localizeInstructions();
    render();
    return () => {
      active = false;
      events.abort();
    };
  },
};
