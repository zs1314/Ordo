// Header animation "Robot Arm Relay": a row of collaborative robot arms passing red cubes all the way from left to
// right.
//
// - A cube slides in from the left; the first arm picks it up from the table and carries it overhead to the next arm;
//   the last arm sets it down and the cube slides out to the right.
// - At a handover, the grippers of both arms hold the same cube, one from each side, pause briefly, and the earlier arm
//   lets go. The red dots ahead of a cube are its trajectory for the next few steps (an action chunk).
// - Pointer over the header animation: arms with empty hands reach toward it.
// - Click: the nearest arm with an empty hand reaches over and touches that spot.
// The schedule is a function of time (no state machine), so the whole row is already busy as soon as it appears, and
// nothing gets out of step after a pause.
import { stage, TAU, clamp, lerp, smooth, easeOut } from "./kit.js";

const P = 1400;   // One leg: ms to carry a cube from one handover point to the next
const M = 3.5;    // Spacing between consecutive cubes, in legs
const D = 0.2;    // Handover pause as a fraction of a leg (half before, half after)
const RET = 1.1;  // Length of the return trip, in legs
const easeIn = (v) => clamp(v) ** 3;
const bez = (a, b, c, d, v) => { const u = 1 - v; return u * u * u * a + 3 * u * u * v * b + 3 * u * v * v * c + v * v * v * d; };
const dir = (a) => [Math.cos(a), Math.sin(a)];
const lerpAngle = (a, b, t) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * t; };

export const meta = { id: "relay", name: "机械臂接力", hint: "一排机械臂把红方块一路传过去；鼠标过去，空着手的会伸过来够；点一下，最近的那台伸过去碰一下" };

export function mount(canvas) {
  let G = null, PAPER = "rgb(255, 255, 255)";
  const ps = { x: 0, y: 0, k: 0 };   // Smoothed pointer position and presence (k)
  let goal = null;                   // Target set by a click: { x, y, t0, arm, hit }
  const OFF = 40 * M * P;            // Shift schedule time forward so the row is full from the start

  function layout(w, h) {
    const sp0 = clamp(0.8 * h, 110, 260), N = Math.max(3, Math.round(w / sp0) - 1), sp = w / (N + 1);
    const Ty = h - Math.max(14, 0.13 * h), bh = 0.075 * h;
    return {
      w, h, N, sp, Ty, bh, bw: 0.17 * h, Sy: Ty - bh, c: 0.072 * h,
      L1: 0.36 * h, L2: 0.3 * h, L3: 0.11 * h,
      R1: 0.05 * h, R2: 0.041 * h, R3: 0.031 * h, R4: 0.022 * h,
      yH: Ty - 0.53 * h, yTop: Ty - 0.65 * h, xs: Array.from({ length: N }, (_, k) => (k + 1) * sp),
    };
  }

  // Pick-up point A and hand-off point B of arm k: [x, y, gripper direction]
  const A = (k) => (k === 0 ? [G.xs[0] - G.sp / 2, G.Ty - G.c / 2, Math.PI / 2] : [G.xs[k] - G.sp / 2, G.yH, Math.PI]);
  const B = (k) => (k === G.N - 1 ? [G.xs[k] + G.sp / 2, G.Ty - G.c / 2, Math.PI / 2] : [G.xs[k] + G.sp / 2, G.yH, 0]);
  // Carry: from A over the top to B; u ∈ [0, 1)
  function carryPose(k, u) {
    const [ax, ay, pa] = A(k), [bx, by, pb] = B(k), v = smooth((u - D / 2) / (1 - D));
    const c1x = k === 0 ? ax : G.xs[k] - 0.22 * G.sp, c1y = k === 0 ? ay - 0.45 * G.h : G.yTop;
    const c2x = k === G.N - 1 ? bx : G.xs[k] + 0.22 * G.sp, c2y = k === G.N - 1 ? by - 0.45 * G.h : G.yTop;
    return [bez(ax, c1x, c2x, bx, v), bez(ay, c1y, c2y, by, v), lerp(pa, pb, v)];
  }
  // Return: swing back low from B to A; r ∈ [0, M - 1)
  function returnPose(k, r) {
    const [ax, ay, pa] = A(k), [bx, by, pb] = B(k), v = smooth((r - D / 2) / RET), yl = G.Ty - 0.3 * G.h;
    const c1x = k === G.N - 1 ? bx : G.xs[k] + 0.2 * G.sp, c1y = k === G.N - 1 ? by - 0.4 * G.h : yl;
    const c2x = k === 0 ? ax : G.xs[k] - 0.2 * G.sp, c2y = k === 0 ? ay - 0.4 * G.h : yl;
    return [bez(bx, c1x, c2x, ax, v), bez(by, c1y, c2y, ay, v), lerp(pb, pa, v)];
  }
  // Gripper opening: 1 open, 0 closed
  function gripOf(qd) {
    if (qd < 1) return 0;
    const r = qd - 1, end = M - 1 - D / 2;
    if (r < D / 2) return smooth(r / (D / 2));
    if (r >= end) return 1 - smooth((r - end) / (0.42 * D));
    return 1 - 0.45 * smooth((r - D / 2 - RET) / 0.3) * smooth((end - 0.15 - r) / 0.3);
  }
  // Analytic inverse kinematics of the two links, with the gripper attached; takes the tool point (cube center)
  // and the gripper direction
  function ik(k, tx, ty, psi) {
    const Sx = G.xs[k], Sy = G.Sy, [cx, cy] = dir(psi);
    const wx = tx - cx * G.L3, wy = ty - cy * G.L3, dx = wx - Sx, dy = wy - Sy;
    const d = clamp(Math.hypot(dx, dy), Math.abs(G.L1 - G.L2) + 0.01, G.L1 + G.L2 - 0.01), phi = Math.atan2(dy, dx);
    // The elbow bends upward; the last arm flips it, otherwise its elbow would go through the table when it sets
    // the cube down to its lower right
    const hand = k === G.N - 1 ? -1 : 1;
    const a = Math.acos(clamp((G.L1 * G.L1 + d * d - G.L2 * G.L2) / (2 * G.L1 * d), -1, 1)), th1 = phi + hand * a;
    const ex = Sx + Math.cos(th1) * G.L1, ey = Sy + Math.sin(th1) * G.L1, Wx = Sx + Math.cos(phi) * d, Wy = Sy + Math.sin(phi) * d;
    return { S: [Sx, Sy], E: [ex, ey], W: [Wx, Wy], T: [Wx + cx * G.L3, Wy + cy * G.L3], psi };
  }
  // Point the gripper at (px, py) with the tool point stopping gap short of it, or reaching as far as it can when
  // out of range; the elbow must not drop below the shoulder
  function reachTo(k, px, py, gap) {
    const Sx = G.xs[k], Sy = G.Sy, reach = 0.94 * (G.L1 + G.L2 + G.L3);
    py = Math.min(py, G.Ty - 0.05 * G.h);
    for (let i = 0; ; i++) {
      const dx = px - Sx, dy = py - Sy, d = Math.hypot(dx, dy) || 1, psi = Math.atan2(dy, dx), dd = Math.min(d - gap, reach);
      const out = [Sx + (dx / d) * dd, Sy + (dy / d) * dd, psi];
      if (i >= 10 || ik(k, ...out).E[1] < Sy - 0.03 * G.h) return out;
      py -= 0.05 * G.h;
    }
  }
  const sOf = (j, tt) => tt / P - 1 - j * M;
  const phaseOf = (k, tt) => { const s0 = tt / P - 1 - k; return s0 - Math.floor(s0 / M) * M; };

  function armState(k, tt, t) {
    const qd = phaseOf(k, tt);
    let x, y, psi, carrying = false, idle = 0, avail = 0;
    if (qd < 1) { [x, y, psi] = carryPose(k, qd); carrying = true; }
    else {
      const r = qd - 1, r0 = D / 2 + RET, r1 = M - 1 - D / 2;
      [x, y, psi] = returnPose(k, r);
      avail = smooth((r - D / 2) / 0.2) * smooth((r1 - r) / 0.35);
      if (r > r0) {
        // While waiting for the next cube, back off a little and bob gently up and down
        idle = smooth((r - r0) / 0.3) * smooth((r1 - r) / 0.3);
        const [cx, cy] = dir(psi);
        x -= cx * 0.07 * G.h * idle; y -= (cy * 0.07 + 0.04) * G.h * idle - Math.sin(t * 0.003 + k * 1.7) * 0.012 * G.h * idle;
      }
    }
    let g = gripOf(qd);
    // An arm with an empty hand reaches for the pointer
    const near = Math.max(0, 1 - Math.abs(ps.x - G.xs[k]) / (1.3 * G.sp)), wP = avail * ps.k * smooth(near);
    if (wP > 0.001) {
      const [rx, ry, rp] = reachTo(k, ps.x, ps.y, 0.07 * G.h);
      x = lerp(x, rx, wP); y = lerp(y, ry, wP); psi = lerpAngle(psi, rp, wP); g = lerp(g, 1, wP);
    }
    // Target set by a click
    let wG = 0;
    if (goal && goal.arm === k) {
      const u = (t - goal.t0) / 1300;
      wG = smooth(u / 0.3) * smooth((1 - u) / 0.3) * avail;
      if (wG > 0.001) {
        const [rx, ry, rp] = reachTo(k, goal.x, goal.y, 0);
        x = lerp(x, rx, wG); y = lerp(y, ry, wG); psi = lerpAngle(psi, rp, wG);
        g = lerp(g, 0.2 + 0.8 * smooth(Math.abs(u - 0.5) / 0.2), wG);
      }
    }
    // Busy arms are drawn with darker lines, idle ones lighter
    const act = carrying ? 1 : Math.max(1 - smooth((qd - 1) / 0.4), smooth((qd - (M - 0.4)) / 0.4), wP, wG);
    return { k, ...ik(k, x, y, psi), g, carrying, qd, al: 0.5 + 0.38 * act };
  }

  // Where a cube is: on the conveyor, or held in some arm's gripper
  function cubeAt(s, arms) {
    const c = G.c, y0 = G.Ty - c / 2;
    if (s < 0) { const [ax] = A(0); return { x: lerp(-c, ax, easeOut((s + 1) / (1 - D / 2 - 0.08))), y: y0, rot: 0 }; }
    if (s < G.N) { const a = arms[Math.floor(s)]; return { x: a.T[0], y: a.T[1], rot: a.psi }; }
    const [bx] = B(G.N - 1), u = (s - G.N - D / 2 - 0.05) / (1 - D / 2 - 0.05);
    return { x: lerp(bx, G.w + c, easeIn(u)), y: y0, rot: 0 };
  }
  const plannedAt = (s) => (s < 0 || s >= G.N ? null : carryPose(Math.floor(s), s - Math.floor(s)));

  /* ---------- Drawing ---------- */
  function frame({ ctx, w, h, t, ptr, ink, red, paper }) {
    if (!G || G.w !== w || G.h !== h) G = layout(w, h);
    PAPER = paper;
    const tt = t + OFF;
    ps.x = ptr.sx; ps.y = ptr.sy; ps.k = ptr.k;
    const arms = G.xs.map((_, k) => armState(k, tt, t));
    const cubes = [];
    for (let j = Math.ceil((tt / P - 1 - (G.N + 1)) / M); j <= Math.floor(tt / P / M); j++) {
      const s = sOf(j, tt);
      if (s >= -1 && s < G.N + 1) cubes.push({ s, ...cubeAt(s, arms) });
    }

    // Table: one thin line
    ctx.strokeStyle = ink(0.26); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(G.Ty) + 0.5); ctx.lineTo(w, Math.round(G.Ty) + 0.5); ctx.stroke();
    for (const cb of cubes) {
      const hgt = clamp((G.Ty - cb.y - G.c / 2) / (0.75 * h)), half = (G.c / 2) * (1 - 0.4 * hgt);
      ctx.fillStyle = ink((0.16 * (1 - hgt)).toFixed(3)); ctx.fillRect(cb.x - half, G.Ty - 1.5, 2 * half, 1.5);
    }
    // Cubes being carried: the next few steps (red dots)
    for (const cb of cubes) {
      if (cb.s < 0 || cb.s >= G.N) continue;
      for (let i = 1; i <= 6; i++) {
        const p = plannedAt(cb.s + i * 0.05);
        if (!p) break;
        ctx.fillStyle = red((0.7 - i * 0.09).toFixed(3)); ctx.beginPath(); ctx.arc(p[0], p[1], 1.5 - i * 0.12, 0, TAU); ctx.fill();
      }
    }
    for (const a of arms) drawBody(ctx, a, ink);
    for (const cb of cubes) drawCube(ctx, cb, red);
    for (const a of arms) drawGripper(ctx, a, ink, a.carrying || cubes.some((cb) => Math.abs(cb.x - a.T[0]) < 2 && Math.abs(cb.y - a.T[1]) < 2));
    drawGoal(ctx, arms, t, red);
  }

  // The shape enclosed by the outer common tangents of two circles: a link that is thick at one end and thin at the other
  function hull(ctx, [x1, y1], r1, [x2, y2], r2) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), th = Math.acos(clamp((r1 - r2) / Math.max(d, 1e-3), -1, 1));
    ctx.beginPath(); ctx.arc(x1, y1, r1, a + th, a + TAU - th); ctx.arc(x2, y2, r2, a - th, a + th); ctx.closePath();
  }
  // Joint: an outer shell, a dark ring in the middle (like the black band on a cobot joint), and a small round cap
  function joint(ctx, [x, y], R, ink, al) {
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = ink(al.toFixed(3)); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, R * 0.74, 0, TAU); ctx.arc(x, y, R * 0.48, 0, TAU, true); ctx.fillStyle = ink((al * 0.92).toFixed(3)); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 0.9, 0, TAU); ctx.fillStyle = ink((al * 0.7).toFixed(3)); ctx.fill();
  }
  function drawBody(ctx, a, ink) {
    const { S, E, W, psi, al } = a, x = S[0], Ty = G.Ty, bw = G.bw, bh = G.bh, rr = bh * 0.4;
    ctx.lineWidth = 1.1; ctx.lineJoin = "round";
    // A faint shadow on the table
    ctx.beginPath(); ctx.ellipse(x, Ty, bw * 0.62, Math.max(1.5, 0.012 * G.h), 0, 0, TAU); ctx.fillStyle = ink((al * 0.08).toFixed(3)); ctx.fill();
    // Base: a low, rounded plinth with a dark flange on top
    ctx.beginPath(); ctx.moveTo(x - bw / 2, Ty); ctx.lineTo(x - bw / 2, Ty - bh + rr); ctx.arcTo(x - bw / 2, Ty - bh, x - bw / 2 + rr, Ty - bh, rr);
    ctx.lineTo(x + bw / 2 - rr, Ty - bh); ctx.arcTo(x + bw / 2, Ty - bh, x + bw / 2, Ty - bh + rr, rr); ctx.lineTo(x + bw / 2, Ty);
    ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = ink(al.toFixed(3)); ctx.stroke();
    ctx.fillStyle = ink((al * 0.9).toFixed(3)); ctx.beginPath(); ctx.roundRect?.(x - bw * 0.36, Ty - bh - 1, bw * 0.72, Math.max(2, bh * 0.24), 1.5); ctx.fill();
    // Three links, from thick to thin; each is filled with the background color before it is outlined, so a link
    // in front hides the one behind it; a thin highlight line runs along the upper edge
    const [cx, cy] = dir(psi), F = [W[0] + cx * (G.L3 - 0.55 * G.c - 0.042 * G.h), W[1] + cy * (G.L3 - 0.55 * G.c - 0.042 * G.h)];
    for (const [p, r1, q, r2] of [[S, G.R1, E, G.R2], [E, G.R2 * 0.9, W, G.R3], [W, G.R3 * 0.86, F, G.R4]]) {
      hull(ctx, p, r1, q, r2); ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = ink(al.toFixed(3)); ctx.stroke();
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      let nx = -uy, ny = ux; if (ny > 0) { nx = -nx; ny = -ny; }
      ctx.strokeStyle = ink((al * 0.22).toFixed(3)); ctx.lineWidth = 0.8; ctx.beginPath();
      ctx.moveTo(p[0] + ux * r1 * 1.1 + nx * r1 * 0.5, p[1] + uy * r1 * 1.1 + ny * r1 * 0.5); ctx.lineTo(q[0] - ux * r2 * 1.1 + nx * r2 * 0.5, q[1] - uy * r2 * 1.1 + ny * r2 * 0.5); ctx.stroke();
      ctx.lineWidth = 1.1;
    }
    joint(ctx, S, G.R1, ink, al); joint(ctx, E, G.R2, ink, al); joint(ctx, W, G.R3, ink, al);
    a.F = F;
  }
  // Gripper: a rounded palm and two long, thin fingers with dark pads on the inside of the tips; when holding a
  // cube, the fingers rest against it
  function drawGripper(ctx, a, ink, holding) {
    const [cx, cy] = dir(a.psi), nx = -cy, ny = cx, T = a.T, c = G.c, al = a.al, F = a.F;
    const sep = holding ? c * (1 + 0.55 * a.g) : c * (0.45 + 1.1 * a.g), fw = Math.max(1.8, 0.015 * G.h), pd = 0.042 * G.h;
    const half = sep / 2 + fw + 0.006 * G.h;
    ctx.lineWidth = 1.1;
    ctx.save(); ctx.translate(F[0], F[1]); ctx.rotate(a.psi);
    // Palm: pd deep along the gripper direction, 2*half wide across it
    ctx.beginPath(); ctx.roundRect?.(0, -half, pd, 2 * half, Math.min(3, pd * 0.3)); ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = ink(al.toFixed(3)); ctx.stroke();
    ctx.fillStyle = ink((al * 0.9).toFixed(3)); ctx.fillRect(0, -half * 0.55, Math.max(1.6, pd * 0.16), half * 1.1);
    // The two fingers
    const len = Math.hypot(T[0] - F[0], T[1] - F[1]) + 0.14 * c - pd;
    for (const sg of [-1, 1]) {
      const y0 = sg * (sep / 2 + fw / 2);
      ctx.beginPath(); ctx.roundRect?.(pd - 1, y0 - fw / 2, len + 1, fw, fw / 2); ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = ink(al.toFixed(3)); ctx.stroke();
      ctx.fillStyle = ink((al * 0.85).toFixed(3)); ctx.fillRect(pd + len - 0.5 * c, sg > 0 ? y0 - fw / 2 - 0.2 : y0 + fw / 2 - 1.4, 0.42 * c, 1.6);
    }
    ctx.restore();
  }
  function drawCube(ctx, cb, red) {
    const c = G.c, r = Math.max(1.2, c * 0.12);
    ctx.save(); ctx.translate(cb.x, cb.y); ctx.rotate(cb.rot);
    ctx.beginPath(); ctx.roundRect(-c / 2, -c / 2, c, c, r); ctx.fillStyle = red(0.88); ctx.fill();
    ctx.restore();
  }
  // Target set by a click: a red circle that sends out a ripple when the arm touches it
  function drawGoal(ctx, arms, t, red) {
    if (!goal) return;
    const u = (t - goal.t0) / 1600;
    if (u > 1 || u < -0.1) { goal = null; return; }
    const a = arms[goal.arm];
    if (!goal.hit && Math.hypot(a.T[0] - goal.x, a.T[1] - goal.y) < 7) goal.hit = t;
    const al = Math.min(1, Math.max(0, u) / 0.08) * (1 - smooth((u - 0.75) / 0.25));
    ctx.strokeStyle = red((0.9 * al).toFixed(3)); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(goal.x, goal.y, 4.5, 0, TAU); ctx.stroke();
    for (const t0 of [goal.t0, goal.hit].filter(Boolean)) {
      const v = clamp((t - t0) / 650);
      if (v < 1) { ctx.strokeStyle = red((0.55 * (1 - v)).toFixed(3)); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(goal.x, goal.y, 4.5 + 18 * easeOut(v), 0, TAU); ctx.stroke(); }
    }
  }

  function click(x, y, t) {
    if (!G) return;
    const tt = t + OFF;
    // Pick the nearest of the arms whose hand is empty and that will stay free for a while
    let best = -1, bd = Infinity;
    G.xs.forEach((ax, k) => {
      const r = phaseOf(k, tt) - 1, free = r > D / 2 && r < M - 1 - D / 2 - 1.0, dd = Math.abs(ax - x);
      if (free && dd < bd) { bd = dd; best = k; }
    });
    if (best < 0) best = G.xs.reduce((b, ax, k) => (Math.abs(ax - x) < Math.abs(G.xs[b] - x) ? k : b), 0);
    goal = { x, y: Math.min(y, G.Ty - 0.05 * G.h), t0: t, arm: best, hit: 0 };
  }

  return stage(canvas, { frame, click, stillT: 2.35 * P });
}
