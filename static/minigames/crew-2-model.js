// Survey model for the old-ice hunt. Every radar number comes from the pixels of the Sentinel-1 scene;
// floe thickness is the game's reading of those pixels, not a field measurement.

export const MAX_MARKS = 5;
export const SHIP_HOURS = 24;
export const STATION_HOURS = 3;
export const HOLES_PER_FLOE = 3;
export const HOLE_SPACING_M = 25;
export const MAX_DEPTH_CM = 400;
export const SAMPLE_RADIUS_PX = 8;

const WATER_DN = 75;
const THIN_DN = 95;
const ROUGH_SD = 20;
// Brightness range mapped onto ice age: volume scatter from the bubbly, drained upper layer of old ice
// returns more C-band energy than saline first-year ice.
const YOUNG_DN = 128;
const OLD_DN = 158;
const KM_PER_KNOT_HOUR = 1.852;

function seeded(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// gray: one brightness byte per pixel of the scene image, row-major.
export function createScene(meta, gray) {
  const [width, height] = meta.size;
  const cell = meta.land.cell_px;
  const gw = Math.floor(width / cell);
  const gh = Math.floor(height / cell);
  const land = new Uint8Array(gw * gh);
  const mean = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0;
      for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) sum += gray[y * width + x];
      mean[gy * gw + gx] = sum / (cell * cell);
      land[gy * gw + gx] = meta.land.rows[gy]?.[gx] === '1' ? 1 : 0;
    }
  }
  return { meta, gray, width, height, cell, gw, gh, land, mean, kmPerPx: meta.ground_m_per_px / 1000 };
}

export function lonLat(scene, x, y) {
  const { west, east, north, south } = scene.meta;
  return { lon: west + (east - west) * x / scene.width, lat: north + (south - north) * y / scene.height };
}

export function isLand(scene, x, y) {
  const gx = clamp(Math.floor(x / scene.cell), 0, scene.gw - 1);
  const gy = clamp(Math.floor(y / scene.cell), 0, scene.gh - 1);
  return scene.land[gy * scene.gw + gx] === 1;
}

// Mean and standard deviation of image brightness in a 400 m disc.
export function sample(scene, x, y, radius = SAMPLE_RADIUS_PX) {
  let n = 0, sum = 0, squares = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= scene.width || py >= scene.height) continue;
      const v = scene.gray[py * scene.width + px];
      n++; sum += v; squares += v * v;
    }
  }
  const mean = n ? sum / n : 0;
  return { mean, sd: n ? Math.sqrt(Math.max(0, squares / n - mean * mean)) : 0, land: isLand(scene, x, y) };
}

// What the ice party finds at a mark. kind: 'land' | 'water' | 'thin' | 'floe'.
export function floeAt(scene, x, y) {
  const radar = sample(scene, x, y);
  if (radar.land) return { kind: 'land', radar };
  if (radar.mean < WATER_DN) return { kind: 'water', radar };
  if (radar.mean < THIN_DN && radar.sd < ROUGH_SD) return { kind: 'thin', radar };
  const random = seeded(`floe:${Math.round(x / 4)}:${Math.round(y / 4)}`);
  let thickness, spread, stage;
  if (radar.sd >= ROUGH_SD) {
    // Bright because it is broken: ridge sails and block edges, not age.
    thickness = clamp(115 + (radar.sd - ROUGH_SD) * 4, 115, 230) + (random() - 0.5) * 30;
    spread = 0.7;
    stage = 'ridged first-year';
  } else {
    const age = clamp((radar.mean - YOUNG_DN) / (OLD_DN - YOUNG_DN), 0, 1);
    thickness = 85 + age * 215 + (random() - 0.5) * 24;
    stage = thickness < 150 ? 'first-year' : thickness < 205 ? 'second-year' : 'multi-year';
    spread = stage === 'first-year' ? 0.1 : stage === 'second-year' ? 0.18 : 0.28;
  }
  const old = stage === 'second-year' || stage === 'multi-year';
  const snowCm = Math.round(2 + random() * (old ? 10 : 6));
  // Hydrostatic balance: old ice is bubbly and floats higher for its thickness.
  const iceDensity = old ? 880 : 910;
  const holes = Array.from({ length: HOLES_PER_FLOE }, (_, index) => {
    const thicknessCm = Math.round(clamp(thickness * (1 + spread * (random() - 0.5)), 30, MAX_DEPTH_CM - 20));
    const freeboardCm = Math.round((thicknessCm * (1 - iceDensity / 1025) - snowCm * 320 / 1025) * 10) / 10;
    return { distanceM: index * HOLE_SPACING_M, thicknessCm, freeboardCm, depthCm: 0, measured: false };
  });
  return { kind: 'floe', radar, stage, old, snowCm, holes };
}

// Hull speed from radar brightness: 12 kn in dark open water, down to 3 kn in bright, heavy ice.
export function speedKnots(dn) {
  return dn < WATER_DN ? 12 : clamp(12 - (dn - WATER_DN) / 50 * 9, 3, 12);
}

// Least-time field from one position over the sea cells (Dijkstra on the land grid, 8-connected).
export function travelField(scene, x, y) {
  const { gw, gh, land, mean, cell, kmPerPx } = scene;
  const start = clamp(Math.floor(y / cell), 0, gh - 1) * gw + clamp(Math.floor(x / cell), 0, gw - 1);
  const hours = new Float64Array(gw * gh).fill(Infinity);
  const previous = new Int32Array(gw * gh).fill(-1);
  const heap = [[0, start]];
  hours[start] = 0;
  const push = item => {
    let i = heap.push(item) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let least = i;
        if (l < heap.length && heap[l][0] < heap[least][0]) least = l;
        if (r < heap.length && heap[r][0] < heap[least][0]) least = r;
        if (least === i) break;
        [heap[least], heap[i]] = [heap[i], heap[least]];
        i = least;
      }
    }
    return top;
  };
  while (heap.length) {
    const [time, index] = pop();
    if (time > hours[index]) continue;
    const cx = index % gw, cy = (index - cx) / gw;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const next = ny * gw + nx;
        if (land[next]) continue;
        // A diagonal may not cut the corner of a land cell.
        if (dx && dy && (land[cy * gw + nx] || land[ny * gw + cx])) continue;
        const km = Math.hypot(dx, dy) * cell * kmPerPx;
        const knots = (speedKnots(mean[index]) + speedKnots(mean[next])) / 2;
        const arrival = time + km / (knots * KM_PER_KNOT_HOUR);
        if (arrival < hours[next]) {
          hours[next] = arrival;
          previous[next] = index;
          push([arrival, next]);
        }
      }
    }
  }
  return { hours, previous, start };
}

// Route to a point from a travel field: { hours, km, path: [[x, y], ...] } in image pixels, or null when cut off by land.
export function routeTo(scene, field, x, y) {
  const { gw, gh, cell, kmPerPx } = scene;
  let index = clamp(Math.floor(y / cell), 0, gh - 1) * gw + clamp(Math.floor(x / cell), 0, gw - 1);
  if (!Number.isFinite(field.hours[index])) return null;
  const hours = field.hours[index];
  const path = [];
  while (index !== -1) {
    path.push([(index % gw + 0.5) * cell, (Math.floor(index / gw) + 0.5) * cell]);
    index = field.previous[index];
  }
  path.reverse();
  let km = 0;
  for (let i = 1; i < path.length; i++) km += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) * kmPerPx;
  return { hours, km, path };
}

export function floeMean(floe) {
  const done = floe.holes.filter(hole => hole.measured);
  return done.length ? done.reduce((sum, hole) => sum + hole.thicknessCm, 0) / done.length : null;
}

export const floeDone = floe => floe.kind === 'floe' && floe.holes.every(hole => hole.measured);

// 8 points a hole, +11 for the full three-hole line, +15 when the call from the radar holds up,
// and one bonus for the oldest ice on the books.
export function scoreSurvey(marks) {
  let points = 0;
  let best = null;
  for (const mark of marks) {
    const floe = mark.floe;
    if (!floe || floe.kind !== 'floe') continue;
    const holes = floe.holes.filter(hole => hole.measured).length;
    if (!holes) continue;
    points += holes * 8 + (floeDone(floe) ? 11 : 0);
    if (floeDone(floe) && mark.call === (floe.old ? 'old' : 'first-year')) points += 15;
    if (floe.old && floeDone(floe) && (!best || floeMean(floe) > floeMean(best.floe))) best = mark;
  }
  if (best) points += best.floe.stage === 'multi-year' ? 60 : 30;
  return { points, best };
}
