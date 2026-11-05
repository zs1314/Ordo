// Dust: the card crumbles into dust bit by bit from right to left, and the dust drifts off to the upper right and fades.
// The card's pixels cannot be drawn (browsers do not allow rendering the DOM into a canvas), so the dust comes from the
// places where the card has something on it: wherever each run of text sits, buttons with a background, and the borders
// of the card and its buttons, each in its own color. A copy of the card covers the original in the same place, and a
// mask sweeping from right to left hides the part that has already crumbled.
import { animate, layer, cloneOf, pageRect, hide, unhide, rand, clamp, wait } from "./kit.js";

export const meta = { id: "dust", name: "化成灰" };

export function play(target) {
  const L = layer(), r = pageRect(target);
  const ghost = cloneOf(target, L.el).firstChild;
  hide(target);
  const T = clamp(r.w * 2.4, 560, 980) / 1000; // seconds to sweep across the whole card
  const EDGE = 26; // width of the gradient along the mask's edge
  const grains = sample(target, r).map((g) => {
    const tr = (1 - (g.x - r.x) / r.w) * T + rand(0, 0.09); // the right side crumbles first
    // Each grain starts with a slightly random velocity and is soon blown away (otherwise the grains stay lined up in
    // rows and look like dot-matrix text)
    return { ...g, tr, vx: rand(-30, 90), vy: rand(-70, 30), wind: rand(140, 300), lift: rand(40, 140), ph: rand(0, 6.3), life: rand(0.5, 0.95), s: rand(1.1, 2.1) };
  });
  // Group by color: fillStyle is set once per color
  const groups = new Map();
  for (const g of grains) { if (!groups.has(g.color)) groups.set(g.color, []); groups.get(g.color).push(g); }

  let t = 0, stopped = false;
  const mask = (p) => {
    const m = `linear-gradient(to right, #000 ${(p - EDGE).toFixed(1)}px, transparent ${p.toFixed(1)}px)`;
    ghost.style.maskImage = m;
    ghost.style.webkitMaskImage = m;
  };
  mask(r.w + EDGE);
  const done = animate((dt, ctx) => {
    if (stopped) return false;
    t += dt;
    mask(r.w + EDGE - (t / T) * (r.w + EDGE * 2)); // the mask's edge sweeps from right to left
    let alive = 0;
    for (const [color, gs] of groups) {
      ctx.fillStyle = color;
      for (const g of gs) {
        const age = t - g.tr;
        if (age < 0) { alive++; continue; }
        if (age > g.life) continue;
        alive++;
        // Wind: blows toward the upper right, with a little swirl
        g.vx += (g.wind - g.vx) * 3.2 * dt + Math.sin(g.ph + age * 9) * 220 * dt;
        g.vy += (-g.lift - g.vy) * 2.6 * dt + Math.cos(g.ph + age * 7) * 200 * dt;
        g.x += g.vx * dt; g.y += g.vy * dt;
        const k = 1 - age / g.life;
        ctx.globalAlpha = k * g.a;
        ctx.fillRect(g.x, g.y, g.s * (0.5 + 0.5 * k), g.s * (0.5 + 0.5 * k));
      }
    }
    if (t > T + 0.15 && ghost.isConnected) ghost.parentElement.remove();
    return alive > 0 || t < T + 0.15;
  }).then(() => { ghost.parentElement?.remove(); L.release(); });
  return {
    took: true,
    ready: wait((T + 0.5) * 1000), // remove the card only after all of it has crumbled and the dust is mostly gone (otherwise the next card slides in and the dust lands on it)
    done,
    restore() { stopped = true; unhide(target); },
  };
}

// Where the card has something on it and in what color (page coordinates): text, elements with a background, borders.
// At most 1800 grains.
function sample(root, r) {
  const out = [];
  const add = (x, y, color, a = 1) => { if (x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 1 && y <= r.y + r.h + 1) out.push({ x, y, color, a }); };
  // Text: scatter grains within each line of text (a little below the middle, where the strokes are)
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement) continue;
    const color = getComputedStyle(n.parentElement).color, range = document.createRange();
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      const k = Math.min(500, Math.round((q.width * q.height) / 11));
      for (let i = 0; i < k; i++) add(q.left + scrollX + rand(0, q.width), q.top + scrollY + q.height * rand(0.22, 0.8), color);
    }
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const cs = getComputedStyle(el), q = el.getBoundingClientRect();
    if (!q.width || !q.height) continue;
    const x0 = q.left + scrollX, y0 = q.top + scrollY;
    // Elements with a background (buttons): only opaque enough backgrounds count; the card's own background is about the
    // same as the page's, so it gets no grains
    if (el !== root && alpha(cs.backgroundColor) > 0.35) {
      const k = Math.min(420, Math.round((q.width * q.height) / 26));
      for (let i = 0; i < k; i++) add(x0 + rand(0, q.width), y0 + rand(0, q.height), cs.backgroundColor);
    }
    // Borders: scatter grains along all four edges
    if (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.08) {
      const per = 2 * (q.width + q.height), k = Math.min(500, Math.round(per / 2.4));
      for (let i = 0; i < k; i++) {
        let d = rand(0, per);
        const p = d < q.width ? [x0 + d, y0] : (d -= q.width) < q.height ? [x0 + q.width, y0 + d] : (d -= q.height) < q.width ? [x0 + q.width - d, y0 + q.height] : [x0, y0 + q.height - (d - q.width)];
        add(p[0], p[1], cs.borderTopColor);
      }
    }
  }
  // If there are too many, keep a random 1800
  for (let i = out.length - 1; i > 0 && out.length > 1800; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, 1800);
}

// Opacity of a color: rgb(…) is 1, rgba(…, a) is a; anything unrecognized counts as 1
function alpha(c) {
  if (!c || c === "transparent") return 0;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? parseFloat(parts[3]) : 1;
}
