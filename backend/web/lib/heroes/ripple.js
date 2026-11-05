// Header animation "Ripples": a water surface spread out in perspective, drawn as rows of thin lines (like that
// Joy Division album cover): the lines are dense in the distance and sparse up close.
//
// - Normally a few swells roll slowly in.
// - The mouse moving across the water leaves rings of small ripples along its path, like a finger drawn through water.
// - Click: like dropping in a pebble, a train of concentric ripples spreads out, and the stretch of line under a passing
//   crest turns red.
// - Ripples are computed in true perspective (screen points are first converted to coordinates on the water), so
//   distant rings are squashed into ellipses.
// - Rows are drawn from far to near, and each first fills a band below it with the background color, so nearer waves
//   hide the lines behind them.
import { stage, TAU, clamp, lerp } from "./kit.js";

const ZN = 1.6, ZF = 18;       // distance from the camera to the nearest and the farthest row (the camera is 1 unit above the water)
const WAVES = [                 // swells: direction (wave numbers in x and z), amplitude, speed
  [0.9, 3.4, 0.032, 0.0011], [-1.7, 2.6, 0.02, 0.0015], [2.6, 5.2, 0.011, 0.0021], [-0.6, 7.5, 0.006, 0.0026],
];

export const meta = { id: "ripple", name: "涟漪", hint: "透视里的一片水面，一行行细线；鼠标划过留下波纹；点一下丢进一颗石子，波峰泛红散开" };

export function mount(canvas) {
  let G = null;
  const packets = [];           // ripple rings: { x, z, t0, A, v, sig, k, life, red }
  const ps = { lx: 0, ly: 0, last: -1e9 };

  function layout(w, h) {
    const NX = clamp(Math.round(w / 5.5), 90, 280), NZ = clamp(Math.round(h / 5.2), 26, 70);
    const yH = 0.065 * h, F = (0.985 * h - yH) * ZN;
    const z = Float32Array.from({ length: NZ }, (_, j) => ZF * (ZN / ZF) ** (j / (NZ - 1)));   // logarithmically spaced, sparser closer in
    G = { w, h, NX, NZ, yH, F, z, ys: Float32Array.from(z, (zz) => yH + F / zz) };
  }
  // Point on the screen → coordinates on the water
  const toWater = (x, y) => { const z = G.F / Math.max(2, y - G.yH); return [((x - G.w / 2) * z) / G.F, z]; };
  function drop(x, y, t, big) {
    const [wx, wz] = toWater(x, y);
    if (wz > ZF * 1.2) return;
    packets.push(big ? { x: wx, z: wz, t0: t, A: 0.11, v: 0.0013, sig: 0.32, k: TAU / 0.42, life: 4200, red: true }
      : { x: wx, z: wz, t0: t, A: 0.018, v: 0.0009, sig: 0.12, k: TAU / 0.25, life: 1500, red: false });
    if (packets.length > 40) packets.splice(packets.findIndex((p) => !p.red) >= 0 ? packets.findIndex((p) => !p.red) : 0, 1);
  }

  function frame({ ctx, w, h, t, ptr, ink, red, paper, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    const { NX, NZ, z, ys, F } = G, tt = still ? 5200 : t;
    // The mouse moving across: drop a small ring of ripples every short distance
    if (ptr.inside && !still && ptr.y > G.yH + 4) {
      const d = Math.hypot(ptr.x - ps.lx, ptr.y - ps.ly);
      if (d > 14 && t - ps.last > 40) { drop(ptr.x, ptr.y, t, false); ps.lx = ptr.x; ps.ly = ptr.y; ps.last = t; }
    }
    for (let i = packets.length - 1; i >= 0; i--) if (t - packets[i].t0 > packets[i].life) packets.splice(i, 1);

    const X = new Float32Array(NX), Y = new Float32Array(NX), R = new Float32Array(NX);
    for (let i = 0; i < NX; i++) X[i] = (i / (NX - 1)) * w;
    ctx.lineJoin = "round";
    for (let j = 0; j < NZ; j++) {
      const zz = z[j], s = F / zz, near = j / (NZ - 1);
      // Which ripples can reach this row (filtered by depth first)
      const live = [];
      for (const p of packets) {
        const age = tt - p.t0, rad = p.v * age;
        if (age >= 0 && Math.abs(zz - p.z) <= rad + 3 * p.sig) live.push([p, rad, p.A * Math.exp(-age / (p.life * 0.45)) / Math.sqrt(1 + 2.5 * rad)]);
      }
      for (let i = 0; i < NX; i++) {
        const wx = ((X[i] - w / 2) * zz) / F;
        let hgt = 0, hot = 0;
        for (const [a, b, amp, v] of WAVES) hgt += amp * Math.sin(a * wx + b * zz - v * tt * (1 + 0.05 * a));
        for (const [p, rad, A] of live) {
          const d = Math.hypot(wx - p.x, zz - p.z) - rad;
          if (Math.abs(d) > 3 * p.sig) continue;
          const e = Math.exp((-d * d) / (2 * p.sig * p.sig)), v = A * e * Math.cos(p.k * d);
          hgt += v;
          if (p.red) hot = Math.max(hot, A * e);
        }
        Y[i] = ys[j] - hgt * s; R[i] = hot;
      }
      // Fill with the background color from this row down to a little below the next row, hiding the farther lines
      const below = j < NZ - 1 ? ys[j + 1] + 0.18 * (F / z[j + 1]) : h + 2;
      ctx.beginPath(); ctx.moveTo(X[0], Y[0]);
      for (let i = 1; i < NX; i++) ctx.lineTo(X[i], Y[i]);
      ctx.lineTo(w, Math.max(below, Y[NX - 1] + 2)); ctx.lineTo(0, Math.max(below, Y[0] + 2)); ctx.closePath();
      ctx.fillStyle = paper; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X[0], Y[0]);
      for (let i = 1; i < NX; i++) ctx.lineTo(X[i], Y[i]);
      ctx.strokeStyle = ink(lerp(0.13, 0.6, near ** 0.75).toFixed(3)); ctx.lineWidth = lerp(0.55, 1.1, near); ctx.stroke();
      // Turn red where a crest raised by a pebble passes
      let open = false, peak = 0;
      ctx.beginPath();
      for (let i = 0; i < NX; i++) {
        if (R[i] > 0.012) { if (!open) { ctx.moveTo(X[i], Y[i]); open = true; } else ctx.lineTo(X[i], Y[i]); peak = Math.max(peak, R[i]); }
        else open = false;
      }
      if (peak) { ctx.strokeStyle = red(clamp(0.35 + 7 * peak, 0, 0.95).toFixed(3)); ctx.lineWidth = lerp(0.7, 1.35, near); ctx.stroke(); }
    }
  }

  return stage(canvas, { frame, click: (x, y, t) => drop(x, y, t, true), stillT: 5200 });
}
