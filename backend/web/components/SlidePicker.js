import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { reducedMotion } from "../lib/motion.js";

// The slider that switches styles during layout editing (under the header animation to switch it, under "recently done" to
// switch the chart): it shows the current one with its neighbors on both sides and wraps around endlessly; the frame in the
// middle has a fixed size. items: [{ id, name }]; cur: the one in use. onPick(id) is called only once it has settled
// (switching the header animation rebuilds the canvas, which would stutter mid-slide).
// Clicking a side moves one more step that way (counted from the current target), so several clicks during a slide all count.
// The direction depends on whether the click is left or right of the frame, not on which name was hit: the names move during
// a slide, and the one just clicked may already have slid into the frame.
// It uses pointerdown rather than click: the names move, so press and release often land on two different buttons and click
// would not fire.
const SLOT = 116;
const mod = (k, n) => ((k % n) + n) % n;
export function SlidePicker({ items, cur, onPick, label, cls = "" }) {
  const N = items.length, ci = Math.max(0, items.findIndex((x) => x.id === cur.id));
  const [pos, setPos] = useState(ci);
  const st = useRef({ pos: ci, vel: 0, target: ci, raf: 0, last: 0, timer: 0, cur: cur.id, sent: ci });
  st.current.cur = cur.id;
  const commit = () => {
    const s = st.current;
    if (s.sent === s.target) return;
    s.sent = s.target; clearTimeout(s.timer);
    s.timer = setTimeout(() => { const id = items[mod(s.target, N)].id; if (id !== s.cur) onPick(id); }, 40);
  };
  const step = (now) => {
    const s = st.current, dt = Math.min(0.034, (now - (s.last || now - 16)) / 1000), w = 15;
    s.last = now;
    s.vel += (w * w * (s.target - s.pos) - 2 * w * s.vel) * dt; s.pos += s.vel * dt;
    if (Math.abs(s.target - s.pos) < 0.002 && Math.abs(s.vel) < 0.01) { s.pos = s.target; s.vel = 0; s.raf = 0; s.last = 0; setPos(s.pos); commit(); return; }
    // Switch once it looks settled, without waiting for the last bit
    if (Math.abs(s.target - s.pos) < 0.04) commit();
    setPos(s.pos);
    s.raf = requestAnimationFrame(step);
  };
  const go = (k) => {
    const s = st.current;
    s.target = k; clearTimeout(s.timer); if (s.sent !== k) s.sent = null;
    if (reducedMotion()) { s.pos = k; s.vel = 0; setPos(k); commit(); return; }
    if (!s.raf) s.raf = requestAnimationFrame(step);
  };
  // Changed from settings: slide the shortest way to it
  useEffect(() => {
    const s = st.current;
    if (mod(Math.round(s.target), N) !== ci) go(s.target + (((ci - mod(Math.round(s.target), N) + N + Math.floor(N / 2)) % N) - Math.floor(N / 2)));
  }, [ci]);
  useEffect(() => () => { cancelAnimationFrame(st.current.raf); clearTimeout(st.current.timer); }, []);
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2);
    if (Math.abs(dx) > SLOT / 2) go(Math.round(st.current.target) + Math.sign(dx));
  };
  const onKey = (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(Math.round(st.current.target) - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(Math.round(st.current.target) + 1); }
  };
  const shown = [];
  for (let k = Math.floor(pos) - 2; k <= Math.floor(pos) + 3; k++) {
    const d = k - pos, ad = Math.abs(d);
    if (ad > 2) continue;
    const x = items[mod(k, N)], center = ad < 0.5;
    shown.push(html`<button key=${k} class=${`hp-item ${center ? "center" : ""}`} tabIndex="-1"
      style=${{ transform: `translateX(${(d * SLOT).toFixed(2)}px) scale(${(1 - 0.08 * Math.min(1, ad)).toFixed(4)})`, "--op": Math.max(0, 1 - 0.6 * ad).toFixed(3) }}
      >${x.name}</button>`);
  }
  return html`<div class=${`slide-picker ${cls}`} tabIndex="0" role="group" aria-label=${`${label}：${cur.name}，左右方向键切换`} onKeyDown=${onKey} onPointerDown=${onDown}>
    <span class="hp-frame"></span>${shown}
  </div>`;
}
