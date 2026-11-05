import { html, useRef, useState, useEffect, useLayoutEffect } from "../../vendor/preact-htm.js";
import { WEEK } from "../../lib/due.js";
import { dayStart } from "../../lib/done.js";
import { reducedMotion } from "../../lib/motion.js";
import { createSnake } from "../../lib/snake.js";
import { SnakeIcon } from "../icons.js";

// A GitHub-style heatmap: one column per week (Monday on top), darker means more done that day, and the "less … more" at
// the top right is the legend; today's cell is outlined.
// It draws as many weeks as fit (fewer on phones), at most a year, and the cells grow a little to fill the whole row.
// Clicking a colored cell jumps to that day.
// The small button at the top right turns the heatmap into a snake board: the days with something done become pellets
// (bigger for more), and the snake starts from today and eats them by itself (logic in lib/snake.js).
// Once those days are eaten, new pellets (hollow) appear one at a time as in ordinary snake. The number at the top right
// is how many pellets were eaten ("eaten / total days" until those days are all eaten).
// Arrow keys, WASD or a swipe on the cells switch to manual control, which lasts until the snake crashes; Esc or another
// click on the button stops it.
export const meta = { id: "heatmap", name: "热力图" };
const MAX_WEEKS = 53, LABEL_W = 20, ROWS = 7;
const WD = "一二三四五六日";
const levelOf = (n, max) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };

export function Chart({ now, count, jump }) {
  const wrap = useRef(null), swipe = useRef(null);
  const [fit, setFit] = useState({ weeks: 0, cell: 12 });
  const weeks = fit.weeks;
  const snake = useSnake();
  // Measure how many columns fit
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el), min = parseFloat(cs.getPropertyValue("--cell")) || 12, gap = parseFloat(cs.getPropertyValue("--gap")) || 3;
      const room = el.clientWidth - LABEL_W + gap;
      const n = Math.max(6, Math.min(MAX_WEEKS, Math.floor(room / (min + gap))));
      const cell = Math.round(Math.min(min * 1.4, room / n - gap) * 10) / 10;
      setFit((f) => (f.weeks === n && f.cell === cell ? f : { weeks: n, cell }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => snake.stop, [weeks]); // a change in width makes the board invalid

  // The last column is this week; cell index = column × 7 + row (row 0 is Monday), as in lib/snake.js
  const wd = (dayStart(now, 0).getDay() + 6) % 7;
  const cells = [];
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < ROWS; row++) {
      const back = (weeks - 1 - col) * 7 + (wd - row);
      if (back >= 0) cells.push({ col, row, back, n: count(back), idx: col * ROWS + row });
    }
  }
  const max = Math.max(1, ...cells.map((c) => c.n));
  const total = cells.reduce((a, c) => a + c.n, 0), days = cells.filter((c) => c.n).length;
  // A month label goes above the column of the month's first week; one too close to the next is skipped (the text would
  // overlap)
  const months = [];
  for (let col = 0; col < weeks; col++) {
    const mon = dayStart(now, (weeks - 1 - col) * 7 + wd), prev = col ? dayStart(now, (weeks - col) * 7 + wd) : null;
    if (prev ? mon.getMonth() !== prev.getMonth() : mon.getDate() <= 7) months.push({ col, label: `${mon.getMonth() + 1}月` });
  }
  const labels = months.filter((m, k) => !months[k + 1] || months[k + 1].col - m.col >= 3);

  const g = snake.game?.g.state;
  const start = () => {
    const walls = new Set(), food = new Map();
    for (let row = wd + 1; row < ROWS; row++) walls.add((weeks - 1) * ROWS + row);
    for (const c of cells) if (c.n) food.set(c.idx, c.n);
    snake.start({ cols: weeks, rows: ROWS, walls, food, start: (weeks - 1) * ROWS + wd });
  };
  const cell = (c) => {
    const d = dayStart(now, c.back), lv = levelOf(c.n, max), k = g ? g.body.indexOf(c.idx) : -1;
    const kind = !g ? `l${lv}` : k === 0 ? "snake head" : k > 0 ? "snake" : g.bonus.has(c.idx) ? "food bonus l0" : g.food.has(c.idx) ? `food l${lv}` : "l0";
    return html`<button key=${c.idx} class=${`hm-cell ${kind} ${c.back === 0 ? "today" : ""}`} style=${{ gridColumn: c.col + 2, gridRow: c.row + 2 }}
      title=${`${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}：${c.n} 件`} disabled=${!c.n || !!g} onClick=${() => jump(c.back)}></button>`;
  };
  // A swipe on the cells changes direction
  const onDown = (e) => { if (!g) return; swipe.current = [e.clientX, e.clientY]; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onUp = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!g || !s) return;
    const dx = e.clientX - s[0], dy = e.clientY - s[1];
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return;
    snake.steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };

  const legend = html`<span class="hm-legend"><span>少</span>${[0, 1, 2, 3, 4].map((l) => html`<i key=${l} class=${`l${l}`}></i>`)}<span>多</span></span>`;
  // While those days are being eaten it shows "days eaten / total days"; once new pellets appear, only the number eaten
  const score = g ? html`<span class="hm-score mono">${g.bonus.size || g.bonusEaten ? g.eaten : `${g.eaten} / ${g.total}`}</span>` : null;
  return html`<div class="cal-head"><span class="ttl">最近 ${weeks} 周做完 ${total} 件</span><span class="sum">${score ?? legend}</span>
      <button class=${`egg ${g ? "on" : ""}`} title=${g ? "停下" : "贪吃蛇"} aria-label=${g ? "停下" : "贪吃蛇"} disabled=${!days && !g} onClick=${g ? snake.stop : start}><${SnakeIcon} /></button></div>
    <div class="hm-wrap" ref=${wrap}>
      <div class=${`hm ${g ? "playing" : ""} ${g?.over ? "over" : ""}`} style=${{ "--weeks": weeks, "--fit": `${fit.cell}px` }} onPointerDown=${onDown} onPointerUp=${onUp}>
        ${labels.map((m) => html`<span key=${`m${m.col}`} class="hm-mon" style=${{ gridColumn: `${m.col + 2} / span 4` }}>${m.label}</span>`)}
        ${[0, 2, 4].map((r) => html`<span key=${`w${r}`} class="hm-wd" style=${{ gridRow: r + 2 }}>${WD[r]}</span>`)}
        ${cells.map(cell)}
      </div>
    </div>`;
}

// One game of snake: after the start the cells first turn into the board (the .playing transition), then the first step
// is taken; on its own the snake moves one cell every 105 ms, a little slower under manual control, 150 ms.
// On a crash or once everything is eaten, the snake blinks a few times and the board turns back into the heatmap
function useSnake() {
  const [, bump] = useState(0);
  const ref = useRef(null);
  const stop = () => {
    const r = ref.current;
    if (!r) return;
    clearTimeout(r.timer);
    removeEventListener("keydown", r.onKey);
    ref.current = null;
    bump((x) => x + 1);
  };
  useEffect(() => stop, []);
  const start = (board) => {
    if (ref.current || reducedMotion()) return;
    const g = createSnake({ ...board, seed: Date.now() % 100000 }), r = { g, timer: 0, onKey: null };
    const tick = () => {
      const res = g.step();
      bump((x) => x + 1);
      if (res === "dead" || res === "won") { r.timer = setTimeout(stop, 1600); return; }
      r.timer = setTimeout(tick, g.state.manual ? 150 : 105);
    };
    r.onKey = (e) => {
      if (e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      const d = KEYS[e.key];
      if (d) { e.preventDefault(); g.steer(d); } else if (e.key === "Escape") stop();
    };
    addEventListener("keydown", r.onKey);
    ref.current = r;
    bump((x) => x + 1);
    r.timer = setTimeout(tick, 420);
  };
  return { game: ref.current, start, stop, steer: (d) => ref.current?.g.steer(d) };
}
