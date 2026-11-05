// Ripple: three thin rings of ripples spread out from the clicked spot one after another, fainter the further out they get
// (the same idea as the "Ripples" header animation)
import { animate, overlay, palette, pageRect, TAU, easeOut } from "./kit.js";

export const meta = { id: "ripple", name: "涟漪" };

export function play(target, origin, { big = false } = {}) {
  const o = pageRect(origin ?? target);
  const { ink, red } = palette();
  const R0 = Math.max(6, Math.min(o.w, o.h) / 2), reach = big ? 150 : 64, D = big ? 1.25 : 0.95;
  const rings = [0, 0.14, 0.28].map((delay, i) => ({ delay, color: i === 1 ? red : ink }));
  let t = 0;
  return overlay(animate((dt, ctx) => {
    t += dt;
    let alive = false;
    for (const g of rings) {
      const u = (t - g.delay) / D;
      if (u < 0) { alive = true; continue; }
      if (u > 1) continue;
      alive = true;
      const k = easeOut(u), fade = (1 - u) ** 1.4;
      ctx.strokeStyle = g.color(0.6 * fade); ctx.lineWidth = 0.6 + 1.6 * fade;
      ctx.beginPath(); ctx.arc(o.cx, o.cy, R0 + reach * k, 0, TAU); ctx.stroke();
    }
    return alive;
  }));
}
