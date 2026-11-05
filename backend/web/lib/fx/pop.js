// Sparks: on a check-in the cell first shrinks a little and then pops larger, a thin ring spreads out around it, and a
// dozen or so short lines burst outward along with a few small dots. Over in about half a second: short and crisp
import { animate, overlay, palette, pageRect, rand, TAU, easeOut } from "./kit.js";

export const meta = { id: "pop", name: "火花" };

export function play(target, origin, { big = false } = {}) {
  const el = origin ?? target, o = pageRect(el);
  const { ink, red } = palette();
  const R0 = Math.min(big ? 26 : 18, Math.max(10, Math.min(o.w, o.h) / 2)), reach = big ? 34 : 22;
  el.animate?.([{ transform: "scale(1)" }, { transform: "scale(.8)", offset: 0.25 }, { transform: "scale(1.16)", offset: 0.65 }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
  const n = 12, a0 = rand(0, TAU);
  const rays = Array.from({ length: n }, (_, i) => ({ a: a0 + (i / n) * TAU, len: rand(0.75, 1.1), color: i % 2 ? red : ink }));
  const dots = Array.from({ length: 7 }, (_, i) => ({ a: a0 + ((i + 0.5) / 7) * TAU + rand(-0.2, 0.2), d: rand(1.05, 1.35), color: i % 3 ? ink : red }));
  let t = 0;
  return overlay(animate((dt, ctx) => {
    t += dt;
    const D = 0.52;
    if (t > D) return false;
    const k = easeOut(t / D), fade = 1 - t / D;
    // Ring
    ctx.strokeStyle = ink(0.75 * fade); ctx.lineWidth = Math.max(0.3, 2.8 * fade);
    ctx.beginPath(); ctx.arc(o.cx, o.cy, R0 + reach * 0.8 * k, 0, TAU); ctx.stroke();
    // Short lines bursting outward: they grow, then shrink, and move outward as a whole
    ctx.lineCap = "round";
    for (const r of rays) {
      const r1 = R0 + 3 + reach * r.len * easeOut(Math.min(1, t / (D * 0.75))), r0 = R0 + 3 + reach * r.len * easeOut(Math.max(0, (t - 0.08) / (D * 0.75)));
      ctx.strokeStyle = r.color(fade); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(o.cx + Math.cos(r.a) * r0, o.cy + Math.sin(r.a) * r0); ctx.lineTo(o.cx + Math.cos(r.a) * r1, o.cy + Math.sin(r.a) * r1); ctx.stroke();
    }
    for (const p of dots) {
      const rr = R0 + reach * p.d * k;
      ctx.fillStyle = p.color(fade);
      ctx.beginPath(); ctx.arc(o.cx + Math.cos(p.a) * rr, o.cy + Math.sin(p.a) * rr, 1.6 * fade + 0.4, 0, TAU); ctx.fill();
    }
    return true;
  }));
}
