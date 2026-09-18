// Paints the whole world once into an offscreen canvas: shaded land relief, bathymetry, glaciers and sea ice.
// The shore drawn here is world.shore()'s zero line, the same line that stops the ship.
export const CHART_SCALE = 2;          // chart pixels per grid cell

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
const pause = () => new Promise(resolve => setTimeout(resolve));

// Light from the north-west over each cell; land relief is exaggerated more than the gentler sea floor.
function hillshade(world) {
  const { cols, rows, elevation, meta } = world, shade = new Float32Array(cols * rows), run = 2 * meta.grid.resolution;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, west = elevation[i - (c > 0)], east = elevation[i + (c < cols - 1)], north = elevation[i - (r > 0 ? cols : 0)], south = elevation[i + (r < rows - 1 ? cols : 0)];
    shade[i] = Math.tanh(((east - west) + (south - north)) / run * (elevation[i] > 0 ? 7 : 10));
  }
  return shade;
}

export async function renderChart(world, onProgress = () => {}) {
  const S = CHART_SCALE, { cols, rows, elevation, sign, iceConcentration, iceClass, glacier } = world, W = cols * S, H = rows * S;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), shade = hillshade(world), sea = table(SEA_STOPS, 4000), land = table(LAND_STOPS, 2400);
  const solid = world.meta.ice.classes.map(kind => /fast|shelf/i.test(kind.form)), old = world.meta.ice.classes.map(kind => /old|multi|second/i.test(kind.stage));
  const BAND = 60;
  for (let y0 = 0; y0 < H; y0 += BAND) {
    const h = Math.min(BAND, H - y0), image = ctx.createImageData(W, h), px = image.data;
    for (let y = 0; y < h; y++) {
      const fv = (y0 + y + .5) / S - .5, rf = Math.floor(fv), b = fv - rf, ra = Math.max(0, Math.min(rows - 1, rf)) * cols, rb = Math.max(0, Math.min(rows - 1, rf + 1)) * cols;
      for (let x = 0; x < W; x++) {
        const fu = (x + .5) / S - .5, cf = Math.floor(fu), a = fu - cf, ca = Math.max(0, Math.min(cols - 1, cf)), cb = Math.max(0, Math.min(cols - 1, cf + 1));
        const i00 = ra + ca, i10 = ra + cb, i01 = rb + ca, i11 = rb + cb, w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
        const shoreValue = sign[i00] * w00 + sign[i10] * w10 + sign[i01] * w01 + sign[i11] * w11, side = shoreValue > 0 ? 1 : -1;
        // Heights and depths are interpolated only among cells on this pixel's side of the shore.
        let weight = 0, z = 0, light = 0;
        if (sign[i00] === side) { weight += w00; z += elevation[i00] * w00; light += shade[i00] * w00; }
        if (sign[i10] === side) { weight += w10; z += elevation[i10] * w10; light += shade[i10] * w10; }
        if (sign[i01] === side) { weight += w01; z += elevation[i01] * w01; light += shade[i01] * w01; }
        if (sign[i11] === side) { weight += w11; z += elevation[i11] * w11; light += shade[i11] * w11; }
        if (weight) { z /= weight; light /= weight; } else z = side;
        const nearest = (b < .5 ? ra : rb) + (a < .5 ? ca : cb);
        let red, green, blue;
        if (side > 0) {
          const k = land.at(z), gain = 1 + light * .3;
          if (glacier[nearest]) { red = 236 * gain; green = 241 * gain; blue = 242 * gain; }
          else { red = land.colours[k] * gain; green = land.colours[k + 1] * gain; blue = land.colours[k + 2] * gain; }
        } else {
          const k = sea.at(-z), gain = 1 + light * .12;
          red = sea.colours[k] * gain; green = sea.colours[k + 1] * gain; blue = sea.colours[k + 2] * gain;
          const percent = iceConcentration[nearest];
          if (percent === 255) { if ((x + y0 + y) % 9 === 0) { red += 50; green += 46; blue += 34; } }        // beyond the ice charts
          else if (percent) {
            // Floes are 2x2-pixel blocks switched on in proportion to the charted concentration.
            const kind = iceClass[nearest], grain = hash(x >> 1, (y0 + y) >> 1);
            if (solid[kind] || grain < percent / 100 * .96) { const tone = 238 + hash(x >> 2, (y0 + y) >> 2) * 14; red = old[kind] ? tone - 12 : tone; green = old[kind] ? tone - 3 : tone; blue = tone; }
            else { red *= .82; green *= .86; blue *= .9; }
          }
        }
        const edge = Math.abs(shoreValue);
        if (edge < .16) { const t = .55 * (1 - edge / .16); red += (52 - red) * t; green += (78 - green) * t; blue += (74 - blue) * t; }
        const p = (y * W + x) * 4; px[p] = red; px[p + 1] = green; px[p + 2] = blue; px[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, y0);
    if (y0 % (BAND * 5) === 0) { onProgress((y0 + h) / H); await pause(); }
  }
  // The ship's own logged track from the underway system, as a fine pecked line.
  ctx.strokeStyle = '#7a2f2388'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.beginPath();
  let previous = null;
  for (const fix of world.shipTrack) {
    if (previous && Math.hypot(fix.u - previous.u, fix.v - previous.v) < 40) ctx.lineTo(fix.u * S, fix.v * S); else ctx.moveTo(fix.u * S, fix.v * S);
    previous = fix;
  }
  ctx.stroke(); ctx.setLineDash([]);
  onProgress(1);
  return canvas;
}
