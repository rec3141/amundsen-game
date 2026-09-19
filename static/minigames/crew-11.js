import { DAYS, WATCHES, SLOTS, MUTINY_AT, WATCH_LABELS, TEAMS, OPS, createGame, cardById, shipArea, lead, forecast, chance, needsText, multiplier, canPlace, place, remove, issue, summary, dayOf, watchOf } from './crew-11-model.js';
import { text } from '../i18n-text.js';

const stylesheet = new URL('./crew-11.css', import.meta.url).href;
const weatherUrl = new URL('../data/crew-11-weather.json', import.meta.url).href;
const stationsUrl = new URL('../data/crew-11-stations.json', import.meta.url).href;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KEY_CARDS = 9;

function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const pct = p => `${Math.round(p * 100)}%`;
const grade = p => (p >= 0.75 ? 'good' : p >= 0.45 ? 'fair' : 'poor');
const selectable = card => card.status === 'open' || card.status === 'planned';

export const game = {
  get title() { return text('What’s next?'); },
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    let active = true;
    let state = null;
    let selected = null;
    let cursor = 0;
    let awarded = false;
    root.innerHTML = `
      <section class="c11-game" aria-label="What’s next? Plan of the day">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="c11-heading">
          <div><p class="c11-kicker">CHIEF SCIENTIST / PLAN OF THE DAY</p><h3>What’s next?</h3></div>
          <div class="c11-meters">
            <div class="c11-morale" role="meter" aria-label="Grievances before mutiny" aria-valuemin="0" aria-valuemax="${MUTINY_AT}" aria-valuenow="0"><span>Grievances</span><div data-morale></div><small data-morale-label>0 of ${MUTINY_AT}</small></div>
            <div class="c11-score"><strong data-points>0</strong><span>points</span></div>
          </div>
        </div>
        <p class="c11-instructions">Seven days, three watches a day, and every team wants the deck. Pick a request, put it on a watch the forecast can carry, and issue the plan of the day <kbd>N</kbd>. A watch planned days ahead and left alone pays more: ×1 for tomorrow, up to ×2.5 six days out. Weather that turns, requests still on the board when the ship sails on, and transits that never happen all count against you; at ${MUTINY_AT} grievances the mess deck runs the ship.</p>
        <div class="c11-layout">
          <aside class="c11-board" aria-label="Requests">
            <div class="c11-board-heading"><h4>Requests</h4><span data-open-count></span></div>
            <div class="c11-cards" data-board><p class="c11-loading">Loading the watch record…</p></div>
            <div class="c11-card-nav" role="group" aria-label="Choose a request"><button type="button" data-prev-card>◂ Previous <kbd>Z</kbd></button><button type="button" data-next-card>Next <kbd>X</kbd> ▸</button></div>
          </aside>
          <div class="c11-planner">
            <div class="c11-planner-heading"><strong data-day-title></strong><span data-ship></span></div>
            <div class="c11-grid-wrap"><table class="c11-grid" role="grid" aria-label="Week planner: days across, watches down"><thead><tr><th scope="col" class="c11-corner">Watch</th></tr></thead><tbody></tbody></table></div>
            <div class="c11-legend" aria-hidden="true"><span><i class="c11-swatch c11-swatch-good"></i> likely</span><span><i class="c11-swatch c11-swatch-fair"></i> marginal</span><span><i class="c11-swatch c11-swatch-poor"></i> unlikely</span><span>☀ daylight · ☾ dark · ≋ fog · ↕ heave · past watches: mean (gust) kn</span></div>
            <div class="c11-actions" role="group" aria-label="Planner actions">
              <button type="button" data-place>Place <kbd>Enter</kbd></button>
              <button type="button" data-clear>Clear watch <kbd>⌫</kbd></button>
              <button type="button" class="c11-issue" data-issue>Issue plan of the day <kbd>N</kbd></button>
            </div>
          </div>
        </div>
        <div class="c11-footer"><p role="status" aria-live="polite" data-status>Loading local data…</p></div>
        <details class="c11-log"><summary>Day reports and grievances <span data-log-count></span></summary><div data-log></div></details>
        <p class="c11-source" data-source></p>
      </section>`;
    const game = root.querySelector('.c11-game');
    const find = selector => game.querySelector(selector);
    const status = find('[data-status]');
    const board = find('[data-board]');
    const tbody = find('tbody');
    const thead = find('thead tr');
    const dialog = root.closest('dialog');
    const say = text => { status.textContent = text; };

    function selectableCards() {
      return orderedCards().filter(selectable);
    }
    // Board order: crew transits first, then each area's requests in the order the ship reaches them.
    function orderedCards() {
      const crew = state.cards.filter(c => c.op === 'transit');
      const areas = [0, 1, 2].flatMap(a => state.cards.filter(c => c.area === a && c.op !== 'transit'));
      return [...crew, ...areas];
    }

    // Area the ship is in, or is about to reach, from the current planning day onward.
    function shipNow() {
      for (let slot = (state.day - 1) * WATCHES; slot < SLOTS; slot++) {
        const area = shipArea(state, slot);
        if (area >= 0) return area;
      }
      return 2;
    }

    function forecastChips(slot) {
      const f = forecast(state, slot);
      const chips = [];
      if (f.past) {
        chips.push(`<span class="c11-wx">${f.light ? '☀' : '☾'} ${Math.round(f.wind)} (${Math.round(f.gust)}) kn</span>`);
        chips.push(`<span class="c11-wx">${signed(f.air, 1)} °C${f.heave >= 0.3 ? ` · ↕ ${f.heave.toFixed(1)} m` : ''}${f.rh >= 94 ? ' · ≋ fog' : ''}</span>`);
      } else {
        const lo = Math.max(0, Math.round(f.wind - f.sigma.wind));
        const hi = Math.round(f.wind + f.sigma.wind);
        chips.push(`<span class="c11-wx">${f.light ? '☀' : '☾'} ${lo}–${hi} kn</span>`);
        const extras = [`${signed(f.air, 0)} °C`];
        if (f.heave >= 0.3) extras.push(`↕ ${f.heave.toFixed(1)} m`);
        if (f.rh >= 92) extras.push('≋');
        chips.push(`<span class="c11-wx">${extras.join(' · ')}</span>`);
      }
      return chips.join('');
    }

    function cellLabel(slot, card, odds) {
      const f = forecast(state, slot);
      const day = dayOf(slot);
      const parts = [`Day ${day}, ${dateLabel(state.watches[slot].date)}, watch ${WATCH_LABELS[watchOf(slot)]}`];
      parts.push(f.past ? `recorded wind ${Math.round(f.wind)} knots, gusts ${Math.round(f.gust)}, air ${signed(f.air, 1)} degrees` : `forecast wind ${Math.round(f.wind)} knots, air ${signed(f.air, 0)} degrees${f.light ? ', daylight' : ', dark'}`);
      if (card) {
        const op = OPS[card.op];
        if (card.status === 'done') parts.push(`${op.label} at ${card.station} done${card.points ? `, ${card.points} points` : ''}`);
        else if (card.status === 'fixed') parts.push(op.label);
        else parts.push(`${op.label} at ${card.station} planned, ${pct(chance(state, card.op, slot))} likely, times ${multiplier(day - card.placedDay).toFixed(2)}`);
      } else if (odds !== null) parts.push(`${pct(odds)} likely for the selected request`);
      return parts.join('. ');
    }

    function renderGrid() {
      const past = (state.day - 1) * WATCHES;
      const pick = selected ? cardById(state, selected) : null;
      thead.innerHTML = `<th scope="col" class="c11-corner">Watch</th>${Array.from({ length: DAYS }, (_, d) => {
        const slot = d * WATCHES;
        const cls = d + 1 < state.day ? 'c11-day-past' : d + 1 === state.day ? 'c11-day-now' : '';
        return `<th scope="col" class="${cls}"><b>Day ${d + 1}</b><small>${dateLabel(state.watches[slot].date)}</small></th>`;
      }).join('')}`;
      tbody.innerHTML = Array.from({ length: WATCHES }, (_, w) => `<tr><th scope="row"><b>${WATCH_LABELS[w]}</b></th>${Array.from({ length: DAYS }, (_, d) => {
        const slot = d * WATCHES + w;
        const card = cardById(state, state.grid[slot]);
        const area = shipArea(state, slot);
        const classes = ['c11-cell'];
        let odds = null;
        if (slot < past) classes.push('c11-past');
        if (slot === cursor) classes.push('c11-cursor');
        classes.push(`c11-area-${area < 0 ? 'transit' : area}`);
        let body = forecastChips(slot);
        if (card) {
          const op = OPS[card.op];
          const first = card.placed === slot;
          const failed = state.log.some(r => r.entries.some(e => e.slot === slot && e.ok === false));
          classes.push('c11-held', `c11-kind-${op.kind}`);
          const detail = !first ? '' : card.op === 'transit' ? (card.status === 'done' ? '✓ arrived' : 'departs') : card.status === 'done' && op.base > 0 ? `✓ ${card.points} pts` : card.status === 'planned' ? `${pct(chance(state, card.op, slot))} · ×${multiplier(dayOf(slot) - card.placedDay).toFixed(2)}` : '';
          if (card.status === 'planned' && card.id === selected) classes.push('c11-selected');
          body += `<span class="c11-chip" style="--team:${TEAMS[card.team].color}"><b>${escape(first ? op.short : 'under way')}</b>${first && card.op !== 'drill' ? `<i>${escape(card.station)}</i>` : ''}</span>${detail ? `<span class="c11-odds">${detail}</span>` : ''}`;
          if (failed && slot < past) classes.push('c11-failed');
        } else if (slot < past) {
          const entry = state.log.flatMap(r => r.entries).find(e => e.slot === slot);
          if (entry?.ok === false) {
            classes.push('c11-failed');
            body += `<span class="c11-chip c11-chip-lost" style="--team:${TEAMS[entry.card.team].color}"><b>${escape(OPS[entry.card.op].short)}</b><i>✗ ${escape(entry.reasons.join(', '))}</i></span>`;
          } else body += '<span class="c11-odds">idle</span>';
        } else if (pick && !state.finished) {
          const check = canPlace(state, pick.id, slot);
          if (check.ok) {
            odds = pick.op === 'transit' ? 1 : chance(state, pick.op, slot);
            classes.push(`c11-${grade(odds)}`);
            body += `<span class="c11-odds">${pick.op === 'transit' ? 'clear' : pct(odds)} · ×${multiplier(lead(state, slot)).toFixed(2)}</span>`;
          } else classes.push('c11-invalid');
        }
        return `<td><button type="button" class="${classes.join(' ')}" data-slot="${slot}" aria-label="${escape(cellLabel(slot, card, odds))}" ${slot === cursor ? 'aria-current="true"' : ''}>${body}</button></td>`;
      }).join('')}</tr>`).join('');
    }

    function cardMarkup(card, index) {
      const op = OPS[card.op];
      const team = TEAMS[card.team];
      const planned = card.status === 'planned';
      const where = planned ? `Day ${dayOf(card.placed)} · ${WATCH_LABELS[watchOf(card.placed)]} · ${card.op === 'transit' ? 'two watches' : pct(chance(state, card.op, card.placed))} · ×${multiplier(dayOf(card.placed) - card.placedDay).toFixed(2)}` : needsText(card.op) || (card.op === 'transit' ? 'two consecutive watches' : '');
      const label = `${op.label} at ${card.station}, ${team.name}${op.base ? `, ${op.base} points` : ''}${planned ? `, planned day ${dayOf(card.placed)} watch ${WATCH_LABELS[watchOf(card.placed)]}` : ''}${index !== null ? `, key ${index + 1}` : ''}`;
      return `<button type="button" class="c11-card ${planned ? 'c11-planned' : ''}" data-card="${card.id}" style="--team:${team.color}" aria-pressed="${card.id === selected}" aria-label="${escape(label)}">
        <span class="c11-card-key">${index !== null ? index + 1 : ''}</span>
        <span class="c11-card-body"><b>${escape(op.label)}${card.detail ? ` <em>(${escape(card.detail)})</em>` : ''}</b><i>${escape(card.station)}</i><small>${escape(where)}</small></span>
        <span class="c11-card-pts">${op.base ? `${op.base}<small>pts</small>` : '<small>crew</small>'}</span>
      </button>`;
    }

    function renderBoard() {
      const ordered = orderedCards();
      const live = ordered.filter(selectable);
      const keys = new Map(live.slice(0, KEY_CARDS).map((c, i) => [c.id, i]));
      const groups = [{ title: TEAMS.crew.name, note: 'obligations', cards: ordered.filter(c => c.op === 'transit' && selectable(c)) }];
      const here = shipNow();
      const underway = shipArea(state, (state.day - 1) * WATCHES) < 0;
      state.areas.forEach((a, index) => {
        groups.push({ title: a.area, note: index === here ? (underway ? 'ship arriving' : 'ship is here') : index < here ? 'astern' : `after transit ${index}`, cards: ordered.filter(c => c.area === index && c.op !== 'transit' && selectable(c)) });
      });
      const settled = ordered.filter(c => c.status === 'done' || c.status === 'missed').filter(c => c.op !== 'drill');
      board.innerHTML = groups.filter(g => g.cards.length).map(g => `<div class="c11-group"><h5>${escape(g.title)} <small>${escape(g.note)}</small></h5>${g.cards.map(c => cardMarkup(c, keys.has(c.id) ? keys.get(c.id) : null)).join('')}</div>`).join('')
        + (live.length ? '' : `<p class="c11-empty">${state.finished ? 'The week is planned.' : 'Every request is planned. Issue the plan of the day.'}</p>`)
        + (settled.length ? `<div class="c11-group c11-settled"><h5>Settled</h5>${settled.map(c => `<div class="c11-settled-row c11-${c.status}" style="--team:${TEAMS[c.team].color}"><b>${escape(OPS[c.op].short)}</b> <i>${escape(c.station)}</i><span>${c.status === 'done' ? (OPS[c.op].base ? `✓ ${c.points}` : '✓') : '✗ missed'}</span></div>`).join('')}</div>` : '');
      find('[data-open-count]').textContent = `${live.filter(c => c.status === 'open').length} unplanned · ${live.filter(c => c.status === 'planned').length} planned`;
    }

    function renderMeters() {
      const n = state.grievances.length;
      find('[data-points]').textContent = state.mutiny ? 0 : state.points;
      const morale = find('.c11-morale');
      morale.setAttribute('aria-valuenow', n);
      find('[data-morale]').innerHTML = Array.from({ length: MUTINY_AT }, (_, i) => `<i class="${i < n ? 'c11-pip-on' : ''}"></i>`).join('');
      find('[data-morale-label]').textContent = `${n} of ${MUTINY_AT}`;
      morale.classList.toggle('c11-tense', n >= MUTINY_AT - 2);
      find('[data-day-title]').textContent = state.finished ? (state.mutiny ? 'Mutiny' : 'Week complete') : `Planning day ${state.day} of ${DAYS}`;
      const here = shipArea(state, (state.day - 1) * WATCHES);
      find('[data-ship]').textContent = `Ship: ${here < 0 ? 'under way' : state.areas[here].area}`;
      const issueButton = find('[data-issue]');
      issueButton.disabled = state.finished;
      issueButton.innerHTML = state.finished ? (state.mutiny ? 'Command lost' : 'Week planned ✓') : `Issue plan for day ${state.day} <kbd>N</kbd>`;
      find('[data-place]').disabled = state.finished || !selected;
      find('[data-clear]').disabled = state.finished || !cardById(state, state.grid[cursor]) || cardById(state, state.grid[cursor]).status !== 'planned';
      find('[data-prev-card]').disabled = state.finished || selectableCards().length < 2;
      find('[data-next-card]').disabled = state.finished || selectableCards().length < 2;
    }

    function renderLog() {
      find('[data-log-count]').textContent = state.log.length ? `(${state.log.length} day${state.log.length === 1 ? '' : 's'}, ${state.grievances.length} grievance${state.grievances.length === 1 ? '' : 's'})` : '';
      find('[data-log]').innerHTML = [...state.log].reverse().map(r => `<div class="c11-report"><h5>Day ${r.day} · ${dateLabel(state.watches[(r.day - 1) * WATCHES].date)}</h5><ul>${r.entries.map(e => {
        const watch = WATCH_LABELS[watchOf(e.slot)];
        if (e.idle) return `<li><span>${watch}</span> idle</li>`;
        const op = OPS[e.card.op];
        if (e.underway) return `<li><span>${watch}</span> under way</li>`;
        if (e.arrived) return `<li><span>${watch}</span> arrived ${escape(e.arrived)}</li>`;
        if (!e.ok) return `<li class="c11-bad"><span>${watch}</span> ${escape(op.label)} at ${escape(e.card.station)} ✗ ${escape(e.reasons.join(', '))}</li>`;
        return `<li class="c11-ok"><span>${watch}</span> ${escape(op.label)}${e.card.op === 'drill' ? '' : ` at ${escape(e.card.station)}`}${op.base ? ` ✓ ${e.points} pts (×${multiplier(e.lead).toFixed(2)}${e.note ? `, ${e.note}` : ''})` : ' ✓'}</li>`;
      }).join('')}${r.missed.map(c => `<li class="c11-bad"><span>—</span> ${escape(OPS[c.op].label)} at ${escape(c.station)} missed</li>`).join('')}${r.bonus ? `<li class="c11-ok"><span>—</span> ${r.contentTeams.length} team${r.contentTeams.length === 1 ? '' : 's'} without a grievance: +${r.bonus} pts</li>` : ''}${r.mutiny ? '<li class="c11-bad"><span>—</span> Mutiny: the mess deck takes the plan out of your hands.</li>' : ''}</ul></div>`).join('')
        + (state.grievances.length ? `<div class="c11-report"><h5>Grievances</h5><ul>${state.grievances.map(g => `<li class="c11-bad"><span>${escape(TEAMS[g.team].short)}</span> ${escape(g.text)}</li>`).join('')}</ul></div>` : '');
    }

    function render() {
      if (!state) return;
      if (selected && !selectable(cardById(state, selected) ?? {})) selected = null;
      renderBoard();
      renderGrid();
      renderMeters();
      renderLog();
    }

    function select(id, announce = true) {
      selected = id;
      const card = cardById(state, id);
      render();
      if (card && announce) {
        const op = OPS[card.op];
        say(card.status === 'planned'
          ? `${op.label} at ${card.station} is planned for day ${dayOf(card.placed)}, ${WATCH_LABELS[watchOf(card.placed)]}. Choose another watch to move it, or clear it.`
          : `${op.label} at ${card.station}${op.needs && Object.keys(op.needs).length ? `: needs ${needsText(card.op)}` : card.op === 'transit' ? ': two consecutive watches under way' : ''}. Green watches are likely to carry it.`);
      }
    }

    function cycle(direction) {
      const cards = selectableCards();
      if (!cards.length) return;
      const index = cards.findIndex(c => c.id === selected);
      select(cards[(index + direction + cards.length) % cards.length].id);
    }

    function nextOpen(after) {
      const cards = selectableCards().filter(c => c.status === 'open');
      if (!cards.length) return null;
      const index = cards.findIndex(c => c.id === after);
      return cards[(index + 1) % cards.length]?.id ?? cards[0].id;
    }

    function moveCursor(dayDelta, watchDelta) {
      const d = Math.min(DAYS - 1, Math.max(0, Math.floor(cursor / WATCHES) + dayDelta));
      const w = Math.min(WATCHES - 1, Math.max(0, cursor % WATCHES + watchDelta));
      cursor = d * WATCHES + w;
      render();
      const button = find(`[data-slot="${cursor}"]`);
      if (document.activeElement?.closest('.c11-grid')) button?.focus();
      say(button?.getAttribute('aria-label') ?? '');
    }

    // Enter, Space or a click on the cursor watch: place the selected request, or pick up whatever sits there.
    function act(slot = cursor) {
      if (!active || !state || state.finished) return;
      cursor = slot;
      const occupant = cardById(state, state.grid[slot]);
      if (selected) {
        const card = cardById(state, selected);
        const result = place(state, selected, slot);
        if (!result.ok) {
          if (occupant && occupant.status === 'planned' && occupant.id !== selected) { select(occupant.id); return; }
          render();
          say(result.reason);
          return;
        }
        const op = OPS[card.op];
        if (result.unchanged) { selected = nextOpen(card.id); render(); say(`${op.label} at ${card.station} already holds that watch.`); return; }
        const bumped = result.bumped.length ? ` ${result.bumped.map(c => `${OPS[c.op].short} at ${c.station}`).join(', ')} came back to the board.` : '';
        const odds = card.op === 'transit' ? '' : ` ${pct(chance(state, card.op, slot))} likely,`;
        say(`${op.label} at ${card.station} ${result.moved ? 'moved to' : 'planned for'} day ${dayOf(slot)}, ${WATCH_LABELS[watchOf(slot)]}:${odds} ×${multiplier(lead(state, slot)).toFixed(2)} if it holds.${bumped}`);
        selected = nextOpen(card.id);
        render();
        return;
      }
      if (occupant && occupant.status === 'planned') { select(occupant.id); return; }
      render();
      say(occupant ? `${OPS[occupant.op].label} is fixed on that watch.` : 'Choose a request first: Z and X cycle, or press its number.');
    }

    function clear(slot = cursor) {
      if (!active || !state || state.finished) return;
      cursor = slot;
      const result = remove(state, slot);
      render();
      if (!result.ok) { say(result.reason); return; }
      const bumped = result.bumped.length ? ` ${result.bumped.map(c => `${OPS[c.op].short} at ${c.station}`).join(', ')} came back too.` : '';
      say(`${OPS[result.card.op].label} at ${result.card.station} is back on the board.${bumped}`);
    }

    function finishGame() {
      if (awarded) return;
      awarded = true;
      const detail = summary(state);
      complete(detail.points, detail);
    }

    function issueDay() {
      if (!active || !state || state.finished) return;
      const report = issue(state);
      if (!report) return;
      cursor = Math.min(SLOTS - 1, (state.day - 1) * WATCHES);
      selected = nextOpen(null);
      render();
      const done = report.entries.filter(e => e.ok && e.card && OPS[e.card.op].base > 0);
      const lost = report.entries.filter(e => e.ok === false);
      const gained = done.reduce((s, e) => s + e.points, 0);
      const parts = [`Day ${report.day} issued: ${done.length} operation${done.length === 1 ? '' : 's'} done${gained ? `, +${gained} points` : ''}.`];
      if (lost.length) parts.push(lost.map(e => `${OPS[e.card.op].label} at ${e.card.station} lost its window (${e.reasons.join(', ')}).`).join(' '));
      if (report.missed.length) parts.push(`${report.missed.length} request${report.missed.length === 1 ? '' : 's'} missed.`);
      if (report.mutiny) {
        parts.push(`${state.grievances.length} grievances: the mess deck votes and the plan is no longer yours. No points this week.`);
        game.classList.add('c11-mutinied');
      } else if (report.finished) {
        parts.push(`Week complete${report.bonus ? `, ${report.contentTeams.length} team${report.contentTeams.length === 1 ? '' : 's'} content (+${report.bonus})` : ''}: ${state.points} points saved.`);
      } else {
        const arrival = report.entries.find(e => e.arrived);
        if (arrival) parts.push(`Ship in ${arrival.arrived}.`);
        parts.push(`Now planning day ${state.day}.`);
      }
      say(parts.join(' '));
      find('.c11-log').open = report.finished || lost.length > 0 || report.missed.length > 0 || find('.c11-log').open;
      if (report.finished) finishGame();
    }

    game.addEventListener('click', event => {
      if (!active || !state) return;
      const cardButton = event.target.closest('[data-card]');
      if (cardButton) { select(Number(cardButton.dataset.card)); return; }
      const cell = event.target.closest('[data-slot]');
      if (cell) { act(Number(cell.dataset.slot)); return; }
      if (event.target.closest('[data-place]')) act();
      else if (event.target.closest('[data-clear]')) clear();
      else if (event.target.closest('[data-issue]')) issueDay();
      else if (event.target.closest('[data-prev-card]')) cycle(-1);
      else if (event.target.closest('[data-next-card]')) cycle(1);
    }, { signal: events.signal });

    window.addEventListener('keydown', event => {
      if (!active || !state || !game.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const inGrid = Boolean(event.target?.closest?.('.c11-grid'));
      const handlers = {
        arrowleft: () => moveCursor(-1, 0), arrowright: () => moveCursor(1, 0), arrowup: () => moveCursor(0, -1), arrowdown: () => moveCursor(0, 1),
        z: () => cycle(-1), x: () => cycle(1), n: issueDay, backspace: () => clear(), delete: () => clear(),
      };
      if (/^[1-9]$/.test(key)) handlers[key] = () => { const card = selectableCards()[Number(key) - 1]; if (card) select(card.id); };
      // Enter and Space act on the cursor watch only when focus is on the planner or nowhere in particular; buttons keep their own click.
      if ((key === 'enter' || key === ' ') && (inGrid || !event.target?.closest?.('button, summary, a'))) handlers[key] = () => act();
      const handler = handlers[key];
      if (!handler) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat && key !== 'arrowleft' && key !== 'arrowright' && key !== 'arrowup' && key !== 'arrowdown') return;
      handler();
    }, { capture: true, signal: events.signal });

    (async () => {
      try {
        const [weather, stations] = await Promise.all([weatherUrl, stationsUrl].map(async url => {
          const response = await fetch(url, { signal: events.signal });
          if (!response.ok) throw new Error(`${url} (${response.status})`);
          return response.json();
        }));
        if (!active) return;
        state = createGame(expedition?.seed ?? `${Date.now()}:${Math.random()}`, weather, stations);
        cursor = 0;
        selected = orderedCards().find(selectable)?.id ?? null;
        const first = state.watches[0].date, last = state.watches[SLOTS - 1].date;
        find('[data-source]').textContent = `Watch conditions are the ship’s own underway record for ${dateLabel(first)} – ${dateLabel(last)} (Leg 3, 2026), binned to 8-hour watches: relative wind as logged, air temperature, 4σ heave, humidity and short-wave radiation. Stations come from the Leg 3 cruise plan (${stations.stamp?.slice(0, 10) ?? 'plan'}). Forecast bands widen with lead time; what happens on the day is what was recorded.`;
        render();
        say(`Ship in ${state.areas[0].area}, bound for ${state.areas[1].area} and ${state.areas[2].area}. ${state.cards.filter(c => OPS[c.op].base > 0).length} requests on the board. Arrow keys move the planner cursor; Z and X or the numbers choose a request; Enter places it.`);
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        console.error(error);
        board.innerHTML = '';
        say('Could not load the watch record or the station plan from the local data folder. Close and reopen the operation to try again.');
      }
    })();

    return () => {
      active = false;
      events.abort();
    };
  },
};
