import { casualtyFrom } from './crew-12-model.js';

export const WIDTH = 900, HEIGHT = 520;
export const VESSELS = [
  { kind: 'yacht', size: 18, iceClass: 'Unstrengthened', strength: 1, tolerance: 8 },
  { kind: 'fishing vessel', size: 24, iceClass: 'Light ice strengthening', strength: 1.2, tolerance: 10 },
  { kind: 'cruise ship', size: 34, iceClass: 'Ice class 1B', strength: 1.5, tolerance: 14 },
  { kind: 'sealift carrier', size: 42, iceClass: 'Polar Class 6', strength: 2.1, tolerance: 19 },
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function createEscort(sar, random = Math.random) {
  const casualty = casualtyFrom(sar);
  const vessel = { ...casualty, ...(VESSELS.find(v => v.kind === casualty.kind) || VESSELS[2]) };
  const maxHealth = Math.round(vessel.size * vessel.strength * 6);
  return { vessel, random, maxHealth, health: maxHealth, time: 0, spawn: .5, cooldown: 0,
    ship: { x: 110, y: 260 }, breaker: { x: 210, y: 260, heading: 0 },
    floes: [], particles: [], broken: 0, hits: 0, phase: 'ready', flash: 0, pulse: 0 };
}
export function spawnFloe(s) {
  const rand = s.random, edge = Math.floor(rand() * 4);
  const x = edge === 0 ? -45 : edge === 1 ? WIDTH + 45 : rand() * WIDTH;
  const y = edge === 2 ? -45 : edge === 3 ? HEIGHT + 45 : rand() * HEIGHT;
  const targetX = clamp(s.ship.x + 45 + rand() * 110, 110, 800), targetY = s.ship.y + (rand() - .5) * 100;
  const angle = Math.atan2(targetY - y, targetX - x), speed = 35 + rand() * 25 + s.time * .35;
  s.floes.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: 23 + rand() * 29, angle: rand() * 6.28, spin: (rand() - .5) * .6, grace: 0 });
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
export function stepEscort(s, dt, input = {}) {
  if (s.phase !== 'running') return;
  dt = clamp(dt, 0, .04);
  s.time += dt; s.cooldown = Math.max(0, s.cooldown - dt);
  s.flash = Math.max(0, s.flash - dt); s.pulse = Math.max(0, s.pulse - dt);
  s.ship.x = 110 + 680 * Math.min(1, s.time / 65);
  s.ship.y = 260 + Math.sin(s.time / 65 * Math.PI * 2) * 50;
  let dx = input.x || 0, dy = input.y || 0;
  if (!dx && !dy && input.target) {
    dx = input.target.x - s.breaker.x; dy = input.target.y - s.breaker.y;
    if (Math.hypot(dx, dy) < 5) dx = dy = 0;
  }
  const distance = Math.hypot(dx, dy);
  if (distance) {
    const travel = Math.min(300 * dt, input.target && !input.x && !input.y ? distance : Infinity);
    s.breaker.x = clamp(s.breaker.x + dx / distance * travel, 18, WIDTH - 18);
    s.breaker.y = clamp(s.breaker.y + dy / distance * travel, 18, HEIGHT - 18);
    s.breaker.heading = Math.atan2(dy, dx);
  }
  const ram = input.ram && s.cooldown === 0;
  if (ram) { s.cooldown = 2.6; s.pulse = .35; }
  s.spawn -= dt;
  if (s.spawn <= 0) { spawnFloe(s); s.spawn = Math.max(.48, 1.15 - s.time * .009); }
  const moving = s.floes; s.floes = [];
  for (const floe of moving) {
    floe.x += floe.vx * dt; floe.y += floe.vy * dt; floe.angle += floe.spin * dt; floe.grace -= dt;
    if (floe.x < -150 || floe.x > WIDTH + 150 || floe.y < -150 || floe.y > HEIGHT + 150) continue;
    const danger = floe.r > s.vessel.tolerance;
    if (danger && floe.grace <= 0 && Math.hypot(floe.x - s.breaker.x, floe.y - s.breaker.y) < floe.r + (ram ? 82 : 22)) {
      fracture(s, floe); continue;
    }
    if (Math.hypot(floe.x - s.ship.x, floe.y - s.ship.y) < floe.r + s.vessel.size * .55) {
      if (danger) { s.health = Math.max(0, s.health - Math.ceil((floe.r - s.vessel.tolerance) * .9)); s.hits++; s.flash = .3; }
      continue;
    }
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
