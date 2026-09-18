import { createSession, push, beginPull, haul, abandon, nextCore, finish, canFinish, drivesLeft, coreSegments, abandonPenalty, cueText, points, maxDepthCm, DRIVES, PROFILE, MIN_CORE_CM, ABANDON_BASE, ABANDON_PER_CM } from './crew-8-model.js';

const stylesheet = new URL('./crew-8.css', import.meta.url).href;
const GAUGE_KG = 200;
const MUD = '#4a4a3a';

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const game = {
  title: 'The Raft',
  mount(root, { complete, expedition }) {
    // The same chart position finds the same basin; the drive sites and the raft are new every launch.
    const spot = Number.isFinite(expedition?.x) && Number.isFinite(expedition?.y) ? `lake:${Math.round(expedition.x)}:${Math.round(expedition.y)}` : `lake:${Date.now()}`;
    const state = createSession({ lakeSeed: expedition?.seed ?? spot, raftSeed: `raft:${Date.now()}:${Math.random()}` });
    const sceneCm = maxDepthCm(state) + 40;
    const bedY = 150;
    const scale = 270 / sceneCm;
    const cmToPx = cm => bedY + cm * scale;
    const columnPx = cm => cm / sceneCm * 200;
    const events = new AbortController();
    const dialog = root.closest('dialog');
    let active = true;
    let frame = 0;
    let hauling = false;
    let lastTick = 0;
    let sinceCue = 0;
    let strokes = 0;

    root.innerHTML = `
      <section class="raft-game" aria-label="Lake sediment coring from a raft">
        <link rel="stylesheet" href="${stylesheet}">
        <div class="raft-heading"><div><p class="raft-kicker">FIELD NOTEBOOK / LAKE CORING</p>
          <h3>Core the lake bed from the raft.</h3></div><div class="raft-score"><strong data-score>0</strong><span>points aboard</span></div></div>
        <p class="raft-instructions">Hammer the piston corer's tube down with <kbd>D</kbd>. You cannot see what the cutter is in: each drive lands a few metres from the last, on the same layers at different depths, and only a core that comes up gets split and logged. Every centimetre logged scores, the older the mud the more, and each layer in the core pays a bonus; anything under ${MIN_CORE_CM / 100} m is a wasted tube. Hold <kbd>P</kbd> to wind the tripod winch; the line ratchets tighter until the tube lets go. Leave a stuck core with <kbd>X</kbd> for a penalty, or keep winding and trust the raft. Cores ride on the deck until you paddle in, and this raft has never been load-tested.</p>
        <div class="raft-layout">
          <div class="raft-station">
            <div class="raft-location"><strong data-core-title></strong><span data-drives></span></div>
            <div class="raft-section" aria-hidden="true">
              <svg class="raft-scene" viewBox="0 0 300 420" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="raft-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb3c3"/><stop offset="1" stop-color="#245b70"/></linearGradient>
                  <pattern id="raft-unlogged" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" fill="${MUD}"/><path d="M0 4 H8" stroke="#3d3d30" stroke-width="2"/></pattern>
                </defs>
                <rect class="raft-sky" x="0" y="0" width="300" height="70"/>
                <rect class="raft-lake" x="0" y="68" width="300" height="${bedY - 68}" fill="url(#raft-water)"/>
                <rect class="raft-bed" x="0" y="${bedY}" width="300" height="${420 - bedY}" fill="url(#raft-unlogged)"/>
                <text class="raft-bed-label" x="292" y="${bedY + 14}" text-anchor="end">unlogged</text>
                <g class="raft-ruler">${Array.from({ length: Math.floor((sceneCm - 20) / 50) + 1 }, (_, i) => `<path d="M8 ${cmToPx(i * 50)} h8"/><text x="20" y="${cmToPx(i * 50) + 4}">${i * 50}</text>`).join('')}</g>
                <path class="raft-metre" d="M60 ${cmToPx(MIN_CORE_CM)} H292"/><text class="raft-metre-label" x="292" y="${cmToPx(MIN_CORE_CM) - 3}" text-anchor="end">1 m</text>
                <g class="raft-reference" data-reference></g>
                <rect class="raft-hole" data-hole x="143" y="${bedY}" width="14" height="0"/>
                <line class="raft-line raft-off" data-line x1="150" y1="22" x2="150" y2="94"/>
                <g class="raft-corer" data-corer transform="translate(150 ${bedY})">
                  <rect class="raft-tube" x="-6" y="-600" width="12" height="602" rx="1"/>
                  <rect data-core-fill x="-5" y="0" width="10" height="0" fill="${MUD}"/>
                  <path class="raft-cutter" d="M-7 2 h14 l-3 5 h-8 z"/>
                </g>
                <g class="raft-platform" data-raft transform="translate(150 84)">
                  <rect class="raft-pontoon" x="-70" y="-6" width="52" height="16" rx="8"/>
                  <rect class="raft-pontoon" x="18" y="-6" width="52" height="16" rx="8"/>
                  <rect class="raft-deck" x="-78" y="-10" width="156" height="7" rx="1"/>
                  <rect class="raft-crate raft-off" data-crate="1" x="-66" y="-22" width="30" height="12" rx="1"/>
                  <rect class="raft-crate raft-off" data-crate="2" x="-36" y="-22" width="30" height="12" rx="1"/>
                  <rect class="raft-crate raft-off" data-crate="3" x="36" y="-22" width="30" height="12" rx="1"/>
                  <g class="raft-tripod" data-tripod><path d="M-24 -10 L0 -62 L24 -10 M0 -62 L6 -10"/><circle cx="0" cy="-62" r="4"/><rect class="raft-winch" x="8" y="-44" width="14" height="10" rx="2"/></g>
                  <g class="raft-person"><circle cx="-14" cy="-38" r="5"/><path d="M-14 -33 v14 M-14 -28 l10 -6 M-14 -28 l-8 8 M-14 -19 l-6 9 M-14 -19 l6 9"/></g>
                  <rect class="raft-wash raft-off" data-wash x="-78" y="-12" width="156" height="9"/>
                </g>
                <text class="raft-splash raft-off" data-splash x="150" y="60" text-anchor="middle">CRACK</text>
              </svg>
              <div class="raft-depth" data-depth>0 cm</div>
              <div class="raft-layer" data-layer></div>
            </div>
            <div class="raft-readouts"><span data-estimate></span><span data-tension></span></div>
            <div class="raft-gauge" role="meter" aria-label="Line tension, kilograms" aria-valuemin="0" aria-valuemax="${GAUGE_KG}" aria-valuenow="0">
              <div class="raft-gauge-fill" data-fill></div>
              <div class="raft-gauge-marks" data-marks></div>
              <div class="raft-gauge-safe" data-safe title="Highest tension the raft has taken"></div>
              <div class="raft-gauge-ticks">${[50, 100, 150].map(kg => `<span style="left:${kg / GAUGE_KG * 100}%">${kg}</span>`).join('')}</div>
            </div>
            <div class="raft-actions">
              <button type="button" class="raft-push" data-push>Drive <kbd>D</kbd></button>
              <button type="button" class="raft-pull" data-pull>Pull · hold <kbd>P</kbd></button>
            </div>
            <div class="raft-secondary" role="group" aria-label="Core handling">
              <button type="button" data-abandon>Leave core <kbd>X</kbd></button>
              <button type="button" data-next>Next core <kbd>N</kbd></button>
            </div>
          </div>
          <div class="raft-notebook">
            <div class="raft-chart-heading"><h4>Cores on deck</h4><span data-count></span></div>
            <svg class="raft-columns" viewBox="0 0 300 262" role="img" aria-label="Recovered cores drawn as stratigraphic columns. Details are listed below.">
              <text x="10" y="14">Depth below lake bed (cm)</text>
              <g class="raft-column-ruler">${Array.from({ length: Math.floor((sceneCm - 20) / 100) + 1 }, (_, i) => `<path d="M40 ${30 + columnPx(i * 100)} H290"/><text x="34" y="${34 + columnPx(i * 100)}" text-anchor="end">${i * 100}</text>`).join('')}</g>
              <g data-columns></g>
            </svg>
            <p class="raft-columns-empty" data-columns-empty>Nothing logged yet. The first core you land shows what the layers are doing here.</p>
            <table class="raft-log"><caption>Drive log</caption><thead><tr><th scope="col">Core</th><th scope="col">Length</th><th scope="col">Let go at</th><th scope="col">Points</th></tr></thead><tbody data-log></tbody></table>
            <div class="raft-notes"><h4>Raft</h4><p data-raft-note>Two pontoons, a plywood deck and a tripod. Nobody knows what it holds.</p><ul data-cues></ul></div>
            <p class="raft-reward">${PROFILE.filter(layer => layer.rate).map(layer => `${layer.name.toLowerCase()} ${layer.rate}/cm`).join(' · ')} · ${PROFILE.filter(layer => layer.bonus).map(layer => `+${layer.bonus} for ${layer.name.toLowerCase()}`).join(' · ')} · under ${MIN_CORE_CM} cm scores nothing · leaving a tube costs ${ABANDON_BASE} + ${ABANDON_PER_CM}/cm</p>
          </div>
        </div>
        <div class="raft-footer"><p role="status" aria-live="polite" data-status>Core 1. Hammer the tube into the lake bed.</p><button type="button" class="raft-finish" data-finish disabled>Paddle in <kbd>F</kbd></button></div>
      </section>`;

    const view = root.querySelector('.raft-game');
    const find = selector => view.querySelector(selector);
    const pushButton = find('[data-push]');
    const pullButton = find('[data-pull]');
    const abandonButton = find('[data-abandon]');
    const nextButton = find('[data-next]');
    const finishButton = find('[data-finish]');
    const status = find('[data-status]');
    const section = find('.raft-section');
    const cueList = find('[data-cues]');
    const recovered = () => state.cores.filter(core => core.outcome === 'recovered');

    function say(text) {
      status.textContent = text;
    }

    function note(text) {
      const item = document.createElement('li');
      item.textContent = text;
      cueList.append(item);
    }

    // The split core, read off top down: "gyttja 0–118, isolation contact 118–127, marine clay 127–212 cm".
    function describe(core) {
      return coreSegments(core).map(segment => `${segment.layer.name.toLowerCase()} ${segment.top}–${segment.bottom}`).join(', ') + ' cm';
    }

    function renderScene() {
      const core = state.core;
      const depth = core.depthCm;
      const isRecovered = core.phase === 'recovered';
      find('[data-hole]').setAttribute('height', cmToPx(depth) - bedY);
      // The tube's cutter sits at the drive depth; a recovered core is on deck, an abandoned one stays in the mud with a slack line.
      find('[data-corer]').setAttribute('transform', `translate(150 ${cmToPx(depth)})`);
      find('[data-corer]').classList.toggle('raft-off', isRecovered);
      find('[data-line]').classList.toggle('raft-off', core.phase !== 'pull');
      const fill = find('[data-core-fill]');
      fill.setAttribute('y', -depth * scale);
      fill.setAttribute('height', depth * scale);
      // Logged cores stand beside the hole at scene scale, so the cutter can be read against what the last sites held.
      find('[data-reference]').innerHTML = recovered().slice(-2).map((logged, i, all) => {
        const x = 62 + (i + 2 - all.length) * 22;
        return `<text x="${x + 6}" y="${bedY - 4}" text-anchor="middle">${logged.index}</text>` + coreSegments(logged).map(segment =>
          `<rect x="${x}" y="${cmToPx(segment.top)}" width="12" height="${Math.max(1, (segment.bottom - segment.top) * scale)}" fill="${segment.layer.colour}"/>`).join('');
      }).join('');
      const tension = core.tensionKg;
      const raft = find('[data-raft]');
      if (state.broken) raft.setAttribute('transform', 'translate(150 96) rotate(-34)');
      else raft.setAttribute('transform', `translate(150 ${84 + tension / 14}) rotate(${-tension / 16})`);
      find('[data-wash]').classList.toggle('raft-off', tension < 70);
      find('[data-splash]').classList.toggle('raft-off', !state.broken);
      section.classList.toggle('raft-broken', state.broken);
      section.classList.toggle('raft-recovered', isRecovered);
      [1, 2, 3].forEach(n => find(`[data-crate="${n}"]`).classList.toggle('raft-off', recovered().length < n));
      find('[data-depth]').textContent = `${depth} cm`;
      find('[data-layer]').textContent = core.stopped === 'till' ? 'Refusal: the cutter is on something the hammer cannot move'
        : core.stopped === 'dropstone' ? 'Stopped dead on a stone'
        : isRecovered ? `Split on deck: ${describe(core)}`
        : core.phase === 'lost' ? 'Left in the lake bed, unlogged'
        : core.lastStrokeCm === null ? 'Cutter resting on the lake bed'
        : `Last blow drove ${core.lastStrokeCm} cm${depth < MIN_CORE_CM ? ` · ${MIN_CORE_CM - depth} cm short of a metre` : ''}`;
    }

    function renderGauge() {
      const core = state.core;
      const gauge = find('.raft-gauge');
      const tension = core.tensionKg;
      find('[data-fill]').style.width = `${Math.min(100, tension / GAUGE_KG * 100)}%`;
      find('[data-fill]').classList.toggle('raft-shifted', core.shifted && core.phase === 'pull');
      // Where earlier tubes let go: the only calibration for a grip nobody can see.
      find('[data-marks]').innerHTML = recovered().map(logged => `<span style="left:${Math.min(100, logged.peakKg / GAUGE_KG * 100)}%" data-n="${logged.index}" title="Core ${logged.index}, ${logged.depthCm} cm, let go at ${Math.round(logged.peakKg)} kg"></span>`).join('');
      const safe = find('[data-safe]');
      safe.hidden = state.knownSafeKg === 0;
      safe.style.left = `${Math.min(100, state.knownSafeKg / GAUGE_KG * 100)}%`;
      gauge.setAttribute('aria-valuenow', Math.round(tension));
      gauge.setAttribute('aria-valuetext', `${Math.round(tension)} kilograms of line tension${recovered().length ? `; earlier cores let go at ${recovered().map(logged => `${Math.round(logged.peakKg)} kilograms for ${logged.depthCm} centimetres`).join(', ')}` : ''}`);
      const last = recovered()[recovered().length - 1];
      find('[data-estimate]').textContent = last ? `Last core: ${last.depthCm} cm let go at ${Math.round(last.peakKg)} kg` : 'Pull needed: no core logged yet';
      find('[data-tension]').textContent = `Line ${Math.round(tension)} kg${state.knownSafeKg ? ` · raft has held ${Math.round(state.knownSafeKg)}` : ''}`;
    }

    function renderNotebook() {
      const landed = recovered();
      find('[data-count]').textContent = `${landed.length} recovered · ${state.cores.length - landed.length} left in the lake`;
      find('[data-columns-empty]').hidden = state.cores.length > 0;
      find('[data-columns]').innerHTML = state.cores.map((core, i) => {
        const x = 60 + i * 80;
        const foot = 30 + columnPx(core.depthCm);
        const label = `<text x="${x + 14}" y="${foot + 14}" text-anchor="middle">${core.depthCm} cm</text>`;
        if (core.outcome !== 'recovered') return `<rect class="raft-column-lost" x="${x}" y="30" width="28" height="${columnPx(core.depthCm)}"/>${label}<text x="${x + 14}" y="${foot + 27}" text-anchor="middle">left · ${core.points}</text>`;
        return coreSegments(core).map(segment => `<rect x="${x}" y="${30 + columnPx(segment.top)}" width="28" height="${Math.max(1, columnPx(segment.bottom - segment.top))}" fill="${segment.layer.colour}"><title>${escape(segment.layer.name)} ${segment.top}–${segment.bottom} cm</title></rect>`).join('')
          + label + `<text x="${x + 14}" y="${foot + 27}" text-anchor="middle">${Math.round(core.peakKg)} kg · +${core.points}</text>`;
      }).join('');
      find('[data-log]').innerHTML = state.cores.map((core, i) => `<tr><th scope="row">${i + 1}</th><td>${core.depthCm} cm</td><td>${core.outcome === 'recovered' ? `${Math.round(core.peakKg)} kg` : `held to ${Math.round(core.peakKg)} kg`}</td><td>${core.outcome === 'recovered' ? `+${core.points}` : core.points}</td></tr>`).join('');
      find('[data-raft-note]').textContent = state.broken
        ? `Broke up at ${state.limitKg} kg. The cores, the corer and the crates are on the lake bed.`
        : state.knownSafeKg ? `Has taken ${Math.round(state.knownSafeKg)} kg so far. Every hard pull works the deck screws looser.` : 'Two pontoons, a plywood deck and a tripod. Nobody knows what it holds.';
    }

    function render() {
      const core = state.core;
      const phase = core.phase;
      find('[data-score]').textContent = points(state);
      find('[data-core-title]').textContent = `Core ${core.index} / ${DRIVES}`;
      find('[data-drives]').textContent = state.finished ? (state.broken ? 'Raft gone' : 'Paddled in') : `${drivesLeft(state)} drive${drivesLeft(state) === 1 ? '' : 's'} left`;
      renderScene();
      renderGauge();
      renderNotebook();
      pushButton.disabled = state.finished || phase !== 'drive' || Boolean(core.stopped);
      pushButton.innerHTML = core.stopped === 'till' ? 'Refusal' : core.stopped === 'dropstone' ? 'Stone' : `Drive <kbd>D</kbd>${core.depthCm ? ` <small>${core.depthCm} cm${core.depthCm < MIN_CORE_CM ? ' · under 1 m' : ''}</small>` : ''}`;
      pullButton.disabled = state.finished || (phase !== 'drive' && phase !== 'pull') || core.depthCm === 0;
      pullButton.classList.toggle('raft-winding', hauling);
      abandonButton.disabled = state.finished || phase !== 'pull';
      abandonButton.innerHTML = `Leave core <kbd>X</kbd>${phase === 'pull' ? ` <small>−${abandonPenalty(core)}</small>` : ''}`;
      nextButton.disabled = state.finished || (phase !== 'recovered' && phase !== 'lost') || drivesLeft(state) <= 0;
      finishButton.disabled = !canFinish(state);
      finishButton.innerHTML = state.finished ? (state.broken ? 'Game over' : 'Ashore ✓') : `Paddle in <kbd>F</kbd>${state.cores.length ? ` · ${points(state)} pts` : ''}`;
    }

    function drive() {
      if (!active) return;
      const result = push(state);
      if (!result) return;
      strokes += 1;
      view.classList.toggle('raft-stroke-a', strokes % 2 === 1);
      view.classList.toggle('raft-stroke-b', strokes % 2 === 0);
      if (result.stopped === 'till') say(`Refusal at ${result.depthCm} cm. The hammer rings and nothing moves. Whatever is in the tube comes up now or not at all.`);
      else if (result.stopped === 'dropstone') say(`Clunk. Something hard at ${result.depthCm} cm and the rods will not go past it. The drive stops here.`);
      else if (result.depthCm < MIN_CORE_CM) say(`${result.strokeCm} cm with that blow, ${result.depthCm} cm in the tube. Short of a metre it is not worth logging.`);
      else say(`${result.strokeCm} cm with that blow, ${result.depthCm} cm in the tube. What it holds shows on deck.`);
      render();
    }

    function handle(event) {
      const core = state.core;
      if (event === 'break') {
        stopHauling();
        say(`${Math.round(core.tensionKg)} kg. The deck folds, the tripod goes over and everything on it follows the corer down. Game over.`);
        note(`Broke at ${Math.round(core.tensionKg)} kg on core ${core.index}.`);
        render();
        const result = finish(state);
        if (result) complete(result.points, result.detail);
        return;
      }
      if (event === 'pop') {
        stopHauling();
        const landed = state.cores[state.cores.length - 1];
        const bonuses = landed.bonuses.length ? ` (${landed.bonuses.map(bonus => `+${bonus.points} ${bonus.name.toLowerCase()}`).join(', ')})` : '';
        say(landed.points
          ? `The tube lets go at ${Math.round(landed.peakKg)} kg. ${landed.depthCm} cm split on deck: ${describe(landed)}${bonuses}. +${landed.points} points.${drivesLeft(state) ? '' : ' That was the last drive: paddle in.'}`
          : `The tube lets go at ${Math.round(landed.peakKg)} kg. ${landed.depthCm} cm of ${describe(landed)}: under a metre, it goes in the log and nowhere else.${drivesLeft(state) ? '' : ' That was the last drive: paddle in.'}`);
        note(`Held ${Math.round(landed.peakKg)} kg on core ${core.index}.`);
        render();
        if (document.activeElement === pullButton) (drivesLeft(state) ? nextButton : finishButton).focus();
        return;
      }
      if (event === 'shift') {
        say(`${Math.round(core.tensionKg)} kg. The tube shifts a centimetre; it is nearly free.`);
        return;
      }
      sinceCue = 0;
      say(`${Math.round(core.tensionKg)} kg. ${cueText(state, event)}`);
      note(`${cueText(state, event)} (${Math.round(core.tensionKg)} kg, core ${core.index})`);
      section.classList.remove('raft-cue');
      void section.offsetWidth;
      section.classList.add('raft-cue');
    }

    function tick(now) {
      frame = 0;
      if (!active || !hauling) return;
      const dt = Math.min(0.1, (now - lastTick) / 1000 || 0);
      lastTick = now;
      const raised = haul(state, dt);
      sinceCue += dt;
      if (raised.length) raised.forEach(handle);
      else {
        render();
        if (sinceCue > 1.5 && state.core.phase === 'pull') {
          sinceCue = 0;
          say(`Winding. Line at ${Math.round(state.core.tensionKg)} kg.`);
        }
      }
      if (hauling && state.core.phase === 'pull') frame = requestAnimationFrame(tick);
    }

    function startHauling() {
      if (!active || hauling || state.finished) return;
      if (state.core.phase === 'drive') {
        if (!beginPull(state)) return;
        say(`Line tight. Cutter is ${state.core.depthCm} cm down; the winch winds on while you hold.`);
      }
      if (state.core.phase !== 'pull') return;
      hauling = true;
      lastTick = performance.now();
      sinceCue = 0;
      render();
      frame = requestAnimationFrame(tick);
    }

    function stopHauling() {
      if (!hauling) return;
      hauling = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (state.core.phase === 'pull') say(`Pawl holding at ${Math.round(state.core.tensionKg)} kg. Wind on, or leave the core (X).`);
      render();
    }

    function leave() {
      if (!active) return;
      stopHauling();
      const penalty = abandon(state);
      if (penalty === null) return;
      say(`Line slack. The tube stays in the lake bed with ${state.core.depthCm} cm in it, unlogged: −${penalty} points.${drivesLeft(state) ? ' Rig a fresh tube for the next core, or paddle in.' : ' No tubes left: paddle in.'}`);
      render();
    }

    function advance() {
      if (!active || !nextCore(state)) return;
      say(`Core ${state.core.index}. A few metres along, fresh tube on the lake bed. Hammer it down.`);
      render();
      if (document.activeElement === nextButton) pushButton.focus();
    }

    function paddleIn() {
      if (!active) return;
      stopHauling();
      const result = finish(state);
      if (!result) return;
      render();
      const landed = result.detail.cores.filter(core => core.outcome === 'recovered').length;
      say(`Ashore with ${landed} core${landed === 1 ? '' : 's'} · ${result.points} points.`);
      complete(result.points, result.detail);
    }

    pushButton.addEventListener('click', drive, { signal: events.signal });
    pullButton.addEventListener('pointerdown', event => {
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      pullButton.focus();
      startHauling();
    }, { signal: events.signal });
    ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(type => pullButton.addEventListener(type, stopHauling, { signal: events.signal }));
    abandonButton.addEventListener('click', leave, { signal: events.signal });
    nextButton.addEventListener('click', advance, { signal: events.signal });
    finishButton.addEventListener('click', paddleIn, { signal: events.signal });
    window.addEventListener('pointerup', stopHauling, { signal: events.signal });
    window.addEventListener('blur', stopHauling, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopHauling(); }, { signal: events.signal });

    const keyActions = { d: drive, x: leave, n: advance, f: paddleIn };
    window.addEventListener('keydown', event => {
      if (!active || !view.isConnected || (dialog && !dialog.open) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      const pullKey = key === 'p' || key === 'space';
      if (!pullKey && !keyActions[key]) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pullKey) {
        if (!event.repeat) startHauling();
        return;
      }
      if (event.repeat) return;
      keyActions[key]();
    }, { capture: true, signal: events.signal });
    window.addEventListener('keyup', event => {
      if (!active) return;
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      if (key === 'p' || key === 'space') stopHauling();
    }, { capture: true, signal: events.signal });

    render();
    return () => {
      active = false;
      hauling = false;
      if (frame) cancelAnimationFrame(frame);
      events.abort();
    };
  },
};
