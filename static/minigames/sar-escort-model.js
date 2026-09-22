import { casualtyFrom } from './crew-12-model.js';

export const WIDTH = 900, HEIGHT = 520;
export const BREAKER_SIZE = 25, BOW_HALF_ANGLE = Math.PI / 2, RAM_REACH = 90;
export const VESSELS = [
  { kind: 'yacht', size: 18, iceClass: 'Unstrengthened', strength: 1, tolerance: 8 },
  { kind: 'fishing vessel', size: 24, iceClass: 'Light ice strengthening', strength: 1.2, tolerance: 10 },
  { kind: 'cruise ship', size: 34, iceClass: 'Ice class 1B', strength: 1.5, tolerance: 14 },
  { kind: 'sealift carrier', size: 42, iceClass: 'Polar Class 6', strength: 2.1, tolerance: 19 },
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function escortPosition(route, progress) {
  const t = clamp(progress, 0, 1), curve = Math.sin(t * Math.PI) * route.bend;
  const dx = route.b.x - route.a.x, dy = route.b.y - route.a.y, length = Math.hypot(dx, dy);
  const nx = -dy / length, ny = dx / length, turn = Math.cos(t * Math.PI) * Math.PI * route.bend;
  return { x: route.a.x + dx * t + nx * curve, y: route.a.y + dy * t + ny * curve,
    heading: Math.atan2(dy + ny * turn, dx + nx * turn) };
}
export const DRIFT_HOLD_S = 15, DRIFT_TURN_S = 4;
export function driftHeading(s) {
  const cycle = DRIFT_HOLD_S + DRIFT_TURN_S;
  const leg = Math.min(s.drift.headings.length - 1, Math.floor(s.time / cycle));
  const from = s.drift.headings[leg], to = s.drift.headings[leg + 1] ?? from;
  const t = clamp((s.time % cycle - DRIFT_HOLD_S) / DRIFT_TURN_S, 0, 1);
  return from + (to - from) * t * t * (3 - 2 * t);
}
export function iceDrift(s, x = WIDTH / 2, y = HEIGHT / 2) {
  const angle = driftHeading(s);
  const speed = 42 + Math.sin(s.time / 11 + s.drift.phase) * 7 + s.time * .1;
  return { x: Math.cos(angle) * speed + Math.sin(y / 180 + s.time / 14) * 5,
    y: Math.sin(angle) * speed + Math.sin(x / 240 + s.time / 18) * 5 };
}
export function createEscort(sar, random = Math.random) {
  const casualty = casualtyFrom(sar);
  const vessel = { ...casualty, ...(VESSELS.find(v => v.kind === casualty.kind) || VESSELS[2]) };
  const maxHealth = Math.round(vessel.size * vessel.strength * 6);
  const angle = random() * Math.PI * 2;
  const route = { a: { x: 450 - Math.cos(angle) * 340, y: 260 - Math.sin(angle) * 150 },
    b: { x: 450 + Math.cos(angle) * 340, y: 260 + Math.sin(angle) * 150 }, bend: (random() - .5) * 130 };
  const ship = escortPosition(route, 0);
  // Sustained headings carry fragments across the field before the pack makes its next broad turn.
  const headings = [random() * Math.PI * 2];
  for (let i = 0; i < 3; i++) headings.push(headings.at(-1) + (random() < .5 ? -1 : 1) * (Math.PI / 3 + random() * Math.PI * 4 / 9));
  const s = { vessel, random, maxHealth, health: maxHealth, time: 0, spawn: .5, cooldown: 0,
    drift: { headings, phase: random() * Math.PI * 2 },
    route, ship, breaker: { x: ship.x + Math.cos(ship.heading) * 85, y: ship.y + Math.sin(ship.heading) * 85, heading: ship.heading },
    floes: [], particles: [], broken: 0, hits: 0, phase: 'ready', flash: 0, pulse: 0 };
  // Leave manoeuvring room at departure; the surrounding pack is already drifting.
  for (let i = 0; i < 32; i++) {
    const x = random() * WIDTH, y = random() * HEIGHT;
    if (Math.hypot(x - ship.x, y - ship.y) > 125 && Math.hypot(x - s.breaker.x, y - s.breaker.y) > 70) addFloe(s, x, y);
  }
  return s;
}
function addFloe(s, x, y) {
  const rand = s.random, flow = iceDrift(s, x, y), slip = .9 + rand() * .2;
  s.floes.push({ x, y, vx: flow.x * slip, vy: flow.y * slip, slip,
    r: 23 + rand() * 29, angle: rand() * 6.28, spin: (rand() - .5) * .6, grace: 0 });
}
export function spawnFloe(s) {
  const flow = iceDrift(s), across = Math.abs(flow.x) * HEIGHT, along = Math.abs(flow.y) * WIDTH;
  // Upstream edge arrivals follow pack flux, independent of the casualty's course or position.
  const side = s.random() * (across + along) < across;
  addFloe(s, side ? (flow.x > 0 ? -55 : WIDTH + 55) : s.random() * WIDTH,
    side ? s.random() * HEIGHT : (flow.y > 0 ? -55 : HEIGHT + 55));
}
function fracture(s, floe) {
  s.broken++;
  const angle = Math.atan2(floe.y - s.breaker.y, floe.x - s.breaker.x) + Math.PI / 2;
  const r = floe.r / Math.sqrt(2);
  for (const sign of [-1, 1]) {
    const dx = Math.cos(angle) * sign, dy = Math.sin(angle) * sign;
    s.floes.push({ ...floe, r, x: floe.x + dx * r * .65, y: floe.y + dy * r * .65,
      vx: floe.vx + dx * 18, vy: floe.vy + dy * 18, grace: .18 });
  }
  for (let i = 0; i < 7; i++) {
    const a = s.random() * Math.PI * 2;
    s.particles.push({ x: floe.x, y: floe.y, vx: Math.cos(a) * 65, vy: Math.sin(a) * 65, life: .45 });
  }
}
export function bowHitsFloe(breaker, floe, ram = false) {
  const dx = floe.x - breaker.x, dy = floe.y - breaker.y;
  const forward = dx * Math.cos(breaker.heading) + dy * Math.sin(breaker.heading);
  if (forward < -1e-9) return false;
  return Math.hypot(dx, dy) < floe.r + (ram ? RAM_REACH : BREAKER_SIZE + 9);
}
function separateShips(s) {
  // Circumscribed hull radii keep both painted hulls apart at every heading.
  const clearance = Math.hypot(BREAKER_SIZE, BREAKER_SIZE * .4) + s.vessel.size * Math.hypot(1, .4) + 3;
  const dx = s.breaker.x - s.ship.x, dy = s.breaker.y - s.ship.y, distance = Math.hypot(dx, dy);
  if (distance >= clearance) return;
  const angle = distance > 1e-6 ? Math.atan2(dy, dx) : s.ship.heading + Math.PI / 2;
  s.breaker.x = s.ship.x + Math.cos(angle) * clearance;
  s.breaker.y = s.ship.y + Math.sin(angle) * clearance;
}
export function stepEscort(s, dt, input = {}) {
  if (s.phase !== 'running') return;
  dt = clamp(dt, 0, .04);
  s.time += dt; s.cooldown = Math.max(0, s.cooldown - dt);
  s.flash = Math.max(0, s.flash - dt); s.pulse = Math.max(0, s.pulse - dt);
  Object.assign(s.ship, escortPosition(s.route, s.time / 65));
  let dx = input.x || 0, dy = input.y || 0;
  if (!dx && !dy && input.target) {
    dx = input.target.x - s.breaker.x; dy = input.target.y - s.breaker.y;
    if (Math.hypot(dx, dy) < 5) dx = dy = 0;
  }
  const distance = Math.hypot(dx, dy);
  if (distance) {
    const travel = Math.min(300 * dt, input.target && !input.x && !input.y ? distance : Infinity);
    s.breaker.x = clamp(s.breaker.x + dx / distance * travel, 27, WIDTH - 27);
    s.breaker.y = clamp(s.breaker.y + dy / distance * travel, 27, HEIGHT - 27);
    s.breaker.heading = Math.atan2(dy, dx);
  }
  separateShips(s);
  const ram = input.ram && s.cooldown === 0;
  if (ram) { s.cooldown = 2.6; s.pulse = .35; }
  s.spawn -= dt;
  if (s.spawn <= 0) {
    spawnFloe(s);
    const flow = iceDrift(s), flux = Math.abs(flow.x) * HEIGHT + Math.abs(flow.y) * WIDTH;
    s.spawn = WIDTH * HEIGHT / (flux * (32 + s.time * .24));
  }
  const moving = s.floes; s.floes = [];
  for (const floe of moving) {
    const flow = iceDrift(s, floe.x, floe.y), follow = 1 - Math.exp(-dt * 1.8);
    floe.vx += (flow.x * floe.slip - floe.vx) * follow;
    floe.vy += (flow.y * floe.slip - floe.vy) * follow;
    floe.x += floe.vx * dt; floe.y += floe.vy * dt; floe.angle += floe.spin * dt; floe.grace -= dt;
    if (floe.x < -150 || floe.x > WIDTH + 150 || floe.y < -150 || floe.y > HEIGHT + 150) continue;
    const danger = floe.r > s.vessel.tolerance;
    if (danger && floe.grace <= 0 && bowHitsFloe(s.breaker, floe, ram)) {
      fracture(s, floe); continue;
    }
    const hullDistance = Math.hypot(floe.x - s.ship.x, floe.y - s.ship.y), contactRadius = floe.r + s.vessel.size * .55;
    // Floes remain in the drift after impact. A continuous contact deals damage once;
    // separation clears the contact, with a small margin to avoid edge chatter.
    if (hullDistance < contactRadius) {
      if (danger && !floe.contact) { s.health = Math.max(0, s.health - Math.ceil((floe.r - s.vessel.tolerance) * .9)); s.hits++; s.flash = .3; }
      floe.contact = true;
    } else if (hullDistance > contactRadius + 6) floe.contact = false;
    s.floes.push(floe);
  }
  for (const p of s.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  s.particles = s.particles.filter(p => p.life > 0);
  if (s.health <= 0) s.phase = 'lost';
  else if (s.time >= 65) s.phase = 'won';
}
export function escortScore(s) {
  return s.phase === 'won' ? 200 + Math.round(s.health / s.maxHealth * 200) : 0;
}
