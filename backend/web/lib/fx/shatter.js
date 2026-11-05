// Shatter: the card cracks open at the clicked spot. Cracks grow outward from that point (a few radial cracks plus a few
// rings) and the whole card breaks into pieces; pieces closer to the point fly first and faster, tumbling outward and down
// as they fade. Each shard is a copy of the card cut to a polygon (clip-path) with a thin outline, like broken glass.
import { loop, layer, cloneOf, pageRect, hide, unhide, rand, clamp, wait, TAU } from "./kit.js";

export const meta = { id: "shatter", name: "碎掉" };

const SVG = "http://www.w3.org/2000/svg";

export function play(target, origin) {
  const L = layer(), r = pageRect(target), o = pageRect(origin ?? target);
  const P = { x: clamp(o.cx - r.x, 2, r.w - 2), y: clamp(o.cy - r.y, 2, r.h - 2) }; // the point where it cracks (relative to the card)
  const polys = cut(r.w, r.h, P);
  const R = Math.hypot(Math.max(P.x, r.w - P.x), Math.max(P.y, r.h - P.y));
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();

  // Lay out the shards first (together they look exactly like the original), then hide the original
  const shards = polys.map((poly) => {
    const el = cloneOf(target, L.el);
    el.firstChild.style.clipPath = `polygon(${poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(",")})`;
    const edge = document.createElementNS(SVG, "svg");
    edge.setAttribute("class", "fx-edge");
    edge.innerHTML = `<polygon points="${poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="hsl(${ink} / .28)" stroke-width="1" />`;
    edge.style.opacity = "0";
    el.append(edge);
    const c = centroid(poly), d = Math.hypot(c.x - P.x, c.y - P.y), near = 1 - clamp(d / R, 0, 1);
    const dir = d > 1 ? { x: (c.x - P.x) / d, y: (c.y - P.y) / d } : { x: rand(-1, 1), y: -1 };
    const size = Math.sqrt(Math.max(30, area(poly)));
    const speed = rand(170, 340) + 520 * near ** 1.5;
    el.style.transformOrigin = `${c.x}px ${c.y}px`;
    return {
      el, edge, delay: 0.07 * (1 - near) + rand(0, 0.025),
      x: 0, y: 0, vx: dir.x * speed + rand(-50, 50), vy: dir.y * speed * 0.75 - rand(140, 300),
      a: 0, va: rand(-1, 1) * (220 / size) * 2.6, rx: 0, vrx: rand(-5, 5), ry: 0, vry: rand(-5, 5),
      age: 0, life: rand(0.8, 1.25),
    };
  });
  hide(target);

  // Cracks: grow outward from that point, fully grown in 0.11 s
  const crack = document.createElementNS(SVG, "svg");
  crack.setAttribute("class", "fx-crack");
  Object.assign(crack.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  crack.innerHTML = polys.map((p) => `<polygon points="${p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}" />`).join("");
  crack.style.stroke = `hsl(${ink} / .5)`;
  L.el.append(crack);
  const grow = crack.animate([{ clipPath: `circle(0px at ${P.x}px ${P.y}px)` }, { clipPath: `circle(${R + 4}px at ${P.x}px ${P.y}px)` }], { duration: 110, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });

  const G = 2300;
  let alive = true;
  const done = (async () => {
    await grow.finished.catch(() => {});
    crack.remove();
    for (const s of shards) s.edge.style.opacity = "1";
    await loop((dt) => {
      let any = false;
      for (const s of shards) {
        s.age += dt;
        const t = s.age - s.delay;
        if (t < 0) { any = true; continue; }
        if (t > s.life) { s.el.style.opacity = "0"; continue; }
        any = true;
        s.vy += G * dt; s.vx *= 1 - 0.5 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.a += s.va * dt; s.rx += s.vrx * dt; s.ry += s.vry * dt;
        s.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) perspective(700px) rotateX(${s.rx.toFixed(3)}rad) rotateY(${s.ry.toFixed(3)}rad) rotate(${s.a.toFixed(3)}rad)`;
        s.el.style.opacity = String(clamp((s.life - t) / (s.life * 0.45), 0, 1));
      }
      return any && alive;
    });
    for (const s of shards) s.el.remove();
    L.release();
  })();
  return {
    took: true,
    ready: wait(190), // the card can be removed as soon as it has cracked and the shards have just started to fly
    done,
    restore() { alive = false; unhide(target); },
  };
}

// Cut into shards: a few rays out from P (with slightly random angles) and a few rings (sparser further out); each cell
// of that grid is a shard, and finally everything is clipped to the card. Together the shards cover exactly the whole
// card, with no gaps and no overlaps (checked by test/anim.test.mjs)
export function cut(w, h, P) {
  const R = Math.hypot(Math.max(P.x, w - P.x), Math.max(P.y, h - P.y));
  // Number of rays: when the point is on an edge or in a corner, most of the rays point out of the card and too few shards
  // are left after clipping, so add more rays in proportion to the share that points inward
  let inward = 0;
  for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU, x = P.x + Math.cos(a) * 4, y = P.y + Math.sin(a) * 4; if (x > 0 && x < w && y > 0 && y < h) inward++; }
  const S = Math.min(40, Math.round(clamp(Math.sqrt(w * h) / 24, 7, 13) / Math.max(0.25, inward / 72)));
  const K = w * h > 30000 ? 4 : 3; // number of rings
  const a0 = rand(0, TAU);
  const angles = Array.from({ length: S }, (_, s) => a0 + (s + rand(-0.3, 0.3)) * (TAU / S));
  const radii = Array.from({ length: K }, (_, k) => (k === K - 1 ? R * 1.7 : R * ((k + 1) / K) ** 1.45));
  const V = angles.map((a) => [P, ...radii.map((rr, k) => {
    const last = k === K - 1, j = last ? rr : rr * rand(0.8, 1.15), aa = last ? a : a + rand(-0.09, 0.09);
    return { x: P.x + Math.cos(aa) * j, y: P.y + Math.sin(aa) * j };
  })]);
  const out = [];
  for (let s = 0; s < S; s++) {
    const A = V[s], B = V[(s + 1) % S];
    for (let k = 0; k < K; k++) {
      const poly = clip(k === 0 ? [P, A[1], B[1]] : [A[k], A[k + 1], B[k + 1], B[k]], w, h);
      if (poly.length >= 3 && area(poly) > 0.5) out.push(poly);
    }
  }
  return out;
}

// Clip a polygon to [0, w] × [0, h] (Sutherland–Hodgman)
function clip(poly, w, h) {
  let out = poly;
  for (const f of [(p) => p.x, (p) => w - p.x, (p) => p.y, (p) => h - p.y]) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    if (!out.length) break;
  }
  return out;
}
export const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
