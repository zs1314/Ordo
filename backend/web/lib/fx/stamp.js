// Stamp: a red stamp slams down onto the card (it drops from large to full size, the card sinks a little under it, and a
// few red drops splash out). The stamp carries the "done" label and today's date; after a pause the stamp and the card
// fade out together. The stamp's border and lettering are slightly mottled, like real stamp ink
import { animate, layer, pageRect, rand, clamp, wait, TAU, palette } from "./kit.js";
import { pad2 } from "../due.js";

export const meta = { id: "stamp", name: "盖章" };

let uid = 0;
export function play(target, origin, { big = true } = {}) {
  const L = layer(), r = pageRect(target), { red } = palette();
  const w = clamp(Math.min(r.w * 0.62, r.h * 1.5), big ? 130 : 84, 210), h = w * 0.58;
  const d = new Date(), date = `${d.getFullYear()} · ${pad2(d.getMonth() + 1)} · ${pad2(d.getDate())}`;
  const id = `fx-ink-${++uid}`, tilt = rand(-12, -6);
  const el = document.createElement("div");
  el.className = "fx-stamp";
  Object.assign(el.style, { left: `${r.cx}px`, top: `${r.cy}px`, width: `${w}px`, height: `${h}px`, color: red(0.95) });
  el.innerHTML = `<svg viewBox="0 0 200 116" width="100%" height="100%">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="${uid}" result="n" />
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.55" result="speck" />
      <feComposite in="SourceGraphic" in2="speck" operator="in" result="inked" />
      <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="${uid + 7}" result="warp" />
      <feDisplacementMap in="inked" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" />
    </filter></defs>
    <g filter="url(#${id})" fill="currentColor" stroke="currentColor">
      <rect x="5" y="5" width="190" height="106" rx="14" fill="none" stroke-width="7" />
      <rect x="15" y="15" width="170" height="86" rx="8" fill="none" stroke-width="1.8" />
      <text x="100" y="68" text-anchor="middle" font-size="40" font-weight="700" letter-spacing="6" stroke="none">做完了</text>
      <text x="100" y="91" text-anchor="middle" font-size="11.5" letter-spacing="1.5" stroke="none" font-family="ui-monospace, Menlo, monospace">${date}</text>
    </g></svg>`;
  L.el.append(el);
  const at = (s, rot, o = 1) => ({ transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${s})`, opacity: o });
  // Slamming down: faster and faster (ease-in); at the moment it hits the card it squashes slightly and springs back
  const slam = el.animate([at(2.3, tilt - 16, 0), at(1, tilt, 1), at(0.96, tilt), at(1, tilt)],
    { duration: 380, easing: "cubic-bezier(.55, 0, .9, .45)", fill: "forwards" });
  const anims = [slam];
  let stopped = false;
  const done = (async () => {
    await wait(235); // the moment it hits the card
    if (stopped) return;
    anims.push(target.animate([{ transform: "none" }, { transform: "translateY(2px) scale(.988)" }, { transform: "none" }], { duration: 220, easing: "ease-out" }));
    splash(r.cx, r.cy, w, h, red);
    await wait(760); // hold for a moment so the stamp can be read
    if (stopped) return;
    const fade = { duration: 260, easing: "ease", fill: "forwards" };
    anims.push(target.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }], fade));
    const out = el.animate([{ opacity: 1 }, { opacity: 0 }], fade);
    await out.finished.catch(() => {});
    el.remove();
    L.release();
  })();
  return {
    took: true,
    ready: wait(1280),
    done,
    restore() { stopped = true; for (const a of anims) a.cancel(); el.remove(); L.release(); },
  };
}

// The red drops that splash out when the stamp hits the card: outward from the stamp's edge, quickly coming to a stop and fading
function splash(cx, cy, w, h, red) {
  const drops = Array.from({ length: 16 }, () => {
    const a = rand(0, TAU), edge = { x: Math.cos(a) * w * 0.5, y: Math.sin(a) * h * 0.5 };
    const v = rand(60, 190);
    return { x: cx + edge.x, y: cy + edge.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rand(1, 2.6), age: 0, life: rand(0.35, 0.6) };
  });
  return animate((dt, ctx) => {
    let alive = 0;
    for (const p of drops) {
      p.age += dt;
      if (p.age > p.life) continue;
      alive++;
      p.vx *= 1 - 7 * dt; p.vy *= 1 - 7 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = red(0.85);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill();
    }
    return alive > 0;
  });
}
