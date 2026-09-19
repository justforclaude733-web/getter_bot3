// Every sound effect in the app, synthesized with the Web Audio API - no
// audio files to bundle or license. Each sound is a function
//   (ctx, out, t, options) => void
// that schedules its nodes to start at absolute time `t` and writes to
// `out.dry` (straight to the mix) and `out.wet` (reverb send).

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const semis = (base, n) => base * Math.pow(2, n / 12);

// ---------------------------------------------------------------- helpers

const noiseCache = new WeakMap();

export function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function send(ctx, out, node, wet) {
  if (!wet) return;
  const w = ctx.createGain();
  w.gain.value = wet;
  node.connect(w);
  w.connect(out.wet);
}

// One oscillator with a pitch glide, a peak/decay envelope and an optional
// filter.
function voice(ctx, out, o) {
  const { t, type = "sine", f0, f1 = null, dur = 0.2, peak = 0.2, attack = 0.004, detune = 0, wet = 0, filter = null } = o;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));

  let node = osc;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.Q.value = filter.Q ?? 0.7;
    f.frequency.setValueAtTime(filter.f0, t);
    if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
    osc.connect(f);
    node = f;
  }
  node.connect(gain);
  gain.connect(out.dry);
  send(ctx, out, gain, wet);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return gain;
}

// Filtered noise with a sweeping filter - the workhorse for whooshes,
// blasts, hats and clicks.
function noise(ctx, out, o) {
  const { t, dur = 0.2, peak = 0.2, attack = 0.004, filter = { type: "lowpass", f0: 4000 }, wet = 0, shape = "decay", hold = 0 } = o;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter.type;
  f.Q.value = filter.Q ?? 0.7;
  f.frequency.setValueAtTime(filter.f0, t);
  if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  if (shape === "swell") {
    // Rises to a peak at ~70% of the duration, then drops off - whooshes.
    gain.gain.exponentialRampToValueAtTime(peak, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  } else {
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    if (hold) gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  src.connect(f);
  f.connect(gain);
  gain.connect(out.dry);
  send(ctx, out, gain, wet);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  return gain;
}

// A struck-bell tone: a few inharmonic partials with different decay times.
function bell(ctx, out, { t, f, peak = 0.15, dur = 0.6, wet = 0.3 }) {
  const partials = [
    [1, 1, 1],
    [2.76, 0.45, 0.6],
    [5.4, 0.22, 0.4],
    [8.93, 0.1, 0.25],
  ];
  for (const [ratio, amp, decay] of partials) {
    if (f * ratio > 15000) continue;
    voice(ctx, out, { t, type: "sine", f0: f * ratio, dur: dur * decay, peak: peak * amp, attack: 0.002, wet });
  }
}

// A coin-like ping: two bright partials, very short.
function ping(ctx, out, { t, f, peak = 0.16, wet = 0.25 }) {
  voice(ctx, out, { t, type: "sine", f0: f, dur: 0.32, peak, attack: 0.001, wet });
  voice(ctx, out, { t, type: "sine", f0: f * 2.41, dur: 0.14, peak: peak * 0.45, attack: 0.001, wet });
}

// ------------------------------------------------------------- UI sounds

export const SFX = {
  // Every button press.
  tap(ctx, out, t, o = {}) {
    const r = o.pitch ?? 1;
    voice(ctx, out, { t, type: "sine", f0: 1900 * r, f1: 1250 * r, dur: 0.05, peak: 0.23, attack: 0.001 });
    noise(ctx, out, { t, dur: 0.02, peak: 0.1, attack: 0.001, filter: { type: "highpass", f0: 3500 } });
  },

  // Bottom-nav tabs: a different note per tab (major pentatonic), so
  // moving around plays a little scale.
  nav(ctx, out, t, o = {}) {
    const steps = [0, 2, 4, 7, 9, 12];
    const f = semis(523.25, steps[clamp(o.index ?? 0, 0, steps.length - 1)]);
    voice(ctx, out, { t, type: "triangle", f0: f, dur: 0.13, peak: 0.17, attack: 0.002, wet: 0.18 });
    voice(ctx, out, { t, type: "sine", f0: f * 2, dur: 0.09, peak: 0.05, attack: 0.002, wet: 0.18 });
  },

  // Close / back.
  back(ctx, out, t) {
    voice(ctx, out, { t, type: "sine", f0: 1250, f1: 720, dur: 0.07, peak: 0.15, attack: 0.001 });
    noise(ctx, out, { t, dur: 0.02, peak: 0.05, attack: 0.001, filter: { type: "highpass", f0: 3000 } });
  },

  // Confirm buttons: a tap with a bit of weight.
  confirm(ctx, out, t) {
    SFX.tap(ctx, out, t, { pitch: 0.85 });
    voice(ctx, out, { t, type: "sine", f0: 240, f1: 150, dur: 0.09, peak: 0.13, attack: 0.002 });
  },

  sheetOpen(ctx, out, t) {
    noise(ctx, out, { t, dur: 0.17, peak: 0.3, shape: "swell", filter: { type: "bandpass", f0: 500, f1: 2600, Q: 1.1 } });
    voice(ctx, out, { t, type: "sine", f0: 620, f1: 980, dur: 0.12, peak: 0.07, attack: 0.01, wet: 0.1 });
  },

  sheetClose(ctx, out, t) {
    noise(ctx, out, { t, dur: 0.14, peak: 0.26, shape: "swell", filter: { type: "bandpass", f0: 2200, f1: 450, Q: 1.1 } });
  },

  // ----- feedback (wired to notify()) -----

  // Coin ping - purchases, sales, rewards, claims.
  success(ctx, out, t) {
    ping(ctx, out, { t, f: 1567.98 });
    ping(ctx, out, { t: t + 0.085, f: 2093, peak: 0.19 });
  },

  // A little cascade of coins - for bigger payouts.
  coins(ctx, out, t, o = {}) {
    const notes = [2093, 2349, 2637, 3136, 2793, 3520];
    const n = clamp(o.count ?? 5, 2, 8);
    for (let i = 0; i < n; i++) {
      ping(ctx, out, { t: t + i * 0.06 + Math.random() * 0.015, f: notes[Math.floor(Math.random() * notes.length)], peak: 0.13, wet: 0.3 });
    }
  },

  error(ctx, out, t) {
    const filter = { type: "lowpass", f0: 1400 };
    voice(ctx, out, { t, type: "square", f0: 196, f1: 150, dur: 0.11, peak: 0.11, filter });
    voice(ctx, out, { t: t + 0.13, type: "square", f0: 165, f1: 124, dur: 0.14, peak: 0.11, filter });
  },

  warning(ctx, out, t) {
    voice(ctx, out, { t, type: "triangle", f0: 440, f1: 392, dur: 0.12, peak: 0.14 });
    voice(ctx, out, { t: t + 0.15, type: "triangle", f0: 440, f1: 392, dur: 0.14, peak: 0.14 });
  },

  // ----- chat -----

  // Message sent: a quick upward swoosh with a soft pop.
  sent(ctx, out, t) {
    voice(ctx, out, { t, type: "sine", f0: 520, f1: 1000, dur: 0.09, peak: 0.13, attack: 0.003 });
    noise(ctx, out, { t, dur: 0.08, peak: 0.05, filter: { type: "highpass", f0: 2500, f1: 6500 } });
  },

  // Message received: two soft rising notes.
  received(ctx, out, t) {
    voice(ctx, out, { t, type: "triangle", f0: 988, dur: 0.18, peak: 0.13, wet: 0.3 });
    voice(ctx, out, { t: t + 0.09, type: "triangle", f0: 1319, dur: 0.24, peak: 0.13, wet: 0.35 });
    voice(ctx, out, { t: t + 0.09, type: "sine", f0: 2638, dur: 0.14, peak: 0.03, wet: 0.35 });
  },

  // Crumple - deleting a conversation.
  delete(ctx, out, t) {
    for (let i = 0; i < 6; i++) {
      noise(ctx, out, {
        t: t + i * 0.034 + Math.random() * 0.01,
        dur: 0.05,
        peak: 0.3,
        attack: 0.002,
        filter: { type: "bandpass", f0: 600 + Math.random() * 1200, Q: 2.5 },
      });
    }
  },

  // ----- cards -----

  // New card reveal. `tier` is the rarity glow level (0-2): the higher it
  // is, the longer the sparkle run and the bigger the finish.
  reveal(ctx, out, t, o = {}) {
    const tier = clamp(o.tier ?? 0, 0, 3);
    noise(ctx, out, { t, dur: 0.5, peak: 0.1, shape: "swell", wet: 0.2, filter: { type: "bandpass", f0: 400, f1: 3400, Q: 1.4 } });
    voice(ctx, out, { t, type: "sine", f0: 300, f1: 900, dur: 0.45, peak: 0.07, attack: 0.05, wet: 0.2 });

    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19];
    const count = 4 + tier * 2;
    const start = t + 0.34;
    for (let i = 0; i < count; i++) {
      bell(ctx, out, { t: start + i * 0.075, f: semis(659.25, scale[Math.min(i, scale.length - 1)]), peak: 0.13, dur: 0.85, wet: 0.4 });
    }
    const end = start + count * 0.075;
    if (tier >= 1) {
      // A soft major chord to land on.
      for (const s of [0, 4, 7]) {
        voice(ctx, out, { t: end, type: "triangle", f0: semis(440, s), dur: 1.1, peak: 0.07, attack: 0.03, wet: 0.5 });
      }
    }
    if (tier >= 2) {
      voice(ctx, out, { t: t + 0.3, type: "sine", f0: 95, f1: 42, dur: 0.7, peak: 0.26, attack: 0.005, wet: 0.2 });
      noise(ctx, out, { t: end, dur: 0.9, peak: 0.05, wet: 0.5, filter: { type: "highpass", f0: 5000 } });
    }
  },

  // ----- arena -----

  fight(ctx, out, t) {
    const filter = { type: "lowpass", f0: 1200, f1: 320 };
    voice(ctx, out, { t, type: "sawtooth", f0: 110, dur: 0.55, peak: 0.13, attack: 0.02, filter, wet: 0.2 });
    voice(ctx, out, { t, type: "sawtooth", f0: 165, dur: 0.55, peak: 0.1, attack: 0.02, filter, wet: 0.2 });
    voice(ctx, out, { t, type: "sine", f0: 85, f1: 45, dur: 0.45, peak: 0.24, attack: 0.004 });
    noise(ctx, out, { t, dur: 0.18, peak: 0.12, filter: { type: "lowpass", f0: 1800, f1: 300 } });
  },

  victory(ctx, out, t) {
    [72, 76, 79, 84].forEach((n, i) => {
      voice(ctx, out, { t: t + i * 0.085, type: "sawtooth", f0: midi(n), dur: 0.2, peak: 0.1, filter: { type: "lowpass", f0: 3200 }, wet: 0.3 });
    });
    for (const n of [72, 76, 79]) {
      voice(ctx, out, { t: t + 0.34, type: "triangle", f0: midi(n), dur: 1.0, peak: 0.09, attack: 0.02, wet: 0.5 });
    }
    bell(ctx, out, { t: t + 0.34, f: midi(96), peak: 0.1, dur: 1.2, wet: 0.5 });
  },

  draw(ctx, out, t) {
    voice(ctx, out, { t, type: "triangle", f0: midi(67), dur: 0.22, peak: 0.13, wet: 0.25 });
    voice(ctx, out, { t: t + 0.2, type: "triangle", f0: midi(67), dur: 0.3, peak: 0.13, wet: 0.25 });
  },

  defeat(ctx, out, t) {
    [69, 65, 62, 57].forEach((n, i) => {
      voice(ctx, out, { t: t + i * 0.16, type: "sawtooth", f0: midi(n), dur: 0.26, peak: 0.1, filter: { type: "lowpass", f0: 1400 }, wet: 0.3 });
    });
    voice(ctx, out, { t: t + 0.5, type: "sine", f0: 80, f1: 40, dur: 0.7, peak: 0.22 });
  },

  // ----- Ride game -----

  jump(ctx, out, t) {
    voice(ctx, out, { t, type: "triangle", f0: 340, f1: 640, dur: 0.14, peak: 0.24, attack: 0.002 });
  },

  land(ctx, out, t, o = {}) {
    noise(ctx, out, { t, dur: 0.1, peak: 0.5 * Math.min(1.6, o.intensity ?? 1), attack: 0.001, filter: { type: "lowpass", f0: 1800, f1: 400 } });
  },

  crash(ctx, out, t) {
    noise(ctx, out, { t, dur: 0.34, peak: 0.4, attack: 0.001, wet: 0.25, filter: { type: "lowpass", f0: 5000, f1: 300 } });
    voice(ctx, out, { t, type: "sawtooth", f0: 130, f1: 35, dur: 0.34, peak: 0.22, wet: 0.2 });
    voice(ctx, out, { t, type: "sine", f0: 90, f1: 32, dur: 0.6, peak: 0.28 });
  },

  score(ctx, out, t) {
    voice(ctx, out, { t, type: "sine", f0: 820, f1: 1180, dur: 0.11, peak: 0.2, attack: 0.002 });
  },

  boost(ctx, out, t) {
    voice(ctx, out, { t, type: "sawtooth", f0: 200, f1: 900, dur: 0.32, peak: 0.24, attack: 0.005, filter: { type: "lowpass", f0: 900, f1: 5000 } });
    voice(ctx, out, { t, type: "triangle", f0: 500, f1: 1400, dur: 0.22, peak: 0.16 });
    noise(ctx, out, { t, dur: 0.16, peak: 0.2, filter: { type: "highpass", f0: 1500 } });
  },

  // Ride start: engine revving up into a neon stab.
  gameStart(ctx, out, t) {
    voice(ctx, out, { t, type: "sawtooth", f0: 55, f1: 190, dur: 0.6, peak: 0.16, attack: 0.03, filter: { type: "lowpass", f0: 300, f1: 2400 } });
    noise(ctx, out, { t, dur: 0.55, peak: 0.08, shape: "swell", filter: { type: "bandpass", f0: 300, f1: 2400, Q: 0.9 } });
    for (const n of [57, 64, 69]) {
      voice(ctx, out, { t: t + 0.55, type: "sawtooth", f0: midi(n), dur: 0.45, peak: 0.08, filter: { type: "lowpass", f0: 2600, f1: 500 }, wet: 0.3 });
    }
  },

  // Crashed: falling notes.
  gameOver(ctx, out, t) {
    [64, 60, 57, 52].forEach((n, i) => {
      voice(ctx, out, { t: t + 0.25 + i * 0.17, type: "square", f0: midi(n), dur: 0.3, peak: 0.08, filter: { type: "lowpass", f0: 1300 }, wet: 0.35 });
    });
  },

  // New personal best.
  newBest(ctx, out, t) {
    [69, 73, 76, 81, 85].forEach((n, i) => {
      bell(ctx, out, { t: t + i * 0.09, f: midi(n + 12), peak: 0.12, dur: 0.8, wet: 0.4 });
    });
    for (const n of [69, 73, 76]) {
      voice(ctx, out, { t: t + 0.45, type: "triangle", f0: midi(n), dur: 1.1, peak: 0.08, attack: 0.03, wet: 0.5 });
    }
  },

  // ----- boot sequence (timeline in bootSequence.js) -----

  // The four letters tumbling in from above: overlapping falling whooshes.
  bootFall(ctx, out, t) {
    for (let i = 0; i < 4; i++) {
      const s = t + i * 0.11;
      noise(ctx, out, { t: s, dur: 1.05, peak: 0.075, shape: "swell", wet: 0.2, filter: { type: "bandpass", f0: 3200 - i * 260, f1: 380, Q: 1.3 } });
      voice(ctx, out, { t: s, type: "sine", f0: 900 - i * 90, f1: 140, dur: 1.0, peak: 0.035, attack: 0.15 });
    }
    // Low air under it all.
    voice(ctx, out, { t, type: "sine", f0: 70, f1: 110, dur: 1.2, peak: 0.1, attack: 0.5 });
  },

  // A letter slamming into place: weighty thump plus a metallic ring.
  bootThunk(ctx, out, t, o = {}) {
    const i = clamp(o.index ?? 0, 0, 3);
    const root = [110, 130.81, 164.81, 220][i];
    voice(ctx, out, { t, type: "sine", f0: root * 1.6, f1: root * 0.55, dur: 0.22, peak: 0.3, attack: 0.002 });
    noise(ctx, out, { t, dur: 0.05, peak: 0.16, attack: 0.001, filter: { type: "lowpass", f0: 3500 } });
    for (const [ratio, amp] of [[4.1, 0.09], [6.3, 0.06], [9.6, 0.035]]) {
      voice(ctx, out, { t, type: "sine", f0: root * ratio, dur: 0.55, peak: amp, attack: 0.001, wet: 0.35 });
    }
  },

  // The glow coming up: rising bells over a swelling pad.
  bootShimmer(ctx, out, t) {
    [81, 84, 88, 93].forEach((n, i) => {
      bell(ctx, out, { t: t + i * 0.11, f: midi(n), peak: 0.1, dur: 1.2, wet: 0.55 });
    });
    for (const [n, det] of [[45, -7], [45, 7], [52, -5], [52, 5]]) {
      voice(ctx, out, {
        t,
        type: "sawtooth",
        f0: midi(n),
        detune: det,
        dur: 1.9,
        peak: 0.05,
        attack: 0.9,
        filter: { type: "lowpass", f0: 220, f1: 1400 },
        wet: 0.3,
      });
    }
  },

  // The meteor: a falling-bomb whistle, a roar that builds, and a rumble
  // that climbs to the moment of impact.
  bootMeteor(ctx, out, t, o = {}) {
    const dur = o.duration ?? 0.9;
    voice(ctx, out, { t, type: "sine", f0: 2700, f1: 820, dur, peak: 0.07, attack: 0.25, wet: 0.2 });
    voice(ctx, out, { t, type: "sawtooth", f0: 1300, f1: 400, dur, peak: 0.03, attack: 0.3, filter: { type: "bandpass", f0: 1500, f1: 700, Q: 4 } });
    noise(ctx, out, { t, dur, peak: 0.24, shape: "swell", wet: 0.15, filter: { type: "bandpass", f0: 300, f1: 3800, Q: 0.8 } });
    voice(ctx, out, { t, type: "sawtooth", f0: 48, f1: 85, dur: dur + 0.05, peak: 0.16, attack: 0.5, filter: { type: "lowpass", f0: 180, f1: 420 } });
  },

  // Impact and explosion: sub boom, crack, a long roaring body, letters
  // shattering and debris raining down.
  bootImpact(ctx, out, t) {
    voice(ctx, out, { t, type: "sine", f0: 130, f1: 28, dur: 1.7, peak: 0.6, attack: 0.003, wet: 0.15 });
    voice(ctx, out, { t, type: "triangle", f0: 220, f1: 50, dur: 0.6, peak: 0.28, attack: 0.002 });
    noise(ctx, out, { t, dur: 0.16, peak: 0.55, attack: 0.001, filter: { type: "highpass", f0: 1400 } });
    noise(ctx, out, { t, dur: 1.5, peak: 0.55, attack: 0.004, wet: 0.5, filter: { type: "lowpass", f0: 4200, f1: 180, Q: 0.6 } });
    noise(ctx, out, { t: t + 0.06, dur: 2.2, peak: 0.16, attack: 0.05, wet: 0.7, filter: { type: "bandpass", f0: 900, f1: 260, Q: 0.6 } });
    // Shockwave: a wide downward sweep.
    voice(ctx, out, { t: t + 0.03, type: "sawtooth", f0: 900, f1: 60, dur: 0.9, peak: 0.09, filter: { type: "lowpass", f0: 2000, f1: 200 } });
    // The letters shattering.
    [0.05, 0.1, 0.16, 0.22].forEach((d, i) => {
      voice(ctx, out, { t: t + d, type: "sine", f0: [2100, 2740, 3330, 1780][i], dur: 0.5, peak: 0.07, attack: 0.001, wet: 0.5 });
      voice(ctx, out, { t: t + d, type: "sine", f0: [5100, 6400, 7900, 4300][i], dur: 0.25, peak: 0.03, attack: 0.001, wet: 0.5 });
    });
    // Debris rattling down.
    for (let i = 0; i < 16; i++) {
      const d = 0.2 + Math.pow(Math.random(), 1.4) * 1.3;
      noise(ctx, out, {
        t: t + d,
        dur: 0.04,
        peak: 0.07 * (1 - d / 1.8),
        attack: 0.001,
        wet: 0.3,
        filter: { type: "bandpass", f0: 1800 + Math.random() * 3200, Q: 3 },
      });
    }
  },

  // The explosion clearing and the app arriving: an airy sweep, then a
  // small bright chord.
  bootReveal(ctx, out, t) {
    noise(ctx, out, { t, dur: 0.75, peak: 0.1, shape: "swell", wet: 0.4, filter: { type: "bandpass", f0: 700, f1: 6500, Q: 1.0 } });
    [88, 93, 100].forEach((n, i) => {
      bell(ctx, out, { t: t + 0.25 + i * 0.1, f: midi(n), peak: 0.09, dur: 1.1, wet: 0.55 });
    });
    for (const n of [57, 64, 69]) {
      voice(ctx, out, { t: t + 0.25, type: "triangle", f0: midi(n), dur: 1.3, peak: 0.05, attack: 0.06, wet: 0.5 });
    }
  },
};

export function playSfx(name, ctx, out, t, options) {
  const fn = SFX[name];
  if (fn) fn(ctx, out, t, options);
}
