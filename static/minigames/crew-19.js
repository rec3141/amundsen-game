import { createDuel, moveOptions, playTurn, score, tell, MOVES, TYPES, cap } from './crew-19-model.js';
import { text } from '../i18n-text.js';

const stylesheet = new URL('./crew-19.css', import.meta.url).href;
const PACE = { use: 700, hit: 800, miss: 650, blocked: 600, heal: 500, stage: 500, status: 650, tick: 650, weather: 550, tell: 300, end: 900 };
const escape = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export const game = {
  get title() { return text('Rival Researchers'); },
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let state = createDuel(expedition, Date.now());
    let alive = true, submitted = false, cursor = 0, timer = null, frame = null, launches = 0;
    // What the arena and cards show: it trails the model by one event while a turn plays out.
    let shown = snapshotOf(state);
    const fx = { beam: null, shake: null, pops: [] };
    root.innerHTML = `<section class="rr-game" tabindex="-1" aria-label="Rival Researchers">
      <link rel="stylesheet" href="${stylesheet}">
      <div class="rr-heading">
        <div class="rr-title"><p class="rr-kicker">UNDERWAY ENCOUNTER · <span data-where></span></p><h3 data-rival-name></h3><p class="rr-sub" data-rival-sub></p></div>
        <div class="rr-meters">
          <div class="rr-meter"><strong data-turn>0</strong><span>turn</span></div>
          <div class="rr-meter"><strong data-hours>48 h</strong><span>ship time</span></div>
          <div class="rr-meter"><strong data-tier></strong><span>rival</span></div>
        </div>
      </div>
      <div class="rr-stage">
        <canvas class="rr-arena" aria-hidden="true"></canvas>
        <div class="rr-card rr-card-rival" aria-live="off"><div class="rr-card-head"><b data-r-name></b><i class="rr-type" data-r-type></i></div>
          <div class="rr-bar" role="meter" aria-label="Rival credibility" data-r-meter><i data-r-hp></i></div><div class="rr-card-foot"><span data-r-num></span><span class="rr-status" data-r-status></span></div></div>
        <div class="rr-card rr-card-player"><div class="rr-card-head"><b>Amundsen science party</b><i class="rr-type" data-p-type></i></div>
          <div class="rr-bar" role="meter" aria-label="Your credibility" data-p-meter><i data-p-hp></i></div><div class="rr-card-foot"><span data-p-num></span><span class="rr-status" data-p-status></span></div>
          <div class="rr-hours" title="Ship time"><i data-p-hours></i></div></div>
        <div class="rr-banner" data-banner></div>
      </div>
      <div class="rr-layout">
        <div class="rr-moves" role="group" aria-label="Your moves" data-moves></div>
        <div class="rr-side">
          <p class="rr-tell" data-tell></p>
          <ol class="rr-log" data-log aria-label="Battle log"></ol>
          <p class="rr-live" role="status" aria-live="polite" data-live></p>
        </div>
      </div>
      <p class="rr-hint"><kbd>1</kbd>–<kbd>4</kbd> pick a method · <kbd>←↑↓→</kbd>/<kbd>WASD</kbd> move the cursor · <kbd>Enter</kbd>/<kbd>Space</kbd> commit · <span data-hint-extra></span></p>
    </section>`;
    const panel = root.querySelector('.rr-game');
    const find = selector => panel.querySelector(selector);
    const canvas = find('canvas');
    const ctx = canvas.getContext('2d');
    const rawFillText = ctx.fillText.bind(ctx), rawStrokeText = ctx.strokeText.bind(ctx);
    ctx.fillText = (value, ...args) => rawFillText(text(String(value)), ...args);
    ctx.strokeText = (value, ...args) => rawStrokeText(text(String(value)), ...args);
    panel.focus();

    // ---------- rendering of the HTML parts ----------
    function typeBadge(type) { const t = TYPES[type]; return `<i class="rr-type" style="--rr-t:${t.colour}">${t.name}</i>`; }
    function setBadge(el, type) { el.style.setProperty('--rr-t', TYPES[type].colour); el.textContent = TYPES[type].name; }
    function renderHeading() {
      const a = state.arena;
      const where = [a.lat !== null ? `${Math.abs(a.lat).toFixed(2)}°${a.lat >= 0 ? 'N' : 'S'} ${Math.abs(a.lon).toFixed(2)}°${a.lon >= 0 ? 'E' : 'W'}` : 'position unknown',
        `${Math.round(a.depth)} m`, a.vehicle === 'helicopter' ? 'helicopter' : a.ice ? `ice ${a.ice}/10` : 'open water'];
      find('[data-where]').textContent = where.join(' · ');
      find('[data-rival-name]').textContent = cap(state.rival.article + state.rival.name);
      find('[data-rival-sub]').innerHTML = `${typeBadge(state.rival.type)} ${escape(TYPES[state.rival.type].blurb)} · tier ${state.rival.tier}`;
      find('[data-tier]').textContent = '★'.repeat(state.rival.tier) + '☆'.repeat(3 - state.rival.tier);
      find('[data-r-name]').textContent = cap(state.rival.article + state.rival.short);
      setBadge(find('[data-r-type]'), state.rival.type);
      setBadge(find('[data-p-type]'), 'field');
    }
    function statusText(side) {
      const s = [];
      if (side.status.fouled) s.push('fouled');
      if (side.status.curse) s.push('reviewer 2');
      if (side.status.trap) s.push('sampled');
      if (side.stages.defence) s.push(`def ${side.stages.defence > 0 ? '+' : ''}${side.stages.defence}`);
      return s.join(' · ');
    }
    function renderCards() {
      for (const [key, side] of [['r', shown.rival], ['p', shown.player]]) {
        const frac = side.hp / side.maxHp;
        const bar = find(`[data-${key}-hp]`);
        bar.style.width = `${frac * 100}%`;
        bar.className = frac > 0.5 ? '' : frac > 0.22 ? 'rr-mid' : 'rr-low';
        const meter = find(`[data-${key}-meter]`);
        meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', String(side.maxHp)); meter.setAttribute('aria-valuenow', String(side.hp));
        find(`[data-${key}-num]`).textContent = `${side.hp} / ${side.maxHp}`;
        find(`[data-${key}-status]`).textContent = statusText(side);
      }
      find('[data-p-hours]').style.width = `${Math.max(0, shown.player.hours) / shown.player.maxHours * 100}%`;
      find('[data-hours]').textContent = `${Math.max(0, shown.player.hours)} h`;
      find('[data-turn]').textContent = String(state.turn);
    }
    function renderMoves() {
      const options = moveOptions(state);
      const box = find('[data-moves]');
      const choosing = state.phase === 'choose';
      box.innerHTML = options.map(({ id, move, why }, i) => {
        const stats = [move.power ? `power ${move.power}` : 'support', `${Math.round(move.acc * 100)}% sure`, move.hours ? `${move.hours} h ship time` : 'desk work'];
        return `<button type="button" data-move="${i}" class="${i === cursor ? 'rr-cursor' : ''}" ${!choosing || why ? 'disabled' : ''} aria-label="${escape(move.name)}, ${TYPES[move.type].name}${why ? `, unavailable: ${escape(why)}` : ''}">
          <span class="rr-key">${i + 1}</span><span class="rr-move-body"><b>${escape(move.name)}</b>${typeBadge(move.type)}<small>${stats.join(' · ')}</small><span class="rr-desc">${why ? `<em>${escape(why)}</em> ` : ''}${escape(move.desc)}</span></span></button>`;
      }).join('');
    }
    function setCursor(i) { cursor = (i + 4) % 4; panel.querySelectorAll('[data-move]').forEach((b, k) => b.classList.toggle('rr-cursor', k === cursor)); }
    function addLog(text, kind) {
      const log = find('[data-log]');
      const li = document.createElement('li');
      li.className = `rr-log-${kind}`; li.textContent = text;
      log.append(li);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
      find('[data-live]').textContent = text;
    }
    function renderTell(text) { find('[data-tell]').textContent = text ? `Across the water: ${text}` : ''; }
    function banner(html) { const b = find('[data-banner]'); b.innerHTML = html; b.hidden = !html; }
    function renderIntro() {
      banner(`<p class="rr-banner-kicker">A RIVAL HAILS YOU</p><h4>${escape(cap(state.rival.article + state.rival.name))}</h4><p>${escape(state.blurb)}</p>
        <p class="rr-banner-small">${escape(TYPES[state.rival.type].name)} research · tier ${state.rival.tier} · ${escape(state.rival.hp)} credibility${submitted ? ' · points already banked this launch; this one is for pride' : ''}</p>
        <button type="button" data-action="start">Accept the challenge <kbd>Enter</kbd></button>`);
      find('[data-hint-extra]').textContent = 'Enter accepts the challenge';
    }
    function renderOutro() {
      const r = score(state), won = state.phase === 'won';
      const name = cap(state.rival.article + state.rival.short);
      const breakdown = won ? `<dl class="rr-breakdown"><div><dt>Rival tier ${state.rival.tier}</dt><dd>${r.base} base</dd></div><div><dt>Credibility left ${Math.round(r.health * 100)}%</dt><dd>× ${r.clean.toFixed(2)}</dd></div><div><dt>${r.turns} turn${r.turns === 1 ? '' : 's'}</dt><dd>× ${r.brisk.toFixed(2)}</dd></div><div><dt>${r.hoursLeft} h ship time left</dt><dd>× ${r.thrift.toFixed(2)}</dd></div></dl>` : '';
      const award = won ? (submitted ? `<p class="rr-banner-small">Points were banked on the earlier win; this one was for pride.</p>` : `<p class="rr-points"><strong>${r.points}</strong> science points</p>`) : `<p class="rr-banner-small">No points for a withdrawal. A fresh rival is waiting.</p>`;
      banner(`<p class="rr-banner-kicker">${won ? 'STATION HELD' : 'STATION LOST'}</p><h4>${won ? `Defeated ${escape(name.charAt(0).toLowerCase() + name.slice(1))}` : `${escape(name)} takes the station`}</h4>${breakdown}${award}
        <button type="button" data-action="replay">New rival <kbd>R</kbd></button>`);
      find('[data-hint-extra]').textContent = 'R hails a different rival';
      if (won && !submitted) {
        submitted = true;
        try { complete(r.points, { title: `Defeated ${name.charAt(0).toLowerCase() + name.slice(1)}`, rival: state.rival.id, tier: state.rival.tier, turns: r.turns, credibility: state.player.hp, hoursLeft: r.hoursLeft, kit: [...state.player.moves], arena: { ice: state.arena.ice, depth: Math.round(state.arena.depth), vehicle: state.arena.vehicle } }); }
        catch (error) { console.error(error); }
      }
    }

    // ---------- flow ----------
    function start() {
      if (state.phase !== 'intro') return;
      state.phase = 'choose';
      banner('');
      find('[data-hint-extra]').textContent = 'Escape closes the operation';
      addLog(`${cap(state.rival.article + state.rival.name)} hails the ship. ${state.arena.fog ? 'Fog on the water.' : 'Clear air.'} ${state.arena.ice ? `Ice ${state.arena.ice} tenths.` : 'Open water.'}`, 'info');
      renderTell(tell(state));
      renderMoves();
    }
    function choose(i) {
      if (state.phase !== 'choose') return;
      const option = moveOptions(state)[i];
      if (!option || option.why) { if (option) addLog(`${option.move.name}: ${option.why}`, 'info'); return; }
      cursor = i;
      renderTell('');
      const queue = playTurn(state, option.id);
      renderMoves();
      pump(queue);
    }
    function pump(queue) {
      const event = queue.shift();
      if (!event) { finishTurn(); return; }
      shown = event.snap;
      if (event.kind !== 'tell') addLog(event.text, event.kind === 'hit' ? (event.eff >= 1.25 ? 'super' : event.eff <= 0.8 ? 'weak' : 'hit') : event.kind);
      if (event.kind === 'use') fx.beam = { from: event.side, type: MOVES[event.move].type, start: performance.now() };
      if (event.kind === 'hit' || event.kind === 'tick') { fx.shake = { side: event.target || event.side, start: performance.now() }; fx.pops.push({ side: event.target || event.side, text: `−${event.damage}`, start: performance.now(), strong: event.eff >= 1.25 || event.crit }); }
      if (event.kind === 'heal') fx.pops.push({ side: event.side, text: `+${event.amount}`, start: performance.now(), heal: true });
      if (event.kind === 'tell') renderTell(event.text);
      renderCards();
      timer = setTimeout(() => { timer = null; if (alive) pump(queue); }, PACE[event.kind] || 500);
    }
    function finishTurn() {
      shown = snapshotOf(state);
      renderCards();
      if (state.phase === 'won' || state.phase === 'lost') { renderMoves(); renderOutro(); return; }
      renderMoves();
    }
    function replay() {
      if (state.phase !== 'won' && state.phase !== 'lost') return;
      launches += 1;
      state = createDuel(expedition, Date.now() + launches * 7919, state.rival.id);
      shown = snapshotOf(state); cursor = 0; fx.beam = null; fx.shake = null; fx.pops.length = 0;
      find('[data-log]').replaceChildren(); renderTell('');
      buildFloes(); renderHeading(); renderCards(); renderMoves(); renderIntro();
    }

    // ---------- input ----------
    panel.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.move !== undefined) choose(Number(button.dataset.move));
      else if (button.dataset.action === 'start') start();
      else if (button.dataset.action === 'replay') replay();
    }, { signal });
    window.addEventListener('keydown', event => {
      if (!alive || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' || /^(input|textarea|select)$/i.test(event.target?.tagName || '')) return;
      const onButton = event.target instanceof Element && panel.contains(event.target) && event.target.closest('button');
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const confirm = key === 'Enter' || key === ' ';
      if (confirm && onButton) return; // the button's own click handles it
      if (state.phase === 'intro') { if (confirm) { event.preventDefault(); start(); } return; }
      if (state.phase === 'won' || state.phase === 'lost') { if (confirm || key === 'r') { event.preventDefault(); replay(); } return; }
      if (state.phase !== 'choose') return;
      if (/^[1-4]$/.test(key)) { event.preventDefault(); choose(Number(key) - 1); return; }
      const step = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1, ArrowUp: -2, w: -2, ArrowDown: 2, s: 2 }[key];
      if (step !== undefined) { event.preventDefault(); setCursor(cursor + step); return; }
      if (confirm) { event.preventDefault(); choose(cursor); }
    }, { signal });

    // ---------- arena ----------
    let W = 0, H = 0;
    function fit() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(rect.width)); H = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const floes = [];
    function buildFloes() {
      floes.length = 0;
      let s = state.arena.seed || 1;
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 46; i++) {
        const verts = [];
        const n = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) verts.push([Math.cos(k / n * Math.PI * 2) * (0.7 + rnd() * 0.5), Math.sin(k / n * Math.PI * 2) * (0.35 + rnd() * 0.25)]);
        floes.push({ x: rnd(), d: rnd(), size: 0.5 + rnd(), verts, order: rnd() });
      }
    }
    function spritePos(side) {
      const small = W < 560;
      return side === 'player' ? { x: W * (small ? 0.26 : 0.24), y: H * 0.8, s: Math.min(W, H * 1.9) / (small ? 380 : 520) } : { x: W * (small ? 0.74 : 0.74), y: H * (state.rival.sprite === 'satellite' || state.rival.sprite === 'plane' || state.rival.sprite === 'reviewer' ? 0.38 : state.rival.sprite === 'grid' ? 0.4 : 0.5), s: Math.min(W, H * 1.9) / (small ? 560 : 820) };
    }
    function draw(now) {
      if (!W) return;
      const t = now / 1000, a = shown.arena, horizon = H * 0.42;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#5f86a9'); sky.addColorStop(1, '#d6e4ec');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon + 1);
      ctx.fillStyle = '#fbe9c4'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(W * 0.62, horizon - H * 0.12, H * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      const sea = ctx.createLinearGradient(0, horizon, 0, H);
      sea.addColorStop(0, '#6f93ad'); sea.addColorStop(0.25, '#2e5f7f'); sea.addColorStop(1, '#173a52');
      ctx.fillStyle = sea; ctx.fillRect(0, horizon, W, H - horizon);
      ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const d = (i + 0.5) / 9, y = horizon + d ** 1.5 * (H - horizon);
        ctx.beginPath();
        for (let x = 0; x <= W; x += 12) ctx.lineTo(x, y + Math.sin(x / (18 + d * 30) + t * 1.4 + i) * (1 + d * 4));
        ctx.stroke();
      }
      const count = Math.round(floes.length * a.ice / 10);
      const sorted = floes.slice(0, count).sort((p, q) => p.d - q.d);
      for (const f of sorted) {
        const y = horizon + f.d ** 1.6 * (H - horizon) + H * 0.02, size = f.size * (0.15 + f.d) * W * 0.09, x = f.x * W;
        ctx.beginPath();
        f.verts.forEach(([vx, vy], i) => ctx[i ? 'lineTo' : 'moveTo'](x + vx * size, y + vy * size * 0.6));
        ctx.closePath();
        ctx.fillStyle = '#e9f2f6'; ctx.fill();
        ctx.fillStyle = '#b9d5e0'; ctx.beginPath();
        f.verts.forEach(([vx, vy], i) => ctx[i ? 'lineTo' : 'moveTo'](x + vx * size, y + vy * size * 0.6 + size * 0.12));
        ctx.closePath(); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      }
      const shakeOf = side => fx.shake && fx.shake.side === side && now - fx.shake.start < 450 ? Math.sin((now - fx.shake.start) / 22) * 6 * (1 - (now - fx.shake.start) / 450) : 0;
      const rival = spritePos('rival'), player = spritePos('player');
      ctx.save(); ctx.translate(rival.x + shakeOf('rival'), rival.y); ctx.scale(rival.s, rival.s);
      if (shown.rival.hp <= 0) ctx.globalAlpha = 0.35;
      drawSprite(ctx, state.rival.sprite, t, true);
      ctx.restore();
      if (a.fog) {
        const fog = ctx.createLinearGradient(0, horizon - H * 0.25, 0, H * 0.75);
        fog.addColorStop(0, '#dfe7ebee'); fog.addColorStop(0.5, '#dfe7ebb8'); fog.addColorStop(1, '#dfe7eb30');
        ctx.fillStyle = fog; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffffff30';
        for (let i = 0; i < 4; i++) { const y = horizon - H * 0.1 + i * H * 0.11 + Math.sin(t * 0.4 + i) * 6; ctx.fillRect(0, y, W, H * 0.03); }
      }
      ctx.save(); ctx.translate(player.x + shakeOf('player'), player.y + Math.sin(t * 1.1) * 3); ctx.rotate(Math.sin(t * 0.9) * 0.012); ctx.scale(player.s, player.s);
      if (shown.player.hp <= 0) ctx.globalAlpha = 0.45;
      drawSprite(ctx, state.arena.vehicle === 'helicopter' ? 'heli' : 'amundsen', t, false);
      ctx.restore();
      if (fx.beam && now - fx.beam.start < 520) {
        const p = (now - fx.beam.start) / 520, from = fx.beam.from === 'player' ? player : rival, to = fx.beam.from === 'player' ? rival : player;
        const colour = TYPES[fx.beam.type].colour;
        ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.globalAlpha = 0.85; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 12;
        ctx.beginPath(); ctx.moveTo(from.x, from.y - 30 * from.s); ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - H * 0.25, to.x, to.y - 20 * to.s); ctx.stroke();
        ctx.setLineDash([]);
        const bx = (1 - p) ** 2 * from.x + 2 * (1 - p) * p * (from.x + to.x) / 2 + p * p * to.x, by = (1 - p) ** 2 * (from.y - 30 * from.s) + 2 * (1 - p) * p * (Math.min(from.y, to.y) - H * 0.25) + p * p * (to.y - 20 * to.s);
        ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(bx, by, 6 + Math.sin(now / 40) * 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      } else fx.beam = null;
      fx.pops = fx.pops.filter(pop => now - pop.start < 1100);
      for (const pop of fx.pops) {
        const p = (now - pop.start) / 1100, at = pop.side === 'player' ? player : rival;
        ctx.globalAlpha = 1 - p; ctx.font = `${pop.strong ? 800 : 700} ${pop.strong ? 30 : 22}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = pop.heal ? '#8ef0b2' : pop.strong ? '#ffd166' : '#ffffff';
        ctx.strokeStyle = '#10263a'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
        const x = at.x + (pop.side === 'player' ? 150 : 130) * at.s, y = at.y - (pop.side === 'player' ? 90 : 60) * at.s - p * 50;
        ctx.strokeText(pop.text, x, y); ctx.fillText(pop.text, x, y); ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
    }
    function loop(now) { frame = null; if (!alive) return; draw(now); frame = requestAnimationFrame(loop); }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fit(); draw(performance.now()); }) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', () => { fit(); draw(performance.now()); }, { signal });

    // ---------- go ----------
    buildFloes();
    renderHeading(); renderCards(); renderMoves(); renderIntro();
    fit(); frame = requestAnimationFrame(loop);
    return () => {
      alive = false; events.abort(); observer?.disconnect();
      if (timer) clearTimeout(timer); if (frame) cancelAnimationFrame(frame);
    };
  },
};

function snapshotOf(state) {
  const side = s => ({ hp: s.hp, maxHp: s.maxHp, hours: s.hours, maxHours: s.maxHours, stages: { ...s.stages }, status: { ...s.status } });
  return { player: side(state.player), rival: side(state.rival), arena: { ice: state.arena.ice, fog: state.arena.fog } };
}

// Sprites are drawn in a local frame where (0,0) is the waterline centre and one unit is one pixel at scale 1.
function drawSprite(ctx, kind, t, far) {
  ctx.lineJoin = 'round'; ctx.lineWidth = 2;
  switch (kind) {
    case 'amundsen': return drawShip(ctx, '#c8302b', '#f4f4f0', '#333', 1);
    case 'ship': return drawShip(ctx, '#27436b', '#e9ecef', '#b12', -1);
    case 'heli': return drawHeli(ctx, t, '#c8302b', '#f4f4f0');
    case 'satellite': return drawSatellite(ctx, t);
    case 'grid': return drawGrid(ctx, t);
    case 'sub': return drawSub(ctx, t);
    case 'gliders': return drawGliders(ctx, t);
    case 'plane': return drawPlane(ctx, t);
    case 'reviewer': return drawReviewer(ctx, t);
    default: return drawShip(ctx, '#27436b', '#e9ecef', '#b12', -1);
  }
}
function drawShip(ctx, hull, deck, stripe, dir) {
  ctx.save(); ctx.scale(dir, 1);
  ctx.fillStyle = '#0d2233aa'; ctx.beginPath(); ctx.ellipse(0, 6, 150, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(-140, -22); ctx.lineTo(120, -22); ctx.lineTo(150, -34); ctx.lineTo(132, 4); ctx.lineTo(-128, 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = stripe; ctx.fillRect(-120, -30, 12, 8);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-140, -22); ctx.lineTo(120, -22); ctx.lineTo(150, -34); ctx.lineTo(-140, -34); ctx.closePath(); ctx.fill();
  ctx.fillStyle = deck; ctx.fillRect(-70, -70, 110, 36); ctx.fillRect(-40, -96, 60, 26);
  ctx.fillStyle = '#1b3a4c'; for (let i = 0; i < 6; i++) ctx.fillRect(-60 + i * 17, -62, 10, 8); for (let i = 0; i < 3; i++) ctx.fillRect(-32 + i * 18, -90, 10, 8);
  ctx.fillStyle = hull; ctx.fillRect(-14, -118, 16, 22); ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-14, -122, 16, 6);
  ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(60, -34); ctx.lineTo(60, -100); ctx.moveTo(48, -88); ctx.lineTo(72, -88); ctx.stroke();
  ctx.strokeStyle = '#c9c9c9'; ctx.beginPath(); ctx.moveTo(-135, -40); ctx.lineTo(-70, -40); ctx.stroke();
  ctx.fillStyle = '#e8b53a'; ctx.fillRect(-128, -60, 6, 26); ctx.fillRect(-128, -60, 40, 5);
  ctx.restore();
}
function drawHeli(ctx, t, body, trim) {
  ctx.save(); ctx.translate(0, -120);
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 70, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = trim; ctx.beginPath(); ctx.ellipse(30, -6, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(-60, -8); ctx.lineTo(-170, -26); ctx.lineTo(-170, -6); ctx.lineTo(-60, 10); ctx.closePath(); ctx.fill();
  ctx.fillRect(-176, -46, 8, 34);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-40, 28); ctx.lineTo(-48, 50); ctx.moveTo(40, 28); ctx.lineTo(48, 50); ctx.moveTo(-70, 50); ctx.lineTo(70, 50); ctx.stroke();
  ctx.fillStyle = '#222'; ctx.fillRect(-4, -46, 8, 20);
  const spin = Math.abs(Math.sin(t * 40)) * 150 + 20;
  ctx.fillStyle = '#22222299'; ctx.fillRect(-spin, -50, spin * 2, 5);
  ctx.restore();
}
function drawSatellite(ctx, t) {
  ctx.save(); ctx.rotate(-0.25 + Math.sin(t * 0.5) * 0.03); ctx.translate(0, -40);
  ctx.fillStyle = '#31507a'; ctx.strokeStyle = '#dbe6f2';
  for (const dir of [-1, 1]) { ctx.save(); ctx.scale(dir, 1); ctx.fillRect(40, -30, 170, 60); ctx.strokeRect(40, -30, 170, 60); ctx.beginPath(); for (let i = 1; i < 6; i++) { ctx.moveTo(40 + i * 28, -30); ctx.lineTo(40 + i * 28, 30); } ctx.moveTo(40, 0); ctx.lineTo(210, 0); ctx.stroke(); ctx.restore(); }
  ctx.fillStyle = '#c9b56b'; ctx.fillRect(-36, -36, 72, 72); ctx.strokeStyle = '#7a6d3e'; ctx.strokeRect(-36, -36, 72, 72);
  ctx.fillStyle = '#e8eef4'; ctx.beginPath(); ctx.ellipse(0, 60, 34, 14, 0, 0, Math.PI, true); ctx.fill();
  ctx.strokeStyle = '#e8eef4'; ctx.beginPath(); ctx.moveTo(0, 46); ctx.lineTo(0, 70); ctx.stroke();
  ctx.restore();
}
function drawGrid(ctx, t) {
  ctx.save(); ctx.translate(0, -30);
  ctx.strokeStyle = '#b48ad8'; ctx.fillStyle = '#9b4fc433'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  for (let i = -3; i <= 3; i++) { const r = 110 * Math.cos(i / 4 * Math.PI / 2); ctx.beginPath(); ctx.ellipse(0, 110 * Math.sin(i / 4 * Math.PI / 2), r, r * 0.25, 0, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 6; i++) { const ph = t * 0.4 + i / 6 * Math.PI; ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(Math.cos(ph)) * 110, 110, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = '#f2d4ff'; ctx.lineWidth = 2;
  for (let c = 0; c < 3; c++) { ctx.beginPath(); for (let k = 0; k <= 40; k++) { const ang = k / 40 * Math.PI * 2; const r = 30 + c * 22 + Math.sin(ang * 3 + t + c) * 8; ctx.lineTo(Math.cos(ang) * r - 20, Math.sin(ang) * r * 0.6 + 10); } ctx.closePath(); ctx.stroke(); }
  ctx.fillStyle = '#2b1f3a'; ctx.fillRect(-70, 130, 140, 60); ctx.fillStyle = '#9ef0a0';
  for (let i = 0; i < 12; i++) if (Math.sin(t * 6 + i * 1.7) > 0) ctx.fillRect(-60 + (i % 6) * 22, 140 + Math.floor(i / 6) * 22, 12, 6);
  ctx.restore();
}
function drawSub(ctx, t) {
  ctx.save(); ctx.translate(0, Math.sin(t * 0.7) * 2);
  ctx.fillStyle = '#0d2233aa'; ctx.beginPath(); ctx.ellipse(0, 8, 120, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1f2a33'; ctx.beginPath(); ctx.ellipse(0, 4, 150, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillRect(-30, -60, 50, 64); ctx.beginPath(); ctx.moveTo(20, -60); ctx.lineTo(34, -40); ctx.lineTo(34, 4); ctx.lineTo(20, 4); ctx.fill();
  ctx.fillStyle = '#3b4a56'; ctx.fillRect(-10, -92, 5, 34); ctx.fillRect(4, -84, 4, 26); ctx.fillRect(-14, -94, 14, 4);
  ctx.fillStyle = '#e9f2f6'; ctx.beginPath(); ctx.moveTo(-150, 0); ctx.lineTo(-90, -10); ctx.lineTo(-40, 0); ctx.lineTo(50, -6); ctx.lineTo(160, 0); ctx.lineTo(160, 6); ctx.lineTo(-150, 6); ctx.fill();
  ctx.restore();
}
function drawGliders(ctx, t) {
  for (const [dx, dy, ph] of [[-90, 10, 0], [20, -6, 1.5], [110, 14, 3]]) {
    ctx.save(); ctx.translate(dx, dy + Math.sin(t * 1.3 + ph) * 3); ctx.rotate(0.35);
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.ellipse(0, 0, 44, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b2d3a'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(10, -22); ctx.lineTo(18, 0); ctx.lineTo(10, 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1b2d3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-52, -34); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#ffffff55'; ctx.beginPath(); ctx.ellipse(20, 20, 150, 8, 0, 0, Math.PI * 2); ctx.fill();
}
function drawPlane(ctx, t) {
  ctx.save(); ctx.translate(0, -80 + Math.sin(t * 0.8) * 4);
  ctx.fillStyle = '#f1f1ec'; ctx.beginPath(); ctx.ellipse(0, 0, 120, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c4a63'; ctx.beginPath(); ctx.moveTo(-110, -2); ctx.lineTo(-140, -40); ctx.lineTo(-112, -40); ctx.lineTo(-80, -2); ctx.fill();
  ctx.fillStyle = '#d8dce0'; ctx.beginPath(); ctx.moveTo(-30, -4); ctx.lineTo(60, -4); ctx.lineTo(90, 26); ctx.lineTo(10, 26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c4a63'; ctx.fillRect(10, 8, 26, 12); ctx.fillRect(48, 8, 26, 12);
  ctx.fillStyle = '#c8302b'; ctx.fillRect(-60, -10, 80, 6);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-20, 14); ctx.lineTo(-90, 120); ctx.stroke();
  ctx.fillStyle = '#e8b53a'; ctx.beginPath(); ctx.ellipse(-92, 126, 40, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawReviewer(ctx, t) {
  ctx.save(); ctx.translate(0, -60 + Math.sin(t * 0.9) * 5); ctx.rotate(-0.08 + Math.sin(t * 0.6) * 0.03);
  ctx.fillStyle = '#0d223355'; ctx.fillRect(-84, -104, 170, 210);
  ctx.fillStyle = '#fbf8f0'; ctx.fillRect(-90, -110, 170, 210); ctx.strokeStyle = '#c9c2b0'; ctx.strokeRect(-90, -110, 170, 210);
  ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < 9; i++) { ctx.moveTo(-74, -86 + i * 20); ctx.lineTo(-74 + 100 + (i % 3) * 12, -86 + i * 20); }
  ctx.stroke();
  ctx.strokeStyle = '#d0202a'; ctx.lineWidth = 4; ctx.beginPath();
  ctx.moveTo(-70, -60); ctx.lineTo(50, -40); ctx.moveTo(-60, 0); ctx.lineTo(-20, 40); ctx.lineTo(30, -10); ctx.moveTo(-70, 60); ctx.lineTo(60, 62); ctx.stroke();
  ctx.fillStyle = '#d0202a'; ctx.font = '800 96px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('2', 6, 50);
  ctx.textAlign = 'left';
  ctx.save(); ctx.translate(96, -20); ctx.rotate(0.6 + Math.sin(t * 2) * 0.05);
  ctx.fillStyle = '#d0202a'; ctx.fillRect(-8, -110, 16, 120); ctx.fillStyle = '#f4e6d2'; ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(8, 10); ctx.lineTo(0, 34); ctx.fill();
  ctx.restore(); ctx.restore();
}
