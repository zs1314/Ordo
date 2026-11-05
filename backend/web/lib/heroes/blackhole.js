// Header animation "Event Horizon": a black hole with its accretion disk seen almost edge-on. Gravity bends the light: the
// far side of the disk, which ought to be hidden behind the hole, is bent up over its top and down under its bottom into two
// arches, while the near side cuts across in front of it. Matter on the disk circles in wisps, fast on the inner orbits and
// slow on the outer ones, brighter on the side that moves toward the viewer. The hole itself is nothing at all, just a
// void surrounded by a very thin ring of light. Background stars passing near it are stretched into two images that slide
// around it.
//
// - Only thin lines are drawn: each wisp of matter is a short arc projected onto the page with real light bending
//   (Beloborodov's approximation); both the primary image and the secondary image that goes around the other side are drawn.
// - A red hot spot orbits right at the innermost orbit and brightens as it comes round to the approaching side.
// - Mouse: up and down changes the inclination, left and right turns the view slightly; the background stars slide along.
// - Click: drops a clump of red matter there; it is torn into an arc, spirals inward turn by turn, and finally vanishes
//   at the innermost orbit.
import { stage, TAU, clamp, lerp, smooth, rng } from "./kit.js";

export const meta = { id: "blackhole", name: "视界", hint: "侧着看的黑洞：盘的远端被光弯到头顶和脚下，物质一缕缕绕着转；鼠标改变倾角；点一下放一团物质，看它被撕开、旋进去" };

const BC = 3 * Math.sqrt(3);    // critical impact parameter of the photon sphere (in units of M)
const RIN = 6, ROUT = 96;       // inner and outer disk radius (the innermost stable circular orbit is 6M); the outer edge runs off the canvas
const OMEGA = 15.4;             // angular velocity = OMEGA * r^-1.5 (radians per second): the innermost orbit takes six seconds per turn

// Where a point (r, φ) of the disk appears on the sky; φ = 0 faces the observer. Returns the coordinates and the Doppler
// brightness of the primary image (img=0) or of the secondary image that goes around the other side (img=1)
function image(r, phi, sinI, cosI, img, out) {
  const cp = Math.cos(phi), sp = Math.sin(phi), cpsi = cp * sinI, k = 1 - 2 / r;
  let b;
  if (img === 0) { const ca = 1 - (1 - cpsi) * k; b = (r * Math.sqrt(Math.max(0, 1 - ca * ca))) / Math.sqrt(k); }
  else {
    // Secondary image: the light goes around the other side, bent by 2π - ψ; the closer that is to a full turn, the
    // closer the image hugs the photon sphere
    const psi2 = TAU - Math.acos(clamp(cpsi, -1, 1)), bPi = (r * Math.sqrt(1 - (1 - 2 * k) ** 2)) / Math.sqrt(k);
    b = BC + 0.5 * (bPi - BC) * Math.exp(-(psi2 - Math.PI) * 1.6);
  }
  const dx = sp, dy = cp * cosI, n = Math.hypot(dx, dy) || 1e-6, sgn = img === 0 ? 1 : -1;
  out[0] = (sgn * b * dx) / n; out[1] = (sgn * b * dy) / n;
  out[2] = clamp(1 + 1.7 * -sp * sinI * Math.sqrt(1 / r), 0.2, 2.4);   // the approaching side is brighter
  return out;
}

export function mount(canvas) {
  let G = null;
  const view = { inc: 1.43, roll: 0, shift: 0 };
  const clumps = [];

  function layout(w, h) {
    const r = rng(5), streaks = [], stars = [];
    for (let i = 0; i < 900; i++) {
      const rr = RIN + (ROUT - RIN) * r() ** 1.9;   // denser toward the inside
      streaks.push({ r: rr, p0: r() * TAU, len: (0.12 + 0.4 * r()) * Math.min(1, 14 / rr + 0.25), a: 0.5 + 0.5 * r() });
    }
    for (let i = 0; i < 380; i++) stars.push({ x: (r() - 0.5) * 2.4, y: (r() - 0.5) * 2.4, s: r() });
    G = { w, h, streaks, stars, s: h / 31 };
  }

  function frame({ ctx, w, h, t, dt, ptr, ink, red, paper, still }) {
    if (!G || G.w !== w || G.h !== h) layout(w, h);
    const tt = still ? 20000 : t, sec = tt / 1000;
    // View: moving the mouse up and down changes the inclination, left and right turns it a little; otherwise it sways
    // very slowly on its own
    const incT = lerp(1.43 + 0.03 * Math.sin(sec * 0.07), 1.25 + 0.3 * clamp(1 - ptr.sy / h), ptr.k), rollT = lerp(0.04 * Math.sin(sec * 0.05), 0.16 * (ptr.sx / w - 0.5), ptr.k);
    const sm = still ? 1 : 1 - Math.exp(-dt / 500);
    view.inc += (incT - view.inc) * sm; view.roll += (rollT - view.roll) * sm;
    view.shift = sec * 0.012 + view.roll * 2;
    const sinI = Math.sin(view.inc), cosI = Math.cos(view.inc), cr = Math.cos(view.roll), sr = Math.sin(view.roll);
    const S = G.s, cx = w / 2, cy = h / 2, o = [0, 0, 0];
    const toScr = (X, Y, out) => { out[0] = cx + (X * cr - Y * sr) * S; out[1] = cy + (X * sr + Y * cr) * S; return out; };

    // Background stars: point-mass lensing, two images per star (the outer one bright, the inner one faint); images that
    // fall into the shadow are not drawn
    const thE = 9, starP = [new Path2D(), new Path2D()], q = [0, 0];
    for (const st of G.stars) {
      // Stars drift slowly to one side (as if the observer were walking around the hole); those that drift off come back
      // from the other side
      const span = w / S, by = st.y * (h / S / 2);
      let bx = st.x * span + view.shift * 6;
      bx = (((bx + span) % (2 * span)) + 2 * span) % (2 * span) - span;
      const beta = Math.hypot(bx, by) + 1e-6, root = Math.sqrt(beta * beta + 4 * thE * thE);
      for (const [k, th] of [[0, (beta + root) / 2], [1, (beta - root) / 2]]) {
        if (Math.abs(th) < BC * 1.05) continue;
        toScr((bx / beta) * th, (by / beta) * th, q);
        if (q[0] < -2 || q[0] > w + 2 || q[1] < -2 || q[1] > h + 2) continue;
        const sz = k ? 0.5 : 0.45 + 0.5 * st.s;
        starP[k].moveTo(q[0] + sz, q[1]); starP[k].arc(q[0], q[1], sz, 0, TAU);
      }
    }
    ctx.fillStyle = ink(0.32); ctx.fill(starP[0]); ctx.fillStyle = ink(0.16); ctx.fill(starP[1]);

    // Shadow: the inside of the photon ring is empty and covers the stars behind it
    ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(cx, cy, BC * S, 0, TAU); ctx.fill();

    // The wisps of matter on the disk: primary and secondary images, bucketed by brightness
    const B = 6, paths = [Array.from({ length: B }, () => new Path2D()), Array.from({ length: B }, () => new Path2D())];
    const arcTo = (r, p0, len, img, path, fixedB) => {
      const m = Math.max(4, Math.ceil(len * 44));   // the image of the far side moves fast across the sky, so it needs denser samples to avoid visible corners
      let bsum = 0;
      for (let j = 0; j <= m; j++) { image(r, p0 + (len * j) / m, sinI, cosI, img, o); toScr(o[0], o[1], q); if (j) path.lineTo(q[0], q[1]); else path.moveTo(q[0], q[1]); bsum += o[2]; }
      return fixedB ?? bsum / (m + 1);
    };
    for (const sk of G.streaks) {
      const p = sk.p0 + OMEGA * sk.r ** -1.5 * sec;
      for (const img of [0, 1]) {
        if (img === 1 && sk.r > 18) continue;   // secondary images are only noticeable for the inner orbits
        image(sk.r, p + sk.len / 2, sinI, cosI, img, o);
        const bright = o[2] * sk.a * (RIN / sk.r) ** 0.35 * (img ? 0.6 : 1), k = clamp(Math.floor(bright * 3.4), 0, B - 1);
        arcTo(sk.r, p, sk.len, img, paths[img][k]);
      }
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const img of [1, 0]) for (let k = 0; k < B; k++) { ctx.strokeStyle = ink(((0.1 + 0.13 * k) * (img ? 0.85 : 1)).toFixed(3)); ctx.lineWidth = img ? 0.5 : 0.5 + 0.08 * k; ctx.stroke(paths[img][k]); }
    // Photon ring: a very thin circle
    ctx.strokeStyle = ink(0.42); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(cx, cy, BC * S * 1.005, 0, TAU); ctx.stroke();
    ctx.strokeStyle = ink(0.12); ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(cx, cy, BC * S * 1.045, 0, TAU); ctx.stroke();

    // Red: the hot spot orbiting along the inner edge, plus the clumps added by clicking
    const reds = [{ r: 7.2, p: 0.7 + OMEGA * 7.2 ** -1.5 * sec, len: 0.32, a: 1 }];
    for (let i = clumps.length - 1; i >= 0; i--) {
      const c = clumps[i], u = (tt - c.t0) / c.T;
      if (u >= 1 || still) { if (u >= 1) clumps.splice(i, 1); continue; }
      const r = lerp(c.r0, RIN, smooth(u) ** 0.8);
      c.p += OMEGA * r ** -1.5 * (dt / 1000);
      reds.push({ r, p: c.p, len: 0.15 + 2.2 * u, a: (u < 0.05 ? u / 0.05 : 1) * (1 - smooth((u - 0.82) / 0.18)) });
    }
    for (const rd of reds) for (const img of [0, 1]) {
      const pth = new Path2D(), bright = arcTo(rd.r, rd.p, rd.len, img, pth);
      ctx.strokeStyle = red((clamp(0.25 + 0.35 * bright) * rd.a * (img ? 0.7 : 1)).toFixed(3)); ctx.lineWidth = img ? 0.9 : 1.6; ctx.stroke(pth);
    }
  }

  function click(x, y, t) {
    if (!G) return;
    const S = G.s, X = (x - G.w / 2) / S, Y = (y - G.h / 2) / S;
    // Roughly which orbit and which side of the disk the click lands on: the radius is the distance with the vertical axis
    // stretched three times (the disk is seen at a slant), and the upper half counts as the far side of the disk
    const r0 = clamp(Math.hypot(X, Y * 3), RIN + 4, 34), side = X < 0 ? -1 : 1, far = Y < 0;
    clumps.push({ t0: t, T: 5200 + 2600 * Math.random(), r0, p: far ? Math.PI - side * 0.9 : side * Math.PI * 0.42 });
    if (clumps.length > 5) clumps.shift();
  }

  return stage(canvas, { frame, click, stillT: 20000 });
}
