import { useEffect, useState } from "react";
import GameCanvas from "./GameCanvas.jsx";
import { submitRiderRun } from "../../api/gameApi.js";
import { play, startMusic, stopMusic, setMusicIntensity } from "../../audio/engine.js";

const STAGE_INTRO = "intro";
const STAGE_PLAYING = "playing";
const STAGE_RESULT = "result";

// Best money earned in a single run, kept locally on-device (no
// leaderboard/API for this yet) so the intro screen has something to show
// even the very first time this loads on a given phone.
const BEST_SCORE_KEY = "riderGame.bestMoney";

function readBestScore() {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0; // storage unavailable (e.g. private mode) - just don't persist
  }
}

function writeBestScore(money) {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(money));
  } catch {
    /* storage unavailable - ignore */
  }
}

export default function RiderGame({ notify, onBalanceChange, onExit, onImmersiveChange }) {
  const [stage, setStage] = useState(STAGE_INTRO);
  const [result, setResult] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [bestScore, setBestScore] = useState(readBestScore);

  // Only the actual run is fullscreen/nav-hidden - the intro and result
  // screens behave like a normal tab (nav visible, ✕ still there as a
  // shortcut). Tell App.jsx whenever that should flip.
  useEffect(() => {
    onImmersiveChange?.(stage === STAGE_PLAYING);
    return () => onImmersiveChange?.(false);
  }, [stage, onImmersiveChange]);

  // Neon background music for as long as the Ride tab is open; how much of
  // the track plays follows the stage (menu: pads + bass, run: everything,
  // result: back down).
  useEffect(() => {
    startMusic();
    return () => stopMusic(0.5);
  }, []);

  useEffect(() => {
    setMusicIntensity(stage === STAGE_PLAYING ? 1 : stage === STAGE_RESULT ? 0.3 : 0.5, 0.6);
  }, [stage]);

  function startRun() {
    setResult(null);
    setStage(STAGE_PLAYING);
    play("gameStart");
  }

  async function handleGameOver({ distanceMeters, money }) {
    setStage(STAGE_RESULT);
    setResult({ distanceMeters, reward: money, loading: true });
    play("gameOver");
    if (money > bestScore) play("newBest", { delay: 1.1 });

    if (money > bestScore) {
      setBestScore(money);
      writeBestScore(money);
    }

    const outcome = await submitRiderRun({ distanceMeters, money });
    if (outcome.ok) {
      setResult({ distanceMeters: outcome.distanceMeters, reward: outcome.reward, loading: false });
      onBalanceChange?.(outcome.newBalance);
      if (outcome.reward > 0) notify?.("success");
    } else {
      setResult({ distanceMeters, reward: money, loading: false, failed: true });
    }
  }

  function playAgain() {
    setRunKey((key) => key + 1);
    startRun();
  }

  return (
    <div className="rider-game">
      {/* Only shown on the intro/result screens - there's no way to back
          out mid-run anymore (the old in-canvas ✕ overlapped the HUD and
          got removed), so the only exit is here, before/after a run. */}
      {stage !== STAGE_PLAYING && (
        <button type="button" className="rider-game__exit" onClick={onExit} aria-label="Close">
          ✕
        </button>
      )}

      {stage === STAGE_INTRO && (
        <div className="rider-game__intro">
          <h1 className="brand-title">🏍 NEON RIDER</h1>

          {bestScore > 0 && (
            <div className="rider-game__best">
              <span className="rider-game__best-label">Best run</span>
              <span className="rider-game__best-value">{bestScore} VɎ</span>
            </div>
          )}

          <div className="rider-game__controls">
            <div className="rider-game__controls-row">
              <span className="rider-game__controls-key">Hold right</span>
              <span>accelerate</span>
            </div>
            <div className="rider-game__controls-row">
              <span className="rider-game__controls-key">Tap left</span>
              <span>jump - keeps your speed if you were moving, hops straight up if not</span>
            </div>
            <div className="rider-game__controls-row">
              <span className="rider-game__controls-key">Double-tap</span>
              <span>speed boost</span>
            </div>
          </div>

          <p className="rider-game__intro-text">
            Clear the gaps, don't land on your frame.
          </p>
          <p className="rider-game__intro-text rider-game__intro-text--dim">
            Every 100m earns VɎ - the faster you're going, the more it pays (up to 3× at top
            speed). No finish line - just go as far and as fast as you can.
          </p>
          <button type="button" className="sheet-button sheet-button--confirm rider-game__start" onClick={startRun}>
            ▶ Start ride
          </button>
        </div>
      )}

      {stage === STAGE_PLAYING && (
        <GameCanvas key={runKey} onGameOver={handleGameOver} />
      )}

      {stage === STAGE_RESULT && result && (
        <div className="sheet-overlay rider-game__result-overlay">
          <div className="confirm-sheet rider-game__result">
            <div className="confirm-sheet__handle" />
            <p className="rider-game__result-title">
              {result.failed ? "💥 Crashed!" : "🎉 Nice ride!"}
            </p>
            <div className="confirm-sheet__ledger">
              <div className="confirm-sheet__ledger-row">
                <span>Distance</span>
                <span>{result.distanceMeters}m</span>
              </div>
              <div className="confirm-sheet__ledger-row" data-emphasis="true">
                <span>Reward</span>
                <span>{result.loading ? "…" : `+${result.reward} VɎ`}</span>
              </div>
            </div>
            {result.failed && (
              <p className="confirm-sheet__error confirm-sheet__error--neutral">
                Couldn't reach the bot to record your reward - your run still counts locally.
              </p>
            )}
            <div className="confirm-sheet__actions">
              <button
                type="button"
                className="sheet-button sheet-button--cancel"
                onClick={() => setStage(STAGE_INTRO)}
              >
                Menu
              </button>
              <button type="button" className="sheet-button sheet-button--confirm" onClick={playAgain}>
                ↻ Play again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
