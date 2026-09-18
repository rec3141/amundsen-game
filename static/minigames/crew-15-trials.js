// Neptune's five trials and the canvas scenery they play on. Each trial exposes
// brief(ctx) for the overlay, controls for the button strip, and start(ctx), which
// returns { key(name, down), frame(now, dt), cleanup }. A trial ends by calling
// ctx.finish({ passed, bonus, headline, note }) exactly once.
import { clamp, sliderToDepth, depthToSlider, judgeSounding, tridentMarker, judgeStrike, makeSequence, DIRECTIONS, MUG, makeSea, rollAt, stepMug, dealRiddles } from './crew-15-model.js';

export const WIDTH = 640, HEIGHT = 360;
const GOLD = '#e8b84a', FOAM = '#dff3f4', INK = '#0b2530';

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => {
  const p = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], t))).join(',')})`;
};

// Backdrop: sky, horizon, a sea whose colour and chop follow Neptune's mood, and the god himself at right.
export function drawScene(g, t, mood, focus) {
  g.clearRect(0, 0, WIDTH, HEIGHT);
  const sky = g.createLinearGradient(0, 0, 0, HEIGHT * 0.45);
  sky.addColorStop(0, mix('#31667a', '#1a2a38', mood));
  sky.addColorStop(1, mix('#6f9fae', '#3c4c58', mood));
  g.fillStyle = sky; g.fillRect(0, 0, WIDTH, HEIGHT);
  const seaTop = HEIGHT * 0.42;
  const sea = g.createLinearGradient(0, seaTop, 0, HEIGHT);
  sea.addColorStop(0, mix('#1f6f7c', '#132f3d', mood));
  sea.addColorStop(1, mix('#0f3d4b', '#071a24', mood));
  g.fillStyle = sea; g.fillRect(0, seaTop, WIDTH, HEIGHT - seaTop);
  // Three bands of swell, steeper as the mood darkens.
  for (let band = 0; band < 3; band++) {
    const y0 = seaTop + 8 + band * 28, amp = 4 + band * 3 + mood * 10, k = 0.028 - band * 0.005, speed = (0.9 + band * 0.3) * (1 + mood);
    g.beginPath(); g.moveTo(0, HEIGHT);
    for (let x = 0; x <= WIDTH; x += 8) g.lineTo(x, y0 + Math.sin(x * k + t * speed + band) * amp + Math.sin(x * k * 2.3 - t * speed * 1.7) * amp * 0.4);
    g.lineTo(WIDTH, HEIGHT); g.closePath();
    g.fillStyle = mix(['#2a8a95', '#1f7583', '#16606e'][band], ['#1b3f4c', '#152f3a', '#0f232c'][band], mood) + (band === 0 ? 'cc' : 'aa');
    g.fill();
    if (band === 0) { g.strokeStyle = `rgba(223,243,244,${0.25 + mood * 0.4})`; g.lineWidth = 1.5; g.stroke(); }
  }
  if (!focus) drawNeptune(g, WIDTH - 118, seaTop + 6, 1, t, mood);
  else drawNeptune(g, WIDTH - 62, seaTop + 40, 0.55, t, mood);
}

// Neptune rises to the chest, crowned, trident in the right hand, beard breaking like surf.
export function drawNeptune(g, x, y, s, t, mood) {
  g.save(); g.translate(x, y + Math.sin(t * 0.8) * 3 * s); g.scale(s, s);
  const skin = mix('#8fb9a8', '#6d8f8a', mood);
  // Trident
  g.strokeStyle = GOLD; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(62, 40); g.lineTo(62, -120); g.stroke();
  g.beginPath(); g.moveTo(44, -112); g.lineTo(44, -140); g.moveTo(62, -122); g.lineTo(62, -150); g.moveTo(80, -112); g.lineTo(80, -140); g.stroke();
  g.beginPath(); g.moveTo(44, -112); g.quadraticCurveTo(62, -96, 80, -112); g.stroke();
  // Shoulders and chest
  g.fillStyle = skin; g.beginPath(); g.moveTo(-70, 60); g.quadraticCurveTo(-70, -6, -20, -14); g.lineTo(20, -14); g.quadraticCurveTo(70, -6, 70, 60); g.closePath(); g.fill();
  // Head
  g.beginPath(); g.ellipse(0, -52, 30, 34, 0, 0, Math.PI * 2); g.fill();
  // Crown
  g.fillStyle = GOLD; g.beginPath(); g.moveTo(-30, -74); g.lineTo(-30, -96); g.lineTo(-18, -84); g.lineTo(-8, -104); g.lineTo(0, -86); g.lineTo(8, -104); g.lineTo(18, -84); g.lineTo(30, -96); g.lineTo(30, -74); g.closePath(); g.fill();
  // Beard: foam-white, layered waves down the chest, taller when he is roused.
  g.fillStyle = FOAM;
  for (let layer = 0; layer < 4; layer++) {
    const yy = -30 + layer * 14, w = 34 - layer * 3, wob = Math.sin(t * 2 + layer) * (1 + mood * 3);
    g.beginPath(); g.moveTo(-w, yy);
    for (let i = -w; i <= w; i += 8) g.quadraticCurveTo(i + 4, yy + 12 + wob, i + 8, yy);
    g.lineTo(w, yy + 40 - layer * 6); g.quadraticCurveTo(0, yy + 52 - layer * 4, -w, yy + 40 - layer * 6); g.closePath(); g.fill();
  }
  // Eyes and brows: brows dive inward as the mood darkens.
  g.fillStyle = INK; g.beginPath(); g.ellipse(-11, -56, 3.2, 4, 0, 0, Math.PI * 2); g.ellipse(11, -56, 3.2, 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = FOAM; g.lineWidth = 4; g.lineCap = 'round';
  const tilt = lerp(-4, 8, mood);
  g.beginPath(); g.moveTo(-20, -66 - tilt * 0.3); g.lineTo(-4, -66 + tilt); g.moveTo(20, -66 - tilt * 0.3); g.lineTo(4, -66 + tilt); g.stroke();
  // Moustache
  g.beginPath(); g.moveTo(-16, -40); g.quadraticCurveTo(0, -30 + mood * 6, 16, -40); g.stroke();
  g.restore();
}

function label(g, text, x, y, size = 15, colour = FOAM, align = 'left', weight = 600) {
  g.fillStyle = colour; g.font = `${weight} ${size}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(text, x, y);
}

function button(ctx, text, key, action, extra = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = key ? `${text} <kbd>${key}</kbd>` : text;
  if (extra.className) b.className = extra.className;
  if (extra.label) b.setAttribute('aria-label', extra.label);
  b.addEventListener('click', action, { signal: ctx.signal });
  ctx.controls.append(b);
  return b;
}

// Buttons that act while held, for the mug: pointer down/up plus keyboard fallbacks on the button itself.
function holdButton(ctx, text, key, onHold, extra) {
  const b = button(ctx, text, key, () => {}, extra);
  const down = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); onHold(true); };
  const up = () => onHold(false);
  b.addEventListener('pointerdown', down, { signal: ctx.signal });
  b.addEventListener('pointerup', up, { signal: ctx.signal });
  b.addEventListener('pointercancel', up, { signal: ctx.signal });
  b.addEventListener('lostpointercapture', up, { signal: ctx.signal });
  return b;
}

// ---------- 1. The Sounding ----------
const sounding = {
  id: 'sounding', name: 'The Sounding', kicker: 'TRIAL OF THE LEAD LINE',
  brief: ctx => `Neptune asks how much water lies beneath your keel. Set your call on a log scale from 5 to 3000 m. Within a third of the truth passes; within a tenth pleases him.${ctx.truthHere ? ' He means the water the ship floats on right now.' : ' He names a spot from the leg record.'}`,
  controls: 'Shallower <kbd>←</kbd> · Deeper <kbd>→</kbd> · Call it <kbd>Space</kbd>',
  start(ctx) {
    const here = Number.isFinite(ctx.expedition?.depth) && ctx.expedition.depth >= 5;
    const pick = here ? null : ctx.data.soundings[Math.floor(ctx.rng() * ctx.data.soundings.length)];
    const truth = here ? ctx.expedition.depth : pick.depth;
    const where = here ? 'beneath the keel, right here' : `beneath the keel at ${pick.lat.toFixed(2)}°N ${(-pick.lon).toFixed(2)}°W on ${pick.time.slice(5, 10).replace('-', '/')} ${pick.time.slice(11)}`;
    let slider = 0.45, called = null, verdict = null;
    const range = document.createElement('input');
    range.type = 'range'; range.min = 0; range.max = 1000; range.step = 1; range.value = Math.round(slider * 1000);
    range.setAttribute('aria-label', 'Depth call'); range.className = 'np-range';
    const readout = document.createElement('output'); readout.className = 'np-readout';
    const show = () => { readout.textContent = `${sliderToDepth(slider)} m`; range.value = Math.round(slider * 1000); ctx.say(`Your call: ${sliderToDepth(slider)} m ${where}.`); };
    const nudge = d => { if (called !== null) return; slider = clamp(slider + d, 0, 1); show(); };
    const call = () => {
      if (called !== null) return;
      called = sliderToDepth(slider);
      verdict = judgeSounding(called, truth);
      range.disabled = true;
      ctx.controls.querySelectorAll('button').forEach(b => { b.disabled = true; });
      setTimeout(() => ctx.finish({
        passed: verdict.passed, bonus: verdict.bonus,
        headline: verdict.passed ? `${called} m: ${verdict.grade}` : `${called} m: ${verdict.grade}`,
        note: `The lead found ${Math.round(truth)} m ${where}.`,
      }), 1400);
    };
    range.addEventListener('input', () => { if (called === null) { slider = range.valueAsNumber / 1000; show(); } }, { signal: ctx.signal });
    button(ctx, 'Shallower', '←', () => nudge(-0.03));
    ctx.controls.append(range, readout);
    button(ctx, 'Deeper', '→', () => nudge(0.03));
    button(ctx, 'Call it', 'Space', call, { className: 'np-go' });
    show();
    return {
      key(name, down) {
        if (!down) return false;
        if (name === 'arrowleft' || name === 'arrowdown' || name === '-') { nudge(-0.02); return true; }
        if (name === 'arrowright' || name === 'arrowup' || name === '+' || name === '=') { nudge(0.02); return true; }
        if (name === ' ' || name === 'enter') { call(); return true; }
        return false;
      },
      frame(now, dt, t) {
        const g = ctx.g;
        const x0 = 78, x1 = 420, top = 60, bottom = HEIGHT - 30;
        g.fillStyle = '#08202acc'; g.fillRect(x0 - 62, top - 30, x1 - x0 + 82, bottom - top + 50);
        // Log-scale depth ticks
        for (const z of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3000]) {
          const y = lerp(top, bottom, depthToSlider(z));
          g.strokeStyle = '#ffffff33'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
          label(g, `${z} m`, x0 - 4, y, 11, '#9fd9d0', 'right', 500);
        }
        // Ship at the surface
        g.fillStyle = '#e2493d'; g.beginPath(); g.moveTo(x0 + 130, top - 14); g.lineTo(x0 + 230, top - 14); g.lineTo(x0 + 240, top - 2); g.lineTo(x0 + 120, top - 2); g.closePath(); g.fill();
        g.fillStyle = FOAM; g.fillRect(x0 + 150, top - 26, 40, 12);
        const y = lerp(top, bottom, slider);
        g.setLineDash([6, 6]); g.strokeStyle = GOLD; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 180, top); g.lineTo(x0 + 180, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = GOLD; g.beginPath(); g.moveTo(x0 + 172, y); g.lineTo(x0 + 188, y); g.lineTo(x0 + 180, y + 12); g.closePath(); g.fill();
        label(g, `${sliderToDepth(slider)} m`, x0 + 196, y, 16, GOLD);
        if (called !== null) {
          const ty = lerp(top, bottom, depthToSlider(truth));
          g.fillStyle = '#6b4f2e'; g.beginPath(); g.moveTo(x0, ty);
          for (let x = x0; x <= x1; x += 20) g.lineTo(x, ty + Math.sin(x * 0.07 + t) * 4);
          g.lineTo(x1, bottom); g.lineTo(x0, bottom); g.closePath(); g.fill();
          label(g, `${Math.round(truth)} m`, x1 - 8, ty - 12, 16, verdict.passed ? '#8fe0d2' : '#f0a24c', 'right');
        }
      },
    };
  },
};

// ---------- 2. The Trident ----------
const trident = {
  id: 'trident', name: 'The Trident', kicker: 'TRIAL OF THE STRIKE',
  brief: () => 'Neptune lends you his trident. The point sweeps the bar; strike while it crosses the gold. Three strikes, and each is faster than the last. Two hits pass; the centre of the gold pleases him.',
  controls: 'Strike <kbd>Space</kbd>',
  start(ctx) {
    const rounds = [{ period: 1.9, width: 0.18 }, { period: 1.4, width: 0.14 }, { period: 1.0, width: 0.11 }];
    let round = 0, marker = 0, t0 = null, lastHit = null, points = 0, hits = 0, done = false, flash = 0;
    const band = () => ({ at: 0.15 + ctx.rng() * (0.7 - rounds[round].width), width: rounds[round].width });
    let target = band();
    const strikeButton = button(ctx, 'Strike', 'Space', () => strike(), { className: 'np-go' });
    const strike = () => {
      if (done || t0 === null) return;
      const result = judgeStrike(marker, target);
      lastHit = { ...result, at: marker, when: performance.now() };
      flash = 1;
      if (result.hit) { hits++; points += result.points; }
      ctx.say(result.hit ? `Strike ${round + 1}: hit${result.points === 10 ? ', dead centre' : ''}. ${hits} of ${round + 1}.` : `Strike ${round + 1}: the point slid off. ${hits} of ${round + 1}.`);
      round++;
      if (round >= rounds.length) {
        done = true; strikeButton.disabled = true;
        const passed = hits >= 2;
        setTimeout(() => ctx.finish({ passed, bonus: Math.max(0, points - 14), headline: `${hits} of 3 strikes${hits === 3 && points === 30 ? ', all dead centre' : ''}`, note: passed ? 'The trident rings true.' : 'The trident twists in a mortal hand.' }), 1200);
      } else {
        t0 = null; target = band();
        setTimeout(() => { if (!done && t0 === null) t0 = performance.now(); }, 700);
      }
    };
    setTimeout(() => { if (!done) t0 = performance.now(); }, 800);
    ctx.say('Strike 1 of 3. Watch the point.');
    return {
      key(name, down) { if (down && (name === ' ' || name === 'enter' || name === 's')) { strike(); return true; } return false; },
      frame(now, dt) {
        const g = ctx.g;
        if (t0 !== null && !done) marker = tridentMarker((now - t0) / 1000, rounds[Math.min(round, 2)].period);
        flash = Math.max(0, flash - dt * 3);
        const x0 = 50, x1 = 470, y = 170, h = 44;
        g.fillStyle = '#08202acc'; g.fillRect(x0 - 24, y - 90, x1 - x0 + 48, 190);
        label(g, `Strike ${Math.min(round + 1, 3)} of 3`, x0, y - 66, 15, '#9fd9d0');
        label(g, `${hits} hit${hits === 1 ? '' : 's'}`, x1, y - 66, 15, GOLD, 'right');
        g.fillStyle = '#123a45'; g.fillRect(x0, y - h / 2, x1 - x0, h);
        g.fillStyle = GOLD; g.fillRect(lerp(x0, x1, target.at), y - h / 2, (x1 - x0) * target.width, h);
        g.fillStyle = '#fff5cc'; g.fillRect(lerp(x0, x1, target.at + target.width * 0.325), y - h / 2, (x1 - x0) * target.width * 0.35, h);
        // The trident point
        const mx = lerp(x0, x1, marker);
        g.strokeStyle = flash > 0 && lastHit ? (lastHit.hit ? '#8fe0d2' : '#f0a24c') : FOAM; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(mx, y + 80); g.lineTo(mx, y - 30); g.moveTo(mx - 12, y - 18); g.lineTo(mx - 12, y - 36); g.moveTo(mx + 12, y - 18); g.lineTo(mx + 12, y - 36); g.stroke();
        g.beginPath(); g.moveTo(mx - 12, y - 18); g.quadraticCurveTo(mx, y - 6, mx + 12, y - 18); g.stroke();
        if (lastHit && flash > 0) label(g, lastHit.hit ? (lastHit.points === 10 ? 'Dead centre' : 'Hit') : 'Missed', (x0 + x1) / 2, y + 62, 20, lastHit.hit ? '#8fe0d2' : '#f0a24c', 'center', 700);
        else if (t0 === null && !done) label(g, 'Ready…', (x0 + x1) / 2, y + 62, 16, '#9fd9d0', 'center');
      },
    };
  },
};

// ---------- 3. The Swell ----------
const ARROW = { up: '↑', right: '→', down: '↓', left: '←' };
const KEY_DIR = { arrowup: 'up', w: 'up', arrowright: 'right', d: 'right', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left' };
const swell = {
  id: 'swell', name: 'The Swell', kicker: 'TRIAL OF THE FOUR WINDS',
  brief: () => 'Neptune raises the sea from four quarters in turn. Watch the order, then send it back to him with the arrows. Three rounds, each a wave longer. Two rounds pass; all three please him.',
  controls: 'Arrows or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>',
  start(ctx) {
    const lengths = [3, 4, 5];
    let round = 0, seq = [], pos = 0, mode = 'show', showIndex = -1, showUntil = 0, cleared = 0, done = false, timer = 0;
    const lit = { up: 0, right: 0, down: 0, left: 0 };
    const pad = document.createElement('div'); pad.className = 'np-pad'; ctx.controls.append(pad);
    const padButtons = {};
    for (const dir of DIRECTIONS) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.dir = dir; b.textContent = ARROW[dir]; b.setAttribute('aria-label', `Swell from ${dir}`);
      b.addEventListener('click', () => press(dir), { signal: ctx.signal }); pad.append(b); padButtons[dir] = b;
    }
    const setPad = enabled => Object.values(padButtons).forEach(b => { b.disabled = !enabled; });
    function startRound() {
      seq = makeSequence(ctx.rng, lengths[round]); pos = 0; mode = 'show'; showIndex = -1; setPad(false);
      ctx.say(`Round ${round + 1}: watch ${seq.length} waves.`);
      let i = 0;
      const step = () => {
        if (done) return;
        if (i >= seq.length) { showIndex = -1; mode = 'answer'; setPad(true); ctx.say(`Round ${round + 1}: your turn, ${seq.length} waves.`); return; }
        showIndex = i; lit[seq[i]] = 1; showUntil = performance.now() + 520; i++;
        timer = setTimeout(step, 760);
      };
      timer = setTimeout(step, 900);
    }
    function press(dir) {
      if (done || mode !== 'answer') return;
      lit[dir] = 1;
      if (dir !== seq[pos]) {
        mode = 'wrong'; done = true; setPad(false);
        ctx.say(`Wave ${pos + 1} came from ${seq[pos]}, not ${dir}.`);
        setTimeout(() => ctx.finish({ passed: cleared >= 2, bonus: 0, headline: `${cleared} of 3 rounds`, note: `Wave ${pos + 1} of round ${round + 1} came from the ${seq[pos]}.` }), 1300);
        return;
      }
      pos++;
      if (pos >= seq.length) {
        cleared++; mode = 'show'; setPad(false);
        if (cleared >= lengths.length) {
          done = true;
          setTimeout(() => ctx.finish({ passed: true, bonus: 8, headline: 'Every wave returned', note: 'Neptune nods: the sea remembers, and so do you.' }), 900);
        } else { round++; timer = setTimeout(startRound, 900); }
      }
    }
    startRound();
    return {
      key(name, down) { const dir = KEY_DIR[name]; if (down && dir) { press(dir); return true; } return false; },
      frame(now, dt, t) {
        const g = ctx.g;
        const cx = 240, cy = 190;
        g.fillStyle = '#08202acc'; g.fillRect(cx - 200, cy - 140, 400, 280);
        label(g, `Round ${Math.min(round + 1, 3)} · ${mode === 'answer' ? `wave ${pos + 1} of ${seq.length}` : mode === 'show' ? 'watch' : ''}`, cx, cy - 118, 15, '#9fd9d0', 'center');
        for (const dir of DIRECTIONS) {
          lit[dir] = Math.max(0, lit[dir] - dt * (mode === 'show' ? 1.4 : 3));
          const a = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }[dir];
          const x = cx + Math.cos(a) * 95, y = cy + Math.sin(a) * 78;
          const glow = lit[dir];
          g.fillStyle = mix('#1d5560', '#e8b84a', glow); g.beginPath(); g.arc(x, y, 34 + glow * 8, 0, Math.PI * 2); g.fill();
          // A wave crest inside each quarter
          g.strokeStyle = glow > 0.4 ? INK : FOAM; g.lineWidth = 3; g.beginPath();
          for (let i = -18; i <= 18; i += 6) g.lineTo(x + i, y + 6 + Math.sin(i * 0.35 + t * 4) * 5 * (0.6 + glow));
          g.stroke();
          label(g, ARROW[dir], x, y - 12, 22, glow > 0.4 ? INK : FOAM, 'center', 700);
        }
        // Progress dots
        for (let i = 0; i < seq.length; i++) { g.fillStyle = i < pos || mode === 'show' && i <= showIndex ? GOLD : '#ffffff44'; g.beginPath(); g.arc(cx - (seq.length - 1) * 9 + i * 18, cy + 122, 5, 0, Math.PI * 2); g.fill(); }
      },
      cleanup() { clearTimeout(timer); },
    };
  },
};

// ---------- 4. The Wardroom Mug ----------
const mug = {
  id: 'mug', name: 'The Wardroom Mug', kicker: 'TRIAL OF THE ROLLING TABLE',
  brief: ctx => `Neptune rolls the ship far past the ${ctx.data.extremes?.rollMax ? `${ctx.data.extremes.rollMax.value.toFixed(1)}° roll and pitch RMS` : 'worst'} this leg has logged. Keep the mug on the wardroom table for ${MUG.duration} seconds: hold left or right to push it back uphill. Staying near the middle pleases him.`,
  controls: 'Hold <kbd>←</kbd> / <kbd>→</kbd>',
  start(ctx) {
    const sea = makeSea(ctx.rng, 0.42);
    let m = { x: 0, v: 0, fallen: false }, held = { left: false, right: false }, t0 = null, elapsed = 0, centred = 0, frames = 0, done = false, roll = 0;
    holdButton(ctx, 'Push left', '←', on => { held.left = on; }, { label: 'Push the mug left' });
    holdButton(ctx, 'Push right', '→', on => { held.right = on; }, { label: 'Push the mug right' });
    ctx.say(`${MUG.duration} seconds. Hold a direction to push.`);
    const end = passed => {
      done = true; ctx.controls.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const share = frames ? centred / frames : 0;
      setTimeout(() => ctx.finish({
        passed, bonus: passed && share > 0.7 ? 6 : 0,
        headline: passed ? `Held for ${MUG.duration} s` : `Overboard at ${elapsed.toFixed(1)} s`,
        note: passed ? `The mug stayed in the middle third ${Math.round(share * 100)}% of the time.` : 'Tea on the deck. Neptune drinks it anyway.',
      }), 1000);
    };
    return {
      key(name, down) {
        if (name === 'arrowleft' || name === 'a') { held.left = down; return true; }
        if (name === 'arrowright' || name === 'd') { held.right = down; return true; }
        return false;
      },
      frame(now, dt) {
        const g = ctx.g;
        if (t0 === null) t0 = now;
        if (!done) {
          elapsed = (now - t0) / 1000;
          roll = rollAt(sea, elapsed);
          const push = (held.right ? 1 : 0) - (held.left ? 1 : 0);
          m = stepMug(m, roll, push, Math.min(dt, 0.05));
          frames++; if (Math.abs(m.x) < MUG.half / 3) centred++;
          if (m.fallen) end(false);
          else if (elapsed >= MUG.duration) end(true);
          if (!done && Math.floor(elapsed) !== Math.floor(elapsed - dt)) ctx.say(`${Math.max(0, Math.ceil(MUG.duration - elapsed))} s to go.`);
        }
        // Porthole with a counter-rolling horizon, then the table and mug rolled with the ship.
        const cx = 240, cy = 200;
        g.fillStyle = '#08202acc'; g.fillRect(cx - 210, cy - 150, 420, 290);
        g.save(); g.beginPath(); g.arc(cx, cy - 78, 46, 0, Math.PI * 2); g.clip();
        g.translate(cx, cy - 78); g.rotate(-roll);
        g.fillStyle = '#7fa9b5'; g.fillRect(-80, -80, 160, 80); g.fillStyle = '#1c5b68'; g.fillRect(-80, 0, 160, 80); g.restore();
        g.strokeStyle = GOLD; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy - 78, 46, 0, Math.PI * 2); g.stroke();
        g.save(); g.translate(cx, cy + 40); g.rotate(roll);
        const tw = 340;
        g.fillStyle = '#6b4f2e'; g.fillRect(-tw / 2, 0, tw, 14);
        g.fillStyle = '#e8b84a55'; g.fillRect(-tw / 6, -2, tw / 3, 18);
        const mx = clamp(m.x / MUG.half, -1.2, 1.2) * (tw / 2);
        g.fillStyle = m.fallen ? '#f0a24c' : FOAM; g.fillRect(mx - 14, -34, 28, 34);
        g.strokeStyle = g.fillStyle; g.lineWidth = 4; g.beginPath(); g.arc(mx + 18, -18, 8, -Math.PI / 2, Math.PI / 2); g.stroke();
        g.fillStyle = '#6d4c3a'; g.fillRect(mx - 11, -31, 22, 5);
        g.restore();
        label(g, `${Math.max(0, MUG.duration - elapsed).toFixed(1)} s`, cx + 190, cy - 130, 18, GOLD, 'right');
        label(g, `roll ${(roll * 180 / Math.PI).toFixed(0)}°`, cx - 190, cy - 130, 14, '#9fd9d0');
      },
    };
  },
};

// ---------- 5. The Riddles ----------
const riddles = {
  id: 'riddles', name: 'The Riddles', kicker: 'TRIAL OF THE DEEP',
  brief: () => 'Three questions from the sea king, drawn from his own realm and this leg’s record. Answer with the numbered keys or the buttons. Two of three pass; all three please him.',
  controls: '<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>',
  start(ctx) {
    const deck = dealRiddles(ctx.rng, ctx.data, 3);
    let index = 0, correct = 0, answered = null, done = false, timer = 0;
    const box = document.createElement('div'); box.className = 'np-riddle'; ctx.controls.append(box);
    function show() {
      const r = deck[index]; answered = null;
      box.innerHTML = `<p class="np-question"><span>${index + 1} / ${deck.length}</span>${r.q}</p><div class="np-options">${r.options.map((o, i) => `<button type="button" data-option="${i}"><kbd>${i + 1}</kbd>${o}</button>`).join('')}</div><p class="np-why" data-why></p>`;
      box.querySelectorAll('[data-option]').forEach(b => b.addEventListener('click', () => answer(Number(b.dataset.option)), { signal: ctx.signal }));
      ctx.say(`Riddle ${index + 1} of ${deck.length}: ${r.q}`);
    }
    function answer(i) {
      if (done || answered !== null) return;
      const r = deck[index]; answered = i;
      const right = i === r.answer; if (right) correct++;
      box.querySelectorAll('[data-option]').forEach((b, j) => { b.disabled = true; b.classList.toggle('np-right', j === r.answer); b.classList.toggle('np-wrong', j === i && !right); });
      box.querySelector('[data-why]').textContent = `${right ? 'Yes.' : `No: ${r.options[r.answer]}.`} ${r.why}`;
      ctx.say(`${right ? 'Correct' : 'Wrong'}. ${r.why}`);
      timer = setTimeout(() => {
        index++;
        if (index < deck.length) show();
        else { done = true; ctx.finish({ passed: correct >= 2, bonus: correct === 3 ? 8 : 0, headline: `${correct} of ${deck.length} riddles`, note: correct === 3 ? 'The sea king finds no fault.' : correct >= 2 ? 'Well enough, for a mortal.' : 'The deep keeps its secrets from you.' }); }
      }, 2600);
    }
    show();
    return {
      key(name, down) { if (down && ['1', '2', '3'].includes(name)) { answer(Number(name) - 1); return true; } return false; },
      frame(now, dt, t) {
        const g = ctx.g;
        // A scroll of kelp-green parchment: the riddle text itself lives in the button strip.
        g.fillStyle = '#08202acc'; g.fillRect(40, 60, 420, 240);
        for (let i = 0; i < deck.length; i++) { g.fillStyle = i < index ? GOLD : i === index ? FOAM : '#ffffff44'; g.beginPath(); g.arc(250 - (deck.length - 1) * 18 + i * 36, 180, 12 + (i === index ? Math.sin(t * 3) * 2 : 0), 0, Math.PI * 2); g.fill(); }
        label(g, `${correct} right`, 250, 230, 16, '#9fd9d0', 'center');
        label(g, 'Answer below', 250, 130, 15, FOAM, 'center', 500);
      },
      cleanup() { clearTimeout(timer); },
    };
  },
};

export const TRIALS = [sounding, trident, swell, mug, riddles];
