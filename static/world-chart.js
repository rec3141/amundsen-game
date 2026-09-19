// Draws the chart from the grid on demand: shaded land relief, glaciers, sea ice, the shore and, where the seabed has
// been mapped, bathymetry. The world is never painted whole at screen size: the view is covered by TILE-pixel tiles
// rendered at the current zoom and kept in a small cache, so the coast is drawn at device resolution at every zoom and
// the chart costs the same memory whatever the grid's size. The shore drawn here is world.shore()'s zero line, the
// same line that stops the ship.
export const TILE = 256;
const MAX_TILES = 240;

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const SEA_STOPS = [[0, '#78b7b9'], [50, '#569fa7'], [200, '#36808d'], [500, '#236777'], [1000, '#195364'], [2500, '#113e4f'], [4000, '#0c2e3d']].map(([v, c]) => [v, hex(c)]);
const LAND_STOPS = [[0, '#8fa189'], [150, '#a3ae90'], [400, '#b8b697'], [800, '#c9c0a3'], [1400, '#d9d2bd'], [2400, '#efece2']].map(([v, c]) => [v, hex(c)]);
// 256-entry colour table indexed by sqrt(value / top), which spends the entries on shelves and lowlands.
function table(stops, top) {
  const colours = new Uint8Array(256 * 3), at = value => Math.min(255, Math.round(Math.sqrt(Math.max(0, value) / top) * 255)) * 3;
  for (let i = 0; i < 256; i++) {
    const value = (i / 255) ** 2 * top;
    let k = 0; while (k < stops.length - 2 && value > stops[k + 1][0]) k++;
    const [v0, c0] = stops[k], [v1, c1] = stops[k + 1], t = Math.max(0, Math.min(1, (value - v0) / (v1 - v0)));
    for (let j = 0; j < 3; j++) colours[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * t;
  }
  return { colours, at };
}
const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// Light from the north-west over each cell as a signed byte (127 = full light); land relief is exaggerated more
// than the gentler sea floor.
function hillshade(world) {
  const { cols, rows, elevation, meta } = world, shade = new Int8Array(cols * rows), run = 2 * meta.grid.resolution;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, west = elevation[i - (c > 0)], east = elevation[i + (c < cols - 1)], north = elevation[i - (r > 0 ? cols : 0)], south = elevation[i + (r < rows - 1 ? cols : 0)];
    shade[i] = Math.round(Math.tanh(((east - west) + (south - north)) / run * (elevation[i] > 0 ? 7 : 10)) * 127);
  }
  return shade;
}

export function createChart(world) {
  const { cols, rows, elevation, sign, iceConcentration, iceClass, glacier } = world;
  const shade = hillshade(world), sea = table(SEA_STOPS, 4000), land = table(LAND_STOPS, 2400);
  const solid = world.meta.ice.classes.map(kind => /fast|shelf/i.test(kind.form)), old = world.meta.ice.classes.map(kind => /old|multi|second/i.test(kind.stage));
  const clampC = c => c < 0 ? 0 : c >= cols ? cols - 1 : c, clampR = r => r < 0 ? 0 : r >= rows ? rows - 1 : r;
  // One flag per cell: 1 where the seabed has been mapped and bathymetry shows.
  const mapped = new Uint8Array(cols * rows);

  // Paints `w` x `h` pixels of the plane in which the grid is drawn at `scale` pixels per cell, from pixel (x0, y0)
  // of that plane. `bathymetry` is true to show every depth, false to hide them all, or null to follow `mapped`.
  function paint(px, w, h, x0, y0, scale, bathymetry) {
    // Floes and the grain of the ice are blocks of about half a cell, whatever the zoom.
    const grain = Math.max(1, Math.round(scale / 2)), everywhere = bathymetry === true, nowhere = bathymetry === false;
    // The two cells each pixel column straddles and its weight between them, the same for every row.
    const colA = new Int32Array(w), colB = new Int32Array(w), colT = new Float32Array(w);
    for (let x = 0; x < w; x++) { const fu = (x0 + x + .5) / scale - .5, cf = Math.floor(fu); colT[x] = fu - cf; colA[x] = clampC(cf); colB[x] = clampC(cf + 1); }
    for (let y = 0; y < h; y++) {
      const Y = y0 + y, fv = (Y + .5) / scale - .5, rf = Math.floor(fv), b = fv - rf, ra = clampR(rf) * cols, rb = clampR(rf + 1) * cols;
      for (let x = 0; x < w; x++) {
        const X = x0 + x, a = colT[x], ca = colA[x], cb = colB[x];
        const i00 = ra + ca, i10 = ra + cb, i01 = rb + ca, i11 = rb + cb, w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
        const shoreValue = sign[i00] * w00 + sign[i10] * w10 + sign[i01] * w01 + sign[i11] * w11, side = shoreValue > 0 ? 1 : -1;
        // Heights and depths are interpolated only among cells on this pixel's side of the shore.
        let weight = 0, z = 0, light = 0;
        if (sign[i00] === side) { weight += w00; z += elevation[i00] * w00; light += shade[i00] * w00; }
        if (sign[i10] === side) { weight += w10; z += elevation[i10] * w10; light += shade[i10] * w10; }
        if (sign[i01] === side) { weight += w01; z += elevation[i01] * w01; light += shade[i01] * w01; }
        if (sign[i11] === side) { weight += w11; z += elevation[i11] * w11; light += shade[i11] * w11; }
        if (weight) { z /= weight; light /= weight * 127; } else z = side;
        const nearest = (b < .5 ? ra : rb) + (a < .5 ? ca : cb);
        let red, green, blue;
        if (side > 0) {
          const k = land.at(z), gain = 1 + light * .3;
          if (glacier[nearest]) { red = 236 * gain; green = 241 * gain; blue = 242 * gain; }
          else { red = land.colours[k] * gain; green = land.colours[k + 1] * gain; blue = land.colours[k + 2] * gain; }
        } else {
          const shown = everywhere || (!nowhere && mapped[nearest] === 1);
          const k = sea.at(shown ? -z : 500), gain = shown ? 1 + light * .12 : 1;
          red = sea.colours[k] * gain; green = sea.colours[k + 1] * gain; blue = sea.colours[k + 2] * gain;
          const percent = iceConcentration[nearest];
          if (percent === 255) { if ((X + Y) % 16 < 5) { red = 181; green = 143; blue = 91; } else { red = 76; green = 91; blue = 100; } }        // beyond the ice charts
          else if (percent) {
            // Floes are switched on in proportion to the charted concentration.
            const kind = iceClass[nearest], gx = Math.floor(X / grain), gy = Math.floor(Y / grain);
            if (solid[kind] || hash(gx, gy) < percent / 100 * .96) { const tone = 238 + hash(gx >> 1, gy >> 1) * 14; red = old[kind] ? tone - 12 : tone; green = old[kind] ? tone - 3 : tone; blue = tone; }
            else { red *= .82; green *= .86; blue *= .9; }
          }
        }
        const edge = Math.abs(shoreValue);
        if (edge < .16) { const t = .55 * (1 - edge / .16); red += (52 - red) * t; green += (78 - green) * t; blue += (74 - blue) * t; }
        const p = (y * w + x) * 4; px[p] = red; px[p + 1] = green; px[p + 2] = blue; px[p + 3] = 255;
      }
    }
  }

  // Tiles by "scale/tx/ty" in order of last use; tile (tx, ty) at `scale` covers cells [tx, tx + 1) * TILE / scale across
  // and [ty, ty + 1) * TILE / scale down.
  const tiles = new Map();
  const key = (scale, tx, ty) => `${scale}/${tx}/${ty}`;
  function render(scale, tx, ty) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(TILE, TILE);
    paint(image.data, TILE, TILE, tx * TILE, ty * TILE, scale, null);
    ctx.putImageData(image, 0, 0);
    tiles.set(key(scale, tx, ty), canvas);
    while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
    return canvas;
  }
  // Drops every cached tile that shows any of `cells` (grid indices), at every scale in the cache.
  function forget(cells) {
    const scales = new Set(); for (const k of tiles.keys()) scales.add(Number(k.slice(0, k.indexOf('/'))));
    for (const scale of scales) for (const cell of cells) {
      const c = cell % cols, r = (cell - c) / cols;
      for (let ty = Math.floor(r * scale / TILE); ty <= Math.floor(((r + 1) * scale - 1e-6) / TILE); ty++)
        for (let tx = Math.floor(c * scale / TILE); tx <= Math.floor(((c + 1) * scale - 1e-6) / TILE); tx++) tiles.delete(key(scale, tx, ty));
    }
  }

  return {
    // Shows the seabed in `cells` from now on.
    reveal(cells) { const fresh = []; for (const cell of cells) if (cell >= 0 && cell < mapped.length && !mapped[cell]) { mapped[cell] = 1; fresh.push(cell); } if (fresh.length) forget(fresh); },
    // Hides the seabed everywhere again and drops every tile.
    reset() { mapped.fill(0); tiles.clear(); },
    // The whole chart at `scale` pixels per cell with the seabed hidden: the minimap's base, and what shows under the
    // view while its tiles are still being drawn.
    overview(scale) {
      const w = Math.ceil(cols * scale), h = Math.ceil(rows * scale), canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(w, h);
      paint(image.data, w, h, 0, 0, scale, false); ctx.putImageData(image, 0, 0);
      return canvas;
    },
    // Draws the chart under a view `width` x `height` CSS pixels whose top-left corner is cell (u0, v0), at `z` CSS
    // pixels per cell and `dpr` device pixels per CSS pixel; the tiles land on whole device pixels. Missing tiles are
    // rendered nearest the middle of the view first, one ring beyond it, until `budgetMs` of the frame is spent, and
    // `placeholder` (an overview) shows through where a tile is still to come. Returns how many tiles in view are missing.
    draw(ctx, { z, u0, v0, width, height, dpr = 1 }, placeholder = null, budgetMs = 8) {
      const scale = Math.round(z * dpr * 1000) / 1000, span = TILE / scale, css = TILE / dpr, ox = Math.round(u0 * scale), oy = Math.round(v0 * scale);
      if (placeholder) ctx.drawImage(placeholder, u0 / cols * placeholder.width, v0 / rows * placeholder.height, width / z / cols * placeholder.width, height / z / rows * placeholder.height, 0, 0, width, height);
      const tx0 = Math.max(0, Math.floor(u0 / span)), tx1 = Math.min(Math.ceil(cols / span) - 1, Math.floor((u0 + width / z) / span));
      const ty0 = Math.max(0, Math.floor(v0 / span)), ty1 = Math.min(Math.ceil(rows / span) - 1, Math.floor((v0 + height / z) / span));
      const cx = (u0 + width / z / 2) / span, cy = (v0 + height / z / 2) / span, wanted = [];
      for (let ty = Math.max(0, ty0 - 1); ty <= Math.min(Math.ceil(rows / span) - 1, ty1 + 1); ty++) for (let tx = Math.max(0, tx0 - 1); tx <= Math.min(Math.ceil(cols / span) - 1, tx1 + 1); tx++)
        if (!tiles.has(key(scale, tx, ty))) wanted.push({ tx, ty, d: Math.hypot(tx + .5 - cx, ty + .5 - cy) });
      wanted.sort((a, b) => a.d - b.d);
      const started = performance.now();
      for (let n = 0; n < wanted.length && (n === 0 || performance.now() - started < budgetMs); n++) render(scale, wanted[n].tx, wanted[n].ty);
      let missing = 0;
      ctx.save(); ctx.imageSmoothingEnabled = false;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const k = key(scale, tx, ty), tile = tiles.get(k);
        if (!tile) { missing++; continue; }
        tiles.delete(k); tiles.set(k, tile);
        ctx.drawImage(tile, (tx * TILE - ox) / dpr, (ty * TILE - oy) / dpr, css, css);
      }
      ctx.restore();
      // The ship's own logged track from the underway system, as a fine pecked line; a gap of 120 km or more is a
      // spell outside the world.
      ctx.save(); ctx.strokeStyle = '#7a2f2388'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.beginPath();
      const gap = 120 / world.km; let previous = null;
      for (const fix of world.shipTrack) {
        if (previous && Math.hypot(fix.u - previous.u, fix.v - previous.v) < gap) ctx.lineTo((fix.u - u0) * z, (fix.v - v0) * z); else ctx.moveTo((fix.u - u0) * z, (fix.v - v0) * z);
        previous = fix;
      }
      ctx.stroke(); ctx.restore();
      return missing;
    },
    tileCount: () => tiles.size,
  };
}
