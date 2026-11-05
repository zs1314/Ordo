import { html, useState } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md } from "./ui.js";
import { StatusIcon } from "./icons.js";
import { OPEN } from "../lib/model.js";
import { calendarShowsClosed } from "../lib/done.js";
import { motionOf } from "../lib/motion.js";
import { dueInfo, monthCells, ymd, pad2, firstOfMonth, addMonths, WEEK } from "../lib/due.js";
import { stripMd } from "../lib/md.js";

const MAX = 3; // at most this many items listed per day

// Month calendar: items with a due date are placed on their day, and open items past their due date are listed below.
// On phones the cells are too narrow for text, so a cell shows only dots (one per item, at most 3) and this month's items
// are listed by day under the calendar
export function CalendarBlock() {
  const { doc } = useBoard();
  const [month, setMonth] = useState(null); // null = this month
  const now = new Date(), first = month ?? firstOfMonth(now), todayKey = ymd(now);
  const dated = doc.items.filter((i) => i.due && (OPEN.includes(i.status) || calendarShowsClosed(i, doc.theme))).map((i) => ({ i, d: dueInfo(i.due) })).filter((x) => x.d);
  const byDay = {};
  for (const x of dated) (byDay[x.d.key] ??= []).push(x);
  // Within a day, open items come first (only 3 are listed per day, so closed items must not push open ones into "N more"),
  // then by time
  const closed = (x) => (OPEN.includes(x.i.status) ? 0 : 1);
  for (const k in byDay) byDay[k].sort((a, b) => closed(a) - closed(b) || a.d.at - b.d.at);
  const inMonth = dated.filter((x) => OPEN.includes(x.i.status) && x.d.p.y === first.getFullYear() && x.d.p.mo === first.getMonth() + 1).length;
  const overdue = dated.filter((x) => OPEN.includes(x.i.status) && x.d.over).sort((a, b) => a.d.at - b.d.at);
  return html`<${Block} id="b-calendar" title="日历"><div class="card">
    <div class="cal-head"><span class="ttl">${first.getFullYear()} 年 ${first.getMonth() + 1} 月</span>
      <button class="tool" title="上个月" onClick=${() => setMonth(addMonths(first, -1))}>‹</button>
      <button class="tool" onClick=${() => setMonth(null)}>今天</button>
      <button class="tool" title="下个月" onClick=${() => setMonth(addMonths(first, 1))}>›</button>
      <span class="sum">${inMonth ? `这个月有 ${inMonth} 件到期` : "这个月没有到期的事"}</span>
    </div>
    <div class="cal-grid">
      ${[..."一二三四五六日"].map((w) => html`<div class="cal-dow" key=${w}>${w}</div>`)}
      ${monthCells(first).map((day) => {
        const k = ymd(day), xs = byDay[k] ?? [];
        const cls = `cal-cell ${day.getMonth() !== first.getMonth() ? "out" : ""} ${k === todayKey ? "today" : ""}`;
        return html`<div class=${cls} key=${k}><span class="dn">${day.getDate()}</span>
          ${xs.slice(0, MAX).map((x) => html`<${Chip} key=${x.i.id} x=${x} />`)}
          ${xs.length > MAX ? html`<div class="cal-more">还有 ${xs.length - MAX} 件</div>` : null}
          ${xs.length ? html`<span class="cal-dots">${xs.slice(0, MAX).map((x) => html`<i key=${x.i.id} class=${OPEN.includes(x.i.status) ? "" : "closed"}></i>`)}</span>` : null}</div>`;
      })}
    </div>
    <${Agenda} xs=${dated.filter((x) => x.d.p.y === first.getFullYear() && x.d.p.mo === first.getMonth() + 1).sort((a, b) => a.d.at - b.d.at)} />
    ${overdue.length ? html`<div class="cal-over">已经过了截止：${overdue.map((x) => html`<${Chip} key=${x.i.id} x=${x} inline />`)}</div>` : null}
  </div><//>`;
}

// The list under the calendar on phones: this month's due items by day, with a small heading per day. Clicking an entry
// does the same as clicking one in a cell: it locates the item in its card
function Agenda({ xs }) {
  const { locate } = useBoard();
  if (!xs.length) return null;
  const days = [];
  for (const x of xs) {
    if (days.at(-1)?.key !== x.d.key) days.push({ key: x.d.key, d: x.d, xs: [] });
    days.at(-1).xs.push(x);
  }
  return html`<div class="cal-agenda">${days.map(({ key, d, xs: ys }) => html`<div class="ag-day" key=${key}>
    <h4>${d.p.mo}月${d.p.d}日 周${WEEK[new Date(d.p.y, d.p.mo - 1, d.p.d).getDay()]}</h4>
    ${ys.map(({ i, d: di }) => {
      const open = OPEN.includes(i.status);
      const hm = di.p.hh != null ? `${pad2(di.p.hh)}:${pad2(di.p.mm)}${di.p.aoe ? " AoE" : ""}` : "";
      return html`<button key=${i.id} class=${`ag-item ${open ? "" : "closed"} ${open && di.soon ? "soon" : ""}`} onClick=${() => locate(i.id)}>
        <${StatusIcon} s=${i.status} /><span class="tt"><${Md} text=${i.title} /></span>
        <span class="rel">${open ? di.rel : hm}</span>
      </button>`;
    })}
  </div>`)}</div>`;
}

// Clicking an item on the calendar finds it in its card, scrolls there and highlights it briefly (the editor does not open;
// to edit, click the ✎ at the right of that row)
function Chip({ x: { i, d }, inline }) {
  const { locate } = useBoard();
  const title = stripMd(i.title);
  const cls = `calchip ${OPEN.includes(i.status) ? "" : "closed"} ${motionOf(i.id) === "close" ? "just-closed" : ""} ${d.over && OPEN.includes(i.status) ? "over" : ""} ${inline ? "inline" : ""}`;
  return html`<button class=${cls} title=${`${title} · ${d.date}${d.local ? ` · ${d.local}` : ""}`} onClick=${() => locate(i.id)}><${StatusIcon} s=${i.status} /><span class="tt">${title}</span></button>`;
}
