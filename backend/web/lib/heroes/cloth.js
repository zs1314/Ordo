// Header animation "Cloth": a curtain hanging from a rod, drifting slowly in a light breeze. The cloth really is a 3D grid
// simulated with Verlet integration (structural, shear and bending constraints), held only at a few points on the rod; in
// between it sags naturally into arcs, and the extra width gathers into folds.
//
// - Drawing: only warp lines, one of them red, shaded segment by segment by how the cloth turns; where a fold turns away
//   the lines crowd together, like the hatching in a print.
// - Mouse: presses a dent into the cloth; the cloth is pushed aside and the folds move with it.
// - Click: like a gust of wind from behind, that patch billows out and then falls back.
import { stage, TAU, clamp, noise3 } from "./kit.js";

const ITER = 4;

export const meta = { id: "cloth", name: "布料", hint: "挂在杆上的一幅布帘在风里飘；鼠标在布上按出一个坑；点一下，从后面吹来一阵风" };

export function mount(canvas) {
  let G = null, acc = 0;
  const ps = { x: 0, y: 0, k: 0 };
  const gusts = [];

  function layout(w, h) {
    const C = clamp(Math.round(w / 9), 60, 130), R = clamp(Math.round(h / 12), 12, 24);
    const top = 0.09 * h, margin = 0.08 * w, span = w + 2 * margin, dx = span / (C - 1), dy = (0.8 * h) / (R - 1);
    // Rings fairly close together (about one every 70px), alternating front and back, so the cloth forms regular wave
    // folds between them (like a ripplefold curtain)
    const K = Math.max(6, Math.round(span / 70)), pinEvery = (C - 1) / K, period = 2 * pinEvery;
    const n = C * R, P = new Float32Array(3 * n), O = new Float32Array(3 * n), pin = new Uint8Array(n);
    // Folded from the start: the cloth follows a cosine in depth, with the rings exactly on the crests and troughs; the
    // constraints' rest lengths are computed from this shape, so the folds stay
    const amp = 0.14 * dx * period;
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const k = j * C + i, z = amp * Math.cos((TAU * i) / period) * (1 - 0.3 * (j / (R - 1)));
      P[3 * k] = O[3 * k] = -margin + i * dx; P[3 * k + 1] = O[3 * k + 1] = top + j * dy; P[3 * k + 2] = O[3 * k + 2] = z;
    }
    const pins = [];
    for (let p = 0; p <= K; p++) { const i = Math.round(p * pinEvery); pin[i] = 1; pins.push(i); }
    const dist = (a, b) => Math.hypot(P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]);
    // Constraints: [a, b, rest length, stiffness]; horizontal ones are a little slack so the cloth sags between the rings
    const cons = [];
    const add = (a, b, s, slack = 1) => cons.push(a, b, dist(a, b) * slack, s);
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const k = j * C + i;
      if (i < C - 1) add(k, k + 1, 1, j === 0 ? 1 : 1.01);
      if (j < R - 1) add(k, k + C, 1);
      if (i < C - 1 && j < R - 1) { add(k, k + C + 1, 0.4, 1.01); add(k + 1, k + C, 0.4, 1.01); }
      if (i < C - 2) add(k, k + 2, 0.3, 1.01);
      if (j < R - 2) add(k, k + 2 * C, 0.4);
    }
    G = { w, h, C, R, n, P, O, pin, pins, cons: Float32Array.from(cons), top, dx, dy, red: Math.round(C * 0.618) };
    // Let it hang for a while first, so it already looks settled when it appears
    for (let s = 0; s < 200; s++) sim(s * 16, 16);
  }

  function sim(t, dt) {
    const { n, P, O, pin, cons, C, h } = G, g = 0.00042 * h, s2 = dt * dt;
    for (let k = 0; k < n; k++) {
      if (pin[k]) continue;
      const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2], row = Math.floor(k / C) / (G.R - 1);
      // Wind: mostly along the depth axis, changing slowly with time and position; the lower down, the more it billows.
      // Gusts travel from left to right
      const wz = (noise3(x / 420 - t * 0.00018, y / 260, t * 0.00012) - 0.05) * 0.0007 * h * (0.2 + 0.8 * row);
      const wx = noise3(x / 300 + 7, y / 200, t * 0.0002) * 0.00008 * h * row;
      let ax = wx, ay = g, az = wz;
      for (const q of gusts) {
        const u = (t - q.t0) / 900;
        if (u < 0 || u > 1) continue;
        const d = Math.hypot(x - q.x, y - q.y);
        if (d < q.r) az -= (1 - d / q.r) ** 2 * Math.sin(Math.PI * u) * 0.016 * h;
      }
      const vx = (x - O[3 * k]) * 0.985, vy = (y - O[3 * k + 1]) * 0.985, vz = (z - O[3 * k + 2]) * 0.985;
      O[3 * k] = x; O[3 * k + 1] = y; O[3 * k + 2] = z;
      P[3 * k] = x + vx + ax * s2 / 256; P[3 * k + 1] = y + vy + ay * s2 / 256; P[3 * k + 2] = z + vz + az * s2 / 256;
    }
    // The mouse presses a dent into the cloth: nearby points are pushed back
    if (ps.k > 0.01) {
      const Rr = 0.3 * h;
      for (let k = 0; k < n; k++) {
        if (pin[k]) continue;
        const dx = P[3 * k] - ps.x, dy = P[3 * k + 1] - ps.y, d = Math.hypot(dx, dy);
        if (d >= Rr) continue;
        const f = (1 - d / Rr) ** 2 * ps.k;
        P[3 * k + 2] += (0.55 * h * f - P[3 * k + 2]) * 0.1 * f;
      }
    }
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < cons.length; c += 4) {
        const a = cons[c], b = cons[c + 1], L = cons[c + 2], st = cons[c + 3];
        const ax = 3 * a, bx = 3 * b, dx = P[bx] - P[ax], dy = P[bx + 1] - P[ax + 1], dz = P[bx + 2] - P[ax + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = ((d - L) / d) * 0.5 * st, wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, sum = wa + wb;
        if (!sum) continue;
        const ka = (diff * wa * 2) / sum, kb = (diff * wb * 2) / sum;
        P[ax] += dx * ka; P[ax + 1] += dy * ka; P[ax + 2] += dz * ka;
        P[bx] -= dx * kb; P[bx + 1] -= dy * kb; P[bx + 2] -= dz * kb;
      }
    }
  }

  function frame({ ctx, w, h, t, dt, ptr, ink, red, paper, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    ps.x = ptr.sx; ps.y = ptr.sy; ps.k = ptr.k;
    if (!still) { acc += Math.min(dt, 64); while (acc >= 16) { sim(t - acc, 16); acc -= 16; } }
    for (let i = gusts.length - 1; i >= 0; i--) if (t - gusts[i].t0 > 900) gusts.splice(i, 1);
    const { C, R, P } = G;
    // Only warp lines are drawn, every one of them: where a fold turns away the lines naturally crowd together, which
    // gives light and shade like the hatching in a print.
    // Each line is split into segments shaded by their orientation.
    // Seen slightly from above and to the side: points further back are shifted a little up and to the right, so the
    // relief of the folds shows in the hem and in the density of the hatching
    const SX = 0.36, SY = -0.14, px = (k) => P[k] + SX * P[k + 2], py = (k) => P[k + 1] + SY * P[k + 2];
    const line = (idx, color, alpha, lw) => {
      ctx.beginPath();
      for (let m = 0; m < idx.length; m++) { const k = 3 * idx[m]; m ? ctx.lineTo(px(k), py(k)) : ctx.moveTo(px(k), py(k)); }
      ctx.strokeStyle = color(alpha); ctx.lineWidth = lw; ctx.stroke();
    };
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const col0 = Array.from({ length: R }, (_, j) => j * C);
    // Sort the segments of each warp line into buckets by how the cloth slopes across the line: one side of a fold comes
    // out darker, the other lighter; with the density of the hatching on top, the folds stand out
    const B = 9, bins = Array.from({ length: B }, () => new Path2D());
    for (let i = 0; i < C; i++) {
      if (i === G.red) continue;
      const il = Math.max(0, i - 1), ir = Math.min(C - 1, i + 1);
      for (let j = 0; j < R - 1; j++) {
        const k = 3 * (j * C + i), k2 = k + 3 * C, l = 3 * (j * C + il), r = 3 * (j * C + ir);
        const slope = (P[r + 2] - P[l + 2]) / (Math.abs(P[r] - P[l]) + 1e-3), shade = clamp(0.5 + 0.5 * Math.tanh(slope * 1.4));
        const p = bins[clamp(Math.floor(shade * B), 0, B - 1)];
        p.moveTo(px(k), py(k)); p.lineTo(px(k2), py(k2));
      }
    }
    for (let b = 0; b < B; b++) { ctx.strokeStyle = ink((0.07 + 0.5 * ((b + 0.5) / B)).toFixed(3)); ctx.lineWidth = 0.65 + 0.2 * (b / B); ctx.stroke(bins[b]); }
    line(col0.map((b) => b + G.red), red, 0.8, 1);
    line(Array.from({ length: C }, (_, i) => (R - 1) * C + i), ink, 0.55, 1);
    line(Array.from({ length: C }, (_, i) => i), ink, 0.4, 0.8);
    // The rod and the rings
    const y0 = G.top - 3.5;
    ctx.strokeStyle = ink(0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
    ctx.lineWidth = 1;
    for (const i of G.pins) { const x = px(3 * i); if (x < -4 || x > w + 4) continue; ctx.beginPath(); ctx.arc(x, y0 + 1.5, 2.6, 0, TAU); ctx.fillStyle = paper; ctx.fill(); ctx.strokeStyle = ink(0.65); ctx.stroke(); }
  }

  return stage(canvas, { frame, click: (x, y, t) => gusts.push({ x, y, t0: t, r: 0.4 * (G?.h ?? 220) }), stillT: 3000 });
}
