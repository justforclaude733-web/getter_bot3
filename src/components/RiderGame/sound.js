// Sound effects for the Rider game. They run on the app-wide audio engine
// (src/audio) so the master volume, the Settings mute switches and the
// single shared AudioContext all apply; the effects themselves are defined
// in src/audio/synth.js. The names below are what GameCanvas.jsx calls.

import { unlock, play, getAudio, duckMusic } from "../../audio/engine.js";

// Audio can only start from inside a real user gesture - GameCanvas calls
// this from its pointerdown handler.
export function resumeAudio() {
  unlock();
}

export function playJump() {
  play("jump");
}

export function playLand(intensity = 1) {
  play("land", { intensity });
}

export function playCrash() {
  play("crash");
  duckMusic(1.0, 0.12); // let the crash cut through, then bring the music back
}

export function playScore() {
  play("score");
}

export function playBoost() {
  play("boost");
}

// Continuous engine hum - a single oscillator whose pitch/volume is
// nudged toward a target each call rather than recreated, so it can be
// updated every physics tick cheaply. Triangle wave through a gentle
// lowpass (instead of a raw sawtooth) so it reads as a smooth hum
// rather than a buzzy rattle.
let engineOsc = null;
let engineFilter = null;
let engineGain = null;

export function updateEngine(active, speedFraction) {
  const audio = getAudio();
  if (!audio) return;
  const { ctx, bus } = audio;
  if (ctx.state !== "running") return;

  if (active && !engineOsc) {
    engineOsc = ctx.createOscillator();
    engineFilter = ctx.createBiquadFilter();
    engineGain = ctx.createGain();
    engineOsc.type = "triangle";
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 500;
    engineGain.gain.value = 0.0001;
    engineOsc.connect(engineFilter).connect(engineGain).connect(bus);
    engineOsc.start();
  }

  if (!engineOsc) return;

  if (active) {
    // Loud and unmistakable the moment gas is held, not just once speed
    // builds up (kept from the previous tuning - the music sits under it).
    const freq = 90 + speedFraction * 170;
    const filterFreq = 550 + speedFraction * 800;
    const volume = 0.3 + speedFraction * 0.26;
    engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
    engineFilter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.08);
    engineGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
  } else {
    engineGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
  }
}

export function stopEngine() {
  if (engineOsc) {
    try {
      engineOsc.stop();
    } catch {
      // already stopped - fine
    }
  }
  engineOsc = null;
  engineFilter = null;
  engineGain = null;
}
