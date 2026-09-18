import { COLUMNS, ROWS, SHIP_HOURS, SEEP_BONUS, CORERS, LAYERS, ITEMS, createSurvey, score, unlocked, affordable, site as siteAt, penetration, select, chooseCorer, core, finish, recordPoints, formatAge, label } from './crew-5-seabed.js';

const stylesheet = new URL('./crew-5.css', import.meta.url).href;
const CELL = 50;
// Milliseconds the core takes to come up and get split on deck.
const HAUL_MS = 900;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const length = cm => cm < 100 ? `${cm} cm` : cm < 10000 ? `${(cm / 100).toFixed(cm % 100 ? 1 : 0)} m` : `${Math.round(cm / 100)} m`;
// Sulfate–methane transition depth read as distance to the vent.
const smtzClass = cm => cm === null ? 'sulfate' : cm < 40 ? 'hot' : cm < 200 ? 'near' : cm < 600 ? 'mid' : 'far';
const smtzText = cm => cm === null ? 'sulfate to the base' : `SMTZ at ${cm} cm`;

export const game = {
  title: 'Seep-Seeker',
  mount(root, { complete, expedition }) {
    // The same chart position over the same voyage gives the same seafloor; the survey moves on with each operation logged.
    const position = Number.isFinite(expedition?.x) && Number.isFinite(expedition?.y) ? `${Math.round(expedition.x * 1000)}:${Math.round(expedition.y * 1000)}` : Date.now();
    const state = createSurvey(`seep:${position}:${expedition?.operations ?? 0}`);
    const events = new AbortController();
    let active = true, busy = false, timer = null, shown = null;
    const depths = state.sites.map(s => s.waterDepthM);
    const shallowest = Math.min(...depths), deepest = Math.max(...depths);
    const shade = s => `hsl(196 42% ${Math.round(74 - 44 * (s.waterDepthM - shallowest) / Math.max(1, deepest - shallowest))}%)`;
    root.innerHTML = `
      <section class="seep-game" aria-label="Seep-Seeker sediment coring survey">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="seep-heading"><div><p class="seep-kicker">FIELD NOTEBOOK / SEDIMENT CORING</p>
          <h3>Find the seep. Bring up the longest record.</h3></div><div class="seep-score"><strong data-score>0</strong><span>points</span></div></div>
        <p class="seep-instructions">One pockmark on this shelf is venting methane. Core the seafloor with what you have: finds fund better gear, and the depth where sulfate runs out tells you how close the vent is. Core straight into its gas hydrate for +${SEEP_BONUS}.</p>
        <div class="seep-layout">
          <div class="seep-workstation">
            <div class="seep-readouts"><span data-hours></span><span data-record></span></div>
            <div class="seep-time" role="meter" aria-label="Ship time remaining, hours" aria-valuemin="0" aria-valuemax="${SHIP_HOURS}"><div></div></div>
            <div class="seep-map">
              <div class="seep-corner"></div>
              <div class="seep-letters" aria-hidden="true">${Array.from({ length: COLUMNS }, (_, c) => `<span>${label(c, 0)[0]}</span>`).join('')}</div>
              <div class="seep-numbers" aria-hidden="true">${Array.from({ length: ROWS }, (_, r) => `<span>${r + 1}</span>`).join('')}</div>
              <div class="seep-chart">
                <svg class="seep-bathy" viewBox="0 0 ${COLUMNS * CELL} ${ROWS * CELL}" aria-hidden="true">
                  ${state.sites.map(s => `<rect x="${s.col * CELL}" y="${s.row * CELL}" width="${CELL}" height="${CELL}" fill="${shade(s)}"/>`).join('')}
                  ${state.pockmarks.map(p => `<circle class="seep-pock" cx="${(p.col + 0.5) * CELL}" cy="${(p.row + 0.5) * CELL}" r="${CELL * 0.42}"/><circle class="seep-pock seep-pock-outer" cx="${(p.col + 0.5) * CELL}" cy="${(p.row + 0.5) * CELL}" r="${CELL * 0.95}"/>`).join('')}
                </svg>
                <div class="seep-cells" role="group" aria-label="Coring sites">${state.sites.map((s, i) => `<button type="button" data-cell="${i}"><span class="seep-mark" aria-hidden="true"></span></button>`).join('')}</div>
              </div>
            </div>
            <div class="seep-site"><strong data-site></strong><span data-site-note></span></div>
            <div class="seep-gear" role="group" aria-label="Coring equipment">${CORERS.map((c, i) => `<button type="button" data-corer="${c.id}" title="${escape(c.note)}"><kbd>${i + 1}</kbd><b>${c.name}</b><span data-gear-note></span></button>`).join('')}</div>
            <p class="seep-gear-note" data-corer-note></p>
            <button type="button" class="seep-core" data-core>Core <kbd>Enter</kbd></button>
          </div>
          <div class="seep-notebook">
            <div class="seep-column-heading"><h4 data-column-title>Core description</h4><span data-column-meta></span></div>
            <svg class="seep-column" viewBox="0 0 330 420" role="img" aria-label="Core section; finds are listed below" data-column>
              <defs>
                <pattern id="seep-p-laminated" width="8" height="6" patternUnits="userSpaceOnUse"><rect width="8" height="6" fill="#8d94a2"/><path d="M0 1.5h8 M0 4.5h8" stroke="#6e7583" stroke-width="1"/></pattern>
                <pattern id="seep-p-ird" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#8a7d6d"/><circle cx="3" cy="4" r="1.6" fill="#4d443b"/><circle cx="10" cy="10" r="2.1" fill="#4d443b"/></pattern>
                <pattern id="seep-p-till" width="18" height="16" patternUnits="userSpaceOnUse"><rect width="18" height="16" fill="#605850"/><path d="M2 3l4-1 2 3-3 2z M11 8l4 1 1 4-4 1-2-3z M4 11l3 1-1 3z" fill="#37322d"/></pattern>
                <pattern id="seep-p-sandstone" width="12" height="20" patternUnits="userSpaceOnUse"><rect width="12" height="20" fill="#c9b078"/><path d="M0 14h12" stroke="#2b2622" stroke-width="2"/></pattern>
                <clipPath id="seep-clip"><rect class="seep-reveal" x="0" y="0" width="330" height="420"/></clipPath>
              </defs>
              <g data-column-body></g>
            </svg>
            <p class="seep-column-empty" data-column-empty>No core on deck yet. Pick a site on the chart and lower the spoon.</p>
            <ul class="seep-finds" data-finds></ul>
            <details class="seep-log"><summary>Core log <span data-log-count></span></summary>
              <table><caption>Cores taken, newest first · pick a row to see it again</caption><thead><tr><th scope="col">#</th><th scope="col">Site</th><th scope="col">Gear</th><th scope="col">Length</th><th scope="col">Base</th><th scope="col">Sulfate</th><th scope="col">Pts</th></tr></thead><tbody data-log></tbody></table>
            </details>
            <p class="seep-legend"><i class="seep-dot seep-dot-sulfate"></i> sulfate to base <i class="seep-dot seep-dot-far"></i> SMTZ deep <i class="seep-dot seep-dot-mid"></i> metres <i class="seep-dot seep-dot-near"></i> shallow <i class="seep-dot seep-dot-hot"></i> at the surface</p>
            <p class="seep-reward">Finds fund gear · record points 5 × √cm of your longest core · +${SEEP_BONUS} for the seep</p>
          </div>
        </div>
        <div class="seep-footer"><p role="status" aria-live="polite" data-status>${SHIP_HOURS} h of ship time. Arrow keys pick a site, Enter lowers the corer.</p><button type="button" class="seep-finish" data-finish disabled>Sail on</button></div>
      </section>`;
    const gameEl = root.querySelector('.seep-game');
    const find = selector => gameEl.querySelector(selector);
    const cells = [...gameEl.querySelectorAll('[data-cell]')];
    const gearButtons = [...gameEl.querySelectorAll('[data-corer]')];
    const coreButton = find('[data-core]');
    const finishButton = find('[data-finish]');
    const status = find('[data-status]');
    const dialog = root.closest('dialog');
    const corer = () => CORERS.find(c => c.id === state.corer);
    const deepestHere = s => state.cores.filter(c => c.site === s).reduce((best, c) => best && best.cm >= c.cm ? best : c, null);
    const smtzKnown = s => { const best = deepestHere(s); return best ? best.smtz : undefined; };

    function siteText(s) {
      const setting = s.centre ? 'pockmark floor' : s.pockmark ? 'pockmark rim' : 'open shelf';
      const best = deepestHere(s);
      return `${s.waterDepthM} m water · ${setting}${best ? ` · ${s.cores} core${s.cores === 1 ? '' : 's'}: ${best.corer.name.toLowerCase()} to ${length(best.cm)}, ${smtzText(best.smtz)}` : ' · uncored'}`;
    }

    function renderColumn(entry) {
      const body = find('[data-column-body]');
      find('[data-column-empty]').hidden = Boolean(entry);
      if (!entry) { body.replaceChildren(); find('[data-column-title]').textContent = 'Core description'; find('[data-column-meta]').textContent = ''; find('[data-finds]').innerHTML = ''; return; }
      const { site: s, cm } = entry;
      const y = d => 16 + d / cm * 372;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      const step = steps.find(v => cm / v <= 8) ?? 10000;
      const ticks = [];
      for (let d = 0; d <= cm; d += step) ticks.push(d);
      let svg = `<g class="seep-axis">${ticks.map(d => `<path d="M78 ${y(d)} h8"/><text x="72" y="${y(d)}" text-anchor="end" dominant-baseline="middle">${d < 100 || step < 100 ? `${d}` : `${d / 100} m`}</text>`).join('')}<text class="seep-axis-unit" x="72" y="8" text-anchor="end">${step < 100 ? 'cm' : 'depth'}</text></g>`;
      svg += '<g clip-path="url(#seep-clip)">';
      for (const layer of s.layers) {
        if (layer.top >= cm) break;
        const top = y(layer.top), bottom = y(Math.min(layer.bottom, cm));
        svg += `<rect class="seep-k seep-k-${layer.kind}" x="90" y="${top.toFixed(1)}" width="90" height="${Math.max(1.2, bottom - top).toFixed(1)}"><title>${escape(LAYERS[layer.kind].name)} · ${layer.top}–${Math.min(layer.bottom, cm)} cm</title></rect>`;
      }
      if (entry.smtz !== null) {
        if (s.seepDistance <= 2) svg += `<rect class="seep-sulfidic" x="90" y="${y(entry.smtz).toFixed(1)}" width="90" height="${(y(cm) - y(entry.smtz)).toFixed(1)}"/>`;
        svg += `<path class="seep-smtz" d="M86 ${y(entry.smtz).toFixed(1)} H184"/><text class="seep-smtz-label" x="184" y="${(y(entry.smtz) - 4).toFixed(1)}" text-anchor="end">SO₄²⁻ → CH₄</text>`;
      }
      // Labels stack downward so close finds stay legible.
      let last = -20;
      for (const f of entry.finds) {
        const item = ITEMS[f.item];
        const mark = y(f.depthCm);
        const text = Math.max(mark, last + 15);
        last = text;
        svg += `<g class="seep-find${item.hint ? ' seep-find-hint' : ''}"><circle cx="180" cy="${mark.toFixed(1)}" r="4.5"/><path d="M184 ${mark.toFixed(1)} L196 ${text.toFixed(1)}"/><text x="199" y="${text.toFixed(1)}" dominant-baseline="middle">${escape(item.name)}</text></g>`;
      }
      svg += '</g>';
      svg += `<text class="seep-base" x="90" y="${Math.min(412, y(cm) + 14).toFixed(1)}">${entry.refusal ? `refusal in ${escape(LAYERS[entry.refusal].name.toLowerCase())}` : `base ${length(cm)}`}</text>`;
      body.innerHTML = svg;
      find('[data-column-title]').textContent = `Core ${entry.number} · ${s.label} · ${entry.corer.name}`;
      find('[data-column-meta]').textContent = `${length(cm)} · base ≈ ${formatAge(entry.ka)} · ${smtzText(entry.smtz)}`;
      find('[data-finds]').innerHTML = entry.finds.length
        ? entry.finds.map(f => { const item = ITEMS[f.item]; return `<li${item.hint ? ' class="seep-hint"' : ''}><strong>${escape(item.name)}</strong> <span>${f.depthCm} cm · ${f.item === 'hydrate' ? `+${SEEP_BONUS}` : `${item.value} pts`}</span><em>${escape(item.note)}</em></li>`; }).join('')
        : `<li class="seep-nothing">${entry.cm === 0 ? 'The corer came back empty.' : 'Nothing new in this one; the record itself is the find.'}</li>`;
    }

    function render() {
      const here = siteAt(state);
      const gear = corer();
      const points = score(state);
      find('[data-score]').textContent = points;
      find('[data-hours]').textContent = `Ship time ${state.hours} h of ${SHIP_HOURS}`;
      find('[data-record]').textContent = state.longest ? `Longest record ${length(state.longest.cm)} · ${formatAge(state.longest.ka)} · ${recordPoints(state.longest.cm)} pts` : 'No record yet';
      const meter = find('.seep-time');
      meter.setAttribute('aria-valuenow', state.hours);
      meter.firstElementChild.style.width = `${state.hours / SHIP_HOURS * 100}%`;
      meter.classList.toggle('seep-low', state.hours <= 10);
      cells.forEach((cell, i) => {
        const s = state.sites[i];
        const best = deepestHere(s);
        const known = smtzKnown(s);
        cell.setAttribute('aria-selected', String(i === state.selected));
        cell.setAttribute('aria-label', `${s.label}, ${siteText(s)}`);
        cell.tabIndex = i === state.selected ? 0 : -1;
        cell.disabled = state.finished;
        cell.className = `${best ? `seep-cored seep-c-${smtzClass(known)}` : ''}${state.finished && i === state.seepIndex ? ' seep-vent' : ''}`;
        cell.firstElementChild.textContent = best ? best.corer.glyph : '';
      });
      find('[data-site]').textContent = here.label;
      find('[data-site-note]').textContent = siteText(here);
      gearButtons.forEach(button => {
        const c = CORERS.find(x => x.id === button.dataset.corer);
        const open = unlocked(state, c);
        button.disabled = state.finished || !open;
        button.setAttribute('aria-pressed', String(c.id === state.corer));
        button.classList.toggle('seep-locked', !open);
        button.classList.toggle('seep-broke', open && !affordable(state, c));
        button.querySelector('[data-gear-note]').textContent = open ? `${length(c.reachCm)} · ${c.hours} h` : `${c.unlock} pts`;
      });
      find('[data-corer-note]').textContent = gear.note;
      const reach = penetration(here.layers, gear);
      const can = !state.finished && !busy && affordable(state, gear);
      coreButton.disabled = !can;
      coreButton.innerHTML = state.finished ? (state.won ? 'Seep found ✓' : 'Ship time spent') : affordable(state, gear)
        ? `${escape(gear.name)} at ${here.label} · ${gear.hours} h <kbd>Enter</kbd>`
        : `${escape(gear.name)} needs ${gear.hours} h; ${state.hours} h left`;
      coreButton.title = `Reach here up to ${length(reach.cm)}`;
      finishButton.disabled = state.reported || busy || state.cores.length === 0;
      finishButton.textContent = state.reported ? 'Logged ✓' : `Sail on · ${points} pts`;
      find('[data-log-count]').textContent = `(${state.cores.length})`;
      find('[data-log]').innerHTML = [...state.cores].reverse().map(c => `<tr data-show="${c.number}" class="${shown === c ? 'seep-showing' : ''}${c.finds.some(f => f.item === 'hydrate') ? ' seep-win' : ''}"><th scope="row">${c.number}</th><td>${c.site.label}</td><td>${escape(c.corer.name)}</td><td>${length(c.cm)}</td><td>${formatAge(c.ka)}</td><td><i class="seep-dot seep-dot-${smtzClass(c.smtz)}"></i>${c.smtz === null ? 'to base' : `${c.smtz} cm`}</td><td>${c.points}${c.longer ? ' ★' : ''}</td></tr>`).join('');
    }

    function describe(entry, newly) {
      const { site: s, finds } = entry;
      const list = finds.filter(f => f.item !== 'hydrate').map(f => `${ITEMS[f.item].name} (${ITEMS[f.item].value})`);
      let text = `${entry.corer.name} at ${s.label}: ${length(entry.cm)}${entry.refusal ? `, refusal in ${LAYERS[entry.refusal].name.toLowerCase()}` : ''}, base ≈ ${formatAge(entry.ka)}.`;
      if (entry.longer) text += ' Longest record so far.';
      text += list.length ? ` ${list.join(', ')}.` : ' No new finds.';
      text += entry.smtz === null ? ' Sulfate all the way down.' : entry.smtz < 40 ? ` Black and sulfidic from ${entry.smtz} cm: the vent is under you.` : entry.smtz < 200 ? ` Sulfate gone at ${entry.smtz} cm: methane is close.` : entry.smtz < 600 ? ` Sulfate runs out at ${entry.smtz} cm; something is venting a few sites away.` : ` Sulfate–methane transition at ${entry.smtz} cm, background for this shelf.`;
      if (state.won) text = `Gas hydrate at ${s.seepDepthCm} cm, fizzing on deck. Methane seep at ${s.label}: +${SEEP_BONUS}. ${text}`;
      else if (state.finished) text += ` Ship time is spent; the seep was under ${state.sites[state.seepIndex].label}.`;
      if (newly.length && !state.finished) text += ` ${newly.map(c => `${c.name} (${CORERS.indexOf(c) + 1})`).join(' and ')} unlocked.`;
      return text;
    }

    function lower() {
      if (!active || busy) return;
      const before = CORERS.filter(c => unlocked(state, c));
      const entry = core(state);
      if (!entry) return;
      const newly = CORERS.filter(c => !before.includes(c) && unlocked(state, c));
      busy = true;
      shown = entry;
      renderColumn(entry);
      const column = find('[data-column]');
      column.classList.remove('seep-fresh');
      void column.getBoundingClientRect();
      column.classList.add('seep-fresh');
      gameEl.classList.toggle('seep-won', state.won);
      status.textContent = `${entry.corer.name} going down at ${entry.site.label}…`;
      render();
      timer = setTimeout(() => {
        timer = null;
        if (!active) return;
        busy = false;
        status.textContent = describe(entry, newly);
        render();
        if (state.finished) save();
        else if (document.activeElement === coreButton || document.activeElement === gameEl) coreButton.focus();
      }, HAUL_MS);
    }

    function move(dc, dr) {
      if (!active || state.finished) return;
      const here = siteAt(state);
      if (!select(state, here.col + dc, here.row + dr)) return;
      const focusCell = cells.includes(document.activeElement);
      render();
      if (focusCell) cells[state.selected].focus();
      status.textContent = `${siteAt(state).label} · ${siteText(siteAt(state))}`;
    }

    function pick(id) {
      if (!active || !chooseCorer(state, id)) return;
      render();
      status.textContent = `${corer().name}: ${corer().note}`;
    }

    function save() {
      if (!active) return;
      const result = finish(state);
      if (!result) return;
      render();
      if (!state.won) status.textContent = `${result.detail.title} · ${result.points} points logged. The seep was under ${result.detail.seep}, ${result.detail.seepDepthCm} cm down.`;
      complete(result.points, result.detail);
    }

    cells.forEach((cell, i) => cell.addEventListener('click', () => {
      if (!active || state.finished) return;
      const s = state.sites[i];
      move(s.col - siteAt(state).col, s.row - siteAt(state).row);
    }, { signal: events.signal }));
    gearButtons.forEach(button => button.addEventListener('click', () => pick(button.dataset.corer), { signal: events.signal }));
    coreButton.addEventListener('click', lower, { signal: events.signal });
    finishButton.addEventListener('click', save, { signal: events.signal });
    find('[data-log]').addEventListener('click', event => {
      const row = event.target.closest('[data-show]');
      const entry = row && state.cores[Number(row.dataset.show) - 1];
      if (!entry) return;
      shown = entry;
      renderColumn(entry);
      render();
    }, { signal: events.signal });
    // Enter and Space lower the corer unless focus sits on another control in the notebook (gear, Sail on, the
    // log summary), which keeps its native activation; the core button and site cells never fire twice.
    function key(event) {
      if (!active || !gameEl.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const control = event.target?.closest?.('button, a, summary');
      if (control && !gameEl.contains(control)) return;
      const k = event.key.toLowerCase();
      const arrow = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      const gear = /^[1-5]$/.test(k) ? CORERS[Number(k) - 1] : null;
      const activate = k === 'enter' || k === ' ';
      if (activate && control && control !== coreButton && !control.hasAttribute('data-cell')) return;
      const action = arrow || gear || activate || k === 'f';
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== 'keydown' || event.repeat) return;
      if (arrow) move(...arrow);
      else if (gear) pick(gear.id);
      else if (k === 'f') { if (!finishButton.disabled) save(); }
      else lower();
    }
    window.addEventListener('keydown', key, { capture: true, signal: events.signal });
    window.addEventListener('keyup', key, { capture: true, signal: events.signal });
    render();
    return () => {
      active = false;
      events.abort();
      if (timer) clearTimeout(timer);
    };
  },
};
