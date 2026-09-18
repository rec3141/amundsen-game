// The Raft: piston-coring an emerged coastal lake from an inflatable platform.
// Everything random is drawn from seeds so the UI can be shadowed deterministically.

export const DRIVES = 3;
// A hand winch on the tripod winds line in at a steady rate; tension climbs with it while the core holds.
export const HAUL_KG_PER_S = 14;
export const RIG_KG = 6;
export const ROD_KG_PER_M = 1.2;
export const RAFT_LIMIT_KG = [80, 165];
// A core shorter than this cannot be logged and scores nothing, though the tube still has to come up.
export const MIN_CORE_CM = 100;
// Leaving a tube in the lake bed costs a flat loss plus a charge per centimetre of core inside it.
export const ABANDON_BASE = 20;
export const ABANDON_PER_CM = 0.25;
// Each drive is made a few metres from the last: the same sequence of layers, with thicknesses that wander this much.
export const SITE_JITTER = 0.18;

// Stratigraphy of a tundra lake that was cut off from the sea by isostatic uplift, top down.
// adhesion: line tension needed per centimetre of tube wall in the layer, kg/cm.
// stroke: how far one hammer blow drives the tube, cm. rate: points per centimetre recovered, rising with age.
// bonus: awarded once a recovered core is found to contain the layer.
export const PROFILE = [
  { key: 'gyttja', name: 'Gyttja', note: 'olive-brown organic mud, soft', thickness: [90, 170], adhesion: 0.11, stroke: 12, rate: 0.3, bonus: 0, colour: '#5b5a2e' },
  { key: 'contact', name: 'Isolation contact', note: 'laminated brackish silt, the basin leaving the sea', thickness: [6, 14], adhesion: 0.25, stroke: 10, rate: 0.6, bonus: 25, colour: '#8a7f55' },
  { key: 'marine', name: 'Marine clay', note: 'grey silty clay with shell fragments', thickness: [80, 160], adhesion: 0.42, stroke: 8, rate: 0.6, bonus: 0, colour: '#7d8489' },
  { key: 'diamict', name: 'Glaciomarine diamicton', note: 'stony mud, dropstones from calving ice', thickness: [40, 90], adhesion: 0.85, stroke: 4, rate: 1, bonus: 40, colour: '#5f6366' },
  { key: 'till', name: 'Till', note: 'refusal', thickness: [400, 400], adhesion: 2, stroke: 0, rate: 0, bonus: 60, colour: '#43423c' },
];

// Cue thresholds, as a fraction of the raft's breaking load. Jitter keeps them from reading the limit off directly.
const CUES = [
  { key: 'tilt', at: 0.45, text: 'The deck tilts toward the tripod.' },
  { key: 'awash', at: 0.63, text: 'Water sheets across the upwind pontoon.' },
  { key: 'creak', at: 0.78, text: 'Something creaks under the tripod feet.' },
  { key: 'screw', at: 0.9, text: 'A deck screw pops.' },
];

export function seededRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const between = (random, [low, high]) => low + random() * (high - low);

function stack(thicknesses) {
  let top = 0;
  return PROFILE.map((layer, i) => {
    const entry = { ...layer, topCm: top, bottomCm: top + thicknesses[i] };
    top += thicknesses[i];
    return entry;
  });
}

export function createSession({ lakeSeed = 'lake', raftSeed = 'raft' } = {}) {
  const lake = seededRandom(lakeSeed);
  // The basin's profile: every drive site is a variation on it.
  const basin = stack(PROFILE.map(layer => Math.round(between(lake, layer.thickness))));
  const raft = seededRandom(raftSeed);
  const limitKg = Math.round(between(raft, RAFT_LIMIT_KG));
  const cues = CUES.map(cue => ({ ...cue, at: cue.at + (raft() - 0.5) * 0.1 }));
  const state = {
    basin,
    limitKg,
    cues,
    random: raft,
    cores: [],
    core: null,
    bank: 0,
    finished: false,
    broken: false,
    reported: false,
    knownSafeKg: 0,
  };
  newCore(state);
  return state;
}

// Deepest point any drive at this lake can reach: the basin's till, at the far end of the site jitter.
export const maxDepthCm = state => Math.ceil(state.basin[state.basin.length - 1].topCm * (1 + SITE_JITTER));

export function layerAt(state, depthCm, core = state.core) {
  return core.layers.find(layer => depthCm < layer.bottomCm) ?? core.layers[core.layers.length - 1];
}

function newCore(state) {
  const layers = stack(state.basin.map(layer => Math.max(2, Math.round((layer.bottomCm - layer.topCm) * (1 + (state.random() * 2 - 1) * SITE_JITTER)))));
  state.core = {
    index: state.cores.length + 1,
    layers,
    refusalCm: layers[layers.length - 1].topCm,
    depthCm: 0,
    phase: 'drive',
    tensionKg: 0,
    peakKg: 0,
    extractKg: null,
    shifted: false,
    stopped: null,
    lastStrokeCm: null,
    bonuses: [],
    cues: [],
  };
}

// Tension the line must reach before the barrel breaks free: rig and rods, plus wall adhesion through every layer cored.
export function pullEstimateKg(state, core = state.core) {
  let total = RIG_KG + ROD_KG_PER_M * core.depthCm / 100;
  for (const layer of core.layers) {
    const cored = Math.min(core.depthCm, layer.bottomCm) - layer.topCm;
    if (cored > 0) total += cored * layer.adhesion;
  }
  return total;
}

// Layers a core holds, top down, clipped to the drive depth.
export function coreSegments(core) {
  return core.layers.filter(layer => layer.topCm < core.depthCm).map(layer => ({ layer, top: layer.topCm, bottom: Math.min(layer.bottomCm, core.depthCm) }));
}

// What the mud in the tube is worth once split and logged: per-centimetre rates plus the layer bonuses.
export function coreWorth(state, core = state.core) {
  const cm = coreSegments(core).reduce((sum, segment) => sum + (segment.bottom - segment.top) * segment.layer.rate, 0);
  return Math.round(cm) + core.bonuses.reduce((sum, bonus) => sum + bonus.points, 0);
}

// Points a recovered core pays: nothing under a metre.
export function coreValue(state, core = state.core) {
  return core.depthCm < MIN_CORE_CM ? 0 : coreWorth(state, core);
}

export const abandonPenalty = core => Math.round(ABANDON_BASE + ABANDON_PER_CM * core.depthCm);

export const drivesLeft = state => DRIVES - state.cores.length;

// One push on the rods. Reports how far it went and whether the drive has hit refusal; the layers stay in the ground, unseen.
export function push(state) {
  const core = state.core;
  if (state.finished || core.phase !== 'drive' || core.stopped) return null;
  const layer = layerAt(state, core.depthCm);
  let stroke = layer.stroke;
  let stopped = null;
  // Dropstones sit in the diamicton; the barrel that lands on one goes no further.
  if (layer.key === 'diamict' && state.random() < 0.03) {
    stroke = Math.round(stroke * state.random());
    stopped = 'dropstone';
  }
  const depth = Math.min(core.refusalCm, core.depthCm + stroke);
  const strokeCm = depth - core.depthCm;
  core.depthCm = depth;
  core.lastStrokeCm = strokeCm;
  if (depth >= core.refusalCm) stopped = 'till';
  core.stopped = stopped;
  // A long stroke can pass straight through a thin band; every layer the barrel has entered still counts once it is logged.
  core.layers.filter(l => l.bonus && !core.bonuses.some(b => b.key === l.key) && depth >= l.topCm + (l.stroke ? 1 : 0))
    .forEach(l => core.bonuses.push({ key: l.key, name: l.name, points: l.bonus }));
  return { strokeCm, stopped, depthCm: depth };
}

export function beginPull(state) {
  const core = state.core;
  if (state.finished || core.phase !== 'drive' || core.depthCm === 0) return false;
  core.phase = 'pull';
  // The barrel's real grip sits near the adhesion estimate; suction on a stiff base can push it well past.
  const spread = 0.88 + state.random() * 0.26;
  core.extractKg = Math.round(pullEstimateKg(state) * spread * 10) / 10;
  return true;
}

// Winds the winch for dt seconds. Returns the events raised, in order: cue keys, 'shift', 'pop', 'break'.
export function haul(state, dt) {
  const core = state.core;
  if (state.finished || core.phase !== 'pull') return [];
  const events = [];
  core.tensionKg = Math.min(core.tensionKg + HAUL_KG_PER_S * dt, 250);
  core.peakKg = Math.max(core.peakKg, core.tensionKg);
  if (core.tensionKg >= state.limitKg) {
    core.phase = 'lost';
    state.broken = true;
    state.finished = true;
    return ['break'];
  }
  for (const cue of state.cues) {
    if (!core.cues.includes(cue.key) && core.tensionKg >= cue.at * state.limitKg) {
      core.cues.push(cue.key);
      events.push(cue.key);
    }
  }
  if (!core.shifted && core.tensionKg >= core.extractKg * 0.9) {
    core.shifted = true;
    events.push('shift');
  }
  if (core.tensionKg >= core.extractKg) {
    core.phase = 'recovered';
    state.knownSafeKg = Math.max(state.knownSafeKg, core.peakKg);
    // Every hard pull works the deck fittings looser.
    const strain = core.peakKg - state.limitKg * 0.6;
    if (strain > 0) state.limitKg = Math.max(core.peakKg + 2, Math.round(state.limitKg - strain * 0.3));
    const value = coreValue(state);
    state.bank += value;
    state.cores.push({ ...core, points: value, outcome: 'recovered' });
    events.push('pop');
  }
  return events;
}

// Slackens the line and leaves the tube in the lake bed. Costs the tube, a charge per centimetre and a drive.
export function abandon(state) {
  const core = state.core;
  if (state.finished || core.phase !== 'pull') return null;
  core.phase = 'lost';
  core.tensionKg = 0;
  state.knownSafeKg = Math.max(state.knownSafeKg, core.peakKg);
  const penalty = abandonPenalty(core);
  state.bank -= penalty;
  state.cores.push({ ...core, points: -penalty, outcome: 'abandoned' });
  return penalty;
}

export function nextCore(state) {
  if (state.finished || !['recovered', 'lost'].includes(state.core.phase) || drivesLeft(state) <= 0) return false;
  newCore(state);
  return true;
}

// Paddling in is allowed between cores: after a pull has ended, or before the next tube has been driven.
export const canFinish = state => !state.finished && state.cores.length > 0 && (['recovered', 'lost'].includes(state.core.phase) || (state.core.phase === 'drive' && state.core.depthCm === 0));

export function points(state) {
  return state.broken ? 0 : Math.max(0, state.bank);
}

// Reports the session once: after paddling in, or after the raft has broken.
export function finish(state, reason = 'paddled in') {
  if (state.reported || !(state.broken || canFinish(state))) return null;
  state.finished = true;
  state.reported = true;
  const recovered = state.cores.filter(core => core.outcome === 'recovered');
  const longest = recovered.reduce((best, core) => Math.max(best, core.depthCm), 0);
  return {
    points: points(state),
    detail: {
      title: state.broken ? 'The Raft: platform broke up' : `The Raft: ${recovered.length} core${recovered.length === 1 ? '' : 's'} · longest ${longest} cm`,
      outcome: state.broken ? 'raft broke' : reason,
      raftLimitKg: state.limitKg,
      longestCm: longest,
      cores: state.cores.map(core => ({
        depthCm: core.depthCm,
        outcome: core.outcome,
        points: core.points,
        peakKg: Math.round(core.peakKg),
        extractKg: core.extractKg,
        // Only a core that came up gets split and logged.
        layers: core.outcome === 'recovered' ? coreSegments(core).filter(s => s.layer.key !== 'till').map(s => ({ key: s.layer.key, topCm: s.top, bottomCm: s.bottom })) : null,
      })),
    },
  };
}

export function cueText(state, key) {
  return state.cues.find(cue => cue.key === key)?.text ?? '';
}
