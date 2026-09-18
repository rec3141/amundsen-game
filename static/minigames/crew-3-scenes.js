// Procedural ice scenes for Cliceify. Every image is rendered from a seed, so a
// deck can be replayed and no photograph is needed offline. The features drawn
// follow the WMO sea-ice nomenclature cues that separate first-year ice from old
// (multi-year) ice at each observing platform.

export const WIDTH = 560;
export const HEIGHT = 350;

export const CLASSES = {
  firstYear: { key: 'firstYear', label: 'First-year', long: 'First-year ice', egg: '4•' },
  old: { key: 'old', label: 'Multi-year', long: 'Old (multi-year) ice', egg: '7•' },
};

export const PLATFORMS = [
  {
    id: 'surface', level: 1, name: 'Surface', kicker: 'BRIDGE AND FLOE WALK',
    sensor: 'Eye level from the ship or the floe, about 60 m of ice in view',
    budgetMs: 6000, passMeanMs: 3400,
    cues: {
      firstYear: ['Level, uniform surface with a low freeboard', 'Fresh ridges are angular rubble with sharp block faces', 'Grey-white tone: thin snow over saline ice, brine-damp patches'],
      old: ['Rolling hummocks with rounded, weathered crests', 'Refrozen melt ponds sit in the hollows, pale blue', 'Bluish bare-ice crests where wind has stripped the thicker snow'],
    },
  },
  {
    id: 'airborne', level: 2, name: 'Airborne', kicker: 'HELICOPTER RECONNAISSANCE',
    sensor: 'Nadir view from about 300 m, a kilometre of pack in frame',
    budgetMs: 5500, passMeanMs: 3100,
    cues: {
      firstYear: ['Floes break along straight fractures into angular plates', 'Ridges are thin, sharp lines with a hard shadow', 'Leads carry grey nilas or dark open water'],
      old: ['Floe outlines are rounded and lobed by past summers', 'Undulating hummock relief shades the whole floe', 'Networks of relict melt ponds thread the low ground'],
    },
  },
  {
    id: 'optical', level: 3, name: 'Satellite optical', kicker: 'VISIBLE-BAND IMAGERY',
    sensor: 'True-colour scene, 10 to 30 m pixels, about 30 km across',
    budgetMs: 5000, passMeanMs: 2800,
    cues: {
      firstYear: ['Polygonal floes with straight lead systems between them', 'Slightly greyer tone: thinner snow and wetter ice', 'Smooth, even texture across each plate'],
      old: ['Bright white floes with rounded outlines', 'Mottled interior texture from hummocks and ponds', 'Floes sit as discrete rounded bodies in the pack'],
    },
  },
  {
    id: 'sar', level: 4, name: 'Satellite radar', kicker: 'C-BAND SAR, HH POLARISATION',
    sensor: 'Synthetic aperture radar backscatter, about 50 km across, no daylight needed',
    budgetMs: 4500, passMeanMs: 2500,
    cues: {
      firstYear: ['Level floes return little: dark, smooth plates', 'Only ridges and rubbled edges are bright, as thin lines', 'Wind-roughened water can be bright too; watch the shape'],
      old: ['Bright across the whole floe: volume scattering from bubbly, desalinated ice', 'Mottled speckle texture with rounded floe edges', 'Ridges barely stand out against the already bright surface'],
    },
  },
];

// Small fast hash-based RNG so a seed reproduces an exact scene.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function lattice(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

// Fractal noise in [0, 1] with `octaves` layers.
function fbm(x, y, seed, octaves = 4, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, y * f, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const mix = (a, b, t) => a + (b - a) * t;

// Jittered-grid Voronoi: nearest two feature points and the nearest cell id.
function makeCells(cell, seed, jitter = 0.8) {
  return (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let d1 = Infinity, d2 = Infinity, id = 0, px = 0, py = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = gx + i, cy = gy + j;
        const fx = (cx + 0.5 + (lattice(cx, cy, seed) - 0.5) * jitter) * cell;
        const fy = (cy + 0.5 + (lattice(cx, cy, seed + 7) - 0.5) * jitter) * cell;
        const d = Math.hypot(fx - x, fy - y);
        if (d < d1) { d2 = d1; d1 = d; id = lattice(cx, cy, seed + 13); px = fx; py = fy; }
        else if (d < d2) d2 = d;
      }
    }
    return { d1, d2, id, px, py };
  };
}

function segmentDistance(x, y, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const t = clamp(((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t));
}

function randomSegments(rng, count, W, H, length) {
  const segments = [];
  for (let i = 0; i < count; i++) {
    const x1 = rng() * W, y1 = rng() * H, angle = rng() * Math.PI * 2, len = length * (0.6 + rng() * 0.8);
    segments.push({ x1, y1, x2: x1 + Math.cos(angle) * len, y2: y1 + Math.sin(angle) * len });
  }
  return segments;
}

// Nadir field of floes with relief, used by the airborne and both satellite levels.
// Fills the pixel buffer and returns which cues were drawn.
function renderTopDown(data, W, H, opts, rng, seed) {
  const cells = makeCells(opts.floePx, seed, 0.85);
  const blobs = makeCells(opts.floePx * 0.9, seed + 31, 0.9);
  const ridges = randomSegments(rng, opts.ridgeCount, W, H, opts.floePx * 1.2);
  const cracks = randomSegments(rng, opts.crackCount, W, H, W * 0.9);
  const height = new Float32Array(W * H);
  const kind = new Uint8Array(W * H); // 0 water, 1 nilas, 2 floe, 3 pond
  const waterRough = rng() < 0.5;
  const scale = 1 / opts.floePx;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wobble = (fbm(x * scale * 2.2, y * scale * 2.2, seed + 5, 3) - 0.5);
      let floe;
      if (opts.rounded) {
        const b = blobs(x, y);
        const radius = opts.floePx * (0.42 + b.id * 0.28) * (1 + wobble * 0.5);
        floe = b.d1 < radius;
      } else {
        const c = cells(x, y);
        floe = (c.d2 - c.d1) > opts.gapPx * (0.7 + c.id * 0.6);
      }
      if (floe) {
        for (const crack of cracks) if (segmentDistance(x, y, crack) < opts.crackPx) { floe = false; break; }
      }
      if (!floe) {
        kind[i] = opts.nilas && fbm(x * scale * 0.9, y * scale * 0.9, seed + 77, 2) > 0.5 ? 1 : 0;
        continue;
      }
      kind[i] = 2;
      let h = (fbm(x * scale * opts.reliefFreq, y * scale * opts.reliefFreq, seed + 21, 5, opts.reliefGain) - 0.5) * opts.relief;
      if (opts.sastrugi) h += (fbm(x * scale * 1.5, y * scale * 14, seed + 44, 2) - 0.5) * opts.sastrugi;
      for (const ridge of ridges) {
        const d = segmentDistance(x, y, ridge);
        if (d < opts.ridgePx * 3) {
          const profile = opts.sharpRidges
            ? Math.max(0, 1 - d / opts.ridgePx) * (0.6 + 0.8 * lattice(Math.floor(x / 2), Math.floor(y / 2), seed + 3))
            : Math.exp(-(d * d) / (opts.ridgePx * opts.ridgePx * 2.5));
          h += profile * opts.ridgeHeight;
        }
      }
      height[i] = h;
      if (opts.ponds && fbm(x * scale * 3.2, y * scale * 3.2, seed + 61, 3) + h * 0.35 < opts.ponds) kind[i] = 3;
    }
  }
  const light = opts.light;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = kind[i];
      let r, g, b;
      if (k === 0 || k === 1) {
        if (opts.sar) {
          const wind = waterRough ? 95 + 55 * fbm(x * 0.02, y * 0.006, seed + 9, 3) : 34 + 16 * fbm(x * 0.01, y * 0.01, seed + 9, 2);
          r = g = b = k === 1 ? wind * 0.55 + 20 : wind;
        } else {
          const base = k === 1 ? opts.nilasRGB : opts.waterRGB;
          const t = 0.9 + 0.2 * fbm(x * 0.02, y * 0.02, seed + 9, 2);
          r = base[0] * t; g = base[1] * t; b = base[2] * t;
        }
      } else {
        const xl = height[Math.max(i - 1, 0)], xr = height[Math.min(i + 1, W * H - 1)];
        const yu = height[Math.max(i - W, 0)], yd = height[Math.min(i + W, W * H - 1)];
        const slope = clamp((xl - xr) * light[0] + (yu - yd) * light[1], -1, 1);
        const shade = clamp(1 + slope * opts.shadeGain, 0.35, 1.35);
        const mottle = 1 + (fbm(x * scale * 5, y * scale * 5, seed + 88, 3) - 0.5) * opts.mottle;
        if (opts.sar) {
          const ridgeBoost = Math.max(0, height[i]) * opts.sarRidge;
          const v = k === 3 ? opts.sarFloe * 0.75 : opts.sarFloe * mottle + ridgeBoost;
          r = g = b = v * (0.8 + 0.5 * shade);
        } else {
          const base = k === 3 ? opts.pondRGB : opts.floeRGB;
          const wet = opts.wetPatches ? 1 - opts.wetPatches * Math.max(0, fbm(x * scale * 1.3, y * scale * 1.3, seed + 99, 2) - 0.55) : 1;
          r = base[0] * shade * mottle * wet; g = base[1] * shade * mottle * wet; b = base[2] * shade * mottle * wet;
        }
      }
      if (opts.sar) {
        // Multiplicative speckle; a slight row correlation reads like real single-look SAR.
        const s = 0.55 + 0.9 * lattice(x, y, seed + 17) * (0.7 + 0.6 * lattice(x >> 1, y, seed + 19));
        r = g = b = r * s;
      }
      if (opts.haze) {
        const hz = opts.haze * Math.max(0, fbm(x * 0.004, y * 0.006, seed + 123, 3) - 0.45) * 2.2;
        r = mix(r, 235, hz); g = mix(g, 238, hz); b = mix(b, 242, hz);
      }
      const o = i * 4;
      data[o] = clamp(r, 0, 255); data[o + 1] = clamp(g, 0, 255); data[o + 2] = clamp(b, 0, 255); data[o + 3] = 255;
    }
  }
  return { ridges: ridges.length, waterRough };
}

// Eye-level perspective across a floe: a 64 m ground patch is warped row by row below the horizon.
function renderSurface(data, W, H, opts, rng, seed) {
  const horizon = Math.round(H * 0.4);
  const camera = 2.4 + rng() * 1.2; // metres above the ice, a person or a deck rail
  const focal = H * 0.95;
  const ridges = randomSegments(rng, opts.ridgeCount, 64, 64, 30);
  const pondLevel = -opts.relief * 0.12;
  // Ground height in metres at world (u across, z away); ponds are flat at their frozen level.
  function heightAt(u, z) {
    let h = (fbm(u * opts.reliefFreq, z * opts.reliefFreq, seed + 21, 4, opts.reliefGain) - 0.5) * opts.relief;
    if (opts.sastrugi) h += (fbm((u + z * 0.6) * 0.22, (z - u * 0.6) * 1.8, seed + 44, 2) - 0.5) * opts.sastrugi;
    let ridge = 0;
    for (const r of ridges) {
      const d = segmentDistance(u + 32, z, r);
      if (d < opts.ridgeWidth * 3) {
        const profile = opts.sharpRidges
          ? Math.max(0, 1 - d / opts.ridgeWidth) * (0.4 + lattice(Math.floor(u * 3), Math.floor(z * 3), seed + 3))
          : Math.exp(-(d * d) / (opts.ridgeWidth * opts.ridgeWidth * 2));
        ridge = Math.max(ridge, profile);
      }
    }
    h += ridge * opts.ridgeHeight;
    const pond = opts.ponds && !ridge && h < pondLevel;
    return { h: pond ? pondLevel : h, ridge, pond };
  }
  const bumps = new Float32Array(W); // horizon silhouette
  for (let x = 0; x < W; x++) {
    const n = fbm(x * 0.012, 0.3, seed + 55, 3);
    bumps[x] = opts.horizonBumps * Math.max(0, n - 0.42) * 30;
  }
  const skyTop = opts.skyRGB, skyLow = [222, 230, 236];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r, g, b;
      if (y < horizon - bumps[x]) {
        const t = clamp(y / horizon, 0, 1);
        r = mix(skyTop[0], skyLow[0], t); g = mix(skyTop[1], skyLow[1], t); b = mix(skyTop[2], skyLow[2], t);
        const cloud = fbm(x * 0.006, y * 0.02, seed + 66, 3) - 0.5;
        r += cloud * 18; g += cloud * 16; b += cloud * 12;
      } else if (y < horizon + 1) {
        // Distant hummock ridge line, weathered and blue-grey.
        r = 176; g = 196; b = 210;
      } else {
        const z = camera * focal / (y - horizon + 0.5);
        const u = (x - W / 2) * z / focal;
        const here = heightAt(u, z);
        // Slope toward the viewer and across, from finite differences that grow with distance.
        const dz = 0.12 + z * 0.02;
        const away = heightAt(u, z + dz).h;
        const beside = heightAt(u + dz, z).h;
        let slope = ((away - here.h) * 1.6 + (beside - here.h) * 0.9) / dz;
        if (here.ridge && opts.sharpRidges) slope += (lattice(Math.floor(u * 4), Math.floor(z * 4), seed + 8) - 0.5) * 3 * here.ridge;
        const shade = clamp(1 - slope * opts.shadeGain, 0.4, 1.25);
        const crest = opts.blueCrests ? clamp((here.h - opts.relief * 0.08) * 2.5, 0, 1) : 0;
        let base = here.pond ? opts.pondRGB : opts.floeRGB;
        if (crest) base = [mix(base[0], 190, crest), mix(base[1], 216, crest), mix(base[2], 232, crest)];
        const wet = opts.wetPatches ? 1 - opts.wetPatches * Math.max(0, fbm(u * 0.35, z * 0.35, seed + 99, 2) - 0.5) : 1;
        const grain = 0.97 + 0.06 * lattice(x, y, seed + 2);
        r = base[0] * shade * wet * grain; g = base[1] * shade * wet * grain; b = base[2] * shade * wet * grain;
        if (here.ridge && opts.sharpRidges) { const blockLight = 0.65 + 0.7 * lattice(Math.floor(u * 2.5), Math.floor(z * 2.5), seed + 4); r *= blockLight; g *= blockLight; b *= blockLight; }
        // Aerial perspective toward the horizon.
        const fog = clamp((z - 8) / 90, 0, 0.55);
        r = mix(r, 205, fog); g = mix(g, 216, fog); b = mix(b, 226, fog);
      }
      data[o] = clamp(r, 0, 255); data[o + 1] = clamp(g, 0, 255); data[o + 2] = clamp(b, 0, 255); data[o + 3] = 255;
    }
  }
  return { ridges: ridges.length };
}

// Scene parameters per platform and class. `d` in [0, 1] softens the contrast between the two classes.
function sceneOptions(platformId, iceClass, d, rng) {
  const old = iceClass === 'old';
  const ridgeCount = (min, max) => min + Math.floor(rng() * (max - min + 1));
  if (platformId === 'surface') {
    return old ? {
      skyRGB: [150, 178, 205], floeRGB: [236, 240, 243], pondRGB: [152, 186, 212],
      relief: mix(2.4, 1.3, d), reliefFreq: 0.13, reliefGain: 0.55, sastrugi: 0,
      ridgeCount: ridgeCount(0, 1), ridgeWidth: 4.5, ridgeHeight: mix(1.6, 1, d), sharpRidges: false,
      ponds: 1, blueCrests: true, wetPatches: 0, shadeGain: 1.5, horizonBumps: mix(1, 0.4, d),
    } : {
      skyRGB: [150, 178, 205], floeRGB: [224, 227, 226], pondRGB: [200, 205, 205],
      relief: mix(0.12, 0.4, d), reliefFreq: 0.2, reliefGain: 0.5, sastrugi: mix(0.05, 0.1, d),
      ridgeCount: ridgeCount(d > 0.4 ? 1 : 0, d > 0.7 ? 2 : 1), ridgeWidth: 2.2, ridgeHeight: mix(1.4, 2, d), sharpRidges: true,
      ponds: 0, blueCrests: false, wetPatches: mix(0.5, 0.35, d), shadeGain: 1.5, horizonBumps: 0,
    };
  }
  if (platformId === 'airborne') {
    return old ? {
      floePx: 150, rounded: true, gapPx: 0, crackCount: 0, crackPx: 0, nilas: false,
      relief: mix(1.4, 0.8, d), reliefFreq: 4, reliefGain: 0.55, sastrugi: 0,
      ridgeCount: ridgeCount(1, 3), ridgePx: 7, ridgeHeight: 0.9, sharpRidges: false,
      ponds: mix(0.42, 0.35, d), mottle: 0.12, wetPatches: 0, shadeGain: 1.4, light: [0.8, 0.6],
      floeRGB: [240, 243, 246], pondRGB: [186, 208, 224], waterRGB: [22, 44, 60], nilasRGB: [96, 110, 120],
    } : {
      floePx: 190, rounded: false, gapPx: 4, crackCount: ridgeCount(1, 2), crackPx: 1.6, nilas: true,
      relief: mix(0.2, 0.5, d), reliefFreq: 6, reliefGain: 0.45, sastrugi: 0.15,
      ridgeCount: ridgeCount(1, 3 + Math.round(d * 2)), ridgePx: 3, ridgeHeight: 2.2, sharpRidges: true,
      ponds: 0, mottle: 0.05, wetPatches: mix(0.35, 0.2, d), shadeGain: 1.4, light: [0.8, 0.6],
      floeRGB: [226, 229, 231], pondRGB: [0, 0, 0], waterRGB: [22, 44, 60], nilasRGB: [96, 110, 120],
    };
  }
  if (platformId === 'optical') {
    return old ? {
      floePx: 70, rounded: true, gapPx: 0, crackCount: 0, crackPx: 0, nilas: false,
      relief: 1, reliefFreq: 5, reliefGain: 0.6, sastrugi: 0,
      ridgeCount: 0, ridgePx: 3, ridgeHeight: 0, sharpRidges: false,
      ponds: mix(0.36, 0.3, d), mottle: mix(0.3, 0.2, d), wetPatches: 0, shadeGain: 0.8, light: [0.7, 0.7],
      floeRGB: [244, 246, 248], pondRGB: [205, 216, 226], waterRGB: [14, 30, 46], nilasRGB: [70, 84, 96], haze: 0.5,
    } : {
      floePx: 95, rounded: false, gapPx: 4, crackCount: ridgeCount(2, 4), crackPx: 1.2, nilas: true,
      relief: mix(0.15, 0.4, d), reliefFreq: 6, reliefGain: 0.45, sastrugi: 0,
      ridgeCount: ridgeCount(0, 3), ridgePx: 1.2, ridgeHeight: 1.2, sharpRidges: true,
      ponds: 0, mottle: 0.04, wetPatches: mix(0.3, 0.15, d), shadeGain: 0.8, light: [0.7, 0.7],
      floeRGB: [220, 224, 228], pondRGB: [0, 0, 0], waterRGB: [14, 30, 46], nilasRGB: [70, 84, 96], haze: 0.5,
    };
  }
  return old ? {
    sar: true, floePx: 85, rounded: true, gapPx: 0, crackCount: 0, crackPx: 0, nilas: false,
    relief: 0.8, reliefFreq: 5, reliefGain: 0.6, sastrugi: 0,
    ridgeCount: ridgeCount(1, 3), ridgePx: 2.5, ridgeHeight: 0.7, sharpRidges: true,
    ponds: 0.3, mottle: 0.45, shadeGain: 0.25, light: [0.7, 0.7],
    sarFloe: mix(178, 150, d), sarRidge: 40,
  } : {
    sar: true, floePx: 110, rounded: false, gapPx: 5, crackCount: ridgeCount(1, 3), crackPx: 1.2, nilas: true,
    relief: 0.15, reliefFreq: 6, reliefGain: 0.45, sastrugi: 0,
    ridgeCount: ridgeCount(2, 5 + Math.round(d * 3)), ridgePx: 1.6, ridgeHeight: 1.6, sharpRidges: true,
    ponds: 0, mottle: 0.1, shadeGain: 0.25, light: [0.7, 0.7],
    sarFloe: mix(62, 84, d), sarRidge: 150,
  };
}

// Paints one classified scene into the canvas and returns the cue the image shows most clearly.
export function renderScene(canvas, platformId, iceClass, seed, difficulty = 0) {
  const ctx = canvas.getContext('2d');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const image = ctx.createImageData(WIDTH, HEIGHT);
  const rng = mulberry32(seed);
  const opts = sceneOptions(platformId, iceClass, difficulty, rng);
  // Past mid-level the floe outline can mislead: winter-fractured old floes break into angles and
  // melt-rounded first-year floes lose theirs, so tone, texture and relief have to decide.
  const shapeSwap = platformId !== 'surface' && difficulty > 0.5 && rng() < 0.45;
  if (shapeSwap) { opts.rounded = !opts.rounded; if (opts.rounded) { opts.gapPx = 0; } else { opts.gapPx = 4; } }
  const drawn = platformId === 'surface'
    ? renderSurface(image.data, WIDTH, HEIGHT, opts, rng, seed)
    : renderTopDown(image.data, WIDTH, HEIGHT, opts, rng, seed);
  ctx.putImageData(image, 0, 0);
  const platform = PLATFORMS.find(p => p.id === platformId);
  const cues = platform.cues[iceClass];
  let cue = cues[0];
  if (iceClass === 'firstYear' && drawn.ridges > 0) cue = cues[1];
  if (platformId === 'sar' && iceClass === 'firstYear' && drawn.waterRough) cue = cues[2];
  if (iceClass === 'old' && platformId !== 'sar' && rng() < 0.5) cue = cues[2];
  if (shapeSwap) cue = iceClass === 'old' ? cues[1] : cues[platformId === 'sar' ? 0 : 2];
  return { cue, shapeSwap };
}
