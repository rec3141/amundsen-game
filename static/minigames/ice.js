import { createTransect, drill, move, measurements, score, finish, MAX_DEPTH_CM } from './ice-model.js';

const stylesheet = new URL('./ice.css', import.meta.url).href;
const svgNS = 'http://www.w3.org/2000/svg';

export const ice = {
  title: 'Ice thickness',
  mount(root, { complete, expedition }) {
    const state = createTransect(expedition?.seed ?? expedition?.id ?? Date.now());
    const events = new AbortController();
    let active = true;
    root.innerHTML = `
      <section class="ice-game" aria-label="Ice thickness transect">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="ice-heading"><div><p class="ice-kicker">FIELD NOTEBOOK / ICE TRANSECT</p>
          <h3>Find the shape beneath the surface.</h3></div><div class="ice-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="ice-instructions">Press <kbd>D</kbd> repeatedly or tap Drill. Break through, log the thickness, then move along the transect.</p>
        <div class="ice-layout">
          <div class="ice-workstation">
            <div class="ice-location"><strong data-hole></strong><span data-distance></span></div>
            <div class="ice-section" aria-hidden="true">
              <div class="ice-snow">FLOE SURFACE</div><div class="ice-water"></div>
              <div class="ice-bore"></div><div class="ice-auger"><span></span></div>
              <div class="ice-ruler"><span>0</span><span>60</span><span>120</span><span>180</span><span>240 cm</span></div>
              <div class="ice-depth" data-depth></div>
            </div>
            <div class="ice-drilling"><span data-reading></span><span data-strokes></span></div>
            <div class="ice-progress" role="meter" aria-label="Drilling depth in centimetres" aria-valuemin="0" aria-valuemax="240"><div></div></div>
            <button type="button" class="ice-drill" data-drill>Drill <kbd>D</kbd></button>
            <div class="ice-navigation"><button type="button" data-prev aria-label="Previous hole, left arrow">← Previous</button><button type="button" data-next aria-label="Next hole, right arrow">Next hole →</button></div>
          </div>
          <div class="ice-notebook">
            <div class="ice-chart-heading"><h4>Thickness along transect</h4><span data-count></span></div>
            <svg class="ice-chart" viewBox="0 0 490 295" role="img" aria-label="Ice thickness chart. Measurements are listed below.">
              <text x="53" y="18">Ice thickness (cm)</text>
              <g class="ice-grid">${[0, 60, 120, 180, 240].map(n => {
                const y = 242 - n / MAX_DEPTH_CM * 204;
                return `<path d="M53 ${y} H463"/><text x="44" y="${y + 4}" text-anchor="end">${n}</text>`;
              }).join('')}</g>
              <g class="ice-ticks">${state.holes.map(h => `<text x="${53 + h.distanceM / 45 * 410}" y="260" text-anchor="middle">${h.distanceM}</text>`).join('')}</g>
              <text x="258" y="286" text-anchor="middle">Distance along transect (m)</text>
              <g data-chart></g>
            </svg>
            <p class="ice-chart-empty">Your first breakthrough starts the chart.</p>
            <div class="ice-hole-strip" role="group" aria-label="Transect holes">${state.holes.map((_, i) => `<button type="button" data-select="${i}">${i + 1}</button>`).join('')}</div>
            <details class="ice-log"><summary>Measurement notebook <span data-log-count></span></summary>
              <table><caption>Completed holes</caption><thead><tr><th scope="col">Hole</th><th scope="col">Distance (m)</th><th scope="col">Thickness (cm)</th></tr></thead><tbody data-log></tbody></table>
            </details>
            <p class="ice-reward">25 points per measured hole · +50 for the full transect</p>
          </div>
        </div>
        <div class="ice-footer"><p role="status" aria-live="polite" data-status>Hole 1 is ready. Each press takes the auger deeper.</p><button type="button" class="ice-finish" data-finish disabled>Finish transect</button></div>
      </section>`;
    const game = root.querySelector('.ice-game');
    const find = selector => game.querySelector(selector);
    const drillButton = find('[data-drill]');
    const nextButton = find('[data-next]');
    const previousButton = find('[data-prev]');
    const finishButton = find('[data-finish]');
    const status = find('[data-status]');
    const holeButtons = [...game.querySelectorAll('[data-select]')];
    const dialog = root.closest('dialog');

    function render() {
      const hole = state.holes[state.current];
      const records = measurements(state);
      find('[data-score]').textContent = score(state);
      find('[data-hole]').textContent = `Hole ${state.current + 1} / ${state.holes.length}`;
      find('[data-distance]').textContent = `${hole.distanceM} m along transect`;
      find('[data-depth]').textContent = `${hole.depthCm} cm`;
      find('[data-reading]').textContent = hole.measured ? `Thickness: ${hole.thicknessCm} cm` : `Drilled: ${hole.depthCm} cm`;
      find('[data-strokes]').textContent = `${hole.strokes} strokes`;
      find('[data-count]').textContent = `${records.length} / ${state.holes.length} logged`;
      find('[data-log-count]').textContent = `(${records.length})`;
      const depth = hole.depthCm / MAX_DEPTH_CM * 100;
      find('.ice-section').style.setProperty('--ice-depth', `${depth}%`);
      find('.ice-section').classList.toggle('ice-breakthrough', hole.measured);
      const meter = find('.ice-progress');
      meter.setAttribute('aria-valuenow', hole.depthCm);
      meter.setAttribute('aria-valuetext', `${hole.depthCm} centimetres${hole.measured ? ', breakthrough' : ' drilled'}`);
      meter.firstElementChild.style.width = `${depth}%`;
      drillButton.disabled = state.finished || hole.measured;
      drillButton.innerHTML = hole.measured ? 'Breakthrough ✓' : 'Drill <kbd>D</kbd>';
      previousButton.disabled = state.finished || state.current === 0;
      nextButton.disabled = state.finished || state.current === state.holes.length - 1;
      finishButton.disabled = state.finished || records.length === 0;
      finishButton.textContent = state.finished ? 'Transect saved ✓' : `Finish transect${records.length ? ` · ${score(state)} pts` : ''}`;
      holeButtons.forEach((button, i) => {
        const h = state.holes[i];
        button.setAttribute('aria-pressed', String(i === state.current));
        button.setAttribute('aria-label', `Hole ${i + 1}, ${h.distanceM} metres, ${h.measured ? `${h.thicknessCm} centimetres measured` : h.depthCm ? 'in progress' : 'undrilled'}`);
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
        const y = 242 - h.thicknessCm / MAX_DEPTH_CM * 204;
        if (i && state.holes[i - 1].measured) {
          const previous = state.holes[i - 1];
          const line = document.createElementNS(svgNS, 'line');
          Object.entries({ x1: 53 + previous.distanceM / 45 * 410, y1: 242 - previous.thicknessCm / MAX_DEPTH_CM * 204, x2: x, y2: y }).forEach(([key, value]) => line.setAttribute(key, value));
          chart.append(line);
        }
        const point = document.createElementNS(svgNS, 'circle');
        Object.entries({ cx: x, cy: y, r: 5 }).forEach(([key, value]) => point.setAttribute(key, value));
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = `${h.distanceM} m: ${h.thicknessCm} cm`;
        point.append(title);
        chart.append(point);
      });
      find('[data-log]').innerHTML = state.holes.map((h, i) => h.measured ? `<tr><th scope="row">${i + 1}</th><td>${h.distanceM}</td><td>${h.thicknessCm}</td></tr>` : '').join('');
    }

    function takeStroke() {
      if (!active || !drill(state)) return;
      const hole = state.holes[state.current];
      game.classList.toggle('ice-stroke-a', hole.strokes % 2 === 1);
      game.classList.toggle('ice-stroke-b', hole.strokes % 2 === 0);
      if (hole.measured) {
        const count = measurements(state).length;
        status.textContent = count === state.holes.length
          ? `All ${count} holes logged. Finish to save ${score(state)} points.`
          : `Breakthrough! ${hole.thicknessCm} cm at ${hole.distanceM} m. Choose another hole or finish your transect.`;
      }
      render();
      if (hole.measured && document.activeElement === drillButton) {
        (measurements(state).length === state.holes.length ? finishButton : !nextButton.disabled ? nextButton : previousButton).focus();
      }
    }

    function go(direction) {
      if (!active || !move(state, direction)) return;
      const hole = state.holes[state.current];
      status.textContent = hole.measured
        ? `Hole ${state.current + 1}: ${hole.thicknessCm} cm logged at ${hole.distanceM} m.`
        : `Hole ${state.current + 1}, ${hole.distanceM} m. ${hole.depthCm ? `Resume from ${hole.depthCm} cm.` : 'Ready to drill.'}`;
      render();
    }

    function save() {
      if (!active) return;
      const result = finish(state);
      if (!result) return;
      render();
      status.textContent = `Transect saved: ${result.detail.holes} holes measured · ${result.points} points.`;
      complete(result.points, result.detail);
    }

    drillButton.addEventListener('click', takeStroke, { signal: events.signal });
    nextButton.addEventListener('click', () => go(1), { signal: events.signal });
    previousButton.addEventListener('click', () => go(-1), { signal: events.signal });
    finishButton.addEventListener('click', save, { signal: events.signal });
    holeButtons.forEach((button, i) => button.addEventListener('click', () => go(i - state.current), { signal: events.signal }));
    window.addEventListener('keydown', event => {
      if (!active || !game.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      if (!['d', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || state.finished) return;
      if (key === 'd') takeStroke();
      else go(key === 'arrowleft' ? -1 : 1);
    }, { capture: true, signal: events.signal });
    render();
    return () => {
      active = false;
      events.abort();
    };
  },
};
