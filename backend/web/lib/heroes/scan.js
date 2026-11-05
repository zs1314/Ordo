// Header animation "Point Cloud Scan": a few objects on a table (mug, box, ball, bowl, bottle, cube) drawn as a point
// cloud, with a red laser plane sweeping from left to right.
//
// - Points light up as the plane passes and then slowly dim; once the plane has swept past an object, the object gets a
//   3D bounding box (only its eight corners are drawn).
// - Only points on surfaces facing the camera are kept, and the table is left empty where objects block it (shadows),
//   the way a real depth camera would capture it.
// - A red gripper hovers above the object "to be grasped".
// - Pointer: the view turns a little to follow it; the object nearest to the pointer is highlighted and its bounding
//   box is drawn in full.
// - Click: the clicked object becomes the one to grasp, and the gripper moves over to it.
import { stage, TAU, clamp, lerp, smooth, damp, rng, gauss } from "./kit.js";

const SWEEP = 4800, PAUSE = 1500, PERIOD = SWEEP + PAUSE, X0 = -5.7, X1 = 5.7;
const CAM = { dist: 7.6, ty: 0.3, pitch: 0.3 };

// Objects: name, position, shape parameters (one unit is about 0.14 m)
const OBJS = [
  { name: "mug", kind: "mug", x: -3.55, z: 0.15, r: 0.43, h: 0.8 },
  { name: "box", kind: "box", x: -1.8, z: -0.15, sx: 0.92, sy: 0.6, sz: 0.64, rot: 0.42 },
  { name: "ball", kind: "ball", x: -0.15, z: 0.3, r: 0.42 },
  { name: "bowl", kind: "bowl", x: 1.55, z: -0.1, r: 0.64 },
  { name: "bottle", kind: "bottle", x: 3.2, z: 0.22, r: 0.22, h: 1.02 },
  { name: "cube", kind: "box", x: 4.5, z: -0.25, sx: 0.44, sy: 0.44, sz: 0.44, rot: -0.3 },
];

function build() {
  const r = rng(77), P = [], O = [], C0 = [Math.sin(0) * Math.cos(CAM.pitch) * CAM.dist, CAM.ty + Math.sin(CAM.pitch) * CAM.dist, Math.cos(0) * Math.cos(CAM.pitch) * CAM.dist];
  // Keep only points on surfaces facing the camera
  const add = (x, y, z, nx, ny, nz, o) => {
    const vx = C0[0] - x, vy = C0[1] - y, vz = C0[2] - z, l = Math.hypot(vx, vy, vz);
    if ((nx * vx + ny * vy + nz * vz) / l < 0.06) return;
    P.push(x + 0.004 * gauss(r), y + 0.004 * gauss(r), z + 0.004 * gauss(r)); O.push(o);
  };
  const DENS = 1150;
  OBJS.forEach((ob, o) => {
    const { x, z } = ob;
    const cyl = (rad, y0, y1, n) => { for (let i = 0; i < n; i++) { const a = TAU * r(), y = lerp(y0, y1, r()); add(x + rad * Math.cos(a), y, z + rad * Math.sin(a), Math.cos(a), 0, Math.sin(a), o); } };
    const disk = (rad, y, n, ny = 1) => { for (let i = 0; i < n; i++) { const a = TAU * r(), q = rad * Math.sqrt(r()); add(x + q * Math.cos(a), y, z + q * Math.sin(a), 0, ny, 0, o); } };
    if (ob.kind === "mug") {
      cyl(ob.r, 0, ob.h, Math.round(TAU * ob.r * ob.h * DENS));
      // Rim: the inner wall near the top is visible too
      for (let i = 0; i < 420; i++) { const a = TAU * r(), y = ob.h - 0.3 * r(); P.push(x + 0.92 * ob.r * Math.cos(a), y, z + 0.92 * ob.r * Math.sin(a)); O.push(o); }
      // Handle: half a torus
      for (let i = 0; i < 520; i++) {
        const th = Math.PI * (r() - 0.5), ph = TAU * r(), R = 0.22, rm = 0.06, cx = x + ob.r + 0.02, cy = ob.h * 0.52;
        const px = cx + Math.cos(th) * (R + rm * Math.cos(ph)), py = cy + Math.sin(th) * (R + rm * Math.cos(ph)), pz = z + rm * Math.sin(ph);
        add(px, py, pz, Math.cos(th) * Math.cos(ph), Math.sin(th) * Math.cos(ph), Math.sin(ph), o);
      }
      ob.bb = [x - ob.r, 0, z - ob.r, x + ob.r + 0.3, ob.h, z + ob.r];
    } else if (ob.kind === "box") {
      const { sx, sy, sz, rot } = ob, cs = Math.cos(rot), sn = Math.sin(rot), faces = [[sx * sz, 0], [sx * sy, 1], [sx * sy, 2], [sz * sy, 3], [sz * sy, 4]];
      const tot = faces.reduce((a, f) => a + f[0], 0), n = Math.round(tot * DENS);
      for (let i = 0; i < n; i++) {
        let u = r() * tot, f = 0;
        while (u > faces[f][0]) { u -= faces[f][0]; f++; }
        let lx, ly, lz, nx = 0, ny = 0, nz = 0;
        const a = r() - 0.5, b = r() - 0.5;
        if (f === 0) { lx = a * sx; lz = b * sz; ly = sy; ny = 1; }
        else if (f < 3) { lx = a * sx; ly = (b + 0.5) * sy; lz = (f === 1 ? 0.5 : -0.5) * sz; nz = f === 1 ? 1 : -1; }
        else { lz = a * sz; ly = (b + 0.5) * sy; lx = (f === 3 ? 0.5 : -0.5) * sx; nx = f === 3 ? 1 : -1; }
        add(x + lx * cs - lz * sn, ly, z + lx * sn + lz * cs, nx * cs - nz * sn, ny, nx * sn + nz * cs, o);
      }
      const ex = (Math.abs(cs) * sx + Math.abs(sn) * sz) / 2, ez = (Math.abs(sn) * sx + Math.abs(cs) * sz) / 2;
      ob.bb = [x - ex, 0, z - ez, x + ex, sy, z + ez];
    } else if (ob.kind === "ball") {
      for (let i = 0, n = Math.round(4 * Math.PI * ob.r * ob.r * DENS); i < n; i++) {
        const gx = gauss(r), gy = gauss(r), gz = gauss(r), l = Math.hypot(gx, gy, gz) || 1;
        add(x + (ob.r * gx) / l, ob.r + (ob.r * gy) / l, z + (ob.r * gz) / l, gx / l, gy / l, gz / l, o);
      }
      ob.bb = [x - ob.r, 0, z - ob.r, x + ob.r, 2 * ob.r, z + ob.r];
    } else if (ob.kind === "bowl") {
      // Lower half of a spherical shell, flattened at the bottom
      const cy = ob.r * 0.82;
      for (let i = 0, n = Math.round(2 * Math.PI * ob.r * ob.r * DENS); i < n; i++) {
        const gx = gauss(r), gy = -Math.abs(gauss(r)), gz = gauss(r), l = Math.hypot(gx, gy, gz) || 1, py = cy + (ob.r * gy) / l;
        if (py < 0.02) continue;
        add(x + (ob.r * gx) / l, py, z + (ob.r * gz) / l, gx / l, gy / l, gz / l, o);
        if (r() < 0.5) { P.push(x + (0.95 * ob.r * gx) / l, py, z + (0.95 * ob.r * gz) / l); O.push(o); } // Inside of the bowl
      }
      for (let i = 0; i < 220; i++) { const a = TAU * r(); P.push(x + ob.r * Math.cos(a), cy, z + ob.r * Math.sin(a)); O.push(o); }
      ob.bb = [x - ob.r, 0, z - ob.r, x + ob.r, cy, z + ob.r];
    } else {
      // Bottle: body, shoulder, neck
      cyl(ob.r, 0, ob.h * 0.72, Math.round(TAU * ob.r * ob.h * 0.72 * DENS));
      for (let i = 0; i < 420; i++) {
        const u = r(), a = TAU * r(), rad = lerp(ob.r, 0.085, u), y = ob.h * (0.72 + 0.14 * u);
        add(x + rad * Math.cos(a), y, z + rad * Math.sin(a), Math.cos(a), 0.6, Math.sin(a), o);
      }
      for (let i = 0; i < 220; i++) { const a = TAU * r(), y = ob.h * (0.86 + 0.14 * r()); add(x + 0.085 * Math.cos(a), y, z + 0.085 * Math.sin(a), Math.cos(a), 0, Math.sin(a), o); }
      ob.bb = [x - ob.r, 0, z - ob.r, x + ob.r, ob.h, z + ob.r];
    }
  });
  // Table: a grid with a little jitter; no points where objects block the view (shadows)
  const blocked = (px, pz) => OBJS.some((ob) => {
    const [x0, y0, z0, x1, y1, z1] = ob.bb, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rad = Math.max(x1 - x0, z1 - z0) / 2;
    // Looking from this point on the table toward the camera: does the line of sight pass through the object
    // while it is still below the object's height?
    const dx = C0[0] - px, dy = C0[1], dz = C0[2] - pz, tMax = y1 / dy;
    for (let k = 0; k <= 6; k++) { const tt = (k / 6) * tMax, qx = px + dx * tt, qz = pz + dz * tt; if (Math.hypot(qx - cx, qz - cz) < rad * 0.95) return true; }
    return false;
  });
  for (let gx = -5.3; gx <= 5.3; gx += 0.09) for (let gz = -1.2; gz <= 1.2; gz += 0.09) {
    const px = gx + 0.035 * gauss(r), pz = gz + 0.035 * gauss(r);
    if (!blocked(px, pz)) { P.push(px, 0, pz); O.push(-1); }
  }
  return { P: Float32Array.from(P), O: Int8Array.from(O), S: new Float32Array(O.length).fill(-1e9), n: O.length };
}

export const meta = { id: "scan", name: "点云扫描", hint: "激光面扫过桌上的点云，框出认出来的东西；鼠标转视角；点一下，夹爪换一样去抓" };

export function mount(canvas) {
  const cloud = build();
  const ps = { x: 0, y: 0, k: 0 };
  let cam = { yaw: 0, pitch: CAM.pitch }, lastXs = X0, sweep = 0;
  const det = OBJS.map(() => -1e9);
  const centers = OBJS.map(() => [-1e4, -1e4]);
  // Gripper: its position follows the target on a critically damped spring, so switching targets, even midway,
  // stays continuous
  let tgt = 0, clickRing = null;
  const gp = { x: OBJS[0].x, y: OBJS[0].bb[4] + 0.46, z: OBJS[0].z, vx: 0, vy: 0, vz: 0 };

  function frame({ ctx, w, h, t, dt, q, ptr, ink, red, still }) {
    ps.x = ptr.sx; ps.y = ptr.sy; ps.k = ptr.k;
    // View: sways slowly from side to side, and follows the pointer while it is over the canvas
    const yawT = lerp(0.1 * Math.sin(t * 0.00011), 0.22 * (ps.x / w - 0.5) * 2, ps.k), pitchT = CAM.pitch + lerp(0.02 * Math.sin(t * 0.00007), 0.08 * (ps.y / h - 0.5) * 2, ps.k);
    if (still) { cam.yaw = yawT; cam.pitch = pitchT; } else { cam.yaw += (yawT - cam.yaw) * damp(dt, 260); cam.pitch += (pitchT - cam.pitch) * damp(dt, 260); }
    const cp = Math.cos(cam.pitch), C = [Math.sin(cam.yaw) * cp * CAM.dist, CAM.ty + Math.sin(cam.pitch) * CAM.dist, Math.cos(cam.yaw) * cp * CAM.dist];
    let fx = -C[0], fy = CAM.ty - C[1], fz = -C[2]; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    // On narrow screens, crop the sides rather than shrink the objects too much
    const F = Math.max(Math.min(0.74 * w, 3.1 * h), 1.9 * h), cx = w / 2, cy = h * 0.6;
    const proj = (x, y, z, out) => { const dx = x - C[0], dy = y - C[1], dz = z - C[2], zc = dx * fx + dy * fy + dz * fz; out[0] = cx + (F * (dx * rx + dz * rz)) / zc; out[1] = cy - (F * (dx * ux + dy * uy + dz * uz)) / zc; out[2] = zc; return out; };

    // Position of the laser plane
    const tc = still ? 0.62 * SWEEP : t, ph = tc % PERIOD, sw = Math.floor(tc / PERIOD), xs = ph < SWEEP ? lerp(X0, X1, ph / SWEEP) : X1 + 1;
    if (sw !== sweep) { sweep = sw; lastXs = X0; }
    // An object counts as "detected" once the plane has swept past it
    OBJS.forEach((ob, o) => { if (lastXs < ob.bb[3] && xs >= ob.bb[3]) det[o] = tc; if (still && xs >= ob.bb[3]) det[o] = tc - 400; });
    const lo = Math.min(lastXs, xs) - 0.03, hi = Math.max(lastXs, xs) + 0.03;
    lastXs = xs;

    // The object nearest to the pointer
    const tmp = [0, 0, 0];
    OBJS.forEach((ob, o) => { const [x0, y0, z0, x1, y1, z1] = ob.bb; proj((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, tmp); centers[o][0] = tmp[0]; centers[o][1] = tmp[1]; });
    let hov = -1;
    if (ps.k > 0.3) {
      let bd = 90;
      centers.forEach(([x, y], o) => { const d = Math.hypot(x - ps.x, y - ps.y); if (d < bd) { bd = d; hov = o; } });
    }

    // Points: grouped into a few brightness levels, each level filled in one call
    const { P, O, S, n } = cloud, B = 7, paths = Array.from({ length: B }, () => new Path2D()), hits = new Path2D(), p = [0, 0, 0], stride = q === 0 ? 1 : q === 1 ? 2 : 3;
    for (let i = 0; i < n; i += stride) {
      const x = P[3 * i];
      if (!still && x >= lo && x <= hi) S[i] = tc;
      if (still && x < xs) S[i] = tc - (xs - x) * 600;
      proj(x, P[3 * i + 1], P[3 * i + 2], p);
      if (p[2] < 0.5 || p[0] < -2 || p[0] > w + 2 || p[1] < -2 || p[1] > h + 2) continue;
      const age = tc - S[i], o = O[i], s = clamp((F * 0.0105) / p[2], 1, 2.1) * (o < 0 ? 0.8 : 1);
      if (age < 90) { hits.rect(p[0] - s * 0.65, p[1] - s * 0.65, s * 1.3, s * 1.3); continue; }
      const fresh = Math.exp(-age / 2600), base = o < 0 ? 0.3 : o === hov ? 1 : 0.88, al = base * (0.32 + 0.68 * fresh) * clamp(1.25 - (p[2] - 6) * 0.12, 0.6, 1.1);
      paths[clamp(Math.floor(al * B), 0, B - 1)].rect(p[0] - s / 2, p[1] - s / 2, s, s);
    }
    for (let b = 0; b < B; b++) { ctx.fillStyle = ink(((b + 0.5) / B).toFixed(3)); ctx.fill(paths[b]); }

    // Laser plane
    if (xs <= X1) {
      const c = [[xs, 0, -1.2], [xs, 0, 1.2], [xs, 1.15, 1.2], [xs, 1.15, -1.2]].map(([x, y, z]) => proj(x, y, z, [0, 0, 0]));
      ctx.beginPath(); c.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = red(0.035); ctx.fill(); ctx.strokeStyle = red(0.22); ctx.lineWidth = 0.8; ctx.stroke();
    }
    ctx.fillStyle = red(0.95); ctx.fill(hits);

    // Detected objects: bounding boxes show only the eight corners (like the corner brackets in the Mesh header
    // animation, argus.js); the object under the pointer gets the full box, and its points are darker
    OBJS.forEach((ob, o) => {
      const age = tc - det[o];
      if (age < 0 || det[o] < -1e8) return;
      const al = (o === hov ? 1 : 0.55 + 0.45 * Math.exp(-age / 3200)) * smooth(age / 250), [x0, y0, z0, x1, y1, z1] = ob.bb;
      const V = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]].map(([x, y, z]) => proj(x, y, z, [0, 0, 0]));
      const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      ctx.lineWidth = o === hov ? 1.1 : 1; ctx.strokeStyle = ink(((o === hov ? 0.7 : 0.55) * al).toFixed(3)); ctx.beginPath();
      for (const [a, b] of E) {
        const k = o === hov ? 0.5 : 0.2;
        ctx.moveTo(V[a][0], V[a][1]); ctx.lineTo(lerp(V[a][0], V[b][0], k), lerp(V[a][1], V[b][1], k));
        ctx.moveTo(V[b][0], V[b][1]); ctx.lineTo(lerp(V[b][0], V[a][0], k), lerp(V[b][1], V[a][1], k));
      }
      ctx.stroke();
    });

    // Gripper: hovers above the object to grasp, rises a little while still far from it, and bobs slowly up and down
    const ob = OBJS[tgt], top = ob.bb[4], tx = ob.x, tz = ob.z, far = clamp(Math.abs(gp.x - tx) / 1.6);
    // Keep 14px clear at the top: bisect for the highest point the gripper can reach (continuous, no jumps in steps)
    const topOK = (y) => proj(gp.x, y + 0.22, gp.z, tmp)[1] >= 14;
    let yLo = top + 0.2, yHi = top + 1.4;
    if (!topOK(yHi)) { for (let k = 0; k < 12; k++) { const mid = (yLo + yHi) / 2; if (topOK(mid)) yLo = mid; else yHi = mid; } yHi = yLo; }
    const ty = Math.min(top + 0.46 + 0.42 * far, yHi);
    if (still) { gp.x = tx; gp.y = ty; gp.z = tz; gp.vx = gp.vy = gp.vz = 0; }
    else {
      const n = Math.max(1, Math.ceil(dt / 16)), h1 = dt / 1000 / n;
      for (let i = 0; i < n; i++) for (const [k, v, T, w0] of [["x", "vx", tx, 5.2], ["y", "vy", ty, 6.5], ["z", "vz", tz, 5.2]]) {
        gp[v] += (w0 * w0 * (T - gp[k]) - 2 * w0 * gp[v]) * h1; gp[k] += gp[v] * h1;
      }
    }
    const gx = gp.x, gz = gp.z, gy = gp.y + 0.05 * Math.sin(t * 0.0018), speed = Math.hypot(gp.vx, gp.vz);
    const open = 0.24 + 0.07 * clamp(speed / 2.5) + 0.025 * Math.sin(t * 0.0018);
    const seg3 = (a, b) => { proj(...a, tmp); ctx.moveTo(tmp[0], tmp[1]); proj(...b, tmp); ctx.lineTo(tmp[0], tmp[1]); };
    ctx.strokeStyle = red(0.9); ctx.lineWidth = 1.3; ctx.beginPath();
    seg3([gx - open, gy, gz], [gx + open, gy, gz]);
    seg3([gx - open, gy, gz], [gx - open, gy - 0.24, gz]); seg3([gx + open, gy, gz], [gx + open, gy - 0.24, gz]);
    seg3([gx, gy, gz], [gx, gy + 0.2, gz]);
    ctx.stroke();
    // Draw the dashed line downward only once the gripper is lined up
    const aim = 1 - clamp(Math.hypot(gx - tx, gz - tz) / 0.35);
    if (aim > 0.01) { ctx.setLineDash([2, 3]); ctx.lineWidth = 0.8; ctx.strokeStyle = red((0.55 * aim).toFixed(3)); ctx.beginPath(); seg3([gx, gy - 0.05, gz], [gx, top + 0.02, gz]); ctx.stroke(); ctx.setLineDash([]); }
    if (clickRing) {
      const v = (t - clickRing.t0) / 700;
      if (v > 1) clickRing = null;
      else { ctx.strokeStyle = red((0.6 * (1 - v)).toFixed(3)); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(clickRing.x, clickRing.y, 5 + 20 * v, 0, TAU); ctx.stroke(); }
    }
  }

  function click(x, y, t) {
    // Grasp whichever object was clicked (the one with the nearest projected center)
    let best = -1, bd = 140;
    centers.forEach(([cx, cy], o) => { const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = o; } });
    clickRing = { x, y, t0: t };
    if (best >= 0) tgt = best;
  }

  return stage(canvas, { frame, click, stillT: 0.62 * SWEEP });
}
