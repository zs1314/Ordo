import { html, useRef, useState, useEffect } from "../../vendor/preact-htm.js";
import { WEEK } from "../../lib/due.js";
import { dayStart } from "../../lib/done.js";
import { reducedMotion } from "../../lib/motion.js";
import { dominoes } from "../../lib/domino.js";
import { DominoIcon } from "../icons.js";

// Two weeks of bars: the 7 dark ones on the right are the last 7 days (the ones counted in the title), the 7 light ones on
// the left are the 7 days before, for comparison; each bar shows how many items were done that day.
// The shading only marks the two weeks and does not change on any click. Clicking a bar jumps to that day; a day with
// nothing done is a thin line and cannot be clicked.
// The small button at the top right turns the bars into a row of dominoes that topple from left to right, pause, then
// stand back up in reverse (the toppling physics is in lib/domino.js)
export const meta = { id: "bars", name: "柱子" };
const STEP = 7, DAYS = 2 * STEP;

export function Chart({ now, count, jump }) {
  const box = useRef(null);
  const [playing, play] = useDominoes(box);
  const sum = (from, to) => { let n = 0; for (let k = from; k < to; k++) n += count(k); return n; };
  const week = sum(0, STEP), prev = sum(STEP, DAYS);
  const max = Math.max(1, ...Array.from({ length: DAYS }, (_, k) => count(k)));
  const bar = (back) => {
    const d = dayStart(now, back), n = count(back);
    const cls = `dn-bar ${back < STEP ? "cur" : "prev"} ${back === 0 ? "today" : ""}`;
    const title = `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}：${n} 件`;
    const inner = html`<span class="n mono">${n || ""}</span>
      <span class=${`b ${n ? "" : "zero"}`} style=${n ? { height: `${Math.max(4, Math.round((n / max) * 46))}px` } : null}></span>
      <span class="d mono">${d.getDate()}</span>`;
    return n ? html`<button key=${back} class=${cls} title=${title} onClick=${() => jump(back)}>${inner}</button>`
      : html`<span key=${back} class=${cls} title=${title}>${inner}</span>`;
  };
  const older = Array.from({ length: STEP }, (_, k) => DAYS - 1 - k), recent = Array.from({ length: STEP }, (_, k) => STEP - 1 - k);
  return html`<div class="cal-head"><span class="ttl">最近 7 天做完 ${week} 件</span><span class="sum">前 7 天 ${prev} 件</span>
      <button class=${`egg ${playing ? "on" : ""}`} title="推倒" aria-label="推倒" disabled=${playing} onClick=${play}><${DominoIcon} /></button></div>
    <div class=${`dn-bars ${playing ? "playing" : ""}`} ref=${box}>${[...older.map(bar), html`<span class="dn-gap" key="gap"></span>`, ...recent.map(bar)]}</div>`;
}

// A push: the bars first turn into tall, thin dominoes (the numbers above fade out); once all have fallen there is a pause,
// then the recorded frames play backwards so they stand back up, and they turn back into bars.
// A domino must reach the next one for the chain to keep going: short ones are stretched to 1.3 times the gap between two
// (no taller than the bar column), and the width is about a quarter of the spacing.
// The domino size goes into --dw and --dh (under .playing the stylesheet overrides the bar's own height with !important);
// the bar's height belongs to Preact and is left alone, so if new data arrives during the fall, the bars still get the
// right height
function useDominoes(box) {
  const [on, setOn] = useState(false);
  const run = useRef(null);
  useEffect(() => () => run.current?.(), []);
  const play = () => {
    const root = box.current;
    if (run.current || reducedMotion() || !root) return;
    const rb = root.getBoundingClientRect();
    const cols = [...root.querySelectorAll(".dn-bar .b")].map((el) => {
      const r = el.getBoundingClientRect(), col = el.parentElement.getBoundingClientRect();
      return { el, w0: r.width, h0: r.height, cx: r.left + r.width / 2 - rb.left, room: r.bottom - col.top - 1 };
    });
    if (cols.length < 2) return;
    const pitch = Math.min(...cols.slice(1).map((c, k) => c.cx - cols[k].cx));
    const w = Math.max(4, Math.min(14, pitch * 0.24)), room = Math.min(...cols.map((c) => c.room));
    const hmin = Math.min(room, Math.max(16, (pitch - w) * 1.3));
    const tiles = cols.map((c) => ({ x: c.cx - w / 2, w, h: Math.min(room, Math.max(c.h0, hmin)) }));
    const pad = parseFloat(getComputedStyle(root.parentElement).paddingRight) || 0;
    const sim = dominoes(tiles, { wall: rb.width + Math.min(pad, 12) });
    const frames = [];
    let raf = 0, timer = 0, stopped = false;
    const shape = (k, dw, dh) => { cols[k].el.style.setProperty("--dw", `${dw}px`); cols[k].el.style.setProperty("--dh", `${dh}px`); };
    const turn = (angles) => angles.forEach((a, k) => { cols[k].el.style.transform = a ? `rotate(${a.toFixed(4)}rad)` : ""; });
    const loop = (fn) => {
      let last = 0;
      const f = (t) => {
        if (stopped) return;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
        last = t;
        if (fn(dt) !== false) raf = requestAnimationFrame(f);
      };
      raf = requestAnimationFrame(f);
    };
    const stop = () => {
      stopped = true; cancelAnimationFrame(raf); clearTimeout(timer);
      for (const c of cols) { c.el.style.transform = ""; c.el.style.removeProperty("--dw"); c.el.style.removeProperty("--dh"); }
      run.current = null; setOn(false);
    };
    // Once standing again, first return to the original width and height (still under .playing, with the transition), then
    // clean up
    const settle = () => { cols.forEach((c, k) => shape(k, c.w0, c.h0)); timer = setTimeout(stop, 260); };
    const rewind = () => {
      let k = frames.length - 1;
      loop((dt) => {
        k -= dt * 60 * 1.8;
        if (k <= 0) { turn(frames[0].map(() => 0)); settle(); return false; }
        turn(frames[Math.floor(k)]);
      });
    };
    run.current = stop;
    cols.forEach((c, k) => shape(k, w, tiles[k].h));
    setOn(true);
    timer = setTimeout(() => loop((dt) => {
      const done = sim.step(dt);
      frames.push(sim.angles);
      turn(sim.angles);
      if (!done) return;
      timer = setTimeout(rewind, 900);
      return false;
    }), 240);
  };
  return [on, play];
}
