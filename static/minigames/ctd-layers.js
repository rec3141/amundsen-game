export const targets = {
  chlorophyll: { label: 'Chlorophyll maximum', channel: 'Fluorescence', mode: 'max', rule: 'Find the fluorescence peak (chlorophyll proxy).' },
  temperature: { label: 'Temperature minimum', channel: 'Temperature', mode: 'min', rule: 'Find the coldest measured layer.' },
  oxygen: { label: 'Oxygen minimum', channel: 'Oxygen', mode: 'min', rule: 'Find the lowest measured oxygen concentration.' },
  warm: { label: 'Temperature maximum', channel: 'Temperature', mode: 'max', rule: 'Find the warmest measured layer.' },
  oxygenMax: { label: 'Oxygen maximum', channel: 'Oxygen', mode: 'max', rule: 'Find the highest measured oxygen concentration.' },
  pycnocline: { label: 'Pycnocline', channel: 'Sigma-t', mode: 'gradient', rule: 'Find the strongest positive Sigma-t gradient with pressure.' },
};
const median = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

// Nulls and pressure gaps break segments; no derivatives bridge missing water.
export function segments(profile, channel) {
  const result = []; let current = [];
  const values = profile.vars?.[channel] || [];
  for (let i = 0; i < (profile.p || []).length; i++) {
    const p = profile.p[i], value = values[i], last = current.at(-1);
    if (!Number.isFinite(p) || !Number.isFinite(value)) {
      if (current.length) result.push(current);
      current = []; continue;
    }
    if (last && (p <= last.p || p - last.p > 3)) { result.push(current); current = []; }
    current.push({ p, value });
  }
  if (current.length) result.push(current);
  return result;
}

export function findLayer(profile, key) {
  const target = targets[key];
  if (!target) return null;
  const groups = segments(profile, target.channel).filter(g => g.length >= 5);
  const smooth = groups.map(g => g.map(pt => ({ ...pt,
    value: median(g.filter(q => Math.abs(q.p - pt.p) <= 2).map(q => q.value)),
  })));
  const all = smooth.flat();
  if (!all.length) return null;
  const range = Math.max(...all.map(x => x.value)) - Math.min(...all.map(x => x.value));
  if (range < 1e-6) return null;
  let candidates = [];
  if (target.mode === 'gradient') {
    for (const g of smooth) for (let i = 0; i < g.length; i++) {
      const end = g.find(q => q.p >= g[i].p + 6);
      if (end && end.p - g[i].p <= 8) candidates.push({ p: (end.p + g[i].p) / 2,
        value: (end.value - g[i].value) / (end.p - g[i].p), edge: i === 0 || end === g.at(-1) });
    }
    candidates = candidates.filter(x => x.value > 1e-6);
  } else {
    candidates = smooth.flatMap(g => g.map((x, i) => ({ ...x, edge: i === 0 || i === g.length - 1 })));
  }
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (target.mode === 'min' ? b.value < a.value : b.value > a.value) ? b : a);
  // Equal extrema are equally valid catches, even when separated by another layer.
  const pressures = candidates.filter(x => Math.abs(x.value - best.value) < 1e-9).map(x => x.p);
  return { ...best, pressures, channel: target.channel, key, tolerance: 5,
    description: target.mode === 'gradient' ? 'Strongest positive gradient across 6–8 dbar, after a ±2 dbar median filter.' :
      `Measured ${target.mode === 'min' ? 'minimum' : 'maximum'} after a ±2 dbar median filter.${best.edge ? ' At an edge of a measured segment; an interior extremum is not required.' : ''}` };
}

// Every target this cast can support; targets without enough informative data are absent.
export function findLayers(profile) {
  return Object.keys(targets).map(key => findLayer(profile, key)).filter(Boolean);
}
// Fewer bottles than layers, so every closure is a choice.
export function bottleCount(layerCount) {
  return Math.max(1, Math.min(layerCount - 1, Math.ceil(layerCount * 2 / 3)));
}
// Pressure error at which a bottle stops scoring. It grows with cast depth so the
// catch window stays a similar fraction of the chart and of the upcast time.
export function reach(maximum) {
  return Math.max(8, Math.min(30, maximum * .06));
}
export function scoreBottle(pressure, layer, limit = layer.tolerance * 4) {
  const error = Math.min(...layer.pressures.map(p => Math.abs(p - pressure)));
  return { pressure, error, points: Math.round(100 * Math.max(0, 1 - error / limit)) };
}
// Bottles are taken in firing order. Each counts toward the nearest layer it scores for;
// layers within 2 dbar of that nearest error count as coincident, and the bottle goes to
// whichever of them holds the lowest score, so stacked layers take one bottle each.
// Each layer keeps its best bottle; the cast total is the sum over layers.
export function scoreCast(pressures, layers, limit) {
  const held = new Map(layers.map(layer => [layer.key, { key: layer.key, points: 0, pressure: null }]));
  const bottles = pressures.map(pressure => {
    const scoring = layers.map(layer => ({ key: layer.key, ...scoreBottle(pressure, layer, limit) })).filter(s => s.points > 0);
    if (!scoring.length) return { key: null, pressure, error: null, points: 0 };
    const nearest = Math.min(...scoring.map(s => s.error));
    const chosen = scoring.filter(s => s.error - nearest <= 2)
      .reduce((a, b) => held.get(b.key).points < held.get(a.key).points ? b : a);
    if (chosen.points > held.get(chosen.key).points) held.set(chosen.key, { key: chosen.key, points: chosen.points, pressure });
    return chosen;
  });
  const results = [...held.values()];
  return { bottles, layers: results, points: results.reduce((sum, r) => sum + r.points, 0) };
}
export function advance(state, dt, maximum, speed) {
  if (!['down', 'up'].includes(state.phase)) return state;
  const pressure = Math.max(0, Math.min(maximum, state.pressure + (state.phase === 'down' ? 1 : -1) * dt * speed));
  return { ...state, pressure, phase: pressure >= maximum && state.phase === 'down' ? 'bottom' :
    pressure <= 0 && state.phase === 'up' ? 'done' : state.phase };
}
