// Header animation "Lidar Navigation": a top-down view of a few rooms explored by a small robot carrying a lidar. The
// walls start out invisible, and a stretch of wall is drawn only once the laser has hit it, so the map grows bit by
// bit (like SLAM mapping).
//
// - The robot picks places it has not been to, finds a path on a grid with A*, smooths it and follows it; the route it
//   has driven leaves a faint trail.
// - The full circle of laser rays is drawn as thin lines, and the points hit in the current frame are red; the planned
//   route is a red dashed line.
// - Pointer: the route from the robot to the pointer is previewed as a light dashed line.
// - Click: the robot drives there.
// - Once the map is mostly explored, it fades out and a new map replaces it.
import { stage, TAU, clamp, lerp, smooth, rng } from "./kit.js";

const CS = 6;          // Cell size of the planning grid (px)
const BIN = 3;         // Shortest stretch of wall that is marked as seen (px)

export const meta = { id: "lidar", name: "激光导航", hint: "机器人带着激光雷达探索房间，打到哪里墙才画出来；鼠标预览路线；点一下，让它过去" };

export function mount(canvas) {
  let G = null, seed = 1;
  const ps = { x: 0, y: 0, k: 0, cell: -1, at: 0 };

  /* ---------- Map ---------- */
  function build(w, h) {
    const r = rng(seed++), segs = [], circles = [], m = 8;
    const wall = (x1, y1, x2, y2) => segs.push({ x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1), seen: null });
    // Outer walls
    wall(m, m, w - m, m); wall(w - m, m, w - m, h - m); wall(w - m, h - m, m, h - m); wall(m, h - m, m, m);
    // Vertical walls divide it into rooms, with a doorway left in each wall
    const rooms = clamp(Math.round(w / 250), 2, 7), xs = [m];
    for (let i = 1; i < rooms; i++) xs.push(lerp(m, w - m, i / rooms) + (r() - 0.5) * (w / rooms) * 0.25);
    xs.push(w - m);
    const door = Math.max(34, 0.26 * h);
    for (let i = 1; i < rooms; i++) {
      const x = xs[i], dy = m + 14 + r() * (h - 2 * m - 28 - door);
      if (dy > m + 2) wall(x, m, x, dy);
      if (dy + door < h - m - 2) wall(x, dy + door, x, h - m);
      // Some rooms also get a short horizontal wall sticking out from the wall
      if (r() < 0.55) { const y = h * (0.3 + 0.4 * r()), L = (xs[i + 1] - x) * (0.25 + 0.3 * r()); if (Math.abs(y - (dy + door / 2)) > door * 0.7) wall(x, y, x + L, y); }
    }
    // Furniture: rectangular tables and round pillars
    for (let i = 0; i < rooms; i++) {
      const x0 = xs[i] + 30, x1 = xs[i + 1] - 30;
      if (x1 - x0 < 50) continue;
      if (r() < 0.7) {
        const bw = 26 + 40 * r(), bh = 16 + 0.18 * h * r(), cx = lerp(x0 + bw / 2, x1 - bw / 2, r()), cy = lerp(m + 24 + bh / 2, h - m - 24 - bh / 2, r());
        wall(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy - bh / 2); wall(cx + bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2);
        wall(cx + bw / 2, cy + bh / 2, cx - bw / 2, cy + bh / 2); wall(cx - bw / 2, cy + bh / 2, cx - bw / 2, cy - bh / 2);
      }
      if (r() < 0.6) circles.push({ x: lerp(x0, x1, r()), y: lerp(m + 26, h - m - 26, r()), r: 6 + 6 * r(), seen: null });
    }
    for (const s of segs) s.seen = new Uint8Array(Math.ceil(s.len / BIN) + 1);
    for (const c of circles) c.seen = new Uint8Array(Math.ceil((TAU * c.r) / BIN) + 1);
    // Grid for path planning: cells too close to a wall count as blocked
    const nx = Math.ceil(w / CS), ny = Math.ceil(h / CS), block = new Uint8Array(nx * ny), R = 10;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * CS, y = (j + 0.5) * CS;
      let hit = false;
      for (const s of segs) { if (distSeg(x, y, s) < R) { hit = true; break; } }
      if (!hit) for (const c of circles) if (Math.hypot(x - c.x, y - c.y) < c.r + R) { hit = true; break; }
      block[j * nx + i] = hit ? 1 : 0;
    }
    // A coarser grid records which areas have been seen, used to pick the next destination
    const vx = Math.ceil(w / 28), vy = Math.ceil(h / 28);
    return { w, h, segs, circles, nx, ny, block, vx, vy, seen: new Uint8Array(vx * vy), born: 0, fade: 0 };
  }
  const distSeg = (x, y, s) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1, u = clamp(((x - s.x1) * dx + (y - s.y1) * dy) / L2);
    return Math.hypot(x - (s.x1 + u * dx), y - (s.y1 + u * dy));
  };
  const free = (M, i, j) => i >= 0 && j >= 0 && i < M.nx && j < M.ny && !M.block[j * M.nx + i];

  /* ---------- A* ---------- */
  function plan(M, x0, y0, x1, y1) {
    let si = Math.floor(x0 / CS), sj = Math.floor(y0 / CS), gi = Math.floor(x1 / CS), gj = Math.floor(y1 / CS);
    [gi, gj] = nearestFree(M, gi, gj); [si, sj] = nearestFree(M, si, sj);
    if (gi < 0 || si < 0) return null;
    const N = M.nx * M.ny, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const H = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return dx + dy - 0.586 * Math.min(dx, dy); };
    const s = sj * M.nx + si, goal = gj * M.nx + gi;
    g[s] = 0; push(s, H(si, sj));
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === goal) break;
      const i = k % M.nx, j = (k / M.nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (!free(M, ii, jj) || (di && dj && (!free(M, i + di, j) || !free(M, i, j + dj)))) continue;
        const kk = jj * M.nx + ii, ng = g[k] + (di && dj ? 1.414 : 1);
        if (ng < g[kk]) { g[kk] = ng; from[kk] = k; push(kk, ng + H(ii, jj)); }
      }
    }
    if (from[goal] < 0 && goal !== s) return null;
    const cells = [];
    for (let k = goal; k >= 0; k = from[k]) cells.push(k);
    cells.reverse();
    // Straighten: skip the points in between whenever a later point is in direct line of sight
    const pts = cells.map((k) => [((k % M.nx) + 0.5) * CS, (((k / M.nx) | 0) + 0.5) * CS]), out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !sight(M, pts[a], pts[b])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }
  function nearestFree(M, i, j) {
    for (let r = 0; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (free(M, i + di, j + dj)) return [i + di, j + dj];
    return [-1, -1];
  }
  function sight(M, [x0, y0], [x1, y1]) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CS * 0.5));
    for (let s = 1; s < n; s++) { const x = lerp(x0, x1, s / n), y = lerp(y0, y1, s / n); if (!free(M, Math.floor(x / CS), Math.floor(y / CS))) return false; }
    return true;
  }

  /* ---------- Laser ---------- */
  function cast(M, x, y, a, maxR) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = maxR, hit = null, u = 0;
    for (const s of M.segs) {
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.x1 - x) * ey - (s.y1 - y) * ex) / den, v = ((s.x1 - x) * dy - (s.y1 - y) * dx) / den;
      if (t > 0 && t < best && v >= 0 && v <= 1) { best = t; hit = s; u = v; }
    }
    for (const c of M.circles) {
      const fx = x - c.x, fy = y - c.y, b = fx * dx + fy * dy, cc = fx * fx + fy * fy - c.r * c.r, disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; hit = c; u = Math.atan2(y + dy * t - c.y, x + dx * t - c.x); }
    }
    return [best, hit, u];
  }

  /* ---------- Robot ---------- */
  const bot = { x: 0, y: 0, th: 0, path: null, goal: null, trail: [], lastTrail: 0, user: false, wait: 0 };
  function newMap(w, h, t) {
    G = build(w, h); G.born = t;
    let i, j, tries = 0;
    do { i = Math.floor(G.nx * (0.05 + 0.15 * Math.random())); j = Math.floor(G.ny * (0.2 + 0.6 * Math.random())); } while (!free(G, i, j) && ++tries < 200);
    Object.assign(bot, { x: (i + 0.5) * CS, y: (j + 0.5) * CS, th: 0, path: null, goal: null, trail: [], user: false, wait: 0 });
  }
  function pickGoal(t) {
    const M = G, cand = [];
    for (let j = 0; j < M.vy; j++) for (let i = 0; i < M.vx; i++) if (!M.seen[j * M.vx + i]) cand.push([(i + 0.5) * 28, (j + 0.5) * 28]);
    if (cand.length < M.vx * M.vy * 0.1) { M.fade = M.fade || t; return; }
    // Prefer nearer candidates: try a few of them and go to the first one that can be reached
    cand.sort((a, b) => Math.hypot(a[0] - bot.x, a[1] - bot.y) - Math.hypot(b[0] - bot.x, b[1] - bot.y));
    for (let k = 0; k < 12; k++) {
      const c = cand[Math.floor(Math.random() * Math.min(cand.length, 18))], p = plan(M, bot.x, bot.y, c[0], c[1]);
      if (p && p.length > 1) { bot.path = p; bot.goal = p[p.length - 1]; bot.user = false; return; }
      M.seen[Math.floor(c[1] / 28) * M.vx + Math.floor(c[0] / 28)] = 1;
    }
  }
  function drive(dt, t) {
    if (!bot.path) { if ((bot.wait -= dt) <= 0) { pickGoal(t); bot.wait = 400; } return; }
    // Head for a point a little ahead on the route, with a capped turn rate, so the motion looks smooth
    const look = 22, v = 0.075 * dt;
    while (bot.path.length > 1 && Math.hypot(bot.path[1][0] - bot.x, bot.path[1][1] - bot.y) < look) bot.path.shift();
    const tgt = bot.path.length > 1 ? bot.path[1] : bot.path[0], dx = tgt[0] - bot.x, dy = tgt[1] - bot.y, d = Math.hypot(dx, dy);
    if (bot.path.length <= 1 && d < 3) { bot.path = null; bot.goal = null; bot.wait = bot.user ? 900 : 250; return; }
    let da = Math.atan2(dy, dx) - bot.th; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
    bot.th += clamp(da, -0.006 * dt, 0.006 * dt);
    const slow = Math.max(0.25, Math.cos(da));
    bot.x += Math.cos(bot.th) * v * slow; bot.y += Math.sin(bot.th) * v * slow;
    if (t - bot.lastTrail > 60) { bot.trail.push([bot.x, bot.y]); bot.lastTrail = t; if (bot.trail.length > 600) bot.trail.shift(); }
  }

  function frame({ ctx, w, h, t, dt, ptr, ink, red, paper, still }) {
    if (!G || G.w !== w || G.h !== h) { newMap(w, h, t); if (still) for (let k = 0; k < 400; k++) { drive(16, t + k * 16); scan(t + k * 16, false); } }
    if (!still) { const n = Math.ceil(dt / 16); for (let k = 0; k < n; k++) drive(dt / n, t); }
    ps.k = ptr.k;
    // Once explored, fade out and switch to a new map
    let alpha = still ? 1 : smooth((t - G.born) / 800);
    if (G.fade) { const u = (t - G.fade - 1500) / 900; alpha *= 1 - smooth(u); if (u >= 1) { newMap(w, h, t); alpha = 0; } }
    if (!still && t - G.born > 90000 && !G.fade) G.fade = t;
    const hits = scan(t, true);

    ctx.globalAlpha = alpha;
    // Laser: a full circle of thin lines
    ctx.strokeStyle = ink(0.07); ctx.lineWidth = 0.6; ctx.beginPath();
    for (const [hx, hy] of hits) { ctx.moveTo(bot.x, bot.y); ctx.lineTo(hx, hy); }
    ctx.stroke();
    // Walls seen so far: consecutive seen bins are joined and drawn as runs
    ctx.strokeStyle = ink(0.78); ctx.lineWidth = 1.3; ctx.lineCap = "round"; ctx.beginPath();
    for (const s of G.segs) {
      const n = s.seen.length, ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len;
      for (let b = 0; b < n; b++) {
        if (!s.seen[b]) continue;
        let e = b; while (e + 1 < n && s.seen[e + 1]) e++;
        const a0 = Math.max(0, b * BIN - 0.5), a1 = Math.min(s.len, (e + 1) * BIN + 0.5);
        ctx.moveTo(s.x1 + ux * a0, s.y1 + uy * a0); ctx.lineTo(s.x1 + ux * a1, s.y1 + uy * a1);
        b = e;
      }
    }
    for (const c of G.circles) {
      const n = c.seen.length;
      for (let b = 0; b < n; b++) {
        if (!c.seen[b]) continue;
        let e = b; while (e + 1 < n && c.seen[e + 1]) e++;
        const a0 = (b / n) * TAU - Math.PI, a1 = ((e + 1) / n) * TAU - Math.PI;
        ctx.moveTo(c.x + c.r * Math.cos(a0), c.y + c.r * Math.sin(a0)); ctx.arc(c.x, c.y, c.r, a0, a1);
        b = e;
      }
    }
    ctx.stroke();
    // The trail driven so far
    if (bot.trail.length > 1) { ctx.strokeStyle = ink(0.16); ctx.lineWidth = 1; ctx.beginPath(); bot.trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.lineTo(bot.x, bot.y); ctx.stroke(); }
    // Preview route to the pointer
    if (ps.k > 0.3 && !still) {
      const cell = Math.floor(ptr.y / CS) * G.nx + Math.floor(ptr.x / CS);
      if (cell !== ps.cell && t - ps.at > 120) { ps.cell = cell; ps.at = t; ps.path = plan(G, bot.x, bot.y, ptr.x, ptr.y); }
      if (ps.path) { ctx.setLineDash([2, 4]); ctx.strokeStyle = ink((0.4 * ps.k).toFixed(3)); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ps.path.slice(1).forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke(); ctx.setLineDash([]); }
    }
    // Planned route and goal
    if (bot.path) {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = red(0.75); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(bot.x, bot.y);
      bot.path.slice(1).forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
      const [gx, gy] = bot.goal;
      ctx.strokeStyle = red(0.9); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(gx, gy, 4, 0, TAU); ctx.stroke();
      if (bot.user) { const v = ((t - bot.userAt) % 1400) / 1400; ctx.strokeStyle = red((0.5 * (1 - v)).toFixed(3)); ctx.beginPath(); ctx.arc(gx, gy, 4 + 12 * v, 0, TAU); ctx.stroke(); }
    }
    // Points hit in this frame
    ctx.fillStyle = red(0.85);
    for (const [hx, hy, ok] of hits) if (ok) ctx.fillRect(hx - 0.9, hy - 0.9, 1.8, 1.8);
    // Robot: a small circle with a stroke at the front showing its heading
    const R = 6;
    ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(bot.x, bot.y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = ink(0.9); ctx.lineWidth = 1.3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ctx.lineTo(bot.x + Math.cos(bot.th) * R, bot.y + Math.sin(bot.th) * R); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // One full circle of laser rays: record the wall bins that were hit and mark the coarse cells that were seen
  function scan(t, out) {
    const N = 150, maxR = Math.max(140, 0.95 * G.h), spin = t * 0.0021, hits = [];
    for (let k = 0; k < N; k++) {
      const a = spin + (k / N) * TAU, [d, hit, u] = cast(G, bot.x, bot.y, a, maxR), hx = bot.x + Math.cos(a) * d, hy = bot.y + Math.sin(a) * d;
      if (hit) {
        if (hit.len !== undefined) hit.seen[Math.min(hit.seen.length - 1, Math.floor((u * hit.len) / BIN))] = 1;
        else hit.seen[Math.min(hit.seen.length - 1, Math.floor(((u + Math.PI) / TAU) * hit.seen.length))] = 1;
      }
      for (let r = 0; r < d; r += 14) { const i = Math.floor((bot.x + Math.cos(a) * r) / 28), j = Math.floor((bot.y + Math.sin(a) * r) / 28); if (i >= 0 && j >= 0 && i < G.vx && j < G.vy) G.seen[j * G.vx + i] = 1; }
      if (out) hits.push([hx, hy, !!hit]);
    }
    return hits;
  }

  function click(x, y, t) {
    if (!G) return;
    const p = plan(G, bot.x, bot.y, x, y);
    if (p && p.length > 1) { bot.path = p; bot.goal = p[p.length - 1]; bot.user = true; bot.userAt = t; }
  }

  return stage(canvas, { frame, click, stillT: 6000 });
}
