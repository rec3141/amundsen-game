import { targets, segments, findLayer, scoreBottle, advance } from './ctd-layers.js';

const channels = ['Temperature', 'Salinity', 'Oxygen', 'Fluorescence', 'Sigma-t'];
const colors = ['#ffb36d', '#73d8ef', '#a9adff', '#8cdd90', '#f2d477'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const ctd = {
  title: 'Catch a layer',
  mount(root, { complete }) {
    const abort = new AbortController();
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./ctd.css', import.meta.url).href;
    root.append(css);
    const game = document.createElement('section'); game.className = 'ctd-game'; root.append(game);
    game.innerHTML = `<header><span class="ctd-kicker">ROSETTE / FIELD NOTEBOOK</span><h2>Catch a layer</h2><p>Read the water on the way down. Close three bottles on the way up.</p></header>
      <div class="ctd-setup"><label>Cast <select class="ctd-cast" aria-label="Cast"></select></label><label>Hunt for <select class="ctd-target" aria-label="Target layer">${Object.entries(targets).map(([key, t]) => `<option value="${key}">${t.label}</option>`).join('')}</select></label></div>
      <p class="ctd-rule"></p><div class="ctd-telemetry"><strong class="ctd-depth">0 dbar</strong><span class="ctd-phase">Loading notebook…</span><span class="ctd-bottles">3 bottles</span></div>
      <div class="ctd-chart"><svg viewBox="0 0 1040 440" role="img" aria-label="CTD profiles; pressure increases downward"></svg></div>
      <div class="ctd-controls"><button class="ctd-action" disabled>Lower rosette</button><button class="ctd-fire" disabled>Fire bottle · Space</button><button class="ctd-pause" disabled>Pause</button><label><input class="ctd-slow" type="checkbox"> Slow winch</label><button class="ctd-retry" disabled>Restart cast</button></div>
      <p class="ctd-status" role="status" aria-live="polite">Loading local profiles…</p><div class="ctd-result"></div><p class="ctd-source"></p>`;
    const $ = s => game.querySelector(s);
    const castSelect = $('.ctd-cast'), targetSelect = $('.ctd-target');
    let manifest, entry, profile, layer, maximum = 1, plots = [], state = { phase: 'loading', pressure: 0, paused: false };
    let bottles = [], awarded = false, disposed = false, frame, previous = 0, loadVersion = 0;
    const status = text => { $('.ctd-status').textContent = text; };
    async function json(url) {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(`Profile request failed (${response.status})`);
      return response.json();
    }
    function controls() {
      const moving = ['down', 'up'].includes(state.phase);
      castSelect.disabled = targetSelect.disabled = moving || state.phase === 'bottom' || state.phase === 'loading';
      $('.ctd-action').disabled = !['ready', 'bottom'].includes(state.phase) || !layer;
      $('.ctd-action').textContent = state.phase === 'bottom' ? 'Begin ascent' : 'Lower rosette';
      $('.ctd-fire').disabled = state.phase !== 'up';
      $('.ctd-pause').disabled = !moving;
      $('.ctd-pause').textContent = state.paused ? 'Resume' : 'Pause';
      $('.ctd-retry').disabled = !profile || state.phase === 'loading';
      $('.ctd-phase').textContent = ({ loading: 'Loading', ready: 'On deck', down: 'Downcast · recording', bottom: 'At depth · study the chart', up: 'Upcast · sampling', done: 'Bottles on deck' })[state.phase] + (state.paused ? ' · paused' : '');
      $('.ctd-bottles').textContent = `${3 - bottles.length} bottles left`;
    }
    function chart() {
      $('.ctd-depth').textContent = `${state.pressure.toFixed(1)} dbar`;
      const revealed = state.phase === 'ready' ? 0 : state.phase === 'down' ? state.pressure : maximum;
      const y = p => 70 + p / maximum * 325;
      let svg = `<text x="5" y="40" fill="#afc7d5" font-size="12">dbar ↓</text>`;
      for (let i = 0; i <= 5; i++) {
        const p = maximum * i / 5;
        svg += `<path d="M48 ${y(p)}H1030" stroke="#294352"/><text x="4" y="${y(p) + 4}" fill="#afc7d5" font-size="12">${Math.round(p)}</text>`;
      }
      plots.forEach((plot, index) => {
        const left = 60 + index * 195, width = 172;
        svg += `<text x="${left}" y="20" fill="${colors[index]}" font-size="14">${escape(channels[index])}</text><text x="${left}" y="38" fill="#afc7d5" font-size="11">${escape(profile.units?.[channels[index]])}</text>`;
        if (!plot.groups.length) { svg += `<text x="${left}" y="60" fill="#afc7d5" font-size="11">No measurements</text>`; return; }
        svg += `<text x="${left}" y="57" fill="#afc7d5" font-size="11">${plot.min.toFixed(2)}</text><text x="${left + width}" y="57" text-anchor="end" fill="#afc7d5" font-size="11">${plot.max.toFixed(2)}</text>`;
        for (const group of plot.groups) {
          const points = group.filter(q => q.p <= revealed);
          const d = points.map((q, i) => `${i ? 'L' : 'M'}${left + (q.value - plot.min) / (plot.max - plot.min || 1) * width},${y(q.p)}`).join(' ');
          svg += `<path d="${d}" fill="none" stroke="${colors[index]}" stroke-width="1.8"/>`;
        }
      });
      if (state.phase === 'done' && layer) for (const p of layer.pressures) svg += `<path d="M48 ${y(p)}H1030" stroke="#a5efaa" stroke-width="2" stroke-dasharray="6 5"/>`;
      for (const [i, b] of bottles.entries()) svg += `<circle cx="${1010 - i * 15}" cy="${y(b.pressure)}" r="5" fill="#fff"/>`;
      svg += `<path d="M48 ${y(state.pressure)}H1030" stroke="#fff" opacity=".55"/><text x="60" y="427" fill="#afc7d5" font-size="12">${state.phase === 'done' ? 'Green dashed: target layer. White dots: bottles.' : 'Independent channel scales · gaps remain gaps · white line: rosette'}</text>`;
      $('svg').innerHTML = svg;
    }
    function reset() {
      if (!profile) return;
      bottles = []; state = { phase: 'ready', pressure: 0, paused: false };
      layer = findLayer(profile, targetSelect.value);
      $('.ctd-rule').textContent = targets[targetSelect.value].rule;
      $('.ctd-result').textContent = '';
      status(layer ? 'Lower the rosette to reveal the profile. At depth, take your time before beginning ascent.' : 'This cast has insufficient or uninformative data for this target. Choose another target or cast.');
      controls(); chart();
    }
    async function loadCast() {
      const version = ++loadVersion;
      profile = null; layer = null;
      state = { phase: 'loading', pressure: 0, paused: false }; controls();
      entry = manifest.casts.find(c => c.id === castSelect.value);
      try {
        const next = await json(new URL(`../data/ctd/${entry.file}`, import.meta.url));
        if (disposed || version !== loadVersion) return;
        profile = next;
        maximum = Math.max(...profile.p.filter(Number.isFinite));
        plots = channels.map(channel => {
          const groups = segments(profile, channel), values = groups.flat().map(q => q.value);
          return { groups, min: Math.min(...values), max: Math.max(...values) };
        });
        $('.ctd-source').textContent = `${profile.id} · ${profile.station || 'Unlabelled station'} · ${profile.time || 'Time unavailable'} · ${maximum} dbar. Underway archive.`;
        reset();
      } catch (error) { if (!disposed && version === loadVersion) { state.phase = 'ready'; layer = null; controls(); status(`${error.message}. Select a cast to retry.`); } }
    }
    function finish() {
      if (state.phase === 'done' && $('.ctd-result').textContent) return;
      state.phase = 'done'; state.paused = false;
      const catches = bottles.map(b => scoreBottle(b.pressure, layer));
      const best = catches.reduce((a, b) => b.points > a.points ? b : a, { points: 0, pressure: null });
      $('.ctd-result').innerHTML = `<h3>${best.points}/100 · ${escape(targets[layer.key].label)}</h3><p>Target ${layer.p.toFixed(1)} dbar${layer.pressures.length > 1 ? ' (equal extrema also accepted)' : ''}. ${escape(layer.description)}</p><p>${catches.length ? catches.map((b, i) => `Bottle ${i + 1}: ${b.pressure.toFixed(1)} dbar · error ${b.error.toFixed(1)} dbar · ${b.points} points`).join('<br>') : 'No bottles closed.'}</p><p>Best bottle scores: 100 at the layer, falling to 0 at 20 dbar error. ${awarded ? 'Practice run · score already recorded for this launch.' : 'Cast recorded. Further retries are practice.'}</p>`;
      status('Layer revealed. Compare your bottles with the profile, or try another cast.'); controls(); chart();
      if (!awarded) {
        awarded = true;
        complete(best.points, { title: `${targets[layer.key].label} · ${profile.station || profile.cast}`, castId: profile.id, target: layer.key, pressure: best.pressure,
          source: entry.source, targetPressure: layer.p, bottles: catches });
      }
    }
    function fire() {
      if (state.phase !== 'up' || bottles.length >= 3) return;
      bottles.push({ pressure: state.pressure });
      status(`Bottle ${bottles.length} closed at ${state.pressure.toFixed(1)} dbar.`);
      if (bottles.length === 3) finish(); else { controls(); chart(); }
    }
    $('.ctd-action').onclick = () => {
      if (state.phase === 'ready' && layer) state.phase = 'down';
      else if (state.phase === 'bottom') state.phase = 'up';
      status(state.phase === 'down' ? 'Watch the curves emerge. The target pressure stays in the notebook until recovery.' : 'Find your layer in the curves. Space closes a bottle; pause or slow the winch to refine your catch.'); controls();
    };
    $('.ctd-fire').onclick = fire;
    $('.ctd-pause').onclick = () => { state.paused = !state.paused; controls(); };
    $('.ctd-retry').onclick = reset;
    castSelect.onchange = loadCast; targetSelect.onchange = reset;
    function keydown(event) {
      if (event.code !== 'Space' || event.repeat || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
      if (state.phase === 'up') { event.preventDefault(); event.stopPropagation(); fire(); }
    }
    document.addEventListener('keydown', keydown);
    let lastDraw = 0;
    function tick(time) {
      if (disposed) return;
      const dt = previous ? Math.min((time - previous) / 1000, .1) : 0; previous = time;
      const oldPhase = state.phase;
      state = advance(state, dt, maximum, maximum / 35 * ($('.ctd-slow').checked ? .2 : 1));
      if (state.phase !== oldPhase) {
        if (state.phase === 'done') finish();
        else { status('Downcast complete. Study all five curves, then begin ascent when ready.'); controls(); chart(); }
      }
      if (profile && time - lastDraw > 65 && ['down', 'up'].includes(state.phase)) { chart(); lastDraw = time; }
      if (!disposed) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    (async () => {
      try {
        manifest = await json(new URL('../data/ctd/index.json', import.meta.url));
        if (disposed) return;
        if (!manifest.casts?.length) throw new Error('No local casts available');
        castSelect.innerHTML = manifest.casts.map(c => `<option value="${escape(c.id)}">${escape(c.id)} · ${escape(c.station || 'unlabelled')}</option>`).join('');
        castSelect.selectedIndex = Math.floor(Math.random() * manifest.casts.length);
        await loadCast();
      } catch (error) { if (!disposed) status(`${error.message}. Close and reopen the CTD notebook to retry.`); }
    })();
    return () => { disposed = true; abort.abort(); cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); game.remove(); css.remove(); };
  },
};
