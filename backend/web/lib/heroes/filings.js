// Header animation "Iron Filings": a sheet of paper sprinkled with iron filings, with a few bar magnets hidden beneath it
// that slowly drift and turn. Each filing lies along the direction of the field at its spot, denser and longer the closer
// it is to a pole, so together they trace out loops of field lines. The magnets themselves are not drawn.
//
// - The mouse is a magnet, with a few red field lines coming out of its N pole.
// - Click: puts down a magnet there; the filings rearrange around it, and after a while it slowly fades away by itself.
import { stage, TAU, clamp, smooth, rng, noise3 } from "./kit.js";

export const meta = { id: "filings", name: "铁屑", hint: "铁屑顺着下面几块看不见的磁铁排出磁力线；鼠标也是一块磁铁，引出红色的磁力线；点一下放一块新磁铁" };

const GAP = 5.6;   // rough spacing between filings (px)

export function mount(canvas) {
  let G = null;
  const dropped = [];
  let mouseAng = 0, lastX = 0, lastY = 0;

  function layout(w, h) {
    const r = rng(17), K = clamp(Math.round(w / 420) + 1, 2, 5), mags = [];
    for (let k = 0; k < K; k++) mags.push({ bx: ((k + 0.5) / K) * w, by: h * (0.3 + 0.4 * r()), ax: (0.35 * w) / K, ay: 0.2 * h, fx: 0.00005 + 0.00004 * r(), fy: 0.00006 + 0.00005 * r(), ph: r() * TAU, spin: (r() < 0.5 ? -1 : 1) * (0.00008 + 0.00008 * r()), a0: r() * TAU, q: 0.8 + 0.4 * r() });
    const pts = [];
    for (let y = GAP / 2; y < h; y += GAP) for (let x = GAP / 2; x < w; x += GAP) pts.push(x + (r() - 0.5) * GAP * 0.9, y + (r() - 0.5) * GAP * 0.9);
    G = { w, h, mags, pts: Float32Array.from(pts), L: 0.42 * h };
  }

  // All poles at this moment: [x, y, charge]; each magnet is an N/S pair
  function poles(t, ptr) {
    const out = [], L = G.L;
    const pair = (x, y, a, q, len = L) => { const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2; out.push([x + dx, y + dy, q], [x - dx, y - dy, -q]); };
    for (const m of G.mags) pair(m.bx + m.ax * Math.sin(m.fx * t + m.ph), m.by + m.ay * Math.sin(m.fy * t + m.ph * 1.3), m.a0 + m.spin * t, m.q);
    for (const d of dropped) { const life = clamp((t - d.t0) / 600) * (1 - smooth((t - d.t0 - 9000) / 2000)); if (life > 0.01) pair(d.x, d.y, d.a, 1.3 * life, L * 0.9); }
    if (ptr.k > 0.01) pair(ptr.sx, ptr.sy, mouseAng, 1.6 * ptr.k, L * 0.8);
    return out;
  }
  const field = (P, x, y) => {
    let bx = 0, by = 0;
    for (let i = 0; i < P.length; i++) { const [px, py, q] = P[i], dx = x - px, dy = y - py, r2 = dx * dx + dy * dy + 4; bx += (q * dx) / r2; by += (q * dy) / r2; }
    return [bx, by];
  };

  function frame({ ctx, w, h, t, dt, ptr, ink, red, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    for (let i = dropped.length - 1; i >= 0; i--) if (t - dropped[i].t0 > 11000) dropped.splice(i, 1);
    // Orientation of the mouse magnet: turns slowly to follow the direction of movement
    if (ptr.k > 0.01 && !still) { const mx = ptr.sx - lastX, my = ptr.sy - lastY; if (Math.hypot(mx, my) > 0.6) { let d = Math.atan2(my, mx) - mouseAng; d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI; mouseAng += d * 0.08; } }
    lastX = ptr.sx; lastY = ptr.sy;
    const tt = still ? 3000 : t, P = poles(tt, still ? { k: 0 } : ptr), pts = G.pts;
    // Each filing: its direction follows the field, its length and darkness follow the field strength (on a log scale, so
    // the area next to a pole does not turn solid black)
    const B = 9, paths = Array.from({ length: B }, () => new Path2D());
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1], [bx, by] = field(P, x, y), m = Math.hypot(bx, by);
      if (m < 1e-6) continue;
      const s = clamp(Math.log1p(m * 90) / Math.log1p(90 * 0.22)), wob = 0.22 * noise3(x * 0.05, y * 0.05, 0.5);
      const ux = bx / m, uy = by / m, c = Math.cos(wob), sn = Math.sin(wob), vx = ux * c - uy * sn, vy = ux * sn + uy * c, L = 1.4 + 3.4 * s;
      paths[clamp(Math.floor(s * B), 0, B - 1)].moveTo(x - vx * L, y - vy * L);
      paths[clamp(Math.floor(s * B), 0, B - 1)].lineTo(x + vx * L, y + vy * L);
    }
    ctx.lineCap = "round";
    for (let b = 0; b < B; b++) { ctx.strokeStyle = ink((0.14 + 0.66 * ((b + 0.5) / B)).toFixed(3)); ctx.lineWidth = 0.8 + 0.4 * (b / B); ctx.stroke(paths[b]); }

    // Red field lines: start at the N pole of the mouse magnet (of the first magnet when there is no mouse) and follow the
    // field to an S pole
    const src = ptr.k > 0.05 && !still ? P[P.length - 2] : P[0], alpha = ptr.k > 0.05 && !still ? 0.85 * ptr.k : 0.42, n = ptr.k > 0.05 && !still ? 9 : 5;
    ctx.strokeStyle = red(alpha.toFixed(3)); ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.3;
      let x = src[0] + Math.cos(a) * 4, y = src[1] + Math.sin(a) * 4;
      ctx.moveTo(x, y);
      for (let s = 0; s < 220; s++) {
        const [b1x, b1y] = field(P, x, y), m1 = Math.hypot(b1x, b1y) || 1;
        const mx = x + (b1x / m1) * 1.6, my = y + (b1y / m1) * 1.6, [b2x, b2y] = field(P, mx, my), m2 = Math.hypot(b2x, b2y) || 1;
        x += (b2x / m2) * 3.2; y += (b2y / m2) * 3.2;
        ctx.lineTo(x, y);
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) break;
        if (P.some(([px, py, q]) => q < 0 && Math.hypot(x - px, y - py) < 4)) break;
      }
    }
    ctx.stroke();
  }

  function click(x, y, t) {
    dropped.push({ x, y, t0: t, a: Math.random() * TAU });
    if (dropped.length > 3) dropped.shift();
  }

  return stage(canvas, { frame, click, stillT: 3000 });
}
