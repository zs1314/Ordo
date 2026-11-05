// Fireworks: a shell rises from the clicked spot and bursts high up into a ring of sparks; the sparks spread out trailing
// tails, fall, flicker a few times and go out. Finishing an agent card fires three in a row (at different spots above the
// card); a check-in fires one small one. Shells alternate between ink and red.
import { animate, overlay, palette, pageRect, rand, clamp, TAU, easeOut } from "./kit.js";

export const meta = { id: "fireworks", name: "烟花" };

export function play(target, origin, { big = false } = {}) {
  const o = pageRect(origin ?? target), r = pageRect(target);
  const { ink, red } = palette();
  const shells = (big ? [0, 0.28, 0.55] : [0]).map((delay, k) => {
    const color = k % 2 ? ink : red, other = k % 2 ? red : ink;
    const to = big
      ? { x: clamp(o.cx + rand(-0.38, 0.38) * r.w, r.x + 20, r.x + r.w - 20), y: r.y - rand(40, 120) }
      : { x: o.cx + rand(-14, 14), y: o.y - rand(84, 104) }; // check-in: burst a bit above the cell, but not right on top of a cell in the row above
    return { delay, from: { x: o.cx, y: o.cy }, to, color, other, rise: big ? 0.36 : 0.28, boomed: false, sparks: [], n: big ? 64 : 38, speed: big ? 300 : 185 };
  });
  let t = 0;
  return overlay(animate((dt, ctx) => {
    t += dt;
    let alive = false;
    for (const s of shells) {
      const age = t - s.delay;
      if (age < 0) { alive = true; continue; }
      if (age < s.rise) {
        // Rising: with a short tail
        alive = true;
        const k = easeOut(age / s.rise), x = s.from.x + (s.to.x - s.from.x) * k, y = s.from.y + (s.to.y - s.from.y) * k;
        const k0 = easeOut(Math.max(0, age - 0.06) / s.rise), x0 = s.from.x + (s.to.x - s.from.x) * k0, y0 = s.from.y + (s.to.y - s.from.y) * k0;
        ctx.strokeStyle = s.color(0.7); ctx.lineWidth = 1.6; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        continue;
      }
      if (!s.boomed) {
        s.boomed = true;
        for (let i = 0; i < s.n; i++) {
          const a = (i / s.n) * TAU + rand(-0.06, 0.06), v = s.speed * rand(0.55, 1);
          s.sparks.push({ x: s.to.x, y: s.to.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, trail: [], life: rand(0.75, 1.2), color: Math.random() < 0.22 ? s.other : s.color });
        }
      }
      const b = age - s.rise;
      // A brief flash at the moment of the burst
      if (b < 0.14) {
        ctx.fillStyle = s.color(0.35 * (1 - b / 0.14));
        ctx.beginPath(); ctx.arc(s.to.x, s.to.y, 4 + 30 * (b / 0.14) * (s.n > 40 ? 1 : 0.55), 0, TAU); ctx.fill();
      }
      for (const p of s.sparks) {
        if (b > p.life) continue;
        alive = true;
        p.trail.push(p.x, p.y);
        if (p.trail.length > 12) p.trail.splice(0, 2);
        p.vx *= 1 - 2.3 * dt; p.vy *= 1 - 2.3 * dt; p.vy += 170 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        let a = (1 - b / p.life) ** 1.2;
        if (b > p.life * 0.65) a *= rand(0.25, 1); // flicker just before going out
        ctx.strokeStyle = p.color(a); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.trail[0], p.trail[1]);
        for (let i = 2; i < p.trail.length; i += 2) ctx.lineTo(p.trail[i], p.trail[i + 1]);
        ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    return alive;
  }));
}
