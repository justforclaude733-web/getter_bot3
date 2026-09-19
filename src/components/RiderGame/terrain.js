// Procedural, endless terrain + obstacle generator for the Rider mini-game.
//
// Obstacles fall into exactly three families, color-coded to match how
// the player reads them at a glance:
//
//   YELLOW - the ground itself. Every ramp, bump, valley, zigzag ridge,
//   and stepped plateau below is just a shape traced into the rideable
//   ground polyline (no separate trap body) - the only way a yellow
//   feature ends a run is the general rule that already applies to ALL
//   ground everywhere: land on it chassis-first (upside-down/wrong
//   angle) and you crash, same as flat ground. Gaps are the one yellow
//   feature that DOES spawn a trap (a spiked pit floor), because a gap
//   needs *something* concrete at the bottom instead of a bottomless
//   void.
//
//   RED - moving/rotating hazards you must actively dodge or clear:
//   spinning saw blades (stationary or traveling along a short rail),
//   a wrecking ball swinging on a chain, a long bar pivoting through a
//   full rotation, twin spike pillars that pump up and down, and a
//   spike ball that actively trails the bike's own position. Touching
//   any of these ends the run immediately, same as touching the
//   chassis to the ground.
//
//   BLUE - timing gates. A gate arm pivots between "open" (safely out
//   of the way) and "closed" (blocking the path) on a steady cycle;
//   clearing it is about reading the cycle and going through during the
//   open window, not reflexes. featureGateChamber chains two gates back
//   to back - inspired by a rotating "ring" obstacle where you have to
//   time both an entry and an exit - adapted to this game's straight,
//   horizontally-scrolling track instead of a literal circular tunnel.
//   Because the player fully controls forward speed (holding right =
//   gas), a gate is never an unfair ambush: worst case, ease off and
//   coast up to it to wait out the cycle.
//
// Difficulty scales along two axes as a run goes on: individual feature
// parameters (gap width, hazard speed, spike counts, bump height) scale
// with `t`, AND whole feature types are gated behind a `tier` threshold
// on that same `t` - so an early run is yellow-terrain-only (plus the
// original gentle gap/spike-row/platform staples), red hazards start
// mixing in a bit into the run, and blue timing gates - the type that
// most needs the player to already have their reflexes warmed up -
// don't show up until well into a run.
//
// The world is built as a sequence of "spans" (continuous rideable
// ground, as a polyline of {x,y} points) separated by gaps. Terrain is
// generated ahead of the bike and pruned once it scrolls far behind the
// camera, so a run can go on forever without the amount of live physics
// geometry growing without bound.

export const GROUND_STEP = 24; // px between generated ground points
export const GAP_PRUNE_MARGIN = 900; // keep this much world behind the camera
export const PIT_DEPTH = 260; // how far below baseline a gap's spike floor sits
export const SAFE_START_LENGTH = 560; // guaranteed flat, trap-free run-up at spawn

// A gentle floor + ceiling on how steep a single ground step may be, so
// the procedural hills/bumps/valleys never produce an un-rideable
// vertical wall - every yellow shape stays genuinely passable.
const MAX_SLOPE_PER_STEP = 11;

function clampSlope(prevY, nextY) {
  const delta = nextY - prevY;
  if (delta > MAX_SLOPE_PER_STEP) return prevY + MAX_SLOPE_PER_STEP;
  if (delta < -MAX_SLOPE_PER_STEP) return prevY - MAX_SLOPE_PER_STEP;
  return nextY;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// Adds a straight/flat run of ground points from the current cursor.
function appendFlat(state, length) {
  const steps = Math.max(1, Math.round(length / GROUND_STEP));
  for (let i = 1; i <= steps; i++) {
    const x = state.cursorX + GROUND_STEP;
    state.points.push({ x, y: state.baseline });
    state.cursorX = x;
    state.cursorY = state.baseline;
  }
}

// Adds a ramp (positive rise = uphill, negative = downhill) over
// `length` px, subdivided into GROUND_STEP-sized points. The rise is
// clamped to a climbable angle regardless of what the caller asks for,
// and additionally clamped per-point relative to whatever point
// actually precedes it, so the joint where one shape meets the next can
// never be a sharp instant corner either.
const MAX_RAMP_SLOPE_RATIO = 0.53; // rise/length ceiling, ~28 degrees

function appendRamp(state, length, rise) {
  const maxRise = length * MAX_RAMP_SLOPE_RATIO;
  const clampedRise = Math.max(-maxRise, Math.min(maxRise, rise));
  const steps = Math.max(1, Math.round(length / GROUND_STEP));
  const startY = state.cursorY;
  let x = state.cursorX;
  for (let i = 1; i <= steps; i++) {
    x = state.cursorX + i * (length / steps);
    const targetY = startY - (clampedRise * i) / steps;
    const y = clampSlope(state.cursorY, targetY);
    state.points.push({ x, y });
    state.cursorX = x;
    state.cursorY = y;
  }
}

// Adds a smooth sine-shaped bump/dip over `length` px - positive height
// rises above baseline-relative cursor, negative dips below. Used for
// every rounded yellow shape (bumps, waves, U-valleys) so they all read
// as one consistent family, just like appendRamp is the shared engine
// for every straight-edged one (V-valleys, plateaus, zigzags).
function appendCurve(state, length, height) {
  const steps = Math.max(2, Math.round(length / GROUND_STEP));
  const startY = state.cursorY;
  for (let i = 1; i <= steps; i++) {
    const x = state.cursorX + length / steps;
    const p = i / steps;
    const offset = Math.sin(p * Math.PI) * height;
    const y = clampSlope(state.cursorY, startY - offset);
    state.points.push({ x, y });
    state.cursorX = x;
    state.cursorY = y;
  }
}

// Opens a gap of `width` px, flooring it with spikes so it's never a
// bottomless void, then starts a new span on the far side at `landY`.
function openGap(state, width, landY) {
  const gapStartX = state.cursorX;
  const gapEndX = state.cursorX + width;

  state.traps.push({
    type: "pitfloor",
    x1: gapStartX,
    x2: gapEndX,
    y: state.baseline + PIT_DEPTH,
  });

  state.cursorX = gapEndX;
  state.cursorY = landY;
  state.startSpan(state.cursorX, state.cursorY);
}

// ============================================================================
// YELLOW - ground shapes. Each takes the generator state and a
// difficulty t in [0,1] and appends points to the current span,
// possibly starting a new span after a gap.
// ============================================================================

// The main filler terrain: a chain of straight uphill/downhill ramps
// meeting at distinct peaks and valleys (mountain-range silhouette).
function featureTerrainChain(state, t) {
  const legCount = 3 + Math.floor(rand(0, 3));
  for (let i = 0; i < legCount; i++) {
    const goingUp = Math.random() < 0.55;
    const length = rand(130, 240);
    // Gentle on purpose: at the bike's speed, a steep peak here would
    // launch it into the air on its own - the ONLY way to get air
    // should be the deliberate jump action, not terrain shape.
    const rise = goingUp ? rand(14, 30 + t * 10) : -rand(14, 30 + t * 10);
    appendRamp(state, length, rise);
  }
  appendFlat(state, rand(50, 120));
}

// A gentler, smoother rolling stretch for texture variety.
function featureRollingHills(state, t) {
  const amplitude = rand(12, 22 + t * 8);
  const wavelength = rand(280, 460);
  const phase = rand(0, Math.PI * 2);
  const length = rand(400, 700);

  const startX = state.cursorX;
  let x = state.cursorX;
  while (x < startX + length) {
    x += GROUND_STEP;
    const wave = Math.sin((x - startX) / wavelength + phase) * amplitude;
    const targetY = state.baseline + wave;
    const y = clampSlope(state.cursorY, targetY);
    state.points.push({ x, y });
    state.cursorX = x;
    state.cursorY = y;
  }
}

// A single smooth rounded bump (ref image #7).
function featureSingleBump(state, t) {
  appendFlat(state, rand(60, 110));
  const width = rand(140, 220);
  const height = rand(26, 42 + t * 16);
  appendCurve(state, width, height);
  appendFlat(state, rand(70, 120));
}

// Two or three smaller bumps back to back (ref #8/#9).
function featureBumpWave(state, t) {
  appendFlat(state, rand(50, 90));
  const bumpCount = 2 + Math.floor(rand(0, 1.6 + t));
  for (let i = 0; i < bumpCount; i++) {
    appendCurve(state, rand(90, 150), rand(18, 30 + t * 10));
  }
  appendFlat(state, rand(70, 110));
}

// A smooth rounded valley dip (ref #12/#13).
function featureValleyU(state, t) {
  appendFlat(state, rand(60, 100));
  appendCurve(state, rand(160, 240), -rand(20, 36 + t * 10));
  appendFlat(state, rand(70, 120));
}

// A sharper V-shaped valley (ref #14/#15).
function featureValleyV(state, t) {
  appendFlat(state, rand(60, 100));
  const halfWidth = rand(70, 110);
  const depth = rand(22, 38 + t * 10);
  appendRamp(state, halfWidth, -depth);
  appendRamp(state, halfWidth, depth);
  appendFlat(state, rand(70, 120));
}

// A small sawtooth ridge - texture only, gentle enough to ride straight
// over (ref #16/#17/#20).
function featureZigzagRidge(state, t) {
  appendFlat(state, rand(50, 90));
  const toothCount = 3 + Math.floor(rand(0, 2 + t));
  for (let i = 0; i < toothCount; i++) {
    const toothHalf = rand(15, 25);
    const toothHeight = rand(10, 18 + t * 6);
    appendRamp(state, toothHalf, toothHeight);
    appendRamp(state, toothHalf, -toothHeight);
  }
  appendFlat(state, rand(70, 110));
}

// A raised flat-top plateau/step - ramp up, flat run, ramp down (ref
// #3/#18/#19).
function featureSteppedPlateau(state, t) {
  appendFlat(state, rand(60, 100));
  const riseWidth = rand(50, 80);
  const riseHeight = rand(30, 46 + t * 10);
  appendRamp(state, riseWidth, riseHeight);
  appendFlat(state, rand(80, 160));
  appendRamp(state, riseWidth, -riseHeight);
  appendFlat(state, rand(70, 110));
}

// A flat-approach gap - clearing it is entirely down to timing the
// jump.
function featureGapJump(state, t) {
  const gapWidth = rand(170, 230 + t * 90);
  appendFlat(state, rand(60, 100));
  openGap(state, gapWidth, state.baseline);
  appendFlat(state, rand(90, 140));
}

// A wide gap bridged only by a moving platform.
function featureMovingPlatformGap(state, t) {
  const gapWidth = rand(240, 300 + t * 60);
  appendFlat(state, rand(60, 100));

  const platformX = state.cursorX + gapWidth / 2;
  const platformBaseY = state.baseline - rand(20, 50);
  state.traps.push({
    type: "platform",
    x: platformX,
    y: platformBaseY,
    width: 100,
    height: 16,
    travel: rand(30, 55),
    speed: rand(0.9, 1.4 + t * 0.4),
  });

  openGap(state, gapWidth, state.baseline);
  appendFlat(state, 140);
}

function featureSpikeRow(state, t) {
  const spikeCount = 1 + Math.floor(rand(0, 3 + t * 1.5));
  appendFlat(state, rand(60, 100));
  for (let i = 0; i < spikeCount; i++) {
    const spikeX = state.cursorX + 24;
    state.traps.push({ type: "spike", x: spikeX, y: state.baseline, width: 26, height: 30 });
    state.cursorX = spikeX + 24;
    state.cursorY = state.baseline;
    state.points.push({ x: state.cursorX, y: state.baseline });
  }
  appendFlat(state, rand(80, 120));
}

// ============================================================================
// RED - moving/rotating hazards. Each pushes one or more trap
// descriptors; buildTrapBody/updateMovingTraps in GameCanvas drive the
// actual physics + animation.
// ============================================================================

// A wrecking ball swinging on a chain (ref #22).
function featureWreckingBall(state, t) {
  featureRollingHills(state, Math.min(t, 0.3));
  const anchorX = state.cursorX - rand(150, 260);
  state.traps.push({
    type: "wreckingBall",
    anchorX,
    anchorY: state.baseline - 260,
    length: rand(90, 150),
    speed: rand(0.8, 1.3 + t * 0.5),
    phase: rand(0, Math.PI * 2),
    radius: 20,
  });
}

// A spinning saw blade mounted over flat ground (ref #23).
function featureSawBlade(state, t) {
  const flatLen = rand(200, 260);
  const bladeX = state.cursorX + flatLen / 2;
  const bladeY = state.baseline - rand(65, 95);
  appendFlat(state, flatLen);
  state.traps.push({
    type: "sawBlade",
    x: bladeX,
    y: bladeY,
    radius: 26,
    speed: rand(2, 3 + t),
  });
  appendFlat(state, 100);
}

// A saw blade that ALSO travels back and forth along a short rail -
// rotating AND moving at once.
function featureTravelingSaw(state, t) {
  const flatLen = rand(260, 340);
  const centerX = state.cursorX + flatLen / 2;
  const y = state.baseline - rand(55, 80);
  appendFlat(state, flatLen);
  state.traps.push({
    type: "sawBlade",
    x: centerX,
    y,
    radius: 24,
    speed: rand(2.4, 3.4 + t),
    travelX: rand(60, 110),
    travelSpeed: rand(0.7, 1.1 + t * 0.3),
  });
  appendFlat(state, 100);
}

// A long bar pivoting through a full rotation above the track (ref
// #24) - passable only when its low point isn't currently sweeping
// through ground level.
function featureRotatingBar(state, t) {
  const flatLen = rand(220, 280);
  appendFlat(state, flatLen);
  state.traps.push({
    type: "rotatingBar",
    x: state.cursorX,
    y: state.baseline - rand(70, 90),
    length: rand(70, 95),
    speed: rand(1.3, 2 + t * 0.6),
    phase: rand(0, Math.PI * 2),
  });
  appendFlat(state, rand(140, 180));
}

// A spike ball that actively trails the bike's own x position - a
// genuine "chases you" hazard.
function featureChaser(state, t) {
  featureRollingHills(state, Math.min(t, 0.25));
  state.traps.push({
    type: "chaser",
    x: state.cursorX - rand(260, 340),
    y: state.baseline - rand(50, 90),
    radius: 20,
    followLag: rand(0.02, 0.035 + t * 0.01),
    bobSpeed: rand(1.4, 2.2),
    bobAmount: rand(14, 22),
  });
}

// Twin retractable spike pillars, pumping up and down on a timer (ref
// #25).
function featureSpikePillars(state, t) {
  const flatLen = rand(220, 280);
  appendFlat(state, flatLen / 2);
  const baseX = state.cursorX;
  state.traps.push({
    type: "spikePillars",
    x1: baseX,
    x2: baseX + rand(50, 70),
    y: state.baseline,
    height: rand(46, 60 + t * 12),
    period: rand(1.6, 2.2 - t * 0.3),
    phase: rand(0, Math.PI * 2),
  });
  appendFlat(state, flatLen / 2);
}

// A dramatically steep ramp straight into a gap - riding up it at any
// real speed genuinely rockets the bike into the sky instead of just
// cresting a hill, for a much bigger and more dramatic arc through the
// air than the plain featureGapJump.
function featureSkyLaunch(state, t) {
  appendFlat(state, rand(60, 100));
  appendRamp(state, rand(90, 130), rand(60, 90 + t * 20));
  const gapWidth = rand(260, 330 + t * 80);
  openGap(state, gapWidth, state.baseline);
  appendFlat(state, rand(90, 140));
}

// The mirror image - the far side of the gap sits well below baseline,
// so clearing it means genuinely dropping from a real height before
// landing, then the ground ramps back up to baseline afterward so
// everything downstream keeps generating normally.
function featureBigDrop(state, t) {
  appendFlat(state, rand(60, 100));
  const gapWidth = rand(150, 210 + t * 50);
  const dropDepth = rand(80, 140 + t * 40);
  openGap(state, gapWidth, state.baseline + dropDepth);
  appendRamp(state, rand(160, 220), dropDepth);
  appendFlat(state, rand(80, 120));
}

// ============================================================================
// SPECTACLE - scripted 360° loop-de-loops. Genuinely simulating a full
// vertical loop through raw rigid-body physics (two separate wheel
// bodies on a compound chassis) is a well-known good way to get
// glitchy tunneling/instability at the tight curvature involved, and a
// failed loop would directly break the "every obstacle is standard,
// passable, and fair" rule. So instead of leaving it to physics, a loop
// is a SCRIPTED stunt: the ground stays perfectly normal and flat
// through it, and entering the marked zone (see GameCanvas's
// `activeLoop` handling) hands the bike's position/angle over to a
// parametric circle for a fixed, guaranteed-smooth trip around and back
// to exactly where it left off, at its own entry speed. Always
// succeeds, every time, for every player - it's a thrill beat, not a
// skill check.
// ============================================================================

const LOOP_RADIUS_RANGE = [95, 130];

// A clean loop with nothing inside it - pure "whoa, I just looped".
function featureLoop(state, t) {
  const radius = rand(...LOOP_RADIUS_RANGE);
  appendFlat(state, radius + rand(50, 90));
  state.traps.push({
    type: "loop",
    x: state.cursorX,
    y: state.baseline,
    radius,
    hasSaw: false,
  });
  appendFlat(state, radius + rand(90, 140));
}

// The same loop, but with a spinning saw blade sitting inside it for
// the "close call" visual thrill from the reference image - the
// scripted path is sized to always clear it safely, so it's spectacle,
// not a hidden gotcha.
function featureLoopWithSaw(state, t) {
  const radius = rand(...LOOP_RADIUS_RANGE);
  appendFlat(state, radius + rand(50, 90));
  const loopX = state.cursorX;
  state.traps.push({
    type: "loop",
    x: loopX,
    y: state.baseline,
    radius,
    hasSaw: true,
  });
  state.traps.push({
    type: "sawBlade",
    x: loopX,
    y: state.baseline - radius,
    radius: radius * 0.4,
    speed: rand(2.4, 3.4 + t),
  });
  appendFlat(state, radius + rand(90, 140));
}

// ============================================================================
// BLUE - timing gates. A gate arm pivots between open (out of the way)
// and closed (blocking) on a steady, readable cycle.
// ============================================================================

function pushSwingGate(state, x, y, phase, period) {
  state.traps.push({
    type: "swingGate",
    x,
    y,
    length: rand(75, 95),
    period,
    phase,
  });
}

// A single gate - has to be timed like a level crossing.
function featureSwingGate(state, t) {
  const flatLen = rand(200, 260);
  appendFlat(state, flatLen);
  pushSwingGate(state, state.cursorX, state.baseline - rand(80, 95), rand(0, Math.PI * 2), rand(2.2, 3 - t * 0.4));
  appendFlat(state, rand(140, 180));
}

// Two gates in sequence, forming a small "chamber": the first has to be
// open to ride in, then it's fine to be briefly boxed in while the
// second opens. Loosely inspired by a rotating ring obstacle with one
// entrance and one exit, adapted to a straight track: instead of a
// literal circular tunnel, it's a corridor bounded by two independently
// -timed gates. Never an unfair ambush - the player can always brake
// and coast up to either gate to wait out its cycle instead of trying
// to force a mistimed pass.
function featureGateChamber(state, t) {
  appendFlat(state, rand(160, 200));

  const period = rand(2.6, 3.2 - t * 0.3);
  pushSwingGate(state, state.cursorX, state.baseline - rand(80, 95), 0, period);

  appendFlat(state, rand(240, 300));

  // Offset phase so gate 2 tends to be opening around when a bike that
  // entered right as gate 1 opened would arrive - not exact (speed
  // varies), but the corridor is long enough, and braking is always an
  // option, so it never turns into a guaranteed hit.
  pushSwingGate(state, state.cursorX, state.baseline - rand(80, 95), period * 0.5, period);

  appendFlat(state, rand(140, 180));
}

// ============================================================================
// Feature pool + tiered difficulty unlocking
// ============================================================================

const FEATURES = [
  // yellow - always available
  { type: "chain", weight: 5, run: featureTerrainChain, tier: 0 },
  { type: "hills", weight: 3, run: featureRollingHills, tier: 0 },
  { type: "bump", weight: 3, run: featureSingleBump, tier: 0 },
  { type: "bumpWave", weight: 2, run: featureBumpWave, tier: 0 },
  { type: "valleyU", weight: 2, run: featureValleyU, tier: 0 },
  { type: "valleyV", weight: 2, run: featureValleyV, tier: 0 },
  { type: "zigzag", weight: 2, run: featureZigzagRidge, tier: 0 },
  { type: "plateau", weight: 2, run: featureSteppedPlateau, tier: 0 },
  { type: "gap", weight: 3, run: featureGapJump, tier: 0 },
  { type: "spikes", weight: 2, run: featureSpikeRow, tier: 0 },
  { type: "platform", weight: 2, run: featureMovingPlatformGap, tier: 0 },
  { type: "skyLaunch", weight: 2, run: featureSkyLaunch, tier: 0.05 },
  { type: "bigDrop", weight: 2, run: featureBigDrop, tier: 0.08 },

  // spectacle - scripted, always-safe 360° loops (see the SPECTACLE section above)
  { type: "loop", weight: 1.5, run: featureLoop, tier: 0.12 },
  { type: "loopWithSaw", weight: 1.2, run: featureLoopWithSaw, tier: 0.28 },

  // red - moving/rotating hazards, unlock progressively through the run
  { type: "wreckingBall", weight: 2, run: featureWreckingBall, tier: 0.1 },
  { type: "sawBlade", weight: 2, run: featureSawBlade, tier: 0.15 },
  { type: "spikePillars", weight: 2, run: featureSpikePillars, tier: 0.2 },
  { type: "rotatingBar", weight: 2, run: featureRotatingBar, tier: 0.25 },
  { type: "travelingSaw", weight: 2, run: featureTravelingSaw, tier: 0.3 },
  { type: "chaser", weight: 1.5, run: featureChaser, tier: 0.4 },

  // blue - timing gates, unlock latest (need the player already warmed up)
  { type: "swingGate", weight: 2, run: featureSwingGate, tier: 0.35 },
  { type: "gateChamber", weight: 1.5, run: featureGateChamber, tier: 0.5 },
];

function pickFeature(lastType, t) {
  const pool = FEATURES.filter((f) => f.tier <= t && (f.type !== lastType || Math.random() < 0.2));
  const totalWeight = pool.reduce((sum, f) => sum + f.weight, 0);
  let roll = rand(0, totalWeight);
  for (const feature of pool) {
    roll -= feature.weight;
    if (roll <= 0) return feature;
  }
  return pool[0];
}

// Every feature above tier 0 has its own distinct tier value, so this is
// effectively "one milestone hazard per unlock". Sorted ascending so we
// can walk through them in order as t climbs.
const TIER_INTRODUCTIONS = FEATURES.filter((f) => f.tier > 0).sort((a, b) => a.tier - b.tier);

export function createTerrainState(baseline) {
  const state = {
    baseline,
    cursorX: 0,
    cursorY: baseline,
    spans: [],
    points: [],
    traps: [],
    lastFeature: null,
    // How many tier-introduction milestones (TIER_INTRODUCTIONS, in
    // order) have already been force-shown. Left purely to the weighted
    // random pool, a freshly-unlocked hazard type has to compete against
    // an ever-growing field of ~19 other eligible features - it's
    // entirely possible to go a full run without the dice ever landing
    // on it. This counter is what guarantees that never happens: the
    // moment a new tier unlocks, the very next feature generated is
    // that tier's hazard, no randomness involved.
    introducedTierCount: 0,
    startSpan(x, y) {
      state.points = [{ x, y }];
      state.spans.push(state.points);
    },
  };
  state.startSpan(0, baseline);
  // Guaranteed flat, trap-free run-up so a run never starts by dropping
  // the player straight onto an obstacle before they can react.
  appendFlat(state, SAFE_START_LENGTH);
  return state;
}

// Generates more terrain until the span cursor has reached at least
// targetX, using a difficulty ramp (0 at run start, ~1 after ~90s) that
// both scales individual feature parameters AND unlocks whole feature
// tiers (yellow -> yellow+red -> yellow+red+blue) as it climbs.
export function generateAhead(state, targetX, elapsedSeconds) {
  const t = Math.min(1, elapsedSeconds / 90);
  while (state.cursorX < targetX) {
    let feature;
    const next = TIER_INTRODUCTIONS[state.introducedTierCount];
    if (next && next.tier <= t) {
      feature = next;
      state.introducedTierCount++;
    } else {
      feature = pickFeature(state.lastFeature, t);
    }
    feature.run(state, t);
    state.lastFeature = feature.type;
  }
}

// Removes spans/traps that have fully scrolled behind minX - margin.
// Returns the removed traps so callers can clean up their physics
// bodies.
export function pruneBehind(state, minX) {
  const cutoff = minX - GAP_PRUNE_MARGIN;
  state.spans = state.spans.filter((span) => span[span.length - 1].x > cutoff);

  const keptTraps = [];
  const removedTraps = [];
  for (const trap of state.traps) {
    const rightEdge = trap.x2 ?? trap.x ?? trap.anchorX ?? 0;
    if (rightEdge > cutoff) keptTraps.push(trap);
    else removedTraps.push(trap);
  }
  state.traps = keptTraps;

  return removedTraps;
}
