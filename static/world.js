// The open world: GEBCO elevation, the OSM and Natural Earth shore, GeoNames places and the CIS ice charts on
// one polar stereographic grid over the sector 0-180 W, 50-90 N (built by tools/pull_world.py). Positions are in
// cell units: u runs east from the left edge, v runs south from the top edge, and cell (c, r) has its centre at
// (c + .5, r + .5).
const DATA = new URL('./data/world/', import.meta.url);
// An ice station needs a floe to stand on: open drift (4/10) or more.
export const ICE_STATION_MIN = 40;
// Communities with a fuel supply and a charted approach on this grid; the ship bunkers at their berth. Where
// several places share a name (Clyde River on Baffin Island and on Prince Edward Island) the most populous is the port.
export const BUNKER_PORTS = [
  // Canadian Arctic Archipelago and the Beaufort coast
  'Arctic Bay', 'Cambridge Bay', 'Clyde River', 'Gjoa Haven', 'Grise Fiord', 'Igloolik', 'Kugaaruk', 'Kugluktuk', 'Paulatuk', 'Pond Inlet',
  'Qikiqtarjuaq', 'Resolute', 'Sachs Harbour', 'Sanirajak', 'Tuktoyaktuk', 'Ulukhaktok',
  // Baffin Island south, Hudson Strait, Hudson Bay and Ungava
  'Arviat', 'Chesterfield Inlet', 'Churchill', 'Coral Harbour', 'Inukjuak', 'Iqaluit', 'Kimmirut', 'Kinngait', 'Kuujjuarapik',
  'Naujaat', 'Pangnirtung', 'Puvirnituq', 'Rankin Inlet', 'Salluit', 'Sanikiluaq', 'Whale Cove',
  // Labrador and Newfoundland (Nain, Goose Bay and Kuujjuaq lie up channels the 3 km grid closes)
  'Cartwright', 'Hopedale', 'Makkovik', "St. John's",
  // Greenland
  'Aasiaat', 'Dundas', 'Ilulissat', 'Ittoqqortoormiit', 'Kullorsuaq', 'Maniitsoq', 'Nanortalik', 'Nuuk', 'Paamiut', 'Qaanaaq',
  'Qaqortoq', 'Qeqertarsuaq', 'Sisimiut', 'Tasiilaq', 'Upernavik', 'Uummannaq',
  // Pacific coast
  'Prince Rupert',
];
const SQRT2 = Math.SQRT2;

function projection(p, grid) {
  const e = Math.sqrt(2 * p.f - p.f * p.f), rad = Math.PI / 180;
  const tOf = phi => { const s = Math.sin(phi); return Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2); };
  const phiC = p.latTs * rad, scale = p.a * Math.cos(phiC) / Math.sqrt(1 - (e * Math.sin(phiC)) ** 2) / tOf(phiC);
  return {
    // WGS84 polar stereographic, north aspect (Snyder 21-33, 21-34); the same formulas as tools/pull_world.py.
    project(lon, lat) {
      const rho = scale * tOf(lat * rad), lam = (lon - p.lon0) * rad;
      return { u: (rho * Math.sin(lam) - grid.xmin) / grid.resolution, v: (grid.ymax + rho * Math.cos(lam)) / grid.resolution };
    },
    unproject(u, v) {
      const x = grid.xmin + u * grid.resolution, y = grid.ymax - v * grid.resolution, t = Math.hypot(x, y) / scale;
      let phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 6; i++) { const s = Math.sin(phi); phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - e * s) / (1 + e * s)) ** (e / 2)); }
      return { lon: p.lon0 + Math.atan2(x, -y) / rad, lat: phi / rad };
    },
    // Distance from the pole to a parallel, in cells: parallels are circles about the pole, meridians are its rays.
    parallelRadius: lat => scale * tOf(lat * rad) / grid.resolution,
    pole: { u: -grid.xmin / grid.resolution, v: grid.ymax / grid.resolution },
  };
}

export function createWorld(meta, layers) {
  const { cols, rows } = meta.grid, size = cols * rows, km = meta.grid.resolution / 1000;
  const { elevation, iceConcentration, iceClass, glacier } = layers;
  const sign = new Int8Array(size), coast = new Uint8Array(size);
  for (let i = 0; i < size; i++) sign[i] = elevation[i] > 0 ? 1 : -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (sign[i] > 0) continue;
    for (let dr = -1; dr <= 1 && !coast[i]; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && sign[rr * cols + cc] > 0) { coast[i] = 1; break; }
    }
  }
  const proj = projection(meta.projection, meta.grid);
  const clampC = c => c < 0 ? 0 : c >= cols ? cols - 1 : c, clampR = r => r < 0 ? 0 : r >= rows ? rows - 1 : r;
  const index = (u, v) => clampR(Math.floor(v)) * cols + clampC(Math.floor(u));
  // The shore is the zero line of the bilinearly interpolated land sign, so it runs smoothly between cell
  // centres and a channel one cell wide stays open. The chart is drawn from the same function.
  function shore(u, v) {
    const fu = u - .5, fv = v - .5, c0 = Math.floor(fu), r0 = Math.floor(fv), a = fu - c0, b = fv - r0;
    const ca = clampC(c0), cb = clampC(c0 + 1), ra = clampR(r0) * cols, rb = clampR(r0 + 1) * cols;
    return (sign[ra + ca] * (1 - a) + sign[ra + cb] * a) * (1 - b) + (sign[rb + ca] * (1 - a) + sign[rb + cb] * a) * b;
  }
  const isLand = (u, v) => shore(u, v) > 0;
  function lineClear(u0, v0, u1, v1, limit = 0) {
    const steps = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) * 4));
    for (let i = 0; i <= steps; i++) if (shore(u0 + (u1 - u0) * i / steps, v0 + (v1 - v0) * i / steps) > limit) return false;
    return true;
  }
  // The last point of a straight run that still has water under it, held a little short of the shore.
  function lastClear(u0, v0, u1, v1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) * 4));
    let best = { u: u0, v: v0 };
    for (let i = 1; i <= steps; i++) {
      const u = u0 + (u1 - u0) * i / steps, v = v0 + (v1 - v0) * i / steps;
      if (shore(u, v) > -.5) break;
      best = { u, v };
    }
    return best;
  }
  function seaRoom(u, v, radius = 2.5) {
    if (shore(u, v) > -.999) return false;
    for (let k = 0; k < 8; k++) if (shore(u + Math.cos(k * Math.PI / 4) * radius, v + Math.sin(k * Math.PI / 4) * radius) > -.5) return false;
    return true;
  }
  function ice(u, v) {
    const i = index(u, v), percent = iceConcentration[i];
    if (percent === 255 || sign[i] > 0) return null;
    const kind = meta.ice.classes[iceClass[i]] ?? meta.ice.classes[0];
    return { percent, tenths: percent / 10, stage: kind.stage, form: kind.form };
  }
  // Share of open-water speed the ship keeps: an icebreaker is slowed by the pack, never stopped. `hull` scales
  // the slowdown (1 as built, less with an ice-strengthened hull).
  const iceSpeed = (percent, hull = 1) => percent === 255 ? 1 : 1 - .65 * hull * (percent / 100) ** 1.3;

  // A* over water cells. Diagonal steps need both orthogonal neighbours afloat, so the polyline of cell centres
  // never touches the shore function. Cells against the coast and cells in ice cost more, which keeps the
  // route mid-channel and out of the pack when there is a way round.
  const gScore = new Float64Array(size), cameFrom = new Int32Array(size), stamp = new Uint32Array(size);
  let generation = 0;
  function search(start, goal) {
    generation++;
    const heapNode = [], heapCost = [], gc = goal % cols, gr = Math.floor(goal / cols);
    const push = (node, cost) => {
      let i = heapNode.length; heapNode.push(node); heapCost.push(cost);
      while (i > 0) { const parent = (i - 1) >> 1; if (heapCost[parent] <= cost) break; heapNode[i] = heapNode[parent]; heapCost[i] = heapCost[parent]; i = parent; }
      heapNode[i] = node; heapCost[i] = cost;
    };
    const pop = () => {
      const top = heapNode[0], node = heapNode.pop(), cost = heapCost.pop(), n = heapNode.length;
      if (n) { let i = 0; for (;;) { let child = 2 * i + 1; if (child >= n) break; if (child + 1 < n && heapCost[child + 1] < heapCost[child]) child++; if (heapCost[child] >= cost) break; heapNode[i] = heapNode[child]; heapCost[i] = heapCost[child]; i = child; } heapNode[i] = node; heapCost[i] = cost; }
      return top;
    };
    gScore[start] = 0; stamp[start] = generation; cameFrom[start] = -1; push(start, 0);
    while (heapNode.length) {
      const node = pop();
      if (node === goal) { const cells = []; for (let n = goal; n !== -1; n = cameFrom[n]) cells.push(n); return cells.reverse(); }
      const c = node % cols, r = (node - c) / cols, g = gScore[node];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
        const next = rr * cols + cc;
        if (sign[next] > 0 || (dr && dc && (sign[r * cols + cc] > 0 || sign[rr * cols + c] > 0))) continue;
        const cost = g + (dr && dc ? SQRT2 : 1) * (coast[next] ? 2.2 : 1) * (2.2 - 1.2 * iceSpeed(iceConcentration[next]));
        // Equal-cost paths summed in a different order differ by rounding only; treating that as an improvement would re-expand the grid endlessly.
        if (stamp[next] === generation && gScore[next] <= cost + 1e-6) continue;
        gScore[next] = cost; stamp[next] = generation; cameFrom[next] = node;
        const du = Math.abs(cc - gc), dv = Math.abs(rr - gr);
        push(next, cost + Math.max(du, dv) + (SQRT2 - 1) * Math.min(du, dv));
      }
    }
    return null;
  }
  function nearestWater(u, v, reach = 8) {
    const c0 = clampC(Math.floor(u)), r0 = clampR(Math.floor(v));
    let best = -1, bestDistance = Infinity;
    for (let r = Math.max(0, r0 - reach); r <= Math.min(rows - 1, r0 + reach); r++) for (let c = Math.max(0, c0 - reach); c <= Math.min(cols - 1, c0 + reach); c++) {
      const d = Math.hypot(c + .5 - u, r + .5 - v);
      if (sign[r * cols + c] < 0 && d < bestDistance) { best = r * cols + c; bestDistance = d; }
    }
    return best;
  }
  // Waypoints from the ship to the chosen spot that never cross land. `complete` is false when the ship can
  // only hold short of the coast on the straight line (no sea route, or the spot is deep inland).
  function route(from, to) {
    const held = () => { const end = lastClear(from.u, from.v, to.u, to.v); return { points: Math.hypot(end.u - from.u, end.v - from.v) > .3 ? [end] : [], complete: false }; };
    const goal = isLand(to.u, to.v) || sign[index(to.u, to.v)] > 0 ? nearestWater(to.u, to.v) : index(to.u, to.v);
    if (goal < 0) return held();
    if (lineClear(from.u, from.v, to.u, to.v, -.5)) return { points: [{ u: to.u, v: to.v }], complete: true };
    let start = -1, startDistance = Infinity;
    for (const [dc, dr] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = Math.floor(from.u) + dc, r = Math.floor(from.v) + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows || sign[r * cols + c] > 0 || !lineClear(from.u, from.v, c + .5, r + .5)) continue;
      const d = Math.hypot(c + .5 - to.u, r + .5 - to.v);
      if (d < startDistance) { start = r * cols + c; startDistance = d; }
    }
    const cells = start < 0 ? null : search(start, goal);
    if (!cells) return held();
    const path = cells.map(n => ({ u: n % cols + .5, v: Math.floor(n / cols) + .5 }));
    if (!isLand(to.u, to.v) && lineClear(path.at(-1).u, path.at(-1).v, to.u, to.v, -.5)) path.push({ u: to.u, v: to.v });
    // String-pull the cell path into long straight legs that stay clear of the shore.
    const points = []; let anchor = { u: from.u, v: from.v }, i = 0;
    while (i < path.length) {
      let j = i;
      while (j + 1 < path.length && lineClear(anchor.u, anchor.v, path[j + 1].u, path[j + 1].v, -.5)) j++;
      points.push(path[j]); anchor = path[j]; i = j + 1;
    }
    return { points, complete: true };
  }

  const places = meta.places.map(place => ({ ...place, ...proj.project(place.lon, place.lat) }));
  function nearestPlace(u, v, withinKm = 150) {
    let best = null, bestDistance = withinKm / km;
    for (const place of places) { const d = Math.hypot(place.u - u, place.v - v); if (d < bestDistance) { best = place; bestDistance = d; } }
    return best;
  }
  // The nearest water with sea room to a community: where a ship lies to bunker.
  function berth(u, v, reach = 10) {
    let best = null, bestDistance = Infinity;
    for (let r = Math.max(0, Math.floor(v) - reach); r <= Math.min(rows - 1, Math.floor(v) + reach); r++) for (let c = Math.max(0, Math.floor(u) - reach); c <= Math.min(cols - 1, Math.floor(u) + reach); c++) {
      const d = Math.hypot(c + .5 - u, r + .5 - v);
      if (d < bestDistance && sign[r * cols + c] < 0 && seaRoom(c + .5, r + .5)) { best = { u: c + .5, v: r + .5 }; bestDistance = d; }
    }
    return best;
  }
  const ports = BUNKER_PORTS.map(name => places.filter(place => place.name === name).sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0))[0])
    .filter(Boolean).map(place => ({ ...place, berth: berth(place.u, place.v) })).filter(place => place.berth);
  const start = proj.project(meta.start.lon, meta.start.lat);
  return {
    meta, cols, rows, km, elevation, sign, iceConcentration, iceClass, glacier, places, ports, ...proj,
    start: { x: start.u / cols, y: start.v / rows },
    shipTrack: meta.shipTrack.lonLat.map(([lon, lat]) => proj.project(lon, lat)),
    chartDate: meta.ice.charts.map(chart => chart.date).filter(Boolean).sort().at(-1) ?? '',
    shore, isLand, lineClear, lastClear, seaRoom, ice, iceSpeed, route, nearestPlace,
    depth: (u, v) => Math.max(0, -elevation[index(u, v)]),
    // Screen angle of true north at a position: the direction of the pole.
    northAngle: (u, v) => Math.atan2(proj.pole.v - v, proj.pole.u - u),
    // Fog cells that hold any water: the part of the chart a ship can be expected to reveal.
    seaFog(fogCols, fogRows) {
      const sea = new Uint8Array(fogCols * fogRows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (sign[r * cols + c] < 0) sea[Math.floor(r * fogRows / rows) * fogCols + Math.floor(c * fogCols / cols)] = 1;
      return sea;
    },
  };
}

async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;       // already unpacked by the transport
  if (typeof DecompressionStream !== 'function') throw Error('This browser cannot unpack the chart; a current Chrome, Firefox or Safari can.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadWorld(base = DATA) {
  const get = async name => { const response = await fetch(new URL(name, base)); if (!response.ok) throw Error(`Chart data missing: ${name}`); return response; };
  const meta = await (await get('world.json')).json();
  const raw = await gunzip(new Uint8Array(await (await get(meta.data.file)).arrayBuffer()));
  if (raw.byteLength !== meta.data.rawBytes) throw Error('Chart data does not match its index');
  const layers = {};
  for (const layer of meta.data.layers) {
    const bytes = raw.slice(layer.offset, layer.offset + layer.bytes);
    if (layer.dtype === 'int16') {
      const view = new DataView(bytes.buffer), grid = new Int16Array(layer.bytes / 2), { cols } = meta.grid;
      for (let i = 0; i < grid.length; i++) grid[i] = view.getInt16(i * 2, true);
      // Rows are stored as differences from the cell to the west; Int16 wrap-around undoes the packer's.
      if (layer.encoding === 'row-delta') for (let i = 0; i < grid.length; i++) if (i % cols) grid[i] += grid[i - 1];
      layers[layer.name] = grid;
    } else layers[layer.name] = bytes;
  }
  return createWorld(meta, layers);
}
