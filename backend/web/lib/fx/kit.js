// Shared groundwork for the completion effects (confetti, shatter, stamp, ...):
//   a canvas laid over the top of the page: confetti, fireworks, sparks, ripples and dust are all drawn on it (animate)
//   a layer for copied elements: the shards, the stamp and the card that slowly vanishes in dust all live here
//   (layer, cloneOf)
//   colors (palette): ink and red (the header animation's --hero-flag), following light/dark mode
// Everything uses page coordinates (it scrolls with the page) and does not block clicks; the canvas and the layer are
// removed once the effects have finished.
// One effect per file. It exports meta (id, name) and play(target, origin, { big }), which returns { took, ready, done, restore }:
//   took    the effect took target away (shatter, dust, stamp): no fade-out needed
//   ready   it is OK to save now (the card can be removed from the page)
//   done    everything has finished playing
//   restore put target back (the save failed, or it was only a preview in the settings)

export const TAU = Math.PI * 2;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The current colors: ink, red, paper, and the accent color (the same as ink when none is set) */
export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const ink = v("--foreground"), red = v("--hero-flag"), paper = v("--card"), accent = v("--accent");
  return { ink: (a = 1) => `hsl(${ink} / ${a})`, red: (a = 1) => `hsl(${red} / ${a})`, paper: (a = 1) => `hsl(${paper} / ${a})`, accent: accent && !accent.includes(ink) ? accent : "" };
}

/** An element's position on the page (page coordinates) */
export function pageRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, cx: r.left + scrollX + r.width / 2, cy: r.top + scrollY + r.height / 2 };
}

/** The return value for effects that do not take target away */
export const overlay = (done) => ({ took: false, ready: Promise.resolve(), done, restore() {} });

// ---- Canvas ----

let cv = null, cx = null, dpr = 1, raf = 0, last = 0;
const systems = new Set();

function fit() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
}
function frame(t) {
  const dt = Math.min(0.034, Math.max(0, (t - last) / 1000)) || 1 / 60;
  last = t;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, cv.width, cv.height);
  const view = { x: scrollX, y: scrollY, w: innerWidth, h: innerHeight };
  for (const s of systems) {
    cx.setTransform(dpr, 0, 0, dpr, -scrollX * dpr, -scrollY * dpr); // page coordinates
    cx.globalAlpha = 1;
    let alive = false;
    try { alive = s.step(dt, cx, view); } catch (err) { console.error("fx failed", err); }
    if (!alive) { systems.delete(s); s.end(); }
  }
  if (systems.size) { raf = requestAnimationFrame(frame); return; }
  raf = 0;
  removeEventListener("resize", fit);
  cv.remove();
  cv = cx = null;
}

/** Run an animation on the canvas: step(dt in seconds, ctx, view) is called every frame, and returning false ends it.
 *  Returns a Promise that resolves when it ends */
export function animate(step) {
  if (!cv) {
    cv = document.createElement("canvas");
    cv.className = "fx-canvas";
    cv.setAttribute("aria-hidden", "true");
    document.body.append(cv);
    cx = cv.getContext("2d");
    fit();
    addEventListener("resize", fit);
  }
  return new Promise((end) => {
    systems.add({ step, end });
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
}

/** For animations that only change the DOM instead of drawing on the canvas: step(dt in seconds) is called every frame,
 *  and returning false ends it */
export function loop(step) {
  return new Promise((end) => {
    let prev = performance.now();
    const f = (t) => {
      const dt = Math.min(0.034, Math.max(0, (t - prev) / 1000)) || 1 / 60;
      prev = t;
      let more = false;
      try { more = step(dt); } catch (err) { console.error("fx failed", err); }
      if (more) requestAnimationFrame(f); else end();
    };
    requestAnimationFrame(f);
  });
}

// ---- Layer ----

let layerEl = null, users = 0;

/** Borrow the layer: call release() when done; it is removed once nobody is using it */
export function layer() {
  if (!layerEl) {
    layerEl = document.createElement("div");
    layerEl.className = "fx-layer";
    layerEl.setAttribute("aria-hidden", "true");
    document.body.append(layerEl);
  }
  users++;
  let released = false;
  return {
    el: layerEl,
    release() {
      if (released) return;
      released = true;
      if (--users === 0) { layerEl.remove(); layerEl = null; }
    },
  };
}

/** Copy an element into the layer, at the original position, looking exactly the same. The copy is wrapped in a shell
 *  with the same class names as its parent element, so styles written against the parent, such as ".agent-grid > .card",
 *  match the copy too. ids and data-* attributes are removed from the copy so it does not get mixed up with the original */
export function cloneOf(el, into) {
  const r = pageRect(el);
  const wrap = document.createElement("div");
  wrap.className = el.parentElement?.className ?? "";
  Object.assign(wrap.style, {
    position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`,
    margin: "0", padding: "0", display: "block", border: "0", background: "none", boxShadow: "none", transform: "none", opacity: "1",
  });
  const c = el.cloneNode(true);
  for (const n of [c, ...c.querySelectorAll("*")]) {
    n.removeAttribute("id");
    for (const a of [...n.attributes]) if (a.name.startsWith("data-")) n.removeAttribute(a.name);
  }
  Object.assign(c.style, { width: "100%", height: "100%", margin: "0", visibility: "visible", transition: "none", animation: "none", transform: "none", opacity: "1" });
  wrap.append(c);
  into.append(wrap);
  return wrap;
}

/** Hide and unhide (hiding does not change the layout) */
export const hide = (el) => { el.style.visibility = "hidden"; };
export const unhide = (el) => { el.style.visibility = ""; };
