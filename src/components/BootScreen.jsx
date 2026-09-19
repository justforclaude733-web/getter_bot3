import { useEffect, useRef, useState } from "react";
import { createBootFx, FX } from "./bootFx.js";
import { play, isRunning, unlock, getSettings, onAudioStateChange } from "../audio/engine.js";
import { BOOT_SOUNDS } from "../audio/bootSequence.js";

// Boot sequence (all times in ms from the moment the animation starts):
//   0      VYRO drops in as chunky 3D letters (CSS, see .vyro-* in index.css)
//   2050   a meteor with a fiery trail enters from the top-right (canvas)
//   2950   it hits VYRO: letters are blasted apart, big explosion, screen shake
//   3800   the explosion covers the whole screen -> the app mounts underneath
//   3800+  the explosion fades away (LEAVE_MS) and the app builds in
// The mini app never shows before the explosion has covered the screen.
//
// Sound: every stage has its own synthesized sound (src/audio, timeline in
// audio/bootSequence.js), fired from the same clock as the visuals. If the
// webview hasn't unlocked audio yet (autoplay policy) a small "tap for
// sound" hint is shown, and the sounds still to come play as soon as the
// player taps anywhere.
//
// Each letter is a stack of LAYERS copies of the glyph pushed apart along Z,
// which reads as a solid extruded letter while it tumbles - plain DOM +
// CSS 3D, no WebGL/three.js needed.
const LAYERS = 16;

// x0/y0/z0 + r*0: where each letter starts (off-screen above, close to the
// camera, mid-tumble). *f + dy: the small tilt/offset it rests at.
// bx/by/bz + br*: where it is thrown when the meteor hits; bd: tiny delay so
// the letters nearest the impact go first.
const LETTERS = [
  { ch: "V", x0: "-38vw", y0: "-74vh", z0: "320px", rx0: "-520deg", ry0: "380deg", rz0: "-160deg", rxf: "-4deg", ryf: "7deg", rzf: "-5deg", dy: "4px", bx: "-105vw", by: "-38vh", bz: "420px", brx: "480deg", bry: "-620deg", brz: "-300deg", bd: "45ms" },
  { ch: "Y", x0: "14vw", y0: "-88vh", z0: "260px", rx0: "430deg", ry0: "-470deg", rz0: "140deg", rxf: "5deg", ryf: "-6deg", rzf: "4deg", dy: "-5px", bx: "-25vw", by: "-95vh", bz: "360px", brx: "-560deg", bry: "420deg", brz: "240deg", bd: "0ms" },
  { ch: "R", x0: "-10vw", y0: "-66vh", z0: "380px", rx0: "-380deg", ry0: "520deg", rz0: "200deg", rxf: "-3deg", ryf: "5deg", rzf: "-3deg", dy: "3px", bx: "35vw", by: "90vh", bz: "480px", brx: "540deg", bry: "560deg", brz: "-220deg", bd: "0ms" },
  { ch: "O", x0: "36vw", y0: "-80vh", z0: "300px", rx0: "480deg", ry0: "-360deg", rz0: "-120deg", rxf: "6deg", ryf: "-7deg", rzf: "6deg", dy: "-3px", bx: "110vw", by: "-30vh", bz: "440px", brx: "-500deg", bry: "600deg", brz: "320deg", bd: "45ms" },
];

const LEAVE_MS = 900;
// Sounds fire this early to make up for output latency, so they land with
// the visuals rather than just after them.
const AUDIO_LEAD_MS = 50;
// Don't hold the animation back for more than this waiting on the web
// font - it starts with the fallback font instead.
const FONT_WAIT_MS = 700;

export default function BootScreen({ dataReady, onCovered, onFinished }) {
  const [play, setPlay] = useState(false);
  const [covered, setCovered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [audioLocked, setAudioLocked] = useState(false);
  const backRef = useRef(null);
  const frontRef = useRef(null);
  const wordRef = useRef(null);
  const coveredRef = useRef(onCovered);
  const finishedRef = useRef(onFinished);
  coveredRef.current = onCovered;
  finishedRef.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let coverTimer;
    let fx = null;
    let stopWatchingAudio = null;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    function cover() {
      if (cancelled) return;
      setCovered(true);
      coveredRef.current?.();
    }

    function start() {
      if (cancelled) return;
      setPlay(true);
      // Try to unlock audio right away (works if the webview allows
      // autoplay); otherwise the hint below asks for a tap.
      unlock();
      const syncLocked = () => setAudioLocked(getSettings().sfx && !isRunning());
      syncLocked();
      stopWatchingAudio = onAudioStateChange(syncLocked);
      if (reduceMotion) {
        coverTimer = setTimeout(cover, 400);
        return;
      }
      try {
        fx = createBootFx({
          back: backRef.current,
          front: frontRef.current,
          // Meteor aims at the middle of the VYRO word.
          getImpact: (canvasRect) => {
            const r = wordRef.current.getBoundingClientRect();
            return { x: r.left + r.width / 2 - canvasRect.left, y: r.top + r.height / 2 - canvasRect.top };
          },
        });
      } catch {
        fx = null; // canvas unavailable - the CSS letters + timing still work
      }
      const t0 = performance.now();
      let nextSound = 0;
      const frame = () => {
        if (cancelled) return;
        const t = performance.now() - t0;
        fx?.draw(t);
        // Fire the boot sounds that have come due. Ones that are already
        // more than 300ms late (audio unlocked mid-boot) are skipped so
        // nothing plays out of sync.
        while (nextSound < BOOT_SOUNDS.length && BOOT_SOUNDS[nextSound].t - AUDIO_LEAD_MS <= t) {
          const sound = BOOT_SOUNDS[nextSound++];
          if (t - sound.t < 300) play(sound.name, { ...sound.options, onlyIfRunning: true });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      coverTimer = setTimeout(cover, FX.COVER);
    }

    if (reduceMotion || !document.fonts?.load) {
      start();
    } else {
      // Start once the display font is ready so the letters don't change
      // shape (and shift) halfway through the fall.
      const fontReady = Promise.all([
        document.fonts.load('800 1em "Bricolage Grotesque"', "VYRO"),
        document.fonts.ready,
      ]).catch(() => {});
      Promise.race([fontReady, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(start);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(coverTimer);
      stopWatchingAudio?.();
    };
  }, []);

  // Once the explosion has covered the screen AND the data is in, the app
  // is mounted underneath (App.jsx) - fade the explosion out to reveal it.
  useEffect(() => {
    if (covered && dataReady) setLeaving(true);
  }, [covered, dataReady]);

  // The explosion clearing and the app arriving.
  useEffect(() => {
    if (leaving) play("bootReveal", { onlyIfRunning: true });
  }, [leaving]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => finishedRef.current?.(), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div
      className="boot-screen"
      data-play={play || undefined}
      data-leaving={leaving || undefined}
      style={{ "--impact": `${FX.IMPACT}ms` }}
    >
      <canvas ref={backRef} className="boot-fx boot-fx--back" aria-hidden="true" />

      <div className="boot-vyro" data-play={play || undefined} role="img" aria-label="VYRO">
        <div className="boot-vyro__word" ref={wordRef} aria-hidden="true">
          {LETTERS.map(({ ch, ...pose }, i) => (
            <span className="vyro-slot" key={`${ch}${i}`} style={{ "--i": i, "--bd": pose.bd }}>
              <span
                className="vyro-letter"
                style={Object.fromEntries(Object.entries(pose).map(([name, value]) => [`--${name}`, value]))}
              >
                <span className="vyro-sizer">{ch}</span>
                {Array.from({ length: LAYERS }, (_, k) => (
                  <span className="vyro-layer" data-front={k === 0 || undefined} style={{ "--k": k }} key={k}>
                    {ch}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="boot-screen__icon">◈</div>
      <h1 className="brand-title boot-screen__title">𝐌𝐀𝐑𝐊𝐄𝐓</h1>
      <p className="boot-screen__hint">shuffling the deck…</p>
      <div className="boot-screen__bar">
        <div className="boot-screen__bar-fill" />
      </div>

      <canvas ref={frontRef} className="boot-fx boot-fx--front" aria-hidden="true" />

      {audioLocked && !covered && <p className="boot-screen__sound-hint">🔊 tap for sound</p>}
    </div>
  );
}
