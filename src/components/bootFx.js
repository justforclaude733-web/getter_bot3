// Canvas effects for the boot screen: a meteor with a fiery trail comes in
// from the top-right, hits the VYRO word, and blows up over the whole screen.
//
// Everything is a pure function of time (draw(t), t in ms since the boot
// animation started) - particle positions are computed analytically from a
// seeded RNG rather than simulated frame to frame. That keeps it perfectly
// in sync with the CSS letter animations (which use the same clock) and
// means a dropped frame never changes where anything ends up.
//
// Two canvases so the letters can sit *between* the layers: `back` (the
// fireball and smoke, behind the flying letters) and `front` (meteor, trail,
// sparks, debris, shockwaves and the white flash, in front of them).

export const FX = {
  METEOR_START: 2050, // meteor appears in the top-right corner
  IMPACT: 2950, // meteor reaches VYRO
  COVER: 3800, // explosion fills the screen; the app mounts underneath here
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Black-body-ish ramp: index 0 = dying ember, 7 = white hot.
const HEAT = [
  [90, 22, 10],
  [170, 40, 14],
  [225, 80, 20],
  [255, 130, 35],
  [255, 180, 70],
  [255, 215, 120],
  [255, 240, 190],
  [255, 252, 240],
];

function makeSprite(rgb, size = 96) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const col = rgb.join(",");
  grad.addColorStop(0, `rgba(${col},1)`);
  grad.addColorStop(0.25, `rgba(${col},0.65)`);
  grad.addColorStop(0.6, `rgba(${col},0.18)`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeRockTexture(rng, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#54463c";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 80; i++) {
    const dark = rng() < 0.55;
    g.fillStyle = dark ? `rgba(20,14,10,${0.15 + rng() * 0.35})` : `rgba(140,115,96,${0.1 + rng() * 0.25})`;
    g.beginPath();
    g.arc(rng() * size, rng() * size, 4 + rng() * 20, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 8; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 7 + rng() * 12;
    g.fillStyle = "rgba(12,8,6,0.55)";
    g.beginPath();
    g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(170,140,115,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.85);
    g.stroke();
  }
  return c;
}

function parseColor(str, fallback) {
  const s = (str || "").trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function createBootFx({ back, front, getImpact }) {
  const rng = mulberry32(20260919);
  const gb = back.getContext("2d");
  const gf = front.getContext("2d");

  let W = 0;
  let H = 0;
  let diag = 0;
  let P = { x: 0, y: 0 };
  let S = { x: 0, y: 0 };
  let dir = { x: -0.6, y: 0.8 };

  const heatSprites = HEAT.map((rgb) => makeSprite(rgb));
  const smokeSprite = makeSprite([28, 18, 14]);
  const rock = makeRockTexture(rng);
  const themeRgb = parseColor(getComputedStyle(front).getPropertyValue("--gold-bright"), [255, 200, 80]);

  function sizeCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    const rect = front.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    diag = Math.hypot(W, H);
    sizeCanvas(back);
    sizeCanvas(front);
    P = getImpact(rect);
    S = { x: W + 50, y: -50 };
    const dx = P.x - S.x;
    const dy = P.y - S.y;
    const len = Math.hypot(dx, dy) || 1;
    dir = { x: dx / len, y: dy / len };
  }

  // ---- particle parameters (fixed once, seeded) ----
  const T_FLIGHT = FX.IMPACT - FX.METEOR_START;

  const blob = Array.from({ length: 22 }, () => rng() * 2 - 1);

  const trail = [];
  for (let tb = FX.METEOR_START; tb <= FX.IMPACT; tb += 9) {
    trail.push({
      tb,
      ox: rng() * 2 - 1,
      oy: rng() * 2 - 1,
      vx: (rng() * 2 - 1) * 26,
      vy: (rng() * 2 - 1) * 26,
      life: 380 + rng() * 320,
      size: 0.75 + rng() * 0.5,
      smoke: rng() < 0.45,
    });
  }

  const flightSparks = Array.from({ length: 80 }, () => {
    const spread = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 1.1);
    return { tb: FX.METEOR_START + rng() * T_FLIGHT, spread, speed: 120 + rng() * 260, life: 260 + rng() * 420, w: 1 + rng() * 1.6 };
  });

  const blastSparks = Array.from({ length: 230 }, () => ({
    a: rng() * Math.PI * 2,
    v: 160 + Math.pow(rng(), 0.55) * 1500,
    life: 650 + rng() * 950,
    w: 1.2 + rng() * 3.2,
  }));

  const puffs = Array.from({ length: 38 }, () => ({
    a: rng() * Math.PI * 2,
    d: 120 + rng() * 780,
    t: 650 + rng() * 450,
    s: 200 + rng() * 380,
    delay: rng() * 110,
    life: 1100 + rng() * 800,
  }));

  const smokes = Array.from({ length: 20 }, () => ({
    a: rng() * Math.PI * 2,
    d: 100 + rng() * 620,
    s: 220 + rng() * 300,
    delay: 120 + rng() * 260,
    life: 1500 + rng() * 900,
  }));

  const debris = Array.from({ length: 16 }, () => ({
    a: rng() * Math.PI * 2,
    v: 320 + rng() * 900,
    r: 8 + rng() * 15,
    rot: rng() * Math.PI * 2,
    w: (rng() * 2 - 1) * 9,
    pts: [rng(), rng(), rng()].map((k, i) => [Math.cos(i * 2.1 + k), Math.sin(i * 2.1 + k), 0.7 + k * 0.6]),
    life: 1200 + rng() * 600,
  }));

  function sprite(g, img, x, y, size, alpha) {
    g.globalAlpha = alpha;
    g.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  const heatIdx = (h) => Math.max(0, Math.min(7, Math.floor(h * 8)));

  // ---- back canvas: fireball + smoke ----
  function drawBack(t) {
    gb.globalAlpha = 1;
    gb.globalCompositeOperation = "source-over";
    gb.clearRect(0, 0, W, H);
    const te = t - FX.IMPACT;
    if (te < 0) return;

    for (const s of smokes) {
      const age = te - s.delay;
      if (age < 0 || age > s.life) continue;
      const u = age / s.life;
      const grow = easeOut(clamp01(age / 900));
      sprite(gb, smokeSprite, P.x + Math.cos(s.a) * s.d * grow, P.y + Math.sin(s.a) * s.d * grow, s.s * (0.5 + 0.7 * grow), (1 - u) * 0.5 * clamp01(age / 150));
    }

    // Deep red/orange body of the fireball drawn normally (not additive) so
    // it keeps its colour; only the hot centre is additive.
    const a = clamp01(te / 110);
    sprite(gb, heatSprites[1], P.x, P.y, 2 * diag * 1.25 * easeOut(clamp01(te / 1000)), a * 0.95);
    sprite(gb, heatSprites[2], P.x, P.y, 2 * diag * 1.0 * easeOut(clamp01(te / 900)), a * 0.9);

    gb.globalCompositeOperation = "lighter";
    sprite(gb, heatSprites[3], P.x, P.y, 2 * diag * 0.7 * easeOut(clamp01(te / 750)), a * 0.5);
    for (const p of puffs) {
      const age = te - p.delay;
      if (age < 0 || age > p.life) continue;
      const u = age / p.life;
      const grow = easeOut(clamp01(age / p.t));
      sprite(gb, heatSprites[heatIdx(0.85 - u * 0.75)], P.x + Math.cos(p.a) * p.d * grow, P.y + Math.sin(p.a) * p.d * grow, p.s * (0.4 + 0.6 * grow), (1 - u) * 0.55);
    }

    // Colour that takes over the whole screen (hot in the middle, deep
    // orange at the edges) so nothing is left showing by the time the app
    // is mounted underneath it.
    gb.globalCompositeOperation = "source-over";
    const ramp = clamp01((te - 300) / 500);
    if (ramp > 0) {
      const flicker = te > 900 ? 0.5 + 0.5 * Math.sin(te / 90) : 0.5;
      const cover = gb.createRadialGradient(P.x, P.y, 0, P.x, P.y, diag);
      cover.addColorStop(0, `rgb(255,${Math.round(185 + 20 * flicker)},85)`);
      cover.addColorStop(1, "rgb(228,88,28)");
      gb.globalAlpha = ramp * 0.96;
      gb.fillStyle = cover;
      gb.fillRect(0, 0, W, H);
    }
    // Hot core stays on top.
    gb.globalCompositeOperation = "lighter";
    sprite(gb, heatSprites[7], P.x, P.y, 2 * diag * 0.24 * easeOut(clamp01(te / 450)), clamp01(1 - (te - 250) / 650));
    sprite(gb, heatSprites[5], P.x, P.y, 2 * diag * 0.5 * easeOut(clamp01(te / 700)), 0.5 * clamp01(1 - (te - 500) / 1200));
    gb.globalCompositeOperation = "source-over";
    gb.globalAlpha = 1;
  }

  // ---- front canvas ----
  function pathPos(t) {
    const u = clamp01((t - FX.METEOR_START) / T_FLIGHT);
    const e = Math.pow(u, 1.4);
    return { x: S.x + (P.x - S.x) * e, y: S.y + (P.y - S.y) * e, u };
  }

  function drawMeteor(t) {
    const { x, y, u } = pathPos(t);
    const r = 9 + 44 * u * u;
    const g = gf;

    g.globalCompositeOperation = "lighter";
    // Long tapered flame tail.
    const L = 150 + 210 * u;
    const bx = x - dir.x * L;
    const by = y - dir.y * L;
    const nx = -dir.y;
    const ny = dir.x;
    for (const [wMul, stops, alpha] of [
      [1.9, ["rgba(255,120,30,0.55)", "rgba(200,50,10,0.18)", "rgba(120,20,5,0)"], 0.85],
      [1.0, ["rgba(255,250,225,0.95)", "rgba(255,190,80,0.55)", "rgba(255,120,30,0)"], 1],
    ]) {
      const grad = g.createLinearGradient(x, y, bx, by);
      grad.addColorStop(0, stops[0]);
      grad.addColorStop(0.35, stops[1]);
      grad.addColorStop(1, stops[2]);
      g.globalAlpha = alpha;
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x + nx * r * wMul * 0.85, y + ny * r * wMul * 0.85);
      g.lineTo(bx, by);
      g.lineTo(x - nx * r * wMul * 0.85, y - ny * r * wMul * 0.85);
      g.closePath();
      g.fill();
    }

    // Halo.
    sprite(g, heatSprites[3], x, y, r * 7, 0.75);
    sprite(g, heatSprites[6], x, y, r * 3.4, 0.9);

    // Rock body.
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.save();
    g.translate(x, y);
    const spin = t / 260;
    g.beginPath();
    for (let i = 0; i < blob.length; i++) {
      const th = (i / blob.length) * Math.PI * 2 + spin * 0.35;
      const rr = r * (1 + 0.17 * blob[i]);
      const px = Math.cos(th) * rr;
      const py = Math.sin(th) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.clip();
    g.fillStyle = "#3a2d26";
    g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    g.save();
    g.rotate(spin);
    g.globalAlpha = 0.95;
    g.drawImage(rock, -r * 1.5, -r * 1.5, r * 3, r * 3);
    g.restore();
    // Terminator: dark side away from the direction of travel.
    const shade = g.createLinearGradient(dir.x * r, dir.y * r, -dir.x * r, -dir.y * r);
    shade.addColorStop(0, "rgba(255,150,50,0.0)");
    shade.addColorStop(0.55, "rgba(10,6,4,0.2)");
    shade.addColorStop(1, "rgba(5,3,2,0.6)");
    g.fillStyle = shade;
    g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    // Leading edge glowing from atmospheric heat.
    const heat = g.createRadialGradient(dir.x * r * 0.7, dir.y * r * 0.7, 0, dir.x * r * 0.7, dir.y * r * 0.7, r * 1.25);
    heat.addColorStop(0, "rgba(255,240,190,0.95)");
    heat.addColorStop(0.35, "rgba(255,150,50,0.75)");
    heat.addColorStop(1, "rgba(255,90,20,0)");
    g.fillStyle = heat;
    g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
    g.restore();
  }

  function drawTrail(t) {
    const g = gf;
    for (const p of trail) {
      const age = t - p.tb;
      if (age < 0 || age > p.life) continue;
      const u = age / p.life;
      const base = pathPos(p.tb);
      const r = 9 + 44 * base.u * base.u;
      const x = base.x + p.ox * r * 0.6 + (p.vx * age) / 1000;
      const y = base.y + p.oy * r * 0.6 + (p.vy * age) / 1000;
      if (p.smoke && u > 0.35) {
        g.globalCompositeOperation = "source-over";
        sprite(g, smokeSprite, x, y, r * 3.2 * p.size * (0.8 + u), 0.28 * (1 - u));
      } else {
        g.globalCompositeOperation = "lighter";
        sprite(g, heatSprites[heatIdx(1 - u * 0.9)], x, y, r * 2.8 * p.size * (1 - 0.55 * u), (1 - u) * 0.9);
      }
    }
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const s of flightSparks) {
      const age = t - s.tb;
      if (age < 0 || age > s.life) continue;
      const u = age / s.life;
      const base = pathPos(s.tb);
      const c = Math.cos(s.spread);
      const sn = Math.sin(s.spread);
      // Sparks fly backwards from the head, fanned out to the sides.
      const vx = (-dir.x * c + dir.y * sn) * s.speed;
      const vy = (-dir.y * c - dir.x * sn) * s.speed;
      const x = base.x + (vx * age) / 1000;
      const y = base.y + (vy * age) / 1000;
      const [r, gg, b] = HEAT[heatIdx(1 - u)];
      g.globalAlpha = 1 - u;
      g.strokeStyle = `rgb(${r},${gg},${b})`;
      g.lineWidth = s.w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - vx * 0.03, y - vy * 0.03);
      g.stroke();
    }
  }

  function drawImpact(t) {
    const g = gf;
    const te = t - FX.IMPACT;
    if (te < 0) return;

    // Sparks.
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const s of blastSparks) {
      if (te > s.life) continue;
      const u = te / s.life;
      const sec = te / 1000;
      const kd = 2.4;
      const dist = (s.v * (1 - Math.exp(-kd * sec))) / kd;
      const x = P.x + Math.cos(s.a) * dist;
      const y = P.y + Math.sin(s.a) * dist + 260 * sec * sec;
      const back = ((s.v * Math.exp(-kd * sec)) / 1000) * 0.045 * 1000;
      const [r, gg, b] = HEAT[heatIdx(1 - u * 0.95)];
      g.globalAlpha = 1 - u;
      g.strokeStyle = `rgb(${r},${gg},${b})`;
      g.lineWidth = s.w * (1 - 0.5 * u);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - Math.cos(s.a) * back, y - Math.sin(s.a) * back);
      g.stroke();
    }

    // Rock debris.
    g.globalCompositeOperation = "source-over";
    for (const d of debris) {
      if (te > d.life) continue;
      const u = te / d.life;
      const sec = te / 1000;
      const dist = (d.v * (1 - Math.exp(-1.2 * sec))) / 1.2;
      const x = P.x + Math.cos(d.a) * dist;
      const y = P.y + Math.sin(d.a) * dist + 420 * sec * sec;
      g.save();
      g.translate(x, y);
      g.rotate(d.rot + d.w * sec);
      g.globalAlpha = 1 - u * u;
      g.beginPath();
      d.pts.forEach(([px, py, k], i) => {
        if (i === 0) g.moveTo(px * d.r * k, py * d.r * k);
        else g.lineTo(px * d.r * k, py * d.r * k);
      });
      g.closePath();
      g.fillStyle = "#2b211c";
      g.fill();
      g.strokeStyle = `rgba(255,140,40,${0.9 * (1 - u)})`;
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }

    // Shockwave rings.
    g.globalCompositeOperation = "lighter";
    for (const [delay, speed, rgb, w] of [
      [0, 1.35, [255, 245, 220], 18],
      [110, 1.0, themeRgb, 12],
    ]) {
      const age = te - delay;
      if (age < 0) continue;
      const rad = age * speed;
      const p = clamp01(rad / (diag * 1.15));
      if (p >= 1) continue;
      g.globalAlpha = 0.9 * (1 - p);
      g.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      g.lineWidth = w * (1 - p) + 2;
      g.beginPath();
      g.arc(P.x, P.y, rad, 0, Math.PI * 2);
      g.stroke();
    }

    // White flash: snaps on, then burns off.
    const flash = 0.92 * Math.min(1, te / 40) * Math.exp(-Math.max(0, te - 40) / 150);
    if (flash > 0.01) {
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = flash;
      g.fillStyle = "#ffe9c0";
      g.fillRect(0, 0, W, H);
    }
  }

  function drawFront(t) {
    gf.globalAlpha = 1;
    gf.globalCompositeOperation = "source-over";
    gf.clearRect(0, 0, W, H);
    if (t >= FX.METEOR_START) {
      drawTrail(t);
      if (t < FX.IMPACT) drawMeteor(t);
    }
    drawImpact(t);
    gf.globalAlpha = 1;
    gf.globalCompositeOperation = "source-over";
  }

  resize();

  return {
    draw(t) {
      drawBack(t);
      drawFront(t);
    },
    resize,
  };
}
