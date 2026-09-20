// Neptune's Wrath: the sea king boards, lends a purse of tribute and sits five trials.
// Passing a trial adds to the purse, failing takes from it, three failures end the court
// early. Whatever is left in the purse is logged as the operation's points.
import { TRIBUTE, PASS_AWARD, FAIL_TAKE, WRATH_FAILS, WRATH_TAKE, BLUE_NOSE, TRIALS_PER_COURT, mulberry32, hashSeed, shuffle, applyVerdict, mood } from './crew-15-model.js';
import { TRIALS, WIDTH, HEIGHT, drawScene } from './crew-15-trials.js';
import { text } from '../i18n-text.js';

const stylesheet = new URL('./crew-15.css', import.meta.url).href;
const dataFile = new URL('../data/crew-15-neptune.json', import.meta.url).href;

const GREETINGS = [
  'A wake boils alongside, and a crowned head breaks the surface. "So. Another hull scratching at my roof of ice."',
  'The sounder loses the bottom. Something older than the bottom is looking up. "You steam through my realm and log it in tenths of a degree. Let us see what you know."',
];
const PASS_LINES = ['"Adequate."', '"The sea has seen worse."', '"Hm. Keep it."', '"You may yet earn a blue nose."'];
const FAIL_LINES = ['"No. Give it back."', '"The deep keeps that."', '"Mortals."', '"Was that a guess?"'];
const WRATH_LINE = '"ENOUGH." The trident strikes the deck. The table goes over, the purse with it, and the sea closes over the crown.';
const BLUE_NOSE_LINE = '"Well. A blue nose for you, then." He takes the trident back, and the wake goes flat and quiet.';

export const game = {
  get title() { return text("Neptune's Wrath"); },
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const rng = mulberry32(hashSeed(`${expedition?.x ?? 0}:${expedition?.y ?? 0}:${Date.now()}`));
    const order = shuffle(rng, TRIALS).slice(0, TRIALS_PER_COURT);
    const state = { phase: 'arrival', index: 0, ledger: { purse: TRIBUTE, fails: 0, passes: 0 }, results: [], logged: false, wrath: false, blueNose: false, verdict: null };
    let data = { extremes: null, soundings: [{ time: '2026-09-17T00:17Z', lat: 78.684, lon: -82.641, depth: 600 }] };
    let active = true, frame = 0, last = 0, t = 0, trial = null, trialEvents = null;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (active) fn(); }, ms); timers.add(id); return id; };

    root.innerHTML = `
      <section class="np-game" aria-label="Neptune's Wrath">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="np-heading"><div><p class="np-kicker">CROSSING THE LINE / NEPTUNE'S <i>WRATH</i></p>
          <h3>The sea king boards with a purse. Pass his trials and it grows; fail them and he takes it back.</h3></div>
          <div class="np-score"><strong data-purse>${TRIBUTE}</strong><span>in the purse</span></div></div>
        <ol class="np-trials" aria-label="Trials">${order.map((tr, i) => `<li data-trial="${i}"><span>${i + 1}</span>${tr.name}</li>`).join('')}</ol>
        <div class="np-layout">
          <div class="np-stage">
            <div class="np-frame">
              <canvas class="np-canvas" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Neptune's court"></canvas>
              <div class="np-overlay" data-overlay></div>
            </div>
            <div class="np-controls" data-controls></div>
            <div class="np-actions">
              <button type="button" class="np-primary" data-primary></button>
            </div>
          </div>
          <aside class="np-guide">
            <h4>The court</h4>
            <p class="np-mood"><span>Neptune's temper</span><meter data-mood min="0" max="1" value="0.15" aria-label="Neptune's temper"></meter></p>
            <table><caption>Ledger</caption><thead><tr><th scope="col">Trial</th><th scope="col">Result</th><th scope="col">Purse</th></tr></thead><tbody data-ledger><tr><th scope="row">Tribute</th><td>lent</td><td>${TRIBUTE}</td></tr></tbody></table>
            <p class="np-rules">Passed trials add ${PASS_AWARD} plus any bonus for pleasing him; failed trials give back ${FAIL_TAKE}. ${WRATH_FAILS} failures and his patience ends, along with ${WRATH_TAKE} more. Clear all ${TRIALS_PER_COURT} for a blue nose worth ${BLUE_NOSE}.</p>
            <p class="np-record" data-record>Leg record loading…</p>
          </aside>
        </div>
        <div class="np-footer"><p role="status" aria-live="polite" data-status>Something is rising alongside. Press Space to face him.</p></div>
      </section>`;
    const view = root.querySelector('.np-game');
    const find = selector => view.querySelector(selector);
    const canvas = find('.np-canvas');
    const g = canvas.getContext('2d');
    const overlay = find('[data-overlay]');
    const controls = find('[data-controls]');
    const status = find('[data-status]');
    const primary = find('[data-primary]');
    const dialog = root.closest('dialog');
    const say = text => { status.textContent = text; };

    fetch(dataFile).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText))).then(json => {
      if (!active || !json?.extremes) return;
      data = json;
      const e = json.extremes;
      find('[data-record]').textContent = `Leg record ${json.record.start.slice(0, 10)} to ${json.record.end.slice(0, 10)}: ${json.distanceKm.toFixed(0)} km steamed, deepest sounding ${e.depthMax.value.toFixed(0)} m, coldest surface ${e.sstMin.value.toFixed(2)} °C, strongest wind ${e.windMax.value.toFixed(0)} kn, worst roll and pitch ${e.rollMax.value.toFixed(1)}° RMS. His riddles draw on it.`;
    }).catch(() => {
      if (active) find('[data-record]').textContent = 'Leg record unavailable; the riddles fall back to sea lore and the sounding to the water beneath the keel.';
    });

    const current = () => order[state.index];

    function card(kicker, title, lines, extra = '') {
      overlay.innerHTML = `<div class="np-card"><p class="np-kicker">${kicker}</p><b>${title}</b>${lines.map(l => `<span>${l}</span>`).join('')}${extra}</div>`;
      overlay.hidden = false;
    }

    function arrival() {
      state.phase = 'arrival';
      card('THE SEA KING BOARDS', 'Neptune', [GREETINGS[Math.floor(rng() * GREETINGS.length)], `He drops a purse of ${TRIBUTE} points on the deck. "On loan. ${TRIALS_PER_COURT} trials. We shall see how much of it you keep."`]);
      render();
    }

    function brief() {
      const tr = current();
      state.phase = 'brief';
      const ctx = { data, expedition, truthHere: Number.isFinite(expedition?.depth) && expedition.depth >= 5 };
      card(`TRIAL ${state.index + 1} · ${tr.kicker}`, tr.name, [tr.brief(ctx), `Controls: ${tr.controls}, or the buttons below.`]);
      say(`Trial ${state.index + 1} of ${order.length}: ${tr.name}. Space to begin.`);
      render();
    }

    function begin() {
      const tr = current();
      state.phase = 'trial';
      overlay.hidden = true; overlay.replaceChildren();
      controls.replaceChildren();
      trialEvents = new AbortController();
      let finished = false;
      const ctx = {
        g, rng, data, expedition, controls, say, signal: trialEvents.signal,
        finish: verdict => { if (!finished && active && state.phase === 'trial') { finished = true; settle(verdict); } },
      };
      trial = tr.start(ctx);
      render();
      canvas.focus?.();
    }

    function settle(verdict) {
      const tr = current();
      trial?.cleanup?.(); trialEvents?.abort(); trial = null;
      controls.replaceChildren();
      const before = state.ledger.purse;
      state.ledger = applyVerdict(state.ledger, verdict);
      state.results.push({ trial: tr.name, passed: verdict.passed, headline: verdict.headline, change: state.ledger.change, purse: state.ledger.purse });
      state.verdict = verdict;
      state.wrath = state.ledger.wrath;
      const last = state.index === order.length - 1;
      state.blueNose = last && !state.wrath && state.ledger.fails === 0;
      if (state.blueNose) state.ledger.purse += BLUE_NOSE;
      state.phase = 'verdict';
      const change = state.ledger.change;
      const quote = verdict.passed ? PASS_LINES[Math.floor(rng() * PASS_LINES.length)] : FAIL_LINES[Math.floor(rng() * FAIL_LINES.length)];
      const lines = [verdict.note, `${quote} ${change >= 0 ? `+${change}` : change} into the purse: ${before} → ${state.ledger.purse - (state.blueNose ? BLUE_NOSE : 0)}.`];
      if (state.wrath) lines.push(`${WRATH_LINE} −${WRATH_TAKE}.`);
      else if (state.blueNose) lines.push(`${BLUE_NOSE_LINE} +${BLUE_NOSE}.`);
      card(verdict.passed ? 'PASSED' : 'FAILED', verdict.headline, lines);
      overlay.querySelector('.np-card').classList.add(verdict.passed ? 'np-pass' : 'np-fail');
      say(`${tr.name} ${verdict.passed ? 'passed' : 'failed'}: ${verdict.headline}. Purse ${Math.max(0, state.ledger.purse)}. ${state.wrath || last ? 'Enter to log.' : 'Space for the next trial.'}`);
      render();
      primary.focus();
    }

    function proceed() {
      if (!active) return;
      if (state.phase === 'arrival') { brief(); return; }
      if (state.phase === 'brief') { begin(); return; }
      if (state.phase === 'verdict') {
        if (state.wrath || state.index === order.length - 1) log();
        else { state.index += 1; brief(); }
      }
    }

    function log() {
      if (!active || state.logged || state.phase !== 'verdict') return;
      state.logged = true;
      state.phase = 'done';
      const points = Math.max(0, state.ledger.purse);
      const detail = {
        title: state.wrath ? `Neptune's wrath: ${state.ledger.passes} of ${order.length} trials before he lost patience` : state.blueNose ? 'Order of the Blue Nose: every trial of Neptune passed' : `Neptune's court: ${state.ledger.passes} of ${order.length} trials passed`,
        tribute: TRIBUTE, purse: state.ledger.purse, passed: state.ledger.passes, failed: state.ledger.fails,
        wrath: state.wrath, blueNose: state.blueNose,
        trials: state.results,
        record: data.record ? { start: data.record.start, end: data.record.end } : null,
      };
      card('LOGGED', `${points} points`, [detail.title + '.', state.ledger.purse < 0 ? 'The purse is empty; the deck is wet; nothing more can be taken.' : 'The purse is yours to keep.']);
      say(`Logged ${points} points: ${detail.title.toLowerCase()}.`);
      render();
      complete(points, detail);
    }

    function render() {
      find('[data-purse]').textContent = Math.max(0, state.ledger.purse);
      find('[data-mood]').value = mood(state.ledger);
      view.querySelectorAll('[data-trial]').forEach((item, i) => {
        const r = state.results[i];
        item.classList.toggle('np-current', i === state.index && !state.logged && !state.wrath);
        item.classList.toggle('np-passed', !!r?.passed);
        item.classList.toggle('np-failed', !!r && !r.passed);
        item.setAttribute('aria-current', i === state.index ? 'step' : 'false');
      });
      find('[data-ledger]').innerHTML = `<tr><th scope="row">Tribute</th><td>lent</td><td>${TRIBUTE}</td></tr>` + state.results.map(r => `<tr class="${r.passed ? 'np-pass' : 'np-fail'}"><th scope="row">${r.trial}</th><td>${r.change >= 0 ? '+' : ''}${r.change}</td><td>${r.purse}</td></tr>`).join('')
        + (state.blueNose ? `<tr class="np-pass"><th scope="row">Blue nose</th><td>+${BLUE_NOSE}</td><td>${state.ledger.purse}</td></tr>` : '');
      const playing = state.phase === 'trial';
      view.classList.toggle('np-playing', playing);
      primary.hidden = playing || state.phase === 'done';
      const endNext = state.phase === 'verdict' && (state.wrath || state.index === order.length - 1);
      primary.innerHTML = state.phase === 'arrival' ? 'Face him <kbd>Space</kbd>'
        : state.phase === 'brief' ? `Begin: ${current().name} <kbd>Space</kbd>`
        : state.phase === 'verdict' ? (endNext ? `Log ${Math.max(0, state.ledger.purse)} points <kbd>Enter</kbd>` : `Next trial: ${order[state.index + 1].name} <kbd>Space</kbd>`)
        : '';
    }

    function tick(now) {
      if (!active) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016;
      last = now; t += dt;
      const focus = state.phase === 'trial';
      drawScene(g, t, mood(state.ledger), focus);
      if (focus && trial?.frame) trial.frame(now, dt, t);
      frame = requestAnimationFrame(tick);
    }

    primary.addEventListener('click', proceed, { signal: events.signal });
    overlay.addEventListener('click', () => { if (state.phase === 'arrival' || state.phase === 'brief') proceed(); }, { signal: events.signal });
    const onKey = (event, down) => {
      if (!active || !view.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      if (state.phase === 'trial' && trial?.key) {
        if (trial.key(key, down)) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      if (!down) return;
      const control = key === ' ' || key === 'enter';
      if (!control) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (key === 'enter' && state.phase === 'verdict' && (state.wrath || state.index === order.length - 1)) { log(); return; }
      proceed();
    };
    window.addEventListener('keydown', e => onKey(e, true), { capture: true, signal: events.signal });
    window.addEventListener('keyup', e => onKey(e, false), { capture: true, signal: events.signal });

    arrival();
    frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      events.abort();
      trialEvents?.abort();
      trial?.cleanup?.();
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  },
};
