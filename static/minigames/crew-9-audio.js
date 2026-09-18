// Crazy Net sound: an original two-stroke "ring-ding" synth loop plus catch, bump and till cues.
// Everything is generated with WebAudio, so no audio files are shipped. Silent until the player turns it on.

const BPM = 152;
const BEAT = 60 / BPM;
// Sixteenth-note lead line, MIDI numbers, 0 = rest. Two four-bar phrases in A minor.
const LEAD = [
  69, 0, 69, 72, 71, 0, 69, 0, 76, 0, 74, 0, 72, 0, 0, 0,
  69, 0, 69, 72, 71, 0, 69, 0, 67, 0, 69, 0, 71, 0, 0, 0,
  74, 0, 74, 76, 74, 0, 72, 0, 69, 0, 72, 0, 71, 0, 0, 0,
  67, 0, 69, 0, 71, 0, 72, 0, 74, 0, 76, 0, 77, 76, 74, 0,
  81, 0, 81, 84, 83, 0, 81, 0, 88, 0, 86, 0, 84, 0, 0, 0,
  81, 0, 81, 84, 83, 0, 81, 0, 79, 0, 81, 0, 83, 0, 0, 0,
  86, 0, 86, 88, 86, 0, 84, 0, 81, 0, 84, 0, 83, 0, 0, 0,
  79, 0, 81, 0, 83, 0, 84, 0, 86, 0, 88, 0, 89, 88, 86, 0,
];
const BASS = [45, 45, 52, 45, 41, 41, 48, 41, 43, 43, 50, 43, 40, 40, 47, 47];
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export function createAudio() {
  let context = null, master = null, loopTimer = null, nextBar = 0, bar = 0, enabled = false, engine = null;

  function ensure() {
    if (context) return context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);
    return context;
  }

  function blip(freq, at, length, type = 'square', gain = 0.18, dest = master) {
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  function hat(at, gain = 0.05) {
    const buffer = context.createBuffer(1, 1200, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = context.createBufferSource(), env = context.createGain(), filter = context.createBiquadFilter();
    source.buffer = buffer;
    filter.type = 'highpass'; filter.frequency.value = 6000;
    env.gain.value = gain;
    source.connect(filter).connect(env).connect(master);
    source.start(at);
  }

  function scheduleBar(at, index) {
    const sixteenth = BEAT / 4;
    for (let i = 0; i < 16; i++) {
      const t = at + i * sixteenth;
      const note = LEAD[(index % 8) * 16 + i];
      if (note) blip(hz(note), t, sixteenth * 1.6, 'square', 0.14);
      if (i % 4 === 0) blip(hz(BASS[(index % 4) * 4 + i / 4]), t, BEAT * 0.9, 'triangle', 0.22);
      if (i % 2 === 0) hat(t, i % 4 === 2 ? 0.07 : 0.035);
    }
    // The two-stroke engine: a detuned saw revving up over the bar, with a vibrato "ring-ding-ding" on beat 3.
    if (index % 2 === 1) {
      const t = at + BEAT * 2;
      for (let k = 0; k < 3; k++) blip(hz(57 + k * 12), t + k * 0.09, 0.12, 'sawtooth', 0.09);
    }
  }

  function pump() {
    if (!enabled || !context) return;
    while (nextBar < context.currentTime + 0.6) {
      scheduleBar(nextBar, bar);
      bar += 1;
      nextBar += BEAT * 4;
    }
  }

  function startEngine() {
    if (engine || !context) return;
    const osc = context.createOscillator(), env = context.createGain(), lfo = context.createOscillator(), depth = context.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 55;
    lfo.type = 'sine'; lfo.frequency.value = 9; depth.gain.value = 6;
    lfo.connect(depth).connect(osc.frequency);
    env.gain.value = 0.05;
    osc.connect(env).connect(master);
    osc.start(); lfo.start();
    engine = { osc, lfo, env };
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      if (enabled) {
        if (!ensure()) { enabled = false; return false; }
        context.resume?.();
        nextBar = context.currentTime + 0.05;
        pump();
        loopTimer = setInterval(pump, 200);
        startEngine();
      } else {
        clearInterval(loopTimer); loopTimer = null;
        if (engine) { engine.osc.stop(); engine.lfo.stop(); engine = null; }
      }
      return enabled;
    },
    // Engine pitch follows the winch: higher when hauling, lower when veering.
    rev(amount) {
      if (!engine) return;
      engine.osc.frequency.setTargetAtTime(55 + amount * 30, context.currentTime, 0.08);
    },
    catchSound(first = false) {
      if (!enabled) return;
      const t = context.currentTime;
      blip(880, t, 0.08, 'square', 0.12);
      blip(1320, t + 0.07, 0.1, 'square', 0.12);
      if (first) blip(1760, t + 0.15, 0.2, 'square', 0.12);
    },
    missSound() {
      if (!enabled) return;
      blip(330, context.currentTime, 0.1, 'triangle', 0.08);
    },
    bumpSound() {
      if (!enabled) return;
      const t = context.currentTime;
      blip(90, t, 0.25, 'sawtooth', 0.25);
      blip(60, t + 0.05, 0.3, 'square', 0.2);
    },
    tillSound() {
      if (!enabled) return;
      const t = context.currentTime;
      [1047, 1319, 1568, 2093].forEach((f, i) => blip(f, t + i * 0.06, 0.25, 'triangle', 0.14));
    },
    dispose() {
      clearInterval(loopTimer); loopTimer = null;
      enabled = false;
      if (engine) { try { engine.osc.stop(); engine.lfo.stop(); } catch { /* already stopped */ } engine = null; }
      if (context) { context.close?.(); context = null; master = null; }
    },
  };
}
