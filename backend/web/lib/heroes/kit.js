// Shared groundwork for the header animations: canvas size, animation loop, pausing when scrolled off screen,
// prefers-reduced-motion, mouse, colors, automatic quality reduction, error protection.
// One header animation per file, and each only "draws a frame"; see README.md in this directory for the format:
//
//   export const meta = { id: "xxx", name: "Name", hint: "One-line description (shown only on the preview page)" };
//   export function mount(canvas) {
//     return stage(canvas, {
//       frame({ ctx, w, h, t, dt, q, ptr, ink, red, paper, col, dpr, still }) { ... },
//       click(x, y, t) { ... },      // optional: a click
//       colors(col) { ... },         // optional: light/dark mode changed (for rebuilding caches)
//       stillT: 4000,                // optional: which moment the still frame shows
//     });
//   }
//
// frame's arguments:
//   t, dt   milliseconds; t counts from mounting and shares one timeline with clicks and mouse events
//   q       quality 0/1/2, higher is cheaper (raised automatically when a frame takes too long to draw)
//   ptr     mouse: x, y raw position, inside whether it is over the header animation, at the time it last moved;
//           sx, sy smoothed position, k smoothed "inside" (0 to 1)
//   ink(a), red(a)  ink and red with alpha; paper the background color; col holds the raw "r, g, b" values
//   still   true means this is a still frame (prefers-reduced-motion); do not advance the simulation then
// Returns { setColors({ ink, paper, red }), destroy() }. Colors are passed as the HSL triples from the CSS variables.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export const easeInOut = (v) => { const t = clamp(v); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const easeOut = (v) => 1 - (1 - clamp(v)) ** 3;
// Exponential smoothing factor: each frame, x += (target - x) * damp(dt, time constant)
export const damp = (dt, ms) => 1 - Math.exp(-dt / ms);
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; };

export function hslToRgb(hsl) {
  const m = String(hsl ?? "").trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `${f(0)}, ${f(8)}, ${f(4)}`;
}

// Reproducible random numbers
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());

// Smooth value noise, output roughly in [-1, 1]
const PERM = (() => { const r = rng(404), p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return Uint8Array.from([...p, ...p]); })();
const VAL = Float32Array.from({ length: 256 }, (_, i) => (PERM[i] / 255) * 2 - 1);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi, u = fade(xf), v = fade(yf), w = fade(zf);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const c = (dx, dy, dz) => VAL[PERM[PERM[PERM[X + dx] + Y + dy] + Z + dz]];
  const a = lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v);
  const b = lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v);
  return lerp(a, b, w);
}

const FRAME_MS = [1000 / 60, 1000 / 60, 1000 / 30];

export function stage(canvas, scene) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return { setColors() {}, destroy() {} };
  const col = { ink: "24, 24, 24", paper: "255, 255, 255", red: "179, 38, 60" };
  const ink = (a) => `rgba(${col.ink}, ${a})`, red = (a) => `rgba(${col.red}, ${a})`;
  const ptr = { x: -1e4, y: -1e4, inside: false, at: -1e9, sx: -1e4, sy: -1e4, k: 0 };
  const t0 = performance.now(), mq = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = mq.matches, raf = 0, onScreen = false, lastFrame = -1e9, cost = 0, q = 0, slowSince = -1, fastSince = -1, failed = false;
  // The header animation's time: follows the latest frame; clicks and mouse events use it too, so they share one timeline
  // with the picture
  let lastT = 0, lastWall = 0;
  const clock = () => (lastWall ? lastT + (performance.now() - lastWall) : performance.now() - t0);

  function render(t, dt, still) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 0 ? 2 : q === 1 ? 1.5 : 1.25);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.setLineDash([]); ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    const paper = `rgb(${col.paper})`;
    ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
    // Smoothed mouse: on entering (when it was barely inside on the previous frame) jump straight to the position instead
    // of sliding over from where it last left
    const inside = ptr.inside && !still, away = ptr.k < 0.02;
    ptr.k = still ? 0 : ptr.k + ((inside ? 1 : 0) - ptr.k) * damp(dt, 250);
    const s = away ? 1 : damp(dt, 90);
    ptr.sx += (ptr.x - ptr.sx) * s; ptr.sy += (ptr.y - ptr.sy) * s;
    // An error in one frame must not stop the whole animation; report it to the console only once
    try { scene.frame({ ctx, w, h, dpr, t, dt, q, ptr, ink, red, paper, col, still }); }
    catch (err) { if (!failed) { failed = true; console.error("hero frame failed", err); } }
  }
  function loop(ts) {
    raf = 0;
    if (!onScreen || reduced) return;
    if (ts - lastFrame >= FRAME_MS[q] - 3) {
      const dt = lastFrame > 0 ? Math.min(64, ts - lastFrame) : 16, c0 = performance.now();
      lastT = ts - t0; lastWall = c0;
      render(lastT, dt, false);
      const c = performance.now() - c0;
      cost = cost ? 0.9 * cost + 0.1 * c : c;
      // Lower the quality when frames take too long to draw, and raise it again when they stay fast
      if (cost > 11 && q < 2) { if (slowSince < 0) slowSince = ts; if (ts - slowSince > 700) { q++; cost = 0; slowSince = -1; } } else slowSince = -1;
      if (cost < 3.5 && q > 0) { if (fastSince < 0) fastSince = ts; if (ts - fastSince > 8000) { q--; cost = 0; fastSince = -1; } } else fastSince = -1;
      lastFrame = ts;
    }
    raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (onScreen && !reduced && !raf) { lastFrame = -1e9; raf = requestAnimationFrame(loop); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const still = () => render(scene.stillT ?? 4000, 0, true);
  const redraw = () => (reduced ? still() : render(clock(), 0, false));

  const local = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top, r.width, r.height]; };
  const onMove = (ev) => { const [x, y, w, h] = local(ev); ptr.x = x; ptr.y = y; ptr.at = clock(); ptr.inside = x >= 0 && y >= 0 && x <= w && y <= h; };
  const onOut = (ev) => { if (!ev.relatedTarget) ptr.inside = false; };
  // With prefers-reduced-motion the picture stays at the stillT moment, so clicks are recorded at that moment too (with the
  // real time, a click after stillT would happen in the picture's "future", the radius would come out negative, and that
  // frame would fail to draw)
  const hit = (ev) => {
    const [x, y] = local(ev), t = reduced ? scene.stillT ?? 4000 : clock();
    ptr.x = x; ptr.y = y; ptr.inside = true; ptr.at = t;
    try { scene.click?.(x, y, t); } catch (err) { console.error("hero click failed", err); }
    if (reduced) still();
  };
  // A finger pressing down may be the start of a page scroll: it only counts as a tap when it lifts without having turned
  // into a scroll (pointercancel) in between
  let touch = null;
  const onDown = (ev) => { if (ev.pointerType === "touch") touch = ev.pointerId; else hit(ev); };
  const onUp = (ev) => { if (ev.pointerType === "touch" && touch === ev.pointerId) { touch = null; hit(ev); } };
  const onCancel = () => { touch = null; };
  const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; if (!onScreen) stop(); else if (reduced) still(); else kick(); }, { rootMargin: "120px 0px", threshold: 0.01 });
  const ro = new ResizeObserver(() => { if (reduced || !raf) redraw(); });
  const onReduce = (m) => { reduced = m.matches; stop(); if (reduced) still(); else kick(); };
  io.observe(canvas); ro.observe(canvas);
  mq.addEventListener("change", onReduce);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerout", onOut);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  if (reduced) still(); else render(0, 16, false);

  return {
    setColors({ ink: i, paper: p, red: r } = {}) {
      col.ink = hslToRgb(i) ?? col.ink; col.paper = hslToRgb(p) ?? col.paper; col.red = hslToRgb(r) ?? col.red;
      try { scene.colors?.(col); } catch (err) { console.error("hero colors failed", err); }
      if (reduced || !raf) redraw();
    },
    destroy() {
      stop(); io.disconnect(); ro.disconnect(); mq.removeEventListener("change", onReduce);
      window.removeEventListener("pointermove", onMove); document.removeEventListener("pointerout", onOut); canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onCancel);
      scene.destroy?.();
    },
  };
}
