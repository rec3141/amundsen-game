// Pixel-art craft for the main chart: CCGS Amundsen, the Coast Guard helicopter, the zodiac, the AUV and the tanker
// M/T Nanny. Each craft is a palette-indexed pixel grid written in code; a heading is quantised to one of 16
// directions, and every (craft, direction, pixel size) is rasterised once into an offscreen canvas, so drawing a craft
// costs a single drawImage per frame. `scale` is screen pixels per sprite pixel and is rounded to a whole number so
// every block stays square; rotation happens on the 1:1 grid with nearest-neighbour sampling before the integer
// upscale, which keeps the blocky look at every zoom. Angles follow the chart: 0 points right, positive turns clockwise.

const DIRECTIONS = 16;
const PALETTE = {
  k: '#1b1f26', // outline
  r: '#c8402e', R: '#8d2a1c', // CCG hull red, shaded red
  w: '#f4f1e8', W: '#c9ced3', // white, light grey
  d: '#8e979c', D: '#5b666c', // deck grey, dark grey
  g: '#2e6b58', h: '#e9f0e6', // helideck green, deck marking
  b: '#28434c', // bridge glass
  y: '#e8b64a', // crane, A-frame, AUV hull
  o: '#ee8a3c', // zodiac sponsons
  n: '#23262b', N: '#3a3f46', // tanker hull black, shaded black
  B: '#1b1f268c', // rotor blade
  t: '#5e6e64', // tanker deck
  e: '#3d3126', // exhaust
  a: '#a8d5d08c', A: '#a8d5d04d', // wake, faint wake
};
const SHADOW = '#041d3373';
const TAU = Math.PI * 2;

// Grids are rows of palette letters; '.' is transparent. Every row must be the same length.
const SHIP = [
  '................................',
  '..kkkkkkkkkkkkkkkkkkkk..........',
  '.kRrrrrrrrrrrrrrrrrrrrkk........',
  'kRyrrrrrrrrrrrWWWWWWWWrrkk......',
  'kRydddgggggggdWbbbbbbwWrrwkk....',
  'kRydddghgghhgdeWbbbbbwWrrrwrkk..',
  'kRydddghhhhhgdeWwwwwwwWyyrrwrrkk',
  'kRydddghgghhgdeWbbbbbwWrrrwrkk..',
  'kRydddgggggggdWbbbbbbwWrrwkk....',
  'kRyrrrrrrrrrrrWWWWWWWWrrkk......',
  '.kRrrrrrrrrrrrrrrrrrrrkk........',
  '..kkkkkkkkkkkkkkkkkkkk..........',
  '................................',
];
const HELICOPTER = [
  '............',
  '............',
  '......dddd..',
  'Dk...kkkkkk.',
  '.kkkkkrwwrk.',
  '.krrrrrwwrbk',
  '.krrrrrwwrbk',
  '.kkkkkrwwrk.',
  'Dk...kkkkkk.',
  '......dddd..',
  '............',
  '............',
];
const ZODIAC = [
  '..ooooooooo.',
  '.oDDDDDDDDo.',
  'koDDDDDdDDoo',
  '.oDDDDDDDDo.',
  '..ooooooooo.',
];
const AUV = [
  '..k.........',
  '.kkkyyyyyyk.',
  'kkeyyyyyyyyk',
  '.kkkyyyyyyk.',
  '..k.........',
];
const TANKER = [
  '............................................',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk........',
  '.kNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnkk......',
  'kNWWWWWWWttttttttttttttttttttttttttttkk.....',
  'kNWbbbbWWtttktttkttttkttttktttkttttttkk.....',
  'kNWbbbbWWttttttttttttttttttttttttttttttkk...',
  'kNWbbbbeWtttWWWWWWWWWWWWWWWWWWWWWWWttttttkkk',
  'kNWbbbbWWttttttttttttttttttttttttttttttkk...',
  'kNWbbbbWWtttktttkttttkttttktttkttttttkk.....',
  'kNWWWWWWWttttttttttttttttttttttttttttkk.....',
  '.kNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnkk......',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk........',
  '............................................',
];

// A wake is three chevrons opening towards the stern, each longer and wider than the last, drawn as pale pixels.
// `sternX` is the column just aft of the hull in the composite grid; the chevrons trail left of it.
function paintWake(layer, sternX, cy) {
  for (let n = 0; n < 3; n++) {
    const apex = sternX - 5 - n * 5, length = 5 + n, spread = (3 + n * 2.6) / length, letter = n ? 'A' : 'a';
    for (let t = 0; t <= length; t++) {
      const dy = Math.round(t * spread);
      layer.set(apex + t, cy - dy, letter); layer.set(apex + t, cy + dy, letter);
    }
  }
}

function colour(letter) {
  const hex = PALETTE[letter], n = parseInt(hex.slice(1), 16);
  return hex.length === 9 ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
// A layer is an RGBA pixel grid; `set` paints a palette letter, `rotated` resamples it around a pivot.
class Layer {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); }
  set(x, y, letter) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || letter === '.') return;
    this.data.set(colour(letter), (y * this.w + x) * 4);
  }
  rotated(pivotX, pivotY, theta, size) {
    const out = new Layer(size, size), c = size / 2, cos = Math.cos(theta), sin = Math.sin(theta);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const dx = i + .5 - c, dy = j + .5 - c;
      const sx = Math.floor(pivotX + dx * cos + dy * sin), sy = Math.floor(pivotY - dx * sin + dy * cos);
      if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
      const from = (sy * this.w + sx) * 4, to = (j * size + i) * 4;
      out.data[to] = this.data[from]; out.data[to + 1] = this.data[from + 1]; out.data[to + 2] = this.data[from + 2]; out.data[to + 3] = this.data[from + 3];
    }
    return out;
  }
  canvas() {
    const c = document.createElement('canvas'); c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return c;
  }
}

// A sprite is the body grid plus an optional wake layer in a shared frame, with the rotation pivot on the hull's
// centre. `size` is the square side that holds the frame at any heading; `shadow` is the drop-shadow offset in
// sprite pixels, cast down-right in screen space whatever the heading.
function sprite(name, rows, { wake = 0, shadow = [1, 2], pivot } = {}) {
  const h = rows.length, w = rows[0].length;
  if (rows.some(row => row.length !== w)) throw new Error(`${name}: ragged pixel rows`);
  const pad = wake ? 9 : 0, W = w + wake, H = h + pad * 2, body = new Layer(W, H);
  rows.forEach((row, y) => [...row].forEach((letter, x) => body.set(x + wake, y + pad, letter)));
  let wakeLayer = null;
  if (wake) { wakeLayer = new Layer(W, H); paintWake(wakeLayer, wake, pad + (h - 1) / 2); }
  const [px, py] = pivot ? [pivot[0] + wake, pivot[1] + pad] : [W / 2, H / 2];
  const reach = Math.max(Math.hypot(px, py), Math.hypot(W - px, py), Math.hypot(px, H - py), Math.hypot(W - px, H - py));
  return { name, body, wake: wakeLayer, pivotX: px, pivotY: py, shadow, size: 2 * Math.ceil(reach) + 4 };
}
const SPRITES = {
  ship: sprite('ship', SHIP, { wake: 22 }),
  helicopter: sprite('helicopter', HELICOPTER, { shadow: [2, 4], pivot: [7.5, 6] }),
  zodiac: sprite('zodiac', ZODIAC, { shadow: [1, 1] }),
  auv: sprite('auv', AUV, { shadow: [1, 1] }),
  tanker: sprite('tanker', TANKER, { shadow: [1, 2] }),
};

const cache = new Map();
const pixelSize = scale => Math.max(1, Math.round(scale));
const direction = angle => (Math.round(angle / (TAU / DIRECTIONS)) % DIRECTIONS + DIRECTIONS) % DIRECTIONS;
function upscale(small, px) {
  if (px === 1) return small;
  const big = document.createElement('canvas'); big.width = small.width * px; big.height = small.height * px;
  const c = big.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(small, 0, 0, big.width, big.height);
  return big;
}
// The cached picture of one craft at one of the 16 headings: wake, then the shadow silhouette, then the body.
function frame(sprite, dir, px) {
  const key = `${sprite.name}/${dir}/${px}`;
  let done = cache.get(key); if (done) return done;
  const theta = dir * TAU / DIRECTIONS, size = sprite.size;
  const small = document.createElement('canvas'); small.width = small.height = size;
  const c = small.getContext('2d');
  if (sprite.wake) c.drawImage(sprite.wake.rotated(sprite.pivotX, sprite.pivotY, theta, size).canvas(), 0, 0);
  const body = sprite.body.rotated(sprite.pivotX, sprite.pivotY, theta, size).canvas();
  const shadow = document.createElement('canvas'); shadow.width = shadow.height = size;
  const s = shadow.getContext('2d'); s.drawImage(body, sprite.shadow[0], sprite.shadow[1]);
  s.globalCompositeOperation = 'source-in'; s.fillStyle = SHADOW; s.fillRect(0, 0, size, size);
  c.drawImage(shadow, 0, 0); c.drawImage(body, 0, 0);
  done = upscale(small, px); cache.set(key, done);
  return done;
}
// The main rotor: four blades six pixels long, turning 22.5° a frame, over a faint disc. Independent of heading.
function rotorFrame(step, px) {
  const key = `rotor/${step}/${px}`;
  let done = cache.get(key); if (done) return done;
  const size = SPRITES.helicopter.size, c = size / 2, layer = new Layer(size, size);
  for (let blade = 0; blade < 4; blade++) {
    const phi = (step / 4 + blade) * TAU / 4;
    for (let t = 0; t <= 6; t += .5) layer.set(Math.floor(c + Math.cos(phi) * t), Math.floor(c + Math.sin(phi) * t), t > 5 ? 'W' : 'B');
  }
  const small = layer.canvas(), g = small.getContext('2d');
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#f4f1e826'; g.beginPath(); g.arc(c, c, 6.5, 0, TAU); g.fill();
  done = upscale(small, px); cache.set(key, done);
  return done;
}
function blit(ctx, image, x, y, px, size) {
  const half = size * px / 2;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, Math.round(x - half), Math.round(y - half));
  ctx.restore();
}
function draw(ctx, name, x, y, angle, scale) {
  const px = pixelSize(scale), sprite = SPRITES[name];
  blit(ctx, frame(sprite, direction(angle), px), x, y, px, sprite.size);
}

export function drawShip(ctx, x, y, angle, scale) { draw(ctx, 'ship', x, y, angle, scale); }
export function drawZodiac(ctx, x, y, angle, scale) { draw(ctx, 'zodiac', x, y, angle, scale); }
export function drawAUV(ctx, x, y, angle, scale) { draw(ctx, 'auv', x, y, angle, scale); }
export function drawTanker(ctx, x, y, angle, scale) { draw(ctx, 'tanker', x, y, angle, scale); }
// `time` is in milliseconds; the rotor advances a step every 45 ms.
export function drawHelicopter(ctx, x, y, angle, scale, time = 0) {
  draw(ctx, 'helicopter', x, y, angle, scale);
  const px = pixelSize(scale);
  blit(ctx, rotorFrame(Math.floor(time / 45) % 4, px), x, y, px, SPRITES.helicopter.size);
}
// A sprite sheet for eyeballing the art: every craft at all 16 headings, and the four rotor steps, at one pixel
// size, wrapping rows within `maxWidth`. Returns the sheet's extent. Not used by the game.
export function drawSpriteSheet(ctx, x, y, scale = 4, maxWidth = 2000) {
  const px = pixelSize(scale); let top = y, width = 0;
  for (const name of Object.keys(SPRITES)) {
    const cell = SPRITES[name].size * px, perRow = Math.max(1, Math.floor(maxWidth / cell));
    for (let dir = 0; dir < DIRECTIONS; dir++) {
      const cx = x + cell * (dir % perRow + .5), cy = top + cell * (Math.floor(dir / perRow) + .5), angle = dir * TAU / DIRECTIONS;
      if (name === 'helicopter') drawHelicopter(ctx, cx, cy, angle, px, dir * 45); else draw(ctx, name, cx, cy, angle, px);
    }
    width = Math.max(width, cell * Math.min(perRow, DIRECTIONS)); top += cell * Math.ceil(DIRECTIONS / perRow);
  }
  return { width, height: top - y };
}
