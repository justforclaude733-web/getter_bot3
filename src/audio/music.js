// Neon "outrun" background music for the Ride game, synthesized live and
// looped: four-on-the-floor drums, a driving bass, a pumping pad, a 16th
// arpeggio and a lead hook over Am - F - C - G at 118 BPM.
//
// The scheduler runs a little ahead of the audio clock (the usual Web Audio
// look-ahead pattern) so timing stays tight regardless of UI jank. Layers
// fade in and out with `setIntensity` (menu/result = pads + bass, playing =
// the full track).

const BPM = 118;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
const STEPS_PER_BAR = 16;
const BARS = 4;
const LOOKAHEAD = 0.14; // seconds of audio scheduled ahead
const TICK_MS = 30;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Am - F - C - G
const CHORDS = [
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [53, 57, 60] },
  { root: 48, tones: [55, 60, 64] },
  { root: 43, tones: [55, 59, 62] },
];

// Lead hook per bar: [start step, length in steps, midi note].
const HOOK = [
  [[0, 6, 76], [6, 2, 74], [8, 4, 72], [12, 4, 69]],
  [[0, 6, 72], [6, 2, 69], [8, 4, 65], [12, 4, 69]],
  [[0, 6, 76], [6, 2, 79], [8, 4, 76], [12, 4, 72]],
  [[0, 6, 74], [6, 2, 71], [8, 4, 67], [12, 4, 71]],
];

const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 1];

const smooth = (x, a, b) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function createMusic(ctx, out, noiseBuffer) {
  // ---- buses ----
  const drumBus = ctx.createGain();
  const bassBus = ctx.createGain();
  const padBus = ctx.createGain();
  const arpBus = ctx.createGain();
  const leadBus = ctx.createGain();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  for (const b of [drumBus, bassBus, padBus, arpBus, leadBus]) b.connect(master);
  master.connect(out.dry);

  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.35;
  drumBus.connect(reverbSend);
  padBus.connect(reverbSend);
  reverbSend.connect(out.wet);

  // Dotted-eighth echo on the arp and the lead - the classic synthwave
  // shimmer.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = (60 / BPM) * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = "lowpass";
  delayTone.frequency.value = 2600;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.42;
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(delayOut);
  delayOut.connect(master);
  arpBus.connect(delay);
  leadBus.connect(delay);

  const state = { intensity: 0.5 };
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let running = false;

  function applyIntensity(rampSeconds = 0.5) {
    const now = ctx.currentTime;
    const i = state.intensity;
    const set = (bus, v) => {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(v, now, rampSeconds / 3);
    };
    set(drumBus, 0.9 * smooth(i, 0.4, 0.7));
    set(bassBus, 0.85);
    set(padBus, 0.75);
    set(arpBus, 0.35 + 0.65 * smooth(i, 0.1, 0.8));
    set(leadBus, 0.9 * smooth(i, 0.72, 0.95));
  }

  // ---- voices ----
  function noiseHit(t, dur, peak, filter, bus, wet = 0) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.f;
    f.Q.value = filter.Q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(reverbSend);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  function kick(t) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(155, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g);
    g.connect(drumBus);
    osc.start(t);
    osc.stop(t + 0.34);
    noiseHit(t, 0.012, 0.25, { type: "highpass", f: 2500 }, drumBus);
    // Sidechain-style pump: the pad and bass duck on every kick.
    for (const bus of [padBus, bassBus]) {
      const target = bus === padBus ? 0.75 : 0.85;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(target * 0.35, t);
      bus.gain.linearRampToValueAtTime(target, t + 0.2);
    }
  }

  function clap(t) {
    for (const d of [0, 0.011, 0.023]) {
      noiseHit(t + d, 0.09, 0.32, { type: "bandpass", f: 1500, Q: 0.9 }, drumBus, 0.25);
    }
    noiseHit(t + 0.025, 0.2, 0.22, { type: "bandpass", f: 1900, Q: 0.7 }, drumBus, 0.35);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g);
    g.connect(drumBus);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  function hat(t, open, level = 1) {
    noiseHit(t, open ? 0.2 : 0.045, 0.1 * level, { type: "highpass", f: 7500 }, drumBus);
  }

  function crash(t) {
    noiseHit(t, 1.4, 0.16, { type: "highpass", f: 5500 }, drumBus, 0.4);
  }

  function bass(t, midiNote, len, accent) {
    const f = midi(midiNote);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 5;
    const cutoff = 260 + 900 * state.intensity;
    filter.frequency.setValueAtTime(cutoff * (accent ? 2.2 : 1.6), t);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.55, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.3 : 0.24, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const [type, mult, level] of [["sawtooth", 1, 1], ["square", 0.5, 0.7]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const lg = ctx.createGain();
      lg.gain.value = level;
      osc.connect(lg);
      lg.connect(filter);
      osc.start(t);
      osc.stop(t + len + 0.03);
    }
    filter.connect(g);
    g.connect(bassBus);
  }

  function pad(t, chord, len) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500 + 900 * state.intensity;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.35);
    g.gain.setValueAtTime(0.06, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.25);
    filter.connect(g);
    g.connect(padBus);
    for (const n of chord.tones) {
      for (const det of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midi(n);
        osc.detune.value = det;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + len + 0.3);
      }
    }
  }

  function arp(t, midiNote, accent) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midi(midiNote);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3600, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.11);
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.085 : 0.06, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(f);
    f.connect(g);
    g.connect(arpBus);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  function lead(t, midiNote, len) {
    const dur = len * STEP;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2600;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.015);
    g.gain.setValueAtTime(0.075, t + Math.max(0.03, dur - 0.09));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    g.connect(leadBus);
    // Gentle vibrato that fades in after the attack.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(7, t + 0.25);
    lfo.connect(lfoGain);
    for (const det of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midi(midiNote);
      osc.detune.value = det;
      lfoGain.connect(osc.detune);
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  function scheduleStep(s, t) {
    const bar = Math.floor(s / STEPS_PER_BAR) % BARS;
    const k = s % STEPS_PER_BAR;
    const chord = CHORDS[bar];
    const i = state.intensity;

    if (k === 0) pad(t, chord, STEP * STEPS_PER_BAR);

    // Bass: eighth notes, jumping an octave on the "and" of 2 and 4.
    if (k % 2 === 0) {
      const octave = k === 6 || k === 14;
      bass(t, chord.root + (octave ? 12 : 0), STEP * 1.9, k % 8 === 0);
    }

    // Arp: 16ths on the chord tones.
    const idx = ARP_PATTERN[k];
    const tone = idx === 3 ? chord.tones[0] + 24 : chord.tones[idx] + 12;
    if (i > 0.1) arp(t, tone, k % 4 === 0);

    // Drums.
    if (i > 0.4) {
      if (k % 4 === 0) kick(t);
      if (bar % 2 === 1 && k === 10) kick(t);
      if (k === 4 || k === 12) clap(t);
      if (k % 4 === 2) hat(t, k === 14);
      else if (i > 0.85 && k % 2 === 1) hat(t, false, 0.5);
      if (s % (STEPS_PER_BAR * BARS) === 0 && i > 0.8) crash(t);
    }

    // Lead hook.
    if (i > 0.72) {
      for (const [start, len, note] of HOOK[bar]) {
        if (start === k) lead(t, note, len);
      }
    }
  }

  function tick() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      nextTime += STEP;
      step = (step + 1) % (STEPS_PER_BAR * BARS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      step = 0;
      nextTime = ctx.currentTime + 0.1;
      applyIntensity(0.1);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.8);
      timer = setInterval(tick, TICK_MS);
      tick();
    },

    stop(fadeSeconds = 0.6) {
      if (!running) return;
      running = false;
      clearInterval(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
    },

    isRunning: () => running,

    setIntensity(value, rampSeconds = 0.5) {
      state.intensity = Math.min(1, Math.max(0, value));
      if (running) applyIntensity(rampSeconds);
    },

    // Briefly drop the music (a crash, a big sound) and bring it back.
    duck(seconds = 0.8, depth = 0.15) {
      if (!running) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.8 * depth, now + 0.05);
      master.gain.linearRampToValueAtTime(0.8, now + seconds);
    },

    // Only used by tests: schedule `steps` steps immediately from t = 0.
    _renderOffline(steps) {
      state.intensity = state.intensity;
      applyIntensity(0.01);
      master.gain.setValueAtTime(0.8, 0);
      for (let s = 0; s < steps; s++) scheduleStep(s % (STEPS_PER_BAR * BARS), 0.05 + s * STEP);
    },
  };
}

export const MUSIC_TIMING = { BPM, STEP };
