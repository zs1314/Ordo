import { html, useState, useRef, useEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md } from "./ui.js";
import { StatusIcon } from "./icons.js";
import { groupOf, cardName } from "../lib/model.js";
import { ymd, pad2, WEEK } from "../lib/due.js";
import { closedAt, dayStart, doneByDay } from "../lib/done.js";
import { motionOf, reducedMotion } from "../lib/motion.js";
import { CHARTS, chartById } from "./done/index.js";
import { useFold, useFoldAnim, staggerOf } from "./useFold.js";
import { SlidePicker } from "./SlidePicker.js";

const STEP = 7; // the list starts with the last 7 days; "one more week back" adds 7 days each time

const dayLabel = (d, back) => (back === 0 ? "今天" : back === 1 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`);
const hm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

// "Recently done": a chart on top (two weeks of bars, or a heatmap, see done/index.js; during layout editing a slider below
// the chart switches it), and below it the items done, listed by day.
// Clicking an entry finds the item in its card, scrolls there and highlights it (a collapsed one is revealed too; the editor
// does not open). Clicking a bar or cell in the chart jumps to that day (listing more days first if it is not listed yet)
// and highlights it
export function DoneBlock() {
  const { doc, ui, act, locate } = useBoard();
  const [span, setSpan] = useState(STEP);
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(0), quick = useRef(false);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const now = new Date(), byDay = doneByDay(doc.items);
  const count = (back) => byDay[ymd(dayStart(now, back))]?.length ?? 0;
  const chart = chartById(doc.theme?.doneChart);
  const earliest = dayStart(now, span - 1).getTime();
  const more = doc.items.some((i) => i.status === "done" && closedAt(i) && closedAt(i) < earliest);
  const smooth = () => (reducedMotion() ? "auto" : "smooth");
  // Which card the item is in (a section's built-in card shows the section name)
  const where = (i) => { const g = groupOf(doc, i.group); return g ? cardName(doc, g) : ""; };

  const open = (e, i) => {
    if (e.target.closest?.("a[href]")) return; // a click on a link in the title only opens the link
    locate(i.id);
  };
  const jump = (back) => {
    const key = ymd(dayStart(now, back));
    // Jumping to a day that is not listed yet lists the missing days at once, without unfolding them (the page scrolls there
    // right away, and waiting for the days to unfold one by one would be slow)
    if (back >= span) { quick.current = true; setSpan(Math.ceil((back + 1) / STEP) * STEP); }
    setFlash(key);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1700);
    setTimeout(() => document.getElementById(`dn-${key}`)?.scrollIntoView({ behavior: smooth(), block: "center" }), 30);
  };
  const collapse = () => {
    setSpan(STEP);
    const b = document.getElementById("b-done");
    if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: smooth(), block: "start" });
  };

  // Listed by day; the days added by "one more week back" unfold one after another, and "collapse" folds them from the
  // bottom up
  const list = Array.from({ length: span }, (_, back) => back).filter((back) => count(back))
    .map((back) => { const d = dayStart(now, back), key = ymd(d); return { key, back, d, xs: byDay[key] }; });
  const days = useFold(list, (x) => x.key, { ok: () => !quick.current });
  useEffect(() => { quick.current = false; });

  return html`<${Block} id="b-done" title="最近做完"><div class="card">
    <${chart.Chart} key=${chart.id} now=${now} count=${count} jump=${jump} />
    ${ui.editMode ? html`<${SlidePicker} cls="chart-picker" label="最近做完的图" items=${CHARTS} cur=${chart} onPick=${(doneChart) => act.theme({ doneChart })} />` : null}
    ${days.length ? days.map(({ x, enter, leave }) => html`<${Day} key=${x.key} day=${x} enter=${enter} leave=${leave} flash=${flash === x.key} open=${open} where=${where} />`)
      : html`<div class="none">这几天还没有做完的事。</div>`}
    ${more || span > STEP ? html`<div class="add dn-foot">
      ${more ? html`<button class="addlink" onClick=${() => setSpan(span + STEP)}>再往前一周</button>` : null}
      ${span > STEP ? html`<button class="addlink" onClick=${collapse}>收起</button>` : null}
    </div>` : null}
  </div><//>`;
}

// One day: a small heading (today, yesterday, Oct 30 Fri, ... and the count), then the items done that day, each followed
// by its card and the time it was done
function Day({ day: { key, back, d, xs }, enter, leave, flash, open, where }) {
  const ref = useRef(null);
  useFoldAnim(ref, enter != null ? "in" : leave != null ? "out" : "", { delay: staggerOf(enter ?? leave) });
  return html`<div class=${`dn-day ${flash ? "flash" : ""} ${leave != null ? "folding" : ""}`} id=${`dn-${key}`} ref=${ref}>
    <h4>${dayLabel(d, back)}<span class="c">${xs.length} 件</span></h4>
    ${xs.map((i) => html`<div class=${`dn-item ${motionOf(i.id) === "close" ? "enter" : ""}`} key=${i.id} onClick=${(e) => open(e, i)}>
      <${StatusIcon} s="done" />
      <span class="t"><${Md} text=${i.title} /></span>
      <span class="g">${where(i)}</span>
      <span class="tm mono">${hm(closedAt(i))}</span>
    </div>`)}
  </div>`;
}
