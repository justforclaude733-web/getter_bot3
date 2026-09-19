// The shared audio graph. Kept separate from engine.js (which owns the
// AudioContext lifecycle, settings and UI hooks) so the exact same graph
// can be built on an OfflineAudioContext for testing.
//
//   sfx sounds  -> sfxBus   ----------------------\
//   sfx reverb  -> sfxSend  -> convolver -> wetOut -> master -> compressor -> out
//   music       -> musicBus ----------------------/
//   music reverb-> musicSend-> convolver

// A synthetic room: stereo noise with an exponential decay. Cheap to build
// and avoids shipping an impulse-response file.
export function createReverbImpulse(ctx, seconds = 1.9, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Slightly darker over time, like a real room.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - 0.35 * t);
    }
  }
  return impulse;
}

export function createGraph(ctx) {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.22;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(compressor);

  const sfxBus = ctx.createGain();
  sfxBus.connect(master);
  const musicBus = ctx.createGain();
  musicBus.connect(master);

  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbImpulse(ctx);
  const wetOut = ctx.createGain();
  wetOut.gain.value = 0.55;
  convolver.connect(wetOut);
  wetOut.connect(master);

  const sfxSend = ctx.createGain();
  sfxSend.connect(convolver);
  const musicSend = ctx.createGain();
  musicSend.connect(convolver);

  return {
    master,
    sfxBus,
    musicBus,
    sfxSend,
    musicSend,
    // What a sound is given to write to: `dry` straight to the bus, `wet`
    // into the shared reverb.
    sfxOut: { dry: sfxBus, wet: sfxSend },
    musicOut: { dry: musicBus, wet: musicSend },
  };
}
