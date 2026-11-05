// Header animation "Growth": a few thin branches grow up from the bottom, forking as they go and getting thicker toward the
// root. It uses the space colonization algorithm (the way leaf veins, roots and coral grow): invisible nutrient points are
// scattered over the picture, each one draws the nearest branch toward itself, and a branch that reaches it consumes it.
//
// - Growing tips are red: the newest short stretch is red and fades back to ink further down, with a small red dot on the tip.
// - Short twigs of two or three segments that have stopped growing are not drawn, so the branches are not covered in spikes.
// - New nutrient points appear near the mouse, and the branches slowly grow toward it.
// - Click: cuts off the branches inside that circle (together with everything that grew out of them), sprinkles fresh
//   nutrients there, and the cut branches around it grow back.
// - Once fully grown it pauses, fades out, and a new patch starts growing.
import { stage, TAU, clamp, smooth, rng, noise3 } from "./kit.js";

export const meta = { id: "growth", name: "生长", hint: "枝条从底下往上长、一路分叉（空间殖民算法）；鼠标附近冒出养分，枝条朝它长过去；点一下剪掉一片，看它重新长" };

const D = 3.6, RI = 46, RK = 7;   // segment length, how far away a nutrient can still pull a branch, how close counts as reaching (and consuming) it

export function mount(canvas) {
  let G = null, seed = 3, acc = 0;
  const RATE = 14;   // growth steps per second

  function reset(w, h, t) {
    const r = rng(seed++), A = [];
    const n = Math.round(clamp((w * h) / 70, 900, 3600));
    // Nutrient points: dense at the top, sparse at the bottom, and clumped by noise
    while (A.length < 2 * n) {
      const x = r() * w, y = r() * h * 0.96;
      if (r() < 0.35 + 0.55 * (1 - y / h) * (0.6 + 0.4 * noise3(x * 0.01, y * 0.01, seed))) A.push(x, y);
    }
    const nodes = [];   // { x, y, p (parent node), n (segments grown out from here, itself included; more means thicker), t (time it grew) }
    const roots = clamp(Math.round(w / 260), 2, 6);
    for (let i = 0; i < roots; i++) nodes.push({ x: ((i + 0.3 + 0.4 * r()) / roots) * w, y: h + 2, p: -1, n: 1, t });
    G = { w, h, A: Float32Array.from(A), alive: new Uint8Array(A.length / 2).fill(1), nodes, born: t, still: 0, fade: 0, grid: new Map(), falling: [] };
    for (let i = 0; i < nodes.length; i++) addToGrid(i);
  }
  const key = (x, y) => `${Math.floor(x / RI)},${Math.floor(y / RI)}`;
  function addToGrid(i) { const nd = G.nodes[i], k = key(nd.x, nd.y); let b = G.grid.get(k); if (!b) G.grid.set(k, (b = [])); b.push(i); }

  // One growth step
  function grow(t) {
    const { A, alive, nodes } = G, pull = new Map();
    for (let a = 0; a < alive.length; a++) {
      if (!alive[a]) continue;
      const x = A[2 * a], y = A[2 * a + 1], cx = Math.floor(x / RI), cy = Math.floor(y / RI);
      let best = -1, bd = RI * RI;
      for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
        const b = G.grid.get(`${i},${j}`);
        if (b) for (const k of b) { const dx = nodes[k].x - x, dy = nodes[k].y - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = k; } }
      }
      if (best < 0) continue;
      if (bd < RK * RK) { alive[a] = 0; continue; }
      const d = Math.sqrt(bd), v = pull.get(best) ?? [0, 0, 0];
      v[0] += (x - nodes[best].x) / d; v[1] += (y - nodes[best].y) / d; v[2]++;
      pull.set(best, v);
    }
    let added = 0;
    for (const [k, [vx, vy]] of pull) {
      const nd = nodes[k], wob = 0.35 * noise3(nd.x * 0.02, nd.y * 0.02, t * 0.0003);
      let dx = vx + wob, dy = vy - 0.25, l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const x = nd.x + dx * D, y = nd.y + dy * D;
      // Do not almost coincide with the node's own parent (it would get stuck growing back and forth)
      if (nd.p >= 0 && Math.hypot(x - nodes[nd.p].x, y - nodes[nd.p].y) < D * 0.5) continue;
      nodes.push({ x, y, p: k, n: 1, t });
      addToGrid(nodes.length - 1);
      // Walk up the ancestors: each one now has one more segment grown out of it (thicker toward the root)
      for (let q = k; q >= 0; q = nodes[q].p) nodes[q].n++;
      added++;
    }
    return added;
  }
  // Sprinkle some nutrient points (near the mouse, around new seeds)
  function sprinkle(x, y, R, n) {
    const extra = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = R * Math.sqrt(Math.random()); extra.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    const A = new Float32Array(G.A.length + extra.length); A.set(G.A); A.set(extra, G.A.length);
    const alive = new Uint8Array(A.length / 2); alive.set(G.alive); alive.fill(1, G.alive.length);
    G.A = A; G.alive = alive;
  }

  function frame({ ctx, w, h, t, dt, ptr, ink, red, still }) {
    // Grow a short stretch right away at the start (these segments do not count as "just grown" and are not marked red)
    if (!G || G.w !== w || G.h !== h) { reset(w, h, t); for (let s = 0; s < (still ? 120 : 14); s++) grow(-1e9); }
    if (!still) {
      if (ptr.k > 0.5 && Math.random() < 0.5 && G.A.length < 20000) sprinkle(ptr.sx, ptr.sy, 26, 3);
      let added = 0;
      acc += dt * RATE / 1000;
      while (acc >= 1) { added += grow(t); acc -= 1; }
      if (added) G.still = 0; else G.still += dt;
      if (!G.fade && (G.still > 1500 || t - G.born > 60000)) G.fade = t + 6500;
      if (G.fade && t > G.fade + 1300) reset(w, h, t);
    }
    const alpha = still ? 1 : (G.fade ? 1 - smooth((t - G.fade) / 1300) : 1) * smooth((t - G.born) / 600);
    const { nodes } = G;
    // Short twigs: counting back from a tip to the previous fork, a twig of fewer than 3 segments that has stopped growing
    // is not drawn at all
    const kids = new Uint8Array(nodes.length), hide = new Uint8Array(nodes.length);
    for (const nd of nodes) if (nd.p >= 0 && kids[nd.p] < 255) kids[nd.p]++;
    for (let i = 0; i < nodes.length; i++) {
      if (kids[i] || nodes[i].p < 0 || (!still && t - nodes[i].t < 1500)) continue;
      let q = i, len = 0;
      do { q = nodes[q].p; len++; } while (len < 3 && nodes[q].p >= 0 && kids[q] === 1);
      if (len < 3 && kids[q] >= 2) for (let j = i, k = 0; k < len; k++, j = nodes[j].p) hide[j] = 1;
    }
    // Branches: bucketed by thickness, one bucket drawn at a time; the newest segments of growing tips are also drawn in red
    const B = 7, paths = Array.from({ length: B }, () => new Path2D()), tips = new Path2D(), REDMS = 700, fresh = [];
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd.p < 0 || hide[i]) continue;
      const pa = nodes[nd.p], wdt = 0.5 + 0.28 * nd.n ** 0.38, b = clamp(Math.floor(Math.log2(wdt / 0.55) * 1.6), 0, B - 1);
      paths[b].moveTo(pa.x, pa.y); paths[b].lineTo(nd.x, nd.y);
      if (!still && t - nd.t < REDMS) { fresh.push(i); if (!kids[i]) tips.moveTo(nd.x + 1.2, nd.y), tips.arc(nd.x, nd.y, 1.2, 0, TAU); }
    }
    ctx.globalAlpha = alpha; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let b = 0; b < B; b++) { ctx.strokeStyle = ink((0.42 + 0.07 * b).toFixed(3)); ctx.lineWidth = 0.55 * 2 ** (b / 1.6); ctx.stroke(paths[b]); }
    // Red: three buckets by age, the newer the redder
    const reds = [new Path2D(), new Path2D(), new Path2D()];
    for (const i of fresh) { const nd = nodes[i], pa = nodes[nd.p], k = clamp(Math.floor(((t - nd.t) / REDMS) * 3), 0, 2); reds[k].moveTo(pa.x, pa.y); reds[k].lineTo(nd.x, nd.y); }
    ctx.lineWidth = 0.9;
    for (let k = 0; k < 3; k++) { ctx.strokeStyle = red((0.85 - 0.27 * k).toFixed(3)); ctx.stroke(reds[k]); }
    ctx.fillStyle = red(0.9); ctx.fill(tips);
    if (G.falling.length) {
      const v = (t - G.fallAt) / 500;
      if (v >= 1 || still) G.falling = [];
      else { ctx.strokeStyle = ink((0.45 * (1 - v)).toFixed(3)); ctx.lineWidth = 0.8; ctx.beginPath(); for (const [a, b, c, d] of G.falling) { ctx.moveTo(a, b + 6 * v); ctx.lineTo(c, d + 6 * v); } ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }

  // Cut out a circle: remove the nodes inside it and all their descendants (a child always comes after its parent, so one
  // pass in order is enough), then recount the thickness and rebuild the index
  function click(x, y, t) {
    if (!G) return;
    const R = 0.3 * G.h, { nodes } = G, cut = new Uint8Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if ((nd.p >= 0 && cut[nd.p]) || (nd.p >= 0 && Math.hypot(nd.x - x, nd.y - y) < R)) cut[i] = 1;
    }
    const map = new Int32Array(nodes.length).fill(-1), keep = [];
    for (let i = 0; i < nodes.length; i++) {
      if (cut[i]) { const pa = nodes[nodes[i].p]; G.falling.push([pa.x, pa.y, nodes[i].x, nodes[i].y]); continue; }
      map[i] = keep.length; keep.push({ ...nodes[i], p: nodes[i].p >= 0 ? map[nodes[i].p] : -1, n: 1 });
    }
    for (let i = keep.length - 1; i >= 0; i--) if (keep[i].p >= 0) keep[keep[i].p].n += keep[i].n;
    G.nodes = keep; G.grid = new Map();
    for (let i = 0; i < keep.length; i++) addToGrid(i);
    G.fallAt = t;
    sprinkle(x, y, R, Math.round(R * R * 0.04));   // about as dense as before, so the regrowth forks the same way
    G.still = 0;
    if (G.fade && t < G.fade) G.fade = 0;
  }

  return stage(canvas, { frame, click, stillT: 3000 });
}
