import { useEffect, useRef } from "react";
import Matter from "matter-js";
import { createTerrainState, generateAhead, pruneBehind, GAP_PRUNE_MARGIN } from "./terrain.js";
import { resumeAudio, updateEngine, playJump, playLand, playCrash, playScore, playBoost, stopEngine } from "./sound.js";

const { Engine, Body, Bodies, Composite, Constraint, Events } = Matter;

// Collision categories - kept simple: the bike's wheels are only allowed
// to rest on "ground" (real terrain AND the safe moving platforms), while
// touching anything in "trap" ends the run immediately. The chassis
// touching either ground or a trap also ends the run (you can't land on
// your frame).
const CATEGORY_GROUND = 0x0002;
const CATEGORY_BIKE = 0x0004;
const CATEGORY_TRAP = 0x0008;

// ---------------- physics tuning ----------------
// Jumping is now a discrete action (double-tap - see DOUBLE_TAP_WINDOW
// below), not something that emerges from ramp launch physics. That
// makes the whole system much more predictable: JUMP_VELOCITY is a
// fixed upward kick applied the instant a double-tap is registered
// while grounded, and it deliberately never touches horizontal
// velocity - so a bike already moving keeps moving at the same speed
// through the jump (carries its momentum forward), while a bike at a
// standstill just hops straight up and back down. Propulsion is a
// direct forward force on the chassis (not wheel friction) so it's
// never affected by how the wheels happen to be spinning; wheel
// rotation itself is left entirely to Matter's own friction/contact
// simulation. Angular momentum in the air is barely damped - once a
// flip is spinning, it keeps spinning instead of politely stopping the
// moment gas is released, matching how a real spinning mass behaves.
const GRAVITY_Y = 0.68;
const FORWARD_FORCE = 0.019;
// Rear-wheel spin under power is purely COSMETIC (a separate drawn
// rotation, not a real physics torque) - see rearSpinAngle below.
// Applying real torque to the rear wheel turned out to transmit a
// reaction force straight through its axle pin into the chassis
// (offset from the center of mass), pitching the whole bike forward
// under acceleration - a real wheelie-causing mechanism, just not one
// we want here where stable, predictable ground handling matters more
// than that extra bit of realism. Propulsion itself is entirely the
// direct FORWARD_FORCE on the chassis above, completely unaffected by
// this.
const REAR_SPIN_RATE = 0.045; // cosmetic radians per (ms * speedFraction) while driving
const MAX_SPEED = 31;
const JUMP_VELOCITY = 50; // upward kick from a double-tap, horizontal velocity untouched
const DOUBLE_TAP_WINDOW = 320; // ms between taps to register as a boost request instead of two separate presses
const JUMP_COYOTE_MS = 140; // still allow a jump for a brief window after ground contact is lost -
// covers a bike balanced on just the front wheel (or a bumpy-terrain contact flicker), not just
// a fully-planted landing on both wheels.

const BOOST_DURATION_MS = 650; // how long a triggered boost actually lasts (was 2200 - too long, led to unavoidable crashes)
const BOOST_COOLDOWN_MS = 10000; // how long the boost bar takes to refill after use
const BOOST_MAX_SPEED = MAX_SPEED * 1.2; // faster top speed while boosting (was *1.7 - too fast to react to)
const BOOST_FLASH_MS = 220; // one-shot screen-flash duration when a boost triggers
const BOOST_CAMERA_FOLLOW_MULT = 2.2; // camera pan speed multiplier while boosting - keeps the now-faster bike in frame
const BOOST_EXTRA_ZOOM_OUT = 0.05; // small extra zoom-out on top of the normal speed-based zoom while boosting
const BOOST_MAX_PITCH = Math.PI / 3.2; // ~56° - how far off-horizontal a boost is allowed to fire, either way
const AIR_PITCH_TORQUE = 0.0044; // doubled - ramps up over ~1.1s of holding - deliberate, not an instant snap
const AIR_PITCH_MAX_SPIN = 4.8; // rad/s - doubled - more room to commit to a full flip on a big jump
const AUTO_LEVEL_DAMPING = 0.006; // barely bleeds off existing spin - a flip keeps turning once started
const FALL_DEATH_OFFSET = 1400; // generous last-resort net; the real catch is the pit's spike floor

const LOOP_DURATION_MS = 900; // fixed time to complete a scripted 360° loop, regardless of entry speed
const LOOP_MIN_EXIT_SPEED = 8; // even a bike that entered slowly exits the loop with at least this much speed
const CAMERA_LEAD_X = 0.32;
const CAMERA_FOLLOW_X = 0.09;
const CAMERA_FOLLOW_Y = 0.08;
const CAMERA_MAX_ZOOM_OUT = 0.12; // fraction zoomed out at top speed
const CAMERA_ZOOM_SMOOTHING = 0.05;
const CAMERA_SHAKE_START_FRACTION = 0.7; // shake only kicks in above 70% of top speed
const CAMERA_SHAKE_MAX_PX = 2.5;
const FIXED_DT = 1000 / 60; // fixed physics step for smooth, frame-rate-independent motion
const MAX_STEPS_PER_FRAME = 5; // avoid a "spiral of death" after a tab switch/lag spike
const EXPLOSION_DURATION = 700;
const TRAIL_LENGTH = 14; // rear-wheel light-trail particle count
const HARD_LANDING_VY = 3; // impact speed above which a landing spawns dust + a camera thump
// Small terrain jitter constantly flickers the wheel-ground contact off and
// on for a tick or two even though the bike barely left the surface - that
// used to re-trigger the landing thump every single time. Impact speed on
// landing tracks how far the wheel actually rose (a harder fall means it
// had more height to fall from), so gating the sound on a minimum impact
// speed is the same as gating it on "rose a real amount off the ground":
// tiny jitter stays silent, an actual hop/jump/gap landing still plays.
const MIN_LAND_VY = 1.1;

// ---------------- scoring: distance + speed based currency ----------------
// The world is scaled at PX_PER_METER px per in-game meter (matches
// GROUND_STEP, so one generated terrain step is roughly one meter) - this
// is what turns the bike's raw pixel position/velocity into real-feeling
// meters and km/h for the HUD and the reward math below.
const PX_PER_METER = 24;
const TICKS_PER_SECOND = 1000 / FIXED_DT; // physics ticks per real second
const REWARD_DISTANCE_METERS = 100; // a payout fires every time this many more meters are cleared
const REWARD_DISTANCE_PX = REWARD_DISTANCE_METERS * PX_PER_METER;

function velocityToKmh(vx) {
  const metersPerSecond = (vx * TICKS_PER_SECOND) / PX_PER_METER;
  return Math.max(0, metersPerSecond * 3.6);
}

// Reward per 100m scales with how fast the bike was going when that
// stretch was cleared: bottom third of top speed pays 1 unit, middle
// third pays 2, and the top third (or anything boosting past MAX_SPEED)
// pays 3 - the ceiling of the 3 tiers, never above 3, never below 1 for
// genuine forward progress.
function speedRewardTier(speedFraction) {
  const fraction = Math.min(1, Math.max(0, speedFraction));
  return Math.max(1, Math.min(3, Math.ceil(fraction * 3)));
}

// Matter.js's chassis.angle accumulates without wrapping (it can be well
// past ±2π after a few flips), so anything that wants to reason about
// "which way is the nose pointing right now" needs this first.
function normalizeAngle(angle) {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isWheel(body) {
  return body.label === "wheel";
}
function isChassis(body) {
  return body.label === "chassis";
}
function isGround(body) {
  return body.collisionFilter.category === CATEGORY_GROUND;
}
function isTrap(body) {
  return body.collisionFilter.category === CATEGORY_TRAP;
}

function createBike(x, y) {
  const group = Body.nextGroup(true);
  const wheelRadius = 12; // slightly smaller tires (was 14)
  const wheelBase = 44;
  const rideHeight = 12;

  const chassis = Bodies.rectangle(x, y, 52, 12, {
    collisionFilter: { group, category: CATEGORY_BIKE, mask: CATEGORY_GROUND | CATEGORY_TRAP },
    density: 0.0038, // heavier chassis - more real inertia/momentum, less like a paper cutout
    friction: 0.3,
    frictionAir: 0.008, // lighter air drag so momentum (linear AND angular) carries through a jump
    label: "chassis",
  });

  const rearWheel = Bodies.circle(x - wheelBase / 2, y + rideHeight, wheelRadius, {
    collisionFilter: { group, category: CATEGORY_BIKE, mask: CATEGORY_GROUND | CATEGORY_TRAP },
    friction: 1.1,
    frictionStatic: 1.6,
    density: 0.012,
    label: "wheel",
  });

  const frontWheel = Bodies.circle(x + wheelBase / 2, y + rideHeight, wheelRadius, {
    collisionFilter: { group, category: CATEGORY_BIKE, mask: CATEGORY_GROUND | CATEGORY_TRAP },
    friction: 1.1,
    frictionStatic: 1.6,
    density: 0.012,
    label: "wheel",
  });

  const rearAxle = Constraint.create({
    bodyA: chassis,
    pointA: { x: -wheelBase / 2, y: rideHeight },
    bodyB: rearWheel,
    stiffness: 1,
    damping: 0.25,
    length: 0,
  });

  const frontAxle = Constraint.create({
    bodyA: chassis,
    pointA: { x: wheelBase / 2, y: rideHeight },
    bodyB: frontWheel,
    stiffness: 1,
    damping: 0.25,
    length: 0,
  });

  return { chassis, rearWheel, frontWheel, rearAxle, frontAxle, wheelRadius };
}

function buildGroundSegment(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) + 2;
  const angle = Math.atan2(dy, dx);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const thickness = 46;
  return Bodies.rectangle(midX, midY + thickness / 2, length, thickness, {
    isStatic: true,
    angle,
    friction: 1,
    collisionFilter: { category: CATEGORY_GROUND, mask: CATEGORY_BIKE },
    label: "ground",
  });
}

function buildTrapBody(trap) {
  switch (trap.type) {
    case "spike":
      return Bodies.rectangle(trap.x, trap.y - trap.height / 2, trap.width * 0.85, trap.height, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    case "pitfloor": {
      const midX = (trap.x1 + trap.x2) / 2;
      const width = trap.x2 - trap.x1;
      return Bodies.rectangle(midX, trap.y, width, 50, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    }
    case "platform":
      return Bodies.rectangle(trap.x, trap.y, trap.width, trap.height, {
        isStatic: true,
        friction: 1,
        collisionFilter: { category: CATEGORY_GROUND, mask: CATEGORY_BIKE },
        label: "ground",
      });
    // RED - moving/rotating hazards
    case "wreckingBall":
      return Bodies.circle(trap.anchorX, trap.anchorY + trap.length, trap.radius, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    case "sawBlade":
      return Bodies.circle(trap.x, trap.y, trap.radius * 0.85, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    case "chaser":
      return Bodies.circle(trap.x, trap.y, trap.radius, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    case "spikePillars":
      return Bodies.rectangle((trap.x1 + trap.x2) / 2, trap.y, trap.x2 - trap.x1, trap.height, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    // rotatingBar (red) and swingGate (blue) share the same physical
    // shape - a bar hanging from a pivot point at (trap.x, trap.y),
    // pointing straight down at angle 0 - only how updateMovingTraps
    // animates their angle over time differs.
    case "rotatingBar":
    case "swingGate":
      return Bodies.rectangle(trap.x, trap.y + trap.length / 2, 12, trap.length, {
        isStatic: true,
        collisionFilter: { category: CATEGORY_TRAP, mask: CATEGORY_BIKE },
        label: "trap",
      });
    // "loop" is a pure scripted-position stunt with no physics body at
    // all (see activeLoop handling in stepPhysics) - the ground stays
    // flat and collidable right through its zone, and the loop ring is
    // purely visual + a position/angle override triggered by x-crossing.
    case "loop":
      return null;
    default:
      return null;
  }
}

// ---------------- rendering ----------------
// Glow is done with modest shadowBlur values and as few extra save/
// restore + shadow-state switches as possible - canvas shadowBlur is
// expensive, and stacking many large-blur passes per frame is the
// single biggest cause of a choppy-feeling game on real phones.

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, SCENE_COLORS.skyTop);
  gradient.addColorStop(1, SCENE_COLORS.skyBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawSkyline(ctx, cameraX, viewWidth, viewHeight) {
  ctx.save();
  // Bumped from 0.18 - against the now-darker sky below, the old value
  // barely registered as a silhouette at all.
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  const parallax = 0.25;
  // Raised from 0.74 - hugging the very bottom of the frame left the
  // entire upper ~70% of the screen as one flat, featureless gradient.
  // Sitting further up means these peaks actually break up that empty
  // space instead of only ever grazing the road line below.
  const baseY = viewHeight * 0.58;
  const spacing = 260;
  const scrollX = cameraX * parallax;
  const offset = -(scrollX % spacing);
  for (let x = offset - spacing; x < viewWidth + spacing; x += spacing) {
    const seedIndex = Math.round((x + scrollX) / spacing);
    const peakHeight = 130 + Math.abs(Math.sin(seedIndex * 12.9898)) * 190;
    ctx.beginPath();
    ctx.moveTo(x, viewHeight + 10);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x + spacing * 0.5, baseY - peakHeight);
    ctx.lineTo(x + spacing, baseY);
    ctx.lineTo(x + spacing, viewHeight + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// A second, closer silhouette layer between the far skyline and the
// actual track - scrolls faster (bigger parallax factor) and sits lower/
// darker, giving the background real depth instead of one flat layer.
function drawMidground(ctx, cameraX, viewWidth, viewHeight) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  const parallax = 0.55;
  const baseY = viewHeight * 0.76;
  const spacing = 150;
  const scrollX = cameraX * parallax;
  const offset = -(scrollX % spacing);
  for (let x = offset - spacing; x < viewWidth + spacing; x += spacing) {
    const seedIndex = Math.round((x + scrollX) / spacing);
    const peakHeight = 55 + Math.abs(Math.sin(seedIndex * 7.233)) * 95;
    ctx.beginPath();
    ctx.moveTo(x, viewHeight + 10);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x + spacing * 0.5, baseY - peakHeight);
    ctx.lineTo(x + spacing, baseY);
    ctx.lineTo(x + spacing, viewHeight + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Ground fill always extends well below the current camera view, so a
// span never reads as a thin floating ribbon with void underneath - and
// at a gap's edges, two spans' fills naturally form facing canyon walls
// around the pit floor.
function drawGround(ctx, terrain, cameraX, viewWidth, fillBottomY) {
  ctx.save();
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const span of terrain.spans) {
    if (span.length < 2) continue;
    const last = span[span.length - 1];
    const first = span[0];
    if (last.x < cameraX - 50 || first.x > cameraX + viewWidth + 50) continue;

    ctx.fillStyle = SCENE_COLORS.groundFill;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < span.length; i++) ctx.lineTo(span[i].x, span[i].y);
    ctx.lineTo(last.x, fillBottomY);
    ctx.lineTo(first.x, fillBottomY);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = SCENE_COLORS.groundGlowShadow;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = SCENE_COLORS.groundGlow;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < span.length; i++) ctx.lineTo(span[i].x, span[i].y);
    ctx.stroke();

    // A thinner, dimmer parallel line a little below the main glow -
    // reads as a second energy conduit running alongside the track
    // instead of a single flat ribbon.
    ctx.save();
    ctx.shadowBlur = 6;
    ctx.strokeStyle = SCENE_COLORS.groundGlowDim;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y + 10);
    for (let i = 1; i < span.length; i++) ctx.lineTo(span[i].x, span[i].y + 10);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawSpike(ctx, trap) {
  ctx.save();
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "#ff8080";
  ctx.fillStyle = "rgba(255, 77, 77, 0.28)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(trap.x, trap.y - trap.height);
  ctx.lineTo(trap.x - trap.width / 2, trap.y);
  ctx.lineTo(trap.x + trap.width / 2, trap.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPitFloor(ctx, trap) {
  ctx.save();
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "#ff8080";
  ctx.fillStyle = "rgba(255, 77, 77, 0.25)";
  ctx.lineWidth = 2;
  const spikeWidth = 26;
  const count = Math.max(1, Math.round((trap.x2 - trap.x1) / spikeWidth));
  const step = (trap.x2 - trap.x1) / count;
  for (let i = 0; i < count; i++) {
    const cx = trap.x1 + step * (i + 0.5);
    ctx.beginPath();
    ctx.moveTo(cx, trap.y - 26);
    ctx.lineTo(cx - step / 2, trap.y);
    ctx.lineTo(cx + step / 2, trap.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlatform(ctx, body) {
  ctx.save();
  ctx.shadowColor = "#6fe3b4";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "rgba(111, 227, 180, 0.3)";
  ctx.strokeStyle = "#8ffcd0";
  ctx.lineWidth = 3;
  const { vertices } = body;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---- RED: moving/rotating hazards ----

function drawWreckingBall(ctx, trap, body) {
  ctx.save();
  // A few short chain-link segments instead of one plain line, for the
  // "hanging from chains" read.
  const linkCount = Math.max(3, Math.round(trap.length / 22));
  ctx.strokeStyle = "rgba(255, 150, 150, 0.55)";
  ctx.lineWidth = 3;
  for (let i = 0; i < linkCount; i++) {
    const p0 = i / linkCount;
    const p1 = (i + 1) / linkCount;
    const x0 = trap.anchorX + (body.position.x - trap.anchorX) * p0;
    const y0 = trap.anchorY + (body.position.y - trap.anchorY) * p0;
    const x1 = trap.anchorX + (body.position.x - trap.anchorX) * p1;
    const y1 = trap.anchorY + (body.position.y - trap.anchorY) * p1;
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, 5, 3, Math.atan2(y1 - y0, x1 - x0), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ff6b6b";
  ctx.beginPath();
  ctx.arc(body.position.x, body.position.y, trap.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffb3b3";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(body.position.x + Math.cos(a) * trap.radius, body.position.y + Math.sin(a) * trap.radius);
    ctx.lineTo(body.position.x + Math.cos(a) * (trap.radius + 7), body.position.y + Math.sin(a) * (trap.radius + 7));
    ctx.stroke();
  }
  ctx.restore();
}

function drawSawBlade(ctx, trap, elapsed) {
  const angle = elapsed * trap.speed * 1.6;
  const x = trap.x + (trap.travelX ? Math.sin(elapsed * trap.travelSpeed) * trap.travelX : 0);
  ctx.save();
  ctx.translate(x, trap.y);
  ctx.rotate(angle);
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "#ff8080";
  ctx.fillStyle = "rgba(255, 77, 77, 0.35)";
  ctx.lineWidth = 2.5;

  const spikeCount = 14;
  ctx.beginPath();
  for (let i = 0; i < spikeCount; i++) {
    const a1 = (i / spikeCount) * Math.PI * 2;
    const a2 = ((i + 0.5) / spikeCount) * Math.PI * 2;
    const outer = trap.radius;
    const inner = trap.radius * 0.62;
    const x1 = Math.cos(a1) * outer;
    const y1 = Math.sin(a1) * outer;
    const x2 = Math.cos(a2) * inner;
    const y2 = Math.sin(a2) * inner;
    if (i === 0) ctx.moveTo(x1, y1);
    else ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, trap.radius * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "#3b0000";
  ctx.fill();
  ctx.restore();
}

function drawRotatingBar(ctx, trap, body) {
  ctx.save();
  ctx.translate(trap.x, trap.y);
  ctx.rotate(body.angle);

  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#ff8080";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#ff8080";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, trap.length);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, trap.length, 9, 0, Math.PI * 2);
  ctx.fillStyle = "#ffb3b3";
  ctx.fill();
  ctx.restore();
}

function drawChaser(ctx, trap, body) {
  ctx.save();
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#ff5c5c";
  ctx.beginPath();
  ctx.arc(body.position.x, body.position.y, trap.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffd0d0";
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(body.position.x + Math.cos(a) * trap.radius, body.position.y + Math.sin(a) * trap.radius);
    ctx.lineTo(body.position.x + Math.cos(a) * (trap.radius + 8), body.position.y + Math.sin(a) * (trap.radius + 8));
    ctx.stroke();
  }
  // A little glint so it visually reads as "hunting" rather than just
  // another spinning saw.
  ctx.fillStyle = "#fff3d6";
  ctx.beginPath();
  ctx.arc(body.position.x + trap.radius * 0.4, body.position.y - trap.radius * 0.2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpikePillars(ctx, trap, extension) {
  ctx.save();
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "#ff8080";
  ctx.fillStyle = "rgba(255, 77, 77, 0.35)";
  ctx.lineWidth = 2.5;
  const pillarWidth = 10;
  const raisedHeight = trap.height * extension;
  for (const px of [trap.x1 + pillarWidth, trap.x2 - pillarWidth]) {
    ctx.beginPath();
    ctx.rect(px - pillarWidth / 2, trap.y - raisedHeight, pillarWidth, raisedHeight);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px - pillarWidth / 2 - 3, trap.y - raisedHeight);
    ctx.lineTo(px, trap.y - raisedHeight - 12);
    ctx.lineTo(px + pillarWidth / 2 + 3, trap.y - raisedHeight);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---- BLUE: timing gates ----

// ---- SPECTACLE: scripted 360° loop ring ----
// Colored to match the two reference looks: a clean loop glows warm
// gold, a loop with a saw blade waiting inside glows icy blue-white so
// it visually reads as "sharper/more dangerous" before you even spot
// the blade itself.
function drawLoopRing(ctx, trap) {
  const centerX = trap.x;
  const centerY = trap.y - trap.radius;
  const base = trap.hasSaw ? "#eaf6ff" : "#f2c14e";
  const bright = trap.hasSaw ? "#9fd8ff" : "#ffd989";

  ctx.save();
  ctx.shadowColor = base;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = base;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(centerX, centerY, trap.radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur = 8;
  ctx.strokeStyle = bright;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, trap.radius - 5, 0, Math.PI * 2);
  ctx.stroke();

  // A few small glowing marker pips around the ring, matching the
  // reference images' diamond accents - purely decorative.
  ctx.shadowBlur = 10;
  ctx.fillStyle = bright;
  const pipCount = 5;
  for (let i = 0; i < pipCount; i++) {
    const a = (i / pipCount) * Math.PI * 2 - Math.PI / 2;
    const px = centerX + Math.cos(a) * (trap.radius + 14);
    const py = centerY + Math.sin(a) * (trap.radius + 14);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  ctx.restore();
}

function drawSwingGate(ctx, trap, body, openFraction) {
  ctx.save();
  ctx.translate(trap.x, trap.y);
  ctx.rotate(body.angle);

  // Dim and translucent while open (low visual weight - it's safe right
  // now), bright and bold while closing/closed (it reads as active
  // danger exactly when it is one).
  const closedness = 1 - openFraction;
  ctx.shadowColor = "#3b9dff";
  ctx.shadowBlur = 8 + closedness * 12;
  ctx.fillStyle = "#4fb0ff";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = openFraction > 0.7 ? "rgba(79, 176, 255, 0.35)" : "#4fb0ff";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, trap.length);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, trap.length, 9, 0, Math.PI * 2);
  ctx.fillStyle = "#bfe3ff";
  ctx.fill();
  ctx.restore();
}

function drawTrail(ctx, trailPoints, boosted) {
  if (trailPoints.length < 2) return;
  ctx.save();
  ctx.strokeStyle = boosted ? "#6fe0ff" : "#ff6ec7";
  ctx.lineCap = "round";
  if (boosted) {
    ctx.shadowColor = "#9df2ff";
    ctx.shadowBlur = 10;
  }
  for (let i = 1; i < trailPoints.length; i++) {
    const p0 = trailPoints[i - 1];
    const p1 = trailPoints[i];
    const alpha = i / trailPoints.length;
    ctx.globalAlpha = alpha * (boosted ? 0.75 : 0.5);
    ctx.lineWidth = (boosted ? 5.5 : 4) * alpha;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================================================
// CyberBike — reproduces the original reference image 1:1 by geometry.
// Master/reference coordinate system: 1536x700, origin top-left, x→right, y→down.
// All body panel vertices below are the exact reference-image coordinates.
// A single similarity transform (uniform scale + rotation, no X/Y skew) maps
// every reference point into world space by aligning the two reference wheel
// centers onto the bike's real rear/front physics wheel positions, so the art
// always lands exactly on the collision wheels at any game resolution.
// ============================================================================

const CYBERBIKE_REF = {
  rearWheel: { x: 233, y: 482 },
  frontWheel: { x: 1301, y: 482 },
  outerRadius: 171,
  innerRadius: 138,
};

// ---------------- theme-aware palette ----------------
// The bike + background/ground used to always be a fixed purple-on-
// maroon look, regardless of the player's chosen accent color. These
// helpers derive a matching palette from the live --gold/--gold-bright/
// --ink CSS variables instead (see applyThemeColors, called once per
// mount below) so Ride actually recolors with the rest of the app.

function hexToRgb(hex) {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}
function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}
function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const darkenHex = (hex, t) => mixHex(hex, "#000000", t);
const lightenHex = (hex, t) => mixHex(hex, "#ffffff", t);

// Defaults match the original always-purple bike / always-maroon scene,
// used until applyThemeColors() runs (or as a fallback if it can't read
// the CSS vars for some reason).
let CYBERBIKE_PALETTE = {
  darkestPurple: "#10032D",
  darkBody: "#200852",
  bodyPurple: "#320D7C",
  brightBodyPurple: "#4A11B1",
  neonPurple: "#6C1CDD",
  violet: "#4825E6",
  whiteGlow: "#F7EEFF",
  cyan: "#97E7FB",
  brightCyan: "#EAFEFF",
};

let SCENE_COLORS = {
  skyTop: "#3a0f1f",
  skyBottom: "#1c0812",
  groundFill: "#2b0e10",
  groundGlow: "#ffedb0",
  groundGlowShadow: "#f2c14e",
  groundGlowDim: "rgba(255, 138, 61, 0.55)",
};

// How far down (px) the HUD gets shifted so it never sits under the
// device's own notch/status bar or Telegram's floating fullscreen
// controls - see applySafeAreaOffset, called once per mount below.
let HUD_TOP_OFFSET = 0;

function applySafeAreaOffset() {
  const styles = getComputedStyle(document.documentElement);
  const safeTop = parseFloat(styles.getPropertyValue("--tg-safe-top")) || 0;
  const contentTop = parseFloat(styles.getPropertyValue("--tg-content-safe-top")) || 0;
  // Different Telegram clients split "device notch" vs "Telegram's own
  // fullscreen controls" between these two differently - taking the
  // larger of the two is the safe bet either way.
  HUD_TOP_OFFSET = Math.max(safeTop, contentTop);
}

// Reads the current accent straight off `el` (any node inside .app-shell
// works - custom properties inherit down the DOM tree) and rebuilds both
// palettes above from it.
//
// Ground and bike-body colors are a deliberate CROSS-mapping per accent
// (picked by the player, not derived from --gold) rather than "ground/
// bike = the accent's own color" - e.g. the red theme's ride scene is
// yellow ground + blue bike, not red+red. Rims/tires (WHEEL_PALETTE,
// just below) and the headlight/visor trim (whiteGlow/cyan/brightCyan)
// intentionally never change - only the body panels do.
const RIDE_THEME_COLORS = {
  red: { ground: "#eab308", body: "#2563eb" }, // yellow ground, blue bike
  blue: { ground: "#dc2626", body: "#eab308" }, // red ground, yellow bike
  yellow: { ground: "#2563eb", body: "#dc2626" }, // blue ground, red bike
  green: { ground: "#22c55e", body: "#ec4899" }, // green ground, pink bike
  blackgold: { ground: "#eab308", body: "#3f3f46", trim: "#ffd700" }, // yellow ground, dark grey bike w/ fine gold trim
};

// Rims + tires - fixed regardless of theme, never reassigned.
const WHEEL_PALETTE = {
  whiteGlow: "#F7EEFF",
  neonPurple: "#6C1CDD",
  darkestPurple: "#10032D",
};

// The player's actual picked accent theme (SettingsSheet's color drawer)
// drives the sky + the plain (non-neon) ground fill beneath the glowing
// track, so the Ride scene reads as "your theme, at night" instead of
// always the same red/purple regardless of accent. Read straight off the
// same CSS custom properties the rest of the app already uses for that
// accent (--ink-glow/--ink/--surface-raised) rather than re-deriving new
// tints by hand - they're already tuned to look good together, and a
// flat, fully-saturated fill (this used to just be --gold verbatim)
// turned out too intense/flat for a full-screen background.
// Kept independent of RIDE_THEME_COLORS above on purpose: that one
// deliberately CROSS-maps (red theme -> yellow neon road/blue bike) and
// stays untouched - this is only for the background + plain ground.
function applyThemeColors(el) {
  const accentId = el.closest(".app-shell")?.getAttribute("data-accent") || "red";
  const theme = RIDE_THEME_COLORS[accentId] || RIDE_THEME_COLORS.red;
  const body = theme.body;
  // blackgold's bike is a dark neutral grey with a gold trim accent
  // instead of a lighten/darken ramp of the body color itself (a grey
  // ramp alone reads as flat/dull - the trim color is what makes the
  // "fine patterns" on it actually read as gold).
  const trim = theme.trim || lightenHex(body, 0.35);

  CYBERBIKE_PALETTE = {
    darkestPurple: darkenHex(body, 0.78),
    darkBody: darkenHex(body, 0.5),
    bodyPurple: darkenHex(body, 0.18),
    brightBodyPurple: mixHex(body, trim, 0.5),
    neonPurple: body,
    violet: mixHex(body, trim, 0.35),
    // Kept static: headlight glow + a small cool-toned visor trim that
    // reads well against any body color, rather than every accent
    // losing its one contrast highlight.
    whiteGlow: "#F7EEFF",
    cyan: "#97E7FB",
    brightCyan: "#EAFEFF",
  };

  const ground = theme.ground;
  const shellStyles = getComputedStyle(el.closest(".app-shell") || el);
  const readVar = (name, fallback) => (shellStyles.getPropertyValue(name) || "").trim() || fallback;
  const inkGlow = readVar("--ink-glow", "#3d0f10");
  const ink = readVar("--ink", "#170707");
  SCENE_COLORS = {
    // A soft glow of the theme color at the horizon, fading to a near-
    // black shade BELOW the theme's own ink (not just to it) - the flat,
    // barely-different top/bottom pairing this used to be read as one
    // dull solid block filling most of the screen. A wider, darker
    // spread gives the empty sky real depth even before the mountain
    // silhouettes on top of it.
    skyTop: inkGlow,
    skyBottom: darkenHex(ink, 0.55),
    // Plain dirt under the glowing track line - the theme's own raised
    // surface color, a clear step lighter than the sky so it still reads
    // as its own surface rather than blending into the background.
    groundFill: readVar("--surface-raised", "#331515"),
    // The glowing road surface itself + the bike stay on the cross-mapped
    // RIDE_THEME_COLORS palette (unchanged) - only the background/plain
    // ground above switch to the literal theme color.
    groundGlow: lightenHex(ground, 0.55),
    groundGlowShadow: ground,
    // "The line under the ground is a few shades darker than the ground
    // itself" - a shade of groundFill's own color, not the glow color.
    groundGlowDim: hexToRgba(darkenHex(ground, 0.25), 0.6),
  };
}

// Traced vertex lists, exactly as given in the reference (1536x700 master canvas).
const CYBERBIKE_REAR_TOP_SILHOUETTE = [[78, 111], [680, 197], [835, 228], [620, 274], [365, 271]];
const CYBERBIKE_MAIN_BODY = [[470, 326], [628, 297], [1018, 240], [1110, 250], [1058, 420], [1060, 563], [720, 535], [470, 400]];
const CYBERBIKE_LOWER_BODY = [[174, 433], [605, 350], [661, 415], [1057, 420], [1348, 446], [1388, 527], [1070, 525], [722, 492], [430, 480], [174, 530]];
const CYBERBIKE_DARK_LEFT_PANEL = [[202, 442], [610, 354], [661, 415], [249, 478]];
const CYBERBIKE_UPPER_BODY = [[682, 190], [855, 106], [1095, 52], [1325, 161]];
const CYBERBIKE_CYAN_PANEL = [[1018, 310], [1106, 326], [1055, 475], [888, 425]];
const CYBERBIKE_HEADLIGHT = [[1129, 125], [1272, 158], [1216, 174], [1150, 161]];

// Tail anchor - used for the exhaust-spark flicker while gas is held, so
// the effect sits at the back of the body instead of a hardcoded offset.
const CYBERBIKE_TAIL_TIP = [174, 480];

// Builds the reference→world mapper for the current frame's wheel positions.
function cyberBikeTransform(bike) {
  const { rearWheel, frontWheel } = bike;
  const refDx = CYBERBIKE_REF.frontWheel.x - CYBERBIKE_REF.rearWheel.x;
  const refDy = CYBERBIKE_REF.frontWheel.y - CYBERBIKE_REF.rearWheel.y;
  const refLen = Math.hypot(refDx, refDy);

  const realDx = frontWheel.position.x - rearWheel.position.x;
  const realDy = frontWheel.position.y - rearWheel.position.y;
  const realLen = Math.hypot(realDx, realDy);

  const scale = realLen / refLen; // uniform — never stretched independently on X/Y
  const theta = Math.atan2(realDy, realDx);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const toWorld = (rx, ry) => {
    const dx = (rx - CYBERBIKE_REF.rearWheel.x) * scale;
    const dy = (ry - CYBERBIKE_REF.rearWheel.y) * scale;
    return {
      x: rearWheel.position.x + dx * cosT - dy * sinT,
      y: rearWheel.position.y + dx * sinT + dy * cosT,
    };
  };

  return { toWorld, scale };
}

function cyberBikePath(ctx, toWorld, points) {
  ctx.beginPath();
  points.forEach(([rx, ry], i) => {
    const p = toWorld(rx, ry);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function CyberBike(ctx, bike, rearSpinAngle, gasHeld) {
  const { rearWheel, frontWheel, wheelRadius } = bike;
  const { toWorld, scale } = cyberBikeTransform(bike);

  // --- WHEELS: identical diameter, white/purple neon ring, 8 angular spokes ---
  const drawWheel = (wx, wy, spinAngle) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(spinAngle);

    ctx.shadowColor = WHEEL_PALETTE.whiteGlow;
    ctx.shadowBlur = 28;
    ctx.beginPath();
    ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2);
    ctx.strokeStyle = WHEEL_PALETTE.whiteGlow;
    ctx.lineWidth = wheelRadius * (12 / CYBERBIKE_REF.outerRadius);
    ctx.stroke();

    const innerR = wheelRadius * (CYBERBIKE_REF.innerRadius / CYBERBIKE_REF.outerRadius);
    ctx.shadowColor = WHEEL_PALETTE.neonPurple;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = WHEEL_PALETTE.neonPurple;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = WHEEL_PALETTE.darkestPurple;
    ctx.lineWidth = 2;
    const spokeR = innerR - 4;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * spokeR, Math.sin(a) * spokeR);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 0, wheelRadius * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = WHEEL_PALETTE.darkestPurple;
    ctx.fill();

    ctx.restore();
  };

  drawWheel(rearWheel.position.x, rearWheel.position.y, rearSpinAngle);
  drawWheel(frontWheel.position.x, frontWheel.position.y, frontWheel.angle);

  // --- BODY: sharp angular low-poly panels, stacked back-to-front as in the reference ---
  ctx.save();

  cyberBikePath(ctx, toWorld, CYBERBIKE_REAR_TOP_SILHOUETTE);
  ctx.fillStyle = CYBERBIKE_PALETTE.darkestPurple;
  ctx.fill();

  cyberBikePath(ctx, toWorld, CYBERBIKE_LOWER_BODY);
  ctx.fillStyle = CYBERBIKE_PALETTE.darkBody;
  ctx.fill();
  ctx.strokeStyle = CYBERBIKE_PALETTE.neonPurple;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  cyberBikePath(ctx, toWorld, CYBERBIKE_DARK_LEFT_PANEL);
  ctx.fillStyle = CYBERBIKE_PALETTE.darkestPurple;
  ctx.fill();

  cyberBikePath(ctx, toWorld, CYBERBIKE_MAIN_BODY);
  ctx.fillStyle = CYBERBIKE_PALETTE.bodyPurple;
  ctx.fill();
  ctx.strokeStyle = CYBERBIKE_PALETTE.violet;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  cyberBikePath(ctx, toWorld, CYBERBIKE_UPPER_BODY);
  ctx.fillStyle = CYBERBIKE_PALETTE.brightBodyPurple;
  ctx.fill();
  ctx.shadowColor = CYBERBIKE_PALETTE.neonPurple;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = CYBERBIKE_PALETTE.neonPurple;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;

  cyberBikePath(ctx, toWorld, CYBERBIKE_CYAN_PANEL);
  ctx.shadowColor = CYBERBIKE_PALETTE.cyan;
  ctx.shadowBlur = 22;
  ctx.fillStyle = CYBERBIKE_PALETTE.cyan;
  ctx.fill();
  ctx.strokeStyle = CYBERBIKE_PALETTE.brightCyan;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.shadowBlur = 0;

  cyberBikePath(ctx, toWorld, CYBERBIKE_HEADLIGHT);
  ctx.shadowColor = CYBERBIKE_PALETTE.violet;
  ctx.shadowBlur = 26;
  ctx.fillStyle = CYBERBIKE_PALETTE.brightCyan;
  ctx.fill();
  ctx.strokeStyle = CYBERBIKE_PALETTE.cyan;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Ambient light actually cast forward from the headlight - a soft radial
  // glow centered on the lamp, on top of the polygon fill above, so the
  // light reads as a real light source and not just a lit-up shape.
  {
    const lampCenter = toWorld(1188, 149); // roughly the headlight polygon's own center
    const glowR = 30 * scale;
    const headlightGlow = ctx.createRadialGradient(
      lampCenter.x, lampCenter.y, 0,
      lampCenter.x, lampCenter.y, glowR
    );
    headlightGlow.addColorStop(0, "rgba(234, 254, 255, 0.55)");
    headlightGlow.addColorStop(1, "rgba(234, 254, 255, 0)");
    ctx.fillStyle = headlightGlow;
    ctx.beginPath();
    ctx.arc(lampCenter.x, lampCenter.y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // A little exhaust spark flicker at the tail while actually driving -
  // anchored via the same reference→world transform as the rest of the body.
  if (gasHeld) {
    const tail = toWorld(CYBERBIKE_TAIL_TIP[0], CYBERBIKE_TAIL_TIP[1]);
    ctx.fillStyle = "rgba(255, 176, 89, 0.85)";
    ctx.shadowColor = "#ff8a3d";
    ctx.shadowBlur = 8;
    const flickerOffset = 2 + Math.random() * 3;
    const jitter = (Math.random() - 0.5) * 4;
    ctx.beginPath();
    ctx.arc(tail.x - flickerOffset, tail.y + jitter, 1.8 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawExplosion(ctx, particles) {
  ctx.save();
  for (const p of particles) {
    const alpha = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Screen-space streaks that flash by when going fast - cheap stand-in
// for motion blur. `lines` is a small live array of {y, life, age,
// length} the caller spawns/ages each frame; this just draws them.
function drawSpeedLines(ctx, lines, width, boosted) {
  ctx.save();
  ctx.strokeStyle = boosted ? "#bdf1ff" : "#ffffff";
  ctx.lineCap = "round";
  for (const line of lines) {
    const alpha = Math.max(0, 1 - line.age / line.life) * (boosted ? 0.5 : 0.35);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = boosted ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(width, line.y);
    ctx.lineTo(width - line.length, line.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Three-part HUD: instant speed on the left, distance covered in the
// center pill, and the running total of money earned this run on the
// right - all live, all updating every frame.
function drawHud(ctx, hud, width, pulseFraction) {
  const { speedKmh, distanceMeters, money } = hud;

  // ---- center: distance pill (same pill chrome the old timer used) ----
  ctx.save();
  const label = `${Math.floor(distanceMeters)}m`;
  ctx.font = "700 20px 'IBM Plex Mono', monospace";
  const textWidth = ctx.measureText(label).width;
  const pillWidth = textWidth + 32;
  const pillCenterX = width / 2;
  const pillCenterY = 14 + 18;

  // Brief scale-up pulse right when a 100m currency payout hits, so the
  // counter itself visibly celebrates the moment instead of just
  // silently ticking - decays back to normal over ~400ms (see caller).
  const scale = 1 + pulseFraction * 0.28;
  ctx.translate(pillCenterX, pillCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-pillCenterX, -pillCenterY);

  ctx.fillStyle = "rgba(20, 6, 14, 0.65)";
  ctx.strokeStyle = pulseFraction > 0 ? "rgba(255, 220, 140, 0.9)" : "rgba(242, 193, 78, 0.6)";
  ctx.lineWidth = 1.5;
  const pillX = width / 2 - pillWidth / 2;
  const radius = 18;
  ctx.beginPath();
  ctx.moveTo(pillX + radius, 14);
  ctx.arcTo(pillX + pillWidth, 14, pillX + pillWidth, 14 + 36, radius);
  ctx.arcTo(pillX + pillWidth, 14 + 36, pillX, 14 + 36, radius);
  ctx.arcTo(pillX, 14 + 36, pillX, 14, radius);
  ctx.arcTo(pillX, 14, pillX + pillWidth, 14, radius);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fff3d6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, 14 + 18);
  ctx.restore();

  // ---- left: live instantaneous speed ----
  ctx.save();
  ctx.font = "600 13px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const speedLabel = `${Math.round(speedKmh)} km/h`;
  const speedTextWidth = ctx.measureText(speedLabel).width;
  ctx.fillStyle = "rgba(20, 6, 14, 0.55)";
  roundedRectPath(ctx, 10, 16, speedTextWidth + 20, 26, 13);
  ctx.fill();
  ctx.fillStyle = "#bdeaff";
  ctx.fillText(speedLabel, 20, 29);
  ctx.restore();

  // ---- right: total money earned so far this run ----
  ctx.save();
  ctx.font = "700 13px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const moneyLabel = `${money} VɎ`;
  const moneyTextWidth = ctx.measureText(moneyLabel).width;
  ctx.fillStyle = "rgba(20, 6, 14, 0.55)";
  roundedRectPath(ctx, width - 10 - (moneyTextWidth + 20), 16, moneyTextWidth + 20, 26, 13);
  ctx.fill();
  ctx.fillStyle = "#ffe07a";
  ctx.fillText(moneyLabel, width - 20, 29);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Boost charge bar - sits just under the score pill. Fills over
// BOOST_COOLDOWN_MS; once full it glows and "BOOST READY" shows below it;
// while a boost is actively running it goes bright white-cyan instead.
function drawBoostBar(ctx, width, chargeFraction, boostActive) {
  ctx.save();
  const barWidth = 120;
  const barHeight = 7;
  const x = width / 2 - barWidth / 2;
  const y = 14 + 36 + 8;
  const ready = chargeFraction >= 1;

  roundedRectPath(ctx, x, y, barWidth, barHeight, 4);
  ctx.fillStyle = "rgba(10, 14, 34, 0.65)";
  ctx.strokeStyle = "rgba(140, 200, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  const fillWidth = Math.max(0, Math.min(1, chargeFraction)) * barWidth;
  if (fillWidth > 1) {
    roundedRectPath(ctx, x, y, fillWidth, barHeight, 4);
    ctx.shadowColor = "#4fd6ff";
    ctx.shadowBlur = boostActive ? 14 : ready ? 10 : 3;
    ctx.fillStyle = boostActive ? "#eafeff" : ready ? "#8fe9ff" : "#2f9fe8";
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (ready && !boostActive) {
    ctx.font = "600 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(233, 250, 255, 0.85)";
    ctx.textAlign = "center";
    ctx.fillText("BOOST READY", width / 2, y + barHeight + 11);
  }
  ctx.restore();
}

// One-shot radial burst of blue/cyan particles when a boost triggers -
// reuses the same {x,y,vx,vy,size,life,age,color} shape as the crash
// explosion particles, so it renders through the existing drawExplosion.
function createBoostBurst(x, y) {
  const colors = ["#4fd6ff", "#8fe9ff", "#2f9fe8", "#eafeff"];
  const particles = [];
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 7;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2.5 + Math.random() * 4,
      life: 320 + Math.random() * 260,
      age: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  return particles;
}

function createExplosionParticles(x, y) {
  const colors = ["#ff6ec7", "#5fb8ff", "#ffd989", "#ffffff"];
  const particles = [];
  for (let i = 0; i < 24; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 4,
      life: 380 + Math.random() * 320,
      age: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  return particles;
}

// Small, brief dust/spark puff for a hard landing - distinct from the
// crash explosion (smaller, shorter-lived, doesn't stop the run).
function createLandingDust(x, y, intensity) {
  const colors = ["#ffedb0", "#f2c14e", "#ffffff"];
  const count = Math.round(6 + Math.min(1.6, intensity) * 5);
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9; // fan out along the ground, upward-ish
    const speed = (1 + Math.random() * 2.4) * Math.min(1.6, intensity);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.5,
      size: 2 + Math.random() * 2.5,
      life: 220 + Math.random() * 160,
      age: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  return particles;
}

// ---------------- component ----------------

export default function GameCanvas({ onGameOver }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const gasRef = useRef(false);
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");

    // Recolor the bike + background/ground to match whichever accent the
    // player picked in Settings (see applyThemeColors above) - reads the
    // live --gold/--gold-bright/--ink CSS custom properties straight off
    // this DOM node, which inherit down from .app-shell[data-accent].
    applyThemeColors(container);
    applySafeAreaOffset();

    const engine = Engine.create();
    engine.gravity.y = GRAVITY_Y;
    const world = engine.world;

    const baseline = 420;
    const terrain = createTerrainState(baseline);
    // Spawn resting almost exactly on the ground (wheels ~= wheelRadius
    // above baseline, chassis further up by rideHeight) with only a tiny
    // clearance gap - not high above it. A real fall from height meant
    // the bike was briefly airborne right at spawn, and if the player
    // holds gas from frame one (as the "hold to accelerate" prompt
    // invites), the strong air-flip torque had just enough time to spin
    // the bike into a bad angle before it ever touched down once,
    // causing an instant crash. Numbers below match createBike's own
    // wheelRadius (12) + rideHeight (12) - keep in sync if those change.
    const bike = createBike(160, baseline - 30);
    Composite.add(world, [
      bike.chassis,
      bike.rearWheel,
      bike.frontWheel,
      bike.rearAxle,
      bike.frontAxle,
    ]);

    const spanBuiltCount = new WeakMap();
    let groundBodies = []; // { body, endX }
    const trapRuntime = new Map(); // trap -> { body }
    const builtTraps = new Set();

    function buildNewTerrain() {
      for (const span of terrain.spans) {
        const built = spanBuiltCount.get(span) || 0;
        if (built >= span.length - 1) continue;
        for (let i = built; i < span.length - 1; i++) {
          const body = buildGroundSegment(span[i], span[i + 1]);
          Composite.add(world, body);
          groundBodies.push({ body, endX: span[i + 1].x });
        }
        spanBuiltCount.set(span, span.length - 1);
      }

      for (const trap of terrain.traps) {
        if (builtTraps.has(trap)) continue;
        const body = buildTrapBody(trap);
        if (body) {
          Composite.add(world, body);
          trapRuntime.set(trap, { body });
        }
        builtTraps.add(trap);
      }
    }

    function pruneOldTerrain(frontierX) {
      const cutoff = frontierX - GAP_PRUNE_MARGIN;
      groundBodies = groundBodies.filter((entry) => {
        if (entry.endX < cutoff) {
          Composite.remove(world, entry.body);
          return false;
        }
        return true;
      });

      const removedTraps = pruneBehind(terrain, frontierX);
      for (const trap of removedTraps) {
        const runtime = trapRuntime.get(trap);
        if (runtime) {
          Composite.remove(world, runtime.body);
          trapRuntime.delete(trap);
        }
        builtTraps.delete(trap);
      }
    }

    function updateMovingTraps(elapsed) {
      for (const trap of terrain.traps) {
        const runtime = trapRuntime.get(trap);
        if (!runtime) continue;

        if (trap.type === "platform") {
          const y = trap.y - trap.height + Math.sin(elapsed * trap.speed) * trap.travel;
          Body.setPosition(runtime.body, { x: trap.x, y });
        } else if (trap.type === "wreckingBall") {
          const angle = Math.sin(elapsed * trap.speed + trap.phase) * 1.15;
          const x = trap.anchorX + Math.sin(angle) * trap.length;
          const y = trap.anchorY + Math.cos(angle) * trap.length;
          Body.setPosition(runtime.body, { x, y });
        } else if (trap.type === "sawBlade") {
          const x = trap.x + (trap.travelX ? Math.sin(elapsed * trap.travelSpeed) * trap.travelX : 0);
          Body.setPosition(runtime.body, { x, y: trap.y });
        } else if (trap.type === "rotatingBar") {
          const angle = elapsed * trap.speed + trap.phase;
          const midX = trap.x + Math.sin(angle) * (trap.length / 2);
          const midY = trap.y + Math.cos(angle) * (trap.length / 2);
          Body.setPosition(runtime.body, { x: midX, y: midY });
          Body.setAngle(runtime.body, angle);
        } else if (trap.type === "swingGate") {
          // Asymmetric duty cycle: open (out of the way) for just over
          // half the cycle, a clear swing-closed telegraph, a held-closed
          // window, then swing back open - always a generous, readable
          // window to actually get through.
          const cyclePos = (((elapsed + trap.phase) % trap.period) + trap.period) % trap.period / trap.period;
          let swing;
          if (cyclePos < 0.5) swing = 0;
          else if (cyclePos < 0.65) swing = (cyclePos - 0.5) / 0.15;
          else if (cyclePos < 0.85) swing = 1;
          else swing = 1 - (cyclePos - 0.85) / 0.15;
          const angle = swing * Math.PI; // 0 = pointing up (open), PI = pointing down (blocking)
          const midX = trap.x + Math.sin(angle) * (trap.length / 2);
          const midY = trap.y - Math.cos(angle) * (trap.length / 2);
          Body.setPosition(runtime.body, { x: midX, y: midY });
          Body.setAngle(runtime.body, angle);
          runtime.openFraction = 1 - swing;
        } else if (trap.type === "chaser") {
          // Mutate trap.x directly (not just runtime state) so
          // pruneBehind - which reads trap.x - always agrees with where
          // this hazard actually, currently is, instead of judging it by
          // a stale spawn position from way back down the track.
          const targetX = bike.chassis.position.x - 90;
          trap.x += (targetX - trap.x) * trap.followLag;
          const y = trap.y + Math.sin(elapsed * trap.bobSpeed) * trap.bobAmount;
          Body.setPosition(runtime.body, { x: trap.x, y });
        } else if (trap.type === "spikePillars") {
          const extension = (Math.sin((elapsed * Math.PI * 2) / trap.period + trap.phase) + 1) / 2;
          const centerY = trap.y + trap.height / 2 - trap.height * extension;
          Body.setPosition(runtime.body, { x: (trap.x1 + trap.x2) / 2, y: centerY });
          runtime.extension = extension;
        }
      }
    }

    // ---------------- collisions ----------------
    // A wheel resting on the seam between two ground segments has TWO
    // simultaneous contact pairs - track ground contact as a reference
    // count (not a Set), so one of those pairs ending doesn't wrongly
    // mark the bike as airborne while it's still resting on the other.
    let groundContacts = 0;
    let crashed = false;
    let gameOverFired = false;
    let explosionStartedAt = null;
    let explosionParticles = [];
    let pendingResult = { distanceMeters: 0, money: 0 };

    // ---- distance + speed based currency tracking ----
    const startX = bike.chassis.position.x; // matches createBike's spawn x above
    let distanceMeters = 0;
    let moneyEarned = 0;
    let nextRewardAtPx = REWARD_DISTANCE_PX;

    function triggerCrash(elapsedSeconds) {
      if (crashed) return;
      crashed = true;
      pendingResult = { distanceMeters: Math.floor(distanceMeters), money: moneyEarned };
      explosionStartedAt = performance.now();
      explosionParticles = createExplosionParticles(bike.chassis.position.x, bike.chassis.position.y);
      playCrash();
      updateEngine(false, 0);
    }

    function handlePair(a, b, elapsedSeconds) {
      if ((isWheel(a) && isGround(b)) || (isWheel(b) && isGround(a))) groundContacts++;
      if ((isChassis(a) && (isGround(b) || isTrap(b))) || (isChassis(b) && (isGround(a) || isTrap(a)))) {
        triggerCrash(elapsedSeconds);
      }
      if ((isWheel(a) && isTrap(b)) || (isWheel(b) && isTrap(a))) {
        triggerCrash(elapsedSeconds);
      }
    }

    let elapsedRef = 0;

    const onCollisionStart = (event) => {
      for (const pair of event.pairs) handlePair(pair.bodyA, pair.bodyB, elapsedRef);
    };
    const onCollisionEnd = (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if ((isWheel(bodyA) && isGround(bodyB)) || (isWheel(bodyB) && isGround(bodyA))) {
          groundContacts = Math.max(0, groundContacts - 1);
        }
      }
    };
    Events.on(engine, "collisionStart", onCollisionStart);
    Events.on(engine, "collisionEnd", onCollisionEnd);

    // ---------------- input ----------------
    // New control scheme: holding the RIGHT half of the screen accelerates
    // (or, while airborne, commits to the flip - see registerGasPress /
    // airFlipArmed below); a single TAP on the LEFT half jumps immediately;
    // and a double-tap ANYWHERE on the screen triggers a short speed boost
    // (see requestBoost). Jump itself is a plain vertical velocity kick
    // that never touches horizontal velocity - see the jumpRequested
    // handling in stepPhysics for why that's what makes "keep moving if
    // you were already moving, stay put if you were standing still" work.
    let lastTapTime = 0;
    let jumpRequested = false;

    // Whether the bike is currently touching ground, mirrored from
    // stepPhysics each tick so these raw input handlers (which run
    // outside the physics loop) can tell a genuinely NEW press made
    // while airborne apart from gas that's just been held continuously
    // since before takeoff. See airFlipArmed below for why that
    // distinction is what actually stops unwanted forward flips.
    let groundedNow = true;

    // The air-flip torque (see AIR_PITCH_TORQUE in stepPhysics) only
    // arms when gas is freshly PRESSED while already airborne - not
    // when it's simply still held over from accelerating into the
    // jump. Ordinary play (hold gas, hit a bump, go briefly airborne
    // while still holding) never re-presses anything, so it can no
    // longer auto-flip the bike forward; the flip stays a deliberate
    // trick you commit to by tapping/holding gas again once you're
    // already in the air.
    let airFlipArmed = false;

    // ---- boost ----
    let boostActive = false;
    let boostTimeRemaining = 0; // ms left in the current boost burst
    let boostCooldownRemaining = 0; // ms left until boost is ready again (0 = ready now)
    let boostFlashRemaining = 0; // ms left in the one-shot activation screen flash (visual only)

    // The thrust direction for the CURRENT boost, locked once at the
    // moment it's triggered (see requestBoost) - not recomputed every
    // tick from the bike's live angle. If it were live, a bike tumbling
    // mid-air would have its boost direction chase the spin and could
    // end up firing straight down mid-boost. Locking it means "commit to
    // the direction you were facing when you hit boost" instead.
    let boostDirX = 1;
    let boostDirY = 0;

    function requestBoost() {
      if (boostActive || boostCooldownRemaining > 0) return;
      boostActive = true;
      boostTimeRemaining = BOOST_DURATION_MS;
      boostCooldownRemaining = BOOST_COOLDOWN_MS;
      boostFlashRemaining = BOOST_FLASH_MS;

      // Clamp to a safe cone around horizontal (±~56°) so a badly-timed
      // trigger - already nose-down mid-flip, or upside-down - can never
      // fire the boost straight down or backward. Within that cone it
      // still genuinely follows the nose (nose-up boosts up, nose-down
      // boosts down-and-forward), it just can't go past a safe pitch.
      const rawAngle = normalizeAngle(bike.chassis.angle);
      const clampedAngle = Math.max(-BOOST_MAX_PITCH, Math.min(BOOST_MAX_PITCH, rawAngle));
      boostDirX = Math.cos(clampedAngle);
      boostDirY = Math.sin(clampedAngle);

      dustParticles.push(...createBoostBurst(bike.chassis.position.x, bike.chassis.position.y));
      playBoost();
    }

    // Any two presses (regardless of which half of the screen, or whether
    // they also triggered gas/jump individually) within DOUBLE_TAP_WINDOW
    // of each other request a boost.
    function registerBoostTap() {
      const now = performance.now();
      if (now - lastTapTime < DOUBLE_TAP_WINDOW) {
        requestBoost();
        lastTapTime = 0; // avoid a fast third tap chaining into another boost instantly
      } else {
        lastTapTime = now;
      }
    }

    function registerGasPress() {
      if (!groundedNow) airFlipArmed = true;
    }

    function onPointerDown(event) {
      event.preventDefault();
      resumeAudio(); // audio can only start from inside a real user gesture
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const isRightSide = rect.width > 0 ? localX > rect.width / 2 : true;
      if (isRightSide) {
        gasRef.current = true;
        registerGasPress();
      } else {
        jumpRequested = true;
      }
      registerBoostTap();
    }
    function onPointerUp() {
      gasRef.current = false;
    }
    function onKeyDown(event) {
      if (event.code === "Space" || event.code === "ArrowUp" || event.code === "ArrowRight") {
        gasRef.current = true;
        if (!event.repeat) {
          registerGasPress();
          registerBoostTap();
        }
      } else if (event.code === "ArrowLeft" || event.code === "ArrowDown" || event.code === "KeyJ") {
        if (!event.repeat) {
          jumpRequested = true;
          registerBoostTap();
        }
      }
    }
    function onKeyUp(event) {
      if (event.code === "Space" || event.code === "ArrowUp" || event.code === "ArrowRight") gasRef.current = false;
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---------------- sizing ----------------
    // Telegram's WebView resize into fullscreen (requestFullscreen(), see
    // useTelegram.js) doesn't reliably fire a browser 'resize' event, and
    // on some Android builds the fixed .rider-game__stage container's own
    // clientWidth/clientHeight can stay stuck at its pre-fullscreen size
    // for a while too - either way this canvas would measure itself once,
    // too small, and never correct: the buffer + its CSS box both stay
    // pinned small while the rest of the (now larger) screen just shows
    // .rider-game__stage's plain background color around it.
    // window.innerWidth/innerHeight (backed, when available, by
    // Telegram's own live-tracked viewportStableHeight) is a more
    // reliable "what's actually visible right now" source than the
    // container's own layout box, so measure from there first and only
    // fall back to the container if that's unavailable.
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    function measureViewport() {
      const tgWebApp = window.Telegram?.WebApp;
      const w = window.innerWidth || container.clientWidth;
      const h =
        tgWebApp?.viewportStableHeight ||
        tgWebApp?.viewportHeight ||
        window.innerHeight ||
        container.clientHeight;
      return { w, h };
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { w, h } = measureViewport();
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    resize();
    // Belt-and-suspenders: re-measure a few more times over the next
    // second in case the fullscreen transition (or Telegram's own
    // viewportChanged event) lands after this first measurement, even
    // if none of the listeners below happen to catch it.
    const settleTimers = [60, 150, 300, 600, 1000].map((ms) => window.setTimeout(resize, ms));
    // A plain 'resize' listener depends on the BROWSER firing that event,
    // which Telegram's WebView doesn't reliably do the moment it actually
    // grows into fullscreen (requestFullscreen() resolves on its own
    // timeline, sometimes after this canvas already measured its old,
    // smaller size once) - that mismatch is exactly what left the canvas
    // stuck small with just the app's background color filling the rest
    // of the now-larger screen around it. A ResizeObserver watches the
    // CONTAINER's actual rendered box directly instead, so it re-measures
    // correctly no matter what caused the resize or when.
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("resize", resize);

    // ---------------- fixed-timestep physics step ----------------
    // The bike now spawns resting almost exactly on the ground (see
    // createBike call above), so it should never genuinely be airborne
    // before its first real jump. `hasLandedOnce` is a defensive
    // backstop, not the primary fix: it blocks the strong air-flip
    // torque from ever applying before the bike has touched ground at
    // least once, so even if some future change (or an edge case in
    // terrain generation) ever left the bike briefly airborne at spawn
    // again, holding gas immediately can't spin it into an instant
    // crash before it's had a real landing.
    let wasGrounded = false;
    let hasLandedOnce = false;
    let msSinceGrounded = 0; // ms since ANY wheel last touched ground - drives JUMP_COYOTE_MS below
    let justJumped = false; // true only on the exact tick a jump fires - see the ground-lock clamp below

    // Scripted 360° loop state - see the SPECTACLE section in terrain.js
    // for why this is a guaranteed animation rather than raw physics.
    // null when no loop is in progress.
    let activeLoop = null;
    let lastAirborneVy = 0; // velocity.y as of the last tick we were still airborne - see landing detection below
    let landingShake = 0; // decays each frame; added on top of the speed-based camera shake
    let scorePulseRemaining = 0; // ms left in the current HUD pulse - see drawHud
    const trail = [];
    let dustParticles = [];
    let rearSpinAngle = 0; // cosmetic-only rotation for the rear wheel's drawn spoke line

    function stepPhysics(dtMs) {
      elapsedRef += dtMs / 1000;

      const grounded = groundContacts > 0;
      if (grounded) hasLandedOnce = true;
      groundedNow = grounded; // mirrored for the raw input handlers, see registerGasPress above
      if (grounded) airFlipArmed = false; // each new airborne period needs its own fresh press to flip

      // Either wheel touching (front OR rear) already counts as grounded
      // above, so a bike balanced on just its front wheel can jump - the
      // coyote window on top of that just forgives a brief flicker in
      // contact detection right around that moment.
      if (grounded) msSinceGrounded = 0;
      else msSinceGrounded += dtMs;
      const canJump = grounded || msSinceGrounded <= JUMP_COYOTE_MS;

      // ---- scripted loop trigger ----
      // Only checked while grounded and moving forward at a real clip,
      // and only when no loop is already in progress - see the
      // SPECTACLE section in terrain.js for why this is scripted rather
      // than raw physics. trap.triggered guards against re-triggering
      // the same loop a second time later (e.g. if somehow re-approached).
      if (!activeLoop && grounded && bike.chassis.velocity.x > 2) {
        for (const trap of terrain.traps) {
          if (trap.type !== "loop" || trap.triggered) continue;
          if (Math.abs(bike.chassis.position.x - trap.x) < 6) {
            trap.triggered = true;
            const wheelSpan = Math.hypot(
              bike.frontWheel.position.x - bike.rearWheel.position.x,
              bike.frontWheel.position.y - bike.rearWheel.position.y
            );
            activeLoop = {
              trap,
              elapsed: 0,
              exitSpeed: Math.max(bike.chassis.velocity.x, LOOP_MIN_EXIT_SPEED),
              wheelAngleOffset: wheelSpan / 2 / trap.radius, // half-wheelbase as an angle around the loop's circle
            };
            break;
          }
        }
      }

      // Landing detection - by the time `grounded` flips true here, the
      // collision may already have changed bike.chassis.velocity.y this
      // tick, so we use whatever velocity was recorded on the LAST tick
      // we were still genuinely airborne (lastAirborneVy) as the impact
      // speed instead.
      if (!activeLoop && !wasGrounded && grounded) {
        const impact = Math.abs(lastAirborneVy);
        if (impact >= MIN_LAND_VY) {
          playLand(impact / HARD_LANDING_VY);
        }
        if (impact > HARD_LANDING_VY) {
          dustParticles.push(
            ...createLandingDust(bike.rearWheel.position.x, bike.rearWheel.position.y, impact / HARD_LANDING_VY)
          );
          landingShake = Math.min(CAMERA_SHAKE_MAX_PX * 2.5, impact * 0.4);
        }
      }

      const speedFraction = Math.min(1, Math.max(0, bike.chassis.velocity.x / MAX_SPEED));
      updateEngine((grounded || activeLoop) && gasRef.current, speedFraction);

      // ---- distance + speed based currency ----
      // Distance is the furthest the bike has ever reached (never drops
      // if it bounces back a touch), and every REWARD_DISTANCE_PX of that
      // triggers a payout sized by however fast the bike was going right
      // now - see speedRewardTier. The while-loop (not an if) covers a
      // single fast/boosted tick that crosses more than one 100m mark at
      // once, so no payout ever gets skipped.
      const traveledMeters = Math.max(0, (bike.chassis.position.x - startX) / PX_PER_METER);
      if (traveledMeters > distanceMeters) distanceMeters = traveledMeters;
      while (distanceMeters * PX_PER_METER >= nextRewardAtPx) {
        moneyEarned += speedRewardTier(speedFraction);
        nextRewardAtPx += REWARD_DISTANCE_PX;
        scorePulseRemaining = 400;
        playScore();
      }

      if (!activeLoop) {
      // ---- boost: timers + the actual speed effect ----
      // Deliberately NOT gated on grounded/airborne, and NOT locked to the
      // +x axis - a boost pushes velocity toward boostDirX/boostDirY (the
      // direction locked in at the moment it was triggered - see
      // requestBoost), which is what makes it work "چه روی زمین چه روی
      // هوا" (both on the ground and in the air) while still following
      // whatever the nose was pointing at when you committed to it,
      // without chasing the bike's spin for the rest of the boost.
      if (boostActive) {
        boostTimeRemaining -= dtMs;
        if (boostTimeRemaining <= 0) {
          boostActive = false;
          boostTimeRemaining = 0;
        } else {
          const targetVx = boostDirX * BOOST_MAX_SPEED;
          const targetVy = boostDirY * BOOST_MAX_SPEED;
          const ease = Math.min(1, dtMs / 90);
          Body.setVelocity(bike.chassis, {
            x: bike.chassis.velocity.x + (targetVx - bike.chassis.velocity.x) * ease,
            y: bike.chassis.velocity.y + (targetVy - bike.chassis.velocity.y) * ease,
          });

          // Continuous blue nitro flame trailing off the back of the bike -
          // "back" meaning opposite the locked boost direction, matching
          // whichever way it's actually thrusting. On top of the one-shot
          // burst that fired when the boost started.
          if (Math.random() < 0.85) {
            dustParticles.push({
              x: bike.rearWheel.position.x - boostDirX * (6 + Math.random() * 6),
              y: bike.rearWheel.position.y - boostDirY * (6 + Math.random() * 6),
              vx: -boostDirX * (1.6 + Math.random() * 1.6),
              vy: -boostDirY * (1.6 + Math.random() * 1.6),
              size: 2 + Math.random() * 2.6,
              life: 220 + Math.random() * 160,
              age: 0,
              color: Math.random() > 0.4 ? "#4fd6ff" : "#bdf1ff",
            });
          }
        }
      }
      if (boostCooldownRemaining > 0) {
        boostCooldownRemaining = Math.max(0, boostCooldownRemaining - dtMs);
      }

      // A double-tap jump is a pure vertical velocity kick - horizontal
      // velocity is deliberately left completely untouched. That's the
      // entire mechanism behind "keep moving forward if you were already
      // moving, stay put if you were standing still": we simply never
      // change vx here, so whatever it already was carries straight
      // through the jump.
      justJumped = false;
      if (jumpRequested) {
        jumpRequested = false;
        if (canJump) {
          Body.setVelocity(bike.chassis, { x: bike.chassis.velocity.x, y: -JUMP_VELOCITY });
          justJumped = true;
          playJump();
        }
      }

      if (grounded) {
        if (gasRef.current) {
          Body.applyForce(bike.chassis, bike.chassis.position, { x: FORWARD_FORCE, y: 0 });
          rearSpinAngle += REAR_SPIN_RATE * dtMs * (0.4 + speedFraction);
        }
        // The front wheel is never touched - it's drawn from its real
        // physics angle, turning only from its own friction/contact
        // with the ground, exactly like a real motorcycle's undriven
        // front wheel. The rear wheel's spin is purely cosmetic (see
        // REAR_SPIN_RATE above) - it never touches the real physics
        // body, so it can never feed back into chassis stability.
        const speedCap = boostActive ? BOOST_MAX_SPEED : MAX_SPEED;
        if (bike.chassis.velocity.x > speedCap) {
          Body.setVelocity(bike.chassis, { x: speedCap, y: bike.chassis.velocity.y });
        }
      } else if (gasRef.current && hasLandedOnce && airFlipArmed) {
        Body.setAngularVelocity(
          bike.chassis,
          Math.min(bike.chassis.angularVelocity + AIR_PITCH_TORQUE * dtMs, AIR_PITCH_MAX_SPIN)
        );
      } else {
        // Not committed to a flip in the air: just damp out any existing
        // spin so the bike settles into coasting at whatever angle it
        // currently has - it does NOT get pulled back toward level, and
        // it no longer auto-flips just because gas was already held
        // going into the jump.
        Body.setAngularVelocity(bike.chassis, bike.chassis.angularVelocity * (1 - AUTO_LEVEL_DAMPING));
      }
      } // end if (!activeLoop)

      wasGrounded = grounded;
      if (!grounded) lastAirborneVy = bike.chassis.velocity.y;

      trail.push({ x: bike.rearWheel.position.x, y: bike.rearWheel.position.y });
      if (trail.length > TRAIL_LENGTH) trail.shift();

      generateAhead(terrain, bike.chassis.position.x + 1600, elapsedRef);
      buildNewTerrain();
      pruneOldTerrain(bike.chassis.position.x);
      updateMovingTraps(elapsedRef);

      Engine.update(engine, dtMs);

      // Ground lock: while the bike was grounded this tick and the
      // player didn't explicitly jump, it should NEVER leave the ground
      // on its own - not from a terrain bump, not from boosting into a
      // bump at BOOST_MAX_SPEED, nothing. Only an explicit jump input is
      // allowed to give it upward velocity. Engine.update just resolved
      // this tick's collisions (which is exactly where a bump would have
      // injected an upward kick), so this is the right place to cancel
      // any of that back out.
      if (!activeLoop && grounded && !justJumped && bike.chassis.velocity.y < 0) {
        Body.setVelocity(bike.chassis, { x: bike.chassis.velocity.x, y: 0 });
      }

      // ---- scripted loop: the actual takeover ----
      // Runs AFTER Engine.update so it has the final say regardless of
      // whatever gravity/collision did to the bike's bodies this tick -
      // for the loop's fixed duration, the bike's position/angle is a
      // pure function of elapsed time on a parametric circle, not a
      // physics simulation. See the SPECTACLE section in terrain.js.
      if (activeLoop) {
        activeLoop.elapsed += dtMs;
        const p = Math.min(1, activeLoop.elapsed / LOOP_DURATION_MS);
        const { trap, wheelAngleOffset, exitSpeed } = activeLoop;
        const R = trap.radius;
        const centerX = trap.x;
        const centerY = trap.y - R;
        const theta = p * Math.PI * 2;

        const pointOnCircle = (a) => ({
          x: centerX + R * Math.sin(a),
          y: centerY + R * Math.cos(a),
        });

        const chassisPos = pointOnCircle(theta);
        const facing = -theta; // tangent direction; matches the boost/CyberBike nose-direction convention
        Body.setPosition(bike.chassis, chassisPos);
        Body.setAngle(bike.chassis, facing);
        Body.setVelocity(bike.chassis, { x: 0, y: 0 });
        Body.setAngularVelocity(bike.chassis, 0);

        const rearPos = pointOnCircle(theta - wheelAngleOffset);
        const frontPos = pointOnCircle(theta + wheelAngleOffset);
        Body.setPosition(bike.rearWheel, rearPos);
        Body.setPosition(bike.frontWheel, frontPos);
        Body.setVelocity(bike.rearWheel, { x: 0, y: 0 });
        Body.setVelocity(bike.frontWheel, { x: 0, y: 0 });
        Body.setAngularVelocity(bike.rearWheel, 0);
        Body.setAngularVelocity(bike.frontWheel, 0);

        if (p >= 1) {
          // Hand control back exactly where the loop started, moving
          // level at (at least) whatever speed it entered with.
          Body.setPosition(bike.chassis, { x: trap.x, y: trap.y });
          Body.setAngle(bike.chassis, 0);
          Body.setVelocity(bike.chassis, { x: exitSpeed, y: 0 });
          const rearRest = { x: trap.x - wheelAngleOffset * R, y: trap.y };
          const frontRest = { x: trap.x + wheelAngleOffset * R, y: trap.y };
          Body.setPosition(bike.rearWheel, rearRest);
          Body.setPosition(bike.frontWheel, frontRest);
          Body.setVelocity(bike.rearWheel, { x: exitSpeed, y: 0 });
          Body.setVelocity(bike.frontWheel, { x: exitSpeed, y: 0 });
          activeLoop = null;
        }
      }

      if (bike.chassis.position.y > terrain.baseline + FALL_DEATH_OFFSET) {
        triggerCrash(elapsedRef);
      }
    }

    // ---------------- main loop ----------------
    let rafId;
    let lastTime = performance.now();
    let accumulator = 0;
    let cameraX = bike.chassis.position.x;
    let cameraY = bike.chassis.position.y;
    let zoom = 1;
    const speedLines = [];

    function tick(now) {
      const frameTime = Math.min(now - lastTime, 250);
      lastTime = now;

      if (!crashed) {
        accumulator += frameTime;
        let steps = 0;
        while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
          stepPhysics(FIXED_DT);
          accumulator -= FIXED_DT;
          steps++;
        }
      } else {
        const explosionAge = now - explosionStartedAt;
        for (const p of explosionParticles) {
          p.age = explosionAge;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15;
        }
        if (explosionAge > EXPLOSION_DURATION && !gameOverFired) {
          gameOverFired = true;
          onGameOverRef.current(pendingResult);
        }
      }

      // Dust particles age regardless of crashed state (a landing right
      // before a crash should still finish its little puff).
      dustParticles = dustParticles.filter((p) => {
        p.age += frameTime;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1;
        return p.age < p.life;
      });
      landingShake = Math.max(0, landingShake - frameTime * 0.02);
      scorePulseRemaining = Math.max(0, scorePulseRemaining - frameTime);
      boostFlashRemaining = Math.max(0, boostFlashRemaining - frameTime);

      const speedFraction = Math.min(1, Math.max(0, bike.chassis.velocity.x / MAX_SPEED));

      // Speed lines: cheap motion-blur stand-in, only above a threshold -
      // both the spawn chance and reach go up while boosting, on top of
      // whatever raw speed the bike already has.
      const speedLineDrive = boostActive ? 1 : speedFraction;
      if (speedLineDrive > 0.55 && Math.random() < speedLineDrive * (boostActive ? 0.85 : 0.5)) {
        speedLines.push({
          y: Math.random() * container.clientHeight,
          length: 40 + Math.random() * 70 * speedLineDrive,
          life: 140 + Math.random() * 100,
          age: 0,
        });
      }
      for (let i = speedLines.length - 1; i >= 0; i--) {
        speedLines[i].age += frameTime;
        if (speedLines[i].age > speedLines[i].life) speedLines.splice(i, 1);
      }

      const viewWidth = canvas.width / dpr;
      const viewHeight = canvas.height / dpr;

      const targetZoom = 1 - speedFraction * CAMERA_MAX_ZOOM_OUT - (boostActive ? BOOST_EXTRA_ZOOM_OUT : 0);
      zoom += (targetZoom - zoom) * CAMERA_ZOOM_SMOOTHING;

      // While boosting, the camera itself needs to keep up with the much
      // faster bike - pan speed goes up too (by a bit less than the
      // bike's own boosted speed), just enough that the bike doesn't
      // outrun the frame.
      const cameraFollowMult = boostActive ? BOOST_CAMERA_FOLLOW_MULT : 1;
      const targetX = bike.chassis.position.x - (viewWidth * CAMERA_LEAD_X) / zoom;
      const targetY = bike.chassis.position.y - (viewHeight * 0.5) / zoom;
      cameraX += (targetX - cameraX) * Math.min(1, CAMERA_FOLLOW_X * cameraFollowMult);
      cameraY += (targetY - cameraY) * Math.min(1, CAMERA_FOLLOW_Y * cameraFollowMult);

      // Shake: a steady light jitter above ~70% top speed, plus a
      // separate decaying pulse from a hard landing - both expressed in
      // screen pixels, then converted to world units so they read the
      // same regardless of the current zoom level.
      const speedShakeMag =
        speedFraction > CAMERA_SHAKE_START_FRACTION
          ? ((speedFraction - CAMERA_SHAKE_START_FRACTION) / (1 - CAMERA_SHAKE_START_FRACTION)) * CAMERA_SHAKE_MAX_PX
          : 0;
      const totalShake = speedShakeMag + landingShake;
      const shakeX = totalShake > 0 ? (Math.random() - 0.5) * totalShake : 0;
      const shakeY = totalShake > 0 ? (Math.random() - 0.5) * totalShake : 0;
      const renderCameraX = cameraX + shakeX / zoom;
      const renderCameraY = cameraY + shakeY / zoom;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(ctx, canvas.width, canvas.height);

      ctx.save();
      ctx.scale(dpr, dpr);
      drawSkyline(ctx, renderCameraX, viewWidth, viewHeight);
      drawMidground(ctx, renderCameraX, viewWidth, viewHeight);
      ctx.restore();

      ctx.save();
      ctx.scale(dpr * zoom, dpr * zoom);
      ctx.translate(-renderCameraX, -renderCameraY);

      const fillBottomY = renderCameraY + viewHeight / zoom + 800;
      drawGround(ctx, terrain, renderCameraX, viewWidth / zoom, fillBottomY);

      for (const trap of terrain.traps) {
        const runtime = trapRuntime.get(trap);
        if (trap.x !== undefined && trap.x < renderCameraX - 200) continue;
        if (trap.x1 !== undefined && trap.x2 < renderCameraX - 200) continue;
        if (trap.anchorX !== undefined && trap.anchorX < renderCameraX - 400) continue;

        if (trap.type === "spike") drawSpike(ctx, trap);
        else if (trap.type === "pitfloor") drawPitFloor(ctx, trap);
        else if (trap.type === "platform" && runtime) drawPlatform(ctx, runtime.body);
        else if (trap.type === "wreckingBall" && runtime) drawWreckingBall(ctx, trap, runtime.body);
        else if (trap.type === "sawBlade") drawSawBlade(ctx, trap, elapsedRef);
        else if (trap.type === "rotatingBar" && runtime) drawRotatingBar(ctx, trap, runtime.body);
        else if (trap.type === "chaser" && runtime) drawChaser(ctx, trap, runtime.body);
        else if (trap.type === "spikePillars" && runtime) drawSpikePillars(ctx, trap, runtime.extension ?? 0);
        else if (trap.type === "swingGate" && runtime) drawSwingGate(ctx, trap, runtime.body, runtime.openFraction ?? 1);
        else if (trap.type === "loop") drawLoopRing(ctx, trap);
      }

      drawExplosion(ctx, dustParticles);
      if (crashed) {
        drawExplosion(ctx, explosionParticles);
      } else {
        drawTrail(ctx, trail, boostActive);
        CyberBike(ctx, bike, rearSpinAngle, gasRef.current);
      }
      ctx.restore();

      ctx.save();
      ctx.scale(dpr, dpr);
      // One-shot blue flash the instant a boost triggers - drawn under the
      // HUD so the score pill and boost bar stay readable through it.
      if (boostFlashRemaining > 0) {
        ctx.save();
        ctx.globalAlpha = (boostFlashRemaining / BOOST_FLASH_MS) * 0.4;
        ctx.fillStyle = "#4fd6ff";
        ctx.fillRect(0, 0, viewWidth, viewHeight);
        ctx.restore();
      }
      drawSpeedLines(ctx, speedLines, viewWidth, boostActive);
      // Shifted down by HUD_TOP_OFFSET (device notch/status bar +
      // Telegram's own floating fullscreen controls - see
      // applySafeAreaOffset) so the HUD never sits under either.
      ctx.save();
      ctx.translate(0, HUD_TOP_OFFSET);
      drawHud(
        ctx,
        {
          speedKmh: velocityToKmh(bike.chassis.velocity.x),
          distanceMeters,
          money: moneyEarned,
        },
        canvas.width / dpr,
        scorePulseRemaining / 400
      );
      drawBoostBar(ctx, viewWidth, 1 - boostCooldownRemaining / BOOST_COOLDOWN_MS, boostActive);
      ctx.restore();
      ctx.restore();

      ctx.restore();

      if (!gameOverFired) rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    return () => {
      gameOverFired = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      resizeObserver.disconnect();
      settleTimers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", resize);
      Events.off(engine, "collisionStart", onCollisionStart);
      Events.off(engine, "collisionEnd", onCollisionEnd);
      Composite.clear(world, false);
      Engine.clear(engine);
      stopEngine();
    };
  }, []);

  return (
    <div className="rider-game__stage" ref={containerRef}>
      <canvas ref={canvasRef} className="rider-game__canvas" />
    </div>
  );
}
