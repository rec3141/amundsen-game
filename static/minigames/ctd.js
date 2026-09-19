import { t } from '../i18n-text.js';
import { segments, findLayers, bottleCount, reach, scoreCast, advance } from './ctd-layers.js';

const channels = ['Temperature', 'Salinity', 'Oxygen', 'Fluorescence', 'Sigma-t'];
const colors = ['#ffb36d', '#73d8ef', '#a9adff', '#8cdd90', '#f2d477'];
// Seconds for the rosette to travel the full depth of any cast, in either direction.
const TRAVEL_SECONDS = 13;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shuffled = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const ctd = {
  get title() { return t('ctd.title'); },
  mount(root, { complete }) {
    const abort = new AbortController();
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./ctd.css', import.meta.url).href;
    root.append(css);
    const game = document.createElement('section'); game.className = 'ctd-game'; root.append(game);
    game.innerHTML = `<header><span class="ctd-kicker">${escape(t('ctd.kicker'))}</span><h2>${escape(t('ctd.title'))}</h2><p>${escape(t('ctd.intro'))}</p></header>
      <ol class="ctd-layers" aria-label="${escape(t('ctd.layersAria'))}"></ol>
      <div class="ctd-telemetry"><strong class="ctd-depth">0 dbar</strong><span class="ctd-phase">${escape(t('ctd.phase.loading'))}</span><span class="ctd-bottles"></span></div>
      <div class="ctd-chart"><svg viewBox="0 0 1040 440" role="img" aria-label="${escape(t('ctd.chartAria'))}"></svg></div>
      <div class="ctd-controls"><button class="ctd-action" disabled>${escape(t('ctd.lower'))}</button><button class="ctd-fire" disabled>${escape(t('ctd.fire'))}</button></div>
      <p class="ctd-status" role="status" aria-live="polite">${escape(t('ctd.loading'))}</p><div class="ctd-result"></div><p class="ctd-source"></p>`;
    const $ = s => game.querySelector(s);
    let manifest, entry, profile, layers = [], capacity = 0, limit = 20, maximum = 1, plots = [], state = { phase: 'loading', pressure: 0 };
    let bottles = [], review = null, awarded = false, practice = false, disposed = false, frame, previous = 0, loadVersion = 0;
    let statusKey = 'ctd.loading', statusValues = {};
    const status = (key, values = {}) => { statusKey = key; statusValues = values; $('.ctd-status').textContent = t(key, values); };
    function labels() {
      game.lang = globalThis.UWI18n?.locale || 'en';
      $('.ctd-kicker').textContent = t('ctd.kicker');
      $('h2').textContent = t('ctd.title');
      $('header p').textContent = t('ctd.intro');
      $('.ctd-layers').setAttribute('aria-label', t('ctd.layersAria'));
      $('svg').setAttribute('aria-label', t('ctd.chartAria'));
      $('.ctd-fire').textContent = t('ctd.fire');
    }
    const y = p => 70 + p / maximum * 325;
    async function json(url) {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(t('ctd.requestError', {status: response.status}));
      return response.json();
    }
    function controls() {
      const action = $('.ctd-action');
      action.disabled = !['ready', 'bottom', 'done'].includes(state.phase);
      action.textContent = t(({ bottom: 'ctd.ascend', done: 'ctd.new' })[state.phase] || 'ctd.lower');
      $('.ctd-fire').disabled = state.phase !== 'up';
      $('.ctd-phase').textContent = t('ctd.phase.' + state.phase);
      $('.ctd-bottles').textContent = capacity ? t('ctd.remaining', {remaining: capacity - bottles.length, capacity}) : '';
    }
    // Layer pressures appear only in the review, after the rosette is back on deck.
    function notebook() {
      $('.ctd-layers').innerHTML = layers.map(layer => {
        const result = review?.layers.find(r => r.key === layer.key);
        const outcome = !result ? '' : result.points
          ? `<span class="ctd-outcome ctd-caught">${escape(t('ctd.caught', {points:result.points, bottle:result.pressure.toFixed(1), layer:layer.p.toFixed(1)}))}</span>`
          : `<span class="ctd-outcome ctd-missed">${escape(t('ctd.missed', {layer:layer.p.toFixed(1)}))}</span>`;
        return `<li style="--ctd-layer:${colors[channels.indexOf(layer.channel)]}"><strong>${escape(t('ctd.target.' + layer.key + '.label'))}</strong><span>${escape(t('ctd.target.' + layer.key + '.rule'))}</span>${outcome}</li>`;
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
        svg += `<text x="${left}" y="20" fill="${colors[index]}" font-size="14">${escape(t('ctd.channel.' + channels[index]))}</text><text x="${left}" y="38" fill="#afc7d5" font-size="11">${escape(profile.units?.[channels[index]])}</text>`;
        if (!plot.groups.length) { svg += `<text x="${left}" y="60" fill="#afc7d5" font-size="11">${escape(t('ctd.noMeasurements'))}</text>`; return; }
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
        svg += `<text x="${left + 176}" y="${Math.max(82, y(layer.p) - 5)}" text-anchor="end" fill="${colors[index]}" font-size="11">${escape(t('ctd.target.' + layer.key + '.label'))}</text>`;
      }
      for (const [i, b] of bottles.entries()) svg += `<circle cx="${1024 - i * 13}" cy="${y(b)}" r="5" fill="#fff"/>`;
      svg += `<path class="ctd-rosette" d="M48 0H1030" stroke="#fff" opacity=".55"/><text x="60" y="427" fill="#afc7d5" font-size="12">${escape(t(review ? 'ctd.legendReview' : 'ctd.legend'))}</text>`;
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
      status('ctd.rigging');
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
        status('ctd.ready', {layers: layers.length, capacity});
        notebook(); controls(); chart();
        return;
      }
      status('ctd.retry', {error: failure ? failure.message : t('ctd.noLayers')});
    }

    function renderReview() {
      if (!review) return;
      const caught = review.layers.filter(r => r.points).length;
      const summary = t('ctd.summary', {points: review.points, caught, layers: layers.length});
      const results = review.bottles.length ? review.bottles.map((b, i) => escape(t('ctd.bottle', {
        number: i + 1, pressure: b.pressure.toFixed(1),
        outcome: b.key ? t('ctd.bottleScore', {layer:t('ctd.target.' + b.key + '.label'), error:b.error.toFixed(1), points:b.points}) : t('ctd.openWater')
      }))).join('<br>') : escape(t('ctd.noneClosed'));
      $('.ctd-result').innerHTML = `<h3>${escape(summary)}</h3><p>${results}</p><p>${escape(t('ctd.rules', {limit:limit.toFixed(0)}))} ${escape(t(practice ? 'ctd.practice' : 'ctd.recorded'))}</p>`;
      $('.ctd-source').textContent = t('ctd.source', {id:profile.id, station:profile.station || t('ctd.stationUnknown'), time:profile.time || t('ctd.timeUnknown'), maximum});
    }
    function localize() {
      labels(); controls(); status(statusKey, statusValues);
      if (profile) { notebook(); chart(); renderReview(); }
    }
    function finish() {
      if (review) return;
      state = { ...state, phase: 'done' };
      practice = awarded;
      review = scoreCast(bottles, layers, limit);
      const caught = review.layers.filter(r => r.points).length;
      renderReview();
      status('ctd.revealed');
      notebook(); controls(); chart();
      if (!awarded) {
        awarded = true;
        const round = v => v == null ? null : Math.round(v * 10) / 10;
        complete(review.points, { title: t('ctd.log', {caught, layers:layers.length, station:profile.station || profile.cast}), castId: profile.id, source: entry.source, caught, reach: round(limit),
          layers: layers.map((layer, i) => ({ key: layer.key, pressure: round(layer.p), bottle: round(review.layers[i].pressure), points: review.layers[i].points })),
          bottles: review.bottles.map(b => ({ pressure: round(b.pressure), key: b.key, error: round(b.error), points: b.points })) });
      }
    }
    function fire() {
      if (state.phase !== 'up' || bottles.length >= capacity) return;
      bottles.push(state.pressure);
      status('ctd.closed', {number:bottles.length, pressure:state.pressure.toFixed(1)});
      if (bottles.length === capacity) finish(); else { controls(); chart(); }
    }
    function act() {
      if (state.phase === 'ready') { state = { ...state, phase: 'down' }; status('ctd.descending'); }
      else if (state.phase === 'bottom') { state = { ...state, phase: 'up' }; status('ctd.ascending'); }
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
        else { status('ctd.atDepth'); controls(); move(); }
      } else if (state !== before) move();
      if (!disposed) frame = requestAnimationFrame(tick);
    }
    labels();
    globalThis.addEventListener?.('uw:localechange', localize);
    frame = requestAnimationFrame(tick);
    (async () => {
      try {
        manifest = await json(new URL('../data/ctd/index.json', import.meta.url));
        if (disposed) return;
        if (!manifest.casts?.length) throw new Error(t('ctd.noCasts'));
        await drawCast();
      } catch (error) { if (!disposed) status('ctd.retry', {error:error.message}); }
    })();
    return () => { globalThis.removeEventListener?.('uw:localechange', localize); disposed = true; abort.abort(); cancelAnimationFrame(frame); document.removeEventListener('keydown', key); document.removeEventListener('keyup', key); game.remove(); css.remove(); };
  },
};
