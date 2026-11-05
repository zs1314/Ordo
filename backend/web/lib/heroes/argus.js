// Header animation "Mesh" (argus): a net woven from fine lines whose crossings form rows of almond-shaped cells; eyes
// open in the cells, watch the lines and swallow the red streaks flowing along them.
// Drawn with plain Canvas 2D, without any library.
//
// Like the other header animations, it uses stage() from kit.js to run the loop and manage the canvas and the pointer;
// this file only deals with how the eyes and the net move and how they are drawn.
//
// Behavior:
// - Each row is a pair of lines in opposite phase that cross to form a chain of cells; the rows drift slowly sideways,
//   odd and even rows in opposite directions.
// - Each line is a bundle of 5 fine strands with a small gap every so often; a few segments are red.
// - 24 "comets" run along the lines, one in every 4 of them red; when a comet passes a crossing, the "+" there lights up.
// - Pointer over the net: the net is pushed slightly apart around the pointer, and the strands of each bundle shift
//   apart a little with the pointer position; the cell under the pointer opens an eye.
// - Without the pointer, a few eyes still open now and then (at most 3); eyes blink, glance around, and are drawn to
//   nearby red comets, which they swallow.
// - Click: cells open ring by ring around the click point, read out a string of digits, then slowly close.

import { stage, TAU } from "./kit.js";

export const meta = { id: "argus", name: "网眼", hint: "碰到哪个网眼，哪里睁眼；点一下，一圈圈睁开" };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - (1 - clamp01(v)) ** 3;
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const rnd = (a, b) => { const v = Math.sin(12.9898 * a + 78.233 * b) * 43758.5453; return v - Math.floor(v); };

// Grid: row spacing d, amplitude a, half cell width W, wave number k; y0 puts one row exactly at mid-height
function grid(w, h) {
  const d = Math.max(56, h / 5.4), a = d / 2, W = a / 0.43;
  return { d, a, W, k: Math.PI / (2 * W), y0: h / 2 - Math.round(h / 2 / d) * d };
}
// Phase of row n: a slow drift shared by all rows, plus opposite drifts for odd and even rows
const rowPhase = (n, t) => 4e-5 * t + ((((n % 2) + 2) % 2) === 0 ? 1 : -1) * 2e-4 * t;

// Cut a line into segments by phase: one slot per 0.7 rad, each with a 0.07 rad gap at a random spot; about 4% of the
// segments are red
function segments(seed, k, phase, x0, x1, out) {
  out.length = 0;
  const p0 = k * x0 + phase, p1 = k * x1 + phase;
  const push = (a, b, flag) => { const s = Math.max(a, p0), e = Math.min(b, p1); if (e > s) out.push((s - phase) / k, (e - phase) / k, flag); };
  for (let c = Math.floor(p0 / 0.7) - 1; 0.7 * c <= p1; c++) {
    const start = 0.7 * c + 0.45 * rnd(131 * seed + c, 2) + 0.07, mid = (c + 1) * 0.7, next = (c + 1) * 0.7 + 0.45 * rnd(131 * seed + c + 1, 2);
    push(start, mid, rnd(71 * seed + c, 3) < 0.04 ? 1 : 0);
    push(mid, next, rnd(71 * seed + c + 1, 3) < 0.04 ? 1 : 0);
  }
}

// The small moving network inside the pupil
function makeNet(seed) {
  const n = 12 + Math.floor(3 * rnd(seed, 50)), rot = rnd(seed, 51) * TAU, nodes = [];
  for (let i = 0; i < n; i++) {
    const r = 0.74 * Math.sqrt((i + 0.5) / n), a = 2.39996 * i + rot;
    nodes.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, lit: 0, kick: 0, coral: 0, coralTo: 0, ref: 0 });
  }
  const net = { nodes, edges: [], spikes: [], nextSpont: 0, rewired: false };
  relink(net);
  return net;
}
function relink(net) {
  const N = net.nodes;
  net.edges = [];
  for (let a = 0; a < N.length; a++) for (let b = a + 1; b < N.length; b++) {
    const dd = Math.hypot(N[a].x - N[b].x, N[a].y - N[b].y);
    if (dd < 0.62) net.edges.push({ a, b, w: 1 - dd / 0.62 });
  }
}
// Light up a node and let the signal spread outward along its edges
function fire(net, idx, energy, coral, t) {
  const nd = net.nodes[idx];
  if (!nd || t < nd.ref) return;
  nd.kick = 1; nd.coralTo = coral ? 1 : 0.4 * nd.coralTo; nd.ref = t + 320;
  if (energy < 0.3) return;
  for (const e of net.edges) {
    if ((e.a !== idx && e.b !== idx) || Math.random() > 0.9 * e.w) continue;
    const o = e.a === idx ? e.b : e.a, m = net.nodes[o];
    net.spikes.push({ a: idx, b: o, t0: t, dur: 150 + 230 * Math.hypot(m.x - nd.x, m.y - nd.y), coral, energy });
  }
}
function entryNode(net, dx, dy, skip = -1) {
  let best = 0, bv = -Infinity;
  net.nodes.forEach((n, i) => { const v = n.x * dx + n.y * dy; if (i !== skip && v > bv) { bv = v; best = i; } });
  return best;
}
function stepNet(net, dt, t, seed) {
  const N = net.nodes, p1 = 1.3 * seed, p2 = 2.1 * seed, p3 = 0.7 * seed, swirl = 16e-5 * Math.sin(17e-5 * t + seed);
  for (const n of N) {
    const a = 3.1 * n.x + 1.7 * n.y + 41e-5 * t + p1, b = -2.2 * n.x + 3.6 * n.y - 33e-5 * t + p2, c = 4.4 * n.x - 2.6 * n.y + 27e-5 * t + p3;
    const f = 3.1 * Math.cos(a) - 0.8 * 2.2 * Math.cos(b) + 2.2 * Math.cos(c);
    let vx = 3e-5 * (1.7 * Math.cos(a) + 0.8 * 3.6 * Math.cos(b) - 1.3 * Math.cos(c)) - n.y * swirl, vy = -(3e-5 * f) + n.x * swirl;
    const r = Math.hypot(n.x, n.y);
    if (r > 0.7) { const out = (vx * n.x + vy * n.y) / r; if (out > 0) { vx -= (out * n.x) / r; vy -= (out * n.y) / r; } vx -= n.x * (r - 0.7) * 0.0012; vy -= n.y * (r - 0.7) * 0.0012; }
    for (const m of N) {
      if (m === n) continue;
      const dx = n.x - m.x, dy = n.y - m.y, dd = Math.hypot(dx, dy) || 0.001;
      if (dd < 0.26) { vx += (dx / dd) * (0.26 - dd) * 9e-4; vy += (dy / dd) * (0.26 - dd) * 9e-4; }
    }
    const s = 1 - Math.exp(-dt / 260);
    n.vx += (vx - n.vx) * s; n.vy += (vy - n.vy) * s; n.x += n.vx * dt; n.y += n.vy * dt;
    n.lit += (n.kick - n.lit) * (1 - Math.exp(-dt / 45)); n.kick *= Math.exp(-dt / 220); n.coral += (n.coralTo - n.coral) * (1 - Math.exp(-dt / 90));
  }
  relink(net);
  const done = net.spikes.filter((s) => t >= s.t0 + s.dur);
  net.spikes = net.spikes.filter((s) => t < s.t0 + s.dur);
  for (const s of done) fire(net, s.b, 0.78 * s.energy, s.coral, t);
  if (t > net.nextSpont) { fire(net, Math.floor(Math.random() * N.length), 0.62, false, t); net.nextSpont = t + 1400 + 1800 * Math.random(); }
}

// Small atlas of decimal digit glyphs (three colors: ink, green, bright green), drawn on the iris and the pupil during a
// readout
const GLYPHS = "0123456789.";
const GLYPH_BASE = 37.44;

export function mount(canvas) {
  let ctx = null, DPR = 1;   // Set by stage() on every frame

  let INK = "24, 24, 24", PAPER = "255, 255, 255", RED = "179, 38, 60";
  const GREEN = "0, 168, 60", NEON = "0, 255, 65";
  let atlas = null, ringCache = { settled: null, scramble: null }, chorusCache = null, grain = null;

  const eyes = new Map();
  const S = { bend: 0, hush: 0, q: 0, qs: 0, dq: 0, links: new Map(), lastDraw: 0 };
  const ptr = { x: 0, y: 0, at: -1e9, inside: false, sx: 0, sy: 0 };
  let seed = 1, lastNow = 0, introAt = -1, introN = 0, nextAmbient = 0, wave = null, clickAt = -1e9, click = { x: 0, y: 0 };

  /* ---------- Colors and caches ---------- */
  function buildAtlas() {
    const c = document.createElement("canvas");
    c.width = 48 * GLYPHS.length; c.height = 48 * 3;
    const g = c.getContext("2d");
    g.font = `500 ${GLYPH_BASE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    g.textAlign = "center"; g.textBaseline = "middle";
    [INK, GREEN, NEON].forEach((col, row) => { g.fillStyle = `rgb(${col})`; for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], 48 * i + 24, 48 * row + 25.92); });
    return c;
  }
  function glyph(g, dpr, ch, row, x, y, size, rot, alpha) {
    const i = GLYPHS.indexOf(ch);
    if (i < 0 || alpha <= 0.01) return;
    const sc = (size / GLYPH_BASE) * dpr, cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
    g.setTransform(cs, sn, -sn, cs, x * dpr, y * dpr);
    g.globalAlpha = alpha;
    g.drawImage(atlas ??= buildAtlas(), 48 * i, 48 * row, 48, 48, -24, -24, 48, 48);
  }
  // The three rings of digits on the iris during a readout: "settled" changes a digit every so often, "scramble"
  // keeps flickering
  const READ_RINGS = [0.5, 0.67, 0.84];
  function digitRings(kind, R, dpr, t) {
    const key = `${R.toFixed(1)}|${dpr}`, tick = Math.floor(t / (kind === "settled" ? 120 : 45));
    let c = ringCache[kind];
    if (c && c.key === key && c.tick === tick) return c.rings;
    const size = Math.max(4.5, 0.11 * R);
    if (!c || c.key !== key) {
      c = { key, tick: -1, rings: READ_RINGS.map((f) => { const cv = document.createElement("canvas"); cv.width = cv.height = Math.ceil((R * f + size) * 2 * dpr) + 2; return cv; }) };
      ringCache[kind] = c;
    }
    c.tick = tick;
    c.rings.forEach((cv, ri) => {
      const g = cv.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      const half = cv.width / dpr / 2, rad = R * READ_RINGS[ri], n = 6 * Math.floor((TAU * rad) / (0.66 * size) / 6);
      for (let i = 0; i < n; i++) {
        const grp = Math.floor(i / 6), pos = i % 6;
        if (pos === 5) continue;
        let ch = ".", row = 0, alpha = 0.82;
        if (kind === "scramble") { if (pos !== 1) ch = String(Math.floor(10 * rnd(7 * i + ri, tick))); row = 1; alpha = 0.95; }
        else {
          if (pos !== 1) { const period = pos === 0 ? 2600 : pos === 2 ? 900 : pos === 3 ? 320 : 120; const v = rnd(131 * ri + 17 * grp + pos, Math.floor((t + 97 * grp) / period)); ch = String(pos === 0 ? Math.floor(2 * v) : Math.floor(10 * v)); }
          if (rnd(19 * ri + grp, 77) < 0.1) { row = 1; alpha = 0.95; }
        }
        const a = (i / n) * TAU;
        glyph(g, dpr, ch, row, half + Math.cos(a) * rad, half + Math.sin(a) * rad, size, a + Math.PI / 2, alpha);
      }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    });
    return c.rings;
  }
  // Eyes that open together after a click (chorus eyes) are drawn more simply, with the iris pre-rendered to images
  function chorusArt(R, dpr) {
    const key = `${R.toFixed(1)}|${dpr}|${INK}|${RED}`;
    if (chorusCache?.key === key) return chorusCache;
    const mk = (r) => { const c = document.createElement("canvas"); c.width = c.height = Math.ceil((r + 2) * 2 * dpr); const g = c.getContext("2d"); const half = c.width / dpr / 2; g.setTransform(dpr, 0, 0, dpr, dpr * half, dpr * half); return [c, g]; };
    const ink = [], alt = [];
    for (let i = 0; i < 7; i++) {
      const r = R * (0.38 + 0.075 * i), [c1, g1] = mk(r), [c2, g2] = mk(r);
      let a = 0, j = 0;
      while (a < TAU - 0.1) {
        const len = 0.25 + 0.9 * rnd(119 + 31 * i + j, 6), gap = 0.12 + 0.25 * rnd(91 + 29 * i + j, 7), e = Math.min(TAU - 0.05, a + len);
        g1.lineWidth = 0.9; g1.strokeStyle = `rgba(${INK}, ${rnd(7 + i, j) < 0.5 ? 0.49 : 0.66})`; g1.beginPath(); g1.arc(0, 0, r, a, e); g1.stroke();
        if (j % 2 === 0) { g2.lineWidth = 1.6; g2.strokeStyle = `rgba(${RED}, 0.95)`; g2.beginPath(); g2.arc(0, 0, r, a, e); g2.stroke(); }
        a += len + gap; j++;
      }
      ink.push(c1); alt.push(c2);
    }
    const ticks = (step) => { const [c, g] = mk(R); g.strokeStyle = `rgba(${INK}, 0.5)`; g.lineWidth = 0.8; g.beginPath(); for (let i = 0; i < 72; i += step) { const a = (i / 72) * TAU, r = R * (i % 6 === 0 ? 0.9 : 0.95); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); } g.stroke(); return c; };
    return (chorusCache = { key, ink, alt, ticks: ticks(1), ticksLite: ticks(2) });
  }
  function buildGrain() {
    const c = document.createElement("canvas"); c.width = c.height = 160;
    const g = c.getContext("2d"), img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = Math.random() * 22; }
    g.putImageData(img, 0, 0);
    return c;
  }
  function setColors(col) {
    INK = col.ink; PAPER = col.paper; RED = col.red;
    atlas = null; ringCache = { settled: null, scramble: null }; chorusCache = null;
  }

  /* ---------- Grid coordinates ---------- */
  const W_ = () => canvas.clientWidth, H_ = () => canvas.clientHeight;
  function cellAt(x, y, t) {
    const G = grid(W_(), H_()), n = Math.round((y - G.y0) / G.d), g = rowPhase(n, t), s = Math.round((G.k * x + g - Math.PI / 2) / Math.PI);
    const xc = (Math.PI / 2 + s * Math.PI - g) / G.k, yc = G.y0 + n * G.d;
    return { key: `${n},${s}`, xc, yc, inside: Math.abs(x - xc) < G.W && Math.abs(y - yc) < G.a * Math.cos(G.k * (x - xc)) };
  }
  function cellPos(key, t, G = grid(W_(), H_())) {
    const [n, s] = key.split(",").map(Number);
    return { x: (Math.PI / 2 + s * Math.PI - rowPhase(n, t)) / G.k, y: G.y0 + n * G.d, n, W: G.W, d: G.d };
  }
  function near(k1, k2, t) { const a = cellPos(k1, t), b = cellPos(k2, t); return Math.abs(a.x - b.x) < 2.6 * a.W && Math.abs(a.y - b.y) < 1.6 * a.d; }
  function comet(i, t, w, h) {
    const G = grid(w, h), amp = G.a * (1 + 0.035 * Math.sin(35e-5 * t));
    const top = Math.floor(-G.y0 / G.d) - 1, rows = Math.max(1, Math.ceil((h + G.d - G.y0) / G.d) - top);
    const n = top + Math.floor(rnd(i, 21) * rows), phi = rowPhase(n, t), sign = rnd(i, 22) < 0.5 ? 1 : -1, dir = rnd(i, 25) < 0.5 ? 1 : -1, speed = 0.06 + 0.08 * rnd(i, 23), M = w + 160;
    const x = (((rnd(i, 24) * M + t * speed * dir) % M) + M) % M - 80, yc = G.y0 + n * G.d;
    return { x, y: yc + sign * amp * Math.sin(G.k * x + phi), yc, sign, dir, amp, k: G.k, phi, coral: i % 4 === 0 };
  }
  function eyeGeom(key, e, t, w, h) {
    const G = grid(w, h), amp = G.a * (1 + 0.035 * Math.sin(35e-5 * t)), c = cellPos(key, t, G), R = 1.12 * amp;
    const ix = c.x + e.gx * G.W * 0.34, iy = c.y + e.gy * amp * 0.3 + (1 - e.upper / Math.max(0.01, easeOut(e.open))) * amp * 0.08;
    return { x: ix + e.gx * R * 0.05, y: iy + e.gy * R * 0.05, ix, iy, R, cx: c.x, cy: c.y };
  }
  const bowPoint = (x0, y0, x1, y1, bow, u) => { const v = 1 - u; return [v * v * x0 + 2 * v * u * ((x0 + x1) / 2 - (y1 - y0) * bow) + u * u * x1, v * v * y0 + 2 * v * u * ((y0 + y1) / 2 + (x1 - x0) * bow) + u * u * y1]; };

  /* ---------- Eye lifecycle ---------- */
  const newEye = (o) => ({ open: 0, gx: 0, gy: 0, dilate: 0, seed: ++seed, upper: 0, lower: 0, age: 0, spin: 0, tx: 0, ty: 0, lock: 0, ...o });
  function openEye(key, now, dur) {
    const t = now + 6000;
    for (const [k2, e2] of eyes) if (k2 !== key && !e2.chorus && near(key, k2, t)) e2.until = Math.min(e2.until, now);
    const e = eyes.get(key);
    if (e) { e.until = Math.max(e.until, now + dur); if (e.chorus && e.open > 0.5) { e.chorus = false; e.blinkAt = now + 1500 + 3000 * Math.random(); } return; }
    eyes.set(key, newEye({ until: now + dur, blinkAt: now + 2000 + 4000 * Math.random(), flag: Math.random() < 0.15, nextSaccade: now + 400 }));
  }
  function freeCell(t, fx, fy) {
    const w = W_(), h = H_(), G = grid(w, h);
    for (let i = 0; i < 30; i++) {
      const c = cellAt(w * (fx[0] + Math.random() * (fx[1] - fx[0])), h * (fy[0] + Math.random() * (fy[1] - fy[0])), t);
      if ([...eyes.entries()].every(([k, e]) => e.open < 0.03 || !near(c.key, k, t)) && c.xc > 1.15 * G.W && c.xc < w - 1.15 * G.W && !eyes.has(c.key)) return c;
    }
    return null;
  }
  function startWave(now, t) {
    const w = W_(), h = H_(), G = grid(w, h), list = [];
    for (let n = Math.floor((-G.a - G.y0) / G.d); G.y0 + n * G.d < h + 0.6 * G.a; n++) {
      const y = G.y0 + n * G.d;
      if (y < -0.6 * G.a) continue;
      const g = rowPhase(n, t);
      for (let s = Math.floor((g - Math.PI / 2 - G.k * G.W) / Math.PI); ; s++) {
        const x = (Math.PI / 2 + s * Math.PI - g) / G.k;
        if (x > w + 0.6 * G.W) break;
        if (x >= -0.6 * G.W) list.push({ key: `${n},${s}`, dist: Math.hypot(x - click.x, y - click.y) });
      }
    }
    if (!list.length) return;
    const far = Math.max(1, ...list.map((c) => c.dist)), lead = list.reduce((a, b) => (b.dist < a.dist ? b : a), list[0]);
    for (const c of list) {
      const until = now + 0.45 * far + 2700 + (far - c.dist) * 1.1, e = eyes.get(c.key), p = cellPos(c.key, t), a0 = Math.atan2(click.y - p.y, click.x - p.x);
      if (e) {
        e.until = Math.max(e.until, until); e.readUntil = until - 950; e.readout = true;
        if ((e.readP ?? 0) > 0.001 || (e.irisP ?? 0) > 0.001) e.readStart = now; else { e.readStart = now + 0.45 * c.dist + 200; e.readA0 = a0; }
        if (!e.chorus) e.blinkAt = Math.max(e.blinkAt, until + 400);
        continue;
      }
      eyes.set(c.key, newEye({ until, blinkAt: Infinity, flag: Math.random() < 0.12, nextSaccade: Infinity, chorus: true, openAt: now + 0.45 * c.dist, readUntil: until - 950, readStart: now + 0.45 * c.dist + 380, readA0: a0, readout: true, lite: S.q >= 1, frame: 0 }));
    }
    const L = eyes.get(lead.key);
    if (L) {
      const end = now + 0.45 * far + 2700 + 1.1 * far;
      L.until = Math.max(L.until, end + 1800); L.chorus = false; L.readout = true;
      L.readStart = (L.readP ?? 0) > 0.001 || (L.irisP ?? 0) > 0.001 ? now : Math.min(L.readStart ?? Infinity, now + 150);
      L.readUntil = end - 300; L.blinkAt = end + 900; L.nextSaccade = 0;
    }
    wave = { x: click.x, y: click.y, end: now + 0.45 * far + 2700 + 1.1 * far };
    Object.assign(ptr, { x: click.x, y: click.y, at: now, inside: true });
  }

  function update(now, t) {
    const w = W_(), h = H_();
    if (introAt < 0) introAt = now + 150;
    if (introN < 3 && now >= introAt + 320 * introN) { const c = freeCell(t, [0.12, 0.88], [0.18, 0.82]); if (c) openEye(c.key, now, 2600 + 200 * introN); introN++; }
    if (clickAt > lastNow) startWave(now, t);
    if (wave && now > wave.end + 800) wave = null;
    const dt = Math.min(100, lastNow ? now - lastNow : 16);
    lastNow = now;
    if (!wave && ptr.inside && now - ptr.at < 4000) { const c = cellAt(ptr.x, ptr.y, t); if (c.inside) openEye(c.key, now, 3400); }
    if (introN >= 3 && now > nextAmbient && !wave) {
      if ([...eyes.values()].filter((e) => e.until > now && !e.chorus).length < 3) { const c = freeCell(t, [0.08, 0.92], [0.14, 0.86]); if (c) openEye(c.key, now, 5000 + 6000 * Math.random()); }
      nextAmbient = now + 500 + 1200 * Math.random();
    }
    // When two eyes are too close together, the older one closes
    const live = [...eyes.entries()].filter(([, e]) => e.until > now && !e.chorus);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      if (near(live[i][0], live[j][0], t)) { const older = live[i][1].age >= live[j][1].age ? live[i][1] : live[j][1]; older.until = Math.min(older.until, now); }
    }
    const recent = now - ptr.at < 5000;
    {
      const tx = recent ? Math.max(-1, Math.min(1, (ptr.x / (w || 1) - 0.5) * 2)) : 0, ty = recent ? Math.max(-1, Math.min(1, (ptr.y / (h || 1) - 0.5) * 2)) : 0, s = 1 - Math.exp(-dt / 420);
      ptr.sx += (tx - ptr.sx) * s; ptr.sy += (ty - ptr.sy) * s;
      const bendTo = recent && ptr.inside ? 1 : 0;
      S.bend += (bendTo - S.bend) * (1 - Math.exp(-dt / (bendTo ? 350 : 900)));
      S.hush += ((wave && now < wave.end - 300 ? 1 : 0) - S.hush) * (1 - Math.exp(-dt / 260));
    }
    for (const [key, e] of eyes) {
      if (e.openAt !== undefined && now < e.openAt) continue;
      const reading = (e.readP ?? 0) > 0.005 || (e.irisP ?? 0) > 0.005;
      if (e.until <= now && (e.readUntil ?? 0) > now) e.readUntil = now;
      const want = e.until > now || (reading && e.open > 0.2) ? 1 : 0;
      e.frame = (e.frame ?? +!e.chorus) + (+!e.chorus - (e.frame ?? +!e.chorus)) * (1 - Math.exp(-dt / 320));
      const span = e.chorus ? (want ? 360 : 440) : want ? 700 : 820;
      e.open = clamp01(e.open + ((want ? 1 : -1) * dt) / span);
      if (!want && e.open < 0.01) { eyes.delete(key); continue; }
      e.age += dt; e.spin += dt * easeOut(e.age / 1100);
      // Blink: close in 95 ms, stay shut for 45 ms, open in 240 ms; sometimes a double blink, sometimes a half blink
      const sc = e.blinkScale ?? 1, tc = 95 * sc, th = 45 * sc, to = 240 * sc, depth = e.blinkDepth ?? 1, since = now - e.blinkAt;
      let shut = 0;
      if (since >= 0 && since < tc) shut = Math.sin((since / tc) * (Math.PI / 2)) ** 2;
      else if (since >= tc && since < tc + th) shut = 1;
      else if (since >= tc + th && since < tc + th + to) shut = 1 - easeOut((since - tc - th) / to);
      else if (since >= tc + th + to) {
        const again = !e.blinkAgain && Math.random() < 0.15;
        e.blinkAgain = again; e.blinkAt = now + (again ? 160 + 120 * Math.random() : 3200 + 6500 * Math.random());
        e.blinkDepth = Math.random() < 0.2 ? 0.55 + 0.3 * Math.random() : 1; e.blinkScale = 0.85 + 0.4 * Math.random();
      }
      const lid = 1 - shut * depth, o = e.chorus ? smooth(e.open) : easeOut(e.open);
      e.upper = o * lid; e.lower = o ** 1.6 * (1 - 0.25 * (1 - lid));
      const net = (e.net ??= makeNet(e.seed));
      if (shut * depth > 0.985 && !net.rewired) {
        for (const n of net.nodes) if (Math.random() < 0.6) { const r = 0.72 * Math.sqrt(Math.random()), a = Math.random() * TAU; Object.assign(n, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 }); }
        relink(net); net.spikes = []; net.rewired = true;
      } else if (shut < 0.2) net.rewired = false;
      stepNet(net, dt, t, e.seed);
      const readNow = now >= (e.readStart ?? Infinity) && now < (e.readUntil ?? 0);
      e.readP = clamp01((e.readP ?? 0) + ((readNow ? 1 : -1) * dt) / 800);
      e.irisP = clamp01((e.irisP ?? 0) + ((readNow && e.readout ? 1 : -1) * dt) / 800);
      if (now >= (e.readUntil ?? 0) && !e.readP && !e.irisP) e.readout = false;
      e.memory = (e.memory ?? 0) + (Math.min(0.4, (e.caught ?? 0) * 0.1) - (e.memory ?? 0)) * (1 - Math.exp(-dt / 900));
      const c = cellPos(key, t), G = grid(w, h), geo = eyeGeom(key, e, t, w, h);
      // A red comet nearby: lock on, keep looking at it, and swallow it after a moment
      let prey = null, best = 1.3 * G.W;
      for (let i = 0; i < 24; i++) { const m = comet(i, t, w, h); if (!m.coral) continue; const dd = Math.hypot(m.x - c.x, m.y - c.y); if (dd < best) { best = dd; prey = m; } }
      e.lock += (+!!prey - e.lock) * (1 - Math.exp(-dt / (prey ? 380 : 900)));
      if (prey && !e.chorus && e.lock > 0.5 && !e.eat && e.upper > 0.5 && t - (e.lastCatch ?? -1e9) > 2400) { e.eat = { x: prey.x, y: prey.y, t0: t, dur: 620 }; e.lastCatch = t; }
      if (e.eat && t >= e.eat.t0 + e.eat.dur) {
        const dx = e.eat.x - geo.x, dy = e.eat.y - geo.y, first = entryNode(net, dx, dy);
        fire(net, first, 1.35, true, t); fire(net, entryNode(net, dx, dy, first), 1.1, true, t);
        e.caught = (e.caught ?? 0) + 1; e.eat = null;
      }
      // Reading the lines: small boxes fly in, one after another, from wherever the eye is looking
      if (!e.chorus && e.open > 0.75 && e.upper > 0.55 && t >= (e.nextFrame ?? 0)) {
        let gx = e.gx, gy = e.gy;
        if (Math.hypot(gx, gy) < 0.15) { const a = rnd(e.seed, 60) * TAU + 3e-4 * t; gx = Math.cos(a); gy = 0.6 * Math.sin(a); }
        const r = Math.hypot(gx, gy) || 1, far = 1.3 + 0.25 * Math.random();
        (e.frames ??= []).push({ sx: c.x + (gx / r) * G.W * far + (Math.random() - 0.5) * G.W * 0.25, sy: c.y + (gy / r) * G.a * far * 1.1 + (Math.random() - 0.5) * G.a * 0.3, t0: t, dur: 650 + 350 * Math.random(), bow: (Math.random() - 0.5) * 0.4 });
        e.nextFrame = t + 240 + 380 * Math.random();
      }
      if (e.frames?.length) {
        for (const f of e.frames) if (t >= f.t0 + f.dur) fire(net, entryNode(net, f.sx - geo.x, f.sy - geo.y), 0.85, false, t);
        e.frames = e.frames.filter((f) => t < f.t0 + f.dur);
      }
      // Gaze
      const look = (x, y) => { const dx = x - c.x, dy = y - c.y, dd = Math.hypot(dx, dy) || 1, m = dd / (dd + 0.8 * G.W); return [(dx / dd) * m, (dy / dd) * m]; };
      let tau = 55;
      if (wave) { [e.tx, e.ty] = ptr.inside ? look(ptr.x, ptr.y) : look(wave.x, wave.y); tau = 90; }
      else if (prey) { [e.tx, e.ty] = look(prey.x, prey.y); tau = 70; }
      else if (recent) { [e.tx, e.ty] = look(ptr.x, ptr.y); tau = 110; }
      else if (now > e.nextSaccade) { e.tx = (2 * Math.random() - 1) * 0.75; e.ty = (2 * Math.random() - 1) * 0.5; e.nextSaccade = now + 700 + 1900 * Math.random(); }
      const dil = recent ? Math.max(0, 1 - Math.hypot(ptr.x - c.x, ptr.y - c.y) / (3 * G.W)) : 0;
      e.dilate += (dil - e.dilate) * (1 - Math.exp(-dt / 400));
      const z = 1 - Math.exp(-dt / tau);
      e.gx += (e.tx - e.gx) * z; e.gy += (e.ty - e.gy) * z;
    }
  }

  /* ---------- Drawing ---------- */
  function draw(now, t, list = eyes, p = ptr) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = DPR;
    const dtDraw = S.lastDraw ? Math.min(100, Math.max(0, t - S.lastDraw)) : 16;
    S.lastDraw = t; S.qs += (S.q - S.qs) * (1 - Math.exp(-dtDraw / 600));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = "butt";
    const G = grid(w, h), drift = 4e-5 * t, amp = G.a * (1 + 0.035 * Math.sin(35e-5 * t)), rows = [];
    for (let n = Math.floor(-G.y0 / G.d) - 1; G.y0 + n * G.d < h + G.d; n++) rows.push(n);
    // The pointer pushes the net apart a little
    const Rb = 1.35 * G.d, bendK = 9 * S.bend;
    const bent = (x, y, s = 1) => {
      if (bendK < 0.05) return [x, y];
      const dx = x - p.x, dy = y - p.y, r = Math.hypot(dx, dy);
      if (r >= Rb || r < 0.001) return [x, y];
      const m = Math.sin((r / Rb) * Math.PI) * (1 - r / Rb) * bendK * s * 1.6;
      return [x + (dx / r) * m, y + (dy / r) * m * 0.85];
    };
    const bx0 = p.x - Rb, bx1 = p.x + Rb;
    // Add the stretch [a, b] of a line to path: Bezier curves away from the pointer, bent point by point near it
    const addSeg = (path, a, b, Y, dY, xo, s, mayBend, move) => {
      const bez = (u, v) => {
        const n = Math.max(1, Math.ceil((v - u) / 38)), step = (v - u) / n;
        let x = u, y = Y(u), dy = dY(u);
        for (let i = 0; i < n; i++) { const x2 = x + step, y2 = Y(x2), dy2 = dY(x2); path.bezierCurveTo(x + step / 3 + xo, y + (dy * step) / 3, x2 - step / 3 + xo, y2 - (dy2 * step) / 3, x2 + xo, y2); x = x2; y = y2; dy = dy2; }
      };
      const useBend = mayBend && bendK >= 0.05, L0 = bx0 - xo, L1 = bx1 - xo;
      if (move) { if (useBend && a > L0 && a < L1) path.moveTo(...bent(a + xo, Y(a), s)); else path.moveTo(a + xo, Y(a)); }
      if (!useBend || b <= L0 || a >= L1) { bez(a, b); return; }
      if (a < L0) bez(a, L0);
      const u = Math.max(a, L0), v = Math.min(b, L1), n = Math.max(1, Math.ceil((v - u) / 4));
      for (let i = 1; i <= n; i++) { const x = u + ((v - u) * i) / n; path.lineTo(...bent(x + xo, Y(x), s)); }
      if (b > L1) bez(L1, b);
    };
    const segs = [];
    // A larger, fainter net in the background
    {
      const D = 1.6 * G.d, A = D / 2, k = Math.PI / ((A / 0.43) * 2), y0 = h / 2 - Math.round(h / 2 / D) * D + 0.5 * D, xo = -11 * p.sx, yo = -7 * p.sy;
      ctx.lineWidth = 0.7;
      for (const [m, alpha] of [[0, 0.12], [1, 0.06 * Math.max(0, 1 - S.qs)]]) {
        if (alpha <= 0.004) continue;
        ctx.strokeStyle = `rgba(${INK}, ${alpha})`;
        const path = new Path2D();
        for (let n = Math.floor(-y0 / D) - 1; y0 + n * D < h + D; n++) {
          const yc = y0 + n * D + yo, ph = 0.55 * rowPhase(n, t) + 1.1, near_ = Math.abs(yc - p.y) <= Rb + A + 12;
          for (const sg of [1, -1]) {
            const s0 = 5000 + 2 * n + (sg > 0 ? 0 : 1), amp2 = sg * A * (1 - 0.05 * m);
            const Y = (x) => yc + amp2 * Math.sin(k * x + ph + 0.04 * m), dY = (x) => amp2 * k * Math.cos(k * x + ph + 0.04 * m);
            segments(s0, k, ph + (sg > 0 ? 0 : 7.3), -8, w + 8, segs);
            for (let i = 0; i < segs.length; i += 3) addSeg(path, segs[i], segs[i + 1], Y, dY, xo, 0.45, near_, true);
          }
        }
        ctx.stroke(path);
      }
    }
    // Main net: 5 strands per line, bucketed by opacity into 20 paths that are stroked together; red segments are
    // drawn separately
    const over = S.q === 0 ? 4 : S.q === 1 ? 5 : 7, strands = S.qs <= 1 ? 5 - 2 * S.qs : 3 - (S.qs - 1), hairs = Math.min(5, Math.ceil(strands - 0.001));
    const buckets = Array(21).fill(null), redPath = new Path2D();
    for (const n of rows) {
      const yc = G.y0 + n * G.d, ph = rowPhase(n, t), near_ = Math.abs(yc - p.y) <= Rb + amp + 12;
      for (const sg of [1, -1]) {
        const s0 = 2 * n + (sg > 0 ? 0 : 1) + 1000;
        segments(s0, G.k, ph + (sg > 0 ? 0 : 7.3), -over, w + over, segs);
        for (let e = 0; e < hairs; e++) {
          const shrink = 1 - 0.045 * e, shift = (e - 2) * 0.035;
          const lvl = Math.round(20 * Math.min(1, (e === 0 ? 0.34 : 0.12 + 0.05 * rnd(7 * s0 + e, 5)) * clamp01(strands - e)));
          if (lvl < 1) continue;
          const path = (buckets[lvl] ??= new Path2D()), py = (e - 2) * p.sy * 3.2, px = (e - 2) * p.sx * 1.6, A = sg * amp * shrink;
          const Y = (x) => { const q = G.k * x + ph; return yc + A * Math.sin(q + shift) + py * Math.cos(q) + px * Math.sin(q); };
          const dY = (x) => { const q = G.k * x + ph; return G.k * (A * Math.cos(q + shift) - py * Math.sin(q) + px * Math.cos(q)); };
          let prevEnd = NaN, prevRed = -1;
          for (let i = 0; i < segs.length; i += 3) {
            const red = segs[i + 2] === 1 && e === 0 ? 1 : 0, joined = prevRed === red && Math.abs(prevEnd - segs[i]) < 0.01;
            addSeg(red ? redPath : path, segs[i], segs[i + 1], Y, dY, 0, 1, near_, !joined);
            prevEnd = segs[i + 1]; prevRed = red;
          }
        }
      }
    }
    ctx.lineWidth = 0.8;
    for (let i = 1; i <= 20; i++) if (buckets[i]) { ctx.strokeStyle = `rgba(${INK}, ${(i / 20).toFixed(3)})`; ctx.stroke(buckets[i]); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${RED}, 0.8)`; ctx.stroke(redPath);
    // Comets
    const onStrand = (m, x) => m.yc + m.sign * m.amp * Math.sin(m.k * x + m.phi);
    for (let i = 0; i < 24; i++) {
      const m = comet(i, t, w, h);
      ctx.lineWidth = m.coral ? 1.8 : 1.5;
      for (let j = 0; j < 14; j++) {
        const x0 = m.x - m.dir * (14 - j) * 3, x1 = m.x - m.dir * (14 - j - 1) * 3, al = ((j + 1) / 14) ** 1.6 * (m.coral ? 1 : 0.85);
        ctx.strokeStyle = `rgba(${m.coral ? RED : INK}, ${al.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(...bent(x0, onStrand(m, x0))); ctx.lineTo(...bent(x1, onStrand(m, x1))); ctx.stroke();
      }
    }
    // Tick marks along the edges
    ctx.strokeStyle = `rgba(${INK}, 0.45)`; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let i = Math.floor(drift / (Math.PI / 2)) - 2; ; i++) {
      const x = (i * Math.PI / 2 - drift) / G.k;
      if (x > w + 2) break;
      if (x < -2) continue;
      const len = i % 2 === 0 ? 7 : 3, X = Math.round(x) + 0.5;
      ctx.moveTo(X, 0); ctx.lineTo(X, len); ctx.moveTo(X, h); ctx.lineTo(X, h - len);
    }
    for (const n of rows) { const Y = Math.round(G.y0 + n * G.d) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(7, Y); ctx.moveTo(w, Y); ctx.lineTo(w - 7, Y); }
    ctx.stroke();
    // When a comet passes a crossing, the "+" there lights up
    for (let i = 0; i < 24; i++) {
      const m = comet(i, t, w, h), xc = (Math.round((m.k * m.x + m.phi) / Math.PI) * Math.PI - m.phi) / m.k, o = 1 - Math.min(1, Math.abs(m.x - xc) / 26);
      if (o <= 0) continue;
      const [X, Y] = bent(xc, m.yc), s = 3 + 5 * o;
      ctx.strokeStyle = `rgba(${m.coral ? RED : INK}, ${(0.35 + 0.6 * o).toFixed(3)})`; ctx.lineWidth = 1 + 0.8 * o;
      ctx.beginPath(); ctx.moveTo(X - s, Y); ctx.lineTo(X + s, Y); ctx.moveTo(X, Y - s); ctx.lineTo(X, Y + s); ctx.stroke();
    }
    // A small "+" at every crossing
    ctx.strokeStyle = `rgba(${INK}, 0.32)`; ctx.lineWidth = 0.8; ctx.beginPath();
    for (const n of rows) {
      const yc = G.y0 + n * G.d, ph = rowPhase(n, t);
      for (let i = Math.floor(ph / Math.PI) - 1; ; i++) {
        const x = (i * Math.PI - ph) / G.k;
        if (x > w + 4) break;
        if (x < -4) continue;
        const [X, Y] = bent(x, yc);
        ctx.moveTo(X - 3, Y); ctx.lineTo(X + 3, Y); ctx.moveTo(X, Y - 3); ctx.lineTo(X, Y + 3);
      }
    }
    ctx.stroke();
    // Dotted lines between open eyes (each eye links to its two nearest neighbors)
    const opened = new Map();
    for (const [key, e] of list) {
      if (e.open < 0.02) continue;
      const g = eyeGeom(key, e, t, w, h), [x, y] = bent(g.x, g.y), fr = e.frame ?? +!e.chorus;
      if (fr > 0.01) opened.set(key, { x, y, open: easeOut(e.open) * Math.min(1, 1.4 * e.upper) * fr });
    }
    {
      const pts = [...opened.entries()].filter(([, o]) => o.open > 0.3).map(([key, o]) => ({ key, x: o.x, y: o.y })), want = new Set();
      for (const a of pts) for (const b of pts.filter((q) => q.key !== a.key).sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y)).slice(0, 2)) want.add(a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`);
      const s = 1 - Math.exp(-dtDraw / 350);
      for (const id of want) if (!S.links.has(id)) S.links.set(id, 0);
      ctx.lineWidth = 0.7;
      for (const [id, v0] of S.links) {
        const v = v0 + (+want.has(id) - v0) * s, [ka, kb] = id.split("|"), A = opened.get(ka), B = opened.get(kb);
        if (v < 0.005 || !A || !B) { S.links.delete(id); continue; }
        S.links.set(id, v);
        const al = 0.14 * Math.min(A.open, B.open) * v * (1 - S.hush);
        if (al < 0.01) continue;
        let hh = 0; for (const c of ka + kb) hh = (31 * hh + c.charCodeAt(0)) >>> 0;
        const bow = (hh % 2 ? 1 : -1) * (0.12 + (hh % 7) * 0.012);
        ctx.strokeStyle = `rgba(${INK}, ${al.toFixed(3)})`; ctx.setLineDash([1.5, 3.5]); ctx.beginPath();
        for (let i = 0; i <= 24; i++) { const [x, y] = bowPoint(A.x, A.y, B.x, B.y, bow, i / 24); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    for (const [key, e] of list) drawEye(key, e, t, w, h, G, amp, dpr, bent, opened);
    // A very faint layer of grain, like paper
    ctx.globalAlpha = 1; ctx.fillStyle = ctx.createPattern((grain ??= buildGrain()), "repeat"); ctx.fillRect(0, 0, w, h);
  }

  function drawEye(key, e, t, w, h, G, amp, dpr, bent, opened) {
    if (e.open < 0.02) return;
    const [rn, rs] = key.split(",").map(Number), cx = (Math.PI / 2 + rs * Math.PI - rowPhase(rn, t)) / G.k, cy = G.y0 + rn * G.d, Wc = G.W;
    if (cx < -Wc || cx > w + Wc) return;
    const rest = 0.2 * amp, up = rest - 1.14 * amp * e.upper, lo = rest + 0.74 * amp * e.lower, lidPath = new Path2D();
    for (let i = 0; i <= 28; i++) { const x = cx - Wc + (2 * Wc * i) / 28, [X, Y] = bent(x, cy + up * Math.cos(G.k * (x - cx))); i ? lidPath.lineTo(X, Y) : lidPath.moveTo(X, Y); }
    for (let i = 28; i >= 0; i--) { const x = cx - Wc + (2 * Wc * i) / 28, [X, Y] = bent(x, cy + lo * Math.cos(G.k * (x - cx))); lidPath.lineTo(X, Y); }
    lidPath.closePath();
    const hot = e.flag ? 1 : smooth(e.lock);
    if (e.upper > 0.01) {
      ctx.save(); ctx.fillStyle = `rgb(${PAPER})`; ctx.fill(lidPath); ctx.clip(lidPath);
      const g = eyeGeom(key, e, t, w, h), R = g.R, [ix, iy] = bent(g.ix, g.iy), Rref = 1.12 * G.a;
      const stamp = (img, rot, sc, alpha) => {
        if (alpha <= 0.002) return;
        const half = img.width / dpr / 2, c = Math.cos(rot) * sc * (R / Rref), s = Math.sin(rot) * sc * (R / Rref);
        ctx.globalAlpha = alpha; ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * ix, dpr * iy); ctx.drawImage(img, -half, -half, 2 * half, 2 * half); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
      };
      const art = e.chorus ? chorusArt(Rref, dpr) : null;
      if (art) stamp(e.lite ? art.ticksLite : art.ticks, 5e-5 * t, 1, 1);
      else {
        ctx.strokeStyle = `rgba(${INK}, 0.5)`; ctx.lineWidth = 0.8; ctx.beginPath();
        for (let i = 0; i < 72; i += e.lite ? 2 : 1) { const a = (i / 72) * TAU + 5e-5 * t, r = R * (i % 6 === 0 ? 0.9 : 0.95); ctx.moveTo(ix + Math.cos(a) * r, iy + Math.sin(a) * r); ctx.lineTo(ix + Math.cos(a) * R, iy + Math.sin(a) * R); }
        ctx.stroke();
      }
      const mem = e.memory ?? 0, a0 = e.readA0 ?? 0;
      const ramp = (v, d0, len) => clamp01((800 * v - d0) / len), readF = (d0, len) => ramp(e.readP ?? 0, d0, len), irisF = (grp) => smooth(ramp(e.irisP ?? 0, 110 * grp, 560));
      const irisAll = ramp(e.irisP ?? 0, 0, 700), pop = 1 + 0.32 * (1 - easeOutBack(Math.min(1, e.age / 700))), lite = !!e.lite;
      // Iris: 7 rings of arcs of varying length, neighboring rings turning in opposite directions; when the eye locks
      // on, two of the outer rings turn red, and an eye that has swallowed red comets keeps a red "memory"
      for (let i = 0; i < 7; i++) {
        if (lite && i % 2 === 1) continue;
        const hide = irisAll > 0 ? irisF(i < 3 ? 0 : i < 5 ? 1 : 2) : 0;
        if (hide > 0.999) continue;
        if (hide > 0.001) { ctx.save(); ctx.beginPath(); ctx.moveTo(ix, iy); ctx.arc(ix, iy, 1.05 * R, a0 + hide * TAU, a0 + TAU); ctx.closePath(); ctx.clip(); }
        const r = R * (0.38 + 0.075 * i) * pop, rot = rnd(e.seed, i) * TAU + e.spin * (i % 2 ? 22e-5 : -16e-5) * (1 + 0.1 * i);
        if (art) {
          stamp(art.ink[i], rot, pop, 1);
          stamp(art.alt[i], rot, pop, e.flag && i === 4 ? 1 : i === 4 || i === 5 ? smooth((e.lock - 0.05) / 0.8) : 0);
          if (hide > 0.001) ctx.restore();
          continue;
        }
        const P = [new Path2D(), new Path2D(), new Path2D()], lk = smooth((e.lock - 0.05) / 0.8);
        let a = 0, j = 0;
        while (a < TAU - 0.1) {
          const len = 0.25 + 0.9 * rnd(17 * e.seed + 31 * i + j, 6), gap = 0.12 + 0.25 * rnd(13 * e.seed + 29 * i + j, 7);
          const memo = i >= 2 ? clamp01((mem - rnd(31 * e.seed + 17 * i + j, 41)) / 0.04) : 0, red = (e.flag && i === 4 && j % 2 === 0) || memo >= 1, warm = !red && (i === 4 || i === 5) && j % 2 === 0;
          const s0 = a + rot, s1 = Math.min(TAU - 0.05, a + len) + rot, add = (path) => { path.moveTo(ix + Math.cos(s0) * r, iy + Math.sin(s0) * r); path.arc(ix, iy, r, s0, s1); };
          if (red) add(P[2]);
          else if (memo > 0 || (warm && lk > 0)) {
            const mix = Math.max(memo, warm ? lk : 0), base = rnd(e.seed + i, j) < 0.5 ? 0.49 : 0.66;
            ctx.lineWidth = 0.9 + 0.7 * mix; ctx.strokeStyle = `rgba(${INK}, ${(base * (1 - mix)).toFixed(3)})`; ctx.beginPath(); ctx.arc(ix, iy, r, s0, s1); ctx.stroke();
            ctx.strokeStyle = `rgba(${RED}, ${(0.95 * mix).toFixed(3)})`; ctx.beginPath(); ctx.arc(ix, iy, r, s0, s1); ctx.stroke();
          } else add(P[rnd(e.seed + i, j) < 0.5 ? 0 : 1]);
          a += len + gap; j++;
        }
        ctx.lineWidth = 0.9; ctx.strokeStyle = `rgba(${INK}, 0.49)`; ctx.stroke(P[0]); ctx.strokeStyle = `rgba(${INK}, 0.66)`; ctx.stroke(P[1]);
        ctx.lineWidth = 1.6; ctx.strokeStyle = `rgba(${RED}, 0.95)`; ctx.stroke(P[2]);
        if (hide > 0.001) ctx.restore();
      }
      // Readout: three rings of digits are swept in, starting from the direction of the click; the sweep line is green
      if (irisAll > 0.001) {
        const size = Math.max(4.5, 0.11 * R), settled = digitRings("settled", Rref, dpr, t), scramble = digitRings("scramble", Rref, dpr, t);
        READ_RINGS.forEach((f, ri) => {
          if (lite && ri === 1) return;
          const c = irisF(ri);
          if (c <= 0.001) return;
          const rr = R * f * pop, rot = rnd(e.seed, ri + 10) * TAU + e.spin * (ri % 2 ? 18e-5 : -13e-5);
          const sector = (s0, s1) => { ctx.save(); ctx.beginPath(); ctx.moveTo(ix, iy); ctx.arc(ix, iy, rr + size, s0, s1); ctx.closePath(); ctx.clip(); };
          if (c >= 1) { stamp(settled[ri], rot, pop, 1); return; }
          const edge = Math.min(c, 0.08);
          if (c - edge > 0.001) { sector(a0, a0 + (c - edge) * TAU); stamp(settled[ri], rot, pop, 1); ctx.restore(); }
          sector(a0 + (c - edge) * TAU, a0 + c * TAU); stamp(scramble[ri], rot, pop, 1); ctx.restore();
          const ang = a0 + c * TAU;
          ctx.strokeStyle = `rgba(${GREEN}, 0.95)`; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(ix + Math.cos(ang) * (rr - 0.75 * size), iy + Math.sin(ang) * (rr - 0.75 * size)); ctx.lineTo(ix + Math.cos(ang) * (rr + 0.75 * size), iy + Math.sin(ang) * (rr + 0.75 * size)); ctx.stroke();
        });
      }
      // The pupil and the small network inside it
      const pr = R * (0.33 + 0.05 * e.dilate + 0.08 * (1 - easeOut(e.age / 900))) * (1 + 0.1 * irisAll), [px, py] = bent(g.x, g.y);
      ctx.fillStyle = `rgba(${INK}, 0.96)`; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      const net = (e.net ??= makeNet(e.seed));
      ctx.save(); ctx.beginPath(); ctx.arc(px, py, 0.95 * pr, 0, TAU); ctx.clip();
      const sc = 0.86 * pr, X = (i) => px + net.nodes[i].x * sc, Y = (i) => py + net.nodes[i].y * sc, lw = Math.max(0.6, pr / 16);
      const fade = net.nodes.map((n) => smooth(readF(60 + 380 * (((Math.atan2(n.y, n.x) - a0) % TAU + TAU) % TAU / TAU), 320)));
      const fadeAvg = fade.reduce((s, v) => s + v, 0) / Math.max(1, fade.length), edgeB = Array.from({ length: 8 }, () => new Path2D());
      for (const ed of net.edges) {
        const A = net.nodes[ed.a], B = net.nodes[ed.b];
        if (!A || !B) continue;
        const fa = fade[ed.a], fb = fade[ed.b];
        if (Math.max(fa, fb) > 0.999) continue;
        const lit = Math.max(A.lit, B.lit), dx = X(ed.b) - X(ed.a), dy = Y(ed.b) - Y(ed.a);
        const x0 = X(ed.a) + 0.5 * dx * fb, y0 = Y(ed.a) + 0.5 * dy * fb, x1 = X(ed.b) - 0.5 * dx * fa, y1 = Y(ed.b) - 0.5 * dy * fa;
        if (lit < 0.02) { const b = edgeB[Math.min(7, Math.floor(8 * ed.w))]; b.moveTo(x0, y0); b.lineTo(x1, y1); continue; }
        const warm = clamp01(Math.max(Math.min(A.lit * A.coral, B.lit * B.coral) / 0.3, lit * Math.max(A.coral, B.coral) - 0.1)), al = ed.w ** 1.4 * (0.55 + 0.45 * lit);
        ctx.lineWidth = (0.35 + 0.65 * ed.w) * lw;
        const seg = new Path2D(); seg.moveTo(x0, y0); seg.lineTo(x1, y1);
        if (warm < 0.99) { ctx.strokeStyle = `rgba(${PAPER}, ${(al * (1 - warm)).toFixed(3)})`; ctx.stroke(seg); }
        if (warm > 0.01) { ctx.strokeStyle = `rgba(${RED}, ${(Math.min(1, al + 0.1) * warm).toFixed(3)})`; ctx.stroke(seg); }
      }
      edgeB.forEach((b, i) => { const v = (i + 0.5) / 8; ctx.strokeStyle = `rgba(${PAPER}, ${(0.55 * v ** 1.4).toFixed(3)})`; ctx.lineWidth = (0.35 + 0.65 * v) * lw; ctx.stroke(b); });
      ctx.globalAlpha = 1 - fadeAvg;
      for (const sp of net.spikes) {
        if (!net.nodes[sp.a] || !net.nodes[sp.b]) continue;
        const u = smooth((t - sp.t0) / sp.dur), x = X(sp.a) + (X(sp.b) - X(sp.a)) * u, y = Y(sp.a) + (Y(sp.b) - Y(sp.a)) * u;
        const xt = X(sp.a) + (X(sp.b) - X(sp.a)) * Math.max(0, u - 0.28), yt = Y(sp.a) + (Y(sp.b) - Y(sp.a)) * Math.max(0, u - 0.28), col = sp.coral ? RED : PAPER;
        ctx.strokeStyle = `rgba(${col}, 0.7)`; ctx.lineWidth = 0.9 * lw; ctx.beginPath(); ctx.moveTo(xt, yt); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(${col}, 0.98)`; ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, 0.045 * pr), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const dots = new Path2D();
      net.nodes.forEach((n, i) => {
        if (fade[i] > 0.999) return;
        const r = Math.max(0.8, 0.058 * pr) * (1 + 0.45 * n.lit) * (1 - fade[i]);
        if (n.lit < 0.01) { dots.moveTo(X(i) + r, Y(i)); dots.arc(X(i), Y(i), r, 0, TAU); return; }
        const warm = clamp01((n.coral * n.lit - 0.05) / 0.3);
        for (const glow of [true, false]) {
          const s = new Path2D(); s.arc(X(i), Y(i), glow ? 2.6 * r : r, 0, TAU);
          const al = glow ? 0.22 * n.lit : 0.36 + 0.62 * n.lit;
          if (warm < 0.99) { ctx.fillStyle = `rgba(${PAPER}, ${(al * (1 - warm)).toFixed(3)})`; ctx.fill(s); }
          if (warm > 0.01) { ctx.fillStyle = `rgba(${RED}, ${(al * warm).toFixed(3)})`; ctx.fill(s); }
        }
      });
      ctx.fillStyle = `rgba(${PAPER}, 0.36)`; ctx.fill(dots);
      if (fadeAvg > 0.001) {
        net.nodes.forEach((n, i) => {
          const v = fade[i];
          if (v <= 0.001) return;
          const k = 0.7 + 0.3 * v + 0.18 * Math.sin(Math.PI * v), size = Math.max(4, 0.3 * pr) * (1 + 0.25 * n.lit) * k, per = v < 1 ? 40 : n.lit > 0.3 ? 70 : 150 + (i % 4) * 60;
          glyph(ctx, dpr, String(Math.floor(10 * rnd(31 * e.seed + i, Math.floor((t + 53 * i) / per)))), 2, X(i), Y(i), size, 0, (0.6 + 0.4 * Math.max(n.lit, 1 - v)) * v);
        });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.strokeStyle = `rgba(${PAPER}, ${(0.08 + 0.1 * hot).toFixed(3)})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(px, py, 0.93 * pr, 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = `rgba(${INK}, 0.85)`; ctx.lineWidth = 1.1; ctx.stroke(lidPath);
    } else {
      ctx.strokeStyle = `rgba(${INK}, 0.85)`; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let i = 0; i <= 28; i++) { const x = cx - Wc + (2 * Wc * i) / 28, [X, Y] = bent(x, cy + rest * Math.cos(G.k * (x - cx))); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }
    // Boxes flying in, and the red comet being swallowed
    const me = opened.get(key);
    if (me && e.upper > 0.3) {
      for (const f of e.frames ?? []) {
        const u = (t - f.t0) / f.dur;
        if (u < 0 || u > 1) continue;
        const v = smooth(u), [sx, sy] = bent(f.sx, f.sy), [x, y] = bowPoint(sx, sy, me.x, me.y, f.bow, v), al = Math.min(1, u / 0.2) * Math.min(1, (1 - u) / 0.25) * 0.75, s = 2.6 * (1 - 0.6 * v);
        ctx.strokeStyle = `rgba(${INK}, ${al.toFixed(3)})`; ctx.lineWidth = 0.7; ctx.strokeRect(x - s / 2, y - 0.38 * s, s, 0.76 * s);
      }
      if (e.eat) {
        const u = (t - e.eat.t0) / e.eat.dur;
        if (u >= 0 && u <= 1) {
          const uu = u * u, [sx, sy] = bent(e.eat.x, e.eat.y), tail = 0.16 * (1 - uu);
          ctx.strokeStyle = `rgba(${RED}, ${(0.95 * Math.min(1, (1 - u) / 0.15)).toFixed(3)})`; ctx.lineWidth = 1.8; ctx.beginPath();
          for (let i = 0; i <= 6; i++) { const [x, y] = bowPoint(sx, sy, me.x, me.y, 0.22, Math.max(0, uu - tail + (tail * i) / 6)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke();
        }
      }
    }
    // Corner brackets around the cell: they close in from outside as the eye opens, and turn red when it locks on to
    // a red comet
    const R2 = easeOut((e.open - 0.35) / 0.65), show = (e.frame ?? +!e.chorus) * (1 - S.hush);
    if (R2 > 0.01 && show > 0.01) {
      const [X, Y] = bent(cx, cy), sc = 1 + 0.12 * (1 - R2), hw = 1.06 * Wc * sc, hh = 1.12 * amp * sc, arm = Math.min(12, 0.12 * Wc) * R2, c = clamp01(hot), box = new Path2D();
      ctx.lineWidth = 1.2 + 0.6 * e.lock;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { box.moveTo(X + sx * hw, Y + sy * (hh - arm)); box.lineTo(X + sx * hw, Y + sy * hh); box.lineTo(X + sx * (hw - arm), Y + sy * hh); }
      if (c < 0.99) { ctx.strokeStyle = `rgba(${INK}, ${(0.85 * R2 * show * (1 - c)).toFixed(3)})`; ctx.stroke(box); }
      if (c > 0.01) { ctx.strokeStyle = `rgba(${RED}, ${(0.9 * R2 * show * c).toFixed(3)})`; ctx.stroke(box); }
    }
  }

  // Static version (prefers-reduced-motion): four eyes open at fixed positions
  function stillEyes(w, h) {
    const list = new Map();
    [[0.2, 0.25], [0.6, 0.25], [0.4, 0.72], [0.8, 0.72]].forEach(([fx, fy], i) => {
      const c = cellAt(w * fx, h * fy, 6000);
      list.set(c.key, newEye({ open: 1, until: Infinity, blinkAt: Infinity, gx: 0.15, gy: -0.05, seed: i + 3, flag: i === 1, upper: 1, lower: 1, age: 2000, nextSaccade: Infinity }));
    });
    return list;
  }

  return stage(canvas, {
    frame(f) {
      ctx = f.ctx; DPR = f.dpr; S.q = f.q;
      Object.assign(ptr, { x: f.ptr.x, y: f.ptr.y, at: f.ptr.at, inside: f.ptr.inside });
      if (f.still) { draw(0, 6000, stillEyes(f.w, f.h), { ...ptr, sx: 0, sy: 0 }); return; }
      // Two clocks: now is in ms; t, used by the net and the comets, runs 6 s ahead of it, so they are already in
      // motion on the first frame
      update(f.t, f.t + 6000);
      draw(f.t, f.t + 6000);
    },
    click(x, y, t) { clickAt = t; click = { x, y }; },
    colors: setColors,
    stillT: 0,
  });
}
