import { targets, segments, findLayers, bottleCount, reach, scoreCast, advance } from './ctd-layers.js';

const channels = ['Temperature', 'Salinity', 'Oxygen', 'Fluorescence', 'Sigma-t'];
const colors = ['#ffb36d', '#73d8ef', '#a9adff', '#8cdd90', '#f2d477'];
// Seconds for the rosette to travel the full depth of any cast, in either direction.
const TRAVEL_SECONDS = 13;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shuffled = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const ctd = {
  title: 'Catch the layers',
  mount(root, { complete }) {
    const abort = new AbortController();
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./ctd.css', import.meta.url).href;
    root.append(css);
    const game = document.createElement('section'); game.className = 'ctd-game'; root.append(game);
    game.innerHTML = `<header><span class="ctd-kicker">ROSETTE / FIELD NOTEBOOK</span><h2>Catch the layers</h2><p>Read the water on the way down. On the way up the winch does not stop: close a bottle in as many layers as you can.</p></header>
      <ol class="ctd-layers" aria-label="Layers to sample"></ol>
      <div class="ctd-telemetry"><strong class="ctd-depth">0 dbar</strong><span class="ctd-phase">Loading notebook…</span><span class="ctd-bottles"></span></div>
      <div class="ctd-chart"><svg viewBox="0 0 1040 440" role="img" aria-label="CTD profiles; pressure increases downward"></svg></div>
      <div class="ctd-controls"><button class="ctd-action" disabled>Lower rosette · Enter</button><button class="ctd-fire" disabled>Fire bottle · Space</button></div>
      <p class="ctd-status" role="status" aria-live="polite">Loading local profiles…</p><div class="ctd-result"></div><p class="ctd-source"></p>`;
    const $ = s => game.querySelector(s);
    let manifest, entry, profile, layers = [], capacity = 0, limit = 20, maximum = 1, plots = [], state = { phase: 'loading', pressure: 0 };
    let bottles = [], review = null, awarded = false, disposed = false, frame, previous = 0, loadVersion = 0;
    const status = text => { $('.ctd-status').textContent = text; };
    const y = p => 70 + p / maximum * 325;
    async function json(url) {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(`Profile request failed (${response.status})`);
      return response.json();
    }
    function controls() {
      const action = $('.ctd-action');
      action.disabled = !['ready', 'bottom', 'done'].includes(state.phase);
      action.textContent = ({ bottom: 'Begin ascent · Enter', done: 'New cast · Enter' })[state.phase] || 'Lower rosette · Enter';
      $('.ctd-fire').disabled = state.phase !== 'up';
      $('.ctd-phase').textContent = ({ loading: 'Loading', ready: 'On deck', down: 'Downcast · recording', bottom: 'At depth · study the chart', up: 'Upcast · sampling', done: 'Bottles on deck' })[state.phase];
      $('.ctd-bottles').textContent = capacity ? `${capacity - bottles.length} of ${capacity} bottles left` : '';
    }
    // Layer pressures appear only in the review, after the rosette is back on deck.
    function notebook() {
      $('.ctd-layers').innerHTML = layers.map(layer => {
        const result = review?.layers.find(r => r.key === layer.key);
        const outcome = !result ? '' : result.points
          ? `<span class="ctd-outcome ctd-caught">Caught · ${result.points} · bottle ${result.pressure.toFixed(1)} dbar · layer ${layer.p.toFixed(1)} dbar</span>`
          : `<span class="ctd-outcome ctd-missed">Missed · layer ${layer.p.toFixed(1)} dbar</span>`;
        return `<li style="--ctd-layer:${colors[channels.indexOf(layer.channel)]}"><strong>${escape(targets[layer.key].label)}</strong><span>${escape(targets[layer.key].rule)}</span>${outcome}</li>`;
      }).join('');
    }
    // The curves are drawn whole and unveiled through a clip rectangle, so moving the
    // rosette only touches a few attributes.
    function chart() {
      let svg = `<defs><clipPath id="ctd-reveal"><rect class="ctd-reveal-rect" x="0" y="0" width="1040" height="0"/></clipPath></defs><text x="5" y="40" fill="#afc7d5" font-size="12">dbar ↓</text>`;
      for (let i = 0; i <= 5; i++) {
        const p = maximum * i / 5;
        svg += `<path d="M48 ${y(p)}H1030" stroke="#294352"/><text x="4" y="${y(p) + 4}" fill="#afc7d5" font-size="12">${Math.round(p)}</text>`;
      }
      plots.forEach((plot, index) => {
        const left = 60 + index * 195, width = 172;
        svg += `<text x="${left}" y="20" fill="${colors[index]}" font-size="14">${escape(channels[index])}</text><text x="${left}" y="38" fill="#afc7d5" font-size="11">${escape(profile.units?.[channels[index]])}</text>`;
        if (!plot.groups.length) { svg += `<text x="${left}" y="60" fill="#afc7d5" font-size="11">No measurements</text>`; return; }
        svg += `<text x="${left}" y="57" fill="#afc7d5" font-size="11">${plot.min.toFixed(2)}</text><text x="${left + width}" y="57" text-anchor="end" fill="#afc7d5" font-size="11">${plot.max.toFixed(2)}</text><g clip-path="url(#ctd-reveal)">`;
        for (const group of plot.groups) {
          const d = group.map((q, i) => `${i ? 'L' : 'M'}${(left + (q.value - plot.min) / (plot.max - plot.min || 1) * width).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
          svg += `<path d="${d}" fill="none" stroke="${colors[index]}" stroke-width="1.8"/>`;
        }
        svg += '</g>';
      });
      if (review) for (const layer of layers) {
        const index = channels.indexOf(layer.channel), left = 60 + index * 195;
        for (const p of layer.pressures) svg += `<path d="M${left - 8} ${y(p)}h188" stroke="${colors[index]}" stroke-width="2" stroke-dasharray="6 5"/>`;
        svg += `<text x="${left + 176}" y="${Math.max(82, y(layer.p) - 5)}" text-anchor="end" fill="${colors[index]}" font-size="11">${escape(targets[layer.key].label)}</text>`;
      }
      for (const [i, b] of bottles.entries()) svg += `<circle cx="${1024 - i * 13}" cy="${y(b)}" r="5" fill="#fff"/>`;
      svg += `<path class="ctd-rosette" d="M48 0H1030" stroke="#fff" opacity=".55"/><text x="60" y="427" fill="#afc7d5" font-size="12">${review ? 'Dashed: layers, in their channel colour. White dots: bottles.' : 'Independent channel scales · gaps remain gaps · white line: rosette'}</text>`;
      $('svg').innerHTML = svg;
      move();
    }
    function move() {
      $('.ctd-depth').textContent = `${state.pressure.toFixed(1)} dbar`;
      const revealed = state.phase === 'ready' ? 0 : state.phase === 'down' ? state.pressure : maximum;
      $('.ctd-reveal-rect')?.setAttribute('height', String(y(revealed) + 1));
      $('.ctd-rosette')?.setAttribute('transform', `translate(0 ${y(state.pressure)})`);
    }
    // A cast is playable when it supports at least two layers; others are passed over.
    async function drawCast() {
      const version = ++loadVersion, last = entry;
      profile = null; layers = []; bottles = []; review = null; capacity = 0;
      state = { phase: 'loading', pressure: 0 }; controls();
      $('.ctd-result').textContent = ''; $('.ctd-source').textContent = ''; $('.ctd-layers').innerHTML = ''; $('svg').innerHTML = '';
      status('Rigging the rosette…');
      const order = shuffled(manifest.casts.filter(c => c !== last));
      if (last) order.push(last);
      let failure = null;
      for (const candidate of order) {
        let next;
        try { next = await json(new URL(`../data/ctd/${candidate.file}`, import.meta.url)); }
        catch (error) { if (disposed || version !== loadVersion) return; failure = error; continue; }
        if (disposed || version !== loadVersion) return;
        const found = findLayers(next);
        if (found.length < 2) continue;
        entry = candidate; profile = next; layers = found;
        maximum = Math.max(...profile.p.filter(Number.isFinite));
        capacity = bottleCount(layers.length); limit = reach(maximum);
        plots = channels.map(channel => {
          const groups = segments(profile, channel), values = groups.flat().map(q => q.value);
          return { groups, min: Math.min(...values), max: Math.max(...values) };
        });
        state = { phase: 'ready', pressure: 0 };
        status(`${layers.length} layers in the notebook, ${capacity} bottles on the rosette. Lower away; the winch holds at depth until you begin the ascent.`);
        notebook(); controls(); chart();
        return;
      }
      status(`${failure ? failure.message : 'No local cast offers two layers'}. Close and reopen the CTD notebook to retry.`);
    }
    function finish() {
      if (review) return;
      state = { ...state, phase: 'done' };
      review = scoreCast(bottles, layers, limit);
      const caught = review.layers.filter(r => r.points).length;
      $('.ctd-result').innerHTML = `<h3>${review.points} points · ${caught} of ${layers.length} layers caught</h3><p>${review.bottles.length ? review.bottles.map((b, i) => `Bottle ${i + 1}: ${b.pressure.toFixed(1)} dbar · ${b.key ? `${escape(targets[b.key].label)} · error ${b.error.toFixed(1)} dbar · ${b.points}` : 'open water'}`).join('<br>') : 'No bottles closed.'}</p><p>A bottle counts toward the nearest layer it reaches: 100 at the layer, 0 at ${limit.toFixed(0)} dbar error. Each layer keeps its best bottle. ${awarded ? 'Practice cast.' : 'Cast recorded; further casts are practice.'}</p>`;
      $('.ctd-source').textContent = `${profile.id} · ${profile.station || 'Unlabelled station'} · ${profile.time || 'Time unavailable'} · ${maximum} dbar. Underway archive.`;
      status('Layers revealed. Compare your bottles with the profile, or draw a new cast.');
      notebook(); controls(); chart();
      if (!awarded) {
        awarded = true;
        const round = v => v == null ? null : Math.round(v * 10) / 10;
        complete(review.points, { title: `${caught}/${layers.length} layers · ${profile.station || profile.cast}`, castId: profile.id, source: entry.source, caught, reach: round(limit),
          layers: layers.map((layer, i) => ({ key: layer.key, pressure: round(layer.p), bottle: round(review.layers[i].pressure), points: review.layers[i].points })),
          bottles: review.bottles.map(b => ({ pressure: round(b.pressure), key: b.key, error: round(b.error), points: b.points })) });
      }
    }
    function fire() {
      if (state.phase !== 'up' || bottles.length >= capacity) return;
      bottles.push(state.pressure);
      status(`Bottle ${bottles.length} closed at ${state.pressure.toFixed(1)} dbar.`);
      if (bottles.length === capacity) finish(); else { controls(); chart(); }
    }
    function act() {
      if (state.phase === 'ready') { state = { ...state, phase: 'down' }; status('Watch the curves emerge. Layer pressures stay hidden until recovery.'); }
      else if (state.phase === 'bottom') { state = { ...state, phase: 'up' }; status('Hauling. Space closes a bottle; the winch does not stop.'); }
      else if (state.phase === 'done') { drawCast(); return; }
      else return;
      controls(); move();
    }
    $('.ctd-action').onclick = act;
    $('.ctd-fire').onclick = fire;
    // Space and Enter belong to the rosette, so a focused rosette button never receives a
    // second, native activation from the same key press. Controls outside the notebook,
    // such as the dialog's close button, keep their own keys.
    function key(event) {
      if (!['Space', 'Enter', 'NumpadEnter'].includes(event.code)) return;
      const control = event.target?.closest?.('input,select,textarea,button,a');
      if (control && !game.contains(control)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type !== 'keydown' || event.repeat) return;
      if (event.code === 'Space') fire(); else act();
    }
    document.addEventListener('keydown', key);
    document.addEventListener('keyup', key);
    function tick(time) {
      if (disposed) return;
      const dt = previous ? Math.min((time - previous) / 1000, .1) : 0; previous = time;
      const before = state;
      state = advance(state, dt, maximum, maximum / TRAVEL_SECONDS);
      if (state.phase !== before.phase) {
        if (state.phase === 'done') finish();
        else { status('Downcast complete. Study all five curves, then begin the ascent when ready.'); controls(); move(); }
      } else if (state !== before) move();
      if (!disposed) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    (async () => {
      try {
        manifest = await json(new URL('../data/ctd/index.json', import.meta.url));
        if (disposed) return;
        if (!manifest.casts?.length) throw new Error('No local casts available');
        await drawCast();
      } catch (error) { if (!disposed) status(`${error.message}. Close and reopen the CTD notebook to retry.`); }
    })();
    return () => { disposed = true; abort.abort(); cancelAnimationFrame(frame); document.removeEventListener('keydown', key); document.removeEventListener('keyup', key); game.remove(); css.remove(); };
  },
};
