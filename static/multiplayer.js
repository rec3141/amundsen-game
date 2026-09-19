// Live fleet on the main chart. Every open chart reports its own ship to the relay at api/fleet about once a second and
// draws the ships it gets back; the relay carries a display name, a fleet ship id, a chart position and a heading, and
// hails between ships. Ships within MEET_KM of each other have met: either can challenge the other to a face-off (both
// play the same operation at once and the higher score takes a DUEL_BONUS) or throw a snowball. Nothing received here
// moves the local ship, its chart or its fuel; only a settled face-off touches the score, through the shell's own log.
// The public mirror never contacts the relay. Without a relay the chart is single-player and says so.
import { publicMirror } from './site.js';
import { FLEET, DEFAULT_SHIP, shipById, nextShip as nextInFleet, shipLabel } from './fleet.js';
import { drawShip } from './sprites.js';

const $ = s => document.querySelector(s);
// Reports go out POLL_MS after the last reply; a failed relay is retried every RETRY_MS, a refused report after
// REFUSED_MS. A ship whose report is older than the relay's ttl has left the chart. Choices live in localStorage;
// the session id lives in sessionStorage, so every tab is its own ship and a reload keeps the same one.
const POLL_MS = 1000, RETRY_MS = 5000, REFUSED_MS = 2500, FULL_MS = 30000, TIMEOUT_MS = 4000, HAIL_GAP_MS = 450;
// Ships within MEET_KM have met. A challenge or an offer lapses after OFFER_MS; a round that cannot open within
// LAUNCH_MS of the accept withdraws the face-off; a face-off whose opponent's result has not arrived RESULT_MS after
// the player's own is void. A snowball flies for SNOWBALL_MS and splats for SPLAT_MS.
export const MEET_KM = 15, DUEL_BONUS = 25;
const OFFER_MS = 60000, LAUNCH_MS = 120000, RESULT_MS = 600000, SNOWBALL_MS = 1100, SPLAT_MS = 900;
const SESSION_KEY = 'amundsen-fleet-session', SHIP_KEY = 'amundsen-fleet-ship', SHARE_KEY = 'amundsen-fleet-share';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); } catch {} };
let world = null, own = () => null, sailTo = () => {}, toast = () => {}, play = () => false, award = () => {}, jolt = () => {};
let session = '', ship = DEFAULT_SHIP, share = true, started = false, games = [];
// Everyone else at sea, by public id: the reported position and the one shown, which slides to it over a poll.
const others = new Map();
let timer = null, online = null, ttl = 15, fullUntil = 0, listStamp = 0, reportedAt = 0, polling = false;
// Hails wait in `outbox`, one going out with each report. `duel` is the face-off in hand: sent and unanswered,
// playing (launched or not, own and opponent's results as they come in), then settled. `offer` is a challenge
// received and not yet answered. Snowballs in flight, and each ship's tally of snowballs landed and taken.
const outbox = [], snowballs = [], tally = new Map();
let duel = null, offer = null;
let sharingVersion = 0;

function hex(n) {
  const bytes = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes); else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
const newSession = () => hex(16), newDuel = () => hex(8);
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
// Range to another ship in km, and the ships within hail, nearest first.
function rangeTo(p) { const me = own(); return me ? Math.hypot((p.x - me.x) * world.cols, (p.y - me.y) * world.rows) * world.km : Infinity; }
const met = () => [...others.values()].map(p => ({ p, km: rangeTo(p) })).filter(m => m.km <= MEET_KM).sort((a, b) => a.km - b.km);
const nearest = () => met()[0]?.p ?? null;
const nameOf = p => shipLabel(p.name, p.ship);
function updateList() {
  const list = $('#fleet-list'), me = own(); if (!list || !me) return;
  if ($('#fleet-status')) $('#fleet-status').textContent = status();
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedShip = focused?.closest('li')?.dataset.ship, focusedAction = focused?.dataset.action;
  list.replaceChildren();
  const su = me.x * world.cols, sv = me.y * world.rows;
  for (const p of [...others.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const item = document.createElement('li'), swatch = document.createElement('i'), copy = document.createElement('span'), name = document.createElement('b'), where = document.createElement('small'), go = document.createElement('button');
    const s = shipById(p.ship), u = p.x * world.cols, v = p.y * world.rows, km = Math.hypot(u - su, v - sv) * world.km, t = tally.get(p.id);
    item.dataset.ship = p.id;
    swatch.style.background = s.tint; name.textContent = nameOf(p);
    where.textContent = `${s.country} · ${Math.round(km)} km ${bearing(su, sv, u, v)}${km <= MEET_KM ? ' · within hail' : ''}${p.stale ? ' · no report lately' : ''}${t ? ` · snowballs ${t.landed} landed, ${t.taken} taken` : ''}`;
    go.dataset.action = 'steam';
    go.type = 'button'; go.className = 'secondary'; go.textContent = 'Steam to'; go.setAttribute('aria-label', `Steam towards ${name.textContent}`);
    go.onclick = () => { sailTo(u, v); $('#ocean')?.focus(); };
    copy.append(name, where); item.append(swatch, copy);
    if (km <= MEET_KM && share) {
      const face = document.createElement('button'), snow = document.createElement('button');
      face.dataset.action = 'face'; snow.dataset.action = 'snow';
      face.type = snow.type = 'button'; face.className = snow.className = 'secondary'; face.textContent = 'Face off'; snow.textContent = 'Snowball';
      face.setAttribute('aria-label', `Challenge ${name.textContent} to a face-off`); snow.setAttribute('aria-label', `Throw a snowball at ${name.textContent}`);
      face.onclick = () => { faceOff(p.id); $('#ocean')?.focus(); }; snow.onclick = () => { snowball(p.id); $('#ocean')?.focus(); };
      item.append(face, snow);
    }
    item.append(go); list.append(item);
    if (p.id === focusedShip) item.querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  }
  updateMeet();
}
// The meeting panel: who is within hail, the challenge in hand or the offer waiting, and what 6, 7 and 8 do now.
function updateMeet() {
  const status = $('#meet-status'), face = $('#face-off'), snow = $('#snowball'), decline = $('#decline'); if (!status) return;
  const now = performance.now(), near = nearest(), game = id => games.find(g => g.id === id)?.title ?? id;
  let text, faceLabel = '6 · Face off', declineLabel = '', faceOn = true;
  if (!share) { text = 'Your ship is off the fleet’s charts · show it to hail another ship'; faceOn = false; }
  else if (offer) { text = `${offer.name} challenges you · ${game(offer.game)} · ${Math.max(0, Math.ceil((offer.at + OFFER_MS - now) / 1000))} s to answer`; faceLabel = '6 · Accept'; declineLabel = '8 · Decline'; }
  else if (duel?.stage === 'sent') { text = `Challenge sent to ${duel.name} · ${game(duel.game)} · waiting for her answer`; faceOn = false; declineLabel = '8 · Withdraw'; }
  else if (duel) { text = `Face-off with ${duel.name} · ${game(duel.game)} · ${duel.mine === null ? (duel.launched ? 'your round is open' : 'opening your round') : `your ${duel.mine} points · waiting for ${duel.name}’s`}`; faceOn = false; }
  else if (near) text = `${nameOf(near)} within hail · ${Math.round(rangeTo(near))} km · 6 challenges her, 7 throws a snowball`;
  else text = `No ship within ${MEET_KM} km · steam alongside another icebreaker to hail her`;
  status.textContent = text;
  if (face) { face.textContent = faceLabel; face.disabled = !faceOn; }
  if (snow) snow.disabled = !share || !near;
  if (decline) { decline.hidden = !declineLabel; decline.textContent = declineLabel; }
  if ($('#duel-game')) $('#duel-game').disabled = !!(offer || duel);
}

// One report, then the next is scheduled; the reply replaces the picture of the fleet. Sharing off means a read-only
// poll, so a player who keeps their ship to themselves still sees the others.
function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }
async function poll() {
  if (polling) return;
  const me = own(); if (!me) { schedule(POLL_MS); return; }
  polling = true;
  const version = sharingVersion;
  const sharing = share && fullUntil <= performance.now();
  const body = { session, name: playerName(), ship, x: Math.min(1, Math.max(0, me.x)), y: Math.min(1, Math.max(0, me.y)), heading: Math.max(-7, Math.min(7, Number.isFinite(me.heading) ? me.heading : 0)) };
  if (sharing && outbox.length) body.hail = outbox[0];
  let wait = POLL_MS;
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    if (sharing) reportedAt = performance.now();
    const response = sharing ? await fetch('api/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
      : await fetch(`api/fleet?session=${session}`, { signal });
    if (response.status === 503) { fullUntil = performance.now() + FULL_MS; online = true; }
    else if (response.status === 429) { wait = REFUSED_MS; online = true; }
    else if (!response.ok) throw Error(`relay answered ${response.status}`);
    else {
      const data = await response.json();
      if (version !== sharingVersion) return;
      if (Number.isFinite(data?.ttl)) ttl = data.ttl;
      apply(Array.isArray(data?.players) ? data.players : []);
      if (body.hail && outbox[0] === body.hail) { outbox.shift(); if (data?.delivered === false) undelivered(body.hail); }
      tick();
      receive(Array.isArray(data?.mail) ? data.mail : []);
      if (online !== true) { online = true; if (others.size) toast(`Fleet · ${others.size} other ship${others.size === 1 ? '' : 's'} on the chart.`); }
    }
  } catch { if (online !== false) others.clear(); online = false; wait = RETRY_MS; }
  finally {
    polling = false; tick(); updateList();
    schedule(outbox.length && share && wait === POLL_MS ? HAIL_GAP_MS : wait);
  }
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

// Hails. One goes out per report; a queued hail brings the next report forward to the relay's minimum interval.
function hail(message) { if (!share) return; outbox.push(message); if (!polling) schedule(Math.max(0, HAIL_GAP_MS - (performance.now() - reportedAt))); }
function undelivered(h) {
  if ((h.kind === 'challenge' || h.kind === 'accept') && duel?.id === h.duel) { toast(`${duel.name} is no longer on the chart · face-off dropped.`); duel = null; }
}
const gameById = id => games.find(g => g.id === id) ?? null;
const validHail = m => m && typeof m.from === 'string' && /^[0-9a-f]{1,16}$/.test(m.from) && typeof m.kind === 'string' && typeof m.name === 'string' && typeof m.ship === 'string';
function receive(mail) {
  const now = performance.now();
  for (const m of mail) {
    if (!validHail(m)) continue;
    if (!share) continue;
    const who = shipLabel(m.name.slice(0, 40), m.ship), id = typeof m.duel === 'string' ? m.duel.slice(0, 16) : '';
    if (m.kind === 'challenge') {
      if ((offer?.id === id && offer.from === m.from) || (duel?.id === id && duel.with === m.from)) continue;
      const game = gameById(m.game);
      if (!game || duel || offer || !others.has(m.from) || rangeTo(others.get(m.from)) > MEET_KM) { hail({ to: m.from, kind: 'decline', duel: id }); continue; }
      offer = { id, from: m.from, name: who, ship: m.ship, game: game.id, at: now };
      toast(`${who} hails you · face off in ${game.title}, most points wins ${DUEL_BONUS} · 6 accepts, 8 declines.`, true);
    } else if (m.kind === 'accept') {
      if (duel?.id !== id || duel.stage !== 'sent' || duel.with !== m.from) continue;
      duel.stage = 'playing'; duel.at = now; toast(`${who} accepts · ${gameById(duel.game)?.title ?? duel.game} · most points wins ${DUEL_BONUS}. Your round opens when the chart is ready.`, true); launch();
    } else if (m.kind === 'decline') {
      if (offer?.id === id && offer.from === m.from) { offer = null; toast(`${who} withdrew the challenge.`); continue; }
      if (duel?.id !== id || duel.with !== m.from) continue;
      toast(duel.stage === 'sent' ? `${who} declines the face-off.` : `${who} has withdrawn · face-off void${duel.mine === null ? '' : ', your round’s points stand'}.`);
      duel = null;
    } else if (m.kind === 'result') {
      if (duel?.id !== id || duel.stage !== 'playing' || duel.with !== m.from || duel.theirs !== null || !Number.isFinite(m.points) || m.points < 0) continue;
      duel.theirs = Math.floor(m.points); if (duel.mine === null) toast(`${who} banked ${duel.theirs} points · your round decides it.`); settle();
    } else if (m.kind === 'snowball') {
      const from = others.get(m.from), me = own();
      const origin = from ? position(from, now) : { x: me.x + .002, y: me.y };
      snowballs.push({ from: { x: origin.x, y: origin.y }, to: m.from, mine: false, name: who, start: now, hit: false });
      const t = tally.get(m.from) ?? { landed: 0, taken: 0 }; t.taken++; tally.set(m.from, t);
    }
  }
  updateMeet();
}
// Lapses and retries, once a poll: an unanswered offer or challenge, a face-off with no result from the other side,
// a round that could not open while another operation was in progress.
function tick() {
  const now = performance.now();
  if (offer && now - offer.at > OFFER_MS) { hail({ to: offer.from, kind: 'decline', duel: offer.id }); toast(`${offer.name}’s challenge lapsed.`); offer = null; }
  if (duel?.stage === 'sent' && now - duel.at > OFFER_MS) { hail({ to: duel.with, kind: 'decline', duel: duel.id }); toast(`No answer from ${duel.name} · challenge withdrawn.`); duel = null; }
  if (duel?.stage === 'playing' && duel.mine !== null && duel.theirs === null && now - duel.scoredAt > RESULT_MS) { hail({ to: duel.with, kind: 'decline', duel: duel.id }); toast(`No result from ${duel.name} · face-off void.`, true); duel = null; }
  if (duel?.stage === 'playing' && !duel.launched) {
    if (now - duel.at > LAUNCH_MS) { hail({ to: duel.with, kind: 'decline', duel: duel.id }); toast(`The round could not open · face-off with ${duel.name} withdrawn.`, true); duel = null; }
    else launch();
  }
}
function launch() {
  if (!duel || duel.launched) return;
  duel.launched = !!play(duel.game, { id: duel.id, opponent: duel.name });
}
// Only the operation opened for this face-off may supply its result.
function scored(gameId, points, duelId) {
  if (!duel?.launched || duel.id !== duelId || duel.game !== gameId || duel.mine !== null) return;
  duel.mine = Math.max(0, Math.floor(Number.isFinite(points) ? points : 0)); duel.scoredAt = performance.now();
  hail({ to: duel.with, kind: 'result', duel: duel.id, points: duel.mine });
  settle(); updateMeet();
}
// A round closed without a result counts as none.
function closed() {
  if (!duel?.launched || duel.mine !== null) return;
  toast(`Round closed without a result · your face-off score is 0.`, true);
  scored(duel.game, 0, duel.id);
}
function settle() {
  if (!duel || duel.mine === null || duel.theirs === null) return;
  const d = duel, game = gameById(d.game)?.title ?? d.game; duel = null;
  if (d.mine > d.theirs) { award(DUEL_BONUS, `Face-off won · ${game} · ${d.mine} to ${d.theirs} against ${d.name}`); toast(`Face-off won · ${d.mine} to ${d.theirs} against ${d.name} · +${DUEL_BONUS} science points.`, true); }
  else if (d.mine < d.theirs) { award(0, `Face-off lost · ${game} · ${d.mine} to ${d.theirs} against ${d.name}`); toast(`Face-off lost · ${d.mine} to ${d.theirs} against ${d.name} · nothing lost, the round’s points stand.`, true); }
  else { award(0, `Face-off drawn · ${game} · ${d.mine} all against ${d.name}`); toast(`Face-off drawn · ${d.mine} all against ${d.name}.`, true); }
}
// 6: challenge the nearest ship within hail (or `id`), or accept the offer in hand. The operation comes from the
// panel's picker; both ships play it at once and the higher banked score takes the bonus.
function faceOff(id = null) {
  if (!started) return;
  tick();
  if (offer) { accept(); return; }
  if (duel) { toast(duel.stage === 'sent' ? `Waiting for ${duel.name} to answer · 8 withdraws.` : `Face-off with ${duel.name} in progress.`); return; }
  if (!share) { toast('Show your ship to the fleet to hail another ship.'); return; }
  const target = id ? others.get(id) : nearest();
  if (!target || rangeTo(target) > MEET_KM) { toast(`No ship within ${MEET_KM} km · steam alongside another icebreaker to hail her.`); return; }
  const game = gameById($('#duel-game')?.value) ?? games[0]; if (!game) return;
  duel = { id: newDuel(), with: target.id, name: nameOf(target), game: game.id, stage: 'sent', launched: false, mine: null, theirs: null, at: performance.now(), scoredAt: 0 };
  hail({ to: target.id, kind: 'challenge', duel: duel.id, game: game.id });
  toast(`Hailing ${duel.name} · face off in ${game.title} · she has ${OFFER_MS / 1000} s to answer.`); updateMeet();
}
function accept() {
  if (!offer || !share) return;
  duel = { id: offer.id, with: offer.from, name: offer.name, game: offer.game, stage: 'playing', launched: false, mine: null, theirs: null, at: performance.now(), scoredAt: 0 }; offer = null;
  hail({ to: duel.with, kind: 'accept', duel: duel.id });
  toast(`Face-off accepted · ${gameById(duel.game)?.title ?? duel.game} · most points wins ${DUEL_BONUS}.`); launch(); updateMeet();
}
// 8: decline the offer in hand, or withdraw a challenge that has not been answered or played.
function decline() {
  if (!started) return;
  if (offer) { hail({ to: offer.from, kind: 'decline', duel: offer.id }); toast(`Declined · ${offer.name} sails on.`); offer = null; }
  else if (duel && duel.mine === null && !duel.launched) { hail({ to: duel.with, kind: 'decline', duel: duel.id }); toast(duel.stage === 'sent' ? 'Challenge withdrawn.' : 'Face-off withdrawn.'); duel = null; }
  else if (duel) toast(`Your round is open · finish it, or close it to concede.`);
  updateMeet();
}
// 7: a snowball at the nearest ship within hail (or `id`); one in the air at a time.
function snowball(id = null) {
  if (!started) return;
  if (!share) { toast('Show your ship to the fleet before starting a snowball fight.'); return; }
  const target = id ? others.get(id) : nearest(), me = own();
  if (!target || !me || rangeTo(target) > MEET_KM) { toast(`No ship within ${MEET_KM} km · a snowball needs someone alongside.`); return; }
  if (outbox.some(h => h.kind === 'snowball')) { toast('Packing the next one…'); return; }
  hail({ to: target.id, kind: 'snowball' });
  snowballs.push({ from: { x: me.x, y: me.y }, to: target.id, mine: true, name: nameOf(target), start: performance.now(), hit: false });
  const t = tally.get(target.id) ?? { landed: 0, taken: 0 }; t.landed++; tally.set(target.id, t);
  toast(`Snowball away at ${nameOf(target)}!`);
}
// Snowballs on the chart: a lob from thrower to target with a splat on arrival; an incoming one jolts the bridge.
function drawSnowballs(ctx, toX, toY, px, now) {
  const me = own();
  for (const s of [...snowballs]) {
    const t = Math.min(1, (now - s.start) / SNOWBALL_MS), target = s.mine ? others.get(s.to) : null;
    const end = s.mine ? (target ? position(target, now) : s.from) : me;
    if (!end) { snowballs.splice(snowballs.indexOf(s), 1); continue; }
    const x0 = toX(s.from.x * world.cols), y0 = toY(s.from.y * world.rows), x1 = toX(end.x * world.cols), y1 = toY(end.y * world.rows);
    if (t >= 1 && !s.hit) { s.hit = true; s.at = now; if (!s.mine) { jolt(); toast(`Snowball from ${s.name} · splat across the bridge windows!`); } }
    ctx.save();
    if (!s.hit) {
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 28 * px;
      ctx.fillStyle = '#f6f1e4'; ctx.strokeStyle = '#3b4a55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 3 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      const age = (now - s.at) / SPLAT_MS;
      if (age >= 1) { snowballs.splice(snowballs.indexOf(s), 1); ctx.restore(); continue; }
      ctx.globalAlpha = 1 - age; ctx.fillStyle = '#f6f1e4'; ctx.strokeStyle = '#3b4a55'; ctx.lineWidth = .8;
      for (let n = 0; n < 7; n++) { const a = n * Math.PI * 2 / 7 + .4, r = (4 + n % 3 * 3) * px * (1 + age); ctx.beginPath(); ctx.arc(x1 + Math.cos(a) * r, y1 + Math.sin(a) * r, (2.4 - n % 3 * .5) * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x1, y1, 4 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
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
    const near = rangeTo(p) <= MEET_KM;
    ctx.strokeStyle = s.tint; ctx.lineWidth = near ? 2.5 : 1.5; ctx.setLineDash(near ? [] : [3, 3]); ctx.beginPath(); ctx.arc(x, y, 13 * px + 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    blit(ctx, frame(s.tint, at.heading, px), x, y, px);
    label(ctx, shipLabel(p.name, p.ship), x + 14 * px, y - 12 * px, s.tint, 'bold 12px sans-serif');
    ctx.restore();
  }
  const me = own();
  if (me && ship !== DEFAULT_SHIP) blit(ctx, frame(ownShip().tint, me.heading, px), toX(me.x * world.cols), toY(me.y * world.rows), px);
  if (snowballs.length) drawSnowballs(ctx, toX, toY, px, now);
  if (now - listStamp > POLL_MS) { listStamp = now; updateList(); }
}
// Fleet ships on the minimap: a dot per ship in her tint.
function drawMini(ctx, m) {
  if (!world) return;
  const now = performance.now();
  for (const p of others.values()) { const at = position(p, now); ctx.fillStyle = shipById(p.ship).tint; ctx.beginPath(); ctx.arc(m.x + at.x * m.w, m.y + at.y * m.h, 2.2, 0, Math.PI * 2); ctx.fill(); }
}

function leave(hail = null) {
  if (!started || !share || !session) return;
  const body = JSON.stringify({ session, leave: true, ...(hail?.kind ? { hail } : {}) });
  try { if (navigator.sendBeacon) navigator.sendBeacon('api/fleet', new Blob([body], { type: 'application/json' })); else fetch('api/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch {}
}
function setShare(on) {
  if (share === on) return;
  sharingVersion++;
  if (!on) {
    if (duel || offer) toast('Fleet sharing ended · face-off withdrawn.');
    leave(duel ? { to: duel.with, kind: 'decline', duel: duel.id } : offer ? { to: offer.from, kind: 'decline', duel: offer.id } : null);
    duel = null; offer = null; outbox.length = 0;
  }
  share = on; write(localStorage, SHARE_KEY, on ? '1' : '0');
  toast(on ? 'Your ship is back on the fleet’s charts.' : 'Your ship is off the fleet’s charts · you still see theirs.');
  updateList(); schedule(0);
}
// `world` places ships; `ship()` gives the player's own position and heading in chart fractions and chart radians;
// `sailTo(u, v)` is the chart's own routing, used by the list's Steam to buttons; `toast` speaks to the player.
// `games` lists the operations a face-off can be played in; `play(id, duel)` opens one and says whether it did;
// `award(points, title)` writes a settled face-off to the log; `jolt()` rocks the chart when a snowball lands.
function start(hooks) {
  world = hooks.world; own = hooks.ship ?? own; sailTo = hooks.sailTo ?? sailTo; toast = hooks.toast ?? toast;
  games = Array.isArray(hooks.games) ? hooks.games : games; play = hooks.play ?? play; award = hooks.award ?? award; jolt = hooks.jolt ?? jolt;
  ship = FLEET.some(s => s.id === read(localStorage, SHIP_KEY)) ? read(localStorage, SHIP_KEY) : DEFAULT_SHIP;
  if (publicMirror) { if ($('#fleet')) $('#fleet').hidden = true; showVessel(); return; }
  if (started) return; started = true;
  session = read(sessionStorage, SESSION_KEY); if (!session || !/^[0-9a-f]{32}$/.test(session)) { session = newSession(); write(sessionStorage, SESSION_KEY, session); }
  share = read(localStorage, SHARE_KEY) !== '0';
  buildPicker(); showVessel(); buildGames();
  if ($('#fleet-share')) { $('#fleet-share').checked = share; $('#fleet-share').onchange = e => setShare(e.target.checked); }
  if ($('#fleet-toggle')) $('#fleet-toggle').onclick = () => toggleFleet();
  if ($('#fleet-next')) $('#fleet-next').onclick = () => { nextShip(); $('#ocean')?.focus(); };
  if ($('#face-off')) $('#face-off').onclick = () => { faceOff(); $('#ocean')?.focus(); };
  if ($('#snowball')) $('#snowball').onclick = () => { snowball(); $('#ocean')?.focus(); };
  if ($('#decline')) $('#decline').onclick = () => { decline(); $('#ocean')?.focus(); };
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  updateList(); schedule(0);
}
// The face-off picker offers every operation the shell allows, Rival Researchers first when it is among them.
function buildGames() {
  const select = $('#duel-game'); if (!select) return;
  select.replaceChildren();
  for (const g of [...games].sort((a, b) => (a.id === 'rivals' ? -1 : b.id === 'rivals' ? 1 : 0))) { const option = document.createElement('option'); option.value = g.id; option.textContent = g.title; select.append(option); }
}
export const multiplayer = { start, draw, drawMini, toggleFleet, nextShip, chooseShip, faceOff, decline, snowball, scored, closed, ship: () => ownShip(), others: () => [...others.values()], duel: () => duel };
