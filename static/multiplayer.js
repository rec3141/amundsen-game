// Live fleet on the main chart. Every open chart reports its own ship to the relay at api/fleet about once a second and
// draws the ships it gets back; the relay carries a display name, a fleet ship id, a chart position and a heading, and
// nothing else. Other players are scenery: nothing received here touches the local voyage, its chart, fuel or score.
// The public mirror never contacts the relay. Without a relay the chart is single-player and says so.
import { publicMirror } from './site.js';
import { FLEET, DEFAULT_SHIP, shipById, nextShip as nextInFleet, shipLabel } from './fleet.js';
import { drawShip } from './sprites.js';

const $ = s => document.querySelector(s);
// Reports go out POLL_MS after the last reply; a failed relay is retried every RETRY_MS, a refused report after
// REFUSED_MS. A ship whose report is older than the relay's ttl has left the chart. Choices live in localStorage;
// the session id lives in sessionStorage, so every tab is its own ship and a reload keeps the same one.
const POLL_MS = 1000, RETRY_MS = 5000, REFUSED_MS = 2500, FULL_MS = 30000, TIMEOUT_MS = 4000;
const SESSION_KEY = 'amundsen-fleet-session', SHIP_KEY = 'amundsen-fleet-ship', SHARE_KEY = 'amundsen-fleet-share';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); } catch {} };
let world = null, own = () => null, sailTo = () => {}, toast = () => {};
let session = '', ship = DEFAULT_SHIP, share = true, started = false;
// Everyone else at sea, by public id: the reported position and the one shown, which slides to it over a poll.
const others = new Map();
let timer = null, online = null, ttl = 15, fullUntil = 0, listStamp = 0;

function newSession() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
const playerName = () => ($('#player-name')?.value ?? read(localStorage, 'amundsen-crew-name') ?? '').trim().slice(0, 40);
const ownShip = () => shipById(ship);

// The ship card names the chosen vessel; the picker marks it.
function showVessel() {
  const s = ownShip();
  if ($('#vessel-name')) $('#vessel-name').textContent = s.name;
  if ($('#vessel-note')) $('#vessel-note').textContent = `${s.role} · ${s.operator} · ${s.country}`;
  for (const button of document.querySelectorAll('#fleet-picker button')) button.setAttribute('aria-pressed', String(button.dataset.ship === ship));
}
function chooseShip(id, quiet = false) {
  if (!FLEET.some(s => s.id === id) || id === ship) return;
  ship = id; write(localStorage, SHIP_KEY, id); showVessel();
  if (!quiet) toast(`${ownShip().name} · ${ownShip().operator} · the fleet sees her on their charts.`);
}
function buildPicker() {
  const picker = $('#fleet-picker'); if (!picker) return;
  for (const s of FLEET) {
    const button = document.createElement('button'), swatch = document.createElement('i'), copy = document.createElement('span'), name = document.createElement('b'), note = document.createElement('small');
    button.type = 'button'; button.className = 'fleet-ship'; button.dataset.ship = s.id; swatch.style.background = s.tint;
    name.textContent = s.name; note.textContent = `${s.country} · ${s.operator}`;
    copy.append(name, note); button.append(swatch, copy); button.onclick = () => { chooseShip(s.id); toggleFleet(false); $('#ocean')?.focus(); };
    picker.append(button);
  }
}
function toggleFleet(open = !!$('#fleet-picker')?.hidden) {
  const picker = $('#fleet-picker'); if (!picker) return;
  picker.hidden = !open; $('#fleet-toggle')?.setAttribute('aria-expanded', String(open));
  if (open) picker.querySelector('[aria-pressed="true"]')?.focus();
}
function nextShip() { chooseShip(nextInFleet(ship).id); }

// Status in plain words, and the list of who is at sea with range and bearing from the ship.
function status() {
  const n = others.size, ships = `${n} other ship${n === 1 ? '' : 's'} at sea`;
  if (online === null) return 'Finding the fleet relay…';
  if (!online) return 'Fleet relay unreachable · sailing solo, retrying';
  if (fullUntil > performance.now()) return `Fleet chart full · watching ${ships}`;
  if (!share) return `${ships} · your ship is not shown`;
  return n ? ships : 'You are the only ship at sea';
}
function bearing(u0, v0, u1, v1) { const a = Math.atan2(v1 - v0, u1 - u0) - world.northAngle(u0, v0), deg = ((a * 180 / Math.PI) % 360 + 360) % 360; return COMPASS[Math.round(deg / 45) % 8]; }
function updateList() {
  const list = $('#fleet-list'), me = own(); if (!list || !me) return;
  if ($('#fleet-status')) $('#fleet-status').textContent = status();
  list.replaceChildren();
  const su = me.x * world.cols, sv = me.y * world.rows;
  for (const p of [...others.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const item = document.createElement('li'), swatch = document.createElement('i'), copy = document.createElement('span'), name = document.createElement('b'), where = document.createElement('small'), go = document.createElement('button');
    const s = shipById(p.ship), u = p.x * world.cols, v = p.y * world.rows, km = Math.hypot(u - su, v - sv) * world.km;
    swatch.style.background = s.tint; name.textContent = shipLabel(p.name, p.ship);
    where.textContent = `${s.country} · ${Math.round(km)} km ${bearing(su, sv, u, v)}${p.stale ? ' · no report lately' : ''}`;
    go.type = 'button'; go.className = 'secondary'; go.textContent = 'Steam to'; go.setAttribute('aria-label', `Steam towards ${name.textContent}`);
    go.onclick = () => { sailTo(u, v); $('#ocean')?.focus(); };
    copy.append(name, where); item.append(swatch, copy, go); list.append(item);
  }
}

// One report, then the next is scheduled; the reply replaces the picture of the fleet. Sharing off means a read-only
// poll, so a player who keeps their ship to themselves still sees the others.
function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }
async function poll() {
  if (document.hidden) { schedule(POLL_MS); return; }
  const me = own(); if (!me) { schedule(POLL_MS); return; }
  const sharing = share && fullUntil <= performance.now();
  const body = { session, name: playerName(), ship, x: Math.min(1, Math.max(0, me.x)), y: Math.min(1, Math.max(0, me.y)), heading: Math.max(-7, Math.min(7, Number.isFinite(me.heading) ? me.heading : 0)) };
  let wait = POLL_MS;
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    const response = sharing ? await fetch('api/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
      : await fetch(`api/fleet?session=${session}`, { signal });
    if (response.status === 503) { fullUntil = performance.now() + FULL_MS; online = true; }
    else if (response.status === 429) { wait = REFUSED_MS; online = true; }
    else if (!response.ok) throw Error(`relay answered ${response.status}`);
    else { const data = await response.json(); if (Number.isFinite(data?.ttl)) ttl = data.ttl; apply(Array.isArray(data?.players) ? data.players : []); if (online !== true) { online = true; if (others.size) toast(`Fleet · ${others.size} other ship${others.size === 1 ? '' : 's'} on the chart.`); } }
  } catch { if (online !== false) others.clear(); online = false; wait = RETRY_MS; }
  updateList(); schedule(wait);
}
const valid = p => p && typeof p.id === 'string' && /^[0-9a-f]{1,16}$/.test(p.id) && typeof p.ship === 'string' && typeof p.name === 'string' && [p.x, p.y, p.heading].every(Number.isFinite) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
function apply(players) {
  const now = performance.now(), seen = new Set();
  for (const p of players) {
    if (!valid(p) || p.id === undefined) continue;
    seen.add(p.id);
    const known = others.get(p.id), shown = known ? position(known, now) : { x: p.x, y: p.y, heading: p.heading };
    others.set(p.id, { id: p.id, name: p.name.slice(0, 40), ship: p.ship, x: p.x, y: p.y, heading: p.heading, from: shown, at: now, stale: Number.isFinite(p.age) && p.age > ttl / 2 });
  }
  for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
}
// Where a ship is drawn: sliding from where she was shown to her last report over one poll interval.
function position(p, now) {
  const t = Math.min(1, (now - p.at) / POLL_MS), turn = ((p.heading - p.from.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return { x: p.from.x + (p.x - p.from.x) * t, y: p.from.y + (p.y - p.from.y) * t, heading: p.from.heading + turn * t };
}

// A ship of the fleet is the chart's ship sprite washed with her tint, cached per tint, heading and pixel size.
const frames = new Map(), DIRECTIONS = 16;
function frame(tint, angle, px) {
  const dir = ((Math.round(angle / (Math.PI * 2 / DIRECTIONS)) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS, key = `${tint}/${dir}/${px}`;
  let done = frames.get(key); if (done) return done;
  const size = 96 * px, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); drawShip(g, size / 2, size / 2, dir * Math.PI * 2 / DIRECTIONS, px);
  g.globalCompositeOperation = 'source-atop'; g.globalAlpha = .55; g.fillStyle = tint; g.fillRect(0, 0, size, size);
  frames.set(key, c); return c;
}
function blit(ctx, image, x, y, px) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, Math.round(x - 48 * px), Math.round(y - 48 * px)); ctx.restore(); }
function label(ctx, text, x, y, colour, font) { ctx.font = font; ctx.lineWidth = 3; ctx.strokeStyle = '#ddcca7cc'; ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y); }
// Called by the chart after it has drawn the player's own ship: the fleet, each ringed and named in her tint, then the
// player's own hull washed in the tint of the chosen ship when it is not the default.
function draw(ctx, { toX, toY, px, width, height }) {
  if (!world) return;
  const now = performance.now();
  for (const p of others.values()) {
    const at = position(p, now), x = toX(at.x * world.cols), y = toY(at.y * world.rows);
    if (x < -60 || x > width + 60 || y < -60 || y > height + 60) continue;
    const s = shipById(p.ship);
    ctx.save(); ctx.globalAlpha = p.stale ? .55 : 1;
    ctx.strokeStyle = s.tint; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 13 * px + 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    blit(ctx, frame(s.tint, at.heading, px), x, y, px);
    label(ctx, shipLabel(p.name, p.ship), x + 14 * px, y - 12 * px, s.tint, 'bold 12px sans-serif');
    ctx.restore();
  }
  const me = own();
  if (me && ship !== DEFAULT_SHIP) blit(ctx, frame(ownShip().tint, me.heading, px), toX(me.x * world.cols), toY(me.y * world.rows), px);
  if (now - listStamp > POLL_MS) { listStamp = now; updateList(); }
}
// Fleet ships on the minimap: a dot per ship in her tint.
function drawMini(ctx, m) {
  if (!world) return;
  const now = performance.now();
  for (const p of others.values()) { const at = position(p, now); ctx.fillStyle = shipById(p.ship).tint; ctx.beginPath(); ctx.arc(m.x + at.x * m.w, m.y + at.y * m.h, 2.2, 0, Math.PI * 2); ctx.fill(); }
}

function leave() {
  if (!started || !share || !session) return;
  const body = JSON.stringify({ session, leave: true });
  try { if (navigator.sendBeacon) navigator.sendBeacon('api/fleet', new Blob([body], { type: 'application/json' })); else fetch('api/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch {}
}
function setShare(on) {
  if (share === on) return;
  if (!on) leave();
  share = on; write(localStorage, SHARE_KEY, on ? '1' : '0');
  toast(on ? 'Your ship is back on the fleet’s charts.' : 'Your ship is off the fleet’s charts · you still see theirs.');
  updateList(); schedule(0);
}
// `world` places ships; `ship()` gives the player's own position and heading in chart fractions and chart radians;
// `sailTo(u, v)` is the chart's own routing, used by the list's Steam to buttons; `toast` speaks to the player.
function start(hooks) {
  world = hooks.world; own = hooks.ship ?? own; sailTo = hooks.sailTo ?? sailTo; toast = hooks.toast ?? toast;
  ship = FLEET.some(s => s.id === read(localStorage, SHIP_KEY)) ? read(localStorage, SHIP_KEY) : DEFAULT_SHIP;
  if (publicMirror) { if ($('#fleet')) $('#fleet').hidden = true; showVessel(); return; }
  if (started) return; started = true;
  session = read(sessionStorage, SESSION_KEY); if (!session || !/^[0-9a-f]{32}$/.test(session)) { session = newSession(); write(sessionStorage, SESSION_KEY, session); }
  share = read(localStorage, SHARE_KEY) !== '0';
  buildPicker(); showVessel();
  if ($('#fleet-share')) { $('#fleet-share').checked = share; $('#fleet-share').onchange = e => setShare(e.target.checked); }
  if ($('#fleet-toggle')) $('#fleet-toggle').onclick = () => toggleFleet();
  if ($('#fleet-next')) $('#fleet-next').onclick = () => { nextShip(); $('#ocean')?.focus(); };
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  updateList(); schedule(0);
}
export const multiplayer = { start, draw, drawMini, toggleFleet, nextShip, chooseShip, ship: () => ownShip(), others: () => [...others.values()] };
