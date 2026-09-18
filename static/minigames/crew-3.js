import { PLATFORMS, CLASSES, renderScene, mulberry32, hashSeed, WIDTH, HEIGHT } from './crew-3-scenes.js';

const stylesheet = new URL('./crew-3.css', import.meta.url).href;
const chartFile = new URL('../data/crew-3-ice-charts.json', import.meta.url).href;
const DECK = 10;
const PASS_CORRECT = 7;
const FEEDBACK_MS = 1300;
const HOME_REGION = 'Eastern Arctic';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;

// A level's deck: class mix follows the chart's old-ice share, clamped so both answers stay live.
function makeDeck(rng, oldShare) {
  const olds = clamp(Math.round(DECK * oldShare), 4, 6);
  const cards = Array.from({ length: DECK }, (_, i) => ({ iceClass: i < olds ? 'old' : 'firstYear', seed: Math.floor(rng() * 2 ** 31) }));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards.map((card, i) => ({ ...card, difficulty: i / (DECK - 1) }));
}

export const game = {
  title: 'Cliceify',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const rng = mulberry32(hashSeed(`${expedition?.x ?? 0}:${expedition?.y ?? 0}:${Date.now()}`));
    const state = {
      level: 0, index: 0, phase: 'intro', deck: [], calls: [],
      banked: 0, cleared: [], attempts: [0, 0, 0, 0], history: [], logged: false,
      chart: { region: HOME_REGION, date: null, oldShare: 0.5, note: 'Chart mix loading' },
    };
    let active = true;
    let frame = 0;
    let timer = 0;
    let shownAt = 0;
    let feedbackAt = 0;
    const buffer = document.createElement('canvas');
    let bufferedCue = null;

    root.innerHTML = `
      <section class="cl-game" aria-label="Cliceify ice classification">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="cl-heading"><div><p class="cl-kicker">ICE OBSERVER / CL<i>ICE</i>IFY</p>
          <h3>Call the ice: first-year or multi-year, as fast as you can.</h3></div><div class="cl-score"><strong data-score>0</strong><span>points</span></div></div>
        <ol class="cl-levels" aria-label="Platforms">${PLATFORMS.map(p => `<li data-level="${p.level}"><span>${p.level}</span>${p.name}</li>`).join('')}</ol>
        <div class="cl-layout">
          <div class="cl-stage">
            <div class="cl-frame">
              <canvas class="cl-image" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Ice scene to classify"></canvas>
              <div class="cl-timer" role="meter" aria-label="Time left"><div data-timer></div></div>
              <div class="cl-meta"><span data-frame></span><span data-sensor></span></div>
              <div class="cl-overlay" data-overlay></div>
            </div>
            <div class="cl-answers" role="group" aria-label="Classification">
              <button type="button" data-answer="firstYear"><b>First-year</b><small><kbd>F</kbd> or <kbd>←</kbd></small></button>
              <button type="button" data-answer="old"><b>Multi-year</b><small><kbd>M</kbd> or <kbd>→</kbd></small></button>
            </div>
            <div class="cl-actions">
              <button type="button" class="cl-primary" data-primary></button>
              <button type="button" data-log>Log results</button>
            </div>
          </div>
          <aside class="cl-guide">
            <h4>Field guide · <span data-guide-platform></span></h4>
            <div class="cl-guide-cols"><div><b>First-year</b><ul data-guide-fy></ul></div><div><b>Multi-year</b><ul data-guide-old></ul></div></div>
            <p class="cl-chart" data-chart></p>
            <details class="cl-log"><summary>Call log <span data-log-count></span></summary>
              <table><caption>Levels</caption><thead><tr><th scope="col">Platform</th><th scope="col">Correct</th><th scope="col">Mean</th><th scope="col">Points</th></tr></thead><tbody data-log-body></tbody></table>
            </details>
            <p class="cl-reward">5 points per correct call, up to 5 more for speed. Clear a platform with ${PASS_CORRECT} of ${DECK} right and a mean call under its limit for a 10 × level bonus.</p>
          </aside>
        </div>
        <div class="cl-footer"><p role="status" aria-live="polite" data-status>Level 1 waits on the surface. Press Space to start.</p></div>
      </section>`;
    const view = root.querySelector('.cl-game');
    const find = selector => view.querySelector(selector);
    const canvas = find('.cl-image');
    const ctx = canvas.getContext('2d');
    const overlay = find('[data-overlay]');
    const timerBar = find('[data-timer]');
    const status = find('[data-status]');
    const primary = find('[data-primary]');
    const logButton = find('[data-log]');
    const answerButtons = [...view.querySelectorAll('[data-answer]')];
    const dialog = root.closest('dialog');

    const platform = () => PLATFORMS[state.level];
    const card = () => state.deck[state.index];

    function chartLine() {
      const c = state.chart;
      if (!c.date) return c.note;
      const day = new Date(`${c.date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      return `CIS ${c.region} chart, ${day}: old ice is ${Math.round(c.oldShare * 100)}% of the charted partial concentrations, in ${c.polygonsWithOldIce} of ${c.icePolygons} ice polygons. Decks are dealt to that mix.`;
    }

    fetch(chartFile).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText))).then(data => {
      if (!active) return;
      const charts = (data.charts || []).filter(c => c.icePolygons > 0 && (c.tenths.old + c.tenths.firstYear) > 0);
      const pick = charts.filter(c => c.region === HOME_REGION).sort((a, b) => b.date.localeCompare(a.date))[0] || charts[0];
      if (!pick) return;
      state.chart = { region: pick.region, date: pick.date, oldShare: pick.tenths.old / (pick.tenths.old + pick.tenths.firstYear), icePolygons: pick.icePolygons, polygonsWithOldIce: pick.polygonsWithOldIce };
      find('[data-chart]').textContent = chartLine();
    }).catch(() => {
      if (!active) return;
      state.chart.note = 'Chart mix unavailable; decks are dealt evenly.';
      find('[data-chart]').textContent = chartLine();
    });

    function levelStats(calls) {
      const correct = calls.filter(c => c.correct).length;
      const meanMs = calls.length ? calls.reduce((s, c) => s + c.ms, 0) / calls.length : 0;
      const points = calls.reduce((s, c) => s + c.points, 0);
      return { correct, meanMs, points };
    }

    function passed(calls) {
      const { correct, meanMs } = levelStats(calls);
      return correct >= PASS_CORRECT && meanMs <= platform().passMeanMs;
    }

    function prerender(next) {
      if (!next) { bufferedCue = null; return; }
      bufferedCue = renderScene(buffer, platform().id, next.iceClass, next.seed, next.difficulty).cue;
    }

    function showCard() {
      const p = platform();
      const c = card();
      if (!bufferedCue) prerender(c);
      c.cue = bufferedCue;
      ctx.drawImage(buffer, 0, 0);
      canvas.setAttribute('aria-label', `${p.name} scene ${state.index + 1} of ${DECK}`);
      bufferedCue = null;
      state.phase = 'play';
      overlay.hidden = true;
      overlay.replaceChildren();
      shownAt = performance.now();
      timerBar.style.width = '100%';
      timerBar.parentElement.setAttribute('aria-valuenow', p.budgetMs);
      render();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
      status.textContent = `Scene ${state.index + 1} of ${DECK}. ${p.budgetMs / 1000} s on the clock.`;
    }

    function tick(now) {
      if (!active || state.phase !== 'play') return;
      const left = platform().budgetMs - (now - shownAt);
      timerBar.style.width = `${clamp(left / platform().budgetMs, 0, 1) * 100}%`;
      timerBar.parentElement.classList.toggle('cl-late', left < platform().budgetMs * 0.3);
      if (left <= 0) { answer(null); return; }
      frame = requestAnimationFrame(tick);
    }

    function answer(choice) {
      if (!active || state.phase !== 'play') return;
      cancelAnimationFrame(frame);
      const p = platform();
      const c = card();
      const ms = choice ? Math.min(performance.now() - shownAt, p.budgetMs) : p.budgetMs;
      const correct = choice === c.iceClass;
      const points = correct ? 5 + Math.round(5 * clamp(1 - ms / p.budgetMs, 0, 1)) : 0;
      state.calls.push({ choice, iceClass: c.iceClass, correct, ms, points });
      state.phase = 'feedback';
      feedbackAt = performance.now();
      timerBar.style.width = choice ? timerBar.style.width : '0%';
      const verdict = document.createElement('div');
      verdict.className = `cl-verdict ${correct ? 'cl-right' : 'cl-wrong'}`;
      verdict.innerHTML = `<b>${correct ? `${CLASSES[c.iceClass].label} ✓` : choice ? `${CLASSES[c.iceClass].label}, not ${CLASSES[choice].label.toLowerCase()}` : `Out of time: ${CLASSES[c.iceClass].label.toLowerCase()}`}</b>
        <span>${c.cue}.</span><em>${correct ? `+${points} · ${seconds(ms)}` : choice ? seconds(ms) : ''}</em>`;
      overlay.replaceChildren(verdict);
      overlay.hidden = false;
      status.textContent = `${verdict.querySelector('b').textContent}. ${c.cue}.`;
      render();
      prerender(state.deck[state.index + 1]);
      clearTimeout(timer);
      timer = setTimeout(advance, FEEDBACK_MS);
    }

    function advance() {
      if (!active || state.phase !== 'feedback') return;
      clearTimeout(timer);
      state.index += 1;
      if (state.index < state.deck.length) showCard();
      else summarise();
    }

    function summarise() {
      const p = platform();
      const stats = levelStats(state.calls);
      const ok = passed(state.calls);
      state.attempts[state.level] += 1;
      state.phase = ok ? 'passed' : 'failed';
      if (ok) {
        const bonus = 10 * p.level;
        state.banked += stats.points + bonus;
        state.cleared.push(state.level);
        state.history.push({ platform: p.name, correct: stats.correct, meanMs: Math.round(stats.meanMs), points: stats.points + bonus, attempts: state.attempts[state.level] });
      }
      const last = state.level === PLATFORMS.length - 1;
      const card = document.createElement('div');
      card.className = `cl-summary ${ok ? 'cl-right' : 'cl-wrong'}`;
      card.innerHTML = `<p class="cl-kicker">${p.kicker}</p><b>${ok ? `${p.name} cleared` : `${p.name} not yet`}</b>
        <dl><div><dt>Correct</dt><dd>${stats.correct} / ${DECK}</dd></div><div><dt>Mean call</dt><dd>${seconds(stats.meanMs)}</dd></div><div><dt>Limit</dt><dd>${seconds(p.passMeanMs)}</dd></div><div><dt>Points</dt><dd>${ok ? `${stats.points} + ${10 * p.level}` : `${stats.points}, not banked`}</dd></div></dl>
        <span>${ok
          ? last ? `Four platforms, one observer. ${state.banked} points ready to log.` : `Next: ${PLATFORMS[state.level + 1].name}. ${PLATFORMS[state.level + 1].sensor}.`
          : stats.correct < PASS_CORRECT ? `Need ${PASS_CORRECT} of ${DECK}. Read the field guide, then deal again.` : `Accurate but slow: bring the mean under ${seconds(p.passMeanMs)}.`}</span>`;
      overlay.replaceChildren(card);
      overlay.hidden = false;
      status.textContent = ok ? `${p.name} cleared: ${stats.correct} of ${DECK} in ${seconds(stats.meanMs)} mean. ${last ? 'Log results to bank the run.' : 'Space for the next platform.'}` : `${p.name} not cleared: ${stats.correct} of ${DECK}, ${seconds(stats.meanMs)} mean. Space or R to retry.`;
      render();
      primary.focus();
    }

    function intro() {
      const p = platform();
      state.phase = 'intro';
      state.calls = [];
      state.index = 0;
      state.deck = makeDeck(rng, state.chart.oldShare);
      prerender(state.deck[0]);
      // The first scene stays in the buffer until the clock starts.
      ctx.fillStyle = '#1b3540';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const brief = document.createElement('div');
      brief.className = 'cl-brief';
      brief.innerHTML = `<p class="cl-kicker">LEVEL ${p.level} · ${p.kicker}</p><b>${p.name}</b><span>${p.sensor}.</span>
        <span>${DECK} scenes, ${p.budgetMs / 1000} s each. Clear it with ${PASS_CORRECT} right and a mean call under ${seconds(p.passMeanMs)}.</span>`;
      overlay.replaceChildren(brief);
      overlay.hidden = false;
      timerBar.style.width = '100%';
      render();
    }

    function proceed() {
      if (!active) return;
      if (state.phase === 'intro') { showCard(); return; }
      if (state.phase === 'feedback') { advance(); return; }
      if (state.phase === 'failed') { intro(); return; }
      if (state.phase === 'passed') {
        if (state.level < PLATFORMS.length - 1) { state.level += 1; intro(); } else log();
      }
    }

    function log() {
      if (!active || state.logged || (state.phase !== 'passed' && state.phase !== 'failed')) return;
      if (!state.cleared.length) { status.textContent = 'Nothing banked yet: clear a platform first, or close to leave without logging.'; return; }
      state.logged = true;
      state.phase = 'done';
      const calls = state.history;
      const correct = calls.reduce((s, l) => s + l.correct, 0);
      const meanMs = Math.round(calls.reduce((s, l) => s + l.meanMs, 0) / calls.length);
      const detail = {
        title: `Cliceify: ${calls.length} of ${PLATFORMS.length} platforms cleared`,
        platformsCleared: calls.map(l => l.platform),
        scenes: calls.length * DECK,
        correct,
        accuracy: Math.round(correct / (calls.length * DECK) * 100),
        meanMs,
        levels: calls,
        chart: state.chart.date ? { region: state.chart.region, date: state.chart.date, oldShare: Math.round(state.chart.oldShare * 100) } : null,
      };
      const note = document.createElement('div');
      note.className = 'cl-summary cl-right';
      note.innerHTML = `<p class="cl-kicker">LOGGED</p><b>${state.banked} points</b><span>${detail.title}. ${detail.accuracy}% correct, ${seconds(meanMs)} mean call.</span>`;
      overlay.replaceChildren(note);
      overlay.hidden = false;
      status.textContent = `Logged ${state.banked} points: ${detail.title.toLowerCase()}.`;
      render();
      complete(state.banked, detail);
    }

    function render() {
      const p = platform();
      find('[data-score]').textContent = state.banked;
      find('[data-frame]').textContent = state.phase === 'play' || state.phase === 'feedback' ? `Scene ${state.index + 1} / ${DECK}` : `Level ${p.level}`;
      find('[data-sensor]').textContent = `${p.name} · ${p.budgetMs / 1000} s`;
      find('[data-guide-platform]').textContent = p.name;
      find('[data-guide-fy]').innerHTML = p.cues.firstYear.map(c => `<li>${c}</li>`).join('');
      find('[data-guide-old]').innerHTML = p.cues.old.map(c => `<li>${c}</li>`).join('');
      find('[data-chart]').textContent = chartLine();
      view.querySelectorAll('[data-level]').forEach((item, i) => {
        item.classList.toggle('cl-current', i === state.level && !state.logged);
        item.classList.toggle('cl-cleared', state.cleared.includes(i));
        item.setAttribute('aria-current', i === state.level ? 'step' : 'false');
      });
      const playing = state.phase === 'play';
      answerButtons.forEach(button => { button.disabled = !playing; });
      view.classList.toggle('cl-playing', playing);
      primary.hidden = state.phase === 'play' || state.phase === 'done';
      primary.innerHTML = {
        intro: `Start level ${p.level} <kbd>Space</kbd>`,
        feedback: 'Next scene <kbd>Space</kbd>',
        failed: 'Deal again <kbd>R</kbd>',
        passed: state.level < PLATFORMS.length - 1 ? `Level ${p.level + 1}: ${PLATFORMS[state.level + 1].name} <kbd>Space</kbd>` : 'Log results <kbd>Enter</kbd>',
      }[state.phase] ?? '';
      logButton.hidden = !(state.phase === 'passed' || state.phase === 'failed') || state.logged;
      logButton.disabled = !state.cleared.length;
      logButton.innerHTML = `Log ${state.banked} points <kbd>Enter</kbd>`;
      find('[data-log-count]').textContent = `(${state.history.length})`;
      find('[data-log-body]').innerHTML = state.history.map(l => `<tr><th scope="row">${l.platform}</th><td>${l.correct} / ${DECK}</td><td>${seconds(l.meanMs)}</td><td>${l.points}</td></tr>`).join('');
    }

    answerButtons.forEach(button => button.addEventListener('click', () => answer(button.dataset.answer), { signal: events.signal }));
    primary.addEventListener('click', proceed, { signal: events.signal });
    logButton.addEventListener('click', log, { signal: events.signal });
    overlay.addEventListener('click', () => { if (state.phase === 'feedback') advance(); }, { signal: events.signal });
    window.addEventListener('keydown', event => {
      if (!active || !view.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const choice = { f: 'firstYear', arrowleft: 'firstYear', m: 'old', arrowright: 'old' }[key];
      const control = key === ' ' || key === 'enter' || key === 'r';
      if (!choice && !control) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (choice) {
        if (state.phase === 'play') answer(choice);
        // An answer key just after the verdict is a stray repeat, not a request to move on.
        else if (state.phase === 'feedback' && performance.now() - feedbackAt > 350) advance();
        return;
      }
      if (key === 'r') { if (state.phase === 'failed') intro(); return; }
      if (key === 'enter' && (state.phase === 'passed' || state.phase === 'failed') && state.cleared.length) { log(); return; }
      proceed();
    }, { capture: true, signal: events.signal });

    intro();
    return () => {
      active = false;
      events.abort();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  },
};
