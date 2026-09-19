import { apiFetch, API_BASE } from "./marketApi.js";

// `result` is { distanceMeters, money } from GameCanvas's distance +
// speed based reward system (see speedRewardTier there) - `money` is
// already the real payout earned during the run, not a value the server
// needs to re-derive from a timer anymore.
//
// NOTE: previously the server re-derived the reward from a time-based
// score (score // 10) and clamped it against real elapsed wall-clock
// time. That endpoint isn't part of this bundle, so it still needs to be
// updated server-side to trust/validate `money` (and ideally re-check it
// against `distanceMeters` + a plausible max speed) instead of applying
// the old //10 formula - otherwise players will see one reward in the
// in-game HUD and a different one land in their balance.
export async function submitRiderRun(result) {
  const { distanceMeters, money } = result;

  if (!API_BASE) {
    return { ok: true, distanceMeters, reward: money, newBalance: 500 + money };
  }

  try {
    const data = await apiFetch("/api/game/rider-finish", {
      method: "POST",
      body: JSON.stringify({ distance_meters: distanceMeters, money }),
    });
    return { ok: true, distanceMeters: data.distance_meters, reward: data.reward, newBalance: data.new_balance };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
