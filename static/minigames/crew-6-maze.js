// Trace-metal clean sampling: maze, physics and scoring for the Contaminants minigame.
// Positions are in cell units; a corridor is one cell wide.

export const PLAYER_R = 0.26;
export const WALL_H = 0.07; // wall half-thickness
export const SPEED = 2.8; // cells per second
export const DECKHAND_R = 0.3;
export const DECKHAND_SPEED = 1.5;
export const THRESHOLD = 100; // Tia's limit on the dirty meter
export const SIGHT = 1.9; // cells revealed around the sampler
export const RUB_RATE = 12; // dirt per second while brushing along a surface
// Two touches of the same surface within this window count as one brush.
const TOUCH_GRACE = 0.4;

export const SURFACES = {
  hull: { label: 'Painted bulkhead', element: 'Fe', dirt: 15, color: '#5f7480' },
  steel: { label: 'Container wall', element: 'Fe', dirt: 15, color: '#6b8390' },
  rust: { label: 'Rust streak', element: 'Fe · Mn', dirt: 20, color: '#a8562b' },
  paint: { label: 'Fresh antifouling', element: 'Cu', dirt: 25, color: '#c0403a' },
  grease: { label: 'Greased hydraulic line', element: 'Zn', dirt: 25, color: '#2d2a27' },
  anode: { label: 'Zinc anode', element: 'Zn', dirt: 35, color: '#d6d9d0' },
  deckhand: { label: "Deckhand's work gloves", element: 'everything', dirt: 40 },
  drip: { label: 'Hydraulic drip', element: 'Zn', dirt: 30 },
};
const WALL_MIX = [['steel', 50], ['rust', 20], ['paint', 12], ['grease', 12], ['anode', 6]];

export const KIT = [
  { id: 'coverall', label: 'Tyvek coverall' },
  { id: 'hood', label: 'Hood' },
  { id: 'booties', label: 'Boot covers' },
  { id: 'inner', label: 'Nitrile gloves' },
  { id: 'outer', label: 'Polyethylene overgloves' },
];

export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];
function weighted(random, mix) {
  let roll = random() * mix.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of mix) { roll -= w; if (roll < 0) return key; }
  return mix[0][0];
}

// h[y][x]: wall along the top edge of cell (x, y), y in 0..rows. v[y][x]: wall along the left edge, x in 0..cols.
function carve(random, cols, rows) {
  const h = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
  const v = Array.from({ length: rows }, () => Array(cols + 1).fill(true));
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[Math.floor(random() * cols), Math.floor(random() * rows)]];
  seen[stack[0][1]][stack[0][0]] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny][nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = pick(random, options);
    const nx = x + dx, ny = y + dy;
    if (dx === 1) v[y][nx] = false; else if (dx === -1) v[y][x] = false;
    else if (dy === 1) h[ny][x] = false; else h[y][x] = false;
    seen[ny][nx] = true;
    stack.push([nx, ny]);
  }
  // A few extra openings give the return leg a choice of routes.
  const internal = [];
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) if (h[y][x]) internal.push(['h', x, y]);
  for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) if (v[y][x]) internal.push(['v', x, y]);
  const extra = Math.round(internal.length * 0.1);
  for (let i = 0; i < extra; i++) {
    const [kind, x, y] = internal.splice(Math.floor(random() * internal.length), 1)[0];
    if (kind === 'h') h[y][x] = false; else v[y][x] = false;
  }
  return { h, v };
}

// Straight stretches of wall become single runs, so brushing along one bulkhead is one touch.
function runs(random, maze, cols, rows) {
  const list = [];
  const add = (x1, y1, x2, y2, outer) => list.push({ id: list.length, x1, y1, x2, y2, surface: outer ? 'hull' : weighted(random, WALL_MIX) });
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x < cols;) {
      if (!maze.h[y][x]) { x++; continue; }
      const start = x;
      while (x < cols && maze.h[y][x]) x++;
      add(start, y, x, y, y === 0 || y === rows);
    }
  }
  for (let x = 0; x <= cols; x++) {
    for (let y = 0; y < rows;) {
      if (!maze.v[y][x]) { y++; continue; }
      const start = y;
      while (y < rows && maze.v[y][x]) y++;
      add(x, start, x, y, x === 0 || x === cols);
    }
  }
  return list;
}

export function open(maze, x, y, dx, dy) {
  if (dx === 1) return !maze.v[y][x + 1];
  if (dx === -1) return !maze.v[y][x];
  if (dy === 1) return !maze.h[y + 1][x];
  return !maze.h[y][x];
}

function bfs(maze, cols, rows, sx, sy, limit = Infinity) {
  const dist = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const parent = new Map();
  const queue = [[sx, sy]];
  dist[sy][sx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (dist[y][x] >= limit) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny][nx] >= 0 || !open(maze, x, y, dx, dy)) continue;
      dist[ny][nx] = dist[y][x] + 1;
      parent.set(`${nx},${ny}`, [x, y]);
      queue.push([nx, ny]);
    }
  }
  return { dist, parent };
}

function pathTo(parent, sx, sy, tx, ty) {
  const path = [[tx, ty]];
  while (path[0][0] !== sx || path[0][1] !== sy) {
    const p = parent.get(`${path[0][0]},${path[0][1]}`);
    if (!p) return null;
    path.unshift(p);
  }
  return path;
}

export function createRun(seed, cols = 12, rows = 9) {
  const random = rng(seed);
  const maze = carve(random, cols, rows);
  const start = [pick(random, [0, cols - 1]), pick(random, [0, rows - 1])];
  const { dist, parent } = bfs(maze, cols, rows, start[0], start[1]);
  const cells = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push([x, y]);
  const maxDist = Math.max(...cells.map(([x, y]) => dist[y][x]));
  const far = [...cells.filter(([x, y]) => dist[y][x] >= maxDist * 0.35)].sort(() => random() - 0.5);
  // Kit pieces sit deep in the maze and apart from one another.
  const items = [];
  for (const spacing of [4, 3, 2, 1]) {
    for (const [x, y] of far) {
      if (items.length === KIT.length) break;
      if (items.some(i => Math.abs(i.x - x) + Math.abs(i.y - y) < spacing)) continue;
      if (Math.abs(start[0] - x) + Math.abs(start[1] - y) < spacing) continue;
      items.push({ ...KIT[items.length], x, y, found: false });
    }
    if (items.length === KIT.length) break;
  }
  const farthest = items.reduce((a, b) => (dist[b.y][b.x] > dist[a.y][a.x] ? b : a), items[0]);
  const artery = pathTo(parent, start[0], start[1], farthest.x, farthest.y) ?? [start];
  const occupied = ([x, y]) => (x === start[0] && y === start[1]) || items.some(i => i.x === x && i.y === y);
  // Hydraulic drips hang over the main corridor towards the farthest piece.
  const drips = [0.35, 0.65].map((f, i) => artery[Math.round((artery.length - 1) * f)]).filter((c, i, all) => c && !occupied(c) && all.findIndex(o => o[0] === c[0] && o[1] === c[1]) === i)
    .map(([x, y], i) => ({ x, y, period: 2.2 + random() * 0.6, fall: 0.7, phase: random() * 2, hit: false }));
  // A deckhand paces a short stretch of corridor away from the rosette.
  let deckhand = null;
  for (let attempt = 0; attempt < 30 && !deckhand; attempt++) {
    const [ax, ay] = pick(random, cells.filter(([x, y]) => dist[y][x] >= 4));
    const local = bfs(maze, cols, rows, ax, ay, 6);
    const ends = cells.filter(([x, y]) => local.dist[y][x] >= 4 && !(x === start[0] && y === start[1]));
    if (!ends.length) continue;
    const [bx, by] = pick(random, ends);
    const path = pathTo(local.parent, ax, ay, bx, by);
    if (!path || path.some(([x, y]) => x === start[0] && y === start[1])) continue;
    deckhand = { path, s: random() * (path.length - 1), dir: 1, x: ax + 0.5, y: ay + 0.5, contact: false };
    advanceDeckhand(deckhand, 0);
  }
  return {
    cols, rows, maze, runs: runs(random, maze, cols, rows), start, items, drips, deckhand,
    phase: 'search', hold: 0, elapsed: 0, searchSeconds: 0, returnSeconds: 0,
    player: { x: start[0] + 0.5, y: start[1] + 0.5, facing: 0, moving: false },
    seen: new Set(), dirty: 0, touches: [], rubDirt: 0, fails: 0, suitCell: null, contacts: new Set(), lastTouchAt: -1,
  };
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function addDirt(state, amount) {
  state.dirty = Math.min(THRESHOLD, state.dirty + amount);
}

function touch(state, key, events) {
  if (state.phase !== 'suited') return;
  const surface = SURFACES[key];
  if (state.returnSeconds - state.lastTouchAt < TOUCH_GRACE) return;
  state.lastTouchAt = state.returnSeconds;
  state.touches.push({ key, label: surface.label, element: surface.element, dirt: surface.dirt, t: state.returnSeconds });
  addDirt(state, surface.dirt);
  events.push({ type: 'touch', key, surface });
}

// Pushes the sampler out of a run and reports whether it is in contact.
function resolveRun(p, run) {
  const reach = PLAYER_R + WALL_H;
  const minX = Math.min(run.x1, run.x2), maxX = Math.max(run.x1, run.x2);
  const minY = Math.min(run.y1, run.y2), maxY = Math.max(run.y1, run.y2);
  if (p.x < minX - reach || p.x > maxX + reach || p.y < minY - reach || p.y > maxY + reach) return false;
  const qx = clamp(p.x, minX, maxX), qy = clamp(p.y, minY, maxY);
  let dx = p.x - qx, dy = p.y - qy;
  let d = Math.hypot(dx, dy);
  if (d >= reach) return false;
  if (d < 1e-6) {
    // Centre on the wall line: push along the wall normal, whichever side is closer to the cell centre.
    if (run.y1 === run.y2) { dx = 0; dy = p.y - Math.round(p.y) >= 0 ? 1 : -1; } else { dy = 0; dx = p.x - Math.round(p.x) >= 0 ? 1 : -1; }
    d = 1;
    p.x += dx / d * reach; p.y += dy / d * reach;
    return true;
  }
  p.x += dx / d * (reach - d);
  p.y += dy / d * (reach - d);
  return true;
}

function advanceDeckhand(hand, dt) {
  if (!hand) return;
  const last = hand.path.length - 1;
  hand.s += hand.dir * DECKHAND_SPEED * dt;
  if (hand.s >= last) { hand.s = last; hand.dir = -1; }
  if (hand.s <= 0) { hand.s = 0; hand.dir = 1; }
  const i = Math.min(last - 1, Math.floor(hand.s)), f = hand.s - i;
  const [ax, ay] = hand.path[i], [bx, by] = hand.path[i + 1] ?? hand.path[i];
  hand.x = ax + 0.5 + (bx - ax) * f;
  hand.y = ay + 0.5 + (by - ay) * f;
}

export function dripState(drip, elapsed) {
  const t = (elapsed + drip.phase) % drip.period;
  // The drop falls for `fall` seconds and splashes for 0.35 s after landing.
  return { falling: t < drip.fall, progress: Math.min(1, t / drip.fall), splash: t >= drip.fall && t < drip.fall + 0.35, cycle: Math.floor((elapsed + drip.phase) / drip.period) };
}

export function step(state, input, dt) {
  const events = [];
  if (state.phase === 'busted' || state.phase === 'done') return events;
  dt = Math.min(dt, 1 / 30);
  state.elapsed += dt;
  if (state.phase === 'search') state.searchSeconds += dt; else state.returnSeconds += dt;
  let dx = input.dx, dy = input.dy;
  if (state.hold > 0) { state.hold -= dt; dx = 0; dy = 0; }
  const len = Math.hypot(dx, dy);
  const p = state.player;
  p.moving = len > 0;
  if (len > 0) {
    dx /= len; dy /= len;
    p.x += dx * SPEED * dt;
    p.y += dy * SPEED * dt;
    p.facing = Math.atan2(dy, dx);
  }
  advanceDeckhand(state.deckhand, dt);
  const touching = new Set();
  for (let pass = 0; pass < 2; pass++) {
    for (const run of state.runs) if (resolveRun(p, run)) touching.add(run.id);
  }
  p.x = clamp(p.x, PLAYER_R + WALL_H, state.cols - PLAYER_R - WALL_H);
  p.y = clamp(p.y, PLAYER_R + WALL_H, state.rows - PLAYER_R - WALL_H);
  for (const id of touching) if (!state.contacts.has(id)) touch(state, state.runs[id].surface, events);
  if (touching.size && state.phase === 'suited') { addDirt(state, RUB_RATE * dt); state.rubDirt += RUB_RATE * dt; }
  state.contacts = touching;
  const hand = state.deckhand;
  if (hand) {
    const hx = p.x - hand.x, hy = p.y - hand.y, d = Math.hypot(hx, hy), reach = PLAYER_R + DECKHAND_R;
    if (d < reach) {
      const nx = d > 1e-6 ? hx / d : 1, ny = d > 1e-6 ? hy / d : 0;
      p.x += nx * (reach - d); p.y += ny * (reach - d);
      if (!hand.contact) touch(state, 'deckhand', events);
      hand.contact = true;
    } else hand.contact = false;
  }
  for (const drip of state.drips) {
    const now = dripState(drip, state.elapsed);
    if (now.splash && drip.hit !== now.cycle && Math.hypot(p.x - drip.x - 0.5, p.y - drip.y - 0.5) < 0.42) {
      drip.hit = now.cycle;
      touch(state, 'drip', events);
    }
  }
  const cx = Math.floor(p.x), cy = Math.floor(p.y);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) continue;
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= SIGHT) state.seen.add(y * state.cols + x);
  }
  if (state.phase === 'search') {
    for (const item of state.items) {
      if (item.found || Math.hypot(item.x + 0.5 - p.x, item.y + 0.5 - p.y) > 0.45) continue;
      item.found = true;
      events.push({ type: 'item', item });
      if (state.items.every(i => i.found)) {
        state.phase = 'suited';
        state.hold = 1.1;
        state.suitCell = [item.x, item.y];
        state.contacts = new Set();
        events.push({ type: 'suited' });
      }
    }
  } else if (state.phase === 'suited') {
    if (state.dirty >= THRESHOLD) {
      state.phase = 'busted';
      events.push({ type: 'busted' });
    } else if (Math.hypot(state.start[0] + 0.5 - p.x, state.start[1] + 0.5 - p.y) < 0.42) {
      state.phase = 'done';
      events.push({ type: 'arrived' });
    }
  }
  return events;
}

// Tia sends the sampler back to where the suit went on, with fresh gloves.
export function resume(state) {
  if (state.phase !== 'busted') return false;
  state.phase = 'suited';
  state.fails += 1;
  state.dirty = 0;
  state.touches = [];
  state.rubDirt = 0;
  state.contacts = new Set();
  state.lastTouchAt = -1;
  state.hold = 0.8;
  state.player.x = state.suitCell[0] + 0.5;
  state.player.y = state.suitCell[1] + 0.5;
  return true;
}

export function result(state) {
  const cleanliness = Math.max(0, Math.round(THRESHOLD - state.dirty));
  const seconds = state.searchSeconds + state.returnSeconds;
  const timeBonus = Math.round(clamp((150 - seconds) / 90, 0, 1) * 40);
  const blankBonus = state.touches.length === 0 && state.rubDirt < 1 ? 20 : 0;
  const penalty = state.fails * 15;
  const points = Math.max(0, cleanliness + timeBonus + blankBonus - penalty);
  return {
    points, cleanliness, timeBonus, blankBonus, penalty, seconds,
    detail: {
      title: blankBonus ? 'Trace-metal cast: blank-grade sample' : `Trace-metal cast: ${cleanliness}% clean`,
      cleanliness, dirty: Math.round(state.dirty), touches: state.touches.map(t => t.label), rubbing: Math.round(state.rubDirt),
      seconds: Math.round(seconds), searchSeconds: Math.round(state.searchSeconds), returnSeconds: Math.round(state.returnSeconds), fails: state.fails,
    },
  };
}
