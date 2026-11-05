// Header animation "Loss Landscape": a slowly undulating contour map on which a few red optimizers (SGD + momentum) roll
// downhill along the gradient, leaving trails.
//
// - The terrain is a few slowly drifting Gaussian pits and bumps plus a layer of low-frequency noise; the contours are
//   drawn with marching squares, every 5th one bold (an index contour), like a topographic map.
// - When an optimizer reaches the bottom of a pit and settles, a ripple rings out, and after a while it starts again from
//   some other high ground.
// - The mouse raises a hill on the map: the contours go around it and nearby optimizers are pushed away.
// - Click: drops a new optimizer there.
import { stage, TAU, clamp, smooth, easeOut, rng, noise3 } from "./kit.js";

const LV = 0.075;          // contour interval
const MAXRUNS = 12;

export const meta = { id: "landscape", name: "损失地形", hint: "等高线地形上，几颗优化器往低处滚；鼠标鼓起一座山；点一下，放一颗新的" };

export function mount(canvas) {
  let G = null, runs = [], seq = 0;
  const ps = { x: 0, y: 0, k: 0 };
  const R = rng(2026);

  function layout(w, h) {
    const r = rng(9), K = Math.max(5, Math.round((w / h) * 1.7) + 2), bumps = [];
    for (let k = 0; k < K; k++) {
      const well = k % 3 !== 2;
      bumps.push({
        bx: ((k + 0.5) / K) * w + (r() - 0.5) * (w / K) * 0.6, by: h * (0.25 + 0.5 * r()),
        ax: (0.05 + 0.08 * r()) * w / K * 3, ay: (0.06 + 0.1 * r()) * h, fx: 0.00004 + 0.00006 * r(), fy: 0.00005 + 0.00007 * r(), ph: r() * TAU,
        A: well ? -(0.55 + 0.6 * r()) : 0.35 + 0.45 * r(), s: h * (0.16 + 0.2 * r()),
      });
    }
    G = { w, h, bumps, n: Math.max(4, Math.min(9, Math.round(w / 170))) };
    runs = [];
  }

  // Precompute where each pit and bump is centered at this moment
  let C = [], tN = 0;
  function prep(t) {
    C = G.bumps.map((b) => ({ x: b.bx + b.ax * Math.sin(b.fx * t + b.ph), y: b.by + b.ay * Math.sin(b.fy * t + b.ph * 1.7), A: b.A, k: 1 / (2 * b.s * b.s), r2: 9 * b.s * b.s }));
    tN = t * 0.00004;
  }
  // Terrain height, including the hill raised by the mouse
  function f(x, y) {
    let v = 0;
    for (let i = 0; i < C.length; i++) {
      const b = C[i], dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < b.r2) v += b.A * Math.exp(-d2 * b.k);
    }
    v += 0.28 * noise3(x / (0.55 * G.h), y / (0.55 * G.h), tN);
    if (ps.k > 0.01) { const dx = x - ps.x, dy = y - ps.y, s = 0.17 * G.h; v += 1.15 * ps.k * Math.exp(-(dx * dx + dy * dy) / (2 * s * s)); }
    return v;
  }

  function spawn(t, x, y) {
    if (x === undefined) {
      // Pick from a few random points: high ground, far from the other optimizers
      prep(t);
      let bv = -Infinity;
      const live = runs.filter((r) => !r.done);
      for (let i = 0; i < 18; i++) {
        const cx = G.w * (0.05 + 0.9 * R()), cy = G.h * (0.14 + 0.72 * R());
        const far = live.length ? Math.min(...live.map((r) => Math.hypot(r.x - cx, r.y - cy))) / G.w : 0.5;
        const v = f(cx, cy) + 2.2 * Math.min(far, 0.3);
        if (v > bv) { bv = v; x = cx; y = cy; }
      }
    }
    const run = { id: ++seq, x, y, vx: 0, vy: 0, trail: [[x, y]], born: t, still: 0, done: 0, lastPush: t };
    runs.push(run);
    if (runs.length > MAXRUNS) runs.splice(runs.findIndex((r) => r.done) >= 0 ? runs.findIndex((r) => r.done) : 0, 1);
    return run;
  }

  function step(t, dt) {
    prep(t);
    const h = G.h, kq = 9000 * (h / 220), gam = 1.8, s = dt / 1000, e = 1.5;
    for (const r of runs) {
      if (r.done) continue;
      const gx = (f(r.x + e, r.y) - f(r.x - e, r.y)) / (2 * e), gy = (f(r.x, r.y + e) - f(r.x, r.y - e)) / (2 * e);
      // Invisible soft walls on every side keep them from rolling out of the picture
      const m = 0.07 * h, top = 0.07 * h, wx = r.x < m ? m - r.x : r.x > G.w - m ? G.w - m - r.x : 0, wy = r.y < top ? top - r.y : r.y > h - m ? h - m - r.y : 0;
      r.vx += (-gam * r.vx - kq * gx + 60 * wx) * s; r.vy += (-gam * r.vy - kq * gy + 60 * wy) * s;
      r.x += r.vx * s; r.y += r.vy * s;
      r.g = Math.hypot(gx, gy);
      const sp = Math.hypot(r.vx, r.vy);
      r.still = sp < 5 && r.g * kq < 40 ? r.still + dt : 0;
      if (t - r.lastPush > 40) { r.trail.push([r.x, r.y]); r.lastPush = t; if (r.trail.length > 110) r.trail.shift(); }
      if (r.still > 1100 || t - r.born > 16000) r.done = t;
      if (r.x < -20 || r.y < -20 || r.x > G.w + 20 || r.y > G.h + 20) r.done = t - 1000;
    }
    // Settled ones are replaced by a new one after a while
    runs = runs.filter((r) => !r.done || t - r.done < 2200);
    while (runs.filter((r) => !r.done).length < G.n) spawn(t);
  }

  function frame({ ctx, w, h, t, dt, q, ptr, ink, red, paper, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    ps.x = ptr.sx; ps.y = ptr.sy; ps.k = ptr.k;
    if (!runs.length) { // first frame: let them roll for a while first, so there are trails right from the start
      for (let i = 0; i < G.n; i++) spawn(t - 2000);
      for (let k = 0; k < 90; k++) step(t - 2000 + k * 16, 16);
    }
    if (!still && dt > 0) { const n = Math.ceil(dt / 16); for (let i = 0; i < n; i++) step(t - dt + ((i + 1) * dt) / n, dt / n); }

    // Contours: marching squares
    const cs = q === 0 ? 6 : q === 1 ? 8 : 11, nx = Math.ceil(w / cs) + 1, ny = Math.ceil(h / cs) + 1, V = new Float32Array(nx * ny);
    prep(t);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[j * nx + i] = f(i * cs, j * cs);
    const thin = new Path2D(), bold = new Path2D();
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = V[j * nx + i], b = V[j * nx + i + 1], c = V[(j + 1) * nx + i + 1], d = V[(j + 1) * nx + i];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      const x = i * cs, y = j * cs;
      for (let L = Math.ceil(lo / LV); L * LV <= hi; L++) {
        const lv = L * LV, k = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const path = L % 5 === 0 ? bold : thin;
        const top = () => [x + (cs * (lv - a)) / (b - a), y], right = () => [x + cs, y + (cs * (lv - b)) / (c - b)];
        const bot = () => [x + (cs * (lv - d)) / (c - d), y + cs], left = () => [x, y + (cs * (lv - a)) / (d - a)];
        const seg = (p, q2) => { path.moveTo(p[0], p[1]); path.lineTo(q2[0], q2[1]); };
        switch (k) {
          case 1: case 14: seg(left(), bot()); break;
          case 2: case 13: seg(bot(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 6: case 9: seg(top(), bot()); break;
          case 7: case 8: seg(left(), top()); break;
          case 5: case 10: {
            const mid = (a + b + c + d) / 4 > lv;
            if ((k === 5) === mid) { seg(left(), top()); seg(bot(), right()); } else { seg(top(), right()); seg(left(), bot()); }
            break;
          }
        }
      }
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink(0.26); ctx.lineWidth = 0.7; ctx.stroke(thin);
    ctx.strokeStyle = ink(0.58); ctx.lineWidth = 1.15; ctx.stroke(bold);

    // Optimizers: trail, iterate markers, current position
    for (const r of runs) {
      const fade = r.done ? 1 - smooth((t - r.done - 1400) / 800) : smooth((t - r.born) / 300), tr = r.trail, n = tr.length;
      if (fade <= 0.01) continue;
      for (let s = 0; s < 6; s++) {
        const i0 = Math.floor((s * (n - 1)) / 6), i1 = Math.floor(((s + 1) * (n - 1)) / 6);
        if (i1 <= i0) continue;
        ctx.strokeStyle = red((0.12 + 0.13 * s) * fade); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tr[i0][0], tr[i0][1]);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(tr[i][0], tr[i][1]);
        ctx.stroke();
      }
      ctx.fillStyle = red((0.5 * fade).toFixed(3));
      for (let i = n - 1; i >= 0; i -= 8) ctx.fillRect(tr[i][0] - 1, tr[i][1] - 1, 2, 2);
      const x = r.x, y = r.y;
      ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = red((0.85 * fade).toFixed(3)); ctx.lineWidth = 1.1; ctx.stroke();
      ctx.fillStyle = red((0.95 * fade).toFixed(3)); ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
      if (r.done) {
        const v = clamp((t - r.done) / 600), rr = 4.2 + 12 * easeOut(v);
        ctx.strokeStyle = red((0.6 * (1 - v) * fade).toFixed(3)); ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      }
    }
  }

  function click(x, y, t) {
    if (!G) return;
    spawn(t, x, y);
  }

  return stage(canvas, { frame, click, stillT: 3000 });
}
