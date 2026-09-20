import { createRun, step, resume, result, dripState, SURFACES, KIT, THRESHOLD, PLAYER_R, WALL_H, DECKHAND_R } from './crew-6-maze.js';
import { t } from '../i18n-text.js';

const stylesheet = new URL('./crew-6.css', import.meta.url).href;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const game = {
  get title() { return t('crew6.title'); },
  mount(root, { complete }) {
    const state = createRun(`${Date.now()}:${Math.random()}`);
    const events = new AbortController();
    const { signal } = events;
    let active = true, frame = 0, previous = 0, awarded = false;
    const held = new Set();
    const nudges = new Map();
    root.innerHTML = `
      <section class="tm-game" aria-label="Contaminants: trace-metal clean sampling">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="tm-heading"><div><p class="tm-kicker">TRACE-METAL ROSETTE / FOREDECK</p><h3>Everyone is dirty.</h3></div>
          <div class="tm-clock"><strong data-clock>0:00</strong><span>elapsed</span></div></div>
        <p class="tm-instructions">Five pieces of clean suit are scattered through the container maze. Find them all, then get back to the rosette without touching anything: the ship is iron, zinc and copper from the keel up.</p>
        <div class="tm-layout">
          <div class="tm-board">
            <canvas class="tm-canvas" role="img" aria-label="Container maze on the foredeck"></canvas>
            <div class="tm-banner" data-banner hidden></div>
            <div class="tm-tia" data-tia hidden>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <path class="tm-hood" d="M18 118 C14 60 30 22 60 22 C90 22 106 60 102 118 Z"/>
                <ellipse class="tm-face" cx="60" cy="66" rx="30" ry="36"/>
                <path class="tm-brow" d="M38 48 l16 8 M82 48 l-16 8"/>
                <circle class="tm-eye" cx="47" cy="62" r="3.5"/><circle class="tm-eye" cx="73" cy="62" r="3.5"/>
                <ellipse class="tm-mouth" cx="60" cy="84" rx="11" ry="13"/>
                <path class="tm-glove" d="M6 118 C4 96 12 84 24 90 C30 94 30 106 26 118 Z"/><path class="tm-glove" d="M114 118 C116 96 108 84 96 90 C90 94 90 106 94 118 Z"/>
              </svg>
              <div class="tm-bubble"><p class="tm-shout">DON'T TOUCH IT — YOU'RE DIRTY!</p><p class="tm-who">Tia, from the clean bubble</p><p data-tia-detail></p>
                <button type="button" data-retry>Change gloves and try again <kbd>Enter</kbd></button></div>
            </div>
            <div class="tm-done" data-done hidden></div>
          </div>
          <div class="tm-panel">
            <h4>Clean suit</h4>
            <ul class="tm-kit">${KIT.map(item => `<li data-kit="${item.id}"><span class="tm-tick"></span>${escape(item.label)}</li>`).join('')}</ul>
            <h4>Dirty meter</h4>
            <div class="tm-meter" role="meter" aria-label="Dirty meter" aria-valuemin="0" aria-valuemax="${THRESHOLD}" aria-valuenow="0"><div></div><i style="left:100%"></i></div>
            <p class="tm-meter-note" data-meter-note>Suit up first — the float coat can touch what it likes.</p>
            <ul class="tm-touches" data-touches></ul>
            <details class="tm-legend"><summary>What is on the walls</summary>
              <ul>${['steel', 'rust', 'paint', 'grease', 'anode'].map(key => `<li><i style="background:${SURFACES[key].color}"></i>${escape(SURFACES[key].label)} <span>${escape(SURFACES[key].element)} · +${SURFACES[key].dirt}</span></li>`).join('')}
                <li><i class="tm-legend-hand"></i>${escape(SURFACES.deckhand.label)} <span>+${SURFACES.deckhand.dirt}</span></li>
                <li><i class="tm-legend-drip"></i>${escape(SURFACES.drip.label)} <span>${escape(SURFACES.drip.element)} · +${SURFACES.drip.dirt}</span></li></ul>
              <p>Brushing along a surface keeps adding. Tia calls it at ${THRESHOLD}.</p></details>
          </div>
        </div>
        <div class="tm-controls">
          <div class="tm-pad" role="group" aria-label="Move the sampler">
            <button type="button" data-dir="up" aria-label="Up (arrow up or W)">▲</button>
            <button type="button" data-dir="left" aria-label="Left (arrow left or A)">◀</button>
            <button type="button" data-dir="down" aria-label="Down (arrow down or S)">▼</button>
            <button type="button" data-dir="right" aria-label="Right (arrow right or D)">▶</button>
          </div>
          <div class="tm-footer"><p role="status" aria-live="polite" data-status>Arrows or WASD to move. Hold a pad button or tap it for a short step.</p>
            <p class="tm-reward">Up to 100 for a clean arrival · +40 for speed · +20 for a blank-grade run with no touch at all</p></div>
        </div>
      </section>`;
    const section = root.querySelector('.tm-game');
    const find = selector => section.querySelector(selector);
    const canvas = find('.tm-canvas');
    const ctx = canvas.getContext('2d');
    const status = find('[data-status]');
    const banner = find('[data-banner]');
    const tia = find('[data-tia]');
    const done = find('[data-done]');
    const retry = find('[data-retry]');
    const dialog = root.closest('dialog');
    const pad = [...section.querySelectorAll('[data-dir]')];
    let bannerTimer = 0, touchList = '';
    const surfaceLabel = surface => t(`crew6.surface.${surface.key || Object.keys(SURFACES).find(key => SURFACES[key] === surface)}`);
    const kitLabel = item => t(`crew6.kit.${item.id}`);

    function localize() {
      section.lang = globalThis.UWI18n?.locale || 'en';
      section.setAttribute('aria-label', t('crew6.aria.game'));
      find('.tm-kicker').textContent = t('crew6.kicker');
      find('.tm-heading h3').textContent = t('crew6.heading');
      find('.tm-clock span').textContent = t('crew6.elapsed');
      find('.tm-instructions').textContent = t('crew6.instructions');
      canvas.setAttribute('aria-label', t('crew6.aria.canvas'));
      find('.tm-shout').textContent = t('crew6.tia.shout');
      find('.tm-who').textContent = t('crew6.tia.who');
      retry.childNodes[0].textContent = t('crew6.retry') + ' ';
      const headings = section.querySelectorAll('.tm-panel > h4');
      headings[0].textContent = t('crew6.cleanSuit'); headings[1].textContent = t('crew6.dirtyMeter');
      for (const item of state.items) find(`[data-kit="${item.id}"]`).lastChild.textContent = kitLabel(item);
      find('.tm-meter').setAttribute('aria-label', t('crew6.aria.meter'));
      find('.tm-legend summary').textContent = t('crew6.legend.heading');
      const legend = find('.tm-legend ul').children;
      [...['steel', 'rust', 'paint', 'grease', 'anode'], 'deckhand', 'drip'].forEach((key, i) => {
        const textNode = [...legend[i].childNodes].find(node => node.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = t(`crew6.surface.${key}`) + ' ';
      });
      find('.tm-legend p').textContent = t('crew6.legend.brushing', { threshold: THRESHOLD });
      find('.tm-pad').setAttribute('aria-label', t('crew6.aria.move'));
      const directions = ['up', 'left', 'down', 'right'];
      [...find('.tm-pad').children].forEach((button, i) => button.setAttribute('aria-label', t(`crew6.aria.${directions[i]}`)));
      find('.tm-reward').textContent = t('crew6.reward');
      if (state.phase === 'search') status.textContent = t('crew6.status.start');
      renderPanel(); draw();
    }

    function say(text) { status.textContent = text; }
    function flash(text, ms = 1400) {
      banner.textContent = text;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    }

    function renderPanel() {
      for (const item of state.items) find(`[data-kit="${item.id}"]`).classList.toggle('tm-found', item.found);
      const meter = find('.tm-meter');
      meter.setAttribute('aria-valuenow', Math.round(state.dirty));
      meter.setAttribute('aria-valuetext', t('crew6.meter.value', { dirty: Math.round(state.dirty), threshold: THRESHOLD }));
      meter.firstElementChild.style.width = `${state.dirty / THRESHOLD * 100}%`;
      meter.classList.toggle('tm-hot', state.dirty >= THRESHOLD * 0.7);
      section.classList.toggle('tm-suited', state.phase !== 'search');
      find('[data-meter-note]').textContent = state.phase === 'search'
        ? t('crew6.meter.unsuited')
        : t(state.fails ? 'crew6.meter.dirtyChanges' : 'crew6.meter.dirty', { dirty: Math.round(state.dirty), threshold: THRESHOLD, count: state.fails });
      const rows = state.touches.map(touch => `<li><span>${escape(surfaceLabel(touch))}</span><em>${escape(touch.element)}</em><b>+${touch.dirt}</b></li>`);
      if (state.rubDirt >= 1) rows.push(`<li><span>${escape(t('crew6.brushing'))}</span><em></em><b>+${Math.round(state.rubDirt)}</b></li>`);
      const list = rows.join('');
      if (list !== touchList) { touchList = list; find('[data-touches]').innerHTML = list; }
      find('[data-clock]').textContent = clock(state.searchSeconds + state.returnSeconds);
    }

    // Canvas draws in cell units through a scaled transform; text is drawn at device pixels.
    const PAD = 0.3; // cells of margin around the maze, room for the rosette label
    let scale = 1, dpr = 1;
    function fit() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      dpr = Math.min(devicePixelRatio || 1, 2);
      scale = rect.width / (state.cols + PAD * 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round((state.rows + PAD * 2) * scale * dpr);
      canvas.style.height = `${canvas.height / dpr}px`;
    }
    function text(str, x, y, size, color, weight = 600) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${weight} ${Math.max(9, size * scale)}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(str, (x + PAD) * scale, (y + PAD) * scale);
      ctx.restore();
    }
    function circle(x, y, r, fill, stroke, width = 0.03) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
    }
    function drawItem(item) {
      const x = item.x + 0.5, y = item.y + 0.5;
      ctx.save();
      ctx.shadowColor = '#fff8';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#f5f7f2';
      ctx.strokeStyle = '#6b8390';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.roundRect(x - 0.3, y - 0.3, 0.6, 0.6, 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#e8ecef';
      ctx.strokeStyle = '#4a5f6a';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      if (item.id === 'coverall') { ctx.moveTo(x - 0.17, y - 0.2); ctx.lineTo(x + 0.17, y - 0.2); ctx.lineTo(x + 0.22, y - 0.02); ctx.lineTo(x + 0.12, y - 0.02); ctx.lineTo(x + 0.14, y + 0.22); ctx.lineTo(x - 0.14, y + 0.22); ctx.lineTo(x - 0.12, y - 0.02); ctx.lineTo(x - 0.22, y - 0.02); ctx.closePath(); }
      else if (item.id === 'hood') { ctx.arc(x, y + 0.02, 0.2, Math.PI, 0); ctx.lineTo(x + 0.2, y + 0.18); ctx.lineTo(x - 0.2, y + 0.18); ctx.closePath(); }
      else if (item.id === 'booties') { ctx.fillStyle = '#7fb3d5'; ctx.ellipse(x - 0.1, y + 0.04, 0.09, 0.2, 0.2, 0, Math.PI * 2); ctx.moveTo(x + 0.19, y + 0.04); ctx.ellipse(x + 0.1, y + 0.04, 0.09, 0.2, -0.2, 0, Math.PI * 2); }
      else {
        ctx.fillStyle = item.id === 'inner' ? '#5b6fd1' : '#d8e6f2';
        ctx.roundRect(x - 0.13, y - 0.05, 0.26, 0.26, 0.05);
        for (let i = 0; i < 4; i++) ctx.roundRect(x - 0.13 + i * 0.07, y - 0.22, 0.05, 0.2, 0.02);
        ctx.roundRect(x + 0.1, y - 0.02, 0.11, 0.05, 0.02);
      }
      ctx.fill();
      ctx.stroke();
    }
    function drawRosette() {
      const [sx, sy] = state.start, x = sx + 0.5, y = sy + 0.5;
      const target = state.phase === 'suited';
      ctx.save();
      ctx.fillStyle = target ? '#bfe9f3aa' : '#bfe9f355';
      ctx.strokeStyle = target ? '#e8fbff' : '#a9d5de';
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.08, 0.06]);
      ctx.beginPath();
      ctx.roundRect(sx + 0.1, sy + 0.1, 0.8, 0.8, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      circle(x, y, 0.28, '#d5dde0', '#7a8c95');
      for (let i = 0; i < 8; i++) circle(x + Math.cos(i / 8 * Math.PI * 2) * 0.2, y + Math.sin(i / 8 * Math.PI * 2) * 0.2, 0.06, '#f4f7f8', '#5c6c74', 0.015);
      circle(x, y, 0.05, '#48606c');
    }
    function drawDrip(drip) {
      const x = drip.x + 0.5, y = drip.y + 0.5, now = dripState(drip, state.elapsed);
      ctx.strokeStyle = SURFACES.grease.color;
      ctx.lineWidth = 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(drip.x + 0.15, drip.y + 0.2);
      ctx.quadraticCurveTo(x, drip.y + 0.4, drip.x + 0.85, drip.y + 0.2);
      ctx.stroke();
      circle(x, drip.y + 0.3, 0.07, '#4b4640');
      if (now.falling) circle(x, drip.y + 0.32 + now.progress * 0.18, 0.05 + now.progress * 0.03, '#2d2a27', '#8d8378', 0.015);
      if (now.splash) {
        ctx.strokeStyle = '#2d2a27';
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        ctx.arc(x, y, 0.32, 0, Math.PI * 2);
        ctx.stroke();
        circle(x, y, 0.16, '#3a3632');
      }
    }
    function drawDeckhand(hand) {
      circle(hand.x, hand.y, DECKHAND_R, '#2f4858', '#1a2a33');
      circle(hand.x + 0.18, hand.y - 0.2, 0.09, '#8a8f93', '#3d4548', 0.02);
      circle(hand.x, hand.y, 0.17, '#e98a2e', '#a35d16', 0.02);
    }
    function drawPlayer() {
      const p = state.player, suited = state.phase !== 'search';
      const dx = Math.cos(p.facing), dy = Math.sin(p.facing);
      circle(p.x, p.y, PLAYER_R, suited ? '#fbfcfa' : '#f08a3c', suited ? '#9db3bd' : '#9b4f18', 0.03);
      circle(p.x - dy * 0.2, p.y + dx * 0.2, 0.08, suited ? '#3d63d6' : '#2b2b2b');
      circle(p.x + dy * 0.2, p.y - dx * 0.2, 0.08, suited ? '#3d63d6' : '#2b2b2b');
      circle(p.x + dx * 0.07, p.y + dy * 0.07, 0.13, suited ? '#e8eef0' : '#c9a37e', suited ? '#9db3bd' : '#6f5137', 0.02);
      if (suited) circle(p.x + dx * 0.1, p.y + dy * 0.1, 0.06, '#7a5a44');
    }
    function draw() {
      const { cols, rows } = state;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, PAD * scale * dpr, PAD * scale * dpr);
      ctx.fillStyle = '#12303a';
      ctx.fillRect(-PAD, -PAD, cols + PAD * 2, rows + PAD * 2);
      ctx.fillStyle = '#3b6b5f';
      ctx.fillRect(0, 0, cols, rows);
      ctx.strokeStyle = '#34604f';
      ctx.lineWidth = 0.02;
      for (let i = 0; i <= cols * 4; i++) { ctx.beginPath(); ctx.moveTo(i / 4, 0); ctx.lineTo(i / 4, rows); ctx.stroke(); }
      drawRosette();
      for (const drip of state.drips) drawDrip(drip);
      for (const item of state.items) if (!item.found && state.seen.has(item.y * cols + item.x)) drawItem(item);
      if (state.deckhand) drawDeckhand(state.deckhand);
      ctx.lineCap = 'round';
      ctx.lineWidth = WALL_H * 2;
      for (const run of state.runs) {
        ctx.strokeStyle = SURFACES[run.surface].color;
        ctx.beginPath();
        ctx.moveTo(run.x1, run.y1);
        ctx.lineTo(run.x2, run.y2);
        ctx.stroke();
        if (run.surface === 'anode') {
          ctx.strokeStyle = '#8e948c';
          ctx.setLineDash([0.12, 0.12]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      drawPlayer();
      ctx.fillStyle = '#0b1e26d9';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!state.seen.has(y * cols + x)) ctx.fillRect(x - 0.05, y - 0.05, 1.1, 1.1);
      // The label sits in the margin above or below the rosette's row, kept clear of the side edges.
      text(t('crew6.rosette'), Math.min(cols - 0.9, Math.max(0.9, state.start[0] + 0.5)), state.start[1] === 0 ? -PAD / 2 : rows + PAD / 2, 0.22, '#e8fbff', 700);
    }

    function input() {
      let dx = 0, dy = 0;
      for (const [dir, [x, y]] of Object.entries(DIRS)) if (held.has(dir) || nudges.has(dir)) { dx += x; dy += y; }
      return { dx, dy };
    }
    function handle(event) {
      if (event.type === 'item') {
        const left = state.items.filter(i => !i.found).length;
        say(t(left ? 'crew6.status.found' : 'crew6.status.foundAll', { item: kitLabel(event.item), count: left }));
        flash(kitLabel(event.item), 900);
      } else if (event.type === 'suited') {
        flash(t('crew6.flash.suited'), 1600);
        say(t('crew6.status.suited', { time: clock(state.searchSeconds) }));
      } else if (event.type === 'touch') {
        say(t('crew6.status.touch', { surface: surfaceLabel(event.surface), dirty: Math.round(state.dirty), threshold: THRESHOLD }));
        section.classList.remove('tm-shake');
        void section.offsetWidth;
        section.classList.add('tm-shake');
      } else if (event.type === 'busted') {
        held.clear();
        nudges.clear();
        find('[data-tia-detail]').textContent = t(state.rubDirt >= 1 ? 'crew6.tia.detailBrushing' : 'crew6.tia.detail', { count: state.touches.length, surfaces: [...new Set(state.touches.map(surfaceLabel))].join(', ') });
        tia.hidden = false;
        say(t('crew6.status.busted', { count: state.touches.length }));
        retry.focus();
      } else if (event.type === 'arrived') {
        finish();
      }
    }
    function finish() {
      const summary = result(state);
      const title = t(summary.blankBonus ? 'crew6.result.blankTitle' : 'crew6.result.title', { cleanliness: summary.cleanliness });
      done.innerHTML = `<p class="tm-kicker">${escape(t('crew6.result.kicker'))}</p><h4>${escape(title)}</h4>
        <ul><li><span>${escape(t('crew6.result.cleanliness'))}</span><b>${summary.cleanliness}</b></li><li><span>${escape(t('crew6.result.speed', {time:clock(summary.seconds)}))}</span><b>+${summary.timeBonus}</b></li>
        ${summary.blankBonus ? `<li><span>${escape(t('crew6.result.noTouch'))}</span><b>+${summary.blankBonus}</b></li>` : ''}${summary.penalty ? `<li><span>${escape(t('crew6.result.changes', {count:state.fails}))}</span><b>−${summary.penalty}</b></li>` : ''}
        <li class="tm-total"><span>${escape(t('crew6.result.points'))}</span><b>${summary.points}</b></li></ul>
        <p>${escape(t(summary.blankBonus ? 'crew6.result.blankNote' : state.touches.length ? 'crew6.result.touchedNote' : 'crew6.result.brushedNote'))}</p>`;
      done.hidden = false;
      banner.hidden = true;
      clearTimeout(bannerTimer);
      say(t('crew6.status.finished', { cleanliness: summary.cleanliness, time: clock(summary.seconds), points: summary.points }));
      if (!awarded) {
        awarded = true;
        complete(summary.points, { ...summary.detail, title });
      }
    }
    function again() {
      if (!active || !resume(state)) return;
      tia.hidden = true;
      flash(t('crew6.flash.fresh'), 1200);
      say(t('crew6.status.fresh'));
      renderPanel();
      canvas.focus?.();
    }

    function loop(now) {
      if (!active) return;
      frame = requestAnimationFrame(loop);
      const dt = previous ? (now - previous) / 1000 : 0;
      previous = now;
      for (const [dir, left] of nudges) { if (left - dt <= 0) nudges.delete(dir); else nudges.set(dir, left - dt); }
      const paused = dialog && !dialog.open;
      const events = paused ? [] : step(state, input(), dt);
      for (const event of events) handle(event);
      renderPanel();
      draw();
    }

    // Holding a pad button moves for as long as it is down; a quick tap (or keyboard activation) gives a short step.
    for (const button of pad) {
      const dir = button.dataset.dir;
      let downAt = 0, heldMs = 0;
      button.addEventListener('pointerdown', event => { event.preventDefault(); downAt = performance.now(); held.add(dir); button.setPointerCapture?.(event.pointerId); }, { signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => { held.delete(dir); if (downAt) heldMs = performance.now() - downAt; downAt = 0; }, { signal });
      button.addEventListener('click', () => { if (heldMs < 220) nudges.set(dir, 0.18); heldMs = 0; }, { signal });
    }
    retry.addEventListener('click', again, { signal });
    window.addEventListener('keydown', event => {
      if (!active || !section.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key.toLowerCase();
      const dir = KEYS[key];
      if (dir) {
        event.preventDefault();
        event.stopImmediatePropagation();
        held.add(dir);
      } else if ((key === 'enter' || key === ' ') && state.phase === 'busted' && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        again();
      }
    }, { capture: true, signal });
    window.addEventListener('keyup', event => {
      const dir = KEYS[event.key.toLowerCase()];
      if (dir) held.delete(dir);
    }, { capture: true, signal });
    window.addEventListener('blur', () => held.clear(), { signal });
    document.addEventListener('visibilitychange', () => { held.clear(); previous = 0; }, { signal });
    const observer = new ResizeObserver(() => { fit(); draw(); });
    observer.observe(canvas);
    globalThis.addEventListener?.('uw:localechange', localize, { signal });
    fit();
    renderPanel();
    localize();
    frame = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      clearTimeout(bannerTimer);
      observer.disconnect();
      events.abort();
    };
  },
};
