// Confetti: a handful of paper bits and a few streamers burst upward from the clicked spot, then tumble and flutter down.
// The colors are a few shades of ink plus red (the same "ink with a touch of red" as the header animations), with some of
// the accent color mixed in if one is set. A flake turned edge-on gets narrower and fainter; lying flat it has more drag
// and falls slower, so it drifts down in fits and starts.
import { animate, overlay, palette, pageRect, rand, pick, TAU } from "./kit.js";

export const meta = { id: "confetti", name: "彩带" };

export function play(target, origin, { big = false } = {}) {
  const o = pageRect(origin ?? target);
  const { ink, red, accent } = palette();
  const colors = [ink(0.9), ink(0.9), ink(0.55), ink(0.3), red(0.92), red(0.92), red(0.7), ...(accent ? [accent, accent] : [])];
  const n = big ? 120 : 46, streamers = big ? 7 : 2, power = big ? 1 : 0.62;
  const bits = [];
  const launch = (kind) => {
    const a = -Math.PI / 2 + rand(-1, 1) * (big ? 1.05 : 0.9); // an upward fan
    const v = rand(420, 1050) * power;
    return {
      kind, color: pick(colors),
      x: o.cx + rand(-o.w, o.w) * 0.18, y: o.cy + rand(-4, 4),
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      rot: rand(0, TAU), vr: rand(-7, 7),
      flip: rand(0, TAU), vflip: rand(7, 15),
      sway: rand(0, TAU), vsway: rand(2, 4.5), swayAmp: rand(18, 48),
      w: kind === "strip" ? rand(2.2, 3) : kind === "dot" ? rand(3, 4.4) : rand(5, 9),
      h: kind === "strip" ? rand(10, 16) : kind === "dot" ? 0 : rand(3, 5.5),
      len: rand(26, 44), wave: rand(0, TAU), // used by streamers
      age: 0, life: rand(2.6, 3.8),
    };
  };
  for (let k = 0; k < n; k++) bits.push(launch(pick(["rect", "rect", "rect", "rect", "strip", "dot"])));
  for (let k = 0; k < streamers; k++) bits.push(launch("streamer"));

  const G = 820; // gravity (px / s²)
  return overlay(animate((dt, ctx, view) => {
    let alive = 0;
    for (const b of bits) {
      b.age += dt;
      if (b.age > b.life || b.y > view.y + view.h + 60) continue;
      alive++;
      b.flip += b.vflip * dt; b.sway += b.vsway * dt; b.rot += b.vr * dt; b.wave += 9 * dt;
      // Drag is high while a flake lies flat (|cos| large), so the flakes flutter down in fits and starts.
      // On the way up drag is low, so they shoot high; the fluttering only starts on the way down.
      const flat = Math.abs(Math.cos(b.flip)), drag = b.vy < 0 ? 1.1 : b.kind === "streamer" ? 2.4 : 1.6 + 3.4 * flat;
      b.vx += -b.vx * 2.1 * dt;
      b.vy += (G - b.vy * drag) * dt;
      b.x += (b.vx + Math.sin(b.sway) * b.swayAmp * Math.min(1, b.age * 1.5)) * dt;
      b.y += b.vy * dt;
      const fade = Math.min(1, (b.life - b.age) / 0.6);
      ctx.globalAlpha = fade * (b.kind === "streamer" || b.kind === "dot" ? 1 : 0.45 + 0.55 * flat);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      if (b.kind === "streamer") {
        // A long thin streamer: drawn along a moving sine curve
        ctx.strokeStyle = b.color; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        ctx.beginPath();
        for (let k = 0; k <= 10; k++) {
          const u = k / 10, px = (u - 0.5) * b.len, py = Math.sin(u * 5.2 + b.wave) * 3.6;
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      } else if (b.kind === "dot") {
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(0, 0, b.w / 2, 0, TAU); ctx.fill();
      } else {
        ctx.scale(1, Math.cos(b.flip));
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
    return alive > 0;
  }));
}
