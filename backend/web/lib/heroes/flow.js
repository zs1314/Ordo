// Header animation "Flow Matching": a few thousand particles start from Gaussian noise, flow along curved probability paths
// into a target distribution, rest for a moment, then scatter back into noise and move on to the next distribution.
//
// - The distributions take turns in order: a word set in the board's font, two moons, checkerboard, 8 gaussians, a double
//   helix. The first four are common toy data in flow matching / diffusion papers.
// - Noise and data are each sorted along a Hilbert curve and paired one to one (approximate optimal transport), so the
//   flow moves in coherent sheets instead of darting around; each path also gets a slight bend determined by the noise.
// - Mouse: pushes nearby particles away (pushing the samples outward, like guidance).
// - Click: the particles in that patch scatter back into noise and are generated again (local resampling).
// - A few particles are red and trail longer tails, so the paths are easy to follow.
import { stage, TAU, clamp, smooth, easeInOut, easeOut, rng, gauss, noise3 } from "./kit.js";

const SETS = ["axi", "moons", "checker", "gauss", "helix"];
const REST = 700, GEN = 3600, HOLD = 2800, BACK = 2000, CYCLE = REST + GEN + HOLD + BACK;
const STAGGER = 0.35, K = 4, KRED = 9, DT = 0.024;

function hilbert(x, y, n = 1024) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } const t = x; x = y; y = t; }
  }
  return d;
}

export const meta = { id: "flow", name: "流匹配", hint: "粒子从噪声流成 Axi、two moons、棋盘……再散回去；鼠标把粒子推开；点一下，那一片重新生成" };

export function mount(canvas) {
  let G = null, n = 0, cycle = -1;
  let GZ, ZP, X1, DEL, KAP, KAP2, RED, DX, DY, VX, VY, RS, WOB;
  const ps = { x: 0, y: 0, k: 0 };
  const rings = [];
  // The word is drawn in the board's default font (Adventor Todo); until that font has loaded a fallback is used, and
  // once it loads the target is resampled if the particles have not taken shape yet
  const FONT = '700 100px "Adventor Todo"';
  let fontReady = !document.fonts || document.fonts.check(FONT);
  if (!fontReady) document.fonts.load(FONT).then(() => { fontReady = true; if (G && cycle === 0 && lastT < 0.05) cycle = -1; }).catch(() => {});
  let lastT = 0;

  function alloc(N) {
    n = N;
    const r = rng(1337);
    GZ = new Float32Array(2 * N); ZP = new Float32Array(2 * N); X1 = new Float32Array(2 * N);
    DEL = new Float32Array(N); KAP = new Float32Array(N); KAP2 = new Float32Array(N); RED = new Uint8Array(N);
    DX = new Float32Array(N); DY = new Float32Array(N); VX = new Float32Array(N); VY = new Float32Array(N); RS = new Float32Array(N).fill(-1e9); WOB = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      GZ[2 * i] = gauss(r); GZ[2 * i + 1] = gauss(r);
      DEL[i] = STAGGER * r(); RED[i] = r() < 0.016 ? 1 : 0; WOB[i] = r() * TAU;
    }
  }
  function layout(w, h) {
    const bw = Math.min(w - 48, h * 4.8), bh = h * 0.72;
    G = { w, h, bw, bh, cx: w / 2, cy: h * 0.53, sx: bw * 0.2, sy: bh * 0.3 };
    const N = Math.round(clamp((w * h) / 52, 1400, 4800));
    if (N !== n) alloc(N);
    for (let i = 0; i < n; i++) { ZP[2 * i] = G.cx + GZ[2 * i] * G.sx; ZP[2 * i + 1] = G.cy + GZ[2 * i + 1] * G.sy; }
    cycle = -1;
  }

  // Sample a distribution; returns canvas coordinates
  function sample(kind, N, seed) {
    const r = rng(seed), out = new Float32Array(2 * N), { cx, cy, bw, bh } = G;
    const put = (i, u, v) => { out[2 * i] = cx + (u * bw) / 2; out[2 * i + 1] = cy + (v * bh) / 2; };
    if (kind === "axi") {
      const c = document.createElement("canvas"), W = Math.ceil(bw), H = Math.ceil(bh), g = c.getContext("2d", { willReadFrequently: true });
      c.width = W; c.height = H;
      g.font = `700 ${Math.round(H * 0.95)}px "Adventor Todo", "Avenir Next", "Futura", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("Axi", W / 2, H * 0.53);
      const px = g.getImageData(0, 0, W, H).data, hits = [];
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (px[4 * (y * W + x) + 3] > 140) hits.push(x, y);
      for (let i = 0; i < N; i++) {
        const j = 2 * Math.floor(r() * (hits.length / 2));
        out[2 * i] = cx - W / 2 + hits[j] + r(); out[2 * i + 1] = cy - H / 2 + hits[j + 1] + r();
      }
    } else if (kind === "moons") {
      for (let i = 0; i < N; i++) {
        const th = Math.PI * r(), up = i % 2 === 0, x = up ? Math.cos(th) : 1 - Math.cos(th), y = up ? Math.sin(th) : 0.5 - Math.sin(th);
        put(i, ((x - 0.5) / 1.5) * 0.9 + 0.025 * gauss(r), (-(y - 0.25) / 0.75) * 0.88 + 0.07 * gauss(r));
      }
    } else if (kind === "checker") {
      const rows = 4, cell = bh / rows, cols = Math.max(4, Math.floor(bw / cell)), x0 = cx - (cols * cell) / 2, y0 = cy - bh / 2;
      for (let i = 0; i < N; i++) {
        let rr, cc;
        do { rr = Math.floor(r() * rows); cc = Math.floor(r() * cols); } while ((rr + cc) % 2);
        out[2 * i] = x0 + (cc + 0.06 + 0.88 * r()) * cell; out[2 * i + 1] = y0 + (rr + 0.06 + 0.88 * r()) * cell;
      }
    } else if (kind === "gauss") {
      const s = bh * 0.055;
      for (let i = 0; i < N; i++) {
        const a = (TAU * (i % 8)) / 8 + Math.PI / 8;
        out[2 * i] = cx + Math.cos(a) * bw * 0.36 + gauss(r) * s; out[2 * i + 1] = cy + Math.sin(a) * bh * 0.4 + gauss(r) * s;
      }
    } else {
      // Two helical strands with rungs between them
      for (let i = 0; i < N; i++) {
        const rung = r() < 0.16, u = r() * 2 - 1, ph = Math.PI * 2.4 * u, depth = Math.cos(ph);
        if (rung) { const uu = Math.round(u * 9) / 9, p2 = Math.PI * 2.4 * uu, a = Math.sin(p2) * 0.7, t = r() * 2 - 1; put(i, uu * 0.92 + 0.004 * gauss(r), a * t + 0.01 * gauss(r)); }
        else { const sgn = i % 2 ? 1 : -1; put(i, u * 0.92, sgn * Math.sin(ph) * 0.7 + (0.035 + 0.02 * depth) * gauss(r)); }
      }
    }
    return out;
  }
  // Sort noise and data separately along a Hilbert curve and pair up the points of equal rank
  function pair(data, seed) {
    const key = (x, y) => hilbert(clamp(Math.floor(((x - G.cx) / (G.bw * 1.15) + 0.5) * 1023), 0, 1023), clamp(Math.floor(((y - G.cy) / (G.bh * 1.6) + 0.5) * 1023), 0, 1023));
    const zi = Array.from({ length: n }, (_, i) => i), di = Array.from({ length: n }, (_, i) => i);
    const zk = new Float64Array(n), dk = new Float64Array(n);
    for (let i = 0; i < n; i++) { zk[i] = key(ZP[2 * i], ZP[2 * i + 1]); dk[i] = key(data[2 * i], data[2 * i + 1]); }
    zi.sort((a, b) => zk[a] - zk[b]); di.sort((a, b) => dk[a] - dk[b]);
    for (let r = 0; r < n; r++) { const i = zi[r], j = di[r]; X1[2 * i] = data[2 * j]; X1[2 * i + 1] = data[2 * j + 1]; }
    // The bends differ from cycle to cycle, but neighboring particles bend about the same way
    for (let i = 0; i < n; i++) {
      KAP[i] = 0.42 * noise3(GZ[2 * i] * 0.8 + 3.1, GZ[2 * i + 1] * 0.8, seed * 1.37);
      KAP2[i] = 0.12 * noise3(GZ[2 * i] * 1.3, GZ[2 * i + 1] * 1.3 + 7.7, seed * 0.91);
    }
  }

  // Position of particle i at path parameter e (0 noise → 1 data)
  function at(i, e, out) {
    const zx = ZP[2 * i], zy = ZP[2 * i + 1], dx = X1[2 * i] - zx, dy = X1[2 * i + 1] - zy, b = KAP[i] * Math.sin(Math.PI * e) + KAP2[i] * Math.sin(TAU * e);
    out[0] = zx + dx * e - dy * b; out[1] = zy + dy * e + dx * b;
  }

  function frame({ ctx, w, h, t, dt, q, ptr, ink, red, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    const tc = still ? REST + GEN + 900 : t, c = Math.floor(tc / CYCLE), u = tc - c * CYCLE;
    if (c !== cycle) { cycle = c; pair(sample(SETS[((c % SETS.length) + SETS.length) % SETS.length], n, 101 + c), c); }
    // Global time T: 0 is noise, 1 is data; speed is how fast T changes (signed) and sets the length of the tails
    let T, speed;
    if (u < REST) { T = 0; speed = 0; }
    else if (u < REST + GEN) { const v = (u - REST) / GEN; T = easeInOut(v); speed = v < 0.5 ? 12 * v * v : 12 * (1 - v) * (1 - v); }
    else if (u < REST + GEN + HOLD) { T = 1; speed = 0; }
    else { const v = (u - REST - GEN - HOLD) / BACK; T = 1 - easeInOut(v); speed = -(v < 0.5 ? 12 * v * v : 12 * (1 - v) * (1 - v)); }
    lastT = T;
    ps.x = ptr.sx; ps.y = ptr.sy; ps.k = ptr.k;
    const Rg = 0.3 * h, sdt = Math.min(0.05, dt / 1000), stride = q === 0 ? 1 : q === 1 ? 2 : 3;
    const tail = DT * Math.min(1, Math.abs(speed) / 1.6) * Math.sign(speed);

    // Each particle's path parameter: start times are staggered; a clicked patch first scatters and then grows back
    const eOf = (i, TT) => {
      let e = clamp((TT * (1 + STAGGER) - DEL[i]) / 1);
      const since = t - RS[i];
      if (since < 2200) { const bump = since < 450 ? smooth(since / 450) : 1 - smooth((since - 450) / 1750); e *= 1 - 0.6 * bump; }
      return e;
    };
    const paths = Array.from({ length: K }, () => new Path2D()), heads = new Path2D(), redPaths = new Path2D(), p = [0, 0], p2 = [0, 0];
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!RED[i] && i % stride) continue;
      const e = eOf(i, T);
      at(i, e, p);
      // Jitter gently even at rest
      const wob = (1 - Math.min(1, Math.abs(speed))) * 0.9;
      const ox = DX[i] + Math.sin(t * 0.0021 + WOB[i]) * wob, oy = DY[i] + Math.cos(t * 0.0017 + WOB[i] * 1.3) * wob;
      // The mouse pushes nearby particles away (spring)
      if (!still) {
        let tx = 0, ty = 0;
        if (ps.k > 0.01) { const ddx = p[0] - ps.x, ddy = p[1] - ps.y, r2 = ddx * ddx + ddy * ddy; if (r2 < Rg * Rg) { const r = Math.sqrt(r2) || 1, push = (1 - r / Rg) ** 2 * Rg * 0.55 * ps.k; tx = (ddx / r) * push; ty = (ddy / r) * push; } }
        if (tx || ty || DX[i] || DY[i] || VX[i] || VY[i]) {
          VX[i] += (90 * (tx - DX[i]) - 17 * VX[i]) * sdt; VY[i] += (90 * (ty - DY[i]) - 17 * VY[i]) * sdt;
          DX[i] += VX[i] * sdt; DY[i] += VY[i] * sdt;
          if (Math.abs(DX[i]) + Math.abs(DY[i]) + Math.abs(VX[i]) + Math.abs(VY[i]) < 0.02) DX[i] = DY[i] = VX[i] = VY[i] = 0;
        }
      }
      const hx = p[0] + ox, hy = p[1] + oy;
      if (RED[i]) {
        redPaths.moveTo(hx, hy);
        if (tail) for (let k = 1; k <= KRED; k++) { at(i, eOf(i, clamp(T - tail * k * 0.9)), p2); redPaths.lineTo(p2[0] + ox, p2[1] + oy); }
        continue;
      }
      heads.rect(hx - 0.55, hy - 0.55, 1.1, 1.1);
      drawn++;
      if (!tail) continue;
      let lx = hx, ly = hy;
      for (let k = 1; k <= K; k++) {
        at(i, eOf(i, clamp(T - tail * k)), p2);
        const nx = p2[0] + ox, ny = p2[1] + oy;
        paths[k - 1].moveTo(lx, ly); paths[k - 1].lineTo(nx, ny);
        lx = nx; ly = ny;
      }
    }
    ctx.lineWidth = 0.7;
    for (let k = 0; k < K; k++) { ctx.strokeStyle = ink((0.36 * (1 - k / K)).toFixed(3)); ctx.stroke(paths[k]); }
    ctx.fillStyle = ink(stride > 1 ? 0.62 : 0.5); ctx.fill(heads);
    ctx.strokeStyle = red(0.85); ctx.lineWidth = 1.2; ctx.stroke(redPaths);
    ctx.fillStyle = red(0.95);
    for (let i = 0; i < n; i++) if (RED[i]) { at(i, eOf(i, T), p); ctx.beginPath(); ctx.arc(p[0] + DX[i], p[1] + DY[i], 1.6, 0, TAU); ctx.fill(); }

    // The push circle at the mouse
    if (ps.k > 0.02) {
      ctx.setLineDash([2, 4]); ctx.strokeStyle = ink((0.22 * ps.k).toFixed(3)); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(ps.x, ps.y, Rg * 0.62, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // The resampling rings left by clicks
    for (let j = rings.length - 1; j >= 0; j--) {
      const r = rings[j], v = (t - r.t0) / 1400;
      if (v > 1) { rings.splice(j, 1); continue; }
      const rr = 6 + r.R * easeOut(v);
      ctx.strokeStyle = red((0.7 * (1 - v)).toFixed(3)); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, TAU); ctx.stroke();
    }
  }

  function click(x, y, t) {
    if (!G) return;
    const R = 0.42 * G.h, p = [0, 0];
    let count = 0;
    const c = Math.floor(t / CYCLE), u = t - c * CYCLE;
    const T = u < REST ? 0 : u < REST + GEN ? easeInOut((u - REST) / GEN) : u < REST + GEN + HOLD ? 1 : 1 - easeInOut((u - REST - GEN - HOLD) / BACK);
    for (let i = 0; i < n; i++) {
      at(i, clamp(T * (1 + STAGGER) - DEL[i]), p);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < R) { RS[i] = t + 160 * (d / R); count++; }
    }
    rings.push({ x, y, t0: t, R, count });
  }

  return stage(canvas, { frame, click, stillT: REST + GEN + 900 });
}
