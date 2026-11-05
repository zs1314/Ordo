// Dominoes: a row of upright rectangles falls from left to right. Each one rotates about its own bottom-right corner (falling to
// the right), with θ going from 0 (upright) to π/2 (lying flat).
// A falling block that hits the one on its right leans on it and pushes it over too; if it cannot reach, it lies down flat, the
// ground shakes, and the next one falls. The rightmost block leans against the wall.
// Pure computation, no DOM: components/done/Bars.js calls step(dt) every frame and uses angles to rotate the bars. Tests are in
// test/anim.test.mjs.
//
// Coordinates: x points right, y points up, the ground is y = 0. A block = { x, w, h }: left edge at x, width w, height h.

const HALF = Math.PI / 2;
const SUB = 1 / 480; // integration step (seconds): each frame is split into small steps so that collisions cannot pass through

/** Positions of the four corners after rotating right by θ about the bottom-right corner (x + w, 0) */
export function corners({ x, w, h }, th) {
  const px = x + w, c = Math.cos(th), s = Math.sin(th);
  return [[-w, 0], [-w, h], [0, h], [0, 0]].map(([dx, dy]) => [px + dx * c + dy * s, -dx * s + dy * c]);
}

/** Whether two convex quadrilaterals overlap (separating axis test). eps: merely touching does not count as overlapping */
export function overlap(A, B, eps = 0.02) {
  for (const P of [A, B]) {
    for (let k = 0; k < P.length; k++) {
      const [x1, y1] = P[k], [x2, y2] = P[(k + 1) % P.length];
      const nx = y1 - y2, ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of A) { const d = (x * nx + y * ny) / len; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const [x, y] of B) { const d = (x * nx + y * ny) / len; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

// The tilt at which the center of mass is right above the bottom-right corner: only past it does the block fall by itself
const tipAngle = (b) => Math.atan2(b.w, b.h);
// Angular acceleration with which gravity turns it to the right (uniform rectangle, about the bottom-right corner)
const accel = (b, th, g) => (3 * g * (b.h * Math.sin(th) - b.w * Math.cos(th))) / (2 * (b.w * b.w + b.h * b.h));
// The minimum angular velocity that carries it from upright to tipAngle, plus a little extra
const kick = (b, g) => 1.2 * Math.sqrt((6 * g * (Math.hypot(b.w, b.h) / 2 - b.h / 2)) / (b.w * b.w + b.h * b.h));

/**
 * bars: sorted by x, ascending. wall: the wall on the right (x). g: gravity (pixels / s²).
 * Returns { step(dt) → whether everything has stopped, angles: each block's current angle, t: time elapsed }
 */
export function dominoes(bars, { wall = Infinity, g = 5200, maxT = 6 } = {}) {
  const S = bars.map((b) => ({ ...b, th: 0, om: 0, moving: false, done: false, shock: -1 }));
  const poly = (i, th = S[i].th) => corners(S[i], th);
  // Whether turning block i to th hits the block on its right (at that block's current angle) or the wall, or, when turning back,
  // the block on its left
  const hits = (i, th) => {
    const P = poly(i, th);
    if (P.some(([x]) => x > wall)) return "wall";
    if (i + 1 < S.length && overlap(P, poly(i + 1))) return "next";
    if (i > 0 && th < S[i].th && overlap(P, poly(i - 1))) return "prev";
    return null;
  };
  const area = (b) => b.w * b.h;
  const push = (j, om) => {
    const b = S[j];
    if (!b || b.done) return;
    if (!b.moving) { b.moving = true; b.om = Math.max(om, kick(b, g)); }
    else b.om = Math.max(b.om, om);
  };
  let t = 0, quiet = 0, mark = 0, snap = S.map(() => 0);
  if (S.length) push(0, 0);

  function sub(dt) {
    let still = true;
    for (let i = 0; i < S.length; i++) {
      const b = S[i];
      // Ground shake: the block on the left fell flat without reaching this one, so this one falls by itself a moment later
      if (!b.moving && b.shock >= 0 && t >= b.shock) push(i, 0);
      if (!b.moving || b.done) continue;
      const from = b.th, a = accel(b, b.th, g);
      b.om += a * dt;
      let to = Math.min(HALF, Math.max(0, b.th + b.om * dt));
      const hit = to !== from ? hits(i, to) : null;
      if (hit) {
        // Binary search for the contact angle (moving from `from` toward `to`, up to just before they touch)
        let ok = from, bad = to;
        for (let k = 0; k < 14; k++) { const mid = (ok + bad) / 2; if (hits(i, mid)) bad = mid; else ok = mid; }
        to = ok;
        if (hit === "next") {
          const n = S[i + 1];
          push(i + 1, b.om * 0.85 * Math.sqrt(b.h / n.h));
          // The weight leaning on it keeps pushing it (otherwise, in a tightly packed row, a block pushed halfway would stand back up)
          n.om += Math.max(0, a) * dt * 0.6 * (area(b) / area(n));
        }
        b.om = hit === "prev" ? 0 : Math.min(b.om, Math.max(0, (to - from) / dt)); // leaning on it: follow it slowly down
      }
      if (to >= HALF) { // lying flat: a small bounce on first landing; once down, it no longer bounces when the block leaning on it pushes it
        to = HALF;
        b.om = from < HALF - 1e-6 && b.om > 0.4 ? -b.om * 0.16 : 0;
        if (b.om === 0 && i + 1 < S.length && !S[i + 1].moving && S[i + 1].shock < 0) S[i + 1].shock = t + 0.07;
      }
      if (to <= 0 && b.om < 0) { to = 0; b.om = 0; }
      b.th = to;
      if (Math.abs(to - from) > 1e-5 || Math.abs(b.om) > 1e-3) still = false;
    }
    // Not over while some block has not started to fall
    if (S.some((b) => !b.moving)) still = false;
    return still;
  }

  return {
    get angles() { return S.map((b) => b.th); },
    get t() { return t; },
    get state() { return S.map(({ th, om, moving }) => ({ th, om, moving })); },
    step(dt) {
      let n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n, still = true;
      while (n--) { t += h; if (!sub(h)) still = false; }
      quiet = still ? quiet + dt : 0;
      // Check every 0.1 s: if every block has fallen and the angles have nearly stopped changing, that counts as stopped too
      // (a little jitter does not matter)
      if (t - mark >= 0.1) {
        const calm = S.every((b, k) => b.moving && Math.abs(b.th - snap[k]) < 2e-4);
        snap = S.map((b) => b.th); mark = t;
        if (calm) quiet = Math.max(quiet, 0.26);
      }
      return quiet > 0.25 || t > maxT;
    },
  };
}
